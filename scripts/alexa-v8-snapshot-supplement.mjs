/** Capture remaining task-specific source facts in a private, read-only snapshot supplement. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { validateV8Source, validateV8Target } from './lib/alexa-v8-manifest.mjs';

const connectionString = process.env.MINDCARE_ALEXA_V8_ADMIN_URL;
validateV8Target(connectionString);
const basePath = '.eval-out/alexa-v8-upgrade/private-oracle-snapshot.json';
const output = '.eval-out/alexa-v8-upgrade/private-oracle-snapshot-v2.json';
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 30000 });

try {
  const base = JSON.parse(await readFile(basePath, 'utf8'));
  const baseSha256 = createHash('sha256').update(JSON.stringify(base)).digest('hex');
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const [source] = (await client.query(`SELECT current_database() AS database,
    (SELECT count(*)::int FROM app.patients) AS patients,
    (SELECT count(*)::int FROM app.patients WHERE is_synthetic IS DISTINCT FROM true) AS "nonSynthetic",
    (SELECT count(*)::int FROM app.consultations) AS consultations`)).rows;
  validateV8Source(source);
  if (JSON.stringify(source) !== JSON.stringify(base.source)) throw new Error('Source snapshot changed');
  const selectedPatientIds = [base.patientA.id, base.patientB.id, ...base.longPatients.map(row => row.id)];
  const queries = {
    prescriptions: ['SELECT to_jsonb(p) AS item FROM app.prescriptions p WHERE p.cabinet_id=$1 ORDER BY p.id', [base.owner.cabinet_id]],
    prescriptionLines: ['SELECT to_jsonb(l) AS item FROM app.prescription_lines l JOIN app.prescriptions p ON p.id=l.prescription_id WHERE p.cabinet_id=$1 ORDER BY l.prescription_id,l.position,l.id', [base.owner.cabinet_id]],
    documentTemplates: ['SELECT to_jsonb(t) AS item FROM app.document_templates t WHERE t.cabinet_id IS NULL OR t.cabinet_id=$1 ORDER BY t.doc_type,t.version', [base.owner.cabinet_id]],
    documentDraftRevisions: ['SELECT to_jsonb(r) AS item FROM app.document_draft_revisions r WHERE r.cabinet_id=$1 ORDER BY r.draft_id,r.revision', [base.owner.cabinet_id]],
    internalMessages: ['SELECT to_jsonb(m) AS item FROM app.internal_messages m WHERE m.cabinet_id=$1 ORDER BY m.created_at,m.id', [base.owner.cabinet_id]],
    appointmentReasons: ['SELECT to_jsonb(r) AS item FROM app.appointment_reasons r JOIN app.appointments a ON a.id=r.appointment_id WHERE a.cabinet_id=$1 ORDER BY r.appointment_id', [base.owner.cabinet_id]],
    selectedCaseSummaries: ['SELECT to_jsonb(s) AS item FROM app.patient_case_summaries s WHERE s.cabinet_id=$1 AND s.patient_id=ANY($2::uuid[]) ORDER BY s.patient_id,s.generated_at', [base.owner.cabinet_id, selectedPatientIds]],
  };
  const extraTables = {};
  for (const [name, [sql, parameters]] of Object.entries(queries)) {
    extraTables[name] = (await client.query(sql, parameters)).rows.map(row => row.item);
  }
  const [selectedConsultation] = base.tables.selectedConsultations
    .filter(row => row.patient_id === base.patientA.id)
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
  const [currentDocument] = base.tables.documents.filter(row => row.status === 'issued' && !row.voided_at)
    .sort((a, b) => String(a.issued_at ?? '').localeCompare(String(b.issued_at ?? '')) || String(a.id).localeCompare(String(b.id)));
  const [notifications] = (await client.query(`SELECT count(*)::int AS unread FROM app.notifications
    WHERE cabinet_id=$1 AND recipient_id=$2 AND read_at IS NULL`, [base.owner.cabinet_id, base.owner.id])).rows;
  const [ambiguous] = (await client.query(`SELECT trim(first_name) AS token, count(DISTINCT id)::int AS candidates
    FROM app.patients WHERE cabinet_id=$1 AND is_synthetic AND is_active AND nullif(trim(first_name),'') IS NOT NULL
    GROUP BY app.immutable_unaccent(lower(trim(first_name))),trim(first_name)
    HAVING count(DISTINCT id)>1 ORDER BY length(trim(first_name)),app.immutable_unaccent(lower(trim(first_name))) LIMIT 1`, [base.owner.cabinet_id])).rows;
  const ambiguousCandidates = ambiguous ? (await client.query(`SELECT id,first_name,last_name FROM app.patients
    WHERE cabinet_id=$1 AND is_synthetic AND is_active AND app.immutable_unaccent(lower(trim(first_name)))=
      app.immutable_unaccent(lower($2)) ORDER BY id`, [base.owner.cabinet_id, ambiguous.token])).rows : [];
  await client.query('COMMIT');
  const snapshot = {
    ...base,
    selectedConsultation: selectedConsultation ?? null,
    currentDocument: currentDocument ?? null,
    visibleNotificationsCount: notifications.unread,
    ambiguousPatient: ambiguous ? { token: ambiguous.token, candidates: ambiguousCandidates } : null,
    tables: { ...base.tables, ...extraTables },
  };
  const contents = JSON.stringify(snapshot);
  const sha256 = createHash('sha256').update(contents).digest('hex');
  await writeFile(output, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'PASS', source, baseSha256, sha256, extraRowCounts: Object.fromEntries(Object.entries(extraTables).map(([key, rows]) => [key, rows.length])), unreadNotificationCount: notifications.unread, output }));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* Connection already closed or transaction completed. */ }
  console.error('Evaluation supplement unavailable:', error instanceof Error ? error.name : 'Error');
  process.exitCode = 1;
} finally {
  await client.end();
}
