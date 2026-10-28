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
