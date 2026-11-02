import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { validateV8AdversarialManifest } from '../../scripts/lib/alexa-v8-adversarial.mjs';

const require = createRequire(import.meta.url);
const manifest = require('../eval/alexa-v9-adversarial-300.cjs');
const frozen = JSON.parse(readFileSync('tests/eval/alexa-v8-cases.json', 'utf8'));
const retired = require('../eval/alexa-v8-adversarial-250.cjs');
const knowledgeSources = {
  'knowledge.books-v4-2026-10-28.json':
    JSON.parse(readFileSync('tests/eval/knowledge.books-v4-2026-10-28.json', 'utf8')).cas,
};

type CorpusCase = {
  id: string;
  category: string;
  intent: string;
  language: string;
  turns: string[];
};
type Corpus = { cases: CorpusCase[] };

const corpus = manifest as Corpus;
const cases = corpus.cases;
const frozenCases = frozen.cases as CorpusCase[];
const retiredCases = (retired as Corpus).cases;
const categoryCounts: Record<string, number> = {
  knowledge: 35,
  mixed: 30,
  model_routing: 20,
  retrieval: 20,
  followups: 30,
  patient_consultation: 40,
  agenda: 30,
  finance: 25,
  actions: 40,
  documents_printing: 30,
};
const bookTitle = /\b(?:dsm(?:[\s-]*5)?|maudsley|taylor|stahl|prescriber(?:['’]s)?|manuel|livre|ouvrage)\b/iu;
const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('fr');

describe('Alexa V9 300-question corpus', () => {
  it('validates 300 new French scenarios with independent source references', () => {
    expect(validateV8AdversarialManifest(manifest, {
      frozenManifest: frozen,
      knowledgeSources,
      campaign: 'alexa-v9-adversarial-300',
      categoryCounts,
    })).toMatchObject({
      total: 300,
      status: 'DRAFT_ORACLES_PENDING',
      categories: categoryCounts,
    });
  });

  it('uses 300 distinct identifiers, questions and intents', () => {
    expect(cases).toHaveLength(300);
    expect(new Set(cases.map(item => item.id)).size).toBe(300);
    expect(new Set(cases.map(item => normalize(item.turns.join('\n')))).size).toBe(300);
    expect(new Set(cases.map(item => normalize(item.intent))).size).toBe(300);
    expect(cases[0]?.id).toBe('ADV-301');
    expect(cases.at(-1)?.id).toBe('ADV-600');
  });

  it('never names a book, manual or publisher in a question', () => {
    const offenders = cases.flatMap(item => item.turns
      .filter(turn => bookTitle.test(turn))
      .map(turn => `${item.id}: ${turn}`));
    expect(offenders).toEqual([]);
  });

  it('does not reuse any question from the frozen 200 or the retired 250 corpora', () => {
    const frozenTurns = new Set(frozenCases.flatMap(item => item.turns.map(normalize)));
    const retiredTurns = new Set(retiredCases.flatMap(item => item.turns.map(normalize)));
    const overlaps = cases.flatMap(item => item.turns
      .filter(turn => frozenTurns.has(normalize(turn)) || retiredTurns.has(normalize(turn)))
      .map(turn => `${item.id}: ${turn}`));
    expect(overlaps).toEqual([]);
  });

  it('keeps every question in French with bounded turn counts', () => {
    for (const item of cases) {
      expect(item.language, item.id).toBe('fr');
      expect(item.turns.length, item.id).toBeGreaterThanOrEqual(1);
      expect(item.turns.length, item.id).toBeLessThanOrEqual(4);
      expect(item.turns.every(turn => typeof turn === 'string' && turn.trim()), item.id).toBe(true);
    }
  });
});
