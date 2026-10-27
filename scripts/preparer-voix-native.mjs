#!/usr/bin/env node
/**
 * Deterministic voice-asset preparation.
 *
 * The packaged app never downloads a model. This build-time command fetches
 * only the exact recorded artifacts into the repository resource tree, checks
 * size and SHA-256, extracts Vosk, and regenerates the inventory/manifest.
 * A failed or interrupted download stays in a `.part` file and cannot be
 * mistaken for an installed model.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VOIX = join(ROOT, "resources", "voix");
const ASSETS = join(VOIX, "assets");
const JSON_OUT = process.argv.includes("--json");
const REPAIR = process.argv.includes("--repair");

const MODELES = [
  {
    id: "whisper-large-v3-turbo-q5_0",
    file: "ggml-large-v3-turbo-q5_0.bin",
    bytes: 574_041_195,
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin",
    source: "https://huggingface.co/ggerganov/whisper.cpp",
    revision: "5359861c739e955e79d9a303bcbc70fb988958b1",
    license: "MIT",
  },
  {
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
    id: "vosk-fr-FR-small",
    file: "vosk-model-small-fr-0.22.zip",
    target: "vosk-model-small-fr-0.22",
    bytes: 42_233_323,
    sha256: "cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad",
    url: "https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip",
    source: "https://alphacephei.com/vosk/models",
    revision: "vosk-model-small-fr-0.22",
    license: "Apache-2.0",
    archive: true,
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
  try { return statSync(path).size; } catch { return -1; }
}

async function verifier(modele, path) {
  if (taille(path) !== modele.bytes) return false;
  return await hash(path) === modele.sha256;
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

async function installer(modele) {
  const archive = modele.archive === true;
  const cible = archive ? join(ASSETS, modele.file) : join(ASSETS, modele.file);
  const present = archive ? existsSync(join(ASSETS, modele.target, "conf", "model.conf")) : await verifier(modele, cible);
  if (present) return;
  if (!REPAIR) throw new Error(`absent ou corrompu : ${modele.id}`);
  const telecharge = join(ASSETS, modele.file);
  const partiel = `${telecharge}.part`;
  if (existsSync(partiel)) rmSync(partiel, { force: true });
  const obtenu = await telecharger(modele.url, telecharge);
  if (!(await verifier(modele, obtenu))) {
    rmSync(obtenu, { force: true });
    throw new Error(`intégrité : ${modele.id}`);
  }
  renameSync(obtenu, telecharge);
  if (archive) {
    const zip = new AdmZip(telecharge);
    zip.extractAllTo(ASSETS, true);
    rmSync(telecharge, { force: true });
  }
}

function inventaire(directory, base = directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      inventaire(full, base, result);
    } else if (entry.isFile() && entry.name !== "inventory.json" && entry.name !== "manifest.json") {
      result.push({ path: relative(base, full).replaceAll("\\", "/"), bytes: taille(full), sha256: null });
    }
  }
  return result;
}

async function main() {
  mkdirSync(ASSETS, { recursive: true });
  for (const modele of MODELES) await installer(modele);
  for (const modele of MODELES) {
    if (modele.archive) {
      if (!existsSync(join(ASSETS, modele.target, "conf", "model.conf"))) throw new Error(`modèle Vosk absent : ${modele.id}`);
    } else if (!(await verifier(modele, join(ASSETS, modele.file)))) {
      throw new Error(`intégrité : ${modele.id}`);
    }
  }

  const manifest = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    models: MODELES.map(({ url, ...modele }) => ({ ...modele, url })),
  };
  writeFileSync(join(VOIX, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const rows = inventaire(VOIX);
  for (const row of rows) row.sha256 = await hash(join(VOIX, row.path));
  const inventory = rows.filter((row) => row.path !== "inventory.json");
  writeFileSync(join(VOIX, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
  const inventorySha = createHash("sha256").update(readFileSync(join(VOIX, "inventory.json"))).digest("hex");
  const result = {
    ok: true,
    models: MODELES.map((m) => ({ id: m.id, file: m.file, bytes: m.bytes, sha256: m.sha256 })),
    inventorySha256: inventorySha,
    inventoryFiles: inventory.length,
  };
  if (JSON_OUT) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    for (const m of result.models) console.log(`[voix] ${m.id} — ${m.bytes} o — ${m.sha256}`);
    console.log(`[voix] inventory.json — ${inventory.length} fichiers — ${inventorySha}`);
  }
}

main().catch((error) => {
  console.error(`[voix] ${error instanceof Error ? error.message : "échec"}`);
  process.exitCode = 1;
});
