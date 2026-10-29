const evaluationStatuses = new Set(["PASS", "FAIL", "PARTIAL", "NOT RUN", "NOT VERIFIED"]);
const eventStatuses = new Set(["answered", "cancelled", "completed", "empty", "failed", "needs_input", "pending", "unsupported"]);
const toolStatuses = new Set(["ok", "partial", "empty", "unsupported", "needs_input", "error", "cancelled", "pending", "failed"]);
const sourceTypes = new Set(["appointment", "consultation", "document", "knowledge", "patient", "query", "treatment", "diagnostic", "scale"]);
const caseId = value => typeof value === "string" && /^(?:ADV-\d{3}|v8-\d{3}|\d{1,4}-[a-z]{2,8}|[a-z]{2,4}-\d{3})$/iu.test(value);
const gateName = value => typeof value === "string" && /^(?:get|query|list|search|save|create|update|delete|issue|execute|record|cancel|close)_[a-z0-9_]{1,56}$/u.test(value);
const eventTypes = new Set(["sentence", "done", "proposal", "error"]);
const knowledgeOrigins = new Set(["direct", "agent_tool", "patient_context", "unknown"]);
const knowledgeRecipes = new Set(["lexical-only", "unapproved-secondary", "primary-bge-m3", "e5-small", "e5-base"]);
const knowledgeStatuses = new Set(["not-enabled", "pending", "ok", "failed", "not-calibrated", "missing-provider"]);
const knowledgeResults = new Set(["ok", "faible", "sans-preuve", "panne", "aborted", "unknown"]);
const knowledgeFallbacks = new Set([
  "query-unplanned", "lexical-gate-failed", "embedding-unavailable", "vector-gate-failed",
  "vector-recipe-not-calibrated", "reranker-fallback", "section-leaf-retry",
  "oversized-evidence-omitted", "section-leaf-relaxed", "aborted", "adapter-error",
]);
const vectorGates = new Set(["search_knowledge_vector", "search_knowledge_vector_v2", "search_knowledge_vector_v2_768"]);
const actionGateNames = new Set([
  "propose_jarvis_action", "confirm_jarvis_action", "reject_jarvis_action", "execute_jarvis_action",
]);
const actionNames = new Set([
  "create_appointment", "reschedule_appointment", "cancel_appointment", "mark_patient_arrived",
  "set_consultation_price", "record_payment_collected", "close_consultation",
  "create_editable_document_draft", "print_issued_document", "update_treatment", "pause_treatment",
  "resume_treatment", "stop_treatment", "create_charge", "update_charge", "deactivate_charge",
  "update_editable_document_draft", "send_internal_message",
]);
const oracleKinds = new Set(["snapshot_case", "knowledge_case", "route_contract", "retrieval_contract", "action_contract", "plan_contract", "clinical_contract"]);
const oracleStatuses = ["PASS", "FAIL", "NOT RUN", "NOT VERIFIED"];

const object = value => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value : [];
const token = value => typeof value === "string" && /^[a-z0-9_-]{1,64}$/iu.test(value) ? value : undefined;
const finite = value => Number.isFinite(value) && value >= 0 ? value : undefined;
const status = value => evaluationStatuses.has(value) ? value : "NOT VERIFIED";
const eventStatus = value => eventStatuses.has(value) ? value : undefined;

function safeRun(value) {
  const run = object(value);
  const execution = object(run.execution);
  return {
    ...(typeof run.id === "string" && (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(run.id) || /^run-[a-z0-9_-]{1,48}$/iu.test(run.id)) ? { id: run.id } : {}),
    ...(typeof run.startedAt === "string" && Number.isFinite(Date.parse(run.startedAt)) ? { startedAt: run.startedAt } : {}),
    ...(typeof run.bundleSha256 === "string" && /^[a-f0-9]{64}$/u.test(run.bundleSha256) ? { bundleSha256: run.bundleSha256 } : {}),
    ...(typeof run.manifestSha256 === "string" && /^[a-f0-9]{64}$/u.test(run.manifestSha256) ? { manifestSha256: run.manifestSha256 } : {}),
    ...(typeof run.frozenManifestSha256 === "string" && /^[a-f0-9]{64}$/u.test(run.frozenManifestSha256) ? { frozenManifestSha256: run.frozenManifestSha256 } : {}),
    ...(typeof run.privateOracleSha256 === "string" && /^[a-f0-9]{64}$/u.test(run.privateOracleSha256) ? { privateOracleSha256: run.privateOracleSha256 } : {}),
    ...(typeof run.evaluatorSha256 === "string" && /^[a-f0-9]{64}$/u.test(run.evaluatorSha256) ? { evaluatorSha256: run.evaluatorSha256 } : {}),
    ...(typeof run.sourceWorkingTreeSha256 === "string" && /^[a-f0-9]{64}$/u.test(run.sourceWorkingTreeSha256) ? { sourceWorkingTreeSha256: run.sourceWorkingTreeSha256 } : {}),
    ...(typeof run.fixtureAsOf === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(run.fixtureAsOf) ? { fixtureAsOf: run.fixtureAsOf } : {}),
    ...(typeof object(run.capabilities).approvedBookFixtureAvailable === "boolean" ? { capabilities: { approvedBookFixtureAvailable: object(run.capabilities).approvedBookFixtureAvailable } } : {}),
    ...(Object.keys(execution).length ? { execution: {
      ...(typeof execution.model === "string" && /^[a-z0-9._-]{1,80}\.gguf$/iu.test(execution.model) ? { model: execution.model } : {}),
      ...(execution.recipe === "native-agent" ? { recipe: execution.recipe } : {}),
      ...(execution.gate === "runAlexa" ? { gate: execution.gate } : {}),
      ...(execution.invocation === "in_process" ? { invocation: execution.invocation } : {}),
      ...(execution.fallback && typeof execution.fallback === "object" ? { fallback: {
        ...(typeof object(execution.fallback).used === "boolean" ? { used: object(execution.fallback).used } : {}),
        causes: list(object(execution.fallback).causes).filter(cause => ["LocalModelAssetAccess", "LocalModelIntegrity", "LocalModelBusy", "LocalModelUnavailable", "TimeoutError", "AbortError", "InferenceFailure", "inference_fallback"].includes(cause)),
      } } : {}),
    } } : {}),
  };
}

function safeEvent(value) {
  const event = object(value);
  const type = eventTypes.has(event.type) ? event.type : "unknown";
  if (type === "sentence") {
    const sources = list(event.sources);
    return {
      type,
      ...(typeof event.text === "string" ? { textChars: event.text.length } : {}),
      ...(["fact", "inference", "knowledge"].includes(event.kind) ? { kind: event.kind } : {}),
      sourceCount: sources.length,
      sourceTypes: [...new Set(sources.map(source => token(object(source).type)).filter(type => type && sourceTypes.has(type)))].sort(),
    };
  }
  if (type === "done") {
    const parts = list(event.parts);
    return {
      type,
      ...(eventStatus(event.status) ? { status: event.status } : {}),
      ...(typeof event.limited === "boolean" ? { limited: event.limited } : {}),
      ...(typeof event.speechAllowed === "boolean" ? { speechAllowed: event.speechAllowed } : {}),
      partCount: parts.length,
      partStatuses: parts.map(part => eventStatus(object(part).status) ?? "unknown"),
      ...(event.navigation && typeof object(event.navigation).target === "string" ? { navigationTarget: token(object(event.navigation).target) ?? "unknown" } : {}),
    };
  }
  if (type === "error") {
    return { type, ...( ["unavailable", "cancelled", "stale", "invalid"].includes(event.code) ? { code: event.code } : {}), ...(typeof event.partial === "boolean" ? { partial: event.partial } : {}) };
  }
  return { type, ...(eventStatus(event.status) ? { status: event.status } : {}) };
}

function safeRow(value) {
  const row = object(value);
  const failures = list(row.failures);
  const rawOracleStatuses = list(row.oracleStatuses);
  const safeOracleStatuses = rawOracleStatuses.length > 0 && rawOracleStatuses.length <= 32 &&
    rawOracleStatuses.every(result => oracleStatuses.includes(result)) ? rawOracleStatuses : undefined;
  const qualification = object(row.qualification);
  const safeQualification = Object.fromEntries(Object.entries(qualification)
    .filter(([key, result]) => token(key) && evaluationStatuses.has(result))
    .map(([key, result]) => [key, result]));
  return {
    ...(caseId(row.id) ? { id: row.id } : {}),
    status: status(row.status),
    failureCount: failures.length,
    ...(Number.isInteger(row.oracleCount) && row.oracleCount > 0 && row.oracleCount <= 32 ? { oracleCount: row.oracleCount } : {}),
    ...(Number.isInteger(row.passingOracleCount) && row.passingOracleCount >= 0 &&
      Number.isInteger(row.oracleCount) && row.passingOracleCount <= row.oracleCount
      ? { passingOracleCount: row.passingOracleCount } : {}),
    ...(typeof row.evaluatorSha256 === "string" && /^[a-f0-9]{64}$/u.test(row.evaluatorSha256)
      ? { evaluatorSha256: row.evaluatorSha256 } : {}),
    ...(safeOracleStatuses ? { oracleStatuses: safeOracleStatuses } : {}),
    ...(finite(row.ms) !== undefined ? { ms: row.ms } : {}),
    ...(Object.keys(safeQualification).length ? { qualification: safeQualification } : {}),
    ...(row.correctness && typeof row.correctness === "object" ? { correctnessStatus: status(object(row.correctness).status) } : {}),
    ...(row.timing && typeof row.timing === "object" ? { timingStatus: status(object(row.timing).requestBudgetStatus) } : {}),
  };
}

function safeKnowledgeTrace(value) {
  const trace = object(value);
  const model = object(trace.model);
  const lexical = object(trace.lexical);
  const embedding = object(trace.embedding);
  const vector = object(trace.vector);
  const reranker = object(trace.reranker);
  const evidence = object(trace.evidence);
  const safeIdentifier = item => typeof item === "string" && /^[a-z0-9._:/-]{1,120}$/iu.test(item) ? item : undefined;
  const safeDimension = item => Number.isInteger(item) && item > 0 && item <= 4096 ? item : undefined;
  const safeCount = item => Number.isInteger(item) && item >= 0 && item <= 1000000 ? item : undefined;
  const safeStatus = item => knowledgeStatuses.has(item) ? item : undefined;
  return {
    ...(knowledgeOrigins.has(trace.origin) ? { origin: trace.origin } : {}),
    ...(knowledgeRecipes.has(trace.recipe) ? { recipe: trace.recipe } : {}),
    ...(knowledgeRecipes.has(trace.configuredRecipe) || trace.configuredRecipe === "unapproved"
      ? { configuredRecipe: trace.configuredRecipe } : {}),
    model: {
      ...(safeIdentifier(model.embedding) ? { embedding: safeIdentifier(model.embedding) } : {}),
      ...(safeIdentifier(model.embeddingVersion) ? { embeddingVersion: safeIdentifier(model.embeddingVersion) } : {}),
      ...(safeDimension(model.dimensions) ? { dimensions: safeDimension(model.dimensions) } : {}),
      ...(safeIdentifier(model.reranker) ? { reranker: safeIdentifier(model.reranker) } : {}),
      ...(safeIdentifier(model.rerankerVersion) ? { rerankerVersion: safeIdentifier(model.rerankerVersion) } : {}),
    },
    lexical: {
      ...(lexical.gate === "search_knowledge_lexical" ? { gate: lexical.gate } : {}),
      ...(safeCount(lexical.calls) !== undefined ? { calls: safeCount(lexical.calls) } : {}),
      ...(safeCount(lexical.rows) !== undefined ? { rows: safeCount(lexical.rows) } : {}),
    },
    embedding: {
      ...(typeof embedding.invoked === "boolean" ? { invoked: embedding.invoked } : {}),
      ...(safeStatus(embedding.status) ? { status: safeStatus(embedding.status) } : {}),
      ...(embedding.status === "not-enabled" ? { status: "not-enabled" } : {}),
      ...(safeDimension(embedding.outputDimensions) ? { outputDimensions: safeDimension(embedding.outputDimensions) } : {}),
    },
    vector: {
      ...(typeof vector.invoked === "boolean" ? { invoked: vector.invoked } : {}),
      ...(vectorGates.has(vector.gate) ? { gate: vector.gate } : {}),
      ...(safeCount(vector.rows) !== undefined ? { rows: safeCount(vector.rows) } : {}),
      ...(safeStatus(vector.status) ? { status: safeStatus(vector.status) } : {}),
      ...(vector.status === "not-enabled" ? { status: "not-enabled" } : {}),
    },
    reranker: {
      ...(reranker.mode === "cross-encoder" || reranker.mode === "heuristic-baseline" ? { mode: reranker.mode } : {}),
      ...(safeCount(reranker.invocations) !== undefined ? { invocations: safeCount(reranker.invocations) } : {}),
      ...(typeof reranker.fallback === "boolean" ? { fallback: reranker.fallback } : {}),
    },
    evidence: {
      ...(safeCount(evidence.selected) !== undefined ? { selected: safeCount(evidence.selected) } : {}),
      ...(safeCount(evidence.pages) !== undefined ? { pages: safeCount(evidence.pages) } : {}),
    },
    fallbacks: list(trace.fallbacks).filter(item => knowledgeFallbacks.has(item)),
    ...(knowledgeResults.has(trace.result) ? { result: trace.result } : {}),
    ...(finite(trace.durationMs) !== undefined ? { durationMs: trace.durationMs } : {}),
  };
}

export function sanitizeAlexaKnowledgeTrace(value) {
  return safeKnowledgeTrace(value);
}

function safeRecord(value) {
  const record = object(value);
  const timings = object(record.timings);
  const safeExecution = safeRun({ execution: record.execution }).execution;
  return {
    ...(caseId(record.id) ? { id: record.id } : {}),
    ...(finite(record.requestBudgetMs) !== undefined ? { requestBudgetMs: record.requestBudgetMs } : {}),
    ...(finite(record.inferenceBudgetMs) !== undefined ? { inferenceBudgetMs: record.inferenceBudgetMs } : {}),
    ...(finite(record.ms) !== undefined ? { ms: record.ms } : {}),
    ...(safeExecution && Object.keys(safeExecution).length ? { execution: safeExecution } : {}),
    events: list(record.events).map(safeEvent),
    calls: list(record.calls).map(call => ({
      ...(object(call).valid === true && gateName(object(call).name) ? { name: object(call).name } : { name: "invalid-call" }),
      ...(typeof object(call).valid === "boolean" ? { valid: object(call).valid } : {}),
    })),
    toolResults: list(record.toolResults).map(result => ({
      ...(toolStatuses.has(object(result).status) ? { status: object(result).status } : {}),
      ...(typeof object(result).complete === "boolean" ? { complete: object(result).complete } : {}),
      ...(actionNames.has(object(result).actionName) ? { actionName: object(result).actionName } : {}),
      ...(Number.isInteger(object(result).rankedCandidateCount) && object(result).rankedCandidateCount >= 0 && object(result).rankedCandidateCount <= 100
        ? { rankedCandidateCount: object(result).rankedCandidateCount } : {}),
      ...(typeof object(result).requiredInputWasMissing === "boolean" ? { requiredInputWasMissing: object(result).requiredInputWasMissing } : {}),
      ...Object.fromEntries(["catalogIdentityVerified", "currentTreatmentReadVerified", "doseInferenceAbsent", "strengthInferenceAbsent",
        "formulationInferenceAbsent", "routeInferenceAbsent", "medicationEquivalenceInferenceAbsent"]
        .filter(key => object(result)[key] === true).map(key => [key, true])),
      ...(typeof object(result).text === "string" ? { textChars: object(result).text.length } : {}),
      evidenceCount: list(object(result).evidence).length,
      evidenceTypes: [...new Set(list(object(result).evidence).map(source => token(object(source).type)).filter(type => type && sourceTypes.has(type)))].sort(),
    })),
    queries: list(record.queries).map(query => ({
      ...(gateName(object(query).name) ? { name: object(query).name } : { name: "unknown-gate" }),
      ok: object(query).response?.ok === true,
      resultCount: list(object(query).response?.data).length,
    })),
    actionGateCalls: list(record.actionGateCalls).flatMap(call => {
      const item = object(call);
      if (!actionGateNames.has(item.gate)) return [];
      return [{
        gate: item.gate,
        ...(typeof item.ok === "boolean" ? { ok: item.ok } : {}),
        ...(finite(item.resultCount) !== undefined ? { resultCount: item.resultCount } : {}),
      }];
    }),
    knowledgeTraces: list(record.knowledgeTraces).map(safeKnowledgeTrace),
    faults: list(record.faults).map(fault => ({
      ...(gateName(object(fault).tool) ? { tool: object(fault).tool } : {}),
      ...(["database", "timeout", "model-unavailable"].includes(object(fault).kind) ? { kind: object(fault).kind } : {}),
      ...(typeof object(fault).code === "string" && /^[0-9A-Z]{5}$/u.test(object(fault).code) ? { code: object(fault).code } : {}),
    })),
    timings: {
      inference: list(timings.inference).map(entry => ({
        ...(finite(object(entry).ms) !== undefined ? { ms: object(entry).ms } : {}),
        ...(finite(object(entry).tokensIn) !== undefined ? { tokensIn: object(entry).tokensIn } : {}),
        ...(finite(object(entry).tokensOut) !== undefined ? { tokensOut: object(entry).tokensOut } : {}),
        ...(["answer", "calls"].includes(object(entry).kind) ? { kind: object(entry).kind } : {}),
        ...(["LocalModelAssetAccess", "LocalModelIntegrity", "LocalModelBusy", "LocalModelUnavailable", "TimeoutError", "AbortError", "InferenceFailure"].includes(object(entry).error) ? { error: object(entry).error } : {}),
      })),
      tools: list(timings.tools).map(entry => ({
        ...(gateName(object(entry).name) ? { name: object(entry).name } : { name: "unknown-gate" }),
        ...(finite(object(entry).ms) !== undefined ? { ms: object(entry).ms } : {}),
        ...(typeof object(entry).fault === "boolean" ? { fault: object(entry).fault } : {}),
      })),
      ...(finite(timings.firstVisible) !== undefined ? { firstVisible: timings.firstVisible } : {}),
    },
  };
}

/** A report projection for local review; raw prompts, answers, IDs, args and rows stay in memory only. */
export function sanitizeAlexaEvaluationArtifact(value) {
  const report = object(value);
  const rawTally = object(report.tally);
  const tally = Object.fromEntries(["PASS", "FAIL", "PARTIAL", "NOT RUN", "NOT VERIFIED"]
    .filter(key => Number.isInteger(rawTally[key]) && rawTally[key] >= 0)
    .map(key => [key, rawTally[key]]));
  const rawOracleCounts = object(report.oracleStatusCounts);
  const oracleStatusCounts = Object.fromEntries(Object.entries(rawOracleCounts)
    .filter(([kind, counts]) => oracleKinds.has(kind) && Number.isInteger(object(counts).total) && object(counts).total >= 0)
    .map(([kind, counts]) => [kind, {
      total: object(counts).total,
      ...Object.fromEntries(oracleStatuses.filter(key => Number.isInteger(object(counts)[key]) && object(counts)[key] >= 0)
        .map(key => [key, object(counts)[key]])),
    }]));
  const rawOriginCoverage = object(report.knowledgeOriginCoverage);
  const knowledgeOriginCoverage = ["PASS", "NOT RUN", "NOT VERIFIED"].includes(rawOriginCoverage.status) &&
    typeof rawOriginCoverage.direct === "boolean" && typeof rawOriginCoverage.agentTool === "boolean"
    ? { status: rawOriginCoverage.status, direct: rawOriginCoverage.direct, agentTool: rawOriginCoverage.agentTool }
    : undefined;
  return {
    version: finite(report.version) ?? 1,
    status: status(report.status),
    run: safeRun(report.run),
    ...(Object.keys(tally).length ? { tally } : {}),
    ...(Object.keys(oracleStatusCounts).length ? { oracleStatusCounts } : {}),
    ...(knowledgeOriginCoverage ? { knowledgeOriginCoverage } : {}),
    rows: list(report.rows).map(safeRow),
    records: list(report.records).map(safeRecord),
  };
}
