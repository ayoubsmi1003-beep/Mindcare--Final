/**
 * Derives the C200 ground truth from the disposable SYNTHETIC databases, by SQL, independently of Alexa.
 * The output holds patient identities and expected facts, so it stays in .eval-out/ (git-ignored) and is
 * never given to the assistant under test. Only a manifest with hashes is versioned.
 *
 *   MINDCARE_ALEXA_EVAL_ADMIN_URL=postgres://…/alexa_eval_v8_intelligence_20261027
 *   MINDCARE_ALEXA_FIXTURE_ADMIN_URL=postgres://…/alexa_eval_v9_fixture_20261030   (finance, treatments, next patient)
 *   node tests/eval/alexa-clinical-conversational/v1/generate-oracles.mjs
 *
 * Definitions used (the application's own, never invented here):
 *  - weeks run Monday to Sunday; days and months are civil days in Africa/Algiers;
 *  - an agenda "rendez-vous" is any appointment that is not cancelled;
 *  - finance figures come from app.get_finance_overview (cash basis), called as the owner;
 *  - the next patient comes from app.dashboard_today(day)->suivant;
 *  - a consultation counts when closed, dated by its start.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { dateAlternatives, fold, numberAlternatives, relativeDayAlternatives } from "./evaluate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");
const OWNER = "00000000-0000-0000-0000-0000000000a1";
const MAIN_DB = "alexa_eval_v8_intelligence_20261027", FIXTURE_DB = "alexa_eval_v9_fixture_20261030";
export const DEFAULT_AS_OF = "2026-10-26T09:30:00+01:00";
const TZ = "Africa/Algiers";

// ── Calendar helpers (civil days, Monday-based weeks) ─────────────────────────
const toUtc = (day) => Date.parse(`${day}T00:00:00Z`);
const addDays = (day, n) => new Date(toUtc(day) + n * 86400000).toISOString().slice(0, 10);
const weekday = (day) => (new Date(toUtc(day)).getUTCDay() + 6) % 7;
const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
export function resolveRange(spec, anchorDay) {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(spec)) return { from: spec, to: spec };
  if (/^\d{4}-\d{2}$/u.test(spec)) { const [y, m] = spec.split("-").map(Number); return { from: `${spec}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }; }
  const [y, m] = anchorDay.split("-").map(Number);
  switch (spec) {
    case "today": return { from: anchorDay, to: anchorDay };
    case "tomorrow": return { from: addDays(anchorDay, 1), to: addDays(anchorDay, 1) };
    case "yesterday": return { from: addDays(anchorDay, -1), to: addDays(anchorDay, -1) };
    case "week": { const monday = addDays(anchorDay, -weekday(anchorDay)); return { from: monday, to: addDays(monday, 6) }; }
    case "lastweek": { const monday = addDays(anchorDay, -weekday(anchorDay) - 7); return { from: monday, to: addDays(monday, 6) }; }
    case "month": return resolveRange(`${y}-${String(m).padStart(2, "0")}`, anchorDay);
    case "lastmonth": { const prev = m === 1 ? [y - 1, 12] : [y, m - 1]; return resolveRange(`${prev[0]}-${String(prev[1]).padStart(2, "0")}`, anchorDay); }
    case "year": return { from: `${y}-01-01`, to: `${y}-12-31` };
    default: throw new Error(`unknown range ${spec}`);
  }
}
const timeAlternatives = (hhmm) => { const [h, mm] = hhmm.split(":"); const hh = String(Number(h)); return [`\\b0?${hh} ?: ?${mm}\\b`, `\\b0?${hh} ?h ?${mm === "00" ? "(?:00)?" : mm}\\b`]; };

// ── Database access ────────────────────────────────────────────────────────────
async function connect(url, expectedDb, label) {
  if (!url) return { blocked: `${label}: no admin URL supplied` };
  if (!new RegExp(`/${expectedDb}$`, "u").test(url)) throw new Error(`${label}: refusing a database that is not ${expectedDb}`);
  const client = new pg.Client({ connectionString: url });
  try { await client.connect(); } catch (error) { return { blocked: `${label}: unreachable (${error.message})` }; }
  const synthetic = (await client.query("select count(*) filter (where not is_synthetic)::int bad, count(*)::int n from app.patients")).rows[0];
  if (synthetic.bad !== 0) throw new Error(`${label}: holds non-synthetic patients, refusing`);
  return { client, patients: synthetic.n };
}
async function asOwner(client, sql, params = []) {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [OWNER]);
    return (await client.query(sql, params)).rows;
  } finally { await client.query("rollback"); }
}

// ── Roles ──────────────────────────────────────────────────────────────────────
const UNIQUE = `(select count(*) from app.patients q where lower(q.first_name)=lower(p.first_name))=1
  and (select count(*) from app.patients q where lower(q.last_name)=lower(p.last_name))=1`;
const CONSULTS = "(select count(*) from app.consultations c where c.patient_id=p.id and c.status='closed')";
const FULL_UNIQUE = "(select count(*) from app.patients q where lower(q.first_name)=lower(p.first_name) and lower(q.last_name)=lower(p.last_name))=1";
const pick = async (client, where, limit, order = "md5(p.id::text)", params = []) =>
  (await client.query(`select p.id, p.first_name, p.last_name from app.patients p where ${where} order by ${order} limit ${limit}`, params)).rows;
/** Prefers a patient whose first and last names are both unique, then settles for a unique full name. */
async function pickTiered(client, where, limit, params = [], order = "md5(p.id::text)") {
  const strict = await pick(client, `${where} and ${UNIQUE}`, limit, order, params);
  if (strict.length >= limit) return strict;
  const ids = new Set(strict.map((row) => row.id));
  const loose = (await pick(client, `${where} and ${FULL_UNIQUE}`, limit + strict.length, order, params)).filter((row) => !ids.has(row.id));
  return [...strict, ...loose].slice(0, limit);
}

async function resolveMainRoles(client, anchorTs) {
  const roles = {};
  const put = (prefix, rows) => rows.forEach((row, index) => { roles[`${prefix}${index + 1}`] = row; });
  put("R", await pickTiered(client, `${CONSULTS}>=8`, 6, [], `${CONSULTS} desc, md5(p.id::text)`));
  put("T", await pickTiered(client, `exists(select 1 from app.patient_treatments t where t.patient_id=p.id and t.status='active')`, 5));
  put("N", await pickTiered(client, `not exists(select 1 from app.patient_treatments t where t.patient_id=p.id) and ${CONSULTS}>=20`, 2));
  put("F", await pickTiered(client, `${CONSULTS}=2`, 1));
  put("Z", await pickTiered(client, `${CONSULTS}=0`, 1));
  put("U", await pickTiered(client, `exists(select 1 from app.appointments a where a.patient_id=p.id and a.status='confirmed' and a.starts_at>$1)`, 3, [anchorTs]));
  put("S", await pickTiered(client, `exists(select 1 from app.scale_administrations s where s.patient_id=p.id)`, 1));
  const pairs = (await client.query(`select f from (select lower(first_name) f from app.patients group by 1 having count(*)=2) t order by md5(f)`)).rows;
  const homonyms = [];
  for (const { f } of pairs) {
    const rows = (await client.query(`select p.id, p.first_name, p.last_name from app.patients p where lower(p.first_name)=$1 and ${CONSULTS}>=3`, [f])).rows;
    if (rows.length === 2 && fold(rows[0].last_name) !== fold(rows[1].last_name)) homonyms.push(rows);
    if (homonyms.length === 2) break;
  }
  if (homonyms[0]) { roles.HA = homonyms[0][0]; roles.HB = homonyms[0][1]; }
  if (homonyms[1]) { roles.HC = homonyms[1][0]; roles.HD = homonyms[1][1]; }
  const similar = (await client.query(`select a.id aid, a.first_name af, a.last_name al, b.id bid, b.first_name bf, b.last_name bl
    from app.patients a join app.patients b on a.id<b.id
     and lower(a.first_name||' '||a.last_name)<>lower(b.first_name||' '||b.last_name)
     and similarity(lower(a.first_name||' '||a.last_name), lower(b.first_name||' '||b.last_name))>0.6
    where (select count(*) from app.consultations c where c.patient_id=a.id and c.status='closed')>=3
      and (select count(*) from app.consultations c where c.patient_id=b.id and c.status='closed')>=3
      and (select count(*) from app.patients q where lower(q.first_name||' '||q.last_name)=lower(a.first_name||' '||a.last_name))=1
      and (select count(*) from app.patients q where lower(q.first_name||' '||q.last_name)=lower(b.first_name||' '||b.last_name))=1
      -- not the same words in another order: "A B" and "B A" cannot be told apart, and the application rightly asks which is meant
      and (select array_agg(t order by t) from unnest(string_to_array(lower(a.first_name||' '||a.last_name),' ')) t) <> (select array_agg(t order by t) from unnest(string_to_array(lower(b.first_name||' '||b.last_name),' ')) t)
    order by similarity(lower(a.first_name||' '||a.last_name), lower(b.first_name||' '||b.last_name)) desc, a.id limit 1`)).rows[0];
  if (similar) { roles.SA = { id: similar.aid, first_name: similar.af, last_name: similar.al }; roles.SB = { id: similar.bid, first_name: similar.bf, last_name: similar.bl }; }
  const dup = (await client.query(`select "full" from (select lower(first_name)||' '||lower(last_name) "full" from app.patients group by 1 having count(*)=2) t order by md5("full")`)).rows;
  for (const { full } of dup) {
    const rows = (await client.query(`select p.id, p.first_name, p.last_name from app.patients p where lower(p.first_name)||' '||lower(p.last_name)=$1 and ${CONSULTS}>=5 order by p.id`, [full])).rows;
    if (rows.length === 2) { roles.DA = rows[0]; roles.DB = rows[1]; break; }
  }
  const open = (await client.query(`select c.id cid, p.id, p.first_name, p.last_name from app.consultations c join app.patients p on p.id=c.patient_id where c.status='open' limit 1`)).rows[0];
  if (open) roles.OPEN = { id: open.id, first_name: open.first_name, last_name: open.last_name, openConsultationId: open.cid };
  return roles;
}

async function patientFacts(client, id, anchorTs) {
  const q = async (sql, params) => (await client.query(sql, params)).rows;
  const closed = await q(`select c.id, to_char(c.started_at at time zone '${TZ}','YYYY-MM-DD') d from app.consultations c where c.patient_id=$1 and c.status='closed' order by c.started_at desc, c.id desc`, [id]);
  const treatments = await q(`select m.brand_name, m.inn, t.dose, t.dose_unit from app.patient_treatments t join app.medications m on m.id=t.medication_id where t.patient_id=$1 and t.status='active'`, [id]);
  const changes = await q(`select h.action, h.previous_values, h.new_values, m.brand_name, m.inn from app.patient_treatment_history h join app.patient_treatments t on t.id=h.treatment_id join app.medications m on m.id=t.medication_id where t.patient_id=$1 and h.action<>'started' order by h.occurred_at desc, h.version desc`, [id]);
  const docs = (await q(`select count(*)::int n from app.documents where patient_id=$1`, [id]))[0].n;
  const diag = (await q(`select count(*)::int n from app.diagnoses where patient_id=$1`, [id]))[0].n;
  const scales = await q(`select total_score from app.scale_administrations where patient_id=$1`, [id]);
  const next = (await q(`select to_char(a.starts_at at time zone '${TZ}','YYYY-MM-DD') d, to_char(a.starts_at at time zone '${TZ}','HH24:MI') hm from app.appointments a where a.patient_id=$1 and a.status in ('confirmed','arrived') and a.starts_at>$2 order by a.starts_at limit 1`, [id, anchorTs]))[0] ?? null;
  const note = closed[0] ? (await q(`select subjective, objective, assessment, plan from app.clinical_notes where consultation_id=$1`, [closed[0].id]))[0] ?? null : null;
  return { closed, treatments, changes, docs, diag, scales, next, note };
}

/** Five-word runs of the last note: a verbatim citation of it must contain at least one. */
function shingles(note) {
  if (!note) return [];
  const words = fold(Object.values(note).filter(Boolean).join(" ")).replace(/[^\p{L}\p{N}' ]/gu, " ").split(/\s+/u).filter(Boolean);
  const out = [];
  for (let i = 0; i + 5 <= words.length && out.length < 60; i += 3) out.push(words.slice(i, i + 5).join(" "));
  return out;
}
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const nameRegexes = (role) => {
  const first = fold(role.first_name), last = fold(role.last_name);
  return [escapeRegex(`${first} ${last}`), escapeRegex(`${last} ${first}`)];
};
const drugRegexes = (row) => {
  const names = new Set([row.brand_name, row.inn].filter(Boolean).map(fold));
  for (const name of [...names]) { const head = name.split(" ")[0]; if (head.length >= 5) names.add(head); }
  return [...names].map(escapeRegex);
};

// ── Oracle builders ────────────────────────────────────────────────────────────
function patientOracle(kind, expect, role, facts, anchorDay) {
  const base = { patientId: role.id };
  const last = facts.closed[0]?.d, first = facts.closed.at(-1)?.d;
  const recent = facts.closed.slice(0, 5).map((row) => row.d);
  const datesAny = (days) => days.flatMap((day) => dateAlternatives(day));
  switch (kind) {
    case "summary": case "history": case "evolution": {
      if (!facts.closed.length) return { ...base, emptyState: true };
      const any = [...datesAny(recent), ...numberAlternatives(facts.closed.length), ...facts.treatments.flatMap(drugRegexes)];
      return { ...base, groups: [{ label: `${kind}-fact`, any }] };
    }
    case "count": return facts.closed.length === 0
      ? { ...base, emptyState: true, groups: [{ label: "zero-count", any: [...numberAlternatives(0), "\\baucune?\\b", "\\bjamais\\b", "\\bpas encore\\b"] }] }
      : { ...base, groups: [{ label: "count", any: numberAlternatives(facts.closed.length) }] };
    case "lastdate": return last ? { ...base, groups: [{ label: "last-date", any: dateAlternatives(last) }] } : { ...base, emptyState: true };
    case "firstdate": return first ? { ...base, groups: [{ label: "first-date", any: dateAlternatives(first) }] } : { ...base, emptyState: true };
    case "prev": {
      const n = expect.n ?? 3, days = facts.closed.slice(0, n).map((row) => row.d);
      return days.length ? { ...base, groups: days.map((day, index) => ({ label: `date-${index + 1}`, any: dateAlternatives(day) })) } : { ...base, emptyState: true };
    }
    case "lastnote": {
      if (!last) return { ...base, emptyState: true };
      const runs = shingles(facts.note);
      return { ...base, groups: [{ label: "last-date", any: dateAlternatives(last) }, ...(runs.length ? [{ label: "note-content", any: runs.map(escapeRegex) }] : [])] };
    }
    case "treat": {
      if (!facts.treatments.length) return { ...base, emptyState: true };
      return { ...base, groups: facts.treatments.flatMap((row, index) => [
        { label: `drug-${index + 1}`, any: drugRegexes(row) },
        ...(row.dose ? [{ label: `dose-${index + 1}`, any: numberAlternatives(String(row.dose).replace(/[^\d.]/gu, "") || "0") }] : [])]) };
    }
    case "prevtreat": {
      // The previous state of the latest recorded change, e.g. the dose before a dose change.
      const change = facts.changes.find((row) => row.action === "dose_changed" && row.previous_values?.dose);
      if (!facts.changes.length) return { ...base, emptyState: true };
      if (!change) return { ...base, notVerified: "treatment-history-wording-not-modelled" };
      return { ...base, groups: [{ label: "previous-dose", any: numberAlternatives(String(change.previous_values.dose).replace(/[^\d.]/gu, "") || "0") }, { label: "drug", any: drugRegexes(change) }] };
    }
    case "nextappt": return facts.next
      ? { ...base, groups: [{ label: "next-date", any: [...dateAlternatives(facts.next.d), ...relativeDayAlternatives(facts.next.d, anchorDay)] }] }
      : { ...base, emptyState: true };
    case "documents": return facts.docs ? { ...base, groups: [{ label: "documents", any: numberAlternatives(facts.docs) }] } : { ...base, emptyState: true };
    case "diag": return facts.diag ? { ...base, notVerified: "diagnosis-wording-not-modelled" } : { ...base, emptyState: true };
    case "scales": return facts.scales.length
      ? { ...base, groups: [{ label: "score", any: facts.scales.flatMap((row) => numberAlternatives(row.total_score)) }] }
      : { ...base, emptyState: true };
    case "who": return { ...base, groups: [{ label: "identity", any: [escapeRegex(fold(role.first_name)), escapeRegex(fold(role.last_name))] }] };
    default: throw new Error(`unknown patient kind ${kind}`);
  }
}

async function agendaRows(client, from, to, extra = "") {
  return (await client.query(`select to_char(a.starts_at at time zone '${TZ}','YYYY-MM-DD') d, to_char(a.starts_at at time zone '${TZ}','HH24:MI') hm, a.status,
      p.first_name, p.last_name, p.id patient_id
    from app.appointments a left join app.patients p on p.id=a.patient_id
    where (a.starts_at at time zone '${TZ}')::date between $1::date and $2::date ${extra} order by a.starts_at`, [from, to])).rows;
}
const partOf = (hm) => (Number(hm.slice(0, 2)) < 12 ? "am" : "pm");
const fullNames = (row) => [escapeRegex(fold(`${row.first_name} ${row.last_name}`)), escapeRegex(fold(`${row.last_name} ${row.first_name}`))];

async function agendaOracle(client, expect, anchorDay, anchorTs) {
  const range = expect.range ?? expect.day;
  const { from, to } = range ? resolveRange(range, anchorDay) : { from: anchorDay, to: anchorDay };
  const live = (await agendaRows(client, from, to, "and a.status<>'cancelled'"));
  switch (expect.k) {
    case "a_count": {
      const rows = expect.status ? live.filter((row) => row.status === expect.status) : live;
      return { groups: [{ label: "appointment-count", any: numberAlternatives(rows.length) }], noPatientRead: true };
    }
    case "a_list": return live.length
      ? { groups: live.map((row, index) => ({ label: `appointment-${index + 1}`, any: fullNames(row) })), noPatientRead: true }
      : { emptyState: true, noPatientRead: true };
    case "a_first": case "a_last": {
      const row = expect.k === "a_first" ? live[0] : live.at(-1);
      return row ? { groups: [{ label: "name", any: fullNames(row) }, { label: "time", any: timeAlternatives(row.hm) }], noPatientRead: true } : { emptyState: true };
    }
    case "a_next": {
      const upcoming = (await client.query(`select to_char(a.starts_at at time zone '${TZ}','YYYY-MM-DD') d, to_char(a.starts_at at time zone '${TZ}','HH24:MI') hm, p.first_name, p.last_name
        from app.appointments a left join app.patients p on p.id=a.patient_id where a.starts_at>$1 and a.status in ('confirmed','arrived','requested') order by a.starts_at limit 1`, [anchorTs])).rows[0];
      return upcoming ? { groups: [{ label: "name", any: fullNames(upcoming) }, { label: "time", any: timeAlternatives(upcoming.hm) }], noPatientRead: true } : { emptyState: true };
    }
    case "a_daypart": {
      const rows = live.filter((row) => partOf(row.hm) === expect.part);
      return rows.length ? { groups: [{ label: "daypart-count", any: numberAlternatives(rows.length) }], noPatientRead: true } : { emptyState: true, noPatientRead: true };
    }
    case "a_cancelled": {
      const rows = await agendaRows(client, from, to, "and a.status='cancelled'");
      return rows.length ? { groups: rows.map((row, index) => ({ label: `cancelled-${index + 1}`, any: fullNames(row) })), noPatientRead: true } : { emptyState: true, noPatientRead: true };
    }
    case "a_free": {
      // The application has no opening hours, so a free slot cannot be derived. A honest answer shows what is booked,
      // or says that it cannot tell; it never claims the doctor is free when the part of the day holds appointments.
      const rows = live.filter((row) => partOf(row.hm) === expect.part);
      const any = [...numberAlternatives(rows.length), ...rows.flatMap((row) => timeAlternatives(row.hm)), "\\bhoraires?\\b", "\\bne (?:peux|sais|puis)\\b", "\\bdisponibilit"];
      return { groups: [{ label: "booked-or-honest", any }], forbid: ["\\bvous etes libre\\b", "\\bvous n'avez aucun rendez-vous\\b"], noPatientRead: true };
    }
    default: throw new Error(`unknown agenda kind ${expect.k}`);
  }
}

async function financeOracle(client, expect, anchorDay) {
  const gate = async (from, to) => (await asOwner(client, "select app.get_finance_overview($1::date,$2::date) o", [from, to]))[0].o.pulse;
  const money = (value) => numberAlternatives(Math.abs(value));
  const range = (spec) => resolveRange(spec, anchorDay);
  switch (expect.k) {
    case "f_revenue": case "f_cash": { const r = range(expect.range), p = await gate(r.from, r.to); return { groups: [{ label: "revenue", any: money(p.revenu_periode) }], noPatientRead: true, ...(p.revenu_periode === 0 ? { groups: [{ label: "revenue-zero", any: [...money(0), "\\baucun\\w*", "\\brien\\b"] }] } : {}) }; }
    case "f_expenses": { const r = range(expect.range), p = await gate(r.from, r.to); return { groups: [{ label: "expenses", any: money(p.charges_periode) }], noPatientRead: true }; }
    case "f_net": { const r = range(expect.range), p = await gate(r.from, r.to); return { groups: [{ label: "net-result", any: money(p.resultat_net_periode) }], noPatientRead: true }; }
    case "f_sessions": { const r = range(expect.range), p = await gate(r.from, r.to); return { groups: [{ label: "sessions", any: numberAlternatives(p.nb_seances_periode) }], noPatientRead: true }; }
    case "f_outstanding": { const r = range(expect.range), p = await gate(r.from, r.to); return p.impayes_total === 0 ? { emptyState: true, noPatientRead: true } : { groups: [{ label: "outstanding", any: money(p.impayes_total) }], noPatientRead: true }; }
    case "f_other_methods": return { groups: [{ label: "cash-only-stated", any: ["\\besp[eè]ces\\b", "\\bcash\\b", "\\baucun autre\\b", "\\bpas d'autre\\b", "\\bseul\\w*\\b", "\\bmode\\w* de paiement\\b"] }], noPatientRead: true };
    case "f_compare": {
      const a = range(expect.a), b = range(expect.b), pa = await gate(a.from, a.to), pb = await gate(b.from, b.to);
      return { groups: [{ label: "first-period-revenue", any: money(pa.revenu_periode) }, { label: "second-period-revenue", any: [...money(pb.revenu_periode), "\\baucun\\w*", "\\bzero\\b"] }], noPatientRead: true };
    }
    case "f_overview": { const r = range(expect.range), p = await gate(r.from, r.to); return { groups: [{ label: "any-key-figure", any: [...money(p.revenu_periode), ...money(p.charges_periode), ...money(p.resultat_net_periode), ...money(p.impayes_total)] }], noPatientRead: true }; }
    default: throw new Error(`unknown finance kind ${expect.k}`);
  }
}

async function activityOracle(client, expect, anchorDay) {
  const r = expect.range ? resolveRange(expect.range, anchorDay) : null;
  const between = (col) => `(${col} at time zone '${TZ}')::date between $1::date and $2::date`;
  const one = async (sql) => (await client.query(sql, [r?.from, r?.to])).rows[0];
  switch (expect.k) {
    case "n_consults": return { groups: [{ label: "consultations", any: numberAlternatives((await one(`select count(*)::int n from app.consultations where status='closed' and ${between("started_at")}`)).n) }], noPatientRead: true };
    case "n_patients_seen": return { groups: [{ label: "patients-seen", any: numberAlternatives((await one(`select count(distinct patient_id)::int n from app.consultations where status='closed' and ${between("started_at")}`)).n) }], noPatientRead: true };
    case "n_new": return { groups: [{ label: "new-patients", any: numberAlternatives((await one(`select count(*)::int n from app.patients where ${between("created_at")}`)).n) }], noPatientRead: true };
    case "n_active_patients": return { groups: [{ label: "active-patients", any: numberAlternatives((await client.query("select count(*)::int n from app.patients where is_active").then((x) => x.rows[0].n))) }], noPatientRead: true };
    case "n_busiest": {
      const rows = (await client.query(`select ((extract(isodow from started_at at time zone '${TZ}'))::int-1) wd, count(*)::int n from app.consultations where status='closed' and ${between("started_at")} group by 1 order by 2 desc`, [r.from, r.to])).rows;
      const top = rows.filter((row) => row.n === rows[0]?.n).map((row) => WEEKDAYS[row.wd]);
      return top.length ? { groups: [{ label: "busiest-weekday", any: top.map((name) => `\\b${name}s?\\b`) }], noPatientRead: true, notes: `tied maxima: ${top.join(",")}` } : { emptyState: true };
    }
    case "n_compare": {
      const a = resolveRange(expect.a, anchorDay), b = resolveRange(expect.b, anchorDay);
      const count = async (x) => (await client.query(`select count(*)::int n from app.consultations where status='closed' and (started_at at time zone '${TZ}')::date between $1::date and $2::date`, [x.from, x.to])).rows[0].n;
      return { groups: [{ label: "first-period", any: numberAlternatives(await count(a)) }, { label: "second-period", any: numberAlternatives(await count(b)) }], noPatientRead: true };
    }
    case "n_overview": {
      const consults = (await one(`select count(*)::int n from app.consultations where status='closed' and ${between("started_at")}`)).n;
      const seen = (await one(`select count(distinct patient_id)::int n from app.consultations where status='closed' and ${between("started_at")}`)).n;
      return { groups: [{ label: "any-activity-figure", any: [...numberAlternatives(consults), ...numberAlternatives(seen)] }], noPatientRead: true };
    }
    default: throw new Error(`unknown activity kind ${expect.k}`);
  }
}

async function bookOracle(client, alts) {
  const checked = [];
  for (const alt of alts) {
    const params = [], conds = ["s.statut='active'"];
    if (alt.sourceLike) { params.push(`%${alt.sourceLike}%`); conds.push(`s.titre ILIKE $${params.length}`); }
    for (const part of alt.sectionAll ?? []) { params.push(`%${part}%`); conds.push(`unaccent(c.section) ILIKE unaccent($${params.length})`); }
    for (const part of alt.textAll ?? []) { params.push(`%${part}%`); conds.push(`unaccent(c.texte) ILIKE unaccent($${params.length})`); }
    const n = (await client.query(`select count(*)::int n from app.knowledge_chunks c join app.knowledge_sources s on s.id=c.source_id where ${conds.join(" and ")}`, params)).rows[0].n;
    checked.push({ ...alt, chunks: n });
  }
  const usable = checked.filter((alt) => alt.chunks > 0);
  return usable.length ? { book: { alts: usable.map(({ chunks, ...alt }) => alt) }, noPatientRead: true } : { book: { alts: [] }, notVerified: "no-approved-passage-matches-the-expectation" };
}

// ── Main ───────────────────────────────────────────────────────────────────────
export async function generate({ mainUrl, fixtureUrl }) {
  const spec = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));
  const main = await connect(mainUrl, MAIN_DB, "main");
  const fixture = await connect(fixtureUrl, FIXTURE_DB, "fixture");
  const databases = { main: main.blocked ? { blocked: main.blocked } : { patients: main.patients }, fixture: fixture.blocked ? { blocked: fixture.blocked } : { patients: fixture.patients } };
  const anchorTs = DEFAULT_AS_OF;
  const roles = { main: main.client ? await resolveMainRoles(main.client, anchorTs) : {}, fixture: {} };
  if (fixture.client) {
    // The next-patient read asks the gate for the REAL current day of the cabinet (it does not take the campaign's anchor), and the
    // gate itself compares with the database clock: the truth is computed the same way, on the day the campaign runs.
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
    const next = (await asOwner(fixture.client, "select app.dashboard_today($1::date)->'suivant' s", [day]))[0].s;
    if (next?.patient_id) {
      const row = (await fixture.client.query("select id, first_name, last_name from app.patients where id=$1", [next.patient_id])).rows[0];
      roles.fixture.NP1 = row;
    }
  }
  const consultationIds = {};
  for (const [db, handle] of [["main", main], ["fixture", fixture]]) {
    consultationIds[db] = {};
    if (!handle.client) continue;
    for (const [role, row] of Object.entries(roles[db])) {
      const last = (await handle.client.query("select id from app.consultations where patient_id=$1 order by started_at desc, id desc limit 1", [row.id])).rows[0];
      if (last) consultationIds[db][role] = last.id;
    }
  }
  const factCache = new Map();
  const factsFor = async (db, role) => {
    const key = `${db}:${role.id}`;
    if (!factCache.has(key)) factCache.set(key, await patientFacts((db === "main" ? main : fixture).client, role.id, anchorTs));
    return factCache.get(key);
  };
  const oracles = {};
  for (const item of spec.cases) {
    const handle = item.db === "main" ? main : fixture;
    const anchor = item.asOf ?? DEFAULT_AS_OF;
    const anchorDay = anchor.slice(0, 10);
    oracles[item.id] = [];
    for (const turn of item.turns) {
      const expect = turn.expect;
      let oracle;
      try {
        if (!handle.client) oracle = { blocked: handle.blocked };
        else if (expect.k === "clarify") oracle = { clarify: true, decoyPatientIds: (expect.decoys ?? []).map((name) => roles[item.db][name]?.id).filter(Boolean) };
        else if (expect.k === "plain") oracle = { noPatientRead: !!expect.noPatientRead };
        else if (expect.k === "nextpatient") {
          const role = roles[item.db].NP1;
          oracle = role ? { patientId: role.id, groups: [{ label: "next-patient-name", any: [escapeRegex(fold(role.first_name)), escapeRegex(fold(role.last_name))] }] } : { notVerified: "no-next-patient-in-fixture-agenda" };
        } else if (expect.r) {
          const role = roles[item.db][expect.r];
          oracle = role ? patientOracle(expect.k, expect, role, await factsFor(item.db, role), anchorDay) : { blocked: `role-unresolved:${expect.r}` };
        } else if (expect.k.startsWith("a_")) oracle = await agendaOracle(handle.client, expect, anchorDay, anchor);
        else if (expect.k.startsWith("f_")) oracle = await financeOracle(handle.client, expect, anchorDay);
        else if (expect.k.startsWith("n_")) oracle = await activityOracle(handle.client, expect, anchorDay);
        else if (expect.k === "book") oracle = await bookOracle(handle.client, expect.alts);
        else throw new Error(`unknown kind ${expect.k}`);
      } catch (error) { oracle = { blocked: `oracle-error:${String(error.message).slice(0, 120)}` }; }
      const decoys = (expect.decoys ?? []).map((name) => roles[item.db][name]).filter(Boolean);
      if (decoys.length && !oracle.clarify) { oracle.decoyPatientIds = decoys.map((row) => row.id); oracle.decoyNames = decoys.map((row) => `${row.first_name} ${row.last_name}`); }
      oracles[item.id].push(oracle);
    }
  }
  for (const handle of [main, fixture]) await handle.client?.end();
  return { roles, consultationIds, oracles, databases, anchor: DEFAULT_AS_OF };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await generate({ mainUrl: process.env.MINDCARE_ALEXA_EVAL_ADMIN_URL, fixtureUrl: process.env.MINDCARE_ALEXA_FIXTURE_ADMIN_URL });
  const outDir = join(root, ".eval-out", "alexa-c200");
  mkdirSync(outDir, { recursive: true });
  const body = JSON.stringify(result);
  writeFileSync(join(outDir, "private-oracles.json"), body);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const flat = Object.values(result.oracles).flat();
  const manifest = {
    campaign: "C200", casesSha256: sha(readFileSync(join(here, "cases.json"))), oraclesSha256: sha(body),
    databases: result.databases, anchor: result.anchor,
    rolesResolved: Object.fromEntries(Object.entries(result.roles).map(([db, roles]) => [db, Object.keys(roles).sort()])),
    turns: flat.length, blocked: flat.filter((o) => o.blocked).length, notVerified: flat.filter((o) => o.notVerified).length,
    note: "Hashes only. The oracle file holds patient identities and stays in .eval-out/ (git-ignored).",
  };
  writeFileSync(join(here, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  console.log(JSON.stringify(manifest, null, 1));
}
