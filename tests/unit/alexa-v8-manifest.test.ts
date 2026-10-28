import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { selectV8Cases, validateV8Manifest, validateV8Target, validateV8Source } from '../../scripts/lib/alexa-v8-manifest.mjs';

type V8Manifest = {
  status: string;
  cases: Array<{
    id: string;
    category: string;
    oracleKey: string;
    turns: string[];
    partition: string;
    baseline: boolean;
    oracleStatus?: string;
    oracle?: { assertions: Array<{ kind: string }>; sourceSha256: string };
  }>;
};
const manifest = (): V8Manifest => JSON.parse(readFileSync('tests/eval/alexa-v8-cases.json', 'utf8')) as V8Manifest;

describe('Alexa V8 evaluation manifest', () => {
  it('keeps the requested case distribution and a separate 40-case holdout', () => {
    expect(validateV8Manifest(manifest())).toMatchObject({
      total: 200,
      development: 160,
      holdout: 40,
      baseline: 40,
      categories: { patients: 30, consultations: 45, followups: 35, agenda: 15, finance: 20, application: 15, actions: 40 },
    });
  });

  it('selects development, holdout, and baseline cases without mixing partitions', () => {
    const value = manifest();
    const development = selectV8Cases(value, 'development');
    const holdout = selectV8Cases(value, 'holdout');
    const baseline = selectV8Cases(value, 'baseline');
    expect(development).toHaveLength(160);
    expect(holdout).toHaveLength(40);
    expect(baseline).toHaveLength(40);
    expect(development.every((item: V8Manifest['cases'][number]) => item.partition === 'development')).toBe(true);
    expect(holdout.every((item: V8Manifest['cases'][number]) => item.partition === 'holdout')).toBe(true);
    expect(baseline.every((item: V8Manifest['cases'][number]) => item.baseline)).toBe(true);
  });

  it('rejects a duplicated scenario even if it has a different identifier', () => {
    const value = manifest();
    const first = value.cases[0], second = value.cases[1];
    if (!first || !second) throw new Error('Frozen manifest has too few scenarios');
    second.turns = first.turns;
    expect(() => validateV8Manifest(value)).toThrow(/duplicate.*scenario/i);
  });

  it('rejects an oracle reused under a different scenario name', () => {
    const value = manifest();
    const first = value.cases[0], second = value.cases[1];
    if (!first || !second) throw new Error('Frozen manifest has too few scenarios');
    second.oracleKey = first.oracleKey;
    expect(() => validateV8Manifest(value)).toThrow(/duplicate.*oracle/i);
  });

  it('does not allow a draft with unbound expected results to run as frozen', () => {
    const value = manifest();
    value.status = 'FROZEN';
    expect(() => validateV8Manifest(value, { requireFrozen: true })).toThrow(/oracle/i);
  });

  it('does not report an unbound manifest as frozen when its label is changed', () => {
    const value = manifest();
    value.status = 'FROZEN';
    expect(validateV8Manifest(value).frozen).toBe(false);
  });

  it('rejects frozen expectations bound to a different source snapshot', () => {
    const value = manifest();
    value.status = 'FROZEN';
    for (const item of value.cases) {
      item.oracleStatus = 'FROZEN';
      item.oracle = { assertions: [{ kind: 'source' }], sourceSha256: 'a'.repeat(64) };
    }
    expect(() => validateV8Manifest(value, { requireFrozen: true, snapshotSha256: 'b'.repeat(64) })).toThrow(/snapshot/i);
  });

  it('does not allow a held-out case to be included in the baseline', () => {
    const value = manifest();
    const heldOut = value.cases.find((item: { partition: string }) => item.partition === 'holdout');
    if (!heldOut) throw new Error('Frozen manifest has no holdout cases');
    heldOut.baseline = true;
    expect(() => validateV8Manifest(value)).toThrow(/holdout.*baseline/i);
  });
});

describe('Alexa V8 evaluation database', () => {
  it('accepts only the named disposable loopback database', () => {
    expect(() => validateV8Target('postgresql://postgres@127.0.0.1:55445/alexa_eval_v8_intelligence_20261027')).not.toThrow();
    for (const url of [
      'postgresql://postgres@127.0.0.1:55441/mindcare',
      'postgresql://postgres@127.0.0.1:55444/alexa_eval_clinical_20261022',
      'postgresql://postgres@example.org:55445/alexa_eval_v8_intelligence_20261027',
      'postgresql://postgres@127.0.0.1:55445/mindcare',
    ]) expect(() => validateV8Target(url)).toThrow(/disposable/i);
  });

  it('rejects an incorrectly named or non-synthetic evaluation copy', () => {
    const source = { database: 'alexa_eval_v8_intelligence_20261027', patients: 1558, consultations: 8143, nonSynthetic: 0 };
    expect(() => validateV8Source(source)).not.toThrow();
    expect(() => validateV8Source({ ...source, database: 'mindcare' })).toThrow(/synthetic/i);
    expect(() => validateV8Source({ ...source, nonSynthetic: 1 })).toThrow(/synthetic/i);
    expect(() => validateV8Source({ ...source, consultations: 8142 })).toThrow(/synthetic/i);
  });
});
