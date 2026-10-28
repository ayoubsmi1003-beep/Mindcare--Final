/** Real, sequential browser baseline for the frozen Alexa V8 development subset. */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { chromium } from "playwright";

import { parseV8Stream, resolveV8RunPaths } from "./lib/alexa-v8-evidence.mjs";
import { assertV8ScenarioAppContext, findV8StaticAssetFailures, resolveV8AssistantInteraction, resolveV8ScenarioPath } from "./lib/alexa-v8-browser-context.mjs";
import { selectV8Cases, validateV8Manifest, validateV8Target, validateV8Source } from "./lib/alexa-v8-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privateRoot = resolve(root, ".eval-out/alexa-v8-upgrade");
const runId = process.env.ALEXA_V8_RUN_ID ?? "baseline";
const { reportPath, screenshotRoot } = resolveV8RunPaths(privateRoot, runId);
const manifestPath = resolve(root, "tests/eval/alexa-v8-cases.json");
const preconditionsPath = resolve(root, "tests/eval/alexa-v8-preconditions.json");
const snapshotPath = resolve(privateRoot, "private-oracle-snapshot-v2.json");
const oracleVersion = process.env.ALEXA_V8_ORACLE_VERSION ?? "v3";
if (!/^v[34]$/u.test(oracleVersion)) throw new Error("Unsupported private oracle revision");
const oraclePath = resolve(privateRoot, `private-oracles-${oracleVersion}.json`);
const authPath = resolve(privateRoot, "browser-auth.json");
const browserSessionPath = resolve(privateRoot, "browser-session.json");
const origin = process.env.ALEXA_V8_ORIGIN ?? "http://127.0.0.1:3106";
const expectedModelHash = "588c6c94c82f756b86dba35c42ed9ba9ec187d65824eb52f039c347df563e63d";
const modelPath = resolve(root, ".cache/alexa/minicpm/MiniCPM-V-4_7-1B-Q4_K_M.gguf");
const modelWaitMs = 600_000;
const coldRouteWaitMs = 480_000;

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
}

function optionValues(name) {
  const values=[];
  for(let index=0;index<process.argv.length;index++){
    if(process.argv[index]!==name)continue;
    const value=process.argv[index+1];
    if(typeof value!=="string"||!/^v8-\d{3}$/u.test(value))throw new Error(`Invalid ${name}`);
    values.push(value);
  }
  return values;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function workingTreeSha256() {
  const diff = execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: root, encoding: "buffer" });
  const paths = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(Boolean).sort();
  const untracked = paths.map(path => [path, sha256(readFileSync(resolve(root, path)))]);
  return sha256(JSON.stringify({ diff: sha256(diff), untracked }));
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", chunk => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolvePromise);
  });
  return hash.digest("hex");
}

function findUuid(value) {
  if (typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUuid(item);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = findUuid(item);
      if (found) return found;
    }
  }
  return null;
}

function extractConversation(value) {
  if (Array.isArray(value)) return value.length ? extractConversation(value[0]) : null;
  if (!value || typeof value !== "object") return null;
  if (typeof value.conversationId === "string") return value.conversationId;
  if (typeof value.get_jarvis_history === "object") return extractConversation(value.get_jarvis_history);
  if (Array.isArray(value.data)) return extractConversation(value.data);
  return null;
}

function normalized(text) {
  return text.replace(/\s+/gu, " ").trim();
}

async function saveReport(report) {
  report.updatedAt = new Date().toISOString();
  const temporary = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, reportPath);
}

function summarizeEvents(events) {
  return events.map(event => {
    if (event.type === "stage") return { type: event.type, stage: event.stage };
    if (event.type === "sentence") {
      return {
        type: event.type,
        kind: event.kind,
        text: event.text,
        sources: (event.sources ?? []).map(source => ({ id: source.id, type: source.type, version: source.version ?? null })),
      };
    }
    if (event.type === "done") {
      return {
        type: event.type,
        patientId: event.patientId ?? null,
        sourceRevision: event.sourceRevision ?? null,
        coverage: event.coverage ?? null,
        limited: event.limited,
        status: event.status ?? null,
        tokensIn: event.tokensIn ?? null,
        tokensOut: event.tokensOut ?? null,
        speechAllowed: event.speechAllowed ?? null,
        parts: event.parts ?? null,
        navigation: event.navigation ?? null,
      };
    }
    if (event.type === "proposal") return { type: event.type, tool: event.tool, argumentNames: Object.keys(event.args ?? {}).sort() };
    if (event.type === "error") return { type: event.type, code: event.code, partial: event.partial ?? false };
    return { type: event.type };
  });
}

function installObserver(page) {
  return page.addInitScript(() => {
    const target = window;
    target.__alexaV8Capture = Object.create(null);
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      let url;
      try { url = new URL(typeof input === "string" ? input : input.url, location.href); }
      catch { return response; }
      if (url.pathname !== "/api/alexa/turn") return response;
      let requestBody;
      try { requestBody = JSON.parse(typeof init?.body === "string" ? init.body : "{}"); }
      catch { return response; }
      const id = requestBody?.clientTurnId;
      if (typeof id !== "string") return response;
      const state = {
        status: response.status,
        raw: "",
        events: [],
        eventTiming: [],
        stage: "waiting",
        terminal: null,
        finished: false,
        captureError: false,
        startedAt: performance.now(),
        firstEventMs: null,
      };
      target.__alexaV8Capture[id] = state;
      const clone = response.clone();
      void (async () => {
        const reader = clone.body?.getReader();
        if (!reader) { state.captureError = true; state.finished = true; return; }
        const decoder = new TextDecoder();
        let pending = "";
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            const chunk = decoder.decode(next.value, { stream: true });
            state.raw += chunk;
            pending += chunk;
            let boundary;
            while ((boundary = pending.indexOf("\n\n")) !== -1) {
              const frame = pending.slice(0, boundary);
              pending = pending.slice(boundary + 2);
              const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /u, "")).join("\n");
              if (!data) continue;
              let event;
              try { event = JSON.parse(data); }
              catch { state.captureError = true; continue; }
              if (!state.events.length) state.firstEventMs = performance.now() - state.startedAt;
              state.events.push(event);
              state.eventTiming.push({
                type: event.type,
                stage: event.type === "stage" ? event.stage : null,
                atMs: Math.round(performance.now() - state.startedAt),
              });
              if (event.type === "stage") state.stage = event.stage;
              if (event.type === "done" || event.type === "error") state.terminal = event.type;
            }
          }
          state.raw += decoder.decode();
          state.finished = true;
        } catch {
          state.captureError = true;
          state.finished = true;
        }
      })();
      return response;
    };
  });
}

const databaseUrl = process.env.MINDCARE_DATABASE_URL ?? "";
validateV8Target(databaseUrl);
if (process.env.ALEXA_NATIVE_AGENT_ENABLED !== "1") throw new Error("Native MiniCPM path is not enabled");

const manifestText = await readFile(manifestPath, "utf8");
const preconditionsText = await readFile(preconditionsPath, "utf8");
const snapshotText = await readFile(snapshotPath, "utf8");
const oracleText = await readFile(oraclePath, "utf8");
const manifest = JSON.parse(manifestText);
const preconditions = JSON.parse(preconditionsText);
const snapshot = JSON.parse(snapshotText);
const privateOracles = JSON.parse(oracleText);
const auth = JSON.parse(await readFile(authPath, "utf8"));
const browserSession = existsSync(browserSessionPath) ? JSON.parse(await readFile(browserSessionPath, "utf8")) : null;
const manifestSha256 = sha256(manifestText);
const preconditionsSha256 = sha256(preconditionsText);
const snapshotSha256 = sha256(snapshotText);
const oracleSha256 = sha256(oracleText);
const modelSha256 = await sha256File(modelPath);
const liveAsOf = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
validateV8Source(snapshot.source);
validateV8Manifest(manifest, { requireFrozen: true, snapshotSha256 });
if (privateOracles.sourceSha256 !== snapshotSha256 || modelSha256 !== expectedModelHash) throw new Error("Frozen source or pinned model changed");
if (privateOracles.version !== (oracleVersion === "v3" ? 3 : 4)) throw new Error("Private oracle revision does not match its filename");
if (oracleVersion === "v4" && privateOracles.fixtureAsOf !== liveAsOf) throw new Error("Reviewed oracle date does not match the live Algiers date");
if (!auth.email || !auth.password || !auth.userId) throw new Error("Private evaluation login is incomplete");

const cohort = process.env.ALEXA_V8_COHORT ?? "baseline";
const cohortCases = selectV8Cases(manifest, cohort);
const oracleById = new Map(privateOracles.cases.map(item => [item.id, item]));
const caseLimit = optionValue("--limit");
const caseIds=optionValues("--case");
if(caseLimit&&caseIds.length)throw new Error("Use either --limit or --case");
const selectedCases = caseIds.length ? cohortCases.filter(item=>caseIds.includes(item.id)) : caseLimit ? cohortCases.slice(0, caseLimit) : cohortCases;
if(caseIds.length&&new Set(caseIds).size!==caseIds.length||caseIds.some(id=>!selectedCases.some(item=>item.id===id)))throw new Error("Requested case is unavailable in the selected cohort or duplicated");
const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const sourceWorkingTreeSha256 = workingTreeSha256();

let report;
if (existsSync(reportPath)) {
  report = JSON.parse(await readFile(reportPath, "utf8"));
  if (report.manifestSha256 !== manifestSha256 || report.snapshotSha256 !== snapshotSha256 || report.modelSha256 !== modelSha256 ||
      report.oracleSha256 !== oracleSha256 || report.oracleVersion !== oracleVersion || report.preconditionsSha256 !== preconditionsSha256) {
    throw new Error("Existing baseline evidence does not match the frozen campaign");
  }
} else {
  report = {
    version: 1,
    cohort,
    expectedCaseCount: selectedCases.length,
    state: "IN_PROGRESS",
    createdAt: new Date().toISOString(),
    sourceHead,
    sourceWorkingTreeSha256,
    origin,
    database: "127.0.0.1:55445/alexa_eval_v8_intelligence_20261027",
    model: "MiniCPM-V-4_7-1B-Q4_K_M.gguf",
    modelSha256,
    manifestSha256,
    preconditionsSha256,
    snapshotSha256,
    oracleVersion,
    oracleSha256,
    fixtureAsOf: privateOracles.fixtureAsOf ?? liveAsOf,
    sequential: true,
    answersInjected: false,
    routeMocks: false,
    cases: [],
  };
}
if ((report.cohort ?? "baseline") !== cohort) throw new Error("Existing report belongs to another cohort");
if (report.sourceWorkingTreeSha256 !== sourceWorkingTreeSha256) throw new Error("Source working tree changed; create a new evaluation run");
report.cohort = cohort;
report.expectedCaseCount = selectedCases.length;
await mkdir(screenshotRoot, { recursive: true });

const auditUrl = new URL(databaseUrl);
auditUrl.username = "postgres";
auditUrl.password = "";
const auditDb = new pg.Client({ connectionString: auditUrl.href, connectionTimeoutMillis: 30_000 });
await auditDb.connect();

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  context.setDefaultTimeout(coldRouteWaitMs);
  const controlPage = await context.newPage();
  controlPage.setDefaultTimeout(coldRouteWaitMs);
  const staticAssetResponses = [];
  controlPage.on("response", response => {
    const url = new URL(response.url());
    if (url.origin === new URL(origin).origin && url.pathname.startsWith("/_next/static/")) {
      staticAssetResponses.push({ url: url.href, status: response.status() });
    }
  });
  if (browserSession?.token && browserSession?.expiresAt) {
    await context.addCookies([{
      name: "mc_session",
      value: browserSession.token,
      url: origin,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires: Math.floor(new Date(browserSession.expiresAt).getTime() / 1000),
    }]);
    await controlPage.goto(`${origin}/patients`, { waitUntil: "domcontentloaded", timeout: coldRouteWaitMs });
    const session = await controlPage.evaluate(async () => {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      return { status: response.status, ok: body?.ok === true, hasSession: body?.ok === true && body?.data !== null };
    });
    const sessionCookie = (await context.cookies(origin)).find(item => item.name === "mc_session");
    if (!session.ok || !session.hasSession || !sessionCookie?.httpOnly || new URL(controlPage.url()).pathname !== "/patients") {
      throw new Error("Pre-established authenticated session could not be revalidated in the UI");
    }
    report.authentication = "existing_database_session_verified_by_app";
    console.log(JSON.stringify({ setup: "AUTHENTICATED_UI_PASS", authentication: "database_session", sessionHttp: session.status, httpOnlyCookie: true }));
  } else {
  await controlPage.goto(`${origin}/connexion`, { waitUntil: "load", timeout: 30_000 });
  const failedStaticAssets = findV8StaticAssetFailures(staticAssetResponses, origin);
  if (failedStaticAssets.length) throw new Error(`Evaluation UI static assets unavailable: ${JSON.stringify(failedStaticAssets)}`);
  await controlPage.waitForFunction(() => {
    const input = document.querySelector("input");
    return input !== null && Object.keys(input).some(key => key.startsWith("__reactProps$"));
  }, null, { timeout: 30_000 });
  await controlPage.waitForTimeout(1_500);
  await controlPage.locator("input").nth(0).fill(auth.email);
  await controlPage.locator("input").nth(1).fill(auth.password);
  const signInPromise = controlPage.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/sign-in", { timeout: coldRouteWaitMs });
  await controlPage.locator("button[type=submit]").click({ timeout: 30_000 });
  const signInResponse = await signInPromise;
  const signInPayload = await signInResponse.json().catch(() => null);
  if (!signInResponse.ok() || signInPayload?.ok !== true) {
    const failureScreenshot = resolve(screenshotRoot, `setup-login-failure-${Date.now()}.png`);
    await controlPage.screenshot({ path: failureScreenshot, fullPage: true, timeout: 60_000 });
    const code = typeof signInPayload?.code === "string" ? signInPayload.code : "unknown";
    console.log(JSON.stringify({ setup: "AUTHENTICATED_UI_FAILED", loginHttp: signInResponse.status(), code, screenshot: "retained privately" }));
    throw new Error(`Authenticated UI sign-in failed (HTTP ${signInResponse.status()}, ${code})`);
  }
  const session = await controlPage.evaluate(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    return { status: response.status, ok: body?.ok === true, hasSession: body?.ok === true && body?.data !== null };
  });
  const sessionCookie = (await context.cookies(origin)).find(item => item.name === "mc_session");
  if (!session.ok || !session.hasSession || !sessionCookie?.httpOnly) throw new Error("Authenticated session could not be revalidated");
  await controlPage.goto(`${origin}/patients`, { waitUntil: "domcontentloaded", timeout: coldRouteWaitMs });
  if (new URL(controlPage.url()).pathname !== "/patients") throw new Error("Authenticated patient workspace did not load");
  console.log(JSON.stringify({ setup: "AUTHENTICATED_UI_PASS", loginHttp: signInResponse.status(), sessionHttp: session.status, httpOnlyCookie: true }));
  }

  const completed = new Set(report.cases.filter(item => item.status === "PENDING_REVIEW" || item.status === "FAIL").map(item => item.id));
  for (const scenario of selectedCases) {
    if (completed.has(scenario.id)) continue;
    const oracle = oracleById.get(scenario.id);
    if (!oracle || oracle.turnBindings.length !== scenario.turns.length) throw new Error("Frozen per-turn oracle is unavailable");

    let result = report.cases.find(item => item.id === scenario.id);
    if (!result) {
      result = { id: scenario.id, category: scenario.category, oracleRef: scenario.oracleKey, status: "NOT RUN", attempts: [] };
      report.cases.push(result);
    }
    const attempt = { startedAt: new Date().toISOString(), status: "RUNNING", conversationId: null, turns: [] };
    result.attempts.push(attempt);
    result.status = "RUNNING";
    await saveReport(report);

    const openStarted = Date.now();
    const openResult = await controlPage.evaluate(async () => {
      const response = await fetch("/api/db/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: "start_jarvis_conversation", args: {} }),
      });
      const body = await response.json().catch(() => null);
      return { status: response.status, ok: body?.ok === true, data: body?.data ?? null };
    });
    const conversationId = findUuid(openResult.data);
    if (!openResult.ok || !conversationId) {
      attempt.status = "INFRASTRUCTURE_FAILURE";
      attempt.failure = "conversation_start_unavailable";
      attempt.conversationStartMs = Date.now() - openStarted;
      result.status = "NOT RUN";
      await saveReport(report);
      console.log(JSON.stringify({ id: scenario.id, status: "INFRASTRUCTURE_FAILURE", stage: "conversation_start" }));
      break;
    }
    attempt.conversationId = conversationId;
    attempt.conversationStartMs = Date.now() - openStarted;
    await saveReport(report);

    const page = await context.newPage();
      page.setDefaultTimeout(coldRouteWaitMs);
    await installObserver(page);
    let pageFailure = null;
    try {
      const historyPromise = page.waitForResponse(response => {
        if (new URL(response.url()).pathname !== "/api/db/rpc" || response.request().method() !== "POST") return false;
        try { return response.request().postDataJSON()?.name === "get_jarvis_history"; }
        catch { return false; }
      }, { timeout: coldRouteWaitMs });
      const scenarioPath = resolveV8ScenarioPath(scenario.id, preconditions, snapshot, origin);
      const assistantInteraction = resolveV8AssistantInteraction(scenario.id, preconditions, snapshot);
      attempt.initialPage = new URL(scenarioPath).pathname;
      await page.goto(scenarioPath, { waitUntil: "domcontentloaded", timeout: coldRouteWaitMs });
      if (assistantInteraction.openPanel) {
        await page.getByRole("button", { name: /Ouvrir Alexa/iu }).click({ timeout: coldRouteWaitMs });
      }
      const historyResponse = await historyPromise;
      const historyBody = await historyResponse.json().catch(() => null);
      const historyConversationId = extractConversation(historyBody?.data);
      if (!historyResponse.ok() || historyBody?.ok !== true || historyConversationId !== conversationId) {
        throw new Error("Conversation history did not bind to the fresh isolated conversation");
      }
      const assistantInput = page.locator(assistantInteraction.inputSelector).last();
      await assistantInput.waitFor({ state: "visible", timeout: coldRouteWaitMs });
      const documentSetup = assistantInteraction.openPanel ? snapshot.currentDocument : null;
      if (documentSetup) {
        await page.locator(".doc2-document-head strong").filter({ hasText: documentSetup.doc_number })
          .waitFor({ state: "visible", timeout: coldRouteWaitMs });
        attempt.selectedDocumentOpened = { documentId: documentSetup.id, patientId: documentSetup.patient_id, documentNumber: documentSetup.doc_number };
      }

      for (let turnIndex = 0; turnIndex < scenario.turns.length; turnIndex++) {
        const binding = oracle.turnBindings[turnIndex];
        let prompt = scenario.turns[turnIndex];
        for (const [token, value] of Object.entries(binding.tokens)) {
          if (typeof value !== "string" || !prompt.includes(`[${token}]`)) throw new Error("Private prompt binding is invalid");
          prompt = prompt.replaceAll(`[${token}]`, value);
        }
        if (/\[[A-Z0-9_]+\]/u.test(prompt)) throw new Error("Private prompt contains an unresolved placeholder");

        const turnStartedAt = Date.now();
        const requestPromise = page.waitForRequest(request => new URL(request.url()).pathname === "/api/alexa/turn" && request.method() === "POST", { timeout: coldRouteWaitMs });
        const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/alexa/turn" && response.request().method() === "POST", { timeout: modelWaitMs + 120_000 });
        await assistantInput.fill(prompt);
        await page.getByRole("button", { name: /Envoyer/iu }).last().click({ timeout: 30_000 });
        const request = await requestPromise;
        const sent = request.postDataJSON();
        if (sent.text !== prompt || sent.conversationId !== conversationId || !sent.clientTurnId) {
          throw new Error("Submitted turn did not match the frozen prompt and conversation");
        }
        assertV8ScenarioAppContext(scenario.id, preconditions, snapshot, sent.appContext);
        const clientTurnId = sent.clientTurnId;
        const response = await responsePromise;
        let captureState = null;
        const deadline = Date.now() + modelWaitMs;
        let nextProgress = Date.now() + 30_000;
        while (Date.now() < deadline) {
          captureState = await page.evaluate(id => {
            const item = window.__alexaV8Capture?.[id];
            return item ? {
              status: item.status,
              stage: item.stage,
              terminal: item.terminal,
              finished: item.finished,
              captureError: item.captureError,
              eventCount: item.events.length,
              firstEventMs: item.firstEventMs,
              raw: item.finished ? item.raw : null,
              events: item.finished ? item.events : null,
              eventTiming: item.finished ? item.eventTiming : null,
            } : null;
          }, clientTurnId);
          if (captureState?.finished) break;
          if (Date.now() >= nextProgress) {
            console.log(JSON.stringify({ id: scenario.id, turn: turnIndex + 1, elapsedMs: Date.now() - turnStartedAt, stage: captureState?.stage ?? "awaiting_first_event", events: captureState?.eventCount ?? 0 }));
            nextProgress = Date.now() + 30_000;
          }
          await page.waitForTimeout(3_000);
        }
        if (!captureState?.finished || typeof captureState.raw !== "string") throw new Error("model_stream_timeout");
        if (captureState.status !== 200 || captureState.captureError) throw new Error("model_stream_capture_failed");
        const parsed = parseV8Stream(captureState.raw);
        const answer = parsed.answer;
        const modelFinishedAt = Date.now();
        let uiRendered = false;
        let uiRenderedAt = null;
        if (answer.trim()) {
          try {
            await page.waitForFunction(expected => {
              const targetText = expected.replace(/\s+/gu, " ").trim();
              return [...document.querySelectorAll('[role="log"]')].some(node => node.innerText.replace(/\s+/gu, " ").includes(targetText));
            }, answer, { timeout: 60_000 });
            uiRendered = true;
            uiRenderedAt = Date.now();
          } catch { /* Preserve the actual answer and the UI-rendering failure separately. */ }
        }
        const screenshot = resolve(screenshotRoot, `${scenario.id}-turn-${String(turnIndex + 1).padStart(2, "0")}.png`);
        await page.screenshot({ path: screenshot, fullPage: true, timeout: 60_000 });
        const doneEvent = parsed.terminal;
        const turnRecord = {
          index: turnIndex + 1,
          prompt,
          promptSha256: sha256(prompt),
          clientTurnId,
          submittedAppContext: sent.appContext,
          httpStatus: response.status(),
          terminal: doneEvent,
          answer,
          answerSha256: sha256(answer),
          eventSummary: summarizeEvents(parsed.events),
          stageTimeline: captureState.eventTiming.filter(item => item.type === "stage"),
          firstEventMs: captureState.firstEventMs,
          elapsedMs: modelFinishedAt - turnStartedAt,
          uiRenderMs: uiRenderedAt === null ? null : uiRenderedAt - modelFinishedAt,
          uiRendered,
           screenshot: `screenshots/${runId}/${scenario.id}-turn-${String(turnIndex + 1).padStart(2, "0")}.png`,
          evidenceVerdict: "PENDING_REVIEW",
        };
        attempt.turns.push(turnRecord);
        await saveReport(report);

        if (doneEvent.type !== "done") throw new Error("terminal_event_not_done");
        if (turnIndex < scenario.turns.length - 1 || scenario.turns.length > 1) {
          const reloadHistoryPromise = page.waitForResponse(candidate => {
            if (new URL(candidate.url()).pathname !== "/api/db/rpc" || candidate.request().method() !== "POST") return false;
            try { return candidate.request().postDataJSON()?.name === "get_jarvis_history"; }
            catch { return false; }
          }, { timeout: coldRouteWaitMs });
          await page.reload({ waitUntil: "domcontentloaded", timeout: coldRouteWaitMs });
          const reloadResponse = await reloadHistoryPromise;
          const reloadBody = await reloadResponse.json().catch(() => null);
          const reloadConversationId = extractConversation(reloadBody?.data);
          if (!reloadResponse.ok() || reloadBody?.ok !== true || reloadConversationId !== conversationId) {
            throw new Error("Conversation did not survive a real page reload");
          }
          await page.locator("main textarea").last().waitFor({ state: "visible", timeout: coldRouteWaitMs });
          const reloadScreenshot = resolve(screenshotRoot, `${scenario.id}-after-reload-${String(turnIndex + 1).padStart(2, "0")}.png`);
          await page.screenshot({ path: reloadScreenshot, fullPage: true, timeout: 60_000 });
          turnRecord.reloadVerified = true;
           turnRecord.reloadScreenshot = `screenshots/${runId}/${scenario.id}-after-reload-${String(turnIndex + 1).padStart(2, "0")}.png`;
          await saveReport(report);
        }
      }

      const persisted = await auditDb.query(
        "SELECT EXISTS(SELECT 1 FROM app.jarvis_conversations WHERE id=$1) AS conversation_exists, count(*) FILTER (WHERE role='humain')::int AS human_messages, count(*) FILTER (WHERE role='jarvis')::int AS assistant_messages, count(*) FILTER (WHERE statut='interrompu')::int AS interrupted_messages FROM app.jarvis_messages WHERE conversation_id=$1",
        [conversationId],
      );
      attempt.database = persisted.rows[0];
      attempt.finishedAt = new Date().toISOString();
      attempt.status = "OBSERVED";
      result.status = "PENDING_REVIEW";
      result.latestAttempt = result.attempts.length - 1;
      await saveReport(report);
      console.log(JSON.stringify({ id: scenario.id, status: "OBSERVED", turns: attempt.turns.length, elapsedMs: attempt.turns.reduce((sum, turn) => sum + turn.elapsedMs, 0), persisted: attempt.database }));
    } catch (error) {
      pageFailure = error instanceof Error ? error.name : "Error";
      attempt.finishedAt = new Date().toISOString();
      attempt.status = "INFRASTRUCTURE_FAILURE";
      attempt.failure = pageFailure;
      result.status = "NOT RUN";
      await saveReport(report);
      console.log(JSON.stringify({ id: scenario.id, status: "INFRASTRUCTURE_FAILURE", stage: "browser_or_stream" }));
    } finally {
      await page.close().catch(() => {});
    }
    if (pageFailure) break;
  }

  const observed = report.cases.filter(item => item.status === "PENDING_REVIEW").length;
  report.state = report.cases.length === selectedCases.length && observed === selectedCases.length ? "PENDING_REVIEW" : "IN_PROGRESS";
  report.completedAt = report.state === "PENDING_REVIEW" ? new Date().toISOString() : null;
  await saveReport(report);
  console.log(JSON.stringify({ cohort, state: report.state, observed: report.cases.filter(item => item.status === "PENDING_REVIEW").length, failures: report.cases.filter(item => item.status === "NOT RUN").length, totalCases: selectedCases.length, sourceHead }));
} finally {
  await browser?.close().catch(() => {});
  await auditDb.end().catch(() => {});
}
