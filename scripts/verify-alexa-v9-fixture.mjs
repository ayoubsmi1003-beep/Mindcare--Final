#!/usr/bin/env node
/**
 * Read-only acceptance checks for the isolated V9 fixture.
 *
 * It exercises the real database gates, not direct table reads:
 * clinical context, scales, payments, medication search, documents and RLS.
 * Every gate transaction is rolled back.
 */
import pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateFixtureTarget } from "./seed-alexa-v9-fixture.mjs";

const { Client } = pg;
const OWNER = "00000000-0000-0000-0000-0000000000a1";
const ASSISTANT = "00000000-0000-0000-0000-0000000000a3";
const PRACTITIONER = "00000000-0000-0000-0000-0000000000a2";
const PATIENT = "f1000000-0000-4000-8000-000000000001";
const CONSULTATION = "f2000000-0000-4000-8000-000000000001";
const DRAFT = "fc000000-0000-4000-8000-000000000001";

function one(result) {
  return Array.isArray(result?.rows) ? result.rows[0] : undefined;
}

async function withActor(client, actor, operation) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor]);
    return await operation();
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }
}

async function main() {
  const rawUrl = process.env["MINDCARE_ALEXA_V9_FIXTURE_ADMIN_URL"];
  const target = validateFixtureTarget(rawUrl);
  const outPath = resolve(process.env["ALEXA_V9_FIXTURE_ACCEPTANCE"] ?? ".eval-out/alexa-v9-fixture/acceptance.json");
  const client = new Client({ connectionString: rawUrl, connectionTimeoutMillis: 15_000 });
  await client.connect();
  const checks = [];
  const check = (id, passed, detail = undefined) => checks.push({ id, status: passed ? "PASS" : "FAIL", ...(detail === undefined ? {} : { detail }) });
  try {
    const counts = one(await client.query(`SELECT
      (SELECT count(*)::int FROM app.patients) AS patients,
      (SELECT count(*)::int FROM app.consultations) AS consultations,
      (SELECT count(*)::int FROM app.clinical_notes) AS notes,
      (SELECT count(*)::int FROM app.diagnoses) AS diagnoses,
      (SELECT count(*)::int FROM app.payments) AS payments,
      (SELECT count(*)::int FROM app.scale_administrations) AS scale_administrations,
      (SELECT count(*)::int FROM app.medications) AS medications,
      (SELECT count(*)::int FROM app.documents) AS documents,
      (SELECT count(*)::int FROM app.document_drafts) AS drafts,
      (SELECT count(*)::int FROM app.jarvis_actions) AS jarvis_actions`));
    check("patients", counts.patients === 12, counts.patients);
    check("consultations", counts.consultations === 36, counts.consultations);
    check("notes", counts.notes === 36, counts.notes);
    check("diagnoses", counts.diagnoses === 11, counts.diagnoses);
    check("payments", counts.payments === 16, counts.payments);
    check("scales", counts.scale_administrations === 27, counts.scale_administrations);
    check("medications", counts.medications === 15661, counts.medications);
    check("documents", counts.documents === 2, counts.documents);
    check("drafts", counts.drafts === 2, counts.drafts);
    check("no-fixture-actions", counts.jarvis_actions === 0, counts.jarvis_actions);

    const owner = await withActor(client, OWNER, async () => {
      const context = one(await client.query("SELECT app.get_alexa_clinical_context($1,5,null,null) AS value", [PATIENT]))?.value;
      const scales = one(await client.query("SELECT app.get_scale_history($1,'PHQ9') AS value", [PATIENT]))?.value;
      const finance = one(await client.query("SELECT app.get_finance_overview(date '2026-09-01',date '2026-10-30') AS value"))?.value;
      const medications = await client.query("SELECT * FROM app.search_medications_page('sertraline',20,0)");
      const curatedMedication = await client.query("SELECT * FROM app.search_medications('zoloft 50',20)");
      const documents = await client.query("SELECT * FROM app.list_patient_documents($1)", [PATIENT]);
      const draft = one(await client.query("SELECT app.get_editable_document_draft($1) AS value", [DRAFT]))?.value;
      const consultations = one(await client.query("SELECT app.query_alexa_records('consultations',jsonb_build_object('mode','count','status','closed')::text,now()) AS value"))?.value;
      const analysis = one(await client.query("SELECT app.get_analysis_overview(date '2026-09-01',date '2026-10-30') AS value"))?.value;
      return { context, scales, finance, medications, curatedMedication, documents, draft, consultations, analysis };
    });

    check("owner-context", !!owner.context && owner.context.patientId === PATIENT);
    check("owner-diagnoses", Array.isArray(owner.context?.diagnoses) && owner.context.diagnoses.length >= 1, owner.context?.diagnoses?.length);
    check("owner-treatments", Array.isArray(owner.context?.treatments?.current) && owner.context.treatments.current.length === 2, owner.context?.treatments?.current?.length);
    check("owner-scales", Array.isArray(owner.context?.scales) && owner.context.scales.length >= 5, owner.context?.scales?.length);
    check("owner-consultations", Array.isArray(owner.context?.consultations) && owner.context.consultations.length === 3, owner.context?.consultations?.length);
    const noteStatuses = (owner.context?.consultations ?? []).flatMap(consultation => (consultation.notes ?? []).map(note => note.status));
    check("owner-signed-notes", noteStatuses.filter(status => status === "signed").length >= 2, noteStatuses);
    check("owner-draft-notes", noteStatuses.includes("draft"), noteStatuses);
    check("scale-history", Array.isArray(owner.scales) && owner.scales.length === 2 && owner.scales.some(row => row.total === 14) && owner.scales.some(row => row.total === 9), owner.scales?.map(row => row.total));
    check("finance-pending", owner.finance?.pulse?.impayes_total === 23000, owner.finance?.pulse?.impayes_total);
    check("finance-collected", owner.finance?.pulse?.revenu_periode === 23000, owner.finance?.pulse?.revenu_periode);
    check("finance-sessions", owner.finance?.pulse?.nb_seances_periode === 8, owner.finance?.pulse?.nb_seances_periode);
    check("medication-page", owner.medications.rows.length === 20 && Number(owner.medications.rows[0]?.total_count) >= 28, { rows: owner.medications.rows.length, total: owner.medications.rows[0]?.total_count });
    check("medication-curated", owner.curatedMedication.rows.some(row => /zoloft/i.test(row.brand_name) && /sertraline/i.test(row.inn) && row.strength === "50 mg"), owner.curatedMedication.rows.map(row => `${row.brand_name}/${row.inn}/${row.strength}`));
    check("documents-issued", owner.documents.rows.length === 1, owner.documents.rows.length);
    check("document-draft", owner.draft?.kind === "ordonnance" && owner.draft?.patientId === PATIENT, owner.draft?.kind);
    check("consultation-count", owner.consultations?.total === 36, owner.consultations?.total);
    check("analysis-sessions", owner.analysis?.pulse?.seances === 12, owner.analysis?.pulse?.seances);

    const assistant = await withActor(client, ASSISTANT, async () => ({
      search: one(await client.query("SELECT (app.search_patients(jsonb_build_object('mode','count','population','active')::text,now())->>'total')::int AS total"))?.total,
      consultations: one(await client.query("SELECT count(*)::int AS n FROM app.get_consultation($1)", [CONSULTATION]))?.n,
      contextDenied: one(await client.query("SELECT app.get_alexa_clinical_context($1,5,null,null) IS NULL AS denied", [PATIENT]))?.denied,
      analysisDenied: one(await client.query("SELECT app.get_analysis_overview(date '2026-09-01',date '2026-10-30') IS NULL AS denied"))?.denied,
    }));
    check("assistant-identity", assistant.search === 12, assistant.search);
    check("assistant-no-consultation", assistant.consultations === 0, assistant.consultations);
    check("assistant-context-denied", assistant.contextDenied === true);
    check("assistant-analysis-denied", assistant.analysisDenied === true);

    const practitioner = await withActor(client, PRACTITIONER, async () => ({
      search: one(await client.query("SELECT (app.search_patients(jsonb_build_object('mode','count','population','active')::text,now())->>'total')::int AS total"))?.total,
      contextDenied: one(await client.query("SELECT app.get_alexa_clinical_context($1,5,null,null) IS NULL AS denied", [PATIENT]))?.denied,
      analysis: one(await client.query("SELECT app.get_analysis_overview(date '2026-09-01',date '2026-10-30') AS value"))?.value,
    }));
    check("practitioner-no-patients", practitioner.search === 0, practitioner.search);
    check("practitioner-context-denied", practitioner.contextDenied === true);
    check("practitioner-analysis-zero", practitioner.analysis?.pulse?.seances === 0, practitioner.analysis?.pulse?.seances);

    const failed = checks.filter(item => item.status === "FAIL");
    const receipt = {
      version: 1,
      generatedAt: new Date().toISOString(),
      target,
      status: failed.length === 0 ? "PASS" : "FAIL",
      checks,
      failed: failed.map(item => item.id),
    };
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({ status: receipt.status, checks: checks.length, failed: receipt.failed, output: outPath }, null, 2));
    if (failed.length) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : "FIXTURE_ACCEPTANCE_FAILED" }, null, 2));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
