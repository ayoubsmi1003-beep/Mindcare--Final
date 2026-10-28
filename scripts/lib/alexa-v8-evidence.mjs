import { resolve } from 'node:path';

/** Block expensive live-model runs when the browser cannot hydrate its UI. */
export function evaluateBrowserAssetReadiness(responses) {
  const assets = Array.isArray(responses)
    ? responses.filter((response) => response && typeof response.path === 'string' && response.path.startsWith('/_next/static/'))
    : [];
  const failed = assets.filter((asset) => !Number.isInteger(asset.status) || asset.status === 0 || asset.status < 200 || asset.status >= 400)
    .map(({ path, status }) => ({ path, status }));
  return { ready: assets.length > 0 && failed.length === 0, checked: assets.length, failed };
}

/** Parse observed SSE only; a valid stream still needs independent answer review. */
export function parseV8Stream(payload) {
  if (typeof payload !== 'string' || payload.length > 8_000_000) throw new Error('Malformed stream');
  const normalized = payload.replace(/\r\n/gu, '\n');
  if (!normalized.endsWith('\n\n')) throw new Error('Incomplete terminal stream');
  const events = [];
  for (const frame of normalized.split('\n\n')) {
    if (!frame.trim()) continue;
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /u, '')).join('\n');
    if (!data) continue;
    let event;
    try { event = JSON.parse(data); } catch { throw new Error('Malformed stream event'); }
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') throw new Error('Malformed stream event');
    if (event.type === 'sentence' && typeof event.text !== 'string') throw new Error('Malformed sentence event');
    events.push(event);
  }
  const terminals = events.filter(event => event.type === 'done');
  if (terminals.length !== 1 || events.at(-1) !== terminals[0]) throw new Error('Missing or duplicate terminal event');
  const answer = events.filter(event => event.type === 'sentence').map(event => event.text).join(' ');
  return { events, answer, terminal: terminals[0], verdict: 'PENDING_REVIEW' };
}

/** Keep the original baseline path stable and isolate each named rerun. */
export function resolveV8RunPaths(root, runId = 'baseline') {
  if (typeof runId !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/u.test(runId)) {
    throw new Error('Invalid V8 evidence run id');
  }
  return {
    reportPath: resolve(root, runId === 'baseline' ? 'baseline-40.json' : `baseline-40-${runId}.json`),
    screenshotRoot: resolve(root, 'screenshots', runId),
  };
}
