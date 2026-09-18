/**
 * valider-live — LE CONTRAT SCHEMA M09 LIVE (strict, deterministe, 0 reseau).
 *
 * CE QUE CETTE PASSE PROUVE
 * Les exports `exporterCaptationLiveV2()` sont bien formes : JSON lisible,
 * contrat m09-live-v2, cles connues (anti-derive, v1 gelee referencee),
 * enums valides, empreintes 8-hex, coherence comptes/tableaux, parallelisme
 * outilsFp/appels, aucun UUID brut (defense en profondeur : que des
 * empreintes), issues fermees.
 *
 * CE QU'ELLE NE PROUVE PAS
 * Ni le sens metier (aux portes), ni la qualite live. Un export malforme
 * = FAIL, jamais NOT RUN.
 *
 *   node scripts/valider-live.mjs [export.json]
 * Defaut : tous les artifacts/live-*.json.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RACINE = join(dirname(process.argv[1]), "..");
const SCHEMA = JSON.parse(readFileSync(join(RACINE, "tests", "eval", "live-schema-v2.json"), "utf8"));
const SCHEMA_V1 = JSON.parse(readFileSync(join(RACINE, "tests", "eval", "live-schema.json"), "utf8"));

function listerDefaut() {
  const dir = join(RACINE, "artifacts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("live-") && f.endsWith(".json"))
    .map((f) => join("artifacts", f));
}

const fichiers = process.argv.length > 2 ? process.argv.slice(2) : listerDefaut();
if (fichiers.length === 0) {
  console.log("  ROUGE | valider-live | aucun export live a valider");
  console.log("\nVERDICT LIVE-SCHEMA : ROUGE — 0 export");
  process.exit(1);
}

const estChaine = (v) => typeof v === "string";
const estChaineNonVide = (v) => typeof v === "string" && v.length > 0;
const estBool = (v) => typeof v === "boolean";
const estTableau = (v) => Array.isArray(v);
const estEntierPositif = (v) => Number.isInteger(v) && v >= 0;
const HEX8 = /^[0-9a-f]{8}$/;
const UUID_BRUT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

let rouges = 0;
let exportsOk = 0;
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
  if (doc.mission !== SCHEMA.mission) erreur(relatif, `mission invalide: ${JSON.stringify(doc.mission)}`);
  if (doc.kind !== SCHEMA.kind) erreur(relatif, `kind invalide: ${JSON.stringify(doc.kind)}`);
  if (doc.contrat !== SCHEMA.version) erreur(relatif, `contrat invalide: ${JSON.stringify(doc.contrat)} (v1 = autre porte)`);
  if (!estTableau(doc.records)) erreur(relatif, "racine.records n est pas un tableau");
  else {
    doc.records.forEach((rec, i) => {
      const tag = `record#${i}`;
      if (typeof rec !== "object" || rec === null) {
        erreur(relatif, `${tag} non-objet`);
        return;
      }
      for (const k of clesInconnues(rec, SCHEMA.clesRecord)) erreur(relatif, `${tag}: cle record inconnue: ${k}`);
      // Defense en profondeur : aucun UUID brut dans le record serialise.
      if (UUID_BRUT.test(JSON.stringify(rec))) erreur(relatif, `${tag}: UUID brut detecte (empreintes seules exiges)`);
      const v1 = rec.v1;
      if (typeof v1 !== "object" || v1 === null) {
        erreur(relatif, `${tag}: v1 non-objet`);
        return;
      }
      for (const k of clesInconnues(v1, SCHEMA.clesRecordV1)) erreur(relatif, `${tag}: cle v1 inconnue: ${k}`);
      if (v1.schema !== "m09-live-v1") erreur(relatif, `${tag}: v1.schema invalide`);
      if (!SCHEMA_V1.chemins.includes(v1.chemin)) erreur(relatif, `${tag}: v1.chemin invalide`);
      if (!estBool(v1.interrompu) || !estBool(v1.persiste)) erreur(relatif, `${tag}: flags v1 non booleens`);
      if (!estEntierPositif(v1.dureeMs)) erreur(relatif, `${tag}: v1.dureeMs invalide`);
      if (!estEntierPositif(v1.nbSnapshots)) erreur(relatif, `${tag}: v1.nbSnapshots invalide`);
      if (!HEX8.test(v1.empreinteRun ?? "")) erreur(relatif, `${tag}: v1.empreinteRun doit etre 8-hex`);
      if (!HEX8.test(v1.empreinte ?? "")) erreur(relatif, `${tag}: v1.empreinte doit etre 8-hex`);
      if (!estTableau(v1.appels)) erreur(relatif, `${tag}: v1.appels n est pas un tableau`);
      else {
        v1.appels.forEach((a, j) => {
          if (typeof a !== "object" || a === null) {
            erreur(relatif, `${tag}: appel#${j} non-objet`);
            return;
          }
          for (const k of clesInconnues(a, SCHEMA_V1.clesAppel)) erreur(relatif, `${tag}: cle appel inconnue: ${k}`);
          if (!estChaineNonVide(a.capacite) || a.capacite.length > 128) erreur(relatif, `${tag}: appel capacite invalide`);
          if (!estEntierPositif(a.ms)) erreur(relatif, `${tag}: appel ms invalide`);
          if (!estBool(a.ok)) erreur(relatif, `${tag}: appel ok non booleen`);
          if (!(a.code === null || a.code === undefined || (estChaine(a.code) && a.code.length <= 64)))
            erreur(relatif, `${tag}: appel code invalide`);
          if (!estBool(a.deduplique)) erreur(relatif, `${tag}: appel deduplique non booleen`);
        });
        if (v1.nbAppels !== v1.appels.length) erreur(relatif, `${tag}: nbAppels incoherent (${v1.nbAppels} <> ${v1.appels.length})`);
      }
      if (!estTableau(v1.preuves)) erreur(relatif, `${tag}: v1.preuves n est pas un tableau`);
      else {
        v1.preuves.forEach((p, j) => {
          if (typeof p !== "object" || p === null) {
            erreur(relatif, `${tag}: preuve#${j} non-objet`);
            return;
          }
          for (const k of clesInconnues(p, SCHEMA_V1.clesPreuve)) erreur(relatif, `${tag}: cle preuve inconnue: ${k}`);
          if (!estChaineNonVide(p.titre) || p.titre.length > 120) erreur(relatif, `${tag}: preuve titre invalide`);
          if (!(p.section === null || (estChaine(p.section) && p.section.length <= 120)))
            erreur(relatif, `${tag}: preuve section invalide`);
          if (!estChaineNonVide(p.version) || p.version.length > 32) erreur(relatif, `${tag}: preuve version invalide`);
        });
        if (v1.nbPreuves !== v1.preuves.length) erreur(relatif, `${tag}: nbPreuves incoherent`);
      }
      if (!estTableau(rec.outilsFp)) erreur(relatif, `${tag}: outilsFp n est pas un tableau`);
      else {
        if (estTableau(v1.appels) && rec.outilsFp.length !== v1.appels.length)
          erreur(relatif, `${tag}: outilsFp/appels longueurs differentes`);
        rec.outilsFp.forEach((fp, j) => {
          if (!(fp === null || HEX8.test(fp ?? ""))) erreur(relatif, `${tag}: outilsFp#${j} doit etre null ou 8-hex`);
        });
      }
      const appr = rec.approbation;
      if (appr !== null) {
        if (typeof appr !== "object") {
          erreur(relatif, `${tag}: approbation non-objet`);
          return;
        }
        for (const k of clesInconnues(appr, SCHEMA.clesApprobation)) erreur(relatif, `${tag}: cle approbation inconnue: ${k}`);
        if (!HEX8.test(appr.actionFp ?? "")) erreur(relatif, `${tag}: approbation.actionFp doit etre 8-hex`);
        if (!SCHEMA.issues.includes(appr.issue)) erreur(relatif, `${tag}: approbation.issue invalide`);
        if (!(appr.executionFp === null || HEX8.test(appr.executionFp ?? "")))
          erreur(relatif, `${tag}: approbation.executionFp doit etre null ou 8-hex`);
        if (!(appr.runFp === null || HEX8.test(appr.runFp ?? "")))
          erreur(relatif, `${tag}: approbation.runFp doit etre null ou 8-hex`);
      }
    });
  }

  if (rouges === avant) {
    exportsOk += 1;
    console.log(`  vert  | ${relatif} | ${(doc.records ?? []).length} records (${doc.kind})`);
  }
}

console.log(
  rouges === 0
    ? `\nVERDICT LIVE-SCHEMA : VERT (${exportsOk} export(s))`
    : `\nVERDICT LIVE-SCHEMA : ROUGE — ${rouges} erreur(s)`,
);
process.exit(rouges === 0 ? 0 : 1);
