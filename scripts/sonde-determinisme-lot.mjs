/**
 * sonde-determinisme-lot.mjs — M08-Taylor · preuve que la taille de lot
 * d'INFERENCE ne change aucun octet de vecteur (pré-requis à --lot-inference).
 *
 * 16 textes Taylor réels : embed avec tailleLot 8 (R2) vs 64, comparaison
 * JSON exacte. Exit 0 si bit-identiques, 1 sinon. Lecture seule (zéro DB).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chargerBinaireNatif,
  compilerConnaissance,
  resoudreDossierProuve,
} from "./embeddings-runtime.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { local, embeddings } = await compilerConnaissance(RACINE, "sonde-determinisme-lot");
const recette = JSON.parse(readFileSync(join(RACINE, "knowledge", "recette-embedding-pinee.json"), "utf8"));
const config = local.configLocaleDepuisRecette(recette);
const dossier = resoudreDossierProuve(local, recette, RACINE, process.env["MINDCARE_BGE_M3_DIR"] ?? "");
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

// 16 premiers textes Taylor (frozen canonical, lecture seule).
const base = join(RACINE, "knowledge", "canonical-v2", "maudsley-prescribing-guidelines-2021-taylor-14e",
  "sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0", "units.jsonl");
const lignes = readFileSync(base, "utf8").split("\n").filter(Boolean).slice(0, 16);
const unites = lignes.map((l) => JSON.parse(l));
const { chunksDepuisUnitesTaylor, filtrerUnitesSuresTaylor, entreeTaylor } = await import("./charger-connaissance-corpus-taylor.mjs");
const entree = entreeTaylor(RACINE);
const { gardees } = filtrerUnitesSuresTaylor(RACINE, unites);
const { uuidDeterministe } = await import("./charger-connaissance-socle.mjs");
const ctx = {
  sourceUuid: uuidDeterministe("maudsley-prescribing-guidelines-2021-taylor-14e:sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0"),
  version: entree.version,
  langue: "en",
};
const chunks = chunksDepuisUnitesTaylor(RACINE, gardees, ctx);
const textes = chunks.map((c) => String(c.texte));
console.log(`textes=${textes.length}`);

const fournisseur = new embeddings.FournisseurLocalOnnx(config, () => {
  throw new Error("non utilisé");
});
const docs = textes.map((t) => fournisseur.texteDocument(t));

const inf8 = local.inferenceDepuisSession({ Tensor: ort.Tensor }, prete.session, prete.tokenizer);
const t0 = Date.now();
const v8 = (await inf8(docs)).vecteurs;
const ms8 = Date.now() - t0;

const inf64 = local.inferenceDepuisSession({ Tensor: ort.Tensor }, prete.session, prete.tokenizer, { tailleLot: 64 });
const t1 = Date.now();
const v64 = (await inf64(docs)).vecteurs;
const ms64 = Date.now() - t1;

const j8 = JSON.stringify(v8);
const j64 = JSON.stringify(v64);
console.log(`lot8: ${ms8} ms | lot64: ${ms64} ms | vecteurs=${v8.length}/${v64.length} dim=${v8[0]?.length}`);
if (j8 === j64) {
  console.log("VERT — bit-identiques (taille de lot d'inférence sans effet).");
  process.exit(0);
}
let diffs = 0;
for (let i = 0; i < v8.length; i++) {
  if (JSON.stringify(v8[i]) !== JSON.stringify(v64[i])) diffs++;
}
console.log(`ROUGE — ${diffs}/${v8.length} vecteurs diffèrent.`);
process.exit(1);
