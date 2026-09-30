#!/usr/bin/env node
/**
 * mesure-alexa-p95.mjs — LE CHEMIN DÉTERMINISTE, MESURÉ HORS LIGNE (§37).
 *
 *   node scripts/mesure-alexa-p95.mjs <racine .eval-out>
 *
 * Ce que ça mesure : le coût PUR du déterminisme — routage multilingue sur
 * le corpus §10 + assemblage du résumé (assemblerSchema2) sur une charge
 * synthétique. Aucun réseau, aucune clé, aucune base : le chiffre est
 * reproductible sur n'importe quel poste, et c'est le plancher sous lequel
 * aucun tour Alexa ne peut descendre (le modèle et la base s'ajoutent).
 *
 * Ce que ça ne mesure PAS : le modèle, la base, le streaming, la voix.
 * Ces étages exigent un environnement vivant (voir rapport Slice 1/2).
 *
 * Sortie : une ligne JSON `{n, routageMs:{p50,p95,max}, assemblageMs:{...}}`.
 * Pas de seuil, pas de verdict : c'est un instrument, pas une porte.
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const racine = process.argv[2];
if (racine === undefined) {
  console.error("usage : node scripts/mesure-alexa-p95.mjs <racine .eval-out>");
  process.exit(2);
}

const { classerMultilingue } = await import(
  pathToFileURL(join(racine, "shared/jarvis/normalisation.js")).href
);
// `resume-chronologie` n'est pas dans le périmètre de `.eval-tsconfig.json`
// (les passes n'en ont pas besoin) : compilé ad hoc dans
// `.eval-out/mesure-alexa` (zéro dépendance, voir son en-tête).
const { assemblerSchema2 } = await import(
  pathToFileURL(join(racine, "mesure-alexa/resume-chronologie.js")).href
);

const CORPUS = [
  "Quel est le résumé du cas de ce patient ?",
  "Quand est-ce que je l'ai vu la dernière fois ?",
  "Quel est son traitement actuel ?",
  "Qu'est-ce qui a changé dans son traitement récemment ?",
  "Prépare-moi pour cette consultation.",
  "Que s'est-il passé depuis sa dernière consultation ?",
  "Quels documents sont disponibles pour ce patient ?",
  "Que dit le référentiel sur la dépression ?",
  "واش راهو ياخذ دواء حاليا؟",
  "Donne-moi les événements récents.",
  "Signe l'ordonnance automatiquement",
];

const APERCU = {
  nom: "ESSAI",
  age: 40,
  residence: null,
  diagnostics: [],
  traitements: [{ texte: "Sertraline 50 mg", sources: [{ t: "prescription", id: "rx-1" }] }],
  contexte: [],
};
const BRUT = {
  chronologie: [
    { periode: "2024", entrees: [{ texte: "ancien", sources: [{ t: "consultation", id: "c-1" }] }] },
    { periode: "2026-09", entrees: [{ texte: "récent", sources: [{ t: "consultation", id: "c-2" }] }] },
  ],
  anterieur: [],
  etat_actuel: [{ texte: "stable", sources: [{ t: "consultation", id: "c-1" }] }],
};
const IDS = new Set(["c-1", "c-2", "rx-1"]);

function quantiles(durees) {
  const t = [...durees].sort((a, b) => a - b);
  const rang = (p) => t[Math.min(t.length - 1, Math.max(0, Math.ceil((p / 100) * t.length) - 1))];
  return { p50: rang(50), p95: rang(95), max: t[t.length - 1] };
}

const N = 200;
const dRoutage = [];
for (let i = 0; i < N; i++) {
  const t0 = Date.now();
  for (const q of CORPUS) classerMultilingue(q);
  dRoutage.push(Date.now() - t0);
}
const dAssemblage = [];
for (let i = 0; i < N; i++) {
  const t0 = Date.now();
  assemblerSchema2(APERCU, BRUT, IDS);
  dAssemblage.push(Date.now() - t0);
}

console.log(
  JSON.stringify({
    n: N,
    corpusQuestions: CORPUS.length,
    routageMs: quantiles(dRoutage),
    assemblageMs: quantiles(dAssemblage),
  }),
);
