import { describe, expect, it } from "vitest";
import { deriveTurnOutcome, noteTurnCode, TurnTraceRecorder, withTurnTrace } from "@/server/alexa/turn-trace";
import type { RequestPart } from "@/shared/alexa/agent";

const part = (status: RequestPart["status"], tools: RequestPart["tools"] = ["search_knowledge"]): RequestPart =>
  ({ id: "p", goal: "g", tools, conditions: [], dependsOn: [], status, resultRefs: [] });

describe("TurnTraceRecorder", () => {
  it("keeps closed codes only, so free text cannot enter a trace", () => {
    const recorder = new TurnTraceRecorder();
    recorder.code("knowledge", "Lina Test a un traitement");
    recorder.followup("patient de Lina Test");
    recorder.call("call-1", "get_patient_context");
    recorder.result("get_patient_context", "error", "Lina Test introuvable");
    const trace = JSON.stringify(recorder.finish("partial"));
    expect(trace).not.toContain("Lina");
    expect(recorder.trace.codes[0]?.code).toBe("other");
    expect(recorder.trace.followup).toBe("other");
    expect(recorder.trace.tools[0]?.errorCode).toBe("other");
  });

  it("tells deterministic routing from the model loop", () => {
    const direct = new TurnTraceRecorder();
    direct.call("direct-abc-knowledge", "search_knowledge");
    expect(direct.trace.route).toBe("direct");
    const model = new TurnTraceRecorder();
    model.call("call_1", "search_knowledge");
    expect(model.trace.route).toBe("model_loop");
  });

  it("reports deep codes only inside its own turn", () => {
    const recorder = new TurnTraceRecorder();
    noteTurnCode("knowledge", "outside");
    withTurnTrace(recorder, () => noteTurnCode("knowledge", "source-fallback:language"));
    expect(recorder.trace.codes).toEqual([{ stage: "knowledge", code: "source-fallback:language" }]);
  });
});

describe("deriveTurnOutcome", () => {
  const trace = () => new TurnTraceRecorder().trace;
  it("never reports an empty turn as answered", () => {
    expect(deriveTurnOutcome("completed", [part("answered")], trace(), false)).toBe("model_unavailable");
  });
  it("separates a tool failure from a model failure when nothing was answered", () => {
    const recorder = new TurnTraceRecorder();
    recorder.call("c", "query_finance");
    recorder.result("query_finance", "error", "tool-unavailable");
    expect(deriveTurnOutcome("failed", [part("failed")], recorder.trace, false)).toBe("tool_failed");
  });
  it("reports permission refusals as such", () => {
    const recorder = new TurnTraceRecorder();
    recorder.call("c", "query_finance");
    recorder.result("query_finance", "error", "permission-denied");
    expect(deriveTurnOutcome("partial", [part("failed")], recorder.trace, true)).toBe("permission_denied");
  });
  it("maps the terminal statuses", () => {
    expect(deriveTurnOutcome("completed", [part("answered")], trace(), true)).toBe("answered");
    expect(deriveTurnOutcome("needs_input", [part("needs_input")], trace(), true)).toBe("clarification");
    expect(deriveTurnOutcome("needs_confirmation", [part("proposed")], trace(), true)).toBe("confirmation");
    expect(deriveTurnOutcome("cancelled", [], trace(), false)).toBe("cancelled");
    expect(deriveTurnOutcome("partial", [part("unsupported")], trace(), true)).toBe("capability_unavailable");
    expect(deriveTurnOutcome("partial", [part("answered")], trace(), true)).toBe("partial");
  });
  it("reports missing book evidence, but not when another part still answered", () => {
    const recorder = new TurnTraceRecorder();
    recorder.code("knowledge", "sans-preuve");
    expect(deriveTurnOutcome("partial", [part("budget_limited")], recorder.trace, true)).toBe("insufficient_evidence");
    expect(deriveTurnOutcome("partial", [part("answered", ["get_patient_context"]), part("budget_limited")], recorder.trace, true)).toBe("partial");
  });
});
