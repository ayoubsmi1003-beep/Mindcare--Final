#!/usr/bin/env node
/**
 * Action-gate acceptance on the disposable synthetic action database.
 *
 * Proposes a real appointment through app.propose_jarvis_action, confirms it,
 * executes it through app.execute_jarvis_action, verifies the row and audit
 * evidence, then rolls the whole transaction back. No real clinic data and no
 * persistent mutation.
 */
import pg from "pg";

const { Client } = pg;
const url = process.env["MINDCARE_ALEXA_ACTION_DB_URL"];
if (!url) throw new Error("MINDCARE_ALEXA_ACTION_DB_URL is required");
if (!/alexa_eval_v9_actions_20261031/u.test(url)) throw new Error("Action acceptance must target the disposable V9 action database");

const owner = "00000000-0000-0000-0000-0000000000a1";
const patient = "00bf14b3-3774-4bc4-a04f-609798b92b8d";
const actionId = "00000000-0000-4000-8000-0000000000b9";
const conversationId = "22d6648c-1bc2-4f4c-8b5c-ae22993a6188";
const startsAt = "2026-11-04T10:00:00+01:00";
const args = {
  patient_id: patient,
  practitioner_id: owner,
  starts_at: startsAt,
  duration_minutes: 30,
  notes_admin: null,
  kind: "suivi",
};
const checks = [];
const check = (id, passed, detail) => checks.push({ id, status: passed ? "PASS" : "FAIL", ...(detail === undefined ? {} : { detail }) });

const client = new Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [owner]);

  const before = await client.query("SELECT count(*)::int AS n FROM app.appointments WHERE patient_id=$1", [patient]);
  const unrelatedBefore = await client.query("SELECT count(*)::int AS n FROM app.appointments WHERE patient_id<>$1", [patient]);
  const auditBefore = await client.query("SELECT count(*)::int AS n FROM audit.log WHERE patient_id=$1 AND table_name='appointments'", [patient]);

  const proposed = await client.query(
    "SELECT app.propose_jarvis_action($1::uuid,$2,$3,$4::jsonb,$5::uuid) AS id",
    [conversationId, "Ajoute pour ce patient une consultation le 4 novembre 2026 à 10 h, durée 30 minutes.", "create_appointment", JSON.stringify(args), actionId],
  );
  check("proposal-created", proposed.rows[0]?.id === actionId, proposed.rows[0]?.id);

  const confirmed = await client.query("SELECT app.confirm_jarvis_action($1::uuid) AS at", [actionId]);
  check("proposal-confirmed", confirmed.rows[0]?.at instanceof Date, confirmed.rows[0]?.at?.toISOString?.());

  const executed = await client.query("SELECT app.execute_jarvis_action($1::uuid) AS id", [actionId]);
  const affected = executed.rows[0]?.id;
  check("proposal-executed", typeof affected === "string" && /^[0-9a-f-]{36}$/u.test(affected), affected);

  const state = await client.query("SELECT state, affected_id, confirmed_at FROM app.jarvis_actions WHERE id=$1", [actionId]);
  check("state-executed", state.rows[0]?.state === "executed" && state.rows[0]?.affected_id === affected, state.rows[0]);

  const after = await client.query("SELECT count(*)::int AS n FROM app.appointments WHERE patient_id=$1", [patient]);
  check("appointment-created", after.rows[0]?.n === before.rows[0]?.n + 1, { before: before.rows[0]?.n, after: after.rows[0]?.n });

  const row = await client.query("SELECT id, patient_id, starts_at, ends_at, status, kind FROM app.appointments WHERE id=$1", [affected]);
  check("appointment-readback", row.rows[0]?.patient_id === patient && new Date(row.rows[0]?.starts_at).toISOString() === new Date(startsAt).toISOString(), row.rows[0]);

  const unrelatedAfter = await client.query("SELECT count(*)::int AS n FROM app.appointments WHERE patient_id<>$1", [patient]);
  check("unrelated-unchanged", unrelatedAfter.rows[0]?.n === unrelatedBefore.rows[0]?.n, { before: unrelatedBefore.rows[0]?.n, after: unrelatedAfter.rows[0]?.n });

  const auditAfter = await client.query("SELECT count(*)::int AS n FROM audit.log WHERE patient_id=$1 AND table_name='appointments' AND row_id=$2", [patient, affected]);
  check("audit-present", auditAfter.rows[0]?.n === 1, { before: auditBefore.rows[0]?.n, after: auditAfter.rows[0]?.n });

  const rescheduleId = "00000000-0000-4000-8000-0000000000ba";
  const rescheduleArgs = { appointment_id: affected, nouveau_debut: "2026-11-05T11:00:00+01:00", nouvelle_duree_minutes: 30 };
  const rescheduled = await client.query(
    "SELECT app.propose_jarvis_action($1::uuid,$2,$3,$4::jsonb,$5::uuid) AS id",
    [conversationId, "Décale ce rendez-vous au 5 novembre 2026 à 11 h.", "reschedule_appointment", JSON.stringify(rescheduleArgs), rescheduleId],
  );
  check("reschedule-proposed", rescheduled.rows[0]?.id === rescheduleId, rescheduled.rows[0]?.id);
  const rescheduleConfirmed = await client.query("SELECT app.confirm_jarvis_action($1::uuid) AS at", [rescheduleId]);
  check("reschedule-confirmed", rescheduleConfirmed.rows[0]?.at instanceof Date);
  const rescheduleExecuted = await client.query("SELECT app.execute_jarvis_action($1::uuid) AS id", [rescheduleId]);
  check("reschedule-executed", rescheduleExecuted.rows[0]?.id === affected, rescheduleExecuted.rows[0]?.id);
  const moved = await client.query("SELECT starts_at FROM app.appointments WHERE id=$1", [affected]);
  check("reschedule-readback", new Date(moved.rows[0]?.starts_at).toISOString() === new Date(rescheduleArgs.nouveau_debut).toISOString(), moved.rows[0]);
  const auditMoved = await client.query("SELECT count(*)::int AS n FROM audit.log WHERE patient_id=$1 AND table_name='appointments' AND row_id=$2", [patient, affected]);
  check("reschedule-audit", auditMoved.rows[0]?.n >= 2, { after: auditMoved.rows[0]?.n });

  await client.query("ROLLBACK");
  const restored = await client.query("SELECT count(*)::int AS n FROM app.appointments WHERE patient_id=$1", [patient]);
  check("rollback-restores-baseline", restored.rows[0]?.n === before.rows[0]?.n, { expected: before.rows[0]?.n, actual: restored.rows[0]?.n });

  const failed = checks.filter(item => item.status === "FAIL");
  console.log(JSON.stringify({ status: failed.length ? "FAIL" : "PASS", checks, failed: failed.map(item => item.id) }, null, 2));
  if (failed.length) process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
