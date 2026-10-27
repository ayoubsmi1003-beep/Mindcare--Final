#!/usr/bin/env node
/**
 * Deterministic voice-asset preparation.
 *
 * The packaged app never downloads a model. This build-time command fetches
 * only the exact recorded artifacts into the repository resource tree, checks
 * size and SHA-256, extracts Vosk, installs the pinned Python wheels into
 * `resources/voix/packages`, and regenerates the inventory/manifest.
 *
 * A failed or interrupted download stays in a `.part` file and cannot be
 * mistaken for an installed model. `--check` verifies the whole bundle
 * without touching the network or rewriting a file.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { get } from "node:https";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VOIX = join(ROOT, "resources", "voix");
const ASSETS = join(VOIX, "assets");
const REQUIREMENTS = join(VOIX, "requirements.txt");
const PYTHON = join(VOIX, "python", "python.exe");
const DOSSIER_PYTHON = join(VOIX, "python");
const PACKAGES = join(VOIX, "packages");
const JSON_OUT = process.argv.includes("--json");
const REPAIR = process.argv.includes("--repair");
const CHECK = process.argv.includes("--check");
const WITH_PACKAGES = process.argv.includes("--packages");
const PAQUETS_REQUIS = ["faster_whisper", "ctranslate2", "av", "kokoro_onnx", "vosk"];

const REVISION_STT = "536b0662742c02347bc0e980a01041f333bce120";
const BASE_STT = `https://huggingface.co/Systran/faster-whisper-small/resolve/${REVISION_STT}`;

const MODELES = [
  {
    kind: "directory",
    id: "faster-whisper-small-int8",
    dir: "faster-whisper-small",
    files: [
      {
        path: "config.json",
        bytes: 2370,
        sha256: "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828",
        url: `${BASE_STT}/config.json`,
      },
      {
        path: "model.bin",
        bytes: 483_546_902,
        sha256: "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671",
        url: `${BASE_STT}/model.bin`,
      },
      {
        path: "tokenizer.json",
        bytes: 2_203_239,
        sha256: "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab",
        url: `${BASE_STT}/tokenizer.json`,
      },
      {
        path: "vocabulary.txt",
        bytes: 459_861,
        sha256: "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913",
        url: `${BASE_STT}/vocabulary.txt`,
      },
    ],
    source: "https://huggingface.co/Systran/faster-whisper-small",
    revision: REVISION_STT,
    license: "MIT",
  },
  {
    kind: "file",
    id: "kokoro-82m-v1.0",
    file: "kokoro-v1.0.fp16.onnx",
    bytes: 163_527_961,
    sha256: "f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96",
    url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.fp16.onnx",
    source: "https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1",
    revision: "model-files-v1.1",
    license: "Apache-2.0 weights; MIT ONNX export",
  },
  {
    kind: "file",
    id: "kokoro-v1.0-voices",
    file: "voices-v1.0.bin",
    bytes: 28_214_398,
    sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin",
    source: "https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1",
    revision: "model-files-v1.1",
    license: "CC-BY 4.0 ff_siwis; Apache-2.0 model",
  },
  {
    kind: "archive",
    id: "vosk-fr-FR-small",
    file: "vosk-model-small-fr-0.22.zip",
    target: "vosk-model-small-fr-0.22",
    bytes: 42_233_323,
    sha256: "cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad",
    url: "https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip",
    source: "https://alphacephei.com/vosk/models",
    revision: "vosk-model-small-fr-0.22",
    license: "Apache-2.0",
  },
];

function hash(path) {
  return new Promise((resolveHash, reject) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => h.update(chunk))
      .on("error", reject)
      .on("end", () => resolveHash(h.digest("hex")));
  });
}

function taille(path) {
  try {
    return statSync(path).size;
  } catch {
    return -1;
  }
}

async function fichierValide(attendu, path) {
  if (taille(path) !== attendu.bytes) return false;
  return (await hash(path)) === attendu.sha256;
}

function cheminFichier(modele, fichier) {
  return join(ASSETS, modele.dir, ...fichier.path.split("/"));
}

async function modelePresent(modele) {
  if (modele.kind === "directory") {
    for (const fichier of modele.files) {
      if (!(await fichierValide(fichier, cheminFichier(modele, fichier)))) return false;
    }
    return true;
  }
  if (modele.kind === "archive") {
    return existsSync(join(ASSETS, modele.target, "conf", "model.conf"));
  }
  return fichierValide(modele, join(ASSETS, modele.file));
}

function telecharger(url, destination, redirections = 0) {
  if (redirections > 8) throw new Error("trop de redirections");
  return new Promise((resolveDownload, reject) => {
    const requete = get(url, { headers: { "User-Agent": "MindCare-voice-prep/1" } }, (reponse) => {
      if (reponse.statusCode && reponse.statusCode >= 300 && reponse.statusCode < 400 && reponse.headers.location) {
        reponse.resume();
        resolveDownload(telecharger(new URL(reponse.headers.location, url).toString(), destination, redirections + 1));
        return;
      }
      if (reponse.statusCode !== 200) {
        reponse.resume();
        reject(new Error(`HTTP ${reponse.statusCode ?? 0} pour ${url}`));
        return;
      }
      mkdirSync(dirname(destination), { recursive: true });
      const partiel = `${destination}.part`;
      pipeline(reponse, createWriteStream(partiel))
        .then(() => resolveDownload(partiel))
        .catch(reject);
    });
    requete.setTimeout(120_000, () => requete.destroy(new Error("timeout")));
    requete.on("error", reject);
  });
}

/** Download into `<cible>.part`, verify size and hash, then rename. */
async function telechargerVerifie(url, cible, attendu, etiquette) {
  rmSync(`${cible}.part`, { force: true });
  const obtenu = await telecharger(url, cible);
  if (!(await fichierValide(attendu, obtenu))) {
    rmSync(obtenu, { force: true });
    throw new Error(`intégrité : ${etiquette}`);
  }
  renameSync(obtenu, cible);
}

async function installer(modele) {
  if (await modelePresent(modele)) return;
  if (!REPAIR) throw new Error(`absent ou corrompu : ${modele.id}`);
  if (modele.kind === "directory") {
    for (const fichier of modele.files) {
      const cible = cheminFichier(modele, fichier);
      if (await fichierValide(fichier, cible)) continue;
      await telechargerVerifie(fichier.url, cible, fichier, `${modele.id}/${fichier.path}`);
    }
    return;
  }
  if (modele.kind === "archive") {
    const archive = join(ASSETS, modele.file);
    await telechargerVerifie(modele.url, archive, modele, modele.id);
    new AdmZip(archive).extractAllTo(ASSETS, true);
    rmSync(archive, { force: true });
    return;
  }
  await telechargerVerifie(modele.url, join(ASSETS, modele.file), modele, modele.id);
}

/** Reinstall the pinned wheels with the embedded interpreter. */
function installerPaquets() {
  if (!existsSync(PYTHON)) throw new Error("runtime Python absent : resources/voix/python/python.exe");
  if (!existsSync(REQUIREMENTS)) throw new Error("requirements.txt absent");
  rmSync(PACKAGES, { recursive: true, force: true });
  mkdirSync(PACKAGES, { recursive: true });
  const commandes = [
    ["-m", "ensurepip", "--upgrade"],
    ["-m", "pip", "install", "--no-cache-dir", "--target", PACKAGES, "-r", REQUIREMENTS],
  ];
  for (const args of commandes) {
    const resultat = spawnSync(PYTHON, args, { stdio: "inherit" });
    if (resultat.status !== 0) throw new Error(`paquets : python ${args.slice(1, 3).join(" ")}`);
  }
}

/**
 * Remove every byte-code cache under one tree. `.pyc` headers embed the
 * install-time source mtime, so they cannot be pinned by the inventory and
 * must never be shipped. `-B` keeps the worker from recreating them at runtime.
 */
function supprimerBytecode(dossier, retires = []) {
  if (!existsSync(dossier)) return retires;
  for (const entry of readdirSync(dossier, { withFileTypes: true })) {
    const complet = join(dossier, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") {
        rmSync(complet, { recursive: true, force: true });
        retires.push(complet);
      } else {
        supprimerBytecode(complet, retires);
      }
    } else if (entry.isFile() && entry.name.endsWith(".pyc")) {
      rmSync(complet, { force: true });
      retires.push(complet);
    }
  }
  return retires;
}

function nettoyerBytecode() {
  const retires = [];
  supprimerBytecode(PACKAGES, retires);
  supprimerBytecode(DOSSIER_PYTHON, retires);
  if (retires.length > 0 && !JSON_OUT) console.log(`[voix] bytecode retiré — ${retires.length} entrée(s)`);
  return retires.length;
}

/** Read-only byte-code scan: `--check` must never mutate a bundle. */
function listerBytecode(dossier, trouves = []) {
  if (!existsSync(dossier)) return trouves;
  for (const entry of readdirSync(dossier, { withFileTypes: true })) {
    const complet = join(dossier, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") trouves.push(complet);
      else listerBytecode(complet, trouves);
    } else if (entry.isFile() && entry.name.endsWith(".pyc")) {
      trouves.push(complet);
    }
  }
  return trouves;
}

/**
 * Inventory every bundled file. Byte-code is deliberately excluded: pip writes
 * `.pyc` headers that embed the install-time source mtime, so keeping it would
 * make the inventory hash change on every reinstall. `packages/` and `python/`
 * stay in the inventory because the package verifier pins their files.
 */
function inventaire(directory, base = directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") continue;
      inventaire(full, base, result);
    } else if (
      entry.isFile() &&
      !entry.name.endsWith(".pyc") &&
      entry.name !== "inventory.json" &&
      entry.name !== "manifest.json"
    ) {
      result.push({ path: relative(base, full).replaceAll("\\", "/"), bytes: taille(full), sha256: null });
    }
  }
  return result;
}

async function contenuInventaire() {
  // Sort before hashing: directory enumeration order is filesystem-dependent
  // and must never leak into the manifest's inventorySha256 contract.
  const rows = inventaire(VOIX).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const row of rows) row.sha256 = await hash(join(VOIX, row.path));
  const inventory = rows.filter((row) => row.path !== "inventory.json");
  return { inventory, json: `${JSON.stringify(inventory, null, 2)}\n` };
}

function empreinte(contenu) {
  return createHash("sha256").update(contenu).digest("hex");
}

function resumeModele(modele) {
  if (modele.kind === "directory") {
    const bytes = modele.files.reduce((total, fichier) => total + fichier.bytes, 0);
    return { id: modele.id, kind: modele.kind, dir: modele.dir, bytes, files: modele.files.length };
  }
  return { id: modele.id, kind: modele.kind, file: modele.file, bytes: modele.bytes, sha256: modele.sha256 };
}

/** Offline verification: never downloads and never rewrites the bundle. */
async function controle() {
  const echecs = [];
  for (const modele of MODELES) {
    if (!(await modelePresent(modele))) echecs.push(modele.id);
  }
  for (const paquet of PAQUETS_REQUIS) {
    if (!existsSync(join(PACKAGES, paquet))) echecs.push(`packages/${paquet}`);
  }
  const bytecode = [...listerBytecode(PACKAGES), ...listerBytecode(DOSSIER_PYTHON)];
  if (bytecode.length > 0) {
    echecs.push(`bytecode (${bytecode.length} entrée(s), ex. ${bytecode[0]})`);
  }
  const { inventory, json } = await contenuInventaire();
  const attendu = empreinte(json);
  let manifeste = null;
  try {
    manifeste = JSON.parse(readFileSync(join(VOIX, "manifest.json"), "utf8"));
  } catch {
    manifeste = null;
  }
  if (manifeste?.schema !== 2 || manifeste?.inventorySha256 !== attendu) echecs.push("manifest.inventorySha256");
  let inventaireDisque = null;
  try {
    inventaireDisque = empreinte(readFileSync(join(VOIX, "inventory.json")));
  } catch {
    inventaireDisque = null;
  }
  if (inventaireDisque !== attendu) echecs.push("inventory.json");
  const result = {
    ok: echecs.length === 0,
    failures: echecs,
    models: MODELES.map(resumeModele),
    inventorySha256: attendu,
    inventoryFiles: inventory.length,
  };
  if (JSON_OUT) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    for (const modele of result.models) {
      const detail = modele.kind === "directory" ? `${modele.dir}/ — ${modele.files} fichiers — ${modele.bytes} o` : `${modele.file} — ${modele.bytes} o`;
      console.log(`[voix] ${modele.id} — ${detail}`);
    }
    console.log(`[voix] inventory.json — ${inventory.length} fichiers — ${attendu}`);
    console.log(`[voix] CONTRÔLE : ${result.ok ? "PASS" : `FAIL (${echecs.join(", ")})`}`);
  }
  if (!result.ok) process.exitCode = 1;
}

async function main() {
  if (CHECK) {
    await controle();
    return;
  }
  mkdirSync(ASSETS, { recursive: true });
  for (const modele of MODELES) await installer(modele);
  for (const modele of MODELES) {
    if (!(await modelePresent(modele))) throw new Error(`intégrité : ${modele.id}`);
  }
  if (WITH_PACKAGES) installerPaquets();
  nettoyerBytecode();

  const { inventory, json } = await contenuInventaire();
  writeFileSync(join(VOIX, "inventory.json"), json);
  const inventorySha = empreinte(json);
  const manifest = {
    schema: 2,
    generatedAt: new Date().toISOString(),
    inventorySha256: inventorySha,
    models: MODELES,
  };
  writeFileSync(join(VOIX, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const result = {
    ok: true,
    models: MODELES.map(resumeModele),
    inventorySha256: inventorySha,
    inventoryFiles: inventory.length,
  };
  if (JSON_OUT) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    for (const modele of result.models) {
      const detail = modele.kind === "directory" ? `${modele.dir}/ — ${modele.files} fichiers — ${modele.bytes} o` : `${modele.file} — ${modele.bytes} o — ${modele.sha256}`;
      console.log(`[voix] ${modele.id} — ${detail}`);
    }
    console.log(`[voix] inventory.json — ${inventory.length} fichiers — ${inventorySha}`);
  }
}

main().catch((error) => {
  console.error(`[voix] ${error instanceof Error ? error.message : "échec"}`);
  process.exitCode = 1;
});
