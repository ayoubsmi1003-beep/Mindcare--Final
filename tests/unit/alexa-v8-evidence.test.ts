import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { evaluateBrowserAssetReadiness, parseV8Stream, resolveV8RunPaths } from '../../scripts/lib/alexa-v8-evidence.mjs';

describe('Alexa V8 observed stream evidence', () => {
  it('blocks authenticated UI evaluation when a required Next client asset fails', () => {
    expect(evaluateBrowserAssetReadiness([
      { path: '/_next/static/chunks/app/jarvis.js', status: 200 },
      { path: '/_next/static/chunks/webpack.js', status: 400 },
      { path: '/api/health', status: 200 },
    ])).toEqual({
      ready: false,
      checked: 2,
      failed: [{ path: '/_next/static/chunks/webpack.js', status: 400 }],
    });
  });

  it('requires at least one loaded Next client asset before accepting UI readiness', () => {
    expect(evaluateBrowserAssetReadiness([])).toEqual({ ready: false, checked: 0, failed: [] });
    expect(evaluateBrowserAssetReadiness([
      { path: '/_next/static/chunks/app/jarvis.js', status: 200 },
    ])).toEqual({ ready: true, checked: 1, failed: [] });
  });

  it('keeps the frozen baseline report fixed and isolates named rerun evidence', () => {
    const root = resolve('eval-private');
    expect(resolveV8RunPaths(root, 'baseline')).toEqual({
      reportPath: resolve(root, 'baseline-40.json'),
      screenshotRoot: resolve(root, 'screenshots', 'baseline'),
    });
    expect(resolveV8RunPaths(root, 'after')).toEqual({
      reportPath: resolve(root, 'baseline-40-after.json'),
      screenshotRoot: resolve(root, 'screenshots', 'after'),
    });
    expect(() => resolveV8RunPaths(root, '../outside')).toThrow(/invalid/i);
  });

  it('reads the real sentence and terminal events in order', () => {
    const stream = 'data: {"type":"stage","stage":"analysis"}\n\n' +
      'data: {"type":"sentence","text":"Réponse réelle."}\n\n' +
      'data: {"type":"done","status":"completed","persiste":true}\n\n';
    const evidence = parseV8Stream(stream);
    expect(evidence.answer).toBe('Réponse réelle.');
    expect(evidence.terminal.status).toBe('completed');
    expect(evidence.terminal.persiste).toBe(true);
    expect(evidence.verdict).toBe('PENDING_REVIEW');
  });

  it('rejects a stream that ends without a terminal event', () => {
    expect(() => parseV8Stream('data: {"type":"sentence","text":"Partiel."}\n\n')).toThrow(/terminal/i);
  });

  it('rejects more than one terminal event', () => {
    const done = 'data: {"type":"done","status":"completed"}\n\n';
    expect(() => parseV8Stream(done + done)).toThrow(/terminal/i);
  });

  it('rejects malformed event data rather than counting it as an answer', () => {
    expect(() => parseV8Stream('data: {not-json}\n\n')).toThrow(/malformed/i);
  });
});
