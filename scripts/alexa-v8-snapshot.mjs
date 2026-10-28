/** Capture independent, private oracle data from the named disposable copy. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { validateV8Source, validateV8Target } from './lib/alexa-v8-manifest.mjs';

const connectionString = process.env.MINDCARE_ALEXA_V8_ADMIN_URL;
validateV8Target(connectionString);
const output = resolve('.eval-out/alexa-v8-upgrade/private-oracle-snapshot.json');
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 30000 });
const fetchRows = async (sql, parameters = []) => (await client.query(sql, parameters)).rows;

try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const [source] = await fetchRows(`SELECT current_database() AS database,
    (SELECT count(*)::int FROM app.patients) AS patients,
    (SELECT count(*)::int FROM app.patients WHERE is_synthetic IS DISTINCT FROM true) AS "nonSynthetic",
    (SELECT count(*)::int FROM app.consultations) AS consultations`);
  validateV8Source(source);
  const owners = await fetchRows("SELECT id,cabinet_id FROM app.profiles WHERE role='owner' AND is_active ORDER BY id");
  if (owners.length !== 1) throw new Error('Single active evaluation owner required');
  const owner = owners[0];
  const [patientA] = await fetchRows(`SELECT p.id,concat_ws(' ',p.first_name,p.last_name) AS name,count(DISTINCT c.id)::int AS visits
    FROM app.patients p JOIN app.consultations c ON c.patient_id=p.id
    JOIN app.patient_treatments t ON t.patient_id=p.id AND t.status='active'
    JOIN app.medications m ON m.id=t.medication_id
    WHERE p.cabinet_id=$1 AND p.is_synthetic AND p.is_active AND nullif(trim(p.phone),'') IS NOT NULL
      AND lower(concat_ws(' ',m.source_raw_value,m.brand_name,m.inn)) ~ 'zoloft|sertraline'
      AND (SELECT count(*) FROM app.patients p2 WHERE p2.cabinet_id=p.cabinet_id AND
        app.immutable_unaccent(lower(concat_ws(' ',trim(p2.first_name),trim(p2.last_name))))=
        app.immutable_unaccent(lower(concat_ws(' ',trim(p.first_name),trim(p.last_name)))))=1
    GROUP BY p.id,p.first_name,p.last_name HAVING count(DISTINCT c.id)>=2
    ORDER BY (count(DISTINCT c.id) BETWEEN 6 AND 10) DESC,p.id LIMIT 1`, [owner.cabinet_id]);
  if (!patientA) throw new Error('Evaluation patient with an existing treatment required');
  const [patientB] = await fetchRows(`SELECT p.id,concat_ws(' ',p.first_name,p.last_name) AS name,count(c.id)::int AS visits
    FROM app.patients p JOIN app.consultations c ON c.patient_id=p.id
    WHERE p.cabinet_id=$1 AND p.is_synthetic AND p.is_active AND p.id<>$2
      AND (SELECT count(*) FROM app.patients p2 WHERE p2.cabinet_id=p.cabinet_id AND
        app.immutable_unaccent(lower(concat_ws(' ',trim(p2.first_name),trim(p2.last_name))))=
        app.immutable_unaccent(lower(concat_ws(' ',trim(p.first_name),trim(p.last_name)))))=1
    GROUP BY p.id,p.first_name,p.last_name HAVING count(c.id) BETWEEN 2 AND 8 ORDER BY p.id LIMIT 1`, [owner.cabinet_id, patientA.id]);
  const longPatients = await fetchRows(`SELECT p.id,concat_ws(' ',p.first_name,p.last_name) AS name,count(c.id)::int AS visits
    FROM app.patients p JOIN app.consultations c ON c.patient_id=p.id
    WHERE p.cabinet_id=$1 AND p.is_synthetic AND p.is_active
    GROUP BY p.id,p.first_name,p.last_name HAVING count(c.id)>=100 ORDER BY p.id`, [owner.cabinet_id]);
  if (!patientB || longPatients.length !== 3) throw new Error('Evaluation patient coverage mismatch');
  const selected = [patientA.id, patientB.id, ...longPatients.map(patient => patient.id)];
  const tableQueries = {
    cabinet: ['SELECT to_jsonb(c) AS item FROM app.cabinets c WHERE c.id=$1', [owner.cabinet_id]],
    profiles: ['SELECT to_jsonb(p) AS item FROM app.profiles p WHERE p.cabinet_id=$1 ORDER BY p.id', [owner.cabinet_id]],
    patients: ['SELECT to_jsonb(p) AS item FROM app.patients p WHERE p.cabinet_id=$1 ORDER BY p.id', [owner.cabinet_id]],
    consultations: ["SELECT to_jsonb(c)-'raw_notes' AS item FROM app.consultations c WHERE c.cabinet_id=$1 ORDER BY c.id", [owner.cabinet_id]],
    selectedConsultations: ['SELECT to_jsonb(c) AS item FROM app.consultations c WHERE c.cabinet_id=$1 AND c.patient_id=ANY($2::uuid[]) ORDER BY c.id', [owner.cabinet_id, selected]],
    selectedNotes: ['SELECT to_jsonb(n) AS item FROM app.clinical_notes n WHERE n.cabinet_id=$1 AND n.patient_id=ANY($2::uuid[]) ORDER BY n.id', [owner.cabinet_id, selected]],
    selectedAmendments: ['SELECT to_jsonb(a) AS item FROM app.clinical_note_amendments a JOIN app.clinical_notes n ON n.id=a.note_id WHERE n.cabinet_id=$1 AND n.patient_id=ANY($2::uuid[]) ORDER BY a.id', [owner.cabinet_id, selected]],
    selectedAnalyses: ['SELECT to_jsonb(a) AS item FROM app.consultation_analyses a WHERE a.cabinet_id=$1 AND a.patient_id=ANY($2::uuid[]) ORDER BY a.id', [owner.cabinet_id, selected]],
    appointments: ['SELECT to_jsonb(a) AS item FROM app.appointments a WHERE a.cabinet_id=$1 ORDER BY a.id', [owner.cabinet_id]],
    payments: ['SELECT to_jsonb(p) AS item FROM app.payments p WHERE p.cabinet_id=$1 ORDER BY p.id', [owner.cabinet_id]],
    charges: ['SELECT to_jsonb(c) AS item FROM app.charges c WHERE c.cabinet_id=$1 ORDER BY c.id', [owner.cabinet_id]],
    treatments: ['SELECT to_jsonb(t) AS item FROM app.patient_treatments t WHERE t.cabinet_id=$1 ORDER BY t.id', [owner.cabinet_id]],
    treatmentHistory: ['SELECT to_jsonb(h) AS item FROM app.patient_treatment_history h JOIN app.patient_treatments t ON t.id=h.treatment_id WHERE t.cabinet_id=$1 ORDER BY h.id', [owner.cabinet_id]],
    diagnoses: ['SELECT to_jsonb(d) AS item FROM app.diagnoses d WHERE d.cabinet_id=$1 ORDER BY d.id', [owner.cabinet_id]],
    scales: ['SELECT to_jsonb(s) AS item FROM app.scales s ORDER BY s.id', []],
    scaleAdministrations: ['SELECT to_jsonb(s) AS item FROM app.scale_administrations s WHERE s.cabinet_id=$1 ORDER BY s.id', [owner.cabinet_id]],
    documents: ['SELECT to_jsonb(d) AS item FROM app.documents d WHERE d.cabinet_id=$1 ORDER BY d.id', [owner.cabinet_id]],
    documentDrafts: ['SELECT to_jsonb(d) AS item FROM app.document_drafts d WHERE d.cabinet_id=$1 ORDER BY d.id', [owner.cabinet_id]],
    medicationCatalog: ["SELECT to_jsonb(m) AS item FROM app.medications m WHERE (m.cabinet_id IS NULL OR m.cabinet_id=$1) AND (lower(concat_ws(' ',m.source_raw_value,m.brand_name,m.inn)) ~ 'zoloft|sertraline' OR m.id IN (SELECT medication_id FROM app.patient_treatments WHERE cabinet_id=$1)) ORDER BY m.id", [owner.cabinet_id]],
  };
  const tables = {};
  for (const [name, [sql, parameters]] of Object.entries(tableQueries)) {
    tables[name] = (await fetchRows(sql, parameters)).map(row => row.item);
  }
  await client.query('COMMIT');
  const snapshot = { version: 1, source, owner, patientA, patientB, longPatients, tables };
  const contents = JSON.stringify(snapshot);
  const sha256 = createHash('sha256').update(contents).digest('hex');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'PASS', source, longPatients: longPatients.length, sha256, output }));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* The connection may not have opened. */ }
  console.error('Evaluation snapshot unavailable:', error instanceof Error ? error.name : 'Error');
  process.exitCode = 1;
} finally {
  await client.end();
}
