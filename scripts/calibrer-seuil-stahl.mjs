#!/usr/bin/env node
/**
 * calibrer-seuil-stahl — mesure le seuil de découpe AVEC le tokenizer épinglé.
 *
 *   node scripts/calibrer-seuil-stahl.mjs [--seuils 900,1000,1100,1200,1300,1500]
 *
 * Pourquoi : la recette epinglée tronque à 512 tokens (« 511 premiers +
 * dernier »). Un texte plus long perd sa queue SILENCIEUSEMENT. On mesure
 * donc la longueur en tokens RÉELS de chaque chunk candidat, pour chaque
 * seuil, et on retient le seuil qui garantit 0 chunk au-delà de la fenêtre
 * avec le moins de coupes dures possible.
 *
 * Aucun embedding n'est calculé ici : c'est une mesure de tokens.
 */
import { createReadStream, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chargerBinaireNatif,
  compilerConnaissance,
  resoudreDossierProuve,
  verifierPariteTokens,
} from "./embeddings-runtime.mjs";
import { construireChunks } from "./decouper-stahl-v1.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOK_ID = "stahl-prescribers-guide-7e-cup";
const VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3";
const DOSSIER = join(RACINE, "knowledge", "canonical-v2", BOOK_ID, VERSION.replace("sha256:", "sha256-"));
const FENETRE_TOKENS = 512;

const args = process.argv.slice(2);
const iSeuils = args.indexOf("--seuils");
const seuils = (iSeuils >= 0 ? args[iSeuils + 1] : "900,1000,1100,1200,1300,1500")
  .split(",").map((s) => Number.parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0);

const unites = readFileSync(join(DOSSIER, "units.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const props = JSON.parse(readFileSync(join(DOSSIER, "structure-casing-proposals.json"), "utf8"));
const mapL2 = props.l2_index_map ?? {};
const recette = JSON.parse(readFileSync(join(RACINE, "knowledge", "recette-embedding-pinee.json"), "utf8"));

const { local, embeddings } = await compilerConnaissance(RACINE, "calibrer-seuil-stahl");
const config = local.configLocaleDepuisRecette(recette);
if (embeddings.validerConfigLocale(config).ok !== true) {
  console.error("ROUGE — recette locale invalide.");
  process.exit(1);
}
const dossier = resoudreDossierProuve(local, recette, RACINE, process.env["MINDCARE_BGE_M3_DIR"] ?? "");
await local.verifierEmpreintesParFlux(dossier, local.extraireEmpreintes(recette), (p) => createReadStream(p));
const { ort, Tokenizer } = await chargerBinaireNatif();
const prete = await local.chargerSessionLocale(dossier, (p) => readFileSync(p, "utf8"),
  (json, cfg) => new Tokenizer(json, cfg),
  { creerSession: (chemin, options) => ort.InferenceSession.create(chemin, {
    intraOpNumThreads: options.intraOpNumThreads, executionProviders: ["cpu"] }) });
verifierPariteTokens(local, prete.tokenizer, "Quelle est la posologie de la sertraline en premiere intention ?");

const resultats = [];
for (const seuil of seuils) {
  const { chunks } = construireChunks(unites, mapL2, { seuil });
  const longueur = [];
  const LOT = 64;
  for (let i = 0; i < chunks.length; i += LOT) {
    const lot = chunks.slice(i, i + LOT);
    const enc = local.encoderLot(prete.tokenizer, lot.map((c) => c.texte));
    enc.ids.forEach((ids) => longueur.push(ids.length));
  }
  longueur.sort((a, b) => a - b);
  const au_dela = longueur.filter((n) => n > FENETRE_TOKENS).length;
  const coupes = chunks.filter((c) => c.coupe_dure === true).length;
  resultats.push({
    seuil,
    chunks: chunks.length,
    tokens_max: longueur[longueur.length - 1] ?? 0,
    tokens_p99: longueur[Math.floor(longueur.length * 0.99)] ?? 0,
    tokens_p50: longueur[Math.floor(longueur.length * 0.5)] ?? 0,
    chunks_au_dela_512: au_dela,
    coupes_dures: coupes,
    multi_chunks: chunks.length - new Set(chunks.map((c) => c.unit_id)).size,
  });
  console.log(
    `seuil ${String(seuil).padStart(5)} : chunks=${String(resultats.at(-1).chunks).padStart(5)} ` +
    `tokens max=${String(resultats.at(-1).tokens_max).padStart(4)} p99=${String(resultats.at(-1).tokens_p99).padStart(4)} ` +
    `p50=${String(resultats.at(-1).tokens_p50).padStart(4)} | >512=${au_dela} | coupes dures=${coupes}`,
  );
}
console.log(JSON.stringify({ fenetre_tokens: FENETRE_TOKENS, resultats }, null, 2));
