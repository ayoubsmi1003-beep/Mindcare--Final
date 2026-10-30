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

it("preserves only safe oracle check IDs and nonnegative egress counts", () => {
  const artifact = sanitizeAlexaEvaluationArtifact({
    status: "FAIL",
    rows: [{
      id: "ADV-001",
      status: "FAIL",
      oracleCount: 1,
      passingOracleCount: 0,
      evaluatorSha256: "a".repeat(64),
      oracleStatuses: ["FAIL"],
      oracleChecks: [{
        oracleIndex: 1,
        kind: "knowledge_case",
        checks: [
          { id: "answer_evidence", status: "NOT VERIFIED" },
          { id: "direct_readKnowledge", status: "PASS" },
          { id: "source", status: "FAIL", sourceTitleMatched: false, sourceSectionMatched: true, citationMatched: false, privateLabel: "Synthetic private content" },
          { id: "Patient Alice private note", status: "FAIL" },
        ],
        answer: "SYNTHETIC-PRIVATE-ANSWER",
      }],
    }],
    records: [
      { id: "ADV-001", externalEgressCount: 0, prompt: "SYNTHETIC-PRIVATE-PROMPT" },
      { id: "ADV-002", externalEgressCount: -1 },
    ],
  });

  expect(artifact.rows[0]).toMatchObject({
    id: "ADV-001",
    oracleChecks: [{
      oracleIndex: 1,
      kind: "knowledge_case",
      checks: [
        { id: "answer_evidence", status: "NOT VERIFIED" },
        { id: "direct_readKnowledge", status: "PASS" },
        { id: "source", status: "FAIL", sourceTitleMatched: false, sourceSectionMatched: true, citationMatched: false },
      ],
    }],
  });
  expect(artifact.records[0]).toMatchObject({ id: "ADV-001", externalEgressCount: 0 });
  expect(artifact.records[1]).not.toHaveProperty("externalEgressCount");
  const serialized = JSON.stringify(artifact);
  for (const forbidden of ["Patient Alice", "private note", "Synthetic private content", "SYNTHETIC-PRIVATE-ANSWER", "SYNTHETIC-PRIVATE-PROMPT"]) {
    expect(serialized).not.toContain(forbidden);
  }
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
  }]);
  const serialized = JSON.stringify(artifact);
  for (const forbidden of ["private-call-id", "11111111", "Patient Alice", "Patient Bob"]) {
    expect(serialized).not.toContain(forbidden);
  }
});


it("links safe runtime observations by case ID and retains content-free knowledge counts", () => {
  const artifact = sanitizeAlexaEvaluationArtifact({
    status: "PARTIAL",
    records: [{
      caseId: "ADV-021",
      ms: 42,
      toolResults: [{
        status: "ok",
        knowledgeSourceCount: 2,
        knowledgeExcerptCount: 1,
        privateText: "SYNTHETIC-PRIVATE-EXCERPT",
      }],
    }],
  });

  expect(artifact.records[0]).toMatchObject({
    id: "ADV-021",
    toolResults: [{ status: "ok", knowledgeSourceCount: 2, knowledgeExcerptCount: 1 }],
  });
  expect(artifact.records[0]).not.toHaveProperty("caseId");
  expect(JSON.stringify(artifact)).not.toContain("SYNTHETIC-PRIVATE-EXCERPT");
});

it("keeps safe citation and part counts when a campaign record is sanitized twice", () => {
  const first = sanitizeAlexaEvaluationArtifact({ records: [{
    id: "ADV-001",
    events: [
      { type: "sentence", kind: "knowledge", text: "Synthetic answer", sources: [
        { type: "knowledge", id: "synthetic-source", label: "Synthetic source", excerpt: "Synthetic quote", provenance: { pageImprimee: 42 } },
      ] },
      { type: "done", status: "partial", limited: true, speechAllowed: true, parts: [
        { status: "budget_limited", resultRefs: ["synthetic-call"] },
      ] },
    ],
  }] });

  const second = sanitizeAlexaEvaluationArtifact({ records: first.records });

  expect(second.records[0]?.events).toEqual(first.records[0]?.events);
  expect(second.records[0]?.events).toEqual([
    { type: "sentence", textChars: 16, kind: "knowledge", sourceCount: 1, sourceTypes: ["knowledge"], knowledgeSourceCount: 1, knowledgeExcerptCount: 1, knowledgePageCount: 1 },
    { type: "done", status: "partial", limited: true, speechAllowed: true, partCount: 1, partStatuses: ["budget_limited"] },
  ]);
  expect(JSON.stringify(second)).not.toContain("Synthetic quote");
  expect(JSON.stringify(second)).not.toContain("synthetic-call");
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

it("retains only aggregate synthetic database and migration evidence for resume binding", () => {
  const artifact = sanitizeAlexaEvaluationArtifact({
    run: {
      databaseTarget: "alexa_eval_v8_intelligence_20261027",
      databaseBindingSha256: "f".repeat(64),
      sourceCount: 9,
      databaseSnapshot: { patients: 1558, consultations: 8143, nonSynthetic: 0 },
      migrationInventory: {
        status: "PASS",
        repositoryCount: 206,
        appliedCount: 188,
        highestRepositoryVersion: "209_analysis_indexes",
        acknowledgedHistoricalVersions: ["173_document_autofill_context"],
      },
      resumeBindingStatus: "mismatch_restarted_fresh",
    },
  });

  expect(artifact.run).toMatchObject({
    databaseTarget: "alexa_eval_v8_intelligence_20261027",
    databaseBindingSha256: "f".repeat(64),
    sourceCount: 9,
    databaseSnapshot: { patients: 1558, consultations: 8143, nonSynthetic: 0 },
    migrationInventory: {
      status: "PASS",
      repositoryCount: 206,
      appliedCount: 188,
      highestRepositoryVersion: "209_analysis_indexes",
      acknowledgedHistoricalVersions: ["173_document_autofill_context"],
    },
    resumeBindingStatus: "mismatch_restarted_fresh",
  });
});

it("preserves allowlisted agent tool names while stripping call arguments", () => {
  const artifact = sanitizeAlexaEvaluationArtifact({
    records: [{
      id: "ADV-205",
      calls: [
        { name: "prepare_action", valid: true, args: { action: "update_treatment", privateText: "SYNTHETIC-PRIVATE" } },
        { name: "query_patients", valid: false, args: { patientName: "SYNTHETIC-PRIVATE" } },
        { name: "unregistered_tool", valid: false, args: { secret: "SYNTHETIC-PRIVATE" } },
      ],
    }],
  });

  expect(artifact.records[0]?.calls).toEqual([
    { name: "prepare_action", valid: true },
    { name: "query_patients", valid: false },
    { name: "invalid-call", valid: false },
  ]);
  expect(JSON.stringify(artifact)).not.toContain("SYNTHETIC-PRIVATE");
});

it("distinguishes a print navigation request from print-dialog evidence", () => {
  const artifact = sanitizeAlexaEvaluationArtifact({
    records: [{
      id: "ADV-231",
      events: [{ type: "done", navigation: {
        target: "document",
        print: true,
        printDialogOpened: false,
        documentWorkspace: false,
      } }],
    }],
  });

  expect(artifact.records[0]?.events[0]).toMatchObject({
    type: "done",
    navigationTarget: "document",
    navigationPrint: true,
    printDialogOpened: false,
    navigationDocumentWorkspace: false,
  });
});

it("reports only known row counts from structured RPC results", () => {
  const artifact = sanitizeAlexaEvaluationArtifact({
    records: [{
      id: "ADV-082",
      queries: [
        { name: "search_patients", response: { ok: true, data: { items: [{ id: "PRIVATE-1" }, { id: "PRIVATE-2" }] } } },
        { name: "get_patient", response: { ok: true, data: { id: "PRIVATE-1", status: "active" } } },
      ],
    }],
  });

  expect(artifact.records[0]?.queries).toEqual([
    { name: "search_patients", ok: true, resultCount: 2 },
    { name: "get_patient", ok: true },
  ]);
  expect(JSON.stringify(artifact)).not.toContain("PRIVATE-");
});
