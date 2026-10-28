import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertV8ScenarioAppContext, findV8StaticAssetFailures, resolveV8AssistantInteraction, resolveV8ScenarioPath } from '../../scripts/lib/alexa-v8-browser-context.mjs';

const snapshot = { currentDocument: {
  id: '442f6798-26bb-43ae-82a3-b84f5a8f9f52',
  patient_id: 'f898e0cf-9e68-4153-9e13-188855fc8b1e',
  status: 'issued',
  is_synthetic: true,
  content_hash: 'a'.repeat(64),
  doc_number: 'DOC-2026-00068',
} };
const setups = JSON.parse(readFileSync('tests/eval/alexa-v8-preconditions.json', 'utf8')) as {
  version: number;
  cases: Record<string, { kind: string; source: string }>;
};

describe('Alexa V8 browser preconditions', () => {
  it('opens the independently selected issued document for the current-document question', () => {
    const scenarioPath = resolveV8ScenarioPath('v8-150', setups, snapshot, 'http://127.0.0.1:3106');
    const url = new URL(scenarioPath);
    expect(url.pathname).toBe('/documents');
    expect(url.searchParams.get('patient')).toBe(snapshot.currentDocument.patient_id);
    expect(url.searchParams.get('document')).toBe(snapshot.currentDocument.id);
  });

  it('opens Alexa from the document workspace and targets its side-panel input', () => {
    expect(resolveV8AssistantInteraction('v8-150', setups, snapshot)).toEqual({
      openPanel: true,
      inputSelector: 'aside input[aria-label]',
    });
  });

  it('keeps standard scenarios on the full-screen Jarvis input', () => {
    expect(resolveV8AssistantInteraction('v8-001', setups, snapshot)).toEqual({
      openPanel: false,
      inputSelector: 'main textarea',
    });
  });

  it('leaves scenarios without a declared precondition on the Jarvis page', () => {
    expect(resolveV8ScenarioPath('v8-001', setups, snapshot, 'http://127.0.0.1:3106'))
      .toBe('http://127.0.0.1:3106/jarvis');
  });

  it('rejects a missing, voided, or non-synthetic document precondition', () => {
    const setup = { version: 1, cases: { 'v8-150': { kind: 'selected_issued_document', source: 'currentDocument' } } };
    expect(() => resolveV8ScenarioPath('v8-150', setup, { currentDocument: null }, 'http://127.0.0.1:3106')).toThrow(/document/i);
    expect(() => resolveV8ScenarioPath('v8-150', setup, {
      currentDocument: { ...snapshot.currentDocument, status: 'voided' },
    }, 'http://127.0.0.1:3106')).toThrow(/issued/i);
    expect(() => resolveV8ScenarioPath('v8-150', setup, {
      currentDocument: { ...snapshot.currentDocument, is_synthetic: false },
    }, 'http://127.0.0.1:3106')).toThrow(/synthetic/i);
  });

  it('requires the opened document patient, identity, and revision in the submitted turn context', () => {
    const context = {
      patientId: snapshot.currentDocument.patient_id,
      page: '/documents',
      documentId: snapshot.currentDocument.id,
      documentRevision: snapshot.currentDocument.content_hash,
    };
    expect(() => assertV8ScenarioAppContext('v8-150', setups, snapshot, context)).not.toThrow();
    expect(() => assertV8ScenarioAppContext('v8-150', setups, snapshot, {
      ...context,
      patientId: '11111111-1111-4111-8111-111111111111',
    })).toThrow(/context/i);
    expect(() => assertV8ScenarioAppContext('v8-150', setups, snapshot, {
      ...context,
      documentRevision: 'b'.repeat(64),
    })).toThrow(/context/i);
    expect(() => assertV8ScenarioAppContext('v8-150', setups, snapshot, {
      ...context,
      page: '/jarvis',
    })).toThrow(/context/i);
  });

  it('surfaces failed same-origin Next assets without treating external assets as app failures', () => {
    expect(findV8StaticAssetFailures([
      { url: 'http://127.0.0.1:3106/_next/static/css/app.css', status: 400 },
      { url: 'http://127.0.0.1:3106/_next/static/chunks/app.js', status: 200 },
      { url: 'https://fonts.example.test/font.woff2', status: 403 },
    ], 'http://127.0.0.1:3106')).toEqual([
      { path: '/_next/static/css/app.css', status: 400 },
    ]);
  });
});
