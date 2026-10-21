#!/usr/bin/env node
/**
 * bench-lot-stahl — mesure l'effet de la TAILLE DE LOT sur le debit ET sur
 * l'IDENTITE OCTET-POUR-OCTET des vecteurs.
 *
 *   node scripts/bench-lot-stahl.mjs [--n 64]
 *
 * Pourquoi : la recette epinglee r2-2026-09-16 a ete mesuree sur un lot de
 * 23 documents ("lot docs 11.7 s / 23"), alors que le runtime de production
 * utilise TAILLE_LOT_INFERENCE = 8. Avant de choisir, on MESURE :
 *   1. le debit reel de chaque taille de lot sur ce poste (4 coeurs) ;
 *   2. l'identite des vecteurs (le padding est a droite et masque, donc
 *      le vecteur DOIT etre invariant ; on le PROUVE, on ne le suppose pas).
 * Si les vecteurs sont identiques a l'octet, le choix du lot est une
 * decision de performance, pas de numerique.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chargerBinaireNatif, compilerConnaissance, resoudreDossierProuve, verifierPariteTokens,
} from "./embeddings-runtime.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOK_ID = "stahl-prescribers-guide-7e-cup";
const VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3";
const DOSSIER = join(RACINE, "knowledge", "canonical-v2", BOOK_ID, VERSION.replace("sha256:", "sha256-"));

const args = process.argv.slice(2);
const iN = args.indexOf("--n");
const N = iN >= 0 ? Number.parseInt(args[iN + 1], 10) : 64;
const TAILLES = [8, 16, 23, 32];

const chunks = readFileSync(join(DOSSIER, "chunks-v2.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l)).slice(0, N);
const textes = chunks.map((c) => c.texte_indexable ?? c.texte);

const { local, embeddings } = await compilerConnaissance(RACINE, "bench-lot-stahl");
const recette = JSON.parse(readFileSync(join(RACINE, "knowledge", "recette-embedding-pinee.json"), "utf8"));
const config = local.configLocaleDepuisRecette(recette);
if (embeddings.validerConfigLocale(config).ok !== true) {
  console.error("ROUGE — recette locale invalide.");
  process.exit(1);
}
const dossier = resoudreDossierProuve(local, recette, RACINE, process.env["MINDCARE_BGE_M3_DIR"] ?? "");
await local.verifierEmpreintesParFlux(dossier, local.extraireEmpreintes(recette), (p) => process.getBuiltinModule("fs").createReadStream(p));
const { ort, Tokenizer } = await chargerBinaireNatif();
const prete = await local.chargerSessionLocale(dossier, (p) => readFileSync(p, "utf8"),
  (json, cfg) => new Tokenizer(json, cfg),
  { creerSession: (chemin, options) => ort.InferenceSession.create(chemin, {
    intraOpNumThreads: options.intraOpNumThreads, executionProviders: ["cpu"] }) });
verifierPariteTokens(local, prete.tokenizer, "Quelle est la posologie de la sertraline en premiere intention ?");

const resultats = [];
let reference = null;
for (const taille of TAILLES) {
  const inference = local.inferenceDepuisSession({ Tensor: ort.Tensor }, prete.session, prete.tokenizer, { tailleLot: taille });
  const fournisseur = new embeddings.FournisseurLocalOnnx(config, inference);
  // warm-up (hors mesure)
  await fournisseur.embed(textes.slice(0, Math.min(4, textes.length)));
  const t0 = Date.now();
  const r = await fournisseur.embed(textes);
  const duree = (Date.now() - t0) / 1000;
  const v = r.vecteurs;
  let identique = null;
  let ecartMax = null;
  if (reference === null) {
    reference = v.map((x) => x.map((n) => n.toFixed(9)).join(","));
    identique = true;
  } else {
    ecartMax = 0;
    identique = v.length === reference.length;
    for (let i = 0; i < v.length && identique; i++) {
      for (let j = 0; j < v[i].length; j++) {
        const d = Math.abs(v[i][j] - reference[i].split(",")[j] * 1);
        if (d > ecartMax) ecartMax = d;
        if (d > 0) identique = false;
      }
    }
  }
  const res = {
    taille_lot: taille,
    duree_s: Number(duree.toFixed(2)),
    doc_par_s: Number((v.length / duree).toFixed(3)),
    vecteurs_identiques: identique,
    ecart_absolu_max: ecartMax,
  };
  resultats.push(res);
  console.log(`lot ${String(taille).padStart(2)} : ${res.duree_s}s -> ${res.doc_par_s} doc/s | identiques=${identique} ecart_max=${ecartMax}`);
}
console.log(JSON.stringify({ n: N, resultats }, null, 2));
