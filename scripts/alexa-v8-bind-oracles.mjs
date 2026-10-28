/** Freeze case expectations from the protected, read-only synthetic source snapshot. */
import { createHash } from 'node:crypto';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { bindV8ScenarioOracle } from './lib/alexa-v8-oracle.mjs';
import { validateV8Manifest, validateV8Source } from './lib/alexa-v8-manifest.mjs';

const manifestPath = resolve('tests/eval/alexa-v8-cases.json');
const snapshotPath = resolve('.eval-out/alexa-v8-upgrade/private-oracle-snapshot-v2.json');
const privateOutput = resolve('.eval-out/alexa-v8-upgrade/private-oracles-v3.json');
const snapshotText = await readFile(snapshotPath, 'utf8');
const snapshot = JSON.parse(snapshotText);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const sourceSha256 = createHash('sha256').update(snapshotText).digest('hex');
validateV8Source(snapshot.source);
validateV8Manifest(manifest);

let baselineExists = false;
try { await access(resolve('.eval-out/alexa-v8-upgrade/baseline-40.json')); baselineExists = true; } catch { /* Baseline has not started. */ }
if (baselineExists) throw new Error('Frozen oracle cannot change after baseline begins');
if (!['DRAFT_ORACLES_PENDING', 'FROZEN'].includes(manifest.status)) throw new Error('Campaign must be a draft or a pre-baseline frozen revision');

const privateCases = [];
const failures = [];
for (const scenario of manifest.cases) {
  try {
    const oracle = bindV8ScenarioOracle(scenario, snapshot, sourceSha256);
    if (oracle.assertions.length < 1 || oracle.turnScopes.length !== scenario.turns.length || oracle.turnBindings.length !== scenario.turns.length) throw new Error('Missing source assertion, token binding or turn scope');
    if (oracle.turnStages && oracle.turnStages.length !== scenario.turns.length) throw new Error('Missing per-turn action expectation');
    if (oracle.assertions.every(assertion => assertion.kind === 'source_table')) throw new Error('Only a broad table digest is not a scenario oracle');
    privateCases.push(oracle);
  } catch (error) {
    failures.push({ id: scenario.id, reason: error instanceof Error ? error.message : 'binding_failed' });
  }
  if (privateCases.length + failures.length > 0 && (privateCases.length + failures.length) % 25 === 0) {
    console.error(JSON.stringify({ bindingCases: privateCases.length + failures.length, total: manifest.cases.length }));
  }
}
if (failures.length || privateCases.length !== 200) {
  console.error(JSON.stringify({ status: 'NOT_FROZEN', bound: privateCases.length, failures }));
  process.exitCode = 1;
} else {
  const privatePayload = { version: 3, sourceSha256, source: snapshot.source, cases: privateCases };
  const privateText = JSON.stringify(privatePayload);
  const assertionsById = new Map(privateCases.map(item => [item.id, item.assertions]));
  const publicCases = manifest.cases.map(item => {
    const assertions = assertionsById.get(item.id);
    const reference = createHash('sha256').update(JSON.stringify(assertions)).digest('hex');
    const publicAssertions = item.category === 'patients' && assertions.every(assertion => assertion.kind === 'exact_count')
      ? assertions.map(({ kind, subject, value }) => ({ kind, subject, value }))
      : [{ kind: 'private_oracle_reference', assertionCount: assertions.length, sha256: reference }];
    return { ...item, oracleStatus: 'FROZEN', oracle: { sourceSha256, privateRef: item.id, assertions: publicAssertions } };
  });
  const nextManifest = {
    ...manifest,
    status: 'FROZEN',
    oracleSnapshotSha256: sourceSha256,
    oracleMethod: 'repeatable-read synthetic database snapshot with independent row projections and explicit action effects',
    cases: publicCases,
  };
  const frozen = validateV8Manifest(nextManifest, { requireFrozen: true, snapshotSha256: sourceSha256 });
  await writeFile(privateOutput, privateText, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  const temporary = `${manifestPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(nextManifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, manifestPath);
  console.log(JSON.stringify({ status: 'FROZEN', ...frozen, sourceSha256, privateCaseCount: privateCases.length, boundTokens: privateCases.reduce((count, item) => count + item.turnBindings.reduce((sum, turn) => sum + Object.keys(turn.tokens).length, 0), 0) }));
}
