/**
 * valider-replay — LE CONTRAT SCHEMA M09 (strict, deterministe, 0 reseau).
 *
 * CE QUE CETTE PASSE PROUVE
 * Les rapports `artifacts/replay-*.json` sont bien formes : JSON lisible,
 * cles connues (anti-derive), enums valides, cas uniques, totaux coherents,
 * provenance presente, replay honnete (replay=true, live=false).
 *
 * CE QU'ELLE NE PROUVE PAS
 * Ni le sens metier des verdicts (aux harnesses), ni la qualite live.
 * Un rapport malforme = FAIL, jamais NOT RUN.
 *
 *   node scripts/valider-replay.mjs [rapport.json ...]
 * Defaut : tous les artifacts/replay-*.json.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RACINE = join(dirname(process.argv[1]), "..");
const SCHEMA = JSON.parse(readFileSync(join(RACINE, "tests", "eval", "replay-schema.json"), "utf8"));

function listerDefaut() {
  const dir = join(RACINE, "artifacts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("replay-") && f.endsWith(".json"))
    .map((f) => join("artifacts", f));
}

const fichiers = process.argv.length > 2 ? process.argv.slice(2) : listerDefaut();
if (fichiers.length === 0) {
  console.log("  ROUGE | valider-replay | aucun rapport replay a valider");
  console.log("\nVERDICT REPLAY-SCHEMA : ROUGE — 0 rapport");
  process.exit(1);
}

const estChaine = (v) => typeof v === "string";
const estChaineNonVide = (v) => typeof v === "string" && v.length > 0;
const estBool = (v) => typeof v === "boolean";
const estTableau = (v) => Array.isArray(v);
const estEntierPositif = (v) => Number.isInteger(v) && v >= 0;

let rouges = 0;
let rapportsOk = 0;
function erreur(fichier, detail) {
  rouges += 1;
  console.log(`  ROUGE | ${fichier} | ${detail}`);
}

function clesInconnues(obj, autorisees) {
  return Object.keys(obj).filter((k) => !autorisees.includes(k));
}

for (const relatif of fichiers) {
  const chemin = resolve(RACINE, relatif);
  let doc;
  try {
    doc = JSON.parse(readFileSync(chemin, "utf8"));
  } catch (e) {
    erreur(relatif, `JSON illisible: ${e.message}`);
    continue;
  }
  const avant = rouges;
  for (const k of clesInconnues(doc, SCHEMA.clesRacine)) erreur(relatif, `cle racine inconnue: ${k}`);
  if (!SCHEMA.missions.includes(doc.mission)) erreur(relatif, `mission invalide: ${JSON.stringify(doc.mission)}`);
  if (!SCHEMA.kinds.includes(doc.kind)) erreur(relatif, `kind invalide: ${JSON.stringify(doc.kind)}`);
  if (doc.replay !== true) erreur(relatif, "replay=true exige (sortie de simulation, pas d execution live)");
  if (doc.live !== false) erreur(relatif, "live=false exige (le replay ne rejoue jamais en live)");
  if (!SCHEMA.verdicts.includes(doc.verdict)) erreur(relatif, `verdict invalide: ${JSON.stringify(doc.verdict)}`);
  if (doc.kind === "compare" && (doc.comparaison === null || doc.comparaison === undefined))
    erreur(relatif, "kind=compare exige une section comparaison");

  if (!estTableau(doc.suites)) erreur(relatif, "racine.suites n est pas un tableau");
  else {
    for (const s of doc.suites) {
      const tag = (s && s.nom) || "?";
      if (typeof s !== "object" || s === null) {
        erreur(relatif, "suite non-objet");
        continue;
      }
      for (const k of clesInconnues(s, SCHEMA.clesSuite)) erreur(relatif, `${tag}: cle suite inconnue: ${k}`);
      if (!SCHEMA.verdicts.includes(s.statut)) erreur(relatif, `${tag}: statut invalide`);
      for (const k of ["pass_count", "fail_count", "not_run_count"])
        if (!estEntierPositif(s[k])) erreur(relatif, `${tag}: ${k} doit etre un entier >=0`);
      if (!estTableau(s.cles_vertes) || !s.cles_vertes.every(estChaine))
        erreur(relatif, `${tag}: cles_vertes doit etre un tableau de chaines`);
      if (!estTableau(s.cles_rouges) || !s.cles_rouges.every(estChaine))
        erreur(relatif, `${tag}: cles_rouges doit etre un tableau de chaines`);
      if (s.statut === "NOT RUN" && !estChaineNonVide(s.not_run_reason))
        erreur(relatif, `${tag}: NOT RUN exige not_run_reason`);
      if (!(s.latence_ms === null || estEntierPositif(s.latence_ms)))
        erreur(relatif, `${tag}: latence_ms doit etre un entier >=0 ou null`);
    }
  }

  if (!estTableau(doc.cas)) erreur(relatif, "racine.cas n est pas un tableau");
  else {
    const vus = new Set();
    for (const c of doc.cas) {
      const tag = (c && c.id) || "?";
      if (typeof c !== "object" || c === null) {
        erreur(relatif, "cas non-objet");
        continue;
      }
      for (const k of clesInconnues(c, SCHEMA.clesCas)) erreur(relatif, `${tag}: cle cas inconnue: ${k}`);
      if (!SCHEMA.familles.includes(c.famille)) erreur(relatif, `${tag}: famille invalide`);
      if (!estChaineNonVide(c.id)) erreur(relatif, "cas sans id non vide");
      if (!/^[0-9a-f]{64}$/.test(c.empreinte ?? "")) erreur(relatif, `${tag}: empreinte doit etre un sha256 hex`);
      if (!SCHEMA.verdictsCas.includes(c.verdict)) erreur(relatif, `${tag}: verdict cas invalide`);
      const cle = `${c.famille}/${c.id}`;
      if (vus.has(cle)) erreur(relatif, `${cle}: cas duplique`);
      vus.add(cle);
    }
  }

  const p = doc.provenance;
  if (typeof p !== "object" || p === null) erreur(relatif, "racine.provenance doit etre un objet");
  else {
    for (const k of clesInconnues(p, SCHEMA.clesProvenance)) erreur(relatif, `provenance: cle inconnue: ${k}`);
    if (!/^[0-9a-f]{64}$/.test(p.goldens_hash ?? "")) erreur(relatif, "provenance.goldens_hash doit etre un sha256 hex");
    if (!estChaineNonVide(p.schema_version)) erreur(relatif, "provenance.schema_version non vide exige");
    if (!estChaineNonVide(p.prompts_hash)) erreur(relatif, "provenance.prompts_hash non vide exige");
  }

  const t = doc.totaux;
  if (typeof t !== "object" || t === null) erreur(relatif, "racine.totaux doit etre un objet");
  else {
    for (const k of clesInconnues(t, SCHEMA.clesTotaux)) erreur(relatif, `totaux: cle inconnue: ${k}`);
    const somme = (t.PASS ?? -1) + (t.FAIL ?? -1) + (t["NOT RUN"] ?? -1);
    const compte = (doc.suites ?? []).reduce((a, s) => a + (s.pass_count ?? 0) + (s.fail_count ?? 0) + (s.not_run_count ?? 0), 0);
    if (somme !== compte) erreur(relatif, `totaux incoherents: PASS+FAIL+NOT RUN=${somme} != controles=${compte}`);
  }

  if (rouges === avant) {
    rapportsOk += 1;
    console.log(`  vert  | ${relatif} | ${(doc.suites ?? []).length} suites, ${(doc.cas ?? []).length} cas (${doc.kind})`);
  }
}

console.log(
  rouges === 0
    ? `\nVERDICT REPLAY-SCHEMA : VERT (${rapportsOk} rapport(s))`
    : `\nVERDICT REPLAY-SCHEMA : ROUGE — ${rouges} erreur(s)`,
);
process.exit(rouges === 0 ? 0 : 1);
