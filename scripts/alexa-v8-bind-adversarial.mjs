import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveV8AdversarialPromptTurns, validateV8AdversarialManifest } from './lib/alexa-v8-adversarial.mjs';

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const artifactPath = path.join(repoRoot, '.eval-out', 'alexa-v8-upgrade', 'adversarial-oracle-binding-v2.json');
const knowledgeDirectory = path.join(repoRoot, 'tests', 'eval');
const scenarioHashFields = Object.freeze(['id', 'language', 'category', 'intent', 'turns', 'tags']);
const sourceMetadataFields = Object.freeze([
  'database', 'patients', 'consultations', 'nonSynthetic', 'snapshotSha256', 'privateOracleSha256',
]);
const historicalEvidenceFields = Object.freeze([
  'databaseMigrationReportedByPriorAudit', 'currentDatabaseMigration', 'currentAppliedMigrationCount',
  'migrationVerificationStatus', 'migrationVerifiedAtUtc', 'migrationEvidenceSha256',
  'repositoryMigrationSqlFiles', 'highestRepositoryMigrationFile',
  'trackedRepositoryMigrationSqlFiles', 'highestTrackedRepositoryMigrationFile',
  'untrackedRepositoryMigrationFiles', 'repositoryMigrationInventorySha256',
  'migrationRegistryAlignmentStatus', 'missingRepositoryMigrationVersions',
  'migrationAlignmentEvidenceSha256', 'migrationAlignmentVerifiedAtUtc', 'fullSchemaAlignmentStatus',
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hash(value) {
  const input = Buffer.isBuffer(value) || value instanceof Uint8Array ? value : canonicalJson(value);
  return createHash('sha256').update(input).digest('hex');
}

function project(value, fields) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}

function indexById(values, label) {
  const indexed = new Map();
  for (const value of values ?? []) {
    if (!value || typeof value.id !== 'string' || indexed.has(value.id)) {
      throw new Error(`Invalid or duplicate ${label} source id`);
    }
    indexed.set(value.id, value);
  }
  return indexed;
}

function workingTreeSha256() {
  const diff = execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: repoRoot, encoding: 'buffer' });
  const paths = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).split('\0').filter(Boolean).sort();
  const untracked = paths.map(file => [file, hash(readFileSync(path.resolve(repoRoot, file)))]);
  return hash(JSON.stringify({ diff: hash(diff), untracked }));
}

function resolveKnowledgeFiles(manifest) {
  return [...new Set(manifest.cases.flatMap(item => item.oracles
    .filter(oracle => oracle.kind === 'knowledge_case')
    .map(oracle => oracle.sourceFile)))].sort();
}

function bindOracle({ scenario, oracle, index, frozenCases, knowledgeCaseSets }) {
  const sourcePrefix = `tests/eval/alexa-v8-cases.json`;
  if (oracle.kind === 'knowledge_case') {
    const source = knowledgeCaseSets.get(oracle.sourceFile)?.get(oracle.caseId);
    if (!source) throw new Error(`Missing knowledge source ${oracle.sourceFile}#${oracle.caseId}`);
    return {
      id: `${scenario.id}:${index + 1}`,
      kind: oracle.kind,
      sourceRef: `${oracle.sourceFile}#${oracle.caseId}`,
      sourceType: 'source_anchored_knowledge_case',
      sha256: hash(source),
    };
  }

  if (oracle.kind === 'snapshot_case' ||
      (['action_contract', 'clinical_contract'].includes(oracle.kind) && oracle.sourceCaseId)) {
    const source = frozenCases.get(oracle.sourceCaseId);
    if (!source) throw new Error(`Missing frozen source ${oracle.sourceCaseId}`);
    const contract = oracle.kind === 'snapshot_case' ? undefined : oracle;
    const contractName = oracle.kind === 'action_contract' ? 'action' : 'clinical';
    return {
      id: `${scenario.id}:${index + 1}`,
      kind: oracle.kind,
      sourceRef: `${sourcePrefix}#${oracle.sourceCaseId}${contract ? `+${scenario.id}` : ''}`,
      sourceType: contract ? `frozen_snapshot_plus_${contractName}_contract` : 'frozen_synthetic_snapshot_case',
      sha256: hash(contract ? { source, contract } : source),
    };
  }

  if (oracle.kind === 'plan_contract' && oracle.promptBindingSourceCaseId) {
    const source = frozenCases.get(oracle.promptBindingSourceCaseId);
    if (!source) throw new Error(`Missing frozen prompt binding source ${oracle.promptBindingSourceCaseId}`);
    return {
      id: `${scenario.id}:${index + 1}`,
      kind: oracle.kind,
      sourceRef: `${sourcePrefix}#${oracle.promptBindingSourceCaseId}+${scenario.id}`,
      sourceType: 'approved_plan_contract_plus_frozen_prompt_binding',
      sha256: hash({ contract: oracle, promptBindingSource: source }),
    };
  }

  const sourceRef = typeof oracle.source === 'string' && oracle.source.trim()
    ? `${oracle.source}#${scenario.id}`
    : `${scenario.id}#${oracle.kind}`;
  return {
    id: `${scenario.id}:${index + 1}`,
    kind: oracle.kind,
    sourceRef,
    sourceType: oracle.source ? 'approved_plan_contract' : 'scenario_contract',
    sha256: hash(oracle),
  };
}

export function buildV8AdversarialBinding({
  manifest,
  frozenManifest,
  knowledgeSources,
  source,
  checkout,
  historicalEnvironmentEvidence,
  promptBindingEvidence,
  hashInputs,
}) {
  const validation = validateV8AdversarialManifest(manifest, { frozenManifest, knowledgeSources });
  if (validation.total !== 250) throw new Error(`Expected 250 adversarial cases, received ${validation.total}`);

  const frozenCases = indexById(frozenManifest.cases, 'frozen');
  const knowledgeCaseSets = new Map(Object.entries(knowledgeSources).map(([file, cases]) => [file, indexById(cases, 'knowledge')]));
  const kindCounts = {};
  const dimensionCounts = {};
  const cases = manifest.cases.map(scenario => {
    for (const dimension of scenario.tags ?? []) dimensionCounts[dimension] = (dimensionCounts[dimension] ?? 0) + 1;
    const oracleRefs = scenario.oracles.map((oracle, index) => {
      kindCounts[oracle.kind] = (kindCounts[oracle.kind] ?? 0) + 1;
      return bindOracle({ scenario, oracle, index, frozenCases, knowledgeCaseSets });
    });
    return {
      id: scenario.id,
      scenarioSha256: hash(Object.fromEntries(scenarioHashFields.map(field => [field, scenario[field]]))),
      oracleSha256: hash(scenario.oracles),
      oracles: oracleRefs,
    };
  });
  const oracleReferences = cases.reduce((total, item) => total + item.oracles.length, 0);
  const knowledgeSourceHashes = Object.keys(knowledgeSources).sort().map(file => ({
    file,
    cases: knowledgeSources[file].length,
    sha256: hash(hashInputs.knowledgeSources?.[file] ?? knowledgeSources[file]),
  }));

  return {
    version: 2,
    campaign: 'alexa-v8-adversarial-250',
    status: 'SOURCE_REFERENCES_BOUND',
    validationStatus: validation.status,
    runtimeStatus: 'NOT RUN',
    independentReview: 'NOT RUN',
    sourceStatus: source?.snapshotSha256
      ? 'Synthetic snapshot metadata is historical; full live database/schema alignment NOT VERIFIED.'
      : 'Synthetic source metadata unavailable; full live database/schema alignment NOT VERIFIED.',
    promptBinding: promptBindingEvidence
      ? project(promptBindingEvidence, ['status', 'scenarios', 'placeholders', 'snapshotSha256', 'privateOracleSha256'])
      : { status: 'NOT VERIFIED' },
    checkout: project(checkout, ['branch', 'headAtBinding', 'sourceWorkingTreeSha256']),
    historicalEnvironmentEvidence: project(historicalEnvironmentEvidence, historicalEvidenceFields),
    source: project(source, sourceMetadataFields),
    knowledgeSources: knowledgeSourceHashes,
    frozenManifestSha256: hash(hashInputs.frozenManifest ?? frozenManifest),
    corpusSourceSha256: hash(hashInputs.corpus ?? manifest),
    counts: {
      cases: cases.length,
      oracleReferences,
      categories: validation.categories,
      dimensions: Object.fromEntries(Object.entries(dimensionCounts).sort(([a], [b]) => a.localeCompare(b))),
      kinds: Object.fromEntries(Object.entries(kindCounts).sort(([a], [b]) => a.localeCompare(b))),
    },
    cases,
    validatorSha256: hash(hashInputs.validator ?? readFileSync(path.join(repoRoot, 'scripts', 'lib', 'alexa-v8-adversarial.mjs'))),
    validatorTestSha256: hash(hashInputs.validatorTest ?? readFileSync(path.join(repoRoot, 'tests', 'unit', 'alexa-v8-adversarial-manifest.test.ts'))),
    ...(hashInputs.binder ? { binderSha256: hash(hashInputs.binder) } : {}),
    scenarioHashFields: [...scenarioHashFields],
  };
}

function migrationNumber(value) {
  const match = typeof value === 'string' ? /^(\d+)/u.exec(value) : null;
  return match ? Number(match[1]) : null;
}

/** Reports the source tree separately from historical DB evidence; this command never probes a live database. */
export function formatV8AdversarialBindingStatus({ mode, binding }) {
  const evidence = binding.historicalEnvironmentEvidence ?? {};
  const trackedMigration = migrationNumber(evidence.highestTrackedRepositoryMigrationFile);
  const onDiskMigration = migrationNumber(evidence.highestRepositoryMigrationFile);
  const trackedFiles = Number.isInteger(evidence.trackedRepositoryMigrationSqlFiles)
    ? evidence.trackedRepositoryMigrationSqlFiles : 'unknown';
  const untrackedFiles = Array.isArray(evidence.untrackedRepositoryMigrationFiles)
    ? evidence.untrackedRepositoryMigrationFiles : [];
  const latestUntracked = onDiskMigration !== null && onDiskMigration !== trackedMigration &&
    untrackedFiles.some(file => migrationNumber(file) === onDiskMigration);
  const migrationStatus = evidence.migrationVerificationStatus === 'VERIFIED_READ_ONLY' &&
    Number.isInteger(evidence.currentDatabaseMigration) && Number.isInteger(evidence.currentAppliedMigrationCount)
    ? `historical synthetic DB evidence: migration ${evidence.currentDatabaseMigration} at ${String(evidence.migrationVerifiedAtUtc ?? 'unknown date').slice(0, 10)} (${evidence.currentAppliedMigrationCount} applied rows)`
    : 'historical synthetic DB evidence NOT VERIFIED';
  const alignmentStatus = evidence.migrationRegistryAlignmentStatus ?? 'NOT VERIFIED';
  const hasVerifiedAlignment = alignmentStatus === 'PASS' || alignmentStatus === 'FAIL';
  const missingMigrationCount = hasVerifiedAlignment && Array.isArray(evidence.missingRepositoryMigrationVersions)
    ? evidence.missingRepositoryMigrationVersions.length : null;
  const alignment = hasVerifiedAlignment
    ? 'historical registry alignment ' + alignmentStatus + ' (' + missingMigrationCount + ' missing source versions)'
    : 'historical registry alignment ' + alignmentStatus + ' (source-version count NOT VERIFIED)';
  const workingTree = typeof binding.checkout?.sourceWorkingTreeSha256 === 'string'
    ? `source tree ${binding.checkout.sourceWorkingTreeSha256.slice(0, 12)}`
    : 'source tree NOT VERIFIED';
  const prompt = binding.promptBinding?.status === 'PASS'
    ? `private synthetic prompt bindings PASS (${binding.promptBinding.scenarios} scenarios, ${binding.promptBinding.placeholders} placeholders)`
    : `private synthetic prompt bindings ${binding.promptBinding?.status ?? 'NOT VERIFIED'}`;
  return `${mode} hash-only binding: ${binding.counts.cases} cases, ${binding.counts.oracleReferences} oracle references; ${prompt}; ${workingTree}; tracked repository migration ${trackedMigration ?? 'NOT VERIFIED'} (${trackedFiles} files);${latestUntracked ? ` latest on-disk migration ${onDiskMigration} is untracked;` : ''} ${migrationStatus}; current DB status NOT VERIFIED; ${alignment}; full schema alignment ${evidence.fullSchemaAlignmentStatus ?? 'NOT VERIFIED'}; runtime ${binding.runtimeStatus ?? 'NOT RUN'}.`;
}

function readInputs() {
  const manifest = require(path.join(repoRoot, 'tests', 'eval', 'alexa-v8-adversarial-250.cjs'));
  const frozenManifest = JSON.parse(readFileSync(path.join(repoRoot, 'tests', 'eval', 'alexa-v8-cases.json'), 'utf8'));
  const priorArtifact = existsSync(artifactPath) ? JSON.parse(readFileSync(artifactPath, 'utf8')) : {};
  const sourceMigrationVersions = readdirSync(path.join(repoRoot, 'supabase', 'migrations'))
    .filter(file => file.endsWith('.sql'))
    .map(file => file.slice(0, -4))
    .sort();
  const trackedMigrationVersions = execFileSync('git', ['ls-files', '--', 'supabase/migrations'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).split(/\r?\n/u)
    .filter(file => file.endsWith('.sql'))
    .map(file => path.posix.basename(file, '.sql'))
    .sort();
  const trackedMigrationSet = new Set(trackedMigrationVersions);
  const migrationInventoryEvidence = {
    repositoryMigrationSqlFiles: sourceMigrationVersions.length,
    highestRepositoryMigrationFile: sourceMigrationVersions.at(-1),
    trackedRepositoryMigrationSqlFiles: trackedMigrationVersions.length,
    highestTrackedRepositoryMigrationFile: trackedMigrationVersions.at(-1),
    untrackedRepositoryMigrationFiles: sourceMigrationVersions.filter(version => !trackedMigrationSet.has(version)),
    repositoryMigrationInventorySha256: hash(Buffer.from(sourceMigrationVersions.join('\n'))),
  };
  const migrationEvidencePath = path.join(repoRoot, '.eval-out', 'alexa-v8-upgrade', 'synthetic-db-migration-check-20261028.json');
  const migrationAlignmentEvidencePath = path.join(repoRoot, '.eval-out', 'alexa-v8-upgrade', 'synthetic-db-migration-alignment-20261028.json');
  let migrationEvidenceBytes;
  let migrationEvidence;
  let cloneIntegrityBytes;
  let cloneIntegrity;
  let liveMigrationEvidence = {
    currentDatabaseMigration: 'NOT VERIFIED',
    migrationVerificationStatus: 'NOT VERIFIED',
  };
  if (existsSync(migrationEvidencePath)) {
    migrationEvidenceBytes = readFileSync(migrationEvidencePath);
    migrationEvidence = JSON.parse(migrationEvidenceBytes.toString('utf8'));
    const cloneIntegrityPath = path.join(repoRoot, '.eval-out', 'alexa-v8-upgrade', 'clone-integrity.json');
    cloneIntegrityBytes = readFileSync(cloneIntegrityPath);
    cloneIntegrity = JSON.parse(cloneIntegrityBytes.toString('utf8'));
    const evidenceMatchesClone = migrationEvidence.status === 'VERIFIED' && migrationEvidence.readOnly === true &&
      migrationEvidence.target?.database === priorArtifact.source?.database &&
      migrationEvidence.target?.snapshotSha256 === priorArtifact.source?.snapshotSha256 &&
      migrationEvidence.target?.cloneIntegrityStatus === 'PASS' &&
      migrationEvidence.target?.cloneIntegritySha256 === hash(cloneIntegrityBytes) &&
      cloneIntegrity.status === 'PASS' && cloneIntegrity.targetDatabase === migrationEvidence.target.database &&
      migrationEvidence.result?.currentDatabase === migrationEvidence.target.database &&
      Number.isInteger(migrationEvidence.result?.appliedMigrationRows) &&
      Number.isInteger(migrationEvidence.result?.highestAppliedMigrationNumber) &&
      typeof migrationEvidence.result?.migration194 === 'string' && migrationEvidence.result.migration194.startsWith('194_');
    if (evidenceMatchesClone) {
      liveMigrationEvidence = {
        currentDatabaseMigration: migrationEvidence.result.highestAppliedMigrationNumber,
        currentAppliedMigrationCount: migrationEvidence.result.appliedMigrationRows,
        migrationVerificationStatus: 'VERIFIED_READ_ONLY',
        migrationVerifiedAtUtc: migrationEvidence.observedAtUtc,
        migrationEvidenceSha256: hash(migrationEvidenceBytes),
      };
    }
  }
  let migrationAlignmentEvidence = {
    migrationRegistryAlignmentStatus: 'NOT VERIFIED',
    fullSchemaAlignmentStatus: 'NOT VERIFIED',
  };
  if (existsSync(migrationAlignmentEvidencePath) && migrationEvidenceBytes && cloneIntegrityBytes && cloneIntegrity) {
    const alignmentBytes = readFileSync(migrationAlignmentEvidencePath);
    const alignment = JSON.parse(alignmentBytes.toString('utf8'));
    const missingVersions = alignment.result?.missingSourceMigrationVersions;
    const sortedUniqueMissing = Array.isArray(missingVersions) &&
      missingVersions.every((version, index) => typeof version === 'string' && sourceMigrationVersions.includes(version) &&
        (index === 0 || missingVersions[index - 1] < version));
    const evidenceMatchesInputs = alignment.evidenceStatus === 'VERIFIED_READ_ONLY' && alignment.readOnly === true &&
      alignment.target?.database === migrationEvidence.target?.database &&
      alignment.target?.snapshotSha256 === migrationEvidence.target?.snapshotSha256 &&
      alignment.target?.cloneIntegritySha256 === hash(cloneIntegrityBytes) &&
      alignment.registryEvidenceSha256 === hash(migrationEvidenceBytes) &&
      cloneIntegrity.status === 'PASS' && cloneIntegrity.targetDatabase === alignment.target?.database &&
      alignment.result?.currentDatabase === alignment.target?.database &&
      alignment.result?.appliedMigrationRows === migrationEvidence.result?.appliedMigrationRows &&
      alignment.result?.highestAppliedMigrationNumber === migrationEvidence.result?.highestAppliedMigrationNumber &&
      alignment.sourceMigrationInventory?.onDiskFileCount === sourceMigrationVersions.length &&
      alignment.sourceMigrationInventory?.highestOnDiskVersion === sourceMigrationVersions.at(-1) &&
      alignment.sourceMigrationInventory?.onDiskVersionsSha256 === migrationInventoryEvidence.repositoryMigrationInventorySha256 &&
      Array.isArray(missingVersions) && missingVersions.length === alignment.result?.missingSourceMigrationCount &&
      sortedUniqueMissing && alignment.result?.registryAlignmentStatus === (missingVersions.length ? 'FAIL' : 'PASS');
    if (evidenceMatchesInputs) {
      migrationAlignmentEvidence = {
        migrationRegistryAlignmentStatus: alignment.result.registryAlignmentStatus,
        missingRepositoryMigrationVersions: missingVersions,
        migrationAlignmentEvidenceSha256: hash(alignmentBytes),
        migrationAlignmentVerifiedAtUtc: alignment.observedAtUtc,
        fullSchemaAlignmentStatus: 'NOT VERIFIED',
      };
    }
  }
  const knowledgeSources = {};
  const knowledgeBytes = {};
  for (const file of resolveKnowledgeFiles(manifest)) {
    if (path.basename(file) !== file || !file.endsWith('.json')) throw new Error(`Invalid knowledge source filename: ${file}`);
    const bytes = readFileSync(path.join(knowledgeDirectory, file));
    knowledgeBytes[file] = bytes;
    knowledgeSources[file] = JSON.parse(bytes.toString('utf8')).cas;
  }
  const privateSnapshotPath = path.join(repoRoot, '.eval-out', 'alexa-v8-upgrade', 'private-oracle-snapshot-v2.json');
  const privateOraclePath = path.join(repoRoot, '.eval-out', 'alexa-v8-upgrade', 'private-oracles-v4.json');
  const privateSnapshotBytes = readFileSync(privateSnapshotPath);
  const privateOracleBytes = readFileSync(privateOraclePath);
  const privateSnapshotSha256 = hash(privateSnapshotBytes);
  const privateSnapshot = JSON.parse(privateSnapshotBytes.toString('utf8'));
  const privateOracles = JSON.parse(privateOracleBytes.toString('utf8'));
  if (privateOracles.version !== 4 || privateOracles.sourceSha256 !== privateSnapshotSha256 ||
      (priorArtifact.source?.snapshotSha256 && priorArtifact.source.snapshotSha256 !== privateSnapshotSha256)) {
    throw new Error('Private adversarial prompt bindings do not match the frozen synthetic snapshot');
  }
  let resolvedPlaceholders = 0;
  for (const scenario of manifest.cases) {
    resolveV8AdversarialPromptTurns(scenario, { snapshot: privateSnapshot, privateOracles });
    resolvedPlaceholders += scenario.turns.reduce((total, turn) => total + [...turn.matchAll(/\[([A-Z0-9_]+)\]/gu)].length, 0);
  }
  const promptBindingEvidence = {
    status: 'PASS',
    scenarios: manifest.cases.length,
    placeholders: resolvedPlaceholders,
    snapshotSha256: privateSnapshotSha256,
    privateOracleSha256: hash(privateOracleBytes),
  };
  const git = args => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  const hashInputs = {
    frozenManifest: readFileSync(path.join(repoRoot, 'tests', 'eval', 'alexa-v8-cases.json')),
    corpus: readFileSync(path.join(repoRoot, 'tests', 'eval', 'alexa-v8-adversarial-250.cjs')),
    knowledgeSources: knowledgeBytes,
    privateSnapshot: privateSnapshotBytes,
    privateOracle: privateOracleBytes,
    validator: readFileSync(path.join(repoRoot, 'scripts', 'lib', 'alexa-v8-adversarial.mjs')),
    validatorTest: readFileSync(path.join(repoRoot, 'tests', 'unit', 'alexa-v8-adversarial-manifest.test.ts')),
    binder: readFileSync(scriptPath),
  };
  const binding = buildV8AdversarialBinding({
    manifest,
    frozenManifest,
    knowledgeSources,
    source: priorArtifact.source ?? {},
    checkout: {
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      headAtBinding: git(['rev-parse', '--short=12', 'HEAD']),
      sourceWorkingTreeSha256: workingTreeSha256(),
    },
    promptBindingEvidence,
    historicalEnvironmentEvidence: {
      ...(priorArtifact.historicalEnvironmentEvidence ?? {}),
      ...migrationInventoryEvidence,
      ...liveMigrationEvidence,
      ...migrationAlignmentEvidence,
    },
    hashInputs,
  });
  return { binding };
}

function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--write', '--check'].includes(arg)) || args.includes('--write') && args.includes('--check')) {
    throw new Error('Usage: node scripts/alexa-v8-bind-adversarial.mjs [--check | --write]');
  }
  const mode = args.includes('--write') ? 'write' : 'check';
  const { binding } = readInputs();
  const serialized = `${JSON.stringify(binding, null, 2)}\n`;
  if (mode === 'write') {
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, serialized, { encoding: 'utf8', flag: 'w' });
    process.stdout.write(`${formatV8AdversarialBindingStatus({ mode: 'WROTE', binding })}\n`);
    return;
  }
  let current;
  try {
    current = readFileSync(artifactPath, 'utf8');
  } catch {
    process.stderr.write('STALE: binding artifact is missing; review inputs and rerun with --write.\n');
    process.exitCode = 1;
    return;
  }
  if (current !== serialized) {
    process.stderr.write('STALE: binding inputs differ from the local artifact; review inputs and rerun with --write.\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${formatV8AdversarialBindingStatus({ mode: 'CURRENT', binding })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
