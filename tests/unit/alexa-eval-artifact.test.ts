import { expect, it } from "vitest";
import { sanitizeAlexaEvaluationArtifact } from "../../scripts/lib/alexa-eval-artifact.mjs";

it("preserves bounded per-oracle verdicts for safe campaign resume", () => {
  const artifact = sanitizeAlexaEvaluationArtifact({
    status: "PASS",
    rows: [
      {
        id: "ADV-004",
        status: "PASS",
        oracleCount: 2,
        passingOracleCount: 2,
        evaluatorSha256: "c".repeat(64),
        oracleStatuses: ["PASS", "PASS"],
        prompt: "SYNTHETIC-PRIVATE-PROMPT-SHOULD-NOT-PERSIST",
      },
      { id: "ADV-005", status: "NOT VERIFIED", oracleStatuses: ["Patient Alice"] },
    ],
  });

  expect(artifact.rows).toEqual([
    {
      id: "ADV-004",
      status: "PASS",
      failureCount: 0,
      oracleCount: 2,
      passingOracleCount: 2,
      evaluatorSha256: "c".repeat(64),
      oracleStatuses: ["PASS", "PASS"],
    },
    { id: "ADV-005", status: "NOT VERIFIED", failureCount: 0 },
  ]);
  expect(JSON.stringify(artifact)).not.toContain("SYNTHETIC-PRIVATE-PROMPT");
  expect(JSON.stringify(artifact)).not.toContain("Patient Alice");
});

it("keeps only content-free direct and agent-tool retrieval coverage", () => {
  const artifact = sanitizeAlexaEvaluationArtifact({
    status: "PASS",
    knowledgeOriginCoverage: {
      status: "PASS",
      direct: true,
      agentTool: true,
      question: "SYNTHETIC-PRIVATE-QUESTION-SHOULD-NOT-PERSIST",
    },
  });

  expect(artifact.knowledgeOriginCoverage).toEqual({ status: "PASS", direct: true, agentTool: true });
  expect(JSON.stringify(artifact)).not.toContain("SYNTHETIC-PRIVATE-QUESTION");
});

it("keeps model and gate evidence while removing clinical text, identifiers, and payloads", () => {
  const artifact = sanitizeAlexaEvaluationArtifact({
    version: 1,
    status: "FAIL",
    oracleStatusCounts: {
      knowledge_case: { total: 2, PASS: 1, FAIL: 0, "NOT RUN": 1, "NOT VERIFIED": 0 },
      "Patient Alice": { total: 1, PASS: 1 },
    },
    run: {
      id: "run-1",
      bundleSha256: "a".repeat(64),
      manifestSha256: "b".repeat(64),
      frozenManifestSha256: "c".repeat(64),
      privateOracleSha256: "d".repeat(64),
      evaluatorSha256: "e".repeat(64),
      sourceWorkingTreeSha256: "f".repeat(64),
      execution: { model: "MiniCPM-V-4_7-1B-Q4_K_M.gguf", recipe: "native-agent", gate: "runAlexa", invocation: "in_process", fallback: { used: false, causes: ["Alice"] } },
      capabilities: { approvedBookFixtureAvailable: true, secret: "Alice" },
    },
    rows: [{ id: "ADV-001", status: "FAIL", scenario: "Patient Alice asks about the note", failures: ["Answer leaked Alice"] }],
    records: [{
      id: "ADV-001",
      requestBudgetMs: 20000,
      ms: 310,
      events: [
        { type: "sentence", text: "Alice reports panic symptoms.", sources: [{ type: "patient", id: "patient-123" }] },
        { type: "done", status: "completed", parts: [{ status: "answered", resultRefs: ["patient-123"] }] },
      ],
      calls: [{ name: "get_patient_context", args: { patientId: "patient-123" }, valid: true }],
      actionGateCalls: [
        { gate: "propose_jarvis_action", ok: true, resultCount: 1, args: { patientId: "patient-123" } },
        { gate: "confirm_jarvis_action", ok: true, resultCount: 1 },
        { gate: "execute_jarvis_action", ok: true, resultCount: 1, affectedId: "consultation-123" },
        { gate: "delete_patient", ok: true, resultCount: 1 },
      ],
      toolResults: [{ status: "ok", complete: true, text: "Alice reports panic symptoms.", data: { patientId: "patient-123" } }],
      queries: [{ name: "get_alexa_clinical_context", args: { p_patient_id: "patient-123" }, response: { ok: true, data: [{ diagnosis: "panic disorder" }] } }],
      faults: [],
      timings: {
        inference: [{ ms: 80, tokensIn: 120, tokensOut: 18, kind: "answer", plainText: "Alice reports panic symptoms." }],
        tools: [{ name: "get_patient_context", ms: 12 }],
        firstVisible: 93,
      },
      knowledgeTraces: [{
        origin: "direct",
        recipe: "e5-base",
        configuredRecipe: "e5-base",
        model: { embedding: "intfloat/multilingual-e5-base", embeddingVersion: "pinned-version", dimensions: 768, reranker: "mmarco", rerankerVersion: "pinned-reranker" },
        lexical: { gate: "search_knowledge_lexical", calls: 2, rows: 5 },
        embedding: { invoked: true, status: "ok", outputDimensions: 768 },
        vector: { invoked: true, gate: "search_knowledge_vector_v2_768", rows: 4, status: "ok" },
        reranker: { mode: "cross-encoder", invocations: 1, fallback: false },
        evidence: { selected: 1, pages: 1 },
        fallbacks: [],
        result: "ok",
        durationMs: 41,
        question: "Alice’s private clinical question",
      }],
    }],
  });

  const serialized = JSON.stringify(artifact);
  for (const forbidden of ["Alice", "panic symptoms", "patient-123", "panic disorder", "private clinical question"]) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(artifact).toMatchObject({
    oracleStatusCounts: {
      knowledge_case: { total: 2, PASS: 1, FAIL: 0, "NOT RUN": 1, "NOT VERIFIED": 0 },
    },
    run: {
      id: "run-1",
      bundleSha256: "a".repeat(64),
      manifestSha256: "b".repeat(64),
      frozenManifestSha256: "c".repeat(64),
      privateOracleSha256: "d".repeat(64),
      evaluatorSha256: "e".repeat(64),
      sourceWorkingTreeSha256: "f".repeat(64),
      execution: { model: "MiniCPM-V-4_7-1B-Q4_K_M.gguf", recipe: "native-agent", gate: "runAlexa", invocation: "in_process", fallback: { used: false, causes: [] } },
      capabilities: { approvedBookFixtureAvailable: true },
    },
    rows: [{ id: "ADV-001", status: "FAIL", failureCount: 1 }],
    records: [{
      id: "ADV-001",
      requestBudgetMs: 20000,
      events: [{ type: "sentence", textChars: 29, sourceTypes: ["patient"] }, { type: "done", status: "completed" }],
      calls: [{ name: "get_patient_context", valid: true }],
      actionGateCalls: [
        { gate: "propose_jarvis_action", ok: true, resultCount: 1 },
        { gate: "confirm_jarvis_action", ok: true, resultCount: 1 },
        { gate: "execute_jarvis_action", ok: true, resultCount: 1 },
      ],
      queries: [{ name: "get_alexa_clinical_context", ok: true, resultCount: 1 }],
        knowledgeTraces: [{
          origin: "direct",
          recipe: "e5-base",
          configuredRecipe: "e5-base",
          model: { embedding: "intfloat/multilingual-e5-base", embeddingVersion: "pinned-version", dimensions: 768, reranker: "mmarco", rerankerVersion: "pinned-reranker" },
          lexical: { gate: "search_knowledge_lexical", calls: 2, rows: 5 },
          embedding: { invoked: true, status: "ok", outputDimensions: 768 },
          vector: { invoked: true, gate: "search_knowledge_vector_v2_768", rows: 4, status: "ok" },
          reranker: { mode: "cross-encoder", invocations: 1, fallback: false },
          evidence: { selected: 1, pages: 1 },
          fallbacks: [],
          result: "ok",
          durationMs: 41,
        }],
      timings: { inference: [{ ms: 80, tokensIn: 120, tokensOut: 18, kind: "answer" }], firstVisible: 93 },
    }],
  });
});

it("retains only bounded action preparation metadata in evaluation records", () => {
  const artifact = sanitizeAlexaEvaluationArtifact({
    status: "PARTIAL",
    records: [{
      id: "ADV-012",
      toolResults: [{
        status: "needs_input",
        actionName: "create_appointment",
        rankedCandidateCount: 2,
        requiredInputWasMissing: true,
        catalogIdentityVerified: true,
        callId: "private-call-id",
        patientId: "11111111-1111-4111-8111-111111111111",
        candidateLabels: ["Patient Alice", "Patient Bob"],
      }],
    }],
  });

  expect(artifact.records[0]?.toolResults).toEqual([{
    status: "needs_input",
    actionName: "create_appointment",
    rankedCandidateCount: 2,
    requiredInputWasMissing: true,
    catalogIdentityVerified: true,
    evidenceCount: 0,
    evidenceTypes: [],
  }]);
  const serialized = JSON.stringify(artifact);
  for (const forbidden of ["private-call-id", "11111111", "Patient Alice", "Patient Bob"]) {
    expect(serialized).not.toContain(forbidden);
  }
});

it("keeps allowlisted per-turn execution metadata without prompt or patient text", () => {
  const artifact = sanitizeAlexaEvaluationArtifact({
    status: "PARTIAL",
    records: [{
      id: "ADV-013",
      execution: {
        model: "MiniCPM-V-4_7-1B-Q4_K_M.gguf",
        recipe: "native-agent",
        gate: "runAlexa",
        invocation: "in_process",
        fallback: { used: true, causes: ["LocalModelUnavailable", "InferenceFailure", "Patient Alice"] },
        prompt: "Patient Alice private prompt",
      },
    }],
  });

  expect(artifact.records[0]).toMatchObject({
    id: "ADV-013",
    execution: {
      model: "MiniCPM-V-4_7-1B-Q4_K_M.gguf",
      recipe: "native-agent",
      gate: "runAlexa",
      invocation: "in_process",
      fallback: { used: true, causes: ["LocalModelUnavailable", "InferenceFailure"] },
    },
  });
  const serialized = JSON.stringify(artifact);
  expect(serialized).not.toContain("Patient Alice");
  expect(serialized).not.toContain("private prompt");
});
