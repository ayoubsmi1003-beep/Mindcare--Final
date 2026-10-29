import { sanitizeAlexaKnowledgeTrace } from "./alexa-eval-artifact.mjs";
import { finalizeAlexaAdmission } from "./alexa-eval-admission.mjs";

const TRACE_PREFIX = "[alexa-knowledge-execution]";

/** Captures the adapter's content-free diagnostics for one sequential eval turn. */
export async function captureAlexaKnowledgeTraces(operation) {
  if (typeof operation !== "function") throw new TypeError("Alexa turn operation is required");

  const originalInfo = console.info;
  const knowledgeTraces = [];
  console.info = function (...args) {
    if (args[0] !== TRACE_PREFIX) return Reflect.apply(originalInfo, console, args);
    if (typeof args[1] !== "string") return;
    try {
      const trace = JSON.parse(args[1]);
      if (trace && typeof trace === "object" && !Array.isArray(trace)) {
        knowledgeTraces.push(sanitizeAlexaKnowledgeTrace(trace));
      }
    } catch { /* Invalid diagnostics stay absent and cannot change Alexa behavior. */ }
  };

  try {
    const value = await operation();
    return { value, knowledgeTraces };
  } finally {
    console.info = originalInfo;
  }
}

const clone = value => structuredClone(value);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const INFERENCE_ERRORS = new Set([
  "LocalModelAssetAccess", "LocalModelIntegrity", "LocalModelBusy", "LocalModelUnavailable",
  "TimeoutError", "AbortError", "InferenceFailure",
]);
const ACTION_GATE_NAMES = new Set([
  "propose_jarvis_action", "confirm_jarvis_action", "reject_jarvis_action", "execute_jarvis_action",
]);

export function mergeAlexaExecutionFallback(current, observed) {
  const causes = [...new Set([
    ...(Array.isArray(current?.causes) ? current.causes : []),
    ...(Array.isArray(observed?.causes) ? observed.causes : []),
  ].filter(cause => INFERENCE_ERRORS.has(cause)))];
  return {
    used: current?.used === true || observed?.used === true || causes.length > 0,
    causes,
  };
}

function isLoopbackFetch(resource) {
  const raw = resource instanceof URL ? resource.href
    : typeof Request !== "undefined" && resource instanceof Request ? resource.url
      : String(resource);
  try { return LOOPBACK_HOSTS.has(new URL(raw).hostname.toLowerCase()); }
  catch { return false; }
}

async function withExternalFetchBlock(operation) {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") return { value: await operation(), externalEgressCount: null };
  let externalEgressCount = 0;
  globalThis.fetch = async function (resource, ...args) {
    if (isLoopbackFetch(resource)) return Reflect.apply(originalFetch, globalThis, [resource, ...args]);
    externalEgressCount++;
    throw new Error("V8ExternalEgressBlocked");
  };
  try {
    return { value: await operation(), externalEgressCount };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/** Executes one isolated conversation turn through the real runAlexa orchestrator. */
export async function runAlexaV8Turn({
  api,
  actor,
  text,
  conversationId,
  clientTurnId,
  appContext,
  asOf,
  signal,
} = {}) {
  if (!api || typeof api.runAlexa !== "function" || typeof api.alexaDb !== "function" ||
      typeof api.clientSql !== "function" || typeof api.inferLocalCompletion !== "function" ||
      typeof actor !== "string" || typeof text !== "string" || typeof conversationId !== "string" ||
      typeof clientTurnId !== "string" || !appContext || typeof appContext !== "object" ||
      typeof asOf !== "string") {
    throw new TypeError("Complete Alexa V8 runtime turn inputs are required");
  }

  const started = Date.now();
  const events = [];
  const calls = [];
  const liveCalls = [];
  const dispatchedCalls = [];
  const toolResults = [];
  const queries = [];
  const timings = { inference: [], tools: [], firstVisible: null };
  const port = api.alexaDb(actor);
  const wrappedDb = {
    rpc: async (name, args) => {
      const queryStarted = Date.now();
      const query = { name, args: clone(args) };
      queries.push(query);
      try {
        const response = await port.rpc(name, args);
        query.response = clone(response);
        timings.tools.push({ name, ms: Date.now() - queryStarted });
        return response;
      } catch (error) {
        query.response = { ok: false, error: { code: "runtime-error" } };
        timings.tools.push({ name, ms: Date.now() - queryStarted, fault: true });
        throw error;
      }
    },
  };
  const agentInfer = async (messages, options) => {
    const inferenceStarted = Date.now();
    try {
      const result = await api.inferLocalCompletion(messages, options);
      timings.inference.push({
        ms: Date.now() - inferenceStarted,
        ...(Number.isFinite(result?.tokensIn) ? { tokensIn: result.tokensIn } : {}),
        ...(Number.isFinite(result?.tokensOut) ? { tokensOut: result.tokensOut } : {}),
        ...(result?.kind === "answer" || result?.kind === "calls" ? { kind: result.kind } : {}),
      });
      if (result?.kind === "calls" && Array.isArray(result.calls)) {
        for (const call of result.calls) {
          const schema = call.name === "declare_request"
            ? api.compactDeclarationSchema
            : api.agentSchemas?.[call.name];
          let valid = false;
          try { valid = schema?.safeParse(call.args).success === true; } catch { /* Invalid model call stays invalid. */ }
          calls.push({ name: call.name, args: clone(call.args), valid });
          liveCalls.push({ call, schema });
        }
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const errorName = error instanceof Error ? error.name : "";
      const code = INFERENCE_ERRORS.has(message) ? message
        : INFERENCE_ERRORS.has(errorName) ? errorName : "InferenceFailure";
      timings.inference.push({ ms: Date.now() - inferenceStarted, error: code });
      throw error;
    }
  };

  const captured = await captureAlexaKnowledgeTraces(() =>
    withExternalFetchBlock(() => api.runAlexa(
      { text, conversationId, clientTurnId, appContext },
      {
        actor,
        db: wrappedDb,
        knowledge: api.clientSql(actor),
        native: true,
        agentAsOf: asOf,
        agentInfer,
        agentObserve: call => dispatchedCalls.push(clone(call)),
        agentObserveResult: observation => toolResults.push(clone(observation)),
      },
      event => {
        events.push(clone(event));
        if (event.type === "sentence" && timings.firstVisible === null) timings.firstVisible = Date.now() - started;
      },
      signal ?? AbortSignal.timeout(api.ALEXA_NATIVE_DEADLINE_MS),
    ))
  );
  const runResult = captured.value.value;
  const externalEgressCount = captured.value.externalEgressCount;

  const acceptedIds = new Set(events.filter(event => event.type === "done")
    .flatMap(event => (event.parts ?? []).flatMap(part => part.resultRefs ?? [])));
  for (const [index, entry] of liveCalls.entries()) {
    calls[index] = finalizeAlexaAdmission(
      calls[index], entry.call, entry.schema, acceptedIds,
      dispatchedCalls.find(call => call.id === entry.call.id),
    );
  }
  const modelCallIds = new Set(liveCalls.map(entry => entry.call.id));
  for (const call of dispatchedCalls) {
    if (modelCallIds.has(call.id)) continue;
    const schema = api.agentSchemas?.[call.name];
    let valid = false;
    try { valid = schema?.safeParse(call.args).success === true; } catch { /* Server call stays invalid. */ }
    calls.push({ id: call.id, name: call.name, args: clone(call.args), effectiveArgs: clone(call.args), valid, source: "server-contract" });
  }

  const fallbackCauses = [...new Set(timings.inference.flatMap(entry => INFERENCE_ERRORS.has(entry.error) ? [entry.error] : []))];
  // Record only the observed RPC envelope. This does not infer the gate's
  // internal authorization checks, audit persistence, or post-write readback.
  const actionGateCalls = queries.filter(query => ACTION_GATE_NAMES.has(query.name)).map(query => ({
    gate: query.name,
    ok: query.response?.ok === true,
    resultCount: Array.isArray(query.response?.data) ? query.response.data.length : 0,
  }));
  return {
    id: clientTurnId,
    requestBudgetMs: api.ALEXA_NATIVE_DEADLINE_MS,
    inferenceBudgetMs: api.ALEXA_NATIVE_BUDGET?.inferenceMs,
    events,
    calls,
    toolResults,
    queries,
    actionGateCalls,
    knowledgeTraces: captured.knowledgeTraces,
    timings,
    ms: Date.now() - started,
    ...(externalEgressCount === null ? {} : { externalEgressCount }),
    execution: {
      model: api.ALEXA_CONVERSATION_MODEL,
      recipe: "native-agent",
      gate: "runAlexa",
      invocation: "in_process",
      fallback: { used: fallbackCauses.length > 0, causes: fallbackCauses },
    },
  };
}
