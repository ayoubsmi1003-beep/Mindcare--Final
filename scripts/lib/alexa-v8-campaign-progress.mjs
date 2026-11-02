import { createHash } from "node:crypto";

/**
 * @typedef {"NOT RUN" | "PARTIAL" | "NOT VERIFIED" | "PASS" | "FAIL"} V8ProgressStatus
 * @typedef {{
 *   id: string;
 *   turnCount: number;
 *   status: V8ProgressStatus;
 *   nextTurn: number;
 *   turnSha256: string[];
 *   inFlight: null | { turnIndex: number; promptSha256: string };
 *   awaitingAdjudication: boolean;
 *   stopReason: null | "interrupted_case_requires_reconciliation" | "awaiting_independent_adjudication";
 *   oracleCount: number | null;
 *   passingOracleCount: number | null;
 *   evaluatorSha256: string | null;
 * }} V8ProgressCase
 * @typedef {{
 *   version: 1;
 *   campaign: "alexa-v8-adversarial-250";
 *   manifestSha256: string;
 *   startedAt: string;
 *   updatedAt: string;
 *   sessionId: string | null;
 *   activeCaseId: string | null;
 *   cases: V8ProgressCase[];
 * }} V8Progress
 */

const CAMPAIGN = "alexa-v8-adversarial-250";
const CASE_ID = /^ADV-\d{3}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const STATUSES = new Set(["NOT RUN", "PARTIAL", "NOT VERIFIED", "PASS", "FAIL"]);

function requireInput(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

function clone(value) {
  return structuredClone(value);
}

function validSessionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,80}$/u.test(value);
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** @param {unknown} progress @returns {V8Progress} */
function validateProgress(progress) {
  requireInput(isRecord(progress), "Invalid V8 adversarial progress artifact");
  requireInput(exactKeys(progress, ["version", "campaign", "manifestSha256", "startedAt", "updatedAt", "sessionId", "activeCaseId", "cases"]),
    "Unexpected checkpoint fields");
  requireInput(progress.version === 1 && progress.campaign === CAMPAIGN, "Invalid V8 adversarial progress artifact");
  requireInput(SHA256.test(progress.manifestSha256), "Invalid adversarial manifest digest");
  requireInput(validTimestamp(progress.startedAt) && validTimestamp(progress.updatedAt),
    "Invalid adversarial progress timestamps");
  requireInput(progress.sessionId === null || validSessionId(progress.sessionId),
    "Invalid adversarial progress session");
  requireInput(progress.activeCaseId === null || CASE_ID.test(progress.activeCaseId),
    "Invalid active adversarial scenario");
  requireInput(Array.isArray(progress.cases) && progress.cases.length > 0 && progress.cases.length <= 300,
    "Invalid adversarial progress cases");

  const ids = new Set();
  const activeCases = [];
  for (const item of progress.cases) {
    requireInput(isRecord(item), "Invalid adversarial progress case");
    requireInput(exactKeys(item, ["id", "turnCount", "status", "nextTurn", "turnSha256", "inFlight", "awaitingAdjudication", "stopReason", "oracleCount", "passingOracleCount", "evaluatorSha256"]),
      "Unexpected checkpoint fields");
    requireInput(CASE_ID.test(item.id) && !ids.has(item.id), "Invalid or duplicate adversarial progress case");
    ids.add(item.id);
    requireInput(Number.isInteger(item.turnCount) && item.turnCount >= 1 && item.turnCount <= 4 &&
      Number.isInteger(item.nextTurn) && item.nextTurn >= 0 && item.nextTurn <= item.turnCount,
    "Invalid adversarial progress turn count");
    requireInput(STATUSES.has(item.status) && Array.isArray(item.turnSha256) &&
      item.turnSha256.length === item.nextTurn && item.turnSha256.every(digest => SHA256.test(digest)),
    "Invalid adversarial progress status or turn digests");
    requireInput(typeof item.awaitingAdjudication === "boolean" &&
      (item.stopReason === null || item.stopReason === "interrupted_case_requires_reconciliation" ||
        item.stopReason === "awaiting_independent_adjudication"),
    "Invalid adversarial progress review state");
    requireInput((item.oracleCount === null || (Number.isInteger(item.oracleCount) && item.oracleCount >= 1)) &&
      (item.passingOracleCount === null || (Number.isInteger(item.passingOracleCount) && item.passingOracleCount >= 0 &&
        item.oracleCount !== null && item.passingOracleCount <= item.oracleCount)) &&
      (item.evaluatorSha256 === null || SHA256.test(item.evaluatorSha256)),
    "Invalid adversarial adjudication metadata");

    if (item.inFlight !== null) {
      requireInput(exactKeys(item.inFlight, ["turnIndex", "promptSha256"]), "Unexpected checkpoint fields");
      requireInput(isRecord(item.inFlight) && item.inFlight.turnIndex === item.nextTurn &&
        SHA256.test(item.inFlight.promptSha256),
      "Invalid in-flight adversarial turn");
      activeCases.push(item.id);
    }
    if (item.status === "NOT RUN") {
      requireInput(item.nextTurn === 0 && item.inFlight === null && item.stopReason === null &&
        item.awaitingAdjudication === false, "Invalid untouched adversarial case");
    }
    if (item.status === "PARTIAL") {
      requireInput(item.nextTurn < item.turnCount && item.stopReason === null &&
        item.awaitingAdjudication === false, "Invalid partial adversarial case");
    }
    if (item.status === "NOT VERIFIED") {
      requireInput(item.inFlight === null && ((item.awaitingAdjudication && item.nextTurn === item.turnCount &&
        item.stopReason === "awaiting_independent_adjudication") ||
        (!item.awaitingAdjudication && item.stopReason === "interrupted_case_requires_reconciliation")),
      "Invalid unverified adversarial case");
    }
    if (item.status === "PASS" || item.status === "FAIL") {
      requireInput(item.nextTurn === item.turnCount && item.inFlight === null && !item.awaitingAdjudication &&
        item.stopReason === null && Number.isInteger(item.oracleCount) && item.oracleCount >= 1 &&
        Number.isInteger(item.passingOracleCount) && item.passingOracleCount >= 0 &&
        item.passingOracleCount <= item.oracleCount && SHA256.test(item.evaluatorSha256) &&
        (item.status === "PASS" ? item.passingOracleCount === item.oracleCount : item.passingOracleCount < item.oracleCount),
      "Invalid adversarial oracle verdict");
    }
    if (item.status === "NOT RUN" || item.status === "PARTIAL" ||
        (item.status === "NOT VERIFIED" && !item.awaitingAdjudication)) {
      requireInput(item.oracleCount === null && item.passingOracleCount === null && item.evaluatorSha256 === null,
        "Unexpected adjudication on incomplete adversarial case");
    }
  }
  requireInput(activeCases.length <= 1 &&
    (progress.activeCaseId === null ? activeCases.length === 0 : activeCases[0] === progress.activeCaseId),
  "Inconsistent active adversarial turn");
  return /** @type {V8Progress} */ (progress);
}

function findCase(progress, scenarioId) {
  const item = progress.cases.find(entry => entry.id === scenarioId);
  requireInput(item, "Unknown adversarial scenario");
  return item;
}

/**
 * Creates a content-free checkpoint for the separate adversarial campaign.
 * @param {{manifestSha256: string; scenarios: {id: string; turnCount: number}[]; startedAt?: string}} options
 * @returns {V8Progress}
 */
export function createV8AdversarialProgress({ manifestSha256, scenarios, startedAt = new Date().toISOString() } = {}) {
  requireInput(SHA256.test(manifestSha256), "Invalid adversarial manifest digest");
  requireInput(Array.isArray(scenarios) && scenarios.length > 0 && scenarios.length <= 300,
    "Adversarial scenarios are required");

  const seen = new Set();
  const cases = scenarios.map(scenario => {
    requireInput(isRecord(scenario) && CASE_ID.test(scenario.id) && !seen.has(scenario.id) &&
      Number.isInteger(scenario.turnCount) && scenario.turnCount >= 1 && scenario.turnCount <= 4,
    "Invalid or duplicate adversarial scenario");
    seen.add(scenario.id);
    return {
      id: scenario.id,
      turnCount: scenario.turnCount,
      status: "NOT RUN",
      nextTurn: 0,
      turnSha256: [],
      inFlight: null,
      awaitingAdjudication: false,
      stopReason: null,
      oracleCount: null,
      passingOracleCount: null,
      evaluatorSha256: null,
    };
  });
  requireInput(validTimestamp(startedAt), "Invalid adversarial progress start time");

  const progress = {
    version: 1,
    campaign: CAMPAIGN,
    manifestSha256,
    startedAt,
    updatedAt: startedAt,
    sessionId: null,
    activeCaseId: null,
    cases,
  };
  validateProgress(progress);
  return progress;
}

/**
 * Marks a turn in flight before invocation; only a digest of the private prompt is persisted.
 * @param {V8Progress} progressValue
 * @param {{scenarioId: string; turnIndex: number; prompt: string; sessionId: string; startedAt?: string}} options
 * @returns {V8Progress}
 */
export function beginV8AdversarialTurn(progressValue, {
  scenarioId,
  turnIndex,
  prompt,
  sessionId,
  startedAt = new Date().toISOString(),
} = {}) {
  const progress = clone(validateProgress(progressValue));
  requireInput(validSessionId(sessionId), "Invalid adversarial runtime session");
  requireInput(validTimestamp(startedAt), "Invalid adversarial turn start time");
  requireInput(typeof prompt === "string" && prompt.trim().length > 0, "Adversarial prompt is required");
  requireInput(progress.sessionId === null || progress.sessionId === sessionId,
    "Campaign session changed; recover the progress before continuing");
  requireInput(progress.activeCaseId === null || progress.activeCaseId === scenarioId,
    "Another adversarial scenario is active");

  const item = findCase(progress, scenarioId);
  requireInput(item.status === "NOT RUN" || item.status === "PARTIAL",
    "Adversarial scenario is not runnable");
  requireInput(item.inFlight === null && turnIndex === item.nextTurn && turnIndex < item.turnCount,
    "Unexpected adversarial turn order");

  progress.sessionId = sessionId;
  progress.activeCaseId = scenarioId;
  item.status = "PARTIAL";
  item.inFlight = {
    turnIndex,
    promptSha256: createHash("sha256").update(prompt).digest("hex"),
  };
  progress.updatedAt = startedAt;
  validateProgress(progress);
  return progress;
}

/**
 * Completes one observed turn without treating execution as a passing oracle verdict.
 * @param {V8Progress} progressValue
 * @param {{scenarioId: string; turnIndex: number; sessionId: string; completedAt?: string}} options
 * @returns {V8Progress}
 */
export function completeV8AdversarialTurn(progressValue, {
  scenarioId,
  turnIndex,
  sessionId,
  completedAt = new Date().toISOString(),
} = {}) {
  const progress = clone(validateProgress(progressValue));
  requireInput(validSessionId(sessionId) && progress.sessionId === sessionId,
    "Adversarial runtime session mismatch");
  requireInput(validTimestamp(completedAt), "Invalid adversarial turn completion time");
  const item = findCase(progress, scenarioId);
  requireInput(progress.activeCaseId === scenarioId && item.inFlight?.turnIndex === turnIndex &&
    item.nextTurn === turnIndex, "No matching adversarial turn is in flight");

  item.turnSha256.push(item.inFlight.promptSha256);
  item.inFlight = null;
  item.nextTurn += 1;
  progress.activeCaseId = null;
  progress.updatedAt = completedAt;
  if (item.nextTurn === item.turnCount) {
    item.status = "NOT VERIFIED";
    item.awaitingAdjudication = true;
    item.stopReason = "awaiting_independent_adjudication";
  } else {
    item.status = "PARTIAL";
  }
  validateProgress(progress);
  return progress;
}

/**
 * Quarantines interrupted scenarios so a possibly completed write is never replayed automatically.
 * @param {V8Progress} progressValue
 * @param {{nextSessionId: string; recoveredAt?: string}} options
 * @returns {V8Progress}
 */
export function recoverV8AdversarialProgress(progressValue, {
  nextSessionId,
  recoveredAt = new Date().toISOString(),
} = {}) {
  const progress = clone(validateProgress(progressValue));
  requireInput(validSessionId(nextSessionId) && nextSessionId !== progress.sessionId,
    "A new adversarial runtime session is required");
  requireInput(validTimestamp(recoveredAt), "Invalid adversarial recovery time");

  for (const item of progress.cases) {
    if (item.status === "PARTIAL" || item.inFlight !== null) {
      item.status = "NOT VERIFIED";
      item.inFlight = null;
      item.awaitingAdjudication = false;
      item.stopReason = "interrupted_case_requires_reconciliation";
    }
  }
  progress.sessionId = nextSessionId;
  progress.activeCaseId = null;
  progress.updatedAt = recoveredAt;
  validateProgress(progress);
  return progress;
}



/**
 * Records a deterministic independent-oracle verdict after all turns have completed.
 * @param {V8Progress} progressValue
 * @param {{scenarioId: string; status: "PASS" | "FAIL"; oracleCount: number; passingOracleCount: number; evaluatorSha256: string; adjudicatedAt?: string}} options
 * @returns {V8Progress}
 */
export function adjudicateV8AdversarialCase(progressValue, {
  scenarioId,
  status,
  oracleCount,
  passingOracleCount,
  evaluatorSha256,
  adjudicatedAt = new Date().toISOString(),
} = {}) {
  const progress = clone(validateProgress(progressValue));
  requireInput(validTimestamp(adjudicatedAt), "Invalid adversarial adjudication time");
  requireInput(status === "PASS" || status === "FAIL", "Invalid adversarial oracle verdict");
  requireInput(Number.isInteger(oracleCount) && oracleCount >= 1 &&
    Number.isInteger(passingOracleCount) && passingOracleCount >= 0 && passingOracleCount <= oracleCount &&
    SHA256.test(evaluatorSha256), "Invalid adversarial oracle evidence");
  requireInput(status === "PASS" ? passingOracleCount === oracleCount : passingOracleCount < oracleCount,
    "Adversarial oracle verdict does not match its check counts");

  const item = findCase(progress, scenarioId);
  requireInput(item.status === "NOT VERIFIED" && item.awaitingAdjudication &&
    item.nextTurn === item.turnCount && item.stopReason === "awaiting_independent_adjudication",
  "Adversarial scenario is not ready for adjudication");

  item.status = status;
  item.awaitingAdjudication = false;
  item.stopReason = null;
  item.oracleCount = oracleCount;
  item.passingOracleCount = passingOracleCount;
  item.evaluatorSha256 = evaluatorSha256;
  progress.updatedAt = adjudicatedAt;
  validateProgress(progress);
  return progress;
}



/** Returns a validated copy of a local campaign checkpoint. */
export function validateV8AdversarialProgress(progressValue) {
  return clone(validateProgress(progressValue));
}

