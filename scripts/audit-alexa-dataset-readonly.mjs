#!/usr/bin/env node
/**
 * Read-only audit of the Alexa evaluation dataset.
 *
 * The target must be the disposable synthetic V8 database by default. Every
 * aggregate query is executed without returning patient rows, note text, names,
 * phone numbers or document content. Gate checks run inside a transaction that
 * is always rolled back; the audit-log inserts made by read gates therefore do
 * not persist.
 *
 * Usage:
 *   MINDCARE_ALEXA_AUDIT_DATABASE_URL=... node scripts/audit-alexa-dataset-readonly.mjs
 *   ... --allow-cabinet-readonly
 *   ... --out .eval-out/alexa-dataset-audit/custom.json
 */
import pg from "pg";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { Client } = pg;
const SYNTHETIC_DATABASE = "alexa_eval_v8_intelligence_20261027";
const EXPECTED_PATIENTS = 1558;
const EXPECTED_CONSULTATIONS = 8143;
const EXPECTED_NOTES = 8143;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

export function validateAuditTarget(raw, { allowCabinetReadonly = false } = {}) {
  if (typeof raw !== "string" || raw.trim() === "") throw new Error("AUDIT_DATABASE_URL_REQUIRED");
  let target;
  try {
    target = new URL(raw);
  } catch {
    throw new Error("AUDIT_DATABASE_URL_INVALID");
  }
  if (!["postgres:", "postgresql:"].includes(target.protocol)) throw new Error("AUDIT_DATABASE_URL_INVALID");
  if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname)) throw new Error("AUDIT_LOOPBACK_ONLY");
  const database = target.pathname.replace(/^\/+/u, "");
  if (!database) throw new Error("AUDIT_DATABASE_REQUIRED");
  if (!allowCabinetReadonly && database !== SYNTHETIC_DATABASE) {
    throw new Error("AUDIT_SYNTHETIC_DATABASE_REQUIRED");
  }
  return { database, host: target.hostname, port: target.port, cabinet: database !== SYNTHETIC_DATABASE };
}

function rowsOf(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

async function scalar(client, sql, params = []) {
  const result = await client.query(sql, params);
  return rowsOf(result)[0] ?? {};
}

async function main() {
  const rawUrl = process.env["MINDCARE_ALEXA_AUDIT_DATABASE_URL"];
  const allowCabinetReadonly = process.argv.includes("--allow-cabinet-readonly");
  const target = validateAuditTarget(rawUrl, { allowCabinetReadonly });
  const outPath = resolve(argument("--out") ?? join(".eval-out", "alexa-dataset-audit", `audit-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`));
  const client = new Client({ connectionString: rawUrl, connectionTimeoutMillis: 15_000 });
  await client.connect();

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    target: { database: target.database, host: target.host, port: target.port, cabinet: target.cabinet },
    status: "RUNNING",
    identity: {},
    counts: {},
    patientQuality: {},
    consultationQuality: {},
    noteQuality: {},
    domainQuality: {},
    catalogue: {},
    knowledge: {},
    rls: {},
    performanceMs: {},
    migrations: {},
    findings: [],
  };

  try {
    const identity = await scalar(client, `SELECT current_database() AS database, current_user AS actor,
      current_setting('server_version') AS server_version, now() AS observed_at`);
    report.identity = {
      database: identity.database,
      actor: identity.actor,
      serverVersion: identity.server_version,
      observedAt: identity.observed_at,
    };

    const counts = await scalar(client, `SELECT
      (SELECT count(*)::int FROM app.patients) AS patients,
      (SELECT count(*)::int FROM app.patients WHERE is_active) AS patients_active,
      (SELECT count(*)::int FROM app.consultations) AS consultations,
      (SELECT count(*)::int FROM app.consultations WHERE status='closed') AS consultations_closed,
      (SELECT count(*)::int FROM app.consultations WHERE status='open') AS consultations_open,
      (SELECT count(*)::int FROM app.clinical_notes) AS notes,
      (SELECT count(*)::int FROM app.clinical_note_amendments) AS note_amendments,
      (SELECT count(*)::int FROM app.consultation_analyses) AS consultation_analyses,
      (SELECT count(*)::int FROM app.diagnoses) AS diagnoses,
      (SELECT count(*)::int FROM app.scales) AS scale_definitions,
      (SELECT count(*)::int FROM app.scale_administrations) AS scale_administrations,
      (SELECT count(*)::int FROM app.patient_treatments) AS treatments,
      (SELECT count(*)::int FROM app.patient_treatment_history) AS treatment_history,
      (SELECT count(*)::int FROM app.appointments) AS appointments,
      (SELECT count(*)::int FROM app.documents) AS documents,
      (SELECT count(*)::int FROM app.document_drafts) AS document_drafts,
      (SELECT count(*)::int FROM app.payments) AS payments,
      (SELECT count(*)::int FROM app.charges) AS charges,
      (SELECT count(*)::int FROM app.medications) AS medications,
      (SELECT count(*)::int FROM app.prescriptions) AS prescriptions,
      (SELECT count(*)::int FROM app.prescription_lines) AS prescription_lines,
      (SELECT count(*)::int FROM app.transcript_segments) AS transcript_segments,
      (SELECT count(*)::int FROM app.knowledge_sources) AS knowledge_sources,
      (SELECT count(*)::int FROM app.knowledge_chunks) AS knowledge_chunks,
      (SELECT count(*)::int FROM app.knowledge_chunk_vectors_768) AS vectors_768,
      (SELECT count(*)::int FROM app.patients WHERE is_synthetic IS DISTINCT FROM true) AS patients_not_synthetic`);
    report.counts = counts;
    report.target.synthetic = Number(counts.patients_not_synthetic) === 0;
    if (!allowCabinetReadonly && (!report.target.synthetic || identity.database !== SYNTHETIC_DATABASE)) {
      throw new Error("AUDIT_SYNTHETIC_GUARD_FAILED");
    }
    if (!allowCabinetReadonly && (Number(counts.patients) !== EXPECTED_PATIENTS || Number(counts.consultations) !== EXPECTED_CONSULTATIONS || Number(counts.notes) !== EXPECTED_NOTES)) {
      throw new Error("AUDIT_DATASET_COUNT_MISMATCH");
    }

    report.patientQuality = await scalar(client, `SELECT
      count(*) FILTER (WHERE phone IS NULL OR btrim(phone)='')::int AS missing_phone,
      count(*) FILTER (WHERE birth_date IS NULL)::int AS missing_birth,
      count(*) FILTER (WHERE sex IS NULL)::int AS missing_sex,
      count(*) FILTER (WHERE id_document_number IS NULL OR btrim(id_document_number)='')::int AS missing_id_document,
      count(*) FILTER (WHERE address IS NULL OR btrim(address)='')::int AS missing_address,
      count(*) FILTER (WHERE phone IS NOT NULL AND phone !~ '^[0-9+ ]{8,20}$')::int AS invalid_phone,
      count(*) FILTER (WHERE birth_date < date '1900-01-01')::int AS birth_before_1900,
      count(*) FILTER (WHERE birth_date > current_date)::int AS birth_in_future,
      count(*) FILTER (WHERE birth_date IS NOT NULL AND extract(year FROM age(birth_date)) > 120)::int AS age_over_120,
      (SELECT count(*)::int FROM (SELECT record_number FROM app.patients GROUP BY record_number HAVING count(*)>1) x) AS duplicate_record_numbers,
      (SELECT count(*)::int FROM (SELECT lower(app.immutable_unaccent(first_name||' '||last_name)) k FROM app.patients GROUP BY 1 HAVING count(*)>1) x) AS duplicate_name_groups,
      (SELECT count(*)::int FROM (SELECT lower(app.immutable_unaccent(first_name||' '||last_name)) k,birth_date FROM app.patients GROUP BY 1,2 HAVING count(*)>1) x) AS duplicate_name_birth_groups,
      (SELECT count(*)::int FROM (SELECT lower(app.immutable_unaccent(first_name||' '||last_name)) k FROM app.patients GROUP BY 1 HAVING count(DISTINCT birth_date)>1) x) AS duplicate_name_diff_birth_groups,
      (SELECT count(*)::int FROM (SELECT regexp_replace(phone,'\\D','','g') p FROM app.patients WHERE phone IS NOT NULL GROUP BY 1 HAVING count(*)>1) x) AS duplicate_phone_groups,
      (SELECT count(*)::int FROM app.patients p WHERE NOT EXISTS (SELECT 1 FROM app.consultations c WHERE c.patient_id=p.id)) AS patients_without_consultation
      FROM app.patients`);

    report.consultationQuality = await scalar(client, `SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status='closed')::int AS closed,
      count(*) FILTER (WHERE status='open')::int AS open,
      count(*) FILTER (WHERE ended_at IS NOT NULL AND ended_at < started_at)::int AS ended_before_started,
      count(*) FILTER (WHERE status='closed' AND ended_at IS NULL)::int AS closed_without_end,
      count(*) FILTER (WHERE status='open' AND ended_at IS NOT NULL)::int AS open_with_end,
      count(*) FILTER (WHERE started_at > now())::int AS future_start,
      count(*) FILTER (WHERE duration_seconds IS NULL)::int AS null_duration,
      (SELECT count(*)::int FROM (SELECT patient_id,started_at FROM app.consultations GROUP BY 1,2 HAVING count(*)>1) x) AS duplicate_patient_start,
      (SELECT count(*)::int FROM app.consultations c WHERE NOT EXISTS (SELECT 1 FROM app.patients p WHERE p.id=c.patient_id)) AS orphan_consultations,
      (SELECT count(*)::int FROM app.consultations c WHERE NOT EXISTS (SELECT 1 FROM app.clinical_notes n WHERE n.consultation_id=c.id)) AS consultations_without_note,
      (SELECT count(*)::int FROM app.clinical_notes n WHERE n.consultation_id IS NULL OR NOT EXISTS (SELECT 1 FROM app.consultations c WHERE c.id=n.consultation_id)) AS notes_without_consultation,
      (SELECT count(*)::int FROM app.clinical_notes n JOIN app.consultations c ON c.id=n.consultation_id WHERE n.patient_id<>c.patient_id) AS notes_patient_mismatch,
      (SELECT count(*)::int FROM (SELECT consultation_id FROM app.clinical_notes WHERE consultation_id IS NOT NULL GROUP BY 1 HAVING count(*)>1) x) AS consultations_multiple_notes,
      (SELECT min(n) FROM (SELECT count(*) n FROM app.consultations GROUP BY patient_id) x)::int AS min_consultations_per_patient,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY n) FROM (SELECT count(*) n FROM app.consultations GROUP BY patient_id) x)::numeric AS median_consultations_per_patient,
      (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY n) FROM (SELECT count(*) n FROM app.consultations GROUP BY patient_id) x)::numeric AS p95_consultations_per_patient,
      (SELECT max(n) FROM (SELECT count(*) n FROM app.consultations GROUP BY patient_id) x)::int AS max_consultations_per_patient,
      (SELECT round(avg(n),2) FROM (SELECT count(*) n FROM app.consultations GROUP BY patient_id) x)::numeric AS avg_consultations_per_patient
      FROM app.consultations`);

    report.noteQuality = await scalar(client, `SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status='signed')::int AS signed,
      count(*) FILTER (WHERE status='draft')::int AS draft,
      count(*) FILTER (WHERE coalesce(btrim(subjective),'')='' AND coalesce(btrim(objective),'')='' AND coalesce(btrim(assessment),'')='' AND coalesce(btrim(plan),'')='')::int AS empty_all_soap,
      count(*) FILTER (WHERE coalesce(btrim(subjective),'')<>'')::int AS has_subjective,
      count(*) FILTER (WHERE coalesce(btrim(objective),'')<>'')::int AS has_objective,
      count(*) FILTER (WHERE coalesce(btrim(assessment),'')<>'')::int AS has_assessment,
      count(*) FILTER (WHERE coalesce(btrim(plan),'')<>'')::int AS has_plan,
      count(*) FILTER (WHERE structured IS NOT NULL)::int AS structured_present,
      count(*) FILTER (WHERE status='signed' AND (signed_at IS NULL OR signed_by IS NULL))::int AS signed_without_signature,
      count(*) FILTER (WHERE status='draft' AND (signed_at IS NOT NULL OR signed_by IS NOT NULL))::int AS draft_with_signature,
      count(*) FILTER (WHERE status='signed' AND lock_after IS NOT NULL)::int AS locked_signed,
      count(*) FILTER (WHERE ai_draft)::int AS ai_draft_notes,
      (SELECT count(*)::int FROM app.consultations WHERE coalesce(btrim(raw_notes),'')<>'') AS raw_notes_present,
      (SELECT count(*)::int FROM app.consultations WHERE coalesce(btrim(raw_notes),'')='') AS raw_notes_empty,
      (SELECT count(*)::int FROM app.clinical_notes n JOIN app.consultations c ON c.id=n.consultation_id WHERE n.created_at<c.started_at) AS notes_before_consultation,
      (SELECT count(DISTINCT raw_notes)::int FROM app.consultations) AS distinct_raw_notes,
      (SELECT count(DISTINCT subjective)::int FROM app.clinical_notes) AS distinct_subjective,
      (SELECT count(DISTINCT objective)::int FROM app.clinical_notes) AS distinct_objective,
      (SELECT count(DISTINCT assessment)::int FROM app.clinical_notes) AS distinct_assessment,
      (SELECT count(DISTINCT plan)::int FROM app.clinical_notes) AS distinct_plan,
      (SELECT round(avg(length(raw_notes)))::int FROM app.consultations) AS avg_raw_note_length,
      (SELECT max(length(raw_notes))::int FROM app.consultations) AS max_raw_note_length
      FROM app.clinical_notes`);

    report.domainQuality = await scalar(client, `SELECT
      (SELECT count(*)::int FROM app.appointments WHERE status='completed') AS appointments_completed,
      (SELECT count(*)::int FROM app.appointments WHERE status='in_session') AS appointments_in_session,
      (SELECT count(*)::int FROM app.appointments WHERE status='confirmed') AS appointments_confirmed,
      (SELECT count(*)::int FROM app.appointments WHERE status='requested') AS appointments_requested,
      (SELECT count(*)::int FROM app.appointments WHERE status='no_show') AS appointments_no_show,
      (SELECT count(*)::int FROM app.appointments WHERE status='cancelled') AS appointments_cancelled,
      (SELECT count(*)::int FROM app.appointments WHERE patient_id IS NULL) AS appointments_without_patient,
      (SELECT count(*)::int FROM app.appointments WHERE ends_at<=starts_at) AS appointments_invalid_time,
      (SELECT count(*)::int FROM app.consultations WHERE appointment_id IS NOT NULL) AS consultations_with_appointment,
      (SELECT count(*)::int FROM app.consultations c JOIN app.appointments a ON a.id=c.appointment_id WHERE a.patient_id IS DISTINCT FROM c.patient_id) AS appointment_patient_mismatch,
      (SELECT count(*)::int FROM app.consultations c JOIN app.appointments a ON a.id=c.appointment_id WHERE c.status='closed' AND a.status NOT IN ('completed','no_show','cancelled')) AS appointment_status_mismatch_closed,
      (SELECT count(*)::int FROM app.documents WHERE status='issued') AS issued_documents,
      (SELECT count(*)::int FROM app.document_drafts WHERE issued_document_id IS NULL) AS unissued_drafts,
      (SELECT count(*)::int FROM app.document_drafts WHERE archived_at IS NOT NULL) AS archived_drafts,
      (SELECT count(*)::int FROM app.scale_administrations WHERE consultation_id IS NOT NULL) AS scale_administrations_with_consultation,
      (SELECT count(DISTINCT consultation_id)::int FROM app.scale_administrations WHERE consultation_id IS NOT NULL) AS consultations_with_scales,
      (SELECT count(DISTINCT patient_id)::int FROM app.scale_administrations) AS patients_with_scales,
      (SELECT count(DISTINCT consultation_id)::int FROM app.consultation_analyses WHERE consultation_id IS NOT NULL) AS consultations_with_analyses,
      (SELECT count(DISTINCT patient_id)::int FROM app.consultation_analyses) AS patients_with_analyses`);

    report.catalogue = await scalar(client, `SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE is_active)::int AS active,
      count(*) FILTER (WHERE cabinet_id IS NULL)::int AS shared,
      count(*) FILTER (WHERE cabinet_id IS NOT NULL)::int AS cabinet_specific,
      count(DISTINCT inn)::int AS distinct_inn,
      count(DISTINCT brand_name)::int AS distinct_brand,
      count(DISTINCT form)::int AS distinct_form,
      count(DISTINCT strength)::int AS distinct_strength,
      count(*) FILTER (WHERE inn IS NULL OR btrim(inn)='')::int AS missing_inn,
      count(*) FILTER (WHERE brand_name IS NULL OR btrim(brand_name)='')::int AS missing_brand,
      count(*) FILTER (WHERE form IS NULL OR btrim(form)='')::int AS missing_form,
      count(*) FILTER (WHERE strength IS NULL OR btrim(strength)='')::int AS missing_strength,
      count(*) FILTER (WHERE normalized_search IS NULL OR btrim(normalized_search)='')::int AS missing_normalized,
      (SELECT count(*)::int FROM (SELECT normalized_search FROM app.medications WHERE normalized_search IS NOT NULL GROUP BY 1 HAVING count(*)>1) x) AS duplicate_normalized_groups
      FROM app.medications`);

    const knowledgeSources = await client.query(`SELECT s.titre, s.statut, s.classification,
      count(c.id)::int AS total,
      count(c.id) FILTER (WHERE c.statut='active')::int AS active,
      count(c.id) FILTER (WHERE c.statut='active' AND c.texte ~ '\\[[^]]+ p\\.[0-9]+\\|src:[0-9]+\\]')::int AS with_page_marker,
      count(c.id) FILTER (WHERE c.statut='active' AND c.texte !~ '\\[[^]]+ p\\.[0-9]+\\|src:[0-9]+\\]')::int AS without_page_marker,
      count(c.id) FILTER (WHERE c.statut='active' AND c.texte !~ '\\[[^]]+ p\\.[0-9]+\\|src:[0-9]+\\]' AND c.unit_id IS NULL)::int AS without_marker_and_unit,
      count(c.id) FILTER (WHERE c.statut='active' AND c.unit_id IS NULL)::int AS active_without_unit
      FROM app.knowledge_sources s LEFT JOIN app.knowledge_chunks c ON c.source_id=s.id
      GROUP BY s.id,s.titre,s.statut,s.classification ORDER BY s.titre`);
    const vectorSummary = await scalar(client, `SELECT
      (SELECT count(*)::int FROM app.knowledge_chunks WHERE embedding IS NOT NULL) AS embeddings_1024,
      (SELECT count(*)::int FROM app.knowledge_chunks WHERE statut='active') AS active_chunks,
      (SELECT count(*)::int FROM app.knowledge_chunk_vectors_768) AS vectors_768,
      (SELECT count(*)::int FROM app.knowledge_chunk_vectors_768 WHERE modele='intfloat/multilingual-e5-base' AND version='d128750597153bb5987e10b1c3493a34e5a4502a' AND dimensions=768) AS e5_base_vectors_768`);
    report.knowledge = {
      sources: rowsOf(knowledgeSources),
      vectors: vectorSummary,
      clinicalActiveChunks: rowsOf(knowledgeSources)
        .filter(source => ["DSM-5 — Manuel diagnostique et statistique des troubles mentaux", "The Maudsley Prescribing Guidelines in Psychiatry", "Prescriber's Guide (Stahl's Essential Psychopharmacology)"].includes(source.titre))
        .reduce((total, source) => total + Number(source.active), 0),
      clinicalActiveWithoutPageMarker: rowsOf(knowledgeSources)
        .filter(source => ["DSM-5 — Manuel diagnostique et statistique des troubles mentaux", "The Maudsley Prescribing Guidelines in Psychiatry", "Prescriber's Guide (Stahl's Essential Psychopharmacology)"].includes(source.titre))
        .reduce((total, source) => total + Number(source.without_page_marker), 0),
      clinicalUnrecoverablePages: rowsOf(knowledgeSources)
        .filter(source => ["DSM-5 — Manuel diagnostique et statistique des troubles mentaux", "The Maudsley Prescribing Guidelines in Psychiatry", "Prescriber's Guide (Stahl's Essential Psychopharmacology)"].includes(source.titre))
        .reduce((total, source) => total + Number(source.without_marker_and_unit), 0),
    };

    const actors = [
      ["owner", "00000000-0000-0000-0000-0000000000a1"],
      ["assistant", "00000000-0000-0000-0000-0000000000a3"],
      ["practitioner", "00000000-0000-0000-0000-0000000000a2"],
    ];
    for (const [role, actor] of actors) {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL ROLE authenticated");
        await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor]);
        const rls = await scalar(client, `SELECT
          (app.search_patients(jsonb_build_object('mode','count','population','active')::text, now())->>'total')::int AS patient_search_total,
          (SELECT count(*)::int FROM app.get_patient('001db1e6-7f86-45f3-8865-37819ad4c029')) AS patient_rows,
          (SELECT count(*)::int FROM app.get_consultation('8e064844-b68f-4cf0-9ed5-3966d0445417')) AS consultation_rows,
          app.get_alexa_clinical_context('001db1e6-7f86-45f3-8865-37819ad4c029',1,null,null) IS NULL AS clinical_context_denied,
          app.get_analysis_overview(date '2026-09-30', date '2026-10-30') IS NULL AS analysis_overview_denied,
          app.get_analysis_overview(date '2026-09-30', date '2026-10-30') -> 'pulse' ->> 'seances' AS analysis_seances`);
        report.rls[role] = rls;
      } finally {
        await client.query("ROLLBACK").catch(() => {});
      }
    }

    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL STATEMENT_TIMEOUT='45s'");
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true)");
      const timed = async sql => {
        const result = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
        const payload = result.rows[0]?.["QUERY PLAN"];
        const root = Array.isArray(payload) ? payload[0] : payload;
        const value = Number(root?.["Execution Time"]);
        return Number.isFinite(value) ? Math.round(value) : null;
      };
      report.performanceMs = {
        analysis_30d: await timed("SELECT app.get_analysis_overview(date '2026-09-30', date '2026-10-30')"),
        patient_search_count: await timed("SELECT app.search_patients(jsonb_build_object('mode','count','population','active')::text, now())"),
        consultation_count: await timed("SELECT count(*) FROM app.query_alexa_records('consultations', jsonb_build_object('mode','count','status','closed')::text, now())"),
        knowledge_lexical: await timed("SELECT count(*) FROM app.search_knowledge_lexical('clozapine','fr',5)"),
      };
    } finally {
      await client.query("ROLLBACK").catch(() => {});
    }

    const migrations = await scalar(client, `SELECT count(*)::int AS applied_count, max(version) AS highest_applied FROM app.schema_migrations`);
    const repositoryFiles = (await readdir(join(process.cwd(), "supabase", "migrations")))
      .filter(file => file.endsWith(".sql"))
      .map(file => file.slice(0, -4))
      .sort();
    const appliedVersions = rowsOf(await client.query("SELECT version FROM app.schema_migrations ORDER BY version")).map(row => row.version);
    report.migrations = {
      repositoryCount: repositoryFiles.length,
      appliedCount: Number(migrations.applied_count),
      highestApplied: migrations.highest_applied,
      missingFromDatabase: repositoryFiles.filter(version => !appliedVersions.includes(version)).slice(0, 20),
      missingCount: repositoryFiles.filter(version => !appliedVersions.includes(version)).length,
      extraInDatabase: appliedVersions.filter(version => !repositoryFiles.includes(version)).slice(0, 20),
      extraCount: appliedVersions.filter(version => !repositoryFiles.includes(version)).length,
    };

    const findings = [];
    if (Number(counts.patients_not_synthetic) > 0 && !allowCabinetReadonly) findings.push("NON_SYNTHETIC_PATIENTS");
    if (Number(report.patientQuality.missing_sex) > 0) findings.push("SEX_MISSING");
    if (Number(report.patientQuality.birth_before_1900) + Number(report.patientQuality.birth_in_future) > 0) findings.push("BIRTH_DATE_IMPLAUSIBLE");
    if (Number(report.noteQuality.draft) > 0 && Number(report.noteQuality.signed) === 0) findings.push("NO_SIGNED_NOTES");
    if (Number(counts.diagnoses) === 0) findings.push("DIAGNOSES_EMPTY");
    if (Number(counts.payments) === 0) findings.push("PAYMENTS_EMPTY");
    if (Number(report.knowledge.clinicalActiveWithoutPageMarker) > 0) findings.push("CLINICAL_CHUNKS_WITHOUT_PAGE_MARKER");
    if (Number(report.rls.assistant?.clinical_context_denied) !== 1 || Number(report.rls.assistant?.analysis_overview_denied) !== 1) findings.push("ASSISTANT_CLINICAL_LEAK");
    if (Number(report.rls.practitioner?.analysis_seances) !== 0) findings.push("PRACTITIONER_ANALYSIS_SCOPE");
    if (Number(report.consultationQuality.consultations_without_note) > 0 || Number(report.consultationQuality.notes_patient_mismatch) > 0) findings.push("NOTE_RELATIONSHIP_BROKEN");
    if (Number(report.patientQuality.patients_without_consultation) > 0) findings.push("PATIENTS_WITHOUT_CONSULTATION");
    report.findings = findings;
    report.status = findings.includes("ASSISTANT_CLINICAL_LEAK") || findings.includes("PRACTITIONER_ANALYSIS_SCOPE") || findings.includes("NON_SYNTHETIC_PATIENTS") ? "FAIL" : "PASS_WITH_REVIEW";

    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({
      status: report.status,
      target: report.target,
      counts: {
        patients: report.counts.patients,
        consultations: report.counts.consultations,
        notes: report.counts.notes,
      },
      findings: report.findings,
      output: outPath,
    }, null, 2));
  } catch (error) {
    report.status = "FAIL";
    report.error = error instanceof Error ? error.message : "AUDIT_FAILED";
    await mkdir(dirname(outPath), { recursive: true }).catch(() => {});
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }).catch(() => {});
    console.error(JSON.stringify({ status: report.status, error: report.error, output: outPath }, null, 2));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
