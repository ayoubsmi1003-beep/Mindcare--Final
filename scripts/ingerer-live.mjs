/**
 * ingerer-live — GENERATEUR SQL D'INGEST LIVE M09 (operateur, hors-ligne, 0 reseau).
 *
 * CE QUE CET OUTIL FAIT
 * Valide un export `artifacts/live-*.json` (valider-live.mjs doit etre
 * VERT), puis emet un script SQL d'ingest vers stdout : INSERT des runs +
 * INSERT des appels + INSERT des preuves, cabinet lie par variable psql
 * `:CABINET` (verifie EXISTANT par garde DO). Chaque valeur est re-validee
 * ici (regex strictes) avant emission ; les CHECK de 097/098 restent
 * l'autorite finale.
 *
 * DERIVATIONS DETERMINISTES (documentees, testees) :
 * - `empreinte_sha256` = sha256 du canonique {v1 sans horodatage,
 *   approbation, outilsFp} — stable hors horodatage, meme export.
 * - `retrieval_fp` (run + preuve) = sha256 du canonique {titre, section,
 *   version} — l'export ne porte que du FNV-1a (partage navigateur, sans
 *   node:crypto) ; UNE seule representation persiste : le SHA-256.
 *
 * CE QU'IL NE FAIT PAS
 * Aucune connexion, aucun secret, aucune ecriture : l'application se fait
 * par l'operateur via son chemin superuser supervise (precedent fixtures
 * STATE 2026-09-05 et ingerer-replay.mjs), jamais depuis l'applicatif
 * (aucune porte d'ecriture 097, par construction). Exemple :
 *
 *   node scripts/ingerer-live.mjs artifacts/live-XYZ.json --cabinet=<uuid> --out=/tmp/ingest-live.sql
 *   docker exec -i mc-p3 psql -U postgres -d mindcare -v ON_ERROR_STOP=1 -f /tmp/ingest-live.sql
 *
 * Sans --out, le SQL part sur stdout (risque d'encodage sous PowerShell :
 * preferer --out, ecrit en UTF-8 sans BOM).
 *
 *   node scripts/ingerer-live.mjs <export.json> --cabinet=<uuid> [--revision=<txt>] [--out=<fichier.sql>]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { chaineCanonique, sha256Hex } from "./replay-preuve.mjs";

const RACINE = join(dirname(process.argv[1]), "..");
const HEX8 = /^[0-9a-f]{8}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHEMINS = ["connaissance", "patient", "refus", "inconnu"];
const ISSUES = ["ok", "echec", "inconnue", "bloquee", "duplicata", "inconnu"];

function arg(nom) {
  const a = process.argv.find((x) => x.startsWith(`${nom}=`));
  return a ? a.slice(nom.length + 1) : null;
}
function lit(x) {
  return "'" + String(x).replaceAll("'", "''") + "'";
}
function litOuNull(x) {
  return x === null || x === undefined ? "NULL" : lit(x);
}

const cheminExport = process.argv[2];
const cabinet = arg("--cabinet");
if (!cheminExport || !cabinet) {
  console.error("usage : node scripts/ingerer-live.mjs <export.json> --cabinet=<uuid>");
  process.exit(2);
}
if (!UUID.test(cabinet)) {
  console.error("ROUGE | ingerer-live | --cabinet doit etre un uuid");
  process.exit(1);
}

// 1 · l'export doit etre VERT au contrat avant toute emission.
try {
  execFileSync(process.execPath, ["scripts/valider-live.mjs", cheminExport], { cwd: RACINE, stdio: "pipe" });
} catch {
  console.error("ROUGE | ingerer-live | export non VERT a valider-live.mjs : ingest refuse");
  process.exit(1);
}

const doc = JSON.parse(readFileSync(cheminExport, "utf8"));
if (doc.mission !== "M09" || doc.kind !== "live" || doc.contrat !== "m09-live-v2") {
  console.error("ROUGE | ingerer-live | export non-v2 (mission/kind/contrat exiges)");
  process.exit(1);
}
if (!Array.isArray(doc.records)) {
  console.error("ROUGE | ingerer-live | records n est pas un tableau");
  process.exit(1);
}
if (doc.records.length === 0) {
  console.error("ROUGE | ingerer-live | aucun record a ingerer : export vide refuse");
  process.exit(1);
}

const revision = String(arg("--revision") ?? "non-renseignee").slice(0, 64);
if (revision.length < 1) {
  console.error("ROUGE | ingerer-live | --revision vide refusee");
  process.exit(1);
}

function shaPreuve(p) {
  return sha256Hex(chaineCanonique({ titre: p.titre, section: p.section ?? null, version: p.version }));
}

function shaRecord(rec) {
  const { horodatage: _h, ...v1SansHeure } = rec.v1;
  return sha256Hex(chaineCanonique({ v1: v1SansHeure, approbation: rec.approbation ?? null, outilsFp: rec.outilsFp ?? [] }));
}

// 2 · re-validation stricte locale (les CHECK 097/098 tranchent en dernier).
for (const [i, rec] of doc.records.entries()) {
  const tag = `record#${i}`;
  const v1 = rec.v1;
  if (!HEX8.test(v1.empreinteRun ?? "") || !HEX8.test(v1.empreinte ?? "")) {
    console.error(`ROUGE | ingerer-live | ${tag} : empreintes non 8-hex`);
    process.exit(1);
  }
  if (!CHEMINS.includes(v1.chemin)) {
    console.error(`ROUGE | ingerer-live | ${tag} : chemin invalide`);
    process.exit(1);
  }
  if (!Number.isInteger(v1.dureeMs) || v1.dureeMs < 0 || !Number.isInteger(v1.nbSnapshots) || v1.nbSnapshots < 0) {
    console.error(`ROUGE | ingerer-live | ${tag} : compteurs invalides`);
    process.exit(1);
  }
  if (!Array.isArray(rec.outilsFp) || rec.outilsFp.length !== (v1.appels ?? []).length) {
    console.error(`ROUGE | ingerer-live | ${tag} : outilsFp/appels incoherents`);
    process.exit(1);
  }
  for (const fp of rec.outilsFp) {
    if (!(fp === null || HEX8.test(fp))) {
      console.error(`ROUGE | ingerer-live | ${tag} : outilsFp non 8-hex`);
      process.exit(1);
    }
  }
  const appr = rec.approbation;
  if (appr !== null) {
    if (!HEX8.test(appr.actionFp ?? "") || !ISSUES.includes(appr.issue)) {
      console.error(`ROUGE | ingerer-live | ${tag} : approbation invalide`);
      process.exit(1);
    }
    for (const k of ["executionFp", "runFp"]) {
      if (!(appr[k] === null || HEX8.test(appr[k]))) {
        console.error(`ROUGE | ingerer-live | ${tag} : approbation.${k} invalide`);
        process.exit(1);
      }
    }
  }
}

const cabinetLit = "'" + cabinet + "'::uuid";
const lignes = [];
lignes.push("-- M09 ingest live operateur — export : " + cheminExport);
lignes.push("-- Cabinet : " + cabinet + " (valide format uuid cote CLI, verifie EXISTANT ci-dessous).");
lignes.push("BEGIN;");
lignes.push("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM app.cabinets WHERE id = " + cabinetLit + ") THEN RAISE EXCEPTION 'cabinet inconnu'; END IF; END $$;");

const lignesRuns = [];
const lignesCalls = [];
const lignesProofs = [];
for (const rec of doc.records) {
  const v1 = rec.v1;
  const runId = randomUUID();
  const appr = rec.approbation;
  const retrieval = (v1.preuves ?? []).map(shaPreuve);
  const propInc = typeof v1.propositionInconnue === "string" && v1.propositionInconnue !== "" ? v1.propositionInconnue.slice(0, 128) : null;
  const reso = v1.resolution === null || v1.resolution === undefined ? null : v1.resolution;
  lignesRuns.push(
    "(" +
      [
        lit(runId) + "::uuid",
        cabinetLit,
        lit("m09-live-v2"),
        lit(revision),
        lit(v1.empreinteRun),
        lit(v1.empreinte),
        lit(shaRecord(rec)),
        lit(v1.chemin),
        v1.interrompu ? "TRUE" : "FALSE",
        v1.persiste ? "TRUE" : "FALSE",
        String(v1.dureeMs),
        String(v1.appels.length),
        String(v1.preuves.length),
        String(v1.nbSnapshots),
        litOuNull(propInc),
        litOuNull(reso === null ? null : String(reso.etat ?? "").slice(0, 64) || null),
        litOuNull(reso === null ? null : reso.intentionChainee ?? null),
        litOuNull(reso === null ? null : reso.intentionRetenu ?? null),
        retrieval.length === 0 ? "NULL" : "ARRAY[" + retrieval.map((h) => lit(h)).join(",") + "]",
        litOuNull(appr === null ? null : appr.actionFp),
        litOuNull(appr === null ? null : appr.executionFp ?? null),
        litOuNull(appr === null ? null : appr.issue),
        "NULL",
      ].join(",") +
      ")",
  );
  (v1.appels ?? []).forEach((a, idx) => {
    lignesCalls.push(
      `(${lit(runId)}::uuid,${idx},${lit(String(a.capacite).slice(0, 128))},${a.ms},${a.ok ? "TRUE" : "FALSE"},${litOuNull(a.code ?? null)},${a.deduplique ? "TRUE" : "FALSE"},${litOuNull(rec.outilsFp[idx] ?? null)})`,
    );
  });
  (v1.preuves ?? []).forEach((p, idx) => {
    lignesProofs.push(
      `(${lit(runId)}::uuid,${idx},${lit(String(p.titre).slice(0, 120))},${litOuNull(p.section ?? null)},${lit(String(p.version).slice(0, 32))},${lit(retrieval[idx])})`,
    );
  });
}
lignes.push(
  "INSERT INTO app.ai_live_runs (id, cabinet_id, gate_version, git_revision, empreinte_run, empreinte, empreinte_sha256, chemin, interrompu, persiste, duree_ms, nb_appels, nb_preuves, nb_snapshots, proposition_inconnue, resolution_etat, intention_chainee, intention_retenue, retrieval_fp, approval_fp, execution_fp, issue, prompts_hash) VALUES " +
    lignesRuns.join(",") +
    ";",
);
if (lignesCalls.length > 0) {
  lignes.push("INSERT INTO app.ai_live_calls (run_id, idx, capacite, ms, ok, code, deduplique, tool_call_fp) VALUES " + lignesCalls.join(",") + ";");
}
if (lignesProofs.length > 0) {
  lignes.push("INSERT INTO app.ai_live_proofs (run_id, idx, titre, section, version, retrieval_fp) VALUES " + lignesProofs.join(",") + ";");
}
lignes.push("COMMIT;");
const sortie = arg("--out");
if (sortie) {
  writeFileSync(sortie, lignes.join("\n") + "\n", "utf8");
  console.error(`vert | ingerer-live | SQL ecrit : ${sortie} (${doc.records.length} records)`);
} else {
  console.log(lignes.join("\n"));
}
