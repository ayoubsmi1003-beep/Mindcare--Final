/**
 * Controls the clock of the "next patient" cases. The agenda gate (`app.dashboard_today`) compares with the database clock, which an
 * evaluation cannot move; so the disposable SYNTHETIC finance fixture is given one confirmed appointment later today (23:50,
 * Africa/Algiers), for a synthetic patient. The next patient is then defined whatever the hour of the run (before 23:50), and the oracle
 * reads the same gate the same minute. The row is the campaign's own marker (fixed id); a rerun moves it to the current day.
 * It touches nothing but the fixture database, refuses any other, and never runs against real data.
 *   MINDCARE_ALEXA_FIXTURE_ADMIN_URL=postgres://…/alexa_eval_v9_fixture_20261030 node …/prepare-clock.mjs
 */
import pg from "pg";

const FIXTURE_DB = "alexa_eval_v9_fixture_20261030";
const MARKER = "f7000000-0000-4000-8000-00000000c201";
const url = process.env.MINDCARE_ALEXA_FIXTURE_ADMIN_URL ?? "";
if (!url.endsWith(`/${FIXTURE_DB}`)) { console.error(`refusing: not the ${FIXTURE_DB} database`); process.exit(2); }
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const bad = (await client.query("select count(*) filter (where not is_synthetic)::int bad from app.patients")).rows[0].bad;
  if (bad !== 0) throw new Error("the database holds non-synthetic patients");
  const model = (await client.query("select cabinet_id, practitioner_id, source, created_by, patient_id from app.appointments where status='confirmed' and is_synthetic order by starts_at desc limit 1")).rows[0];
  if (!model) throw new Error("no synthetic appointment to copy the cabinet and practitioner from");
  const slot = "((now() at time zone 'Africa/Algiers')::date + time '23:50') at time zone 'Africa/Algiers'";
  const done = await client.query(
    `insert into app.appointments (id, cabinet_id, practitioner_id, patient_id, starts_at, ends_at, status, source, created_by, is_synthetic, kind)
     values ($1,$2,$3,$4, ${slot}, (${slot}) + interval '30 minutes', 'confirmed', $5, $6, true, 'suivi')
     on conflict (id) do update set starts_at=excluded.starts_at, ends_at=excluded.ends_at, status='confirmed', patient_id=excluded.patient_id
     returning to_char(starts_at at time zone 'Africa/Algiers','YYYY-MM-DD HH24:MI') slot`,
    [MARKER, model.cabinet_id, model.practitioner_id, model.patient_id, model.source, model.created_by]);
  console.log(`clock appointment ready at ${done.rows[0].slot} (Africa/Algiers)`);
} finally { await client.end(); }
