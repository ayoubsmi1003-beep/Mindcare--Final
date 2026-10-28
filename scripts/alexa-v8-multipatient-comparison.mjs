/** Sequential, authenticated UI sweep of consultation comparisons across synthetic patients. */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright';

import { evaluateBrowserAssetReadiness, parseV8Stream } from './lib/alexa-v8-evidence.mjs';
import { evaluateComparisonEvidence } from './lib/alexa-v8-comparison.mjs';

const root = process.cwd();
const evidenceRoot = resolve(root, '.eval-out/alexa-v8-upgrade');
const scaleOnly = process.env.ALEXA_V8_SCALE_ONLY === '1';
const runId = process.env.ALEXA_V8_RUN_ID ?? (scaleOnly ? 'scale-history-10-patients-20261028' : 'multipatient-comparison-20261027');
const outputPath = resolve(evidenceRoot, `${runId}.json`);
const screenshotRoot = resolve(evidenceRoot, 'screenshots', runId);
const manifestPath = resolve(root, 'tests/eval/alexa-v8-cases.json');
const modelPath = resolve(root, '.cache/alexa/minicpm/MiniCPM-V-4_7-1B-Q4_K_M.gguf');
const expectedModelHash = '588c6c94c82f756b86dba35c42ed9ba9ec187d65824eb52f039c347df563e63d';
const origin = process.env.ALEXA_V8_ORIGIN ?? 'http://127.0.0.1:3106';
const databaseUrl = 'postgresql://postgres@127.0.0.1:55445/alexa_eval_v8_intelligence_20261027';
const modelWaitMs = 600_000;
const patientLimit = Number(process.env.ALEXA_V8_PATIENT_LIMIT ?? 12);
const recheckAll = process.env.ALEXA_V8_RECHECK_ALL === '1';
const implementationFiles = [
  'src/server/alexa/agent-loop.ts',
  'src/server/alexa/agent-tools.ts',
  'src/server/alexa/clinical-narrative.ts',
  'src/server/alexa/local-response.ts',
  'src/shared/alexa/request-contract.ts',
  'src/shared/alexa/agent.ts',
  'src/i18n/alexa-narrative.ts',
  'src/server/alexa/session-summary.ts',
  'supabase/migrations/194_alexa_consultation_scale_read.sql',
];
const hash = (value) => createHash('sha256').update(value).digest('hex');

if (!Number.isInteger(patientLimit) || patientLimit < 1 || patientLimit > 12) throw new Error('ALEXA_V8_PATIENT_LIMIT must be an integer from 1 to 12');
if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(runId)) throw new Error('ALEXA_V8_RUN_ID must be a lowercase alphanumeric slug of at most 63 characters');

function assertTarget() {
  const url = new URL(databaseUrl);
  if (url.hostname !== '127.0.0.1' || url.port !== '55445' || url.pathname !== '/alexa_eval_v8_intelligence_20261027') {
    throw new Error('Disposable V8 evaluation database required');
  }
}

async function sha256File(path) {
  const { createReadStream } = await import('node:fs');
  const digest = createHash('sha256');
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolvePromise);
  });
  return digest.digest('hex');
}

function findUuid(value) {
  if (typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) return value;
  if (Array.isArray(value)) for (const item of value) { const found = findUuid(item); if (found) return found; }
  else if (value && typeof value === 'object') for (const item of Object.values(value)) { const found = findUuid(item); if (found) return found; }
  return null;
}

function conversationId(value) {
  if (Array.isArray(value)) return value.length ? conversationId(value[0]) : null;
  if (!value || typeof value !== 'object') return null;
  if (typeof value.conversationId === 'string') return value.conversationId;
  if (value.get_jarvis_history) return conversationId(value.get_jarvis_history);
  if (Array.isArray(value.data)) return conversationId(value.data);
  return null;
}

async function saveReport(report) {
  report.updatedAt = new Date().toISOString();
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, outputPath);
}

async function implementationFingerprint() {
  const sources = await Promise.all(implementationFiles.map(async (path) => [path, await readFile(resolve(root, path), 'utf8')]));
  return hash(JSON.stringify(sources));
}

async function setAttemptStage(attempt, report, stage) {
  attempt.stage = stage;
  attempt.stageUpdatedAt = new Date().toISOString();
  await saveReport(report);
}

async function readCandidates(db, cabinetId) {
  const snapshot = JSON.parse(await readFile(resolve(evidenceRoot, 'private-oracle-snapshot-v2.json'), 'utf8'));
  if (snapshot.source?.database !== 'alexa_eval_v8_intelligence_20261027' || snapshot.source?.patients !== 1558 || snapshot.source?.consultations !== 8143 || snapshot.source?.nonSynthetic !== 0) {
    throw new Error('Verified synthetic source snapshot required');
  }
  if (snapshot.owner?.cabinet_id !== cabinetId) throw new Error('Evaluation account cabinet differs from frozen snapshot');
  const result = await db.query(`
    WITH named_patients AS (
      SELECT id, count(*) OVER (PARTITION BY app.immutable_unaccent(lower(trim(first_name || ' ' || last_name))))::int AS same_name_count
      FROM app.patients WHERE cabinet_id = $1 AND is_synthetic IS TRUE AND is_active IS TRUE
    ), ranked AS (
      SELECT p.id, p.first_name, p.last_name, c.id AS consultation_id, c.started_at, c.raw_notes,
        n.subjective, n.objective, n.assessment, n.plan,
        count(c.id) OVER (PARTITION BY p.id)::int AS visit_count,
        row_number() OVER (PARTITION BY p.id ORDER BY c.started_at DESC, c.id DESC) AS visit_rank,
        names.same_name_count
      FROM app.patients p
      JOIN app.consultations c ON c.patient_id = p.id AND c.ended_at IS NOT NULL
      JOIN named_patients names ON names.id = p.id
      LEFT JOIN app.clinical_notes n ON n.consultation_id = c.id AND n.patient_id = p.id
      WHERE p.cabinet_id = $1 AND p.is_synthetic IS TRUE AND p.is_active IS TRUE
    ), paired AS (
      SELECT latest.id, latest.first_name, latest.last_name, latest.visit_count,
        latest.consultation_id AS latest_consultation_id, latest.started_at AS latest_started_at,
        latest.raw_notes AS latest_raw_notes, latest.subjective AS latest_subjective,
        latest.objective AS latest_objective, latest.assessment AS latest_assessment, latest.plan AS latest_plan,
        previous.consultation_id AS previous_consultation_id, previous.started_at AS previous_started_at,
        previous.raw_notes AS previous_raw_notes, previous.subjective AS previous_subjective,
        previous.objective AS previous_objective, previous.assessment AS previous_assessment, previous.plan AS previous_plan,
        (SELECT count(*)::int FROM app.scale_administrations s WHERE s.patient_id = latest.id) AS scale_count
      FROM ranked latest
      JOIN ranked previous ON previous.id = latest.id AND previous.visit_rank = 2
      WHERE latest.visit_rank = 1 AND latest.same_name_count = 1 AND previous.same_name_count = 1
        AND coalesce(nullif(trim(latest.subjective), ''), nullif(trim(latest.raw_notes), ''), nullif(trim(latest.assessment), ''), nullif(trim(latest.plan), '')) IS NOT NULL
        AND coalesce(nullif(trim(previous.subjective), ''), nullif(trim(previous.raw_notes), ''), nullif(trim(previous.assessment), ''), nullif(trim(previous.plan), '')) IS NOT NULL
    ), bucketed AS (
      SELECT *, CASE WHEN visit_count <= 4 THEN 'short' WHEN visit_count BETWEEN 5 AND 30 THEN 'medium' WHEN visit_count > 100 THEN 'long' END AS band
      FROM paired WHERE visit_count BETWEEN 2 AND 4 OR visit_count BETWEEN 5 AND 30 OR visit_count > 100
    ), selected AS (
      SELECT *, row_number() OVER (PARTITION BY band ORDER BY md5(id::text)) AS band_rank FROM bucketed
    )
    SELECT * FROM selected WHERE (band = 'short' AND band_rank <= 4) OR (band = 'medium' AND band_rank <= 5) OR (band = 'long' AND band_rank <= 3)
    ORDER BY CASE band WHEN 'short' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, band_rank` , [cabinetId]);
  const rows = result.rows;
  if (rows.length !== 12 || rows.filter((row) => row.band === 'long').length !== 3 || new Set(rows.map((row) => row.id)).size !== 12) {
    throw new Error(`Expected a varied 12-patient sample; received ${rows.length}`);
  }
  return { rows, snapshot };
}

async function readScaleCandidates(db) {
  const seedPlan = JSON.parse(await readFile(resolve(evidenceRoot, 'scale-seed-10-patients-plan.json'), 'utf8'));
  const seedReport = JSON.parse(await readFile(resolve(evidenceRoot, 'scales-10-patients-seed-20261028.json'), 'utf8'));
  const patientIds = seedPlan.selectedPatients.map((patient) => patient.id);
  const consultationIds = seedPlan.consultations.map((consultation) => consultation.consultationId);
  if (seedPlan.validated !== true || seedReport.status !== 'PASS' || seedReport.coverage?.patients !== 10 || seedReport.coverage?.administrations !== 40) {
    throw new Error('Verified 10-patient synthetic scale seed required');
  }
  const patients = (await db.query(`SELECT p.id,p.first_name,p.last_name,p.cabinet_id,p.is_synthetic,
      count(DISTINCT c.id)::int AS visit_count
    FROM app.patients p LEFT JOIN app.consultations c ON c.patient_id=p.id
    WHERE p.id=ANY($1::uuid[]) GROUP BY p.id`, [patientIds])).rows;
  if (patients.length !== 10 || patients.some((patient) => patient.cabinet_id !== seedReport.actor.cabinetId || patient.is_synthetic !== true)) {
    throw new Error('Seeded patient ownership or synthetic state changed');
  }
  const administrations = (await db.query(`SELECT sa.id,sa.patient_id,sa.consultation_id,c.started_at,c.status,
      sc.code AS scale_code,sc.name_fr AS scale_name,sa.total_score,sa.interpretation,sa.is_synthetic
    FROM app.scale_administrations sa
    JOIN app.scales sc ON sc.id=sa.scale_id
    JOIN app.consultations c ON c.id=sa.consultation_id AND c.patient_id=sa.patient_id
    WHERE sa.patient_id=ANY($1::uuid[]) AND sa.consultation_id=ANY($2::uuid[])
    ORDER BY sa.patient_id,c.started_at,sc.code`, [patientIds, consultationIds])).rows;
  if (administrations.length !== 40 || administrations.some((row) => row.is_synthetic !== true || row.status !== 'closed')) {
    throw new Error('Expected 40 synthetic scales linked to 20 completed consultations');
  }
  const reportRecords = new Map(seedReport.records.map((row) => [`${row.id}:${row.total}:${row.interpretation}`, row]));
  if (administrations.some((row) => !reportRecords.has(`${row.id}:${row.total_score}:${row.interpretation}`))) {
    throw new Error('Database scale rows differ from the committed seed receipt');
  }
  const patientById = new Map(patients.map((patient) => [patient.id, patient]));
  const seedPatientById = new Map(seedPlan.selectedPatients.map((patient) => [patient.id, patient]));
  const evidenceByPatient = new Map(patientIds.map((id) => [id, []]));
  for (const row of administrations) evidenceByPatient.get(row.patient_id).push({
    id: row.id, consultationId: row.consultation_id, consultationStartedAt: row.started_at,
    scaleCode: row.scale_code, scaleName: row.scale_name, score: Number(row.total_score), interpretation: row.interpretation,
  });
  const rows = patientIds.map((id) => {
    const patient = patientById.get(id);
    return { id, first_name: patient.first_name, last_name: patient.last_name,
      band: seedPatientById.get(id).band, visit_count: patient.visit_count,
      scale_count: evidenceByPatient.get(id).length, scaleEvidence: evidenceByPatient.get(id) };
  });
  if (rows.some((patient) => patient.scale_count !== 4)) throw new Error('Each seeded patient must have four scale administrations');
  return { rows, snapshot: { target: seedReport.target, seedId: seedReport.seedId, patients, administrations } };
}

function installStreamCapture(page) {
  return page.addInitScript(() => {
    const target = window;
    target.__alexaMultiCapture = Object.create(null);
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      let url;
      try { url = new URL(typeof input === 'string' ? input : input.url, location.href); } catch { return response; }
      if (url.pathname !== '/api/alexa/turn') return response;
      let request;
      try { request = JSON.parse(typeof init?.body === 'string' ? init.body : '{}'); } catch { return response; }
      if (typeof request.clientTurnId !== 'string') return response;
      const state = { status: response.status, raw: '', finished: false, events: [], eventTiming: [], stage: 'awaiting_first_event', startedAt: performance.now() };
      target.__alexaMultiCapture[request.clientTurnId] = state;
      void (async () => {
        const reader = response.clone().body?.getReader();
        if (!reader) { state.finished = true; return; }
        const decoder = new TextDecoder();
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            state.raw += decoder.decode(next.value, { stream: true });
            let boundary;
            while ((boundary = state.raw.indexOf('\n\n')) !== -1) {
              const frame = state.raw.slice(0, boundary);
              state.raw = state.raw.slice(boundary + 2);
              const data = frame.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
              if (data) {
                try {
                  const event = JSON.parse(data);
                  state.events.push(event);
                  if (event.type === 'stage') state.stage = event.stage;
                  state.eventTiming.push({ type: event.type, stage: event.type === 'stage' ? event.stage : null, atMs: Math.round(performance.now() - state.startedAt) });
                } catch { /* retain malformed stream for the final parser */ }
              }
            }
          }
          state.raw = `${state.raw}${decoder.decode()}`;
          state.raw = state.events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
        } finally { state.finished = true; }
      })();
      return response;
    };
  });
}

function isJarvisHistoryResponse(response) {
  if (new URL(response.url()).pathname !== '/api/db/rpc' || response.request().method() !== 'POST') return false;
  try { return response.request().postDataJSON()?.name === 'get_jarvis_history'; } catch { return false; }
}

function observeBrowserAssets(page) {
  const responses = [];
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/_next/static/')) responses.push({ path, status: response.status() });
  });
  page.on('requestfailed', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/_next/static/')) responses.push({ path, status: 0 });
  });
  return responses;
}

async function loadJarvisUi(page, origin) {
  const browserAssets = observeBrowserAssets(page);
  const historyResponses = [];
  const historyListener = (response) => { if (isJarvisHistoryResponse(response)) historyResponses.push(response); };
  page.on('response', historyListener);
  try {
    await page.goto(`${origin}/jarvis`, { waitUntil: 'load', timeout: 60_000 });
    const assetReadiness = evaluateBrowserAssetReadiness(browserAssets);
    if (!assetReadiness.ready) throw new Error(`Jarvis client assets failed preflight (${assetReadiness.failed.length}/${assetReadiness.checked})`);
    const historyResponse = historyResponses[0] ?? await page.waitForResponse(isJarvisHistoryResponse, { timeout: 60_000 });
    const historyBody = await historyResponse.json().catch(() => null);
    if (!historyResponse.ok() || historyBody?.ok !== true) throw new Error('Jarvis history preflight failed');
    await page.locator('main textarea').last().waitFor({ state: 'visible', timeout: 60_000 });
    return { historyBody, historyStatus: historyResponse.status(), assetReadiness };
  } finally {
    page.off('response', historyListener);
  }
}

async function authenticate(context, page, origin, evidenceRoot) {
  const browserAssets = observeBrowserAssets(page);
  const auth = JSON.parse(await readFile(resolve(evidenceRoot, 'browser-auth.json'), 'utf8'));
  const browserSessionPath = resolve(evidenceRoot, 'browser-session.json');
  const session = existsSync(browserSessionPath) ? JSON.parse(await readFile(browserSessionPath, 'utf8')) : null;
  if (session?.token && Date.parse(session.expiresAt) > Date.now()) {
    await context.addCookies([{ name: 'mc_session', value: session.token, url: origin, httpOnly: true, secure: false, sameSite: 'Lax', expires: Math.floor(Date.parse(session.expiresAt) / 1000) }]);
  } else {
    await page.goto(`${origin}/connexion`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => { const input = document.querySelector('input'); return input && Object.keys(input).some((key) => key.startsWith('__reactProps$')); }, null, { timeout: 60_000 });
    await page.locator('input').nth(0).fill(auth.email);
    await page.locator('input').nth(1).fill(auth.password);
    const signIn = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/sign-in', { timeout: 60_000 });
    await page.locator('button[type=submit]').click();
    const response = await signIn;
    const body = await response.json().catch(() => null);
    if (!response.ok() || body?.ok !== true) throw new Error('Authenticated UI login failed');
  }
  await page.goto(`${origin}/patients`, { waitUntil: 'load', timeout: 60_000 });
  const patientAssetReadiness = evaluateBrowserAssetReadiness(browserAssets);
  if (!patientAssetReadiness.ready) throw new Error(`Patient client assets failed preflight (${patientAssetReadiness.failed.length}/${patientAssetReadiness.checked})`);
  const sessionCheck = await page.evaluate(async () => { const r = await fetch('/api/auth/session', { cache: 'no-store' }); const b = await r.json().catch(() => null); return { status: r.status, ok: b?.ok === true && b?.data !== null }; });
  const cookie = (await context.cookies(origin)).find((item) => item.name === 'mc_session');
  if (!sessionCheck.ok || !cookie?.httpOnly || new URL(page.url()).pathname !== '/patients') throw new Error('Authenticated app session could not be verified');
  const jarvisUi = await loadJarvisUi(page, origin);
  return { status: sessionCheck.status, session: 'verified', jarvisUi: 'hydrated', composer: 'visible', historyStatus: jarvisUi.historyStatus,
    clientAssets: { patients: patientAssetReadiness, jarvis: jarvisUi.assetReadiness } };
}

async function startConversation(page) {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/db/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ name: 'start_jarvis_conversation', args: {} }) });
    const body = await response.json().catch(() => null);
    return { ok: response.ok && body?.ok === true, data: body?.data ?? null };
  });
  const id = findUuid(result.data);
  if (!result.ok || !id) throw new Error('Conversation could not be started');
  return id;
}

async function verifyConversationLoaded(page, origin, id) {
  const loaded = await loadJarvisUi(page, origin);
  if (conversationId(loaded.historyBody.data) !== id) throw new Error('Conversation history did not load for the selected conversation');
}

async function ask(page, prompt, conversation, patientId, turnNumber, onProgress) {
  const startedAt = Date.now();
  const request = page.waitForRequest((item) => new URL(item.url()).pathname === '/api/alexa/turn' && item.method() === 'POST', { timeout: 60_000 });
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === '/api/alexa/turn' && item.request().method() === 'POST', { timeout: modelWaitMs + 120_000 });
  await page.locator('main textarea').last().fill(prompt);
  await page.getByRole('button', { name: /Envoyer/iu }).last().click({ timeout: 30_000 });
  const sent = await request;
  const body = sent.postDataJSON();
  if (body.text !== prompt || body.conversationId !== conversation || !body.clientTurnId) throw new Error('Turn request did not match the evaluated conversation');
  const finishedResponse = await response;
  const deadline = Date.now() + modelWaitMs;
  let capture;
  let nextProgress = Date.now() + 30_000;
  while (Date.now() < deadline) {
    capture = await page.evaluate((id) => {
      const state = window.__alexaMultiCapture?.[id];
      return state ? { status: state.status, raw: state.raw, events: state.events, eventTiming: state.eventTiming, stage: state.stage, finished: state.finished } : null;
    }, body.clientTurnId);
    if (capture?.finished) break;
    if (Date.now() >= nextProgress) {
      const progress = { patientId, turn: turnNumber, elapsedMs: Date.now() - startedAt, stage: capture?.stage ?? 'awaiting_first_event', events: capture?.events?.length ?? 0 };
      console.log(JSON.stringify(progress));
      await onProgress?.(progress);
      nextProgress = Date.now() + 30_000;
    }
    await page.waitForTimeout(1_500);
  }
  if (!capture?.finished || capture.status !== 200) throw new Error('MiniCPM stream did not complete');
  const finalEvent = capture.events.at(-1);
  const parsed = finalEvent?.type === 'error'
    ? { events: capture.events, answer: capture.events.filter((event) => event.type === 'sentence').map((event) => event.text).join(' '), terminal: finalEvent, verdict: 'FAIL' }
    : parseV8Stream(capture.raw);
  const answer = parsed.answer;
  if (answer.trim()) await page.waitForFunction((expected) => [...document.querySelectorAll('[role="log"]')].some((node) => node.innerText.replace(/\s+/gu, ' ').includes(expected.replace(/\s+/gu, ' ').trim())), answer, { timeout: 60_000 });
  const sourceReferences = [...new Map(parsed.events.flatMap((event) => event.type === 'sentence' && Array.isArray(event.sources) ? event.sources.filter((source) => typeof source?.id === 'string').map((source) => [JSON.stringify([source.type, source.id]), { id: source.id, type: source.type, label: source.label ?? null }]) : [])).values()];
  const sourceIds = sourceReferences.map((source) => source.id);
  const runtimeRoute = parsed.terminal?.coverage === null && Array.isArray(parsed.terminal?.parts) ? 'native' : 'legacy';
  const result = { prompt, answer, clientTurnId: body.clientTurnId, status: finishedResponse.status(), runtimeRoute, terminal: parsed.terminal, sourceIds, sourceReferences, stageTimeline: capture.eventTiming.filter((event) => event.type === 'stage'), elapsedMs: Date.now() - startedAt };
  return result;
}

assertTarget();
const manifestText = await readFile(manifestPath, 'utf8');
const modelSha256 = await sha256File(modelPath);
if (modelSha256 !== expectedModelHash) throw new Error('Pinned MiniCPM fingerprint changed');
const manifest = JSON.parse(manifestText);
if (manifest.status !== 'FROZEN' || manifest.cases.length !== 200) throw new Error('Frozen 200-case acceptance manifest is required');
await mkdir(screenshotRoot, { recursive: true });

const db = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 30_000, application_name: runId });
let browser;
try {
  await db.connect();
  const sourceCounts = (await db.query(`SELECT current_database() AS database,
    (SELECT count(*)::int FROM app.patients) AS patients,
    (SELECT count(*)::int FROM app.patients WHERE is_synthetic IS DISTINCT FROM true) AS non_synthetic,
    (SELECT count(*)::int FROM app.consultations) AS consultations,
    (SELECT count(*)::int FROM app.scale_administrations) AS scales`)).rows[0];
  if (sourceCounts.database !== 'alexa_eval_v8_intelligence_20261027' || sourceCounts.patients !== 1558 || sourceCounts.consultations !== 8143 || sourceCounts.non_synthetic !== 0) throw new Error('Disposable evaluation source changed');
  const snapshot = scaleOnly ? null : JSON.parse(await readFile(resolve(evidenceRoot, 'private-oracle-snapshot-v2.json'), 'utf8'));
  const { rows, snapshot: verifiedSnapshot } = scaleOnly
    ? await readScaleCandidates(db)
    : await readCandidates(db, snapshot.owner.cabinet_id);
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const implementationSha256 = await implementationFingerprint();
  if (!scaleOnly && rows.some((row) => Number(row.scale_count) !== 0)) throw new Error('Scale source changed; refresh independent scale oracles before this sweep');
  let report = existsSync(outputPath) ? JSON.parse(await readFile(outputPath, 'utf8')) : null;
  if (report && (report.modelSha256 !== modelSha256 || report.sourceCounts.database !== sourceCounts.database || report.patients.length !== rows.length || JSON.stringify(report.patientCoverage?.references) !== JSON.stringify(rows.map((row) => row.id)))) throw new Error('Existing supplemental evidence has a different source or model');
  if (!report) report = {
    version: 1, state: 'IN_PROGRESS', createdAt: new Date().toISOString(), runId, sourceHead,
    origin, database: '127.0.0.1:55445/alexa_eval_v8_intelligence_20261027', model: 'MiniCPM-V-4_7-1B-Q4_K_M.gguf', modelSha256,
    implementationSha256,
    campaignManifestSha256: hash(manifestText), snapshotSha256: hash(JSON.stringify(verifiedSnapshot)), answersInjected: false, routesMocked: false, patientCoverage: { selected: rows.length, references: [...new Set(rows.map((row) => row.id))] }, sourceCounts,
    patients: rows.map((row) => ({
      id: row.id, name: `${row.first_name} ${row.last_name}`.trim(), band: row.band, completedConsultations: Number(row.visit_count), scaleCount: Number(row.scale_count),
      scaleEvidence: row.scaleEvidence ?? [],
      previous: { consultationId: row.previous_consultation_id, startedAt: row.previous_started_at, rawNotes: row.previous_raw_notes, subjective: row.previous_subjective, objective: row.previous_objective, assessment: row.previous_assessment, plan: row.previous_plan },
      latest: { consultationId: row.latest_consultation_id, startedAt: row.latest_started_at, rawNotes: row.latest_raw_notes, subjective: row.latest_subjective, objective: row.latest_objective, assessment: row.latest_assessment, plan: row.latest_plan },
      attempts: [], status: 'NOT RUN',
    })),
  };
  if (report.state !== 'IN_PROGRESS') {
    report.resumeHistory ??= [];
    report.resumeHistory.push({ from: report.state, resumedAt: new Date().toISOString() });
    report.state = 'IN_PROGRESS';
  }
  report.latestAttemptSource = { sourceHead, implementationSha256, recheckAll };
  report.implementationHistory ??= [];
  if (report.implementationHistory.at(-1)?.implementationSha256 !== implementationSha256) {
    report.implementationHistory.push({ at: new Date().toISOString(), sourceHead, implementationSha256 });
  }
  for (const patient of report.patients) {
    for (const attempt of patient.attempts) {
      if (attempt.status !== 'RUNNING') continue;
      attempt.status = 'INTERRUPTED';
      attempt.failureStage = attempt.stage ?? 'before-stage-instrumentation';
      attempt.failure = 'EvaluatorProcessStopped';
      attempt.finishedAt = new Date().toISOString();
      delete attempt.currentTurn;
      if (patient.status !== 'OBSERVED') patient.status = 'NOT RUN';
    }
  }
  await saveReport(report);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  context.setDefaultTimeout(60_000);
  const controlPage = await context.newPage();
  const authentication = await authenticate(context, controlPage, origin, evidenceRoot);
  report.authentication = authentication;
  await saveReport(report);
  console.log(JSON.stringify({ setup: 'AUTHENTICATED_UI_PASS', authentication: authentication.session, patientCount: rows.length, bands: rows.reduce((totals, row) => ({ ...totals, [row.band]: (totals[row.band] ?? 0) + 1 }), {}), scaleAdministrationsInDisposableSource: sourceCounts.scales, modelSha256, sourceHead, implementationSha256, recheckAll }));

  const pendingPatients = report.patients.filter((patient) => recheckAll || (patient.status !== 'PENDING_REVIEW' && patient.status !== 'OBSERVED'));
  const patientsToRun = pendingPatients.slice(0, patientLimit);
  const partialBatch = patientsToRun.length < pendingPatients.length;
  for (const patient of patientsToRun) {
    const attemptNumber = patient.attempts.length + 1;
    const screenshotPrefix = `${patient.id}-attempt-${String(attemptNumber).padStart(2, '0')}`;
    const attempt = { attemptNumber, sourceHead, implementationSha256, startedAt: new Date().toISOString(), turns: [], screenshots: [], conversationId: null, status: 'RUNNING' };
    patient.attempts.push(attempt);
    await saveReport(report);
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    await installStreamCapture(page);
    try {
      await setAttemptStage(attempt, report, 'create-conversation');
      attempt.conversationId = await startConversation(controlPage);
      await setAttemptStage(attempt, report, 'load-conversation-history');
      await verifyConversationLoaded(page, origin, attempt.conversationId);
      if (scaleOnly) {
        const question = `Quelles échelles ont été administrées à ${patient.name}, et dans quelles consultations ?`;
        await setAttemptStage(attempt, report, 'summarize-scales');
        const scales = await ask(page, question, attempt.conversationId, patient.id, 1, async (progress) => { attempt.currentTurn = progress; await saveReport(report); });
        delete attempt.currentTurn;
        const normalized = scales.answer.normalize('NFD').replace(/\p{M}/gu, '').replace(/[‑–]/gu, '-').toLowerCase();
        const exactScores = patient.scaleEvidence.every((item) => new RegExp(`\\b${item.score}\\b`, 'u').test(normalized));
        const exactInterpretations = patient.scaleEvidence.every((item) => normalized.includes(item.interpretation.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()));
        const bothScaleNames = /phq\s*-?\s*9/u.test(normalized) && /gad\s*-?\s*7/u.test(normalized);
        const administrationSources = patient.scaleEvidence.every((item) => scales.sourceReferences.some((source) => source.type === 'scale' && source.id === item.id));
        const scaleValid = scales.runtimeRoute === 'native' && scales.terminal?.patientId === patient.id && exactScores && exactInterpretations && bothScaleNames && administrationSources && !/aucune? echelle|aucun resultat/iu.test(normalized);
        const scaleEvidence = { exactScores, exactInterpretations, bothScaleNames, administrationSources, expectedAdministrationCount: patient.scaleEvidence.length };
        attempt.turns.push({ ...scales, expectedScaleEvidence: patient.scaleEvidence, scaleEvidence, passed: scaleValid, screenshot: `${screenshotPrefix}-scales.png` });
        await page.screenshot({ path: resolve(screenshotRoot, `${screenshotPrefix}-scales.png`), fullPage: true, timeout: 60_000 });
        attempt.screenshots.push({ turn: 1, path: `screenshots/${runId}/${screenshotPrefix}-scales.png`, kind: 'answer' });
        await saveReport(report);

        await setAttemptStage(attempt, report, 'reload-scale-answer');
        const reloadPromise = page.waitForResponse(isJarvisHistoryResponse, { timeout: 60_000 });
        await page.reload({ waitUntil: 'load', timeout: 60_000 });
        const reloadResponse = await reloadPromise;
        const reloadBody = await reloadResponse.json().catch(() => null);
        if (!reloadResponse.ok() || reloadBody?.ok !== true || conversationId(reloadBody.data) !== attempt.conversationId) throw new Error('Scale answer did not persist through reload');
        await page.locator('main textarea').last().waitFor({ state: 'visible', timeout: 60_000 });
        await page.screenshot({ path: resolve(screenshotRoot, `${screenshotPrefix}-scales-after-reload.png`), fullPage: true, timeout: 60_000 });
        attempt.screenshots.push({ turn: 1, path: `screenshots/${runId}/${screenshotPrefix}-scales-after-reload.png`, kind: 'after-reload' });
        const persisted = (await db.query(`SELECT count(*) FILTER (WHERE role='humain')::int AS human_messages,
            count(*) FILTER (WHERE role='jarvis')::int AS assistant_messages
          FROM app.jarvis_messages WHERE conversation_id=$1`, [attempt.conversationId])).rows[0];
        attempt.database = persisted;
        attempt.finishedAt = new Date().toISOString();
        attempt.status = 'OBSERVED';
        attempt.stage = 'complete';
        patient.status = scaleValid && persisted.human_messages === 1 && persisted.assistant_messages >= 1 ? 'PENDING_REVIEW' : 'FAIL';
        console.log(JSON.stringify({ patient: patient.id, band: patient.band, status: patient.status, scaleMs: scales.elapsedMs, scaleCount: patient.scaleCount, scaleEvidence }));
        continue;
      }
      const question = `Compare les deux dernières consultations terminées de ${patient.name}. Explique ce qui a changé dans les difficultés, l’évolution rapportée et le plan de suivi, puis ce qui reste identique.`;
      await setAttemptStage(attempt, report, 'compare-consultations');
      const comparison = await ask(page, question, attempt.conversationId, patient.id, 1, async (progress) => { attempt.currentTurn = progress; await saveReport(report); });
      delete attempt.currentTurn;
      const expectedConsultationIds = [patient.previous.consultationId, patient.latest.consultationId];
      const comparisonEvidence = evaluateComparisonEvidence(comparison.answer, patient.previous, patient.latest);
      const comparisonValid = comparison.runtimeRoute === 'native' && comparison.terminal?.patientId === patient.id && comparisonEvidence.passed && expectedConsultationIds.every((id) => comparison.sourceReferences.some((source) => source.type === 'consultation' && source.id === id));
      attempt.turns.push({ ...comparison, expectedConsultationIds, expectedPatientId: patient.id, comparisonEvidence, passed: comparisonValid, screenshot: `${screenshotPrefix}-comparison.png` });
      const comparisonScreenshot = resolve(screenshotRoot, `${screenshotPrefix}-comparison.png`);
      await page.screenshot({ path: comparisonScreenshot, fullPage: true, timeout: 60_000 });
      attempt.screenshots.push({ turn: 1, path: `screenshots/${runId}/${screenshotPrefix}-comparison.png`, kind: 'answer' });
      await saveReport(report);

      await setAttemptStage(attempt, report, 'reload-comparison');
      const historyPromise = page.waitForResponse(isJarvisHistoryResponse, { timeout: 60_000 });
      await page.reload({ waitUntil: 'load', timeout: 60_000 });
      const historyResponse = await historyPromise;
      const historyBody = await historyResponse.json().catch(() => null);
      if (!historyResponse.ok() || historyBody?.ok !== true || conversationId(historyBody.data) !== attempt.conversationId) throw new Error('Comparison did not persist through reload');
      await page.locator('main textarea').last().waitFor({ state: 'visible', timeout: 60_000 });
      const reloadedScreenshot = resolve(screenshotRoot, `${screenshotPrefix}-comparison-after-reload.png`);
      await page.screenshot({ path: reloadedScreenshot, fullPage: true, timeout: 60_000 });
      attempt.screenshots.push({ turn: 1, path: `screenshots/${runId}/${screenshotPrefix}-comparison-after-reload.png`, kind: 'after-reload' });

      const scaleQuestion = `Quelles échelles ont été administrées à ${patient.name}, et dans quelles consultations ?`;
      await setAttemptStage(attempt, report, 'summarize-scales');
      const scales = await ask(page, scaleQuestion, attempt.conversationId, patient.id, 2, async (progress) => { attempt.currentTurn = progress; await saveReport(report); });
      delete attempt.currentTurn;
      const scaleValid = scales.runtimeRoute === 'native' && scales.terminal?.patientId === patient.id && /aucun|aucune/iu.test(scales.answer) && !/score\s+\d/iu.test(scales.answer) && !scales.sourceReferences.some((source) => source.type === 'scale');
      attempt.turns.push({ ...scales, expectedScaleCount: patient.scaleCount, passed: scaleValid, screenshot: `${screenshotPrefix}-scales.png` });
      const scaleScreenshot = resolve(screenshotRoot, `${screenshotPrefix}-scales.png`);
      await page.screenshot({ path: scaleScreenshot, fullPage: true, timeout: 60_000 });
      attempt.screenshots.push({ turn: 2, path: `screenshots/${runId}/${screenshotPrefix}-scales.png`, kind: 'answer' });
      await saveReport(report);

      await setAttemptStage(attempt, report, 'reload-scale-answer');
      const reloadPromise = page.waitForResponse(isJarvisHistoryResponse, { timeout: 60_000 });
      await page.reload({ waitUntil: 'load', timeout: 60_000 });
      const reloadResponse = await reloadPromise;
      const reloadBody = await reloadResponse.json().catch(() => null);
      if (!reloadResponse.ok() || reloadBody?.ok !== true || conversationId(reloadBody.data) !== attempt.conversationId) throw new Error('Scale follow-up did not persist through reload');
      await page.locator('main textarea').last().waitFor({ state: 'visible', timeout: 60_000 });
      const finalScreenshot = resolve(screenshotRoot, `${screenshotPrefix}-scales-after-reload.png`);
      await page.screenshot({ path: finalScreenshot, fullPage: true, timeout: 60_000 });
      attempt.screenshots.push({ turn: 2, path: `screenshots/${runId}/${screenshotPrefix}-scales-after-reload.png`, kind: 'after-reload' });
      await setAttemptStage(attempt, report, 'verify-persisted-effects');
      const persisted = await db.query(`SELECT EXISTS(SELECT 1 FROM app.jarvis_conversations WHERE id=$1) AS conversation_exists,
        count(*) FILTER (WHERE role='humain')::int AS human_messages,
        count(*) FILTER (WHERE role='jarvis')::int AS assistant_messages
        FROM app.jarvis_messages WHERE conversation_id=$1`, [attempt.conversationId]);
      attempt.database = persisted.rows[0];
      attempt.finishedAt = new Date().toISOString();
      attempt.status = 'OBSERVED';
      attempt.stage = 'complete';
      patient.status = comparisonValid && scaleValid && persisted.rows[0].human_messages === 2 && persisted.rows[0].assistant_messages >= 2 ? 'PENDING_REVIEW' : 'FAIL';
      console.log(JSON.stringify({ patient: patient.id, band: patient.band, status: patient.status, comparisonMs: comparison.elapsedMs, scaleMs: scales.elapsedMs, sourceVisits: comparison.sourceIds.filter((id) => expectedConsultationIds.includes(id)).length, scaleCount: patient.scaleCount }));
    } catch (error) {
      attempt.finishedAt = new Date().toISOString();
      attempt.status = 'INFRASTRUCTURE_FAILURE';
      attempt.failureStage = attempt.stage ?? 'unknown';
      attempt.failure = error instanceof Error ? error.name : 'Error';
      patient.status = 'NOT RUN';
      console.log(JSON.stringify({ patient: patient.id, status: 'INFRASTRUCTURE_FAILURE', stage: attempt.failureStage, failure: attempt.failure }));
    } finally {
      await page.close().catch(() => {});
      await saveReport(report);
    }
  }

  const after = (await db.query(`SELECT (SELECT count(*)::int FROM app.patients) AS patients,
    (SELECT count(*)::int FROM app.consultations) AS consultations,
    (SELECT count(*)::int FROM app.scale_administrations) AS scales`)).rows[0];
  report.postRunSourceCounts = after;
  report.clinicalSourceTablesUnchanged = after.patients === sourceCounts.patients && after.consultations === sourceCounts.consultations && after.scales === sourceCounts.scales;
  report.state = report.patients.every((patient) => patient.status === 'PENDING_REVIEW') && report.clinicalSourceTablesUnchanged
    ? 'PENDING_REVIEW' : partialBatch ? 'IN_PROGRESS' : 'FAILURES_RETAINED';
  report.finishedAt = new Date().toISOString();
  await saveReport(report);
  console.log(JSON.stringify({ state: report.state, patients: report.patients.length, observed: report.patients.filter((patient) => patient.status === 'PENDING_REVIEW').length, clinicalSourceTablesUnchanged: report.clinicalSourceTablesUnchanged, reportPath: outputPath, screenshotRoot }));
} finally {
  await browser?.close().catch(() => {});
  await db.end().catch(() => {});
}
