#!/usr/bin/env node
/**
 * remplir-embeddings-fichier — R9-A · BACKFILL FICHIER des embeddings BGE-M3.
 *
 *   node scripts/remplir-embeddings-fichier.mjs [--lots N] [--dossier P]
 *
 * Discipline reprise de `remplir-embeddings.mjs`, SANS base :
 * - entree unique : chunks-v2.jsonl (ordre fichier preserve, jamais modifie) ;
 * - lots de 8 sequentiels (TAILLE_LOT_INFERENCE) ; `--lots N` borne la passe
 *   (garde-fou : jamais de passe non bornee sous timeout outillage) ;
 * - reprise = les lignes existantes sont verifiees (prefixe chunk_id exact)
 *   puis sautees (re-jouer est un no-op) ; arret SIGINT = fin de lot ;
 * - 5 echecs d'inference consecutifs = abandon ;
 * - AUCUNE ecriture PG, AUCUNE activation, AUCUN secret journalise.
 * Sortie : knowledge/canonical-v2/.../embeddings-v2.jsonl (1 ligne/chunk) +
 * embeddings-v2.manifest.json (identite recette + artefact + resume compute).
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chargerBinaireNatif,
  compilerConnaissance,
  resoudreDossierProuve,
  verifierPariteTokens,
} from "./embeddings-runtime.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIVRE = "dsm5-fr-2015-elsevier";
const VERSION = "sha256-be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53";
const DOSSIER = join(RACINE, "knowledge", "canonical-v2", LIVRE, VERSION);
const ENTREE = join(DOSSIER, "chunks-v2.jsonl");
const SORTIE = join(DOSSIER, "embeddings-v2.jsonl");
const MANIFESTE = join(DOSSIER, "embeddings-v2.manifest.json");
/** SHA-256 de chunks-v2.jsonl prouve par le QA struct-v2 (jamais regenere ici). */
const EMPREINTE_CHUNKS_ATTENDUE =
  "cb832ee12e03131439db9dc3bfdec3fd8980b689872cd71ce023a64b926a3fb8";
const ECHECS_CONSECUTIFS_MAX = 5;
const TAILLE_LOT = 8;

const args = process.argv.slice(2);
function option(nom) {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const v = args[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : "";
}
let maxLots = 50;
{
  const i = args.indexOf("--lots");
  if (i >= 0) maxLots = Math.max(1, Number.parseInt(args[i + 1], 10) || 1);
}

function rouge(detail) {
  console.error(`ROUGE — ${detail} Rien n'a ete active.`);
  process.exit(1);
}

function sha256Fichier(chemin) {
  const h = createHash("sha256");
  const buf = readFileSync(chemin);
  h.update(buf);
  return h.digest("hex");
}

async function lireIds(chemin, limite = Infinity) {
  const ids = [];
  const rl = createInterface({ input: createReadStream(chemin, "utf8"), crlfDelay: Infinity });
  for await (const ligne of rl) {
    if (!ligne.trim()) continue;
    ids.push(JSON.parse(ligne).chunk_id);
    if (ids.length >= limite) break;
  }
  return ids;
}

async function lireTextes(chemin, debut, nombre) {
  const textes = [];
  const ids = [];
  let index = 0;
  const rl = createInterface({ input: createReadStream(chemin, "utf8"), crlfDelay: Infinity });
  for await (const ligne of rl) {
    if (!ligne.trim()) continue;
    if (index >= debut && textes.length < nombre) {
      const obj = JSON.parse(ligne);
      ids.push(obj.chunk_id);
      textes.push(String(obj.texte_indexable ?? obj.texte ?? ""));
    }
    index += 1;
    if (textes.length >= nombre) break;
  }
  return { textes, ids, total: index };
}

let interrompu = false;
process.on("SIGINT", () => {
  interrompu = true;
});

const t0 = Date.now();
// 0 · entree intouchable : empreinte prouvee avant tout calcul.
const empreinteEntree = sha256Fichier(ENTREE);
if (empreinteEntree !== EMPREINTE_CHUNKS_ATTENDUE) {
  rouge(`chunks-v2.jsonl a change (empreinte ${empreinteEntree}) — STOP, jamais de backfill sur chunks derives.`);
}

// 1 · recette einglee : promotion ou refus.
const { pathToFileURL } = await import("node:url");
const MARQUEUR_COMPIL = join(RACINE, ".eval-out", "remplissage-embeddings-fichier", ".compile-ok");
let compilation = "fraiche";
let local;
let embeddings;
if (!args.includes("--recompiler") && existsSync(MARQUEUR_COMPIL)) {
  const base = pathToFileURL(join(RACINE, ".eval-out", "remplissage-embeddings-fichier", "server", "knowledge")).href;
  local = await import(`${base}/embeddings-local.js`);
  embeddings = await import(`${base}/embeddings.js`);
  compilation = "reutilisee";
} else {
  ({ local, embeddings } = await compilerConnaissance(RACINE, "remplissage-embeddings-fichier"));
  writeFileSync(MARQUEUR_COMPIL, new Date().toISOString() + "\n", "utf8");
}
const recette = JSON.parse(readFileSync(join(RACINE, "knowledge", "recette-embedding-pinee.json"), "utf8"));
let config;
try {
  config = local.configLocaleDepuisRecette(recette);
} catch (err) {
  rouge(`recette derivee : ${String(err.message ?? err).slice(0, 300)}`);
}
if (embeddings.validerConfigLocale(config).ok !== true) {
  rouge("recette locale invalide (validerConfigLocale).");
}

// 2 · modele : resolution -> SHA flux -> session -> temoin.
const dossier = resoudreDossierProuve(
  local,
  recette,
  RACINE,
  option("--dossier") ?? process.env["MINDCARE_BGE_M3_DIR"] ?? "",
);
await local.verifierEmpreintesParFlux(dossier, local.extraireEmpreintes(recette), (p) =>
  createReadStream(p),
);
const { ort, Tokenizer } = await chargerBinaireNatif();
const prete = await local.chargerSessionLocale(
  dossier,
  (p) => readFileSync(p, "utf8"),
  (json, cfg) => new Tokenizer(json, cfg),
  {
    creerSession: (chemin, options) =>
      ort.InferenceSession.create(chemin, {
        intraOpNumThreads: options.intraOpNumThreads,
        executionProviders: ["cpu"],
      }),
  },
);
verifierPariteTokens(local, prete.tokenizer, "Quelle est la posologie de la sertraline en premiere intention ?");
const inference = local.inferenceDepuisSession({ Tensor: ort.Tensor }, prete.session, prete.tokenizer);
const fournisseur = new embeddings.FournisseurLocalOnnx(config, inference);
console.log(`modele — ${dossier} (empreintes + temoin tokens ok)`);

// 3 · reprise : prefixe existant verifie octet-logique, puis saut.
let deja = 0;
if (existsSync(SORTIE)) {
  const idsSortie = await lireIds(SORTIE);
  const idsEntree = await lireIds(ENTREE, idsSortie.length);
  if (idsSortie.length !== idsEntree.length) rouge("sortie existante illisible (compte).");
  for (let i = 0; i < idsSortie.length; i++) {
    if (idsSortie[i] !== idsEntree[i]) {
      rouge(`derive chunk a la ligne ${i + 1} de la sortie — STOP, purge manuelle exigee.`);
    }
  }
  deja = idsSortie.length;
  console.log(`reprise — ${deja} embedding(s) existants verifies, sautes.`);
}

// 4 · boucle bornee.
const rapport = {
  debut: new Date(t0).toISOString(),
  recette_version: "r2-2026-09-16",
  modele: config.modele,
  revision: config.version,
  dimensions: config.dimensions,
  normalisation: config.normalisation,
  chunker_version: "struct-v2",
  compilation,
  lots: 0,
  ecrits: deja,
  echecs: [],
  termine: false,
};
let echecsConsecutifs = 0;
let position = deja;
for (;;) {
  if (interrompu) {
    console.log("interrompu — lot courant valide, reprise au prochain run.");
    break;
  }
  if (rapport.lots >= maxLots) {
    console.log(`borne --lots ${maxLots} atteinte — reprise au prochain run.`);
    break;
  }
  const { textes, ids } = await lireTextes(ENTREE, position, TAILLE_LOT);
  if (textes.length === 0) break;
  let vecteurs;
  try {
    const resultat = await fournisseur.embed(textes.map((t) => fournisseur.texteDocument(t)));
    if (!resultat.ok) throw new Error(resultat.error.message);
    vecteurs = resultat.vecteurs;
  } catch (err) {
    echecsConsecutifs += 1;
    rapport.echecs.push({ lot: rapport.lots + 1, motif: `inference:${String(err.message ?? err).slice(0, 200)}` });
    if (echecsConsecutifs >= ECHECS_CONSECUTIFS_MAX) rouge(`${echecsConsecutifs} echecs consecutifs — abandon.`);
    console.log(`lot ${rapport.lots + 1} — echec isole, lot suivant.`);
    continue;
  }
  if (vecteurs.length !== textes.length) rouge(`lot ${rapport.lots + 1} : ${vecteurs.length} vecteurs pour ${textes.length} textes.`);
  const lignes = vecteurs.map((v, i) => {
    if (!Array.isArray(v) || v.length !== config.dimensions) {
      rouge(`lot ${rapport.lots + 1} : dimension ${v?.length} != ${config.dimensions}.`);
    }
    for (const c of v) {
      if (typeof c !== "number" || !Number.isFinite(c)) rouge(`lot ${rapport.lots + 1} : vecteur non fini.`);
    }
    return JSON.stringify({ chunk_id: ids[i], chunker_version: "struct-v2", embedding: v });
  });
  writeFileSync(SORTIE, (position === deja && deja > 0 ? "" : "") + lignes.join("\n") + "\n", {
    flag: position === 0 && deja === 0 ? "w" : "a",
    encoding: "utf8",
  });
  position += textes.length;
  rapport.lots += 1;
  rapport.ecrits += textes.length;
  echecsConsecutifs = 0;
  console.log(`lot ${rapport.lots} — ${textes.length} embedding(s), total ${rapport.ecrits}`);
}

rapport.duree_s = Math.round((Date.now() - t0) / 1000);
rapport.termine = true;
rapport.empreinte_chunks = empreinteEntree;
writeFileSync(MANIFESTE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
console.log(`fin — ecrits=${rapport.ecrits} echecs=${rapport.echecs.length} duree_s=${rapport.duree_s}`);
process.exit(0);
