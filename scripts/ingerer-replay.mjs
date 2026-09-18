/**
 * inger-replay — GENERATEUR SQL D'INGEST M09 (operateur, hors-ligne, 0 reseau).
 *
 * CE QUE CET OUTIL FAIT
 * Valide un rapport `artifacts/replay-*.json` (valider-replay.mjs doit etre
 * VERT), puis emet un script SQL d'ingest vers stdout : INSERT du run +
 * INSERT des cas, cabinet lie par variable psql `:CABINET`. Chaque valeur
 * est re-validee ici (regex strictes) avant emission ; les CHECK de 094
 * restent l'autorite finale.
 *
 * CE QU'IL NE FAIT PAS
 * Aucune connexion, aucun secret, aucune ecriture : l'application se fait
 * par l'operateur via son chemin superuser supervise (precedent fixtures
 * STATE 2026-09-05), jamais depuis l'applicatif (aucune porte d'ecriture
 * 094, par construction). Exemple :
 *
 *   node scripts/ingerer-replay.mjs artifacts/replay-simulate-XYZ.json --cabinet=<uuid> --out=/tmp/ingest.sql
 *   docker exec -i mc-p3 psql -U postgres -d mindcare -v ON_ERROR_STOP=1 -f /tmp/ingest.sql
 *
 * Sans --out, le SQL part sur stdout (risque d'encodage sous PowerShell :
 * preferer --out, ecrit en UTF-8 sans BOM).
 *
 *   node scripts/ingerer-replay.mjs <rapport.json> --cabinet=<uuid> [--out=<fichier.sql>]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

const RACINE = join(dirname(process.argv[1]), "..");
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_CAS = /^[A-Za-z0-9][A-Za-z0-9_#.-]{0,127}$/;
const KINDS = ["simulate", "observe", "compare"];
const VERDICTS = ["PASS", "FAIL", "NOT RUN"];
const VERDICTS_CAS = ["PASS", "FAIL", "non-mappe"];
const FAMILLES = ["intentions", "conversation", "connaissance"];

function arg(nom) {
  const a = process.argv.find((x) => x.startsWith(`${nom}=`));
  return a ? a.slice(nom.length + 1) : null;
}
function lit(x) {
  return "'" + String(x).replaceAll("'", "''") + "'";
}

const cheminRapport = process.argv[2];
const cabinet = arg("--cabinet");
if (!cheminRapport || !cabinet) {
  console.error("usage : node scripts/ingerer-replay.mjs <rapport.json> --cabinet=<uuid>");
  process.exit(2);
}
if (!UUID.test(cabinet)) {
  console.error("ROUGE | ingerer-replay | --cabinet doit etre un uuid");
  process.exit(1);
}

// 1 · le rapport doit etre VERT au contrat avant toute emission.
try {
  execFileSync(process.execPath, ["scripts/valider-replay.mjs", cheminRapport], { cwd: RACINE, stdio: "pipe" });
} catch {
  console.error("ROUGE | ingerer-replay | rapport non VERT a valider-replay.mjs : ingest refuse");
  process.exit(1);
}

const doc = JSON.parse(readFileSync(cheminRapport, "utf8"));
if (doc.replay !== true || doc.live !== false) {
  console.error("ROUGE | ingerer-replay | rapport non-replay (replay=true, live=false exiges)");
  process.exit(1);
}
if (!KINDS.includes(doc.kind) || !VERDICTS.includes(doc.verdict)) {
  console.error("ROUGE | ingerer-replay | kind/verdict du rapport invalides");
  process.exit(1);
}
const prov = doc.provenance ?? {};
if (!HEX64.test(prov.goldens_hash ?? "")) {
  console.error("ROUGE | ingerer-replay | provenance.goldens_hash invalide");
  process.exit(1);
}
for (const c of doc.cas ?? []) {
  if (!FAMILLES.includes(c.famille) || !ID_CAS.test(c.id ?? "") || !HEX64.test(c.empreinte ?? "") || !VERDICTS_CAS.includes(c.verdict)) {
    console.error(`ROUGE | ingerer-replay | cas invalide : ${c.famille}/${c.id}`);
    process.exit(1);
  }
}
const t = doc.totaux ?? {};
for (const k of ["PASS", "FAIL", "NOT RUN"]) {
  if (!Number.isInteger(t[k]) || t[k] < 0) {
    console.error("ROUGE | ingerer-replay | totaux invalides");
    process.exit(1);
  }
}

const runId = randomUUID();
const cabinetLit = "'" + cabinet + "'::uuid";
const lignes = [];
lignes.push("-- M09 ingest operateur — rapport : " + cheminRapport);
lignes.push("-- Cabinet : " + cabinet + " (valide format uuid cote CLI, verifie EXISTANT ci-dessous).");
lignes.push("BEGIN;");
lignes.push("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM app.cabinets WHERE id = " + cabinetLit + ") THEN RAISE EXCEPTION 'cabinet inconnu'; END IF; END $$;");
lignes.push(
  "INSERT INTO app.ai_replay_runs (id, cabinet_id, kind, gate_version, git_revision, verdict, pass_count, fail_count, not_run_count, cas_count, goldens_hash, schema_version, prompts_hash, duree_s) VALUES (" +
    [
      lit(runId) + "::uuid",
      cabinetLit,
      lit(doc.kind),
      lit(doc.gate_version ?? "m09-replay-v1"),
      lit(String(doc.git_revision ?? "").slice(0, 64)),
      lit(doc.verdict),
      String(t.PASS ?? 0),
      String(t.FAIL ?? 0),
      String(t["NOT RUN"] ?? 0),
      String((doc.cas ?? []).length),
      lit(prov.goldens_hash),
      lit(String(prov.schema_version ?? "").slice(0, 32)),
      lit(String(prov.prompts_hash ?? "").slice(0, 64)),
      String(Number.isInteger(doc.duree_s) && doc.duree_s >= 0 ? doc.duree_s : 0),
    ].join(", ") +
    ");",
);
if ((doc.cas ?? []).length > 0) {
  const vals = (doc.cas ?? []).map(
    (c) =>
      `(${lit(runId)}::uuid,${lit(c.famille)},${lit(c.id)},${lit(c.empreinte)},${lit(c.verdict)})`,
  );
  lignes.push("INSERT INTO app.ai_replay_cases (run_id, famille, case_id, empreinte, verdict) VALUES " + vals.join(",") + ";");
}
lignes.push("COMMIT;");
const sortie = arg("--out");
if (sortie) {
  writeFileSync(sortie, lignes.join("\n") + "\n", "utf8");
  console.error(`vert | ingerer-replay | SQL ecrit : ${sortie} (${(doc.cas ?? []).length} cas)`);
} else {
  console.log(lignes.join("\n"));
}
