import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const loadProgressApi = async () =>
  import("../../scripts/lib/alexa-v8-campaign-progress.mjs").catch(() => null);

describe("Alexa V8 adversarial campaign checkpoints", () => {
  it("stores prompt digests only and keeps completed scenarios unverified pending oracle review", async () => {
    const api = await loadProgressApi();
    expect(api).not.toBeNull();
    if (!api) return;

    const manifestSha256 = "a".repeat(64);
    const prompt = "SYNTHETIC-PRIVATE-PROMPT-SHOULD-NOT-PERSIST";
    let progress = api.createV8AdversarialProgress({
      manifestSha256,
      scenarios: [{ id: "ADV-001", turnCount: 2 }],
      startedAt: "2026-10-29T07:00:00.000Z",
    });

    progress = api.beginV8AdversarialTurn(progress, {
      scenarioId: "ADV-001",
      turnIndex: 0,
      prompt,
      sessionId: "session-1",
    });
    expect(JSON.stringify(progress)).not.toContain(prompt);
    expect(progress.cases[0]?.inFlight?.promptSha256)
      .toBe(createHash("sha256").update(prompt).digest("hex"));

    progress = api.completeV8AdversarialTurn(progress, {
      scenarioId: "ADV-001",
      turnIndex: 0,
      sessionId: "session-1",
    });
    progress = api.beginV8AdversarialTurn(progress, {
      scenarioId: "ADV-001",
      turnIndex: 1,
      prompt: "Deuxième tour synthétique.",
      sessionId: "session-1",
    });
    progress = api.completeV8AdversarialTurn(progress, {
      scenarioId: "ADV-001",
      turnIndex: 1,
      sessionId: "session-1",
    });

    expect(progress.cases[0]).toMatchObject({
      status: "NOT VERIFIED",
      nextTurn: 2,
      awaitingAdjudication: true,
      turnSha256: [
        createHash("sha256").update(prompt).digest("hex"),
        createHash("sha256").update("Deuxième tour synthétique.").digest("hex"),
      ],
    });
  });

  it("quarantines an interrupted case without replaying it and resumes untouched cases", async () => {
    const api = await loadProgressApi();
    expect(api).not.toBeNull();
    if (!api) return;

    let progress = api.createV8AdversarialProgress({
      manifestSha256: "b".repeat(64),
      scenarios: [
        { id: "ADV-001", turnCount: 2 },
        { id: "ADV-002", turnCount: 1 },
      ],
      startedAt: "2026-10-29T07:00:00.000Z",
    });
    progress = api.beginV8AdversarialTurn(progress, {
      scenarioId: "ADV-001",
      turnIndex: 0,
      prompt: "SYNTHETIC-INTERRUPTED-PROMPT",
      sessionId: "session-before-restart",
    });

    progress = api.recoverV8AdversarialProgress(progress, {
      nextSessionId: "session-after-restart",
      recoveredAt: "2026-10-29T08:00:00.000Z",
    });

    expect(progress.cases[0]).toMatchObject({
      status: "NOT VERIFIED",
      stopReason: "interrupted_case_requires_reconciliation",
      nextTurn: 0,
      inFlight: null,
    });
    expect(JSON.stringify(progress)).not.toContain("SYNTHETIC-INTERRUPTED-PROMPT");
    expect(() => api.beginV8AdversarialTurn(progress, {
      scenarioId: "ADV-001",
      turnIndex: 0,
      prompt: "SYNTHETIC-INTERRUPTED-PROMPT",
      sessionId: "session-after-restart",
    })).toThrow(/not runnable/i);

    const resumed = api.beginV8AdversarialTurn(progress, {
      scenarioId: "ADV-002",
      turnIndex: 0,
      prompt: "Tour synthétique indépendant.",
      sessionId: "session-after-restart",
    });
    expect(resumed.activeCaseId).toBe("ADV-002");
  });
});



  it("rejects checkpoint files containing fields outside the privacy-safe allowlist", async () => {
    const api = await loadProgressApi();
    expect(api).not.toBeNull();
    if (!api) return;

    const progress = api.createV8AdversarialProgress({
      manifestSha256: "c".repeat(64),
      scenarios: [{ id: "ADV-003", turnCount: 1 }],
      startedAt: "2026-10-29T07:00:00.000Z",
    });
    const contaminated = {
      ...progress,
      privateTranscript: "SYNTHETIC-PRIVATE-TRANSCRIPT-SHOULD-NEVER-PERSIST",
    };

    expect(() => api.beginV8AdversarialTurn(contaminated, {
      scenarioId: "ADV-003",
      turnIndex: 0,
      prompt: "Tour synthétique.",
      sessionId: "session-1",
    })).toThrow(/unexpected checkpoint fields/i);
  });



  it("keeps execution unverified until an independent oracle verdict is recorded", async () => {
    const api = await loadProgressApi();
    expect(api).not.toBeNull();
    if (!api) return;
    expect(typeof api.adjudicateV8AdversarialCase).toBe("function");
    if (!api.adjudicateV8AdversarialCase) return;

    let progress = api.createV8AdversarialProgress({
      manifestSha256: "d".repeat(64),
      scenarios: [{ id: "ADV-004", turnCount: 1 }],
      startedAt: "2026-10-29T07:00:00.000Z",
    });
    progress = api.beginV8AdversarialTurn(progress, {
      scenarioId: "ADV-004",
      turnIndex: 0,
      prompt: "Tour synthétique d'adjudication.",
      sessionId: "session-1",
    });
    progress = api.completeV8AdversarialTurn(progress, {
      scenarioId: "ADV-004",
      turnIndex: 0,
      sessionId: "session-1",
    });

    expect(progress.cases[0]?.status).toBe("NOT VERIFIED");
    progress = api.adjudicateV8AdversarialCase(progress, {
      scenarioId: "ADV-004",
      status: "PASS",
      oracleCount: 3,
      passingOracleCount: 3,
      evaluatorSha256: "e".repeat(64),
      adjudicatedAt: "2026-10-29T08:00:00.000Z",
    });

    expect(progress.cases[0]).toMatchObject({
      status: "PASS",
      awaitingAdjudication: false,
      oracleCount: 3,
      passingOracleCount: 3,
      evaluatorSha256: "e".repeat(64),
    });
  });

