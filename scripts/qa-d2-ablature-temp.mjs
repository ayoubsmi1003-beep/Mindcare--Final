#!/usr/bin/env node
/**
 * qa-d2-ablature-temp — PORTÉE DU DÉFAUT D2 ET PREUVE DE LA CORRECTION. TEMPORAIRE.
 *
 * ⚠️ ZÉRO modèle, ZÉRO base, ZÉRO réseau. N'écrit rien. N'importe que l'artefact
 * compilé de l'arbre courant et interroge `classerCharge` — le code RÉEL.
 *
 * MÉTHODE — ABLATION, PAS SIMULATION. On ne réimplémente pas le classifieur
 * (une copie divergerait et ne prouverait rien). On retire UNIQUEMENT le premier
 * mot de la phrase et on réinterroge le MÊME code :
 *
 *   phrase complète  → verdict contrefactuel du premier mot seul
 *   phrase ablatée   → verdict du reste de la phrase
 *
 * Si lever le premier mot suffit à autoriser, alors le premier mot est la cause,
 * et l'exemption « premier mot de phrase » — celle que `nomSimpleAncre()`
 * applique DÉJÀ — est le correctif exact.
 *
 * Aucun nom de patient réel n'est utilisé : `Patient Test` est un MARQUEUR DE
 * TYPE (deux mots capitalisés), délibérément sans personne derrière.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const m = require(path.join(RACINE, ".eval-out/server/egress/classification.js"));

/** Reproduit la forme réelle : le système ne compte pas pour les règles « personne ». */
const charge = (message) => [
  { role: "system", content: "Tu es l'assistant. dossier, patient, consultation." },
  { role: "user", content: message },
];
const verdict = (t) => m.classerCharge(charge(t), null);

/** Le motif de tête à lever : premier mot de la phrase, ponctuation retirée. */
function ablater(phrase) {
  const i = phrase.indexOf(" ");
  return i < 0 ? "" : phrase.slice(i + 1);
}

console.log("═══ 1 · PORTÉE DU DÉFAUT D2 — questions LÉGITIMES sans aucune identité ═══\n");
const LEGITIMES = [
  "Qui vient aujourd'hui ?",
  "Qui vient demain ?",
  "Qui vient cet après-midi ?",
  "Qui revient cette semaine ?",
  "Qui vient à la première séance ?",
  "Qui paie en espèces aujourd'hui ?",
  "Qui prend son traitement le matin ?",
  "Qui consulte pour la première fois ?",
  "Qui va manquer son rendez-vous ?",
  "Chkoun jay lyoum ?",
  "Qui est mon prochain patient ?",
];

let fauxPositifs = 0;
for (const p of LEGITIMES) {
  const v = verdict(p);
  const bloque = v.decision === "BLOQUER";
  if (bloque) fauxPositifs += 1;
  console.log(`${bloque ? "🔴 BLOQUÉ   " : "✅ AUTORISÉ "} ${String(v.motif).padEnd(24)} « ${p} »`);
}
console.log(`\nFAUX POSITIFS : ${fauxPositifs} / ${LEGITIMES.length}\n`);

console.log("═══ 2 · ABLATION — le premier mot est-il bien la cause ? ═══\n");
console.log("phrase complète                                  | verdict | reste (1er mot levé)                     | verdict");
for (const p of LEGITIMES.filter((x) => verdict(x).decision === "BLOQUER")) {
  const rest = ablater(p);
  const a = verdict(p).decision;
  const b = verdict(rest);
  console.log(
    `${p.padEnd(48)}| ${a.padEnd(7)} | ${rest.padEnd(40)}| ${b.decision}` +
      `${a === "BLOQUER" && b === "AUTORISER" ? "  ← le 1er mot est la cause" : ""}`,
  );
}

console.log("\n═══ 3 · NON-RÉGRESSION — les blocages VOULUS tiennent-ils encore ? ═══\n");
const VOULUS = [
  ["Qui vient après Patient Test ?", "nom réel après verbe clinique"],
  ["Patient Test consulte demain.", "nom + verbe clinique"],
  ["Ouvre le dossier de Patient Test.", "nom complet"],
  ["Ouvre son dossier.", "référence pronominale nue"],
  ["0X XX XX XX XX", "motif identifiant (téléphone)"],
];

console.log("\n═══ 3 · NON-RÉGRESSION — les blocages VOULUS tiennent-ils encore ? ═══\n");
for (const [p, note] of VOULUS) {
  const v = verdict(p);
  const ok = v.decision === "BLOQUER";
  console.log(`${ok ? "✅ BLOQUÉ   " : "🔴 AUTORISÉ"} ${String(v.motif).padEnd(24)} « ${p} » — ${note}`);
}

console.log("\n═══ 4 · EXEMPTION PRONOM vs NOM — la correction doit distinguer ═══\n");
console.log("Si l'on exempte bêtement le 1er mot, « Nom + verbe » passerait aussi.");
console.log("Le vrai classifieur doit donc BLOQUER les noms et AUTORISER les pronoms.\n");
const PRONOM_VS_NOM = [
  ["Qui consulte demain ?", "pronom interrogatif + verbe — doit PASSER"],
  ["Quel patient vient demain ?", "adjectif interrogatif — à trancher (homme politique ?)"],
  ["Karim consulte demain ?", "prénom + verbe clinique — doit BLOQUER"],
  ["Patient Test vient demain ?", "nom complet en tête — doit BLOQUER"],
  ["Il vient demain ?", "pronom personnel — à trancher"],
  ["Elle prend son traitement ?", "pronom + R5 — à trancher"],
];
for (const [p, note] of PRONOM_VS_NOM) {
  const v = verdict(p);
  console.log(`${v.decision === "BLOQUER" ? "BLOQUÉ    " : "AUTORISÉ  "} ${String(v.motif).padEnd(24)} « ${p} » — ${note}`);
}
