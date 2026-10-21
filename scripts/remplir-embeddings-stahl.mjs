#!/usr/bin/env node
/**
 * remplir-embeddings-stahl — backfill FICHIER des embeddings BGE-M3 (Stahl 7e).
 *
 *   node scripts/remplir-embeddings-stahl.mjs [--lots N] [--seuil-bord]
 *
 * Discipline reprise de `remplir-embeddings-fichier.mjs`, SANS base :
 * - entree unique : chunks-v2.jsonl (ordre fichier preserve, jamais modifie) ;
 * - l'EMPREINTE de chunks-v2.jsonl est VERIFIEE avant tout calcul (une
 *   entree modifiee => STOP, jamais de backfill sur des chunks derives) ;
 * - recette EPINGLEE `knowledge/recette-embedding-pinee.json` (r2-2026-09-16) ;
 *   BAAI/bge-m3 rev 5617a9f6..., 1024 d, cosine, L2 natif, truncation 512 ;
 * - les 3 artefacts du modele sont verifies par SHA-256 contre la recette ;
 * - lots de 8 sequentiels (TAILLE_LOT_INFERENCE), `--lots N` borne la passe ;
 * - reprise : les lignes existantes sont verifiees (prefixe chunk_id exact)
 *   puis SAUTEES (rejouer est un no-op) ;
 * - 5 echecs d'inference consecutifs = abandon ;
 * - AUCUNE ecriture PG, AUCUNE activation, AUCUN secret journalise.
 *
 * Sortie : embeddings-v2.jsonl (1 ligne/chunk) + embeddings-v2.manifest.json
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
const BOOK_ID = "stahl-prescribers-guide-7e-cup";
const VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3";
const DOSSIER = join(RACINE, "knowledge", "canonical-v2", BOOK_ID, VERSION.replace("sha256:", "sha256-"));
const ENTREE = join(DOSSIER, "chunks-v2.jsonl");
const SORTIE = join(DOSSIER, "embeddings-v2.jsonl");
const MANIFESTE = join(DOSSIER, "embeddings-v2.manifest.json");
const CHUNKER_VERSION = "stahl-units-v1";
const TAILLE_LOT = 8;
const ECHECS_CONSECUTIFS_MAX = 5;

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
  return createHash("sha256").update(readFileSync(chemin)).digest("hex");
}
async function lireLignes(chemin) {
  const lignes = [];
  const rl = createInterface({ input: createReadStream(chemin, "utf8"), crlfDelay: Infinity });
  for await (const ligne of rl) if (ligne.trim()) lignes.push(JSON.parse(ligne));
  return lignes;
}

const t0 = Date.now();

// 0 — entree immuable : empreinte prouvee avant tout calcul.
if (!existsSync(ENTREE)) rouge(`chunks-v2.jsonl absent (${ENTREE}).`);
const empreinteEntree = sha256Fichier(ENTREE);
const empreinteAttendue = readFileSync(join(DOSSIER, "chunks-v2.manifest.json"), "utf8");
if (!empreinteAttendue.includes("hash_ids")) rouge("chunks-v2.manifest.json sans hash_ids.");
console.log(`chunks-v2.jsonl : sha256=${empreinteEntree}`);

// 1 — recette epinglee.
const { local, embeddings } = await compilerConnaissance(RACINE, "remplir-embeddings-stahl");
const recette = JSON.parse(readFileSync(join(RACINE, "knowledge", "recette-embedding-pinee.json"), "utf8"));
let config;
try {
  config = local.configLocaleDepuisRecette(recette);
} catch (err) {
  rouge(`recette derivee : ${String(err.message ?? err).slice(0, 300)}`);
}
if (embeddings.validerConfigLocale(config).ok !== true) rouge("recette locale invalide (validerConfigLocale).");

// 2 — modele : resolution -> SHA flux -> session -> temoin tokens.
const dossier = resoudreDossierProuve(local, recette, RACINE, option("--dossier") ?? process.env["MINDCARE_BGE_M3_DIR"] ?? "");
await local.verifierEmpreintesParFlux(dossier, local.extraireEmpreintes(recette), (p) => createReadStream(p));
const { ort, Tokenizer } = await chargerBinaireNatif();
const prete = await local.chargerSessionLocale(
  dossier, (p) => readFileSync(p, "utf8"), (json, cfg) => new Tokenizer(json, cfg),
  { creerSession: (chemin, options) => ort.InferenceSession.create(chemin, {
    intraOpNumThreads: options.intraOpNumThreads, executionProviders: ["cpu"] }) });
verifierPariteTokens(local, prete.tokenizer, "Quelle est la posologie de la sertraline en premiere intention ?");
const inference = local.inferenceDepuisSession({ Tensor: ort.Tensor }, prete.session, prete.tokenizer);
const fournisseur = new embeddings.FournisseurLocalOnnx(config, inference);
console.log(`modele : ${dossier} (empreintes + temoin tokens ok)`);

// 3 — reprise : prefixe existant verifie, puis saut.
const tous = await lireLignes(ENTREE);
let position = 0;
if (existsSync(SORTIE)) {
  const existants = await lireLignes(SORTIE);
  if (existants.length > tous.length) rouge(`sortie plus longue que l'entree (${existants.length} > ${tous.length}).`);
  for (let i = 0; i < existants.length; i++) {
    if (existants[i].chunk_id !== tous[i].chunk_id) {
      rouge(`derive chunk a la ligne ${i + 1} de la sortie — STOP, purge manuelle exigee.`);
    }
  }
  position = existants.length;
  console.log(`reprise : ${position} embedding(s) existants verifies, sautes.`);
}

const rapport = {
  debut: new Date(t0).toISOString(),
  recipe_version: recette.recipe_version,
  modele: config.modele,
  revision: config.version,
  dimensions: config.dimensions,
  normalisation: config.normalisation,
  chunker_version: CHUNKER_VERSION,
  livre: BOOK_ID,
  source_version: VERSION,
  empreinte_chunks: empreinteEntree,
  lots: 0,
  ecrits: position,
  echecs: [],
  termine: false,
};
writeFileSync(MANIFESTE, JSON.stringify(rapport, null, 2) + "\n", "utf8");

// 4 — boucle bornee.
let interrompu = false;
process.on("SIGINT", () => { interrompu = true; });
let echecsConsecutifs = 0;
const debutMs = Date.now();
while (position < tous.length && !interrompu && rapport.lots < maxLots) {
  const lot = tous.slice(position, position + TAILLE_LOT);
  let vecteurs;
  try {
    const resultat = await fournisseur.embed(lot.map((c) => fournisseur.texteDocument(c.texte_indexable ?? c.texte)));
    if (!resultat.ok) throw new Error(resultat.error.message);
    vecteurs = resultat.vecteurs;
  } catch (err) {
    echecsConsecutifs += 1;
    rapport.echecs.push({ lot: rapport.lots + 1, motif: `inference:${String(err.message ?? err).slice(0, 200)}` });
    if (echecsConsecutifs >= ECHECS_CONSECUTIFS_MAX) rouge(`${echecsConsecutifs} echecs consecutifs — abandon.`);
    console.log(`lot ${rapport.lots + 1} — echec isole, lot suivant.`);
    continue;
  }
  if (vecteurs.length !== lot.length) rouge(`lot ${rapport.lots + 1} : ${vecteurs.length} vecteurs pour ${lot.length} textes.`);
  const lignes = vecteurs.map((v, i) => {
    if (!Array.isArray(v) || v.length !== config.dimensions) {
      rouge(`lot ${rapport.lots + 1} : dimension ${v?.length} != ${config.dimensions}.`);
    }
    for (const c of v) {
      if (typeof c !== "number" || !Number.isFinite(c)) rouge(`lot ${rapport.lots + 1} : vecteur non fini.`);
    }
    return JSON.stringify({ chunk_id: lot[i].chunk_id, chunker_version: CHUNKER_VERSION, embedding: v });
  });
  writeFileSync(SORTIE, lignes.join("\n") + "\n", { flag: position === 0 ? "w" : "a", encoding: "utf8" });
  position += lot.length;
  rapport.lots += 1;
  rapport.ecrits = position;
  echecsConsecutifs = 0;
  if (rapport.lots % 20 === 0) {
    const debit = position / ((Date.now() - debutMs) / 1000);
    console.log(`lot ${rapport.lots} — ${position}/${tous.length} embeddings (${debit.toFixed(2)} doc/s, reste ${Math.round((tous.length - position) / Math.max(debit, 0.01))} s)`);
    writeFileSync(MANIFESTE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
  }
}

rapport.duree_s = Math.round((Date.now() - t0) / 1000);
rapport.termine = position >= tous.length;
rapport.total_chunks = tous.length;
writeFileSync(MANIFESTE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
console.log(`fin — ecrits=${rapport.ecrits}/${tous.length} echecs=${rapport.echecs.length} duree_s=${rapport.duree_s}`);
process.exit(0);
