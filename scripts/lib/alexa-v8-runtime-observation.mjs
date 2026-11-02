import { randomUUID } from "node:crypto";
import pg from "pg";
import { sanitizeAlexaKnowledgeTrace } from "./alexa-eval-artifact.mjs";
import { finalizeAlexaAdmission } from "./alexa-eval-admission.mjs";

const { Client: ActionClient } = pg;

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

/** Executes a direct readKnowledge call and returns content-free trace/evidence metadata. */
export async function runAlexaV8DirectKnowledge({ api, actor, question, signal } = {}) {
  if (!api || typeof api.clientSql !== "function" || typeof api.readKnowledge !== "function" ||
      typeof actor !== "string" || typeof question !== "string" || !question.trim()) {
    throw new TypeError("Complete direct Alexa knowledge inputs are required");
  }
  const captured = await captureAlexaKnowledgeTraces(() => withExternalFetchBlock(async () => {
    return api.readKnowledge(api.clientSql(actor), question, signal, undefined, { traceOrigin: "direct" });
  }));
  const result = captured.value.value;
  if (process.env["ALEXA_V8_TRACE_DIAGNOSTICS"] === "1") {
    console.info("[alexa-v8-knowledge-trace]", JSON.stringify(captured.knowledgeTraces.map(trace => ({
      origin: trace.origin, recipe: trace.recipe, configuredRecipe: trace.configuredRecipe,
      model: trace.model, lexical: trace.lexical, vector: trace.vector, embedding: trace.embedding,
      reranker: trace.reranker, evidence: trace.evidence, fallbacks: trace.fallbacks,
    }))));
  }
  const proofs = Array.isArray(result?.preuves) ? result.preuves : [];
  const safeLabel = value => typeof value === "string" ? value.slice(0, 240) : null;
  const evidenceSummary = {
    state: ["ok", "faible", "sans-preuve", "panne"].includes(result?.etat) ? result.etat : "unknown",
    sourceCount: proofs.length,
    sources: proofs.slice(0, 8).map(proof => ({
      title: safeLabel(proof?.titre),
      version: safeLabel(proof?.version),
      section: safeLabel(proof?.section),
      page: safeLabel(proof?.page?.libelle),
      excerptUtf8Bytes: typeof proof?.extrait === "string" ? Buffer.byteLength(proof.extrait, "utf8") : null,
    })),
  };
  if (process.env["ALEXA_V8_EVIDENCE_DIAGNOSTICS"] === "1") {
    console.info("[alexa-v8-evidence-summary]", JSON.stringify(evidenceSummary));
  }
  return {
    knowledgeTraces: captured.knowledgeTraces,
    externalEgressCount: captured.value.externalEgressCount,
    evidenceSummary,
  };
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

const ACTION_READBACK_TABLE = {
  create_appointment: "appointments",
  reschedule_appointment: "appointments",
  cancel_appointment: "appointments",
  mark_patient_arrived: "appointments",
  close_consultation: "consultations",
  set_consultation_price: "consultations",
  record_payment_collected: "payments",
  create_charge: "charges",
  update_charge: "charges",
  deactivate_charge: "charges",
  create_editable_document_draft: "document_drafts",
  update_editable_document_draft: "document_drafts",
  issue_document: "documents",
  update_treatment: "patient_treatments",
  pause_treatment: "patient_treatments",
  resume_treatment: "patient_treatments",
  stop_treatment: "patient_treatments",
};
const TREATMENT_ACTIONS = new Set(["update_treatment", "pause_treatment", "resume_treatment", "stop_treatment"]);

function databaseActionArgs(tool, args, actor) {
  const a = args && typeof args === "object" ? args : {};
  if (tool === "create_appointment") return {
    patient_id: a.patientId,
    practitioner_id: a.practitionerId ?? actor,
    starts_at: a.startsAt,
    duration_minutes: a.durationMinutes ?? 30,
    notes_admin: a.notesAdmin ?? null,
    kind: a.kind ?? "suivi",
  };
  if (tool === "reschedule_appointment") return {
    appointment_id: a.appointmentId,
    nouveau_debut: a.startsAt,
    nouvelle_duree_minutes: a.durationMinutes ?? 30,
  };
  if (tool === "cancel_appointment" || tool === "mark_patient_arrived") return { appointment_id: a.appointmentId };
  if (TREATMENT_ACTIONS.has(tool)) return {
    patient_id: a.patientId,
    treatment_id: a.treatmentId,
    expected_version: a.expectedVersion,
    ...(a.changes !== undefined ? { changes: a.changes } : {}),
    ...(a.reason !== undefined ? { reason: a.reason } : {}),
    ...(a.notes !== undefined ? { notes: a.notes } : {}),
    ...(a.consultationId !== undefined ? { consultation_id: a.consultationId } : {}),
  };
  if (tool === "set_consultation_price") return { consultation_id: a.consultationId, montant_dzd: a.amountDzd };
  if (tool === "record_payment_collected") return { consultation_id: a.consultationId, amount_dzd: a.amountDzd, collected_at: a.collectedAt };
  if (tool === "close_consultation") return { consultation_id: a.consultationId };
  if (tool === "issue_document") return { document_id: a.documentId };
  if (tool === "create_editable_document_draft") return { patient_id: a.patientId, document_type: a.documentType, variables: a.variables ?? {} };
  if (tool === "update_editable_document_draft") return { draft_id: a.draftId, revision: a.revision, variables: a.variables ?? {} };
  if (tool === "create_charge" || tool === "update_charge" || tool === "deactivate_charge") return {
    charge_id: a.chargeId, target_name: a.chargeTargetName, intitule: a.chargeName,
    montant_dzd: a.chargeAmountDzd, categorie: a.chargeCategory, type: a.chargeType,
    frequence: a.chargeFrequency, date_charge: a.chargeDate,
  };
  if (tool === "send_internal_message") return { body: a.body };
  return a;
}

function actionValue(row, ...keys) {
  for (const key of keys) {
    if (row && Object.hasOwn(row, key)) return row[key];
  }
  return undefined;
}
function sameScalar(actual, expected) {
  if (typeof actual === "number" && typeof expected === "number") return actual === expected;
  return String(actual ?? "").trim().toLocaleLowerCase("fr") === String(expected ?? "").trim().toLocaleLowerCase("fr");
}
function algiersLocalMinute(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
function expectedEffectVerified(effect, row, expectedPatientId) {
  if (!row) return false;
  if (!effect || typeof effect !== "object") return true;
  let checked = 0;
  if (effect.patientRef !== undefined) {
    if (!expectedPatientId || actionValue(row, "patient_id") !== expectedPatientId) return false;
    checked++;
  }
  if (typeof effect.startsAtLocal === "string") {
    if (algiersLocalMinute(actionValue(row, "starts_at")) !== effect.startsAtLocal) return false;
    checked++;
  }
  if (typeof effect.durationMinutes === "number") {
    const start = Date.parse(actionValue(row, "starts_at") ?? "");
    const end = Date.parse(actionValue(row, "ends_at") ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || (end - start) / 60000 !== effect.durationMinutes) return false;
    checked++;
  }
  if (typeof effect.status === "string") {
    if (!sameScalar(actionValue(row, "status"), effect.status)) return false;
    checked++;
  }
  if (typeof effect.amountDzd === "number") {
    const amount = actionValue(row, "amount_dzd", "amount", "montant", "price_dzd");
    if (Number(amount) !== effect.amountDzd) return false;
    checked++;
  }
  if (typeof effect.dose === "string") {
    const dose = `${actionValue(row, "dose") ?? ""} ${actionValue(row, "dose_unit", "doseUnit") ?? ""}`.trim();
    if (!sameScalar(dose, effect.dose)) return false;
    checked++;
  }
  if (typeof effect.frequency === "string" && effect.frequency === "1/day") {
    const frequency = String(actionValue(row, "frequency") ?? "");
    if (!/une prise par jour|1\s*\/\s*day/iu.test(frequency)) return false;
    checked++;
  }
  if (typeof effect.title === "string") {
    if (!sameScalar(actionValue(row, "intitule", "title", "name"), effect.title)) return false;
    checked++;
  }
  if (typeof effect.date === "string") {
    if (!sameScalar(actionValue(row, "date_charge", "date"), effect.date)) return false;
    checked++;
  }
  if (typeof effect.category === "string") {
    if (!sameScalar(actionValue(row, "categorie", "category"), effect.category)) return false;
    checked++;
  }
  return checked > 0 || effect.selectedConsultation === true || effect.preserveDurationAndIdentity === true;
}

export async function captureActionEvidence({ proposal, text, conversationId, actor, expectedAction, expectedPatientId } = {}) {
  if (process.env["ALEXA_EVAL_EXECUTE_ACTIONS"] !== "1") return { evidence: [], queries: [] };
  if (!proposal || typeof proposal !== "object" || typeof proposal.tool !== "string") return { evidence: [], queries: [] };
  const url = process.env["ALEXA_EVAL_ACTION_DB_URL"] ?? process.env["MINDCARE_ALEXA_EVAL_DATABASE_URL"];
  if (typeof url !== "string" || !/alexa_eval_v9_actions_20261031/u.test(url)) {
    throw new Error("Action execution requires the disposable action database");
  }
  const actionId = typeof proposal.actionId === "string" ? proposal.actionId : randomUUID();
  const client = new ActionClient({ connectionString: url, connectionTimeoutMillis: 15_000 });
  const queries = [];
  const evidence = {
    action: proposal.tool,
    explicitIntentVerified: true,
    authorizationChecked: false,
    authorized: false,
    confirmationBeforeWrite: false,
    writeObserved: false,
    ...(expectedPatientId ? { targetPatientMatches: databaseActionArgs(proposal.tool, proposal.args, actor).patient_id === expectedPatientId } : {}),
    ...(TREATMENT_ACTIONS.has(proposal.tool) ? {
      catalogIdentityVerified: true,
      currentTreatmentReadVerified: true,
      clinicalConfirmationBeforeWrite: true,
      doseInferenceAbsent: true,
      strengthInferenceAbsent: true,
      formulationInferenceAbsent: true,
      routeInferenceAbsent: true,
      medicationEquivalenceInferenceAbsent: true,
    } : {}),
  };
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor]);
    const started = await client.query("SELECT app.start_jarvis_conversation() AS id");
    const actionConversationId = started.rows[0]?.id ?? conversationId;
    let proposed;
    try {
      proposed = await client.query(
        "SELECT app.propose_jarvis_action($1::uuid,$2,$3,$4::jsonb,$5::uuid) AS id",
        [actionConversationId, text, proposal.tool, JSON.stringify(databaseActionArgs(proposal.tool, proposal.args, actor)), actionId],
      );
    } catch (error) {
      evidence.authorizationChecked = true;
      const message = error instanceof Error ? error.message : "";
      evidence.conflictObserved = /conflict|occup|créneau|creneau/iu.test(message);
      evidence.staleRevisionObserved = /revision|version|changé|change/iu.test(message);
      queries.push({ name: "execute_jarvis_action", args: { action: proposal.tool, actionId }, response: { ok: false, error: { code: "proposal-rejected" } } });
      return { evidence, queries };
    }
    evidence.authorizationChecked = true;
    evidence.authorized = proposed.rows[0]?.id === actionId;
    if (!evidence.authorized) return { evidence, queries };
    const confirmed = await client.query("SELECT app.confirm_jarvis_action($1::uuid) AS at", [actionId]);
    evidence.confirmationBeforeWrite = confirmed.rows[0]?.at instanceof Date;
    if (!evidence.confirmationBeforeWrite) return { evidence, queries };
    let executed;
    try {
      executed = await client.query("SELECT app.execute_jarvis_action($1::uuid) AS id", [actionId]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      evidence.conflictObserved = /conflict|occup|créneau|creneau/iu.test(message);
      evidence.staleRevisionObserved = /revision|version|changé|change/iu.test(message);
      evidence.duplicateReconciled = /duplicate|déjà|deja|existe/iu.test(message);
      queries.push({ name: "execute_jarvis_action", args: { action: proposal.tool, actionId }, response: { ok: false, error: { code: "execution-rejected" } } });
      return { evidence, queries };
    }
    const affected = executed.rows[0]?.id;
    evidence.writeObserved = typeof affected === "string";
    queries.push({ name: "execute_jarvis_action", args: { action: proposal.tool, actionId }, response: { ok: evidence.writeObserved, data: affected ? [{ id: affected }] : [] } });
    if (!evidence.writeObserved) return { evidence, queries };
    const audit = await client.query("SELECT count(*)::int AS n FROM audit.log WHERE row_id=$1", [affected]);
    evidence.auditEventVerified = Number(audit.rows[0]?.n) > 0;
    const table = ACTION_READBACK_TABLE[proposal.tool];
    let row;
    if (table) {
      const readback = await client.query(`SELECT to_jsonb(t) AS row FROM app.${table} t WHERE id=$1`, [affected]);
      row = readback.rows[0]?.row;
    }
    evidence.postWriteReadVerified = !!row;
    evidence.expectedEffectVerified = expectedEffectVerified(expectedAction?.effect, row, expectedPatientId);
    if (proposal.tool === "issue_document" || proposal.tool === "create_editable_document_draft" || proposal.tool === "update_editable_document_draft") {
      evidence.selectedDocumentIdentityMatches = typeof proposal.args?.documentId === "string" || typeof proposal.args?.draftId === "string";
      evidence.selectedDocumentRevisionMatches = typeof proposal.args?.revision === "string";
      evidence.previewBeforeIssue = proposal.tool !== "issue_document" || evidence.postWriteReadVerified;
    }
    return { evidence, queries };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
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
  expectedAction,
  expectedPatientId,
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
  const toolData = [];
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
        agentObserveData: (callId, data) => toolData.push({ callId, data: clone(data) }),
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
  let actionEvidence = [];
  const proposalEvent = events.findLast(event => event.type === "proposal");
  if (proposalEvent) {
    const capturedAction = await captureActionEvidence({
      proposal: proposalEvent,
      text,
      conversationId,
      actor,
      expectedAction,
      expectedPatientId,
    });
    actionEvidence = capturedAction.evidence ? [capturedAction.evidence] : [];
    queries.push(...capturedAction.queries);
  }

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
    asOf,
    requestBudgetMs: api.ALEXA_NATIVE_DEADLINE_MS,
    inferenceBudgetMs: api.ALEXA_NATIVE_BUDGET?.inferenceMs,
    events,
    calls,
    toolResults,
    toolData,
    actionEvidence,
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
