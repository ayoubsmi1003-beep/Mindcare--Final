/**
 * sonde-troncation-taylor.mjs — mesure (tokenizer seul, ni modèle ni DB) :
 * combien des 7 859 chunks Taylor dépassent la fenêtre d'embedding épinglée
 * (TRONCATURE_MAX=512, règle `511 premiers + dernier` d'`encoderLot`), et
 * quelle part du corpus cela représente. Lecture seule du canonique gelé.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compilerConnaissance,
  resoudreDossierProuve,
} from "./embeddings-runtime.mjs";
import {
  TAYLOR_SOURCE_SHA,
  chunksDepuisUnitesTaylor,
  entreeTaylor,
  filtrerUnitesSuresTaylor,
} from "./charger-connaissance-corpus-taylor.mjs";
import { uuidDeterministe } from "./charger-connaissance-socle.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { local } = await compilerConnaissance(RACINE, "sonde-troncation-taylor");

const recette = JSON.parse(
  readFileSync(join(RACINE, "knowledge", "recette-embedding-pinee.json"), "utf8"),
);
const dossier = resoudreDossierProuve(local, recette, RACINE, process.env["MINDCARE_BGE_M3_DIR"] ?? "");
const { Tokenizer } = await import("@huggingface/tokenizers");
const tokenizer = new Tokenizer(
  JSON.parse(readFileSync(join(dossier, "tokenizer.json"), "utf8")),
  JSON.parse(readFileSync(join(dossier, "tokenizer_config.json"), "utf8")),
);

const base = join(
  RACINE, "knowledge", "canonical-v2",
  "maudsley-prescribing-guidelines-2021-taylor-14e",
  `sha256-${TAYLOR_SOURCE_SHA}`, "units.jsonl",
);
const unites = readFileSync(base, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const entree = entreeTaylor(RACINE);
const { gardees } = filtrerUnitesSuresTaylor(RACINE, unites);
const ctx = {
  sourceUuid: uuidDeterministe(`maudsley-prescribing-guidelines-2021-taylor-14e:sha256:${TAYLOR_SOURCE_SHA}`),
  version: entree.version,
  langue: "en",
};
const chunks = chunksDepuisUnitesTaylor(RACINE, gardees, ctx);

// Longueurs BRUTES (avant la troncature 511+dernier d'encoderLot).
const longueurs = chunks.map((c) => tokenizer.encode(String(c.texte)).ids.length);
const triees = [...longueurs].sort((a, b) => b - a);
const auDela = longueurs.filter((n) => n > 512).length;
const tokensPerdus = longueurs.reduce((s, n) => s + Math.max(0, n - 512), 0);
const tokensTotal = longueurs.reduce((s, n) => s + n, 0);
console.log(`chunks=${chunks.length}`);
console.log(`tokens: max=${triees[0]} p99=${triees[Math.floor(triees.length * 0.01)]} mediane=${triees[Math.floor(triees.length / 2)]}`);
console.log(`chunks > 512 tokens (tronqués à l'embed, tête 511 + queue 1): ${auDela}/${longueurs.length}`);
console.log(`tokens du milieu perdus: ${tokensPerdus}/${tokensTotal} (${(100 * tokensPerdus / tokensTotal).toFixed(2)} %)`);
