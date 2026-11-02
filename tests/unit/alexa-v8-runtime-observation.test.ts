import { afterEach, describe, expect, it, vi } from "vitest";

const loadCapture = async () => import("../../scripts/lib/alexa-v8-runtime-observation.mjs").catch(() => null);
const loadTurnRunner = async () => import("../../scripts/lib/alexa-v8-runtime-observation.mjs").catch(() => null);

afterEach(() => vi.restoreAllMocks());

describe("Alexa V8 runtime knowledge trace capture", () => {
  it("merges observed fallback causes without retaining free-form text", async () => {
    const api = await loadTurnRunner();
    expect(api).not.toBeNull();
    if (!api) return;
    expect(api.mergeAlexaExecutionFallback).toBeTypeOf("function");
    if (typeof api.mergeAlexaExecutionFallback !== "function") return;

    expect(api.mergeAlexaExecutionFallback(
      { used: false, causes: [] },
      { used: true, causes: ["LocalModelUnavailable", "InferenceFailure", "Patient Alice"] },
    )).toEqual({ used: true, causes: ["LocalModelUnavailable", "InferenceFailure"] });
    expect(api.mergeAlexaExecutionFallback(
      { used: true, causes: ["LocalModelUnavailable"] },
      { used: false, causes: ["LocalModelUnavailable"] },
    )).toEqual({ used: true, causes: ["LocalModelUnavailable"] });
  });

  it("captures only adapter trace events and restores the existing logger", async () => {
    const api = await loadCapture();
    expect(api).not.toBeNull();
    if (!api) return;

    const trace = { origin: "direct", recipe: "lexical-only", result: "ok", evidence: { selected: 1, pages: 1 }, question: "synthetic private question" };
    const unrelated = vi.spyOn(console, "info").mockImplementation(() => {});

    const captured = await api.captureAlexaKnowledgeTraces(async () => {
      console.info("[alexa-knowledge-execution]", JSON.stringify(trace));
      console.info("unrelated local diagnostic", "content-free");
      return "turn-result";
    });

    expect(captured).toEqual({ value: "turn-result", knowledgeTraces: [{
      origin: "direct", recipe: "lexical-only", result: "ok", evidence: { selected: 1, pages: 1 },
      model: {}, lexical: {}, embedding: {}, vector: {}, reranker: {}, fallbacks: [],
    }] });
    expect(JSON.stringify(captured)).not.toContain("synthetic private question");
    expect(unrelated).toHaveBeenCalledWith("unrelated local diagnostic", "content-free");
  });

  it("executes a direct readKnowledge call and returns only its direct trace", async () => {
    const api = await loadTurnRunner();
    expect(api).not.toBeNull();
    expect(api?.runAlexaV8DirectKnowledge).toBeTypeOf("function");
    if (!api || typeof api.runAlexaV8DirectKnowledge !== "function") return;

    const sql = { marker: "synthetic-sql-client" };
    const readKnowledge = vi.fn(async (_client: unknown, _question: string, _signal: unknown, _deps: unknown, options: { traceOrigin: string }) => {
      console.info("[alexa-knowledge-execution]", JSON.stringify({
        origin: options.traceOrigin,
        recipe: "e5-small",
        configuredRecipe: "e5-small",
        model: { embedding: "intfloat/multilingual-e5-small", dimensions: 384, reranker: null, rerankerVersion: null },
        lexical: { gate: "search_knowledge_lexical", calls: 1, rows: 1 },
        embedding: { invoked: true, status: "ok", outputDimensions: 384 },
        vector: { invoked: true, gate: "search_knowledge_vector_v2", rows: 1, status: "ok" },
        reranker: { mode: "heuristic-baseline", invocations: 0, fallback: false },
        evidence: { selected: 1, pages: 1 },
        fallbacks: [],
        result: "ok",
      }));
      return {
        etat: "ok",
        preuves: [{
          titre: "Synthetic book",
          section: "Chapter X",
          version: "v1",
          extrait: "private source excerpt",
          page: { pageImprimee: 17, pagePdf: null, libelle: "p. 17" },
        }],
      };
    });
    const runtime = { clientSql: vi.fn(() => sql), readKnowledge };

    const observation = await api.runAlexaV8DirectKnowledge({
      api: runtime,
      actor: "synthetic-actor",
      question: "Question synthétique",
      signal: AbortSignal.timeout(1000),
    });

    expect(runtime.clientSql).toHaveBeenCalledWith("synthetic-actor");
    expect(readKnowledge).toHaveBeenCalledWith(sql, "Question synthétique", expect.any(AbortSignal), undefined, { traceOrigin: "direct" });
    expect(observation.knowledgeTraces).toMatchObject([{ origin: "direct", recipe: "e5-small", embedding: { invoked: true, status: "ok" } }]);
    expect(observation.evidenceSummary).toEqual({
      state: "ok",
      sourceCount: 1,
      sources: [{ title: "Synthetic book", version: "v1", section: "Chapter X", page: "p. 17", excerptUtf8Bytes: 22 }],
    });
    expect(JSON.stringify(observation)).not.toContain("private source excerpt");
  });

  it("restores the logger when a captured turn throws", async () => {
    const api = await loadCapture();
    expect(api).not.toBeNull();
    if (!api) return;
    const logger = console.info;

    await expect(api.captureAlexaKnowledgeTraces(async () => {
      console.info("[alexa-knowledge-execution]", "not-json");
      throw new Error("synthetic turn failure");
    })).rejects.toThrow("synthetic turn failure");

    expect(console.info).toBe(logger);
  });

  it("records a runAlexa turn with database and inference evidence while blocking external fetches", async () => {
    const api = await loadTurnRunner();
    expect(api).not.toBeNull();
    if (!api) return;

    const runtime = {
      ALEXA_CONVERSATION_MODEL: "MiniCPM-V-4_7-1B-Q4_K_M.gguf",
      ALEXA_NATIVE_DEADLINE_MS: 20000,
      ALEXA_NATIVE_BUDGET: { inferenceMs: 10000 },
      agentSchemas: { query_patients: { safeParse: () => ({ success: true }) } },
      compactDeclarationSchema: { safeParse: () => ({ success: true }) },
      alexaDb: () => ({ rpc: async (name: string) => ({ ok: true, data: [{ name }] }) }),
      clientSql: () => ({ rpc: async () => ({ error: null, data: [] }) }),
      inferLocalCompletion: async () => ({ kind: "answer", text: "Synthetic answer", tokensIn: 20, tokensOut: 3 }),
      runAlexa: async (_input: unknown, dependencies: Record<string, any>, emit: (event: unknown) => void) => {
        await dependencies.db.rpc("get_patients", {});
        await dependencies.db.rpc("propose_jarvis_action", { p_tool_args: "private action arguments" });
        await dependencies.db.rpc("confirm_jarvis_action", { p_id: "private-action-id" });
        await dependencies.db.rpc("execute_jarvis_action", { p_id: "private-action-id" });
        await dependencies.agentInfer([], {});
        console.info("[alexa-knowledge-execution]", JSON.stringify({ origin: "direct", recipe: "lexical-only", result: "ok" }));
        try { await fetch("https://external.invalid/eval"); } catch { /* The evaluator must block this boundary. */ }
        emit({ type: "sentence", text: "Synthetic answer", kind: "fact", sources: [] });
        emit({ type: "done", status: "completed", parts: [] });
      },
    };

    const observation = await api.runAlexaV8Turn({
      api: runtime,
      actor: "synthetic-actor",
      text: "synthetic prompt",
      conversationId: "conversation-1",
      clientTurnId: "turn-1",
      appContext: { patientId: null, page: "/jarvis" },
      asOf: "2026-10-29T00:00:00.000Z",
    });

    expect(observation).toMatchObject({
      execution: { model: "MiniCPM-V-4_7-1B-Q4_K_M.gguf", gate: "runAlexa", invocation: "in_process" },
      queries: [
        { name: "get_patients", response: { ok: true } },
        { name: "propose_jarvis_action", response: { ok: true } },
        { name: "confirm_jarvis_action", response: { ok: true } },
        { name: "execute_jarvis_action", response: { ok: true } },
      ],
      actionGateCalls: [
        { gate: "propose_jarvis_action", ok: true, resultCount: 1 },
        { gate: "confirm_jarvis_action", ok: true, resultCount: 1 },
        { gate: "execute_jarvis_action", ok: true, resultCount: 1 },
      ],
      timings: { inference: [{ tokensIn: 20, tokensOut: 3, kind: "answer" }] },
      knowledgeTraces: [{ origin: "direct", recipe: "lexical-only" }],
      externalEgressCount: 1,
    });
    expect(JSON.stringify(observation)).not.toContain("synthetic prompt");
    expect(JSON.stringify(observation.actionGateCalls)).not.toContain("private");
  });
});
