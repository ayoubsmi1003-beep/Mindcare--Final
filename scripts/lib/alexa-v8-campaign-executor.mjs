import {
  adjudicateV8AdversarialCase,
  beginV8AdversarialTurn,
  completeV8AdversarialTurn,
  createV8AdversarialProgress,
  validateV8AdversarialProgress,
} from "./alexa-v8-campaign-progress.mjs";

/**
 * @typedef {{id: string; turns: string[]; oracles: unknown[]; [key: string]: unknown}} V8AdversarialScenario
 * @typedef {ReturnType<typeof createV8AdversarialProgress>} V8AdversarialProgress
 * @typedef {{
 *   manifest: {version: number; campaign: string; status: string; cases: V8AdversarialScenario[]};
 *   manifestSha256: string;
 *   resolvedPrompts: Record<string, string[]>;
 *   progress: V8AdversarialProgress;
 *   sessionId: string;
 *   invokeTurn: (input: {
 *     scenarioId: string;
 *     scenario: V8AdversarialScenario;
 *     turnIndex: number;
 *     prompt: string;
 *     sessionState: unknown;
 *     previousObservations: unknown[];
 *   }) => Promise<{observation: unknown; sessionState?: unknown}>;
 *   evaluateScenario: (input: {
 *     scenario: V8AdversarialScenario;
 *     observations: unknown[];
 *   }) => Promise<
 *     | {status: "PASS" | "FAIL"; oracleCount: number; passingOracleCount: number; evaluatorSha256: string; adjudicatedAt?: string}
 *     | {status: "NOT VERIFIED"}
 *   >;
 *   persistProgress: (progress: V8AdversarialProgress) => Promise<void> | void;
 *   clock?: () => string;
 * }} V8AdversarialExecutorOptions
 */

const CAMPAIGN = "alexa-v8-adversarial-250";
const CASE_ID = /^ADV-\d{3}$/u;
const ORACLE_STATUSES = new Set(["PASS", "FAIL", "NOT RUN", "NOT VERIFIED"]);
const RESUME_BINDING_FIELDS = [
  "manifestSha256", "frozenManifestSha256", "privateOracleSha256", "evaluatorSha256",
  "sourceWorkingTreeSha256", "databaseBindingSha256",
];

/** A saved verdict can be reused only for the same source and qualified synthetic database. */
export function matchesV8AdversarialResumeBinding({ binding, report } = {}) {
  const run = report?.run;
  return RESUME_BINDING_FIELDS.every(field => /^[a-f0-9]{64}$/u.test(binding?.[field] ?? "") &&
    run?.[field] === binding[field]);
}

/** Selects one manifest-bound scenario for a diagnostic run without changing the frozen source manifest. */
export function selectV8AdversarialCase({ manifest, resolvedPrompts, caseId } = {}) {
  requireInput(manifest?.version === 1 && manifest.campaign === CAMPAIGN && Array.isArray(manifest.cases),
    "Invalid V8 adversarial manifest");
  requireInput(CASE_ID.test(caseId ?? ""), "Invalid V8 adversarial case ID");
  const scenario = manifest.cases.find(item => item?.id === caseId);
  const prompts = resolvedPrompts?.[caseId];
  requireInput(scenario && Array.isArray(scenario.turns) && Array.isArray(prompts) &&
    prompts.length === scenario.turns.length && prompts.every(prompt => typeof prompt === "string" && prompt.trim()),
  "V8 adversarial case or resolved prompts are unavailable");
  return {
    manifest: { ...manifest, cases: [scenario] },
    resolvedPrompts: { [caseId]: prompts },
  };
}

function requireInput(condition, message) {
  if (!condition) throw new Error(message);
}

/** Restores only complete per-oracle verdict vectors bound to the same manifest and evaluator. */
export function restoreV8AdversarialOracleResults({ manifest, binding, progress: progressValue, report } = {}) {
  const restored = new Map();
  let progress;
  try {
    progress = validateV8AdversarialProgress(progressValue);
  } catch {
    return restored;
  }
  if (manifest?.version !== 1 || manifest.campaign !== CAMPAIGN || !Array.isArray(manifest.cases) ||
      !matchesV8AdversarialResumeBinding({ binding, report }) ||
      binding.manifestSha256 !== progress.manifestSha256 ||
      !report?.run) return restored;

  for (const scenario of manifest.cases) {
    const savedCase = progress.cases.find(item => item.id === scenario?.id);
    const adjudicated = ["PASS", "FAIL"].includes(savedCase?.status);
    const awaitingAdjudication = savedCase?.status === "NOT VERIFIED" && savedCase.awaitingAdjudication &&
      savedCase.nextTurn === savedCase.turnCount;
    if (!savedCase || (!adjudicated && !awaitingAdjudication) || !Array.isArray(scenario.oracles) ||
        savedCase.turnCount !== scenario.turns?.length || (adjudicated && savedCase.oracleCount !== scenario.oracles.length)) continue;
    const rows = Array.isArray(report.rows) ? report.rows.filter(row => row?.id === scenario.id) : [];
    if (rows.length !== 1) continue;
    const row = rows[0];
    const statuses = row.oracleStatuses;
    if (row.status !== savedCase.status || row.oracleCount !== scenario.oracles.length ||
        row.evaluatorSha256 !== binding.evaluatorSha256 || !Array.isArray(statuses) ||
        statuses.length !== scenario.oracles.length || statuses.some(status => !ORACLE_STATUSES.has(status))) continue;
    const passingOracleCount = statuses.filter(status => status === "PASS").length;
    if (row.passingOracleCount !== passingOracleCount ||
        adjudicated && (passingOracleCount !== savedCase.passingOracleCount ||
          savedCase.evaluatorSha256 !== binding.evaluatorSha256) ||
        (savedCase.status === "PASS" && statuses.some(status => status !== "PASS")) ||
        (savedCase.status === "FAIL" && !statuses.includes("FAIL")) ||
        (awaitingAdjudication && statuses.includes("FAIL"))) continue;
    const checkRows = Array.isArray(row.oracleChecks) ? row.oracleChecks : [];
    const hasCompleteChecks = checkRows.length === scenario.oracles.length && checkRows.every((checks, index) =>
      checks?.oracleIndex === index + 1 && checks.kind === scenario.oracles[index]?.kind && Array.isArray(checks.checks) &&
      checks.checks.every(check => typeof check?.id === "string" &&
        (/^[a-z][a-z0-9_]{0,63}$/u.test(check.id) || ["direct_readKnowledge", "agent_tool_readKnowledge"].includes(check.id)) &&
        ORACLE_STATUSES.has(check.status)));
    restored.set(scenario.id, statuses.map((status, index) => ({
      oracleIndex: index + 1,
      kind: scenario.oracles[index]?.kind ?? "unknown",
      status,
      ...(hasCompleteChecks ? { checks: checkRows[index].checks.map(({ id, status: checkStatus }) => ({ id, status: checkStatus })) } : {}),
    })));
  }
  return restored;
}

/**
 * Runs resolved multi-turn prompts while keeping raw turns and observations in memory only.
 * Checkpoints are written before and after every invocation. An interrupted turn remains in flight
 * so recovery can quarantine it instead of replaying a possibly consequential action.
 * @param {V8AdversarialExecutorOptions} options
 * @returns {Promise<V8AdversarialProgress>}
 */
export async function executeV8AdversarialCampaign({
  manifest,
  manifestSha256,
  resolvedPrompts,
  progress: initialProgress,
  sessionId,
  invokeTurn,
  evaluateScenario,
  persistProgress,
  clock = () => new Date().toISOString(),
} = {}) {
  requireInput(manifest && manifest.version === 1 && manifest.campaign === CAMPAIGN &&
    Array.isArray(manifest.cases) && manifest.cases.length >= 1 && manifest.cases.length <= 300,
  "Invalid V8 adversarial manifest");
  requireInput(typeof manifestSha256 === "string" && initialProgress?.manifestSha256 === manifestSha256,
    "Adversarial manifest digest mismatch");
  requireInput(resolvedPrompts && typeof resolvedPrompts === "object" && !Array.isArray(resolvedPrompts),
    "Resolved adversarial prompts are required");
  requireInput(typeof invokeTurn === "function" && typeof evaluateScenario === "function" &&
    typeof persistProgress === "function", "Adversarial executor dependencies are required");

  let progress = validateV8AdversarialProgress(initialProgress);
  const progressById = new Map(progress.cases.map(item => [item.id, item]));
  const seen = new Set();
  for (const scenario of manifest.cases) {
    requireInput(scenario && CASE_ID.test(scenario.id) && !seen.has(scenario.id) &&
      Array.isArray(scenario.turns) && scenario.turns.length >= 1 && scenario.turns.length <= 4 &&
      Array.isArray(scenario.oracles) && scenario.oracles.length >= 1,
    "Invalid V8 adversarial scenario");
    seen.add(scenario.id);
    const savedCase = progressById.get(scenario.id);
    const prompts = resolvedPrompts[scenario.id];
    requireInput(savedCase && savedCase.turnCount === scenario.turns.length &&
      Array.isArray(prompts) && prompts.length === scenario.turns.length &&
      prompts.every(prompt => typeof prompt === "string" && prompt.trim().length > 0),
    "Adversarial prompt or progress binding mismatch");
  }

  const saveProgress = async value => persistProgress(validateV8AdversarialProgress(value));
  await saveProgress(progress);
  for (const scenario of manifest.cases) {
    const checkpoint = progress.cases.find(item => item.id === scenario.id);
    if (!checkpoint || checkpoint.status !== "NOT RUN") continue;

    const observations = [];
    let sessionState;
    const prompts = resolvedPrompts[scenario.id];
    for (let turnIndex = 0; turnIndex < prompts.length; turnIndex++) {
      progress = beginV8AdversarialTurn(progress, {
        scenarioId: scenario.id,
        turnIndex,
        prompt: prompts[turnIndex],
        sessionId,
        startedAt: clock(),
      });
      await saveProgress(progress);

      const result = await invokeTurn({
        scenarioId: scenario.id,
        scenario,
        turnIndex,
        prompt: prompts[turnIndex],
        sessionState,
        previousObservations: observations,
      });
      requireInput(result && typeof result === "object" && Object.hasOwn(result, "observation"),
        "Adversarial turn did not return an observation");
      observations.push(result.observation);
      if (Object.hasOwn(result, "sessionState")) sessionState = result.sessionState;

      progress = completeV8AdversarialTurn(progress, {
        scenarioId: scenario.id,
        turnIndex,
        sessionId,
        completedAt: clock(),
      });
      await saveProgress(progress);
    }

    const verdict = await evaluateScenario({ scenario, observations });
    if (verdict?.status === "PASS" || verdict?.status === "FAIL") {
      requireInput(verdict.oracleCount === scenario.oracles.length &&
        Number.isInteger(verdict.passingOracleCount) && verdict.passingOracleCount >= 0 &&
        verdict.passingOracleCount <= verdict.oracleCount &&
        (verdict.status === "PASS" ? verdict.passingOracleCount === verdict.oracleCount
          : verdict.passingOracleCount < verdict.oracleCount),
      "Adversarial oracle count or verdict does not match the scenario");
      progress = adjudicateV8AdversarialCase(progress, {
        scenarioId: scenario.id,
        status: verdict.status,
        oracleCount: verdict.oracleCount,
        passingOracleCount: verdict.passingOracleCount,
        evaluatorSha256: verdict.evaluatorSha256,
        adjudicatedAt: verdict.adjudicatedAt ?? clock(),
      });
      await saveProgress(progress);
    }
  }
  return progress;
}

