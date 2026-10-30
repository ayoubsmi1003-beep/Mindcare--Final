import { describe, expect, it } from "vitest";
import {
  createV8AdversarialProgress,
  recoverV8AdversarialProgress,
} from "../../scripts/lib/alexa-v8-campaign-progress.mjs";

const loadExecutor = async () =>
  import("../../scripts/lib/alexa-v8-campaign-executor.mjs").catch(() => null);

const manifestSha256 = "a".repeat(64);

function manifestWith(...cases: { id: string; turns: string[]; oracleCount?: number }[]) {
  return {
    version: 1,
    campaign: "alexa-v8-adversarial-250",
    status: "DRAFT_ORACLES_PENDING",
    cases: cases.map(({ oracleCount = 1, ...scenario }) => ({
      ...scenario,
      oracles: Array.from({ length: oracleCount }, () => ({ kind: "test_oracle" })),
    })),
  };
}

describe("Alexa V8 adversarial multi-turn executor", () => {
  it("requires a matching database qualification before restoring campaign verdicts", async () => {
    const api = await loadExecutor();
    expect(api).not.toBeNull();
    expect(typeof api?.matchesV8AdversarialResumeBinding).toBe("function");
    if (!api?.matchesV8AdversarialResumeBinding) return;

    const binding = {
      manifestSha256: "a".repeat(64),
      frozenManifestSha256: "b".repeat(64),
      privateOracleSha256: "c".repeat(64),
      evaluatorSha256: "d".repeat(64),
      sourceWorkingTreeSha256: "e".repeat(64),
      databaseBindingSha256: "f".repeat(64),
    };

    expect(api.matchesV8AdversarialResumeBinding({ binding, report: { run: binding } })).toBe(true);
    expect(api.matchesV8AdversarialResumeBinding({
      binding,
      report: { run: { ...binding, databaseBindingSha256: "0".repeat(64) } },
    })).toBe(false);
    expect(api.matchesV8AdversarialResumeBinding({
      binding,
      report: { run: { ...binding, databaseBindingSha256: undefined } },
    })).toBe(false);
  });

  it("selects one diagnostic case without mutating the frozen campaign or other prompts", async () => {
    const api = await loadExecutor();
    expect(api).not.toBeNull();
    if (!api?.selectV8AdversarialCase) return;
    const manifest = manifestWith(
      { id: "ADV-001", turns: ["template one"] },
      { id: "ADV-002", turns: ["template two"] },
    );
    const resolvedPrompts = { "ADV-001": ["synthetic prompt one"], "ADV-002": ["synthetic prompt two"] };

    const selected = api.selectV8AdversarialCase({ manifest, resolvedPrompts, caseId: "ADV-001" });

    expect(selected.manifest.cases).toEqual([manifest.cases[0]]);
    expect(selected.resolvedPrompts).toEqual({ "ADV-001": ["synthetic prompt one"] });
    expect(manifest.cases).toHaveLength(2);
    expect(resolvedPrompts["ADV-002"]).toEqual(["synthetic prompt two"]);
  });

  it("restores per-oracle verdicts for completed cases from a matching safe report", async () => {
    const api = await loadExecutor();
    expect(api).not.toBeNull();
    if (!api) return;
    expect(typeof api.restoreV8AdversarialOracleResults).toBe("function");
    if (!api.restoreV8AdversarialOracleResults) return;

    const manifest = manifestWith(
      { id: "ADV-004", turns: ["template"], oracleCount: 2 },
      { id: "ADV-005", turns: ["template"], oracleCount: 1 },
    );
    const binding = {
      manifestSha256,
      frozenManifestSha256: "f".repeat(64),
      privateOracleSha256: "d".repeat(64),
      evaluatorSha256: "e".repeat(64),
      sourceWorkingTreeSha256: "a".repeat(64),
      databaseBindingSha256: "f".repeat(64),
    };
    let progress = createV8AdversarialProgress({
      manifestSha256,
      scenarios: [
        { id: "ADV-004", turnCount: 1 },
        { id: "ADV-005", turnCount: 1 },
      ],
      startedAt: "2026-10-29T07:00:00.000Z",
    });
    progress = (await import("../../scripts/lib/alexa-v8-campaign-progress.mjs")).beginV8AdversarialTurn(progress, {
      scenarioId: "ADV-004",
      turnIndex: 0,
      prompt: "SYNTHETIC-PRIVATE-PROMPT",
      sessionId: "session-1",
    });
    progress = (await import("../../scripts/lib/alexa-v8-campaign-progress.mjs")).completeV8AdversarialTurn(progress, {
      scenarioId: "ADV-004",
      turnIndex: 0,
      sessionId: "session-1",
    });
    progress = (await import("../../scripts/lib/alexa-v8-campaign-progress.mjs")).adjudicateV8AdversarialCase(progress, {
      scenarioId: "ADV-004",
      status: "PASS",
      oracleCount: 2,
      passingOracleCount: 2,
      evaluatorSha256: "e".repeat(64),
      adjudicatedAt: "2026-10-29T08:00:00.000Z",
    });
    progress = (await import("../../scripts/lib/alexa-v8-campaign-progress.mjs")).beginV8AdversarialTurn(progress, {
      scenarioId: "ADV-005",
      turnIndex: 0,
      prompt: "SYNTHETIC-SECOND-PRIVATE-PROMPT",
      sessionId: "session-1",
    });
    progress = (await import("../../scripts/lib/alexa-v8-campaign-progress.mjs")).completeV8AdversarialTurn(progress, {
      scenarioId: "ADV-005",
      turnIndex: 0,
      sessionId: "session-1",
    });

    const restored = api.restoreV8AdversarialOracleResults({
      manifest,
      binding,
      progress,
      report: {
        run: binding,
        rows: [{
          id: "ADV-004",
          status: "PASS",
          oracleCount: 2,
          passingOracleCount: 2,
          evaluatorSha256: "e".repeat(64),
          oracleStatuses: ["PASS", "PASS"],
          oracleChecks: [
            { oracleIndex: 1, kind: "test_oracle", checks: [{ id: "explicit_intent", status: "PASS" }] },
            { oracleIndex: 2, kind: "test_oracle", checks: [{ id: "audit_event", status: "PASS" }] },
          ],
        }, {
          id: "ADV-005",
          status: "NOT VERIFIED",
          oracleCount: 1,
          passingOracleCount: 0,
          evaluatorSha256: "e".repeat(64),
          oracleStatuses: ["NOT VERIFIED"],
        }],
      },
    });

    expect(restored.get("ADV-004")).toEqual([
      { oracleIndex: 1, kind: "test_oracle", status: "PASS", checks: [{ id: "explicit_intent", status: "PASS" }] },
      { oracleIndex: 2, kind: "test_oracle", status: "PASS", checks: [{ id: "audit_event", status: "PASS" }] },
    ]);
    expect(restored.get("ADV-005")).toEqual([
      { oracleIndex: 1, kind: "test_oracle", status: "NOT VERIFIED" },
    ]);
    expect(api.restoreV8AdversarialOracleResults({
      manifest,
      binding,
      progress,
      report: {
        run: { ...binding, privateOracleSha256: "a".repeat(64) },
        rows: [{
          id: "ADV-004",
          status: "PASS",
          oracleCount: 2,
          passingOracleCount: 2,
          evaluatorSha256: "e".repeat(64),
          oracleStatuses: ["PASS", "PASS"],
        }],
      },
    }).size).toBe(0);
    expect(api.restoreV8AdversarialOracleResults({
      manifest,
      binding,
      progress,
      report: {
        run: { ...binding, databaseBindingSha256: "0".repeat(64) },
        rows: [{
          id: "ADV-004",
          status: "PASS",
          oracleCount: 2,
          passingOracleCount: 2,
          evaluatorSha256: "e".repeat(64),
          oracleStatuses: ["PASS", "PASS"],
        }],
      },
    }).size).toBe(0);
    expect(api.restoreV8AdversarialOracleResults({
      manifest,
      binding,
      progress,
      report: { run: { manifestSha256: "d".repeat(64) }, rows: [] },
    }).size).toBe(0);
  });

  it("runs turns in order, carries only in-memory session state, and persists no prompts or answers", async () => {
    const api = await loadExecutor();
    expect(api).not.toBeNull();
    if (!api) return;
    expect(typeof api.executeV8AdversarialCampaign).toBe("function");
    if (!api.executeV8AdversarialCampaign) return;

    const privatePrompt = "SYNTHETIC-PRIVATE-PROMPT-SHOULD-NOT-PERSIST";
    const privateAnswer = "SYNTHETIC-PRIVATE-ANSWER-SHOULD-NOT-PERSIST";
    const manifest = manifestWith({ id: "ADV-001", turns: ["template one", "template two"], oracleCount: 2 });
    let progress = createV8AdversarialProgress({
      manifestSha256,
      scenarios: [{ id: "ADV-001", turnCount: 2 }],
      startedAt: "2026-10-29T07:00:00.000Z",
    });
    const saved: unknown[] = [];
    const invoked: { id: string; index: number; state: unknown }[] = [];

    progress = await api.executeV8AdversarialCampaign({
      manifest,
      manifestSha256,
      resolvedPrompts: { "ADV-001": [privatePrompt, "SYNTHETIC-SECOND-PROMPT"] },
      progress,
      sessionId: "session-1",
      persistProgress: async value => { saved.push(structuredClone(value)); },
      invokeTurn: async input => {
        invoked.push({ id: input.scenarioId, index: input.turnIndex, state: input.sessionState });
        return {
          observation: { answer: privateAnswer },
          sessionState: input.sessionState ?? { conversationId: "synthetic-conversation" },
        };
      },
      evaluateScenario: async ({ observations }) => {
        expect(observations).toHaveLength(2);
        return {
          status: "PASS",
          oracleCount: 2,
          passingOracleCount: 2,
          evaluatorSha256: "b".repeat(64),
        };
      },
    });

    expect(invoked).toEqual([
      { id: "ADV-001", index: 0, state: undefined },
      { id: "ADV-001", index: 1, state: { conversationId: "synthetic-conversation" } },
    ]);
    expect(progress.cases[0]?.status).toBe("PASS");
    const serialized = JSON.stringify(saved);
    expect(serialized).not.toContain(privatePrompt);
    expect(serialized).not.toContain(privateAnswer);
  });

  it("leaves interrupted turns in flight, quarantines them, and runs only untouched cases after restart", async () => {
    const api = await loadExecutor();
    expect(api).not.toBeNull();
    if (!api) return;
    expect(typeof api.executeV8AdversarialCampaign).toBe("function");
    if (!api.executeV8AdversarialCampaign) return;

    const manifest = manifestWith(
      { id: "ADV-001", turns: ["first interrupted turn"] },
      { id: "ADV-002", turns: ["untouched turn"] },
    );
    let progress = createV8AdversarialProgress({
      manifestSha256,
      scenarios: [
        { id: "ADV-001", turnCount: 1 },
        { id: "ADV-002", turnCount: 1 },
      ],
      startedAt: "2026-10-29T07:00:00.000Z",
    });
    let inFlightCheckpoint: ReturnType<typeof createV8AdversarialProgress> | undefined;

    await expect(api.executeV8AdversarialCampaign({
      manifest,
      manifestSha256,
      resolvedPrompts: { "ADV-001": ["SYNTHETIC-INTERRUPTED-PROMPT"], "ADV-002": ["untouched"] },
      progress,
      sessionId: "session-before-restart",
      persistProgress: async value => { inFlightCheckpoint = structuredClone(value); },
      invokeTurn: async () => { throw new Error("synthetic interrupted invocation"); },
      evaluateScenario: async () => { throw new Error("must not adjudicate an interrupted scenario"); },
    })).rejects.toThrow("synthetic interrupted invocation");

    if (!inFlightCheckpoint) throw new Error("Expected persisted checkpoint");
    expect(inFlightCheckpoint.cases[0]?.inFlight?.turnIndex).toBe(0);
    progress = recoverV8AdversarialProgress(inFlightCheckpoint, {
      nextSessionId: "session-after-restart",
      recoveredAt: "2026-10-29T08:00:00.000Z",
    });
    const invoked: string[] = [];

    progress = await api.executeV8AdversarialCampaign({
      manifest,
      manifestSha256,
      resolvedPrompts: { "ADV-001": ["SYNTHETIC-INTERRUPTED-PROMPT"], "ADV-002": ["untouched"] },
      progress,
      sessionId: "session-after-restart",
      persistProgress: async () => {},
      invokeTurn: async input => {
        invoked.push(input.scenarioId);
        return { observation: { status: "ok" } };
      },
      evaluateScenario: async () => ({
        status: "PASS",
        oracleCount: 1,
        passingOracleCount: 1,
        evaluatorSha256: "c".repeat(64),
      }),
    });

    expect(invoked).toEqual(["ADV-002"]);
    expect(progress.cases.map(item => item.status)).toEqual(["NOT VERIFIED", "PASS"]);
  });

  it("rejects contaminated checkpoints before persistence or model invocation", async () => {
    const api = await loadExecutor();
    expect(api).not.toBeNull();
    if (!api) return;
    if (!api.executeV8AdversarialCampaign) return;

    const manifest = manifestWith({ id: "ADV-003", turns: ["template"] });
    const progress = createV8AdversarialProgress({
      manifestSha256,
      scenarios: [{ id: "ADV-003", turnCount: 1 }],
    });
    const contaminated = {
      ...progress,
      privateTranscript: "SYNTHETIC-PRIVATE-TRANSCRIPT-SHOULD-NOT-PERSIST",
    };
    let persisted = false;
    let invoked = false;

    await expect(api.executeV8AdversarialCampaign({
      manifest,
      manifestSha256,
      resolvedPrompts: { "ADV-003": ["SYNTHETIC-PROMPT"] },
      progress: contaminated,
      sessionId: "session-1",
      persistProgress: async () => { persisted = true; },
      invokeTurn: async () => {
        invoked = true;
        return { observation: {} };
      },
      evaluateScenario: async () => ({ status: "NOT VERIFIED" }),
    })).rejects.toThrow(/unexpected checkpoint fields/i);

    expect(persisted).toBe(false);
    expect(invoked).toBe(false);
  });

  it("rejects a verdict whose oracle count does not match the scenario", async () => {
    const api = await loadExecutor();
    expect(api).not.toBeNull();
    if (!api?.executeV8AdversarialCampaign) return;

    const manifest = manifestWith({ id: "ADV-005", turns: ["synthetic turn"], oracleCount: 2 });
    const progress = createV8AdversarialProgress({
      manifestSha256,
      scenarios: [{ id: "ADV-005", turnCount: 1 }],
      startedAt: "2026-10-29T07:00:00.000Z",
    });
    const saved: ReturnType<typeof createV8AdversarialProgress>[] = [];

    await expect(api.executeV8AdversarialCampaign({
      manifest,
      manifestSha256,
      resolvedPrompts: { "ADV-005": ["SYNTHETIC-PROMPT"] },
      progress,
      sessionId: "session-1",
      persistProgress: async value => { saved.push(structuredClone(value)); },
      invokeTurn: async () => ({ observation: {} }),
      evaluateScenario: async () => ({
        status: "PASS",
        oracleCount: 1,
        passingOracleCount: 1,
        evaluatorSha256: "d".repeat(64),
      }),
    })).rejects.toThrow(/oracle count.*scenario/i);

    expect(saved.at(-1)?.cases[0]?.status).toBe("NOT VERIFIED");
  });

});

