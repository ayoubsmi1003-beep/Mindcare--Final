const expectedCategories = Object.freeze({
  patients: 30, consultations: 45, followups: 35, agenda: 15,
  finance: 20, application: 15, actions: 40,
});

const expectedCohortSizes = Object.freeze({ baseline: 40, development: 160, holdout: 40 });

export function selectV8Cases(manifest, cohort) {
  const expected = expectedCohortSizes[cohort];
  if (!expected || !Array.isArray(manifest?.cases)) throw new Error('Unknown Alexa V8 cohort');
  const selected = cohort === 'baseline'
    ? manifest.cases.filter(item => item.baseline === true)
    : manifest.cases.filter(item => item.partition === cohort);
  if (selected.length !== expected) throw new Error(`Incorrect Alexa V8 ${cohort} cohort size`);
  return selected;
}

export function validateV8Target(value) {
  let target;
  try { target = new URL(value); } catch { throw new Error('Disposable evaluation database required'); }
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || target.hostname !== '127.0.0.1' ||
      target.port !== '55445' || target.pathname !== '/alexa_eval_v8_intelligence_20261027' || target.search || target.hash) {
    throw new Error('Disposable evaluation database required');
  }
}

export const BOOK_RAG_REQUIRED_MIGRATIONS = Object.freeze([
  '195_recherche_medicaments_complete',
  '196_recherche_patients_complete',
  '197_recherche_medicaments_infixe',
  '198_recherche_medicaments_rls',
  '199_recherche_medicaments_scan',
  '200_recherche_medicaments_plan',
]);

export function resolveBookRagDatabaseUrl(env) {
  const value = env?.MINDCARE_ALEXA_EVAL_DATABASE_URL;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('An explicit V8 synthetic evaluation URL is required');
  }
  validateV8Target(value);
  return value;
}

export function resolveV8CampaignDatabaseUrls(env) {
  const applicationUrl = resolveBookRagDatabaseUrl(env);
  const adminUrl = env?.MINDCARE_ALEXA_EVAL_ADMIN_URL;
  if (typeof adminUrl !== 'string' || adminUrl.trim() === '') {
    throw new Error('An explicit V8 disposable admin URL is required');
  }
  validateV8Target(adminUrl);
  const application = new URL(applicationUrl);
  const admin = new URL(adminUrl);
  if (application.hostname !== admin.hostname || application.port !== admin.port || application.pathname !== admin.pathname) {
    throw new Error('V8 application and preflight URLs must target the same disposable database');
  }
  return { applicationUrl, adminUrl };
}

export function validateBookRagSource(value) {
  if (!value || value.database !== 'alexa_eval_v8_intelligence_20261027' ||
      Number(value.patients) !== 1558 || Number(value.consultations) !== 8143 ||
      Number(value.nonSynthetic) !== 0) {
    throw new Error('Verified V8 synthetic evaluation snapshot required');
  }
  if (Number(value.appliedMigrationsThrough200) !== BOOK_RAG_REQUIRED_MIGRATIONS.length) {
    throw new Error('V8 book evaluation requires all application migrations 195 through 200');
  }
}

function compareMigrationVersions(left, right) {
  const leftNumber = Number(/^(\d+)_/u.exec(left)?.[1] ?? Number.NaN);
  const rightNumber = Number(/^(\d+)_/u.exec(right)?.[1] ?? Number.NaN);
  return leftNumber - rightNumber || left.localeCompare(right);
}

/** Refuse live evaluation against a migration registry that differs from this checkout. */
export function validateV8MigrationInventory({ repositoryVersions, appliedVersions } = {}) {
  const asSet = values => {
    if (!Array.isArray(values) || !values.length || values.some(value =>
      typeof value !== 'string' || value.trim() !== value || value.length > 240 || /[\\/]/u.test(value))) {
      throw new Error('V8MigrationInventoryMismatch');
    }
    const versions = new Set(values);
    if (versions.size !== values.length) throw new Error('V8MigrationInventoryMismatch');
    return versions;
  };
  const repository = asSet(repositoryVersions);
  const applied = asSet(appliedVersions);
  if (repository.size !== applied.size || [...repository].some(version => !applied.has(version))) {
    throw new Error('V8MigrationInventoryMismatch');
  }
  const highestRepositoryVersion = [...repository].sort(compareMigrationVersions).at(-1);
  return {
    status: 'PASS',
    repositoryCount: repository.size,
    appliedCount: applied.size,
    highestRepositoryVersion,
  };
}

export function assertBookRagArguments(args) {
  if (args.some(arg => arg === '--url' || arg.startsWith('--url='))) {
    throw new Error('--url is not supported; use the explicit V8 evaluation environment variable');
  }
}

const v8SyntheticDockerTarget = Object.freeze({
  container: 'mindcare-v8-intelligence-20261027',
  database: 'alexa_eval_v8_intelligence_20261027',
});

export function resolveV8SyntheticDockerTarget(container, database) {
  const target = {
    container: container ?? v8SyntheticDockerTarget.container,
    database: database ?? v8SyntheticDockerTarget.database,
  };
  if (target.container !== v8SyntheticDockerTarget.container || target.database !== v8SyntheticDockerTarget.database) {
    throw new Error('V8 synthetic evaluation target only; refusing another Docker database.');
  }
  return target;
}

export function requireV8Migration194(applied) {
  if (applied !== true) throw new Error('V8 synthetic target must include migration 194.');
}

export function validateV8Source(value) {
  if (!value || value.database !== 'alexa_eval_v8_intelligence_20261027' || value.nonSynthetic !== 0 ||
      value.patients !== 1558 || value.consultations !== 8143) {
    throw new Error('Verified synthetic evaluation snapshot required');
  }
}

/** Validate campaign structure without treating a draft or a hash as a passing evaluation.
 * @param {unknown} manifest
 * @param {{requireFrozen?: boolean, snapshotSha256?: string}} [options]
 */
export function validateV8Manifest(manifest, { requireFrozen = false, snapshotSha256 } = {}) {
  if (!manifest || !Array.isArray(manifest.cases) || manifest.cases.length !== 200) {
    throw new Error('Expected 200 scenarios');
  }
  const ids = new Set(), questions = new Set(), oracles = new Set();
  const categories = Object.fromEntries(Object.keys(expectedCategories).map(key => [key, 0]));
  let development = 0, holdout = 0, baseline = 0, allOraclesFrozen = true, snapshotMatches = true;
  for (const item of manifest.cases) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id)) throw new Error('Duplicate or invalid scenario id');
    ids.add(item.id);
    if (!Object.hasOwn(categories, item.category) || item.language !== 'fr' ||
        !Array.isArray(item.turns) || !item.turns.length || item.turns.some(turn => typeof turn !== 'string' || !turn.trim())) {
      throw new Error(`Invalid scenario: ${item.id}`);
    }
    const question = item.turns.map(turn => turn.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('fr')).join('\n');
    if (questions.has(question)) throw new Error(`Duplicate scenario: ${item.id}`);
    questions.add(question);
    if (typeof item.oracleKey !== 'string' || !item.oracleKey || oracles.has(item.oracleKey)) throw new Error(`Duplicate or invalid oracle: ${item.id}`);
    oracles.add(item.oracleKey);
    categories[item.category]++;
    if (item.partition === 'development') development++;
    else if (item.partition === 'holdout') holdout++;
    else throw new Error(`Invalid partition: ${item.id}`);
    if (item.baseline === true) {
      if (item.partition === 'holdout') throw new Error(`Holdout cannot be in baseline: ${item.id}`);
      baseline++;
    } else if (item.baseline !== false) throw new Error(`Invalid baseline marker: ${item.id}`);
    const oracleFrozen = item.oracleStatus === 'FROZEN' && item.oracle &&
      Array.isArray(item.oracle.assertions) && item.oracle.assertions.length > 0 &&
      typeof item.oracle.sourceSha256 === 'string' && /^[a-f0-9]{64}$/u.test(item.oracle.sourceSha256);
    if (!oracleFrozen) {
      allOraclesFrozen = false;
      if (requireFrozen) throw new Error(`Independent oracle not frozen: ${item.id}`);
    }
    if (!oracleFrozen || typeof snapshotSha256 !== 'string' || item.oracle.sourceSha256 !== snapshotSha256) {
      snapshotMatches = false;
      if (requireFrozen && oracleFrozen) throw new Error(`Oracle snapshot mismatch: ${item.id}`);
    }
  }
  if (Object.entries(expectedCategories).some(([key, value]) => categories[key] !== value) ||
      development !== 160 || holdout !== 40 || baseline !== 40) throw new Error('Incorrect campaign distribution');
  if (requireFrozen && manifest.status !== 'FROZEN') throw new Error('Campaign is not frozen');
  return { total: manifest.cases.length, development, holdout, baseline, categories, frozen: manifest.status === 'FROZEN' && allOraclesFrozen && snapshotMatches };
}
