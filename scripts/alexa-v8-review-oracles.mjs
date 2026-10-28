/** Create an immutable, corrected oracle revision from the same source snapshot. */
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bindV8ScenarioOracle } from './lib/alexa-v8-oracle.mjs';
import { validateV8Manifest, validateV8Source } from './lib/alexa-v8-manifest.mjs';

const asOf = process.env.ALEXA_V8_ORACLE_AS_OF ?? '';
if (!/^\d{4}-\d{2}-\d{2}$/u.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
  throw new Error('Set ALEXA_V8_ORACLE_AS_OF to the evaluation date in Africa/Algiers');
}
const root = resolve('.eval-out/alexa-v8-upgrade');
const manifestText = await readFile('tests/eval/alexa-v8-cases.json', 'utf8');
const snapshotText = await readFile(resolve(root, 'private-oracle-snapshot-v2.json'), 'utf8');
const priorText = await readFile(resolve(root, 'private-oracles-v3.json'), 'utf8');
const manifest = JSON.parse(manifestText);
const snapshot = { ...JSON.parse(snapshotText), fixtureAsOf: asOf };
const prior = JSON.parse(priorText);
const snapshotSha256 = createHash('sha256').update(snapshotText).digest('hex');
const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const outputPath = resolve(root, 'private-oracles-v4.json');
const reviewPath = resolve(root, 'oracle-review-v4.json');
for (const path of [outputPath, reviewPath]) {
  try { await access(path); throw new Error('Oracle review v4 already exists; refusing to overwrite evidence'); }
  catch (error) { if (error instanceof Error && error.message.includes('refusing')) throw error; }
}

validateV8Source(snapshot.source);
validateV8Manifest(manifest, { requireFrozen: true, snapshotSha256 });
if (prior.sourceSha256 !== snapshotSha256 || prior.cases.length !== 200) throw new Error('Prior frozen oracle does not match the source snapshot');

const priorById = new Map(prior.cases.map(item => [item.id, item]));
const correctedCases = [];
const corrections = [];
const allowedChangedKeys = new Set([
  'agenda_then_status_filter', 'agenda_tomorrow_to_next_day', 'agenda_period_correction',
  'tomorrow_morning_appointments', 'tomorrow_afternoon_appointments', 'patient_a_next_appointment',
  'cabinet_next_appointment_time', 'today_cancelled_appointments', 'today_arrived_count',
  'tomorrow_confirmed_appointments', 'patient_b_this_week_appointments', 'local_date_algiers',
  'clinical_and_agenda_compound', 'count_time_agenda',
  'finance_net_to_charges', 'current_month_net', 'current_month_charges',
  'current_month_charge_categories', 'october_largest_charge_category',
  'active_child_count', 'active_adult_count', 'active_adult_missing_phone_count',
  'active_child_missing_identity_count', 'active_unknown_age_count',
]);
for (const scenario of manifest.cases) {
  const corrected = bindV8ScenarioOracle(scenario, snapshot, snapshotSha256);
  const previous = priorById.get(scenario.id);
  if (!previous || corrected.assertions.length < 1) throw new Error(`Missing source oracle for ${scenario.id}`);
  if (canonical(corrected.assertions) !== canonical(previous.assertions)) {
    if (!allowedChangedKeys.has(scenario.oracleKey)) throw new Error(`Unexpected oracle change for ${scenario.id} (${scenario.oracleKey})`);
    corrections.push({
      id: scenario.id,
      oracleKey: scenario.oracleKey,
      previousAssertionSha256: sha256(previous.assertions),
      correctedAssertionSha256: sha256(corrected.assertions),
      reason: scenario.category === 'finance' || scenario.oracleKey === 'finance_net_to_charges'
        ? 'Apply the active recurring-charge proration and monthly-equivalent rules in migrations 039 and 180.'
        : `Anchor relative dates to ${asOf} in Africa/Algiers, matching the live run date.`,
    });
  }
  correctedCases.push(corrected);
}

const output = {
  version: 4,
  supersedes: 'private-oracles-v3.json',
  fixtureAsOf: asOf,
  sourceSha256: snapshotSha256,
  source: snapshot.source,
  cases: correctedCases,
};
const outputText = JSON.stringify(output);
const review = {
  version: 1,
  status: 'INDEPENDENT_CORRECTION_REVIEW',
  fixtureAsOf: asOf,
  sourceSha256: snapshotSha256,
  priorOracleSha256: createHash('sha256').update(priorText).digest('hex'),
  correctedOracleSha256: createHash('sha256').update(outputText).digest('hex'),
  correctionCount: corrections.length,
  corrections,
  basis: [
    'The source snapshot is unchanged and remains the verified synthetic database snapshot.',
    'The evaluation date is recorded separately from the clinical and administrative source rows.',
    'Recurring charges are normalized by month frequency and prorated after their start date, per app.charge_equivalent_mensuel and app.charges_sur_periode.',
    'The prior oracle v3 and its baseline reports remain intact for audit.',
  ],
};
await writeFile(outputPath, outputText, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ status: 'PASS', asOf, cases: correctedCases.length, correctionCount: corrections.length, corrections, oracleSha256: review.correctedOracleSha256, outputPath, reviewPath }));
