import { describe, expect, it } from "vitest";
import {
  createAgentContinuation,
  describePendingAgentCursor,
  resolveAgentContinuation,
  validateAgentContinuation,
  type AgentContinuationBinding,
} from "@/server/alexa/agent-continuation";
import { restoreAgentTask, runAgentLoop } from "@/server/alexa/agent-loop";
import type { TurnInput } from "@/shared/alexa/turn";
import { turnInput } from "@/shared/alexa/turn";

const patientId = "11111111-1111-4111-8111-111111111111";
const context = { patientId: null, page: "/jarvis" };
const binding: AgentContinuationBinding = {
  actor: "actor-a",
  conversationId: "conversation-a",
  requestText: "Lis toutes les notes de Synthetic Test",
  appContext: context,
};
const revision = "a".repeat(32);

function task(data: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    original: binding.requestText,
    parts: [],
    at: Date.now(),
    patientId,
    page: "/jarvis",
    results: [{ callId: "cursor-note", status: "partial", complete: false, text: "", conditionKeys: [], evidence: [], patientId, data }],
    ...overrides,
  };
}

describe("resumable Alexa reads", () => {
  it("admits only an opaque continuation token on the backward-compatible turn protocol", () => {
    const request = { text: "Lis les notes", conversationId: "conversation-a", clientTurnId: "22222222-2222-4222-8222-222222222222", appContext: context };
    expect(turnInput.safeParse({ ...request, continuationToken: "C".repeat(43) }).success).toBe(true);
    expect(turnInput.safeParse({ ...request, continuationToken: "patient-id-as-token" }).success).toBe(false);
    expect(turnInput.safeParse(request).success).toBe(true);
  });

  it("describes only a revision-bound, incomplete read cursor", () => {
    expect(describePendingAgentCursor(task({
      noteQuery: { patientId, area: "all" },
      next: { offset: 5, textOffset: 0 },
      revision,
      asOf: "2026-10-27T10:00:00+01:00",
    }))).toMatchObject({
      cursorId: "cursor-note",
      kind: "notes",
      patientId,
      page: "/jarvis",
      sourceRevision: revision,
      position: 5,
    });
  });

  it("requires a source revision before resuming a timeline cursor", () => {
    const data={
      timelineQuery: { patientId, count: 20 },
      timelineNext: { beforeAt: "2026-10-01T10:00:00Z", beforeId: patientId },
    };
    expect(describePendingAgentCursor(task(data))).toBeNull();
    expect(describePendingAgentCursor(task({ ...data, revision }))).toMatchObject({ kind: "timeline", sourceRevision: revision });
  });

  it("does not treat a completed result or an action proposal as a read cursor", () => {
    expect(describePendingAgentCursor(task({
      noteQuery: { patientId, area: "all" }, next: { offset: 5, textOffset: 0 }, revision,
    }, { results: [{ callId: "done", status: "ok", complete: true, text: "", conditionKeys: [], evidence: [] }] }))).toBeNull();
    expect(describePendingAgentCursor(task({ proposal: { tool: "update_treatment" } }))).toBeNull();
    expect(describePendingAgentCursor(task({
      noteQuery: { patientId, area: "all" }, next: { offset: 5, textOffset: 0 }, revision,
    }, { results: [{ callId: "mixed", status: "partial", complete: false, text: "", conditionKeys: [], evidence: [], proposal: { tool: "update_treatment" },
      data: { noteQuery: { patientId, area: "all" }, next: { offset: 5, textOffset: 0 }, revision } }] }))).toBeNull();
  });

  it("binds the opaque continuation to actor, conversation, exact request, context, patient and revision", () => {
    const cursor = describePendingAgentCursor(task({
      noteQuery: { patientId, area: "all" }, next: { offset: 5, textOffset: 0 }, revision,
      asOf: "2026-10-27T10:00:00+01:00",
    }))!;
    const issued = createAgentContinuation(binding, cursor, 2, 1_798_000_000_000);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{40,}$/u);
    expect(validateAgentContinuation(issued, issued.token, binding, cursor, 1_798_000_001_000)).toMatchObject({
      cursorId: cursor.cursorId,
      kind: "notes",
      completedBatches: 2,
    });
    expect(validateAgentContinuation(issued, issued.token, { ...binding, actor: "actor-b" }, cursor, 1_798_000_001_000)).toBeNull();
    expect(validateAgentContinuation(issued, issued.token, { ...binding, requestText: "autre demande" }, cursor, 1_798_000_001_000)).toBeNull();
    expect(validateAgentContinuation(issued, issued.token, { ...binding, appContext: { patientId, page: "/patients/x" } }, cursor, 1_798_000_001_000)).toBeNull();
    expect(validateAgentContinuation(issued, "wrong-token", binding, cursor, 1_798_000_001_000)).toBeNull();
    expect(validateAgentContinuation(issued, issued.token, binding, { ...cursor, sourceRevision: "b".repeat(32) }, 1_798_000_001_000)).toBeNull();
    expect(validateAgentContinuation(issued, issued.token, binding, cursor, 1_798_900_000_000)).toBeNull();
  });

  it("rejects a supplied stale token instead of silently resuming the stored valid cursor", () => {
    const cursor=describePendingAgentCursor(task({noteQuery:{patientId,area:"all"},next:{offset:5,textOffset:0},revision}))!;
    const issued=createAgentContinuation(binding,cursor,2,1_798_000_000_000);
    expect(resolveAgentContinuation(issued,undefined,binding,cursor,1_798_000_001_000)).toMatchObject({stale:false,continuation:{token:issued.token}});
    expect(resolveAgentContinuation(issued,issued.token,binding,cursor,1_798_000_001_000)).toMatchObject({stale:false,continuation:{token:issued.token}});
    expect(resolveAgentContinuation(issued,"wrong-token",binding,cursor,1_798_000_001_000)).toEqual({stale:true,continuation:null});
  });

  it("resumes the exact server-selected read cursor without asking MiniCPM to choose another section", async () => {
    const conversationId = "conversation-resume-exact";
    restoreAgentTask("actor-a", conversationId, task({
      noteQuery: { patientId, area: "all" },
      next: { offset: 5, textOffset: 0 },
      revision,
      asOf: "2026-10-27T10:00:00+01:00",
    }, { original: binding.requestText, parts: [{ id: "requested_1", goal: binding.requestText, tools: ["get_patient_context"], conditions: [], dependsOn: [], status: "budget_limited", resultRefs: ["cursor-note"] }] }));
    const input: TurnInput = {
      text: "la suite notes",
      conversationId,
      clientTurnId: "22222222-2222-4222-8222-222222222222",
      appContext: { patientId, page: "/jarvis" },
    };
    const calls: string[] = [], priorIds: string[][] = [];
    let inference = 0;
    const outcome = await runAgentLoop(input, {
      actor: "actor-a",
      resumeCursor: { cursorId: "cursor-note", kind: "notes", patientId },
      infer: async () => {
        inference++;
        if (inference > 1) return { kind: "answer", text: "Notes lues.", tokensIn: 1, tokensOut: 1 };
        const args = { partIds: ["continuation"], section: "notes", patientId };
        return { kind: "calls", calls: [{ id: "resume-call", name: "get_patient_context", args }],
          message: { role: "assistant", content: null, tool_calls: [{ id: "resume-call", type: "function", function: { name: "get_patient_context", arguments: JSON.stringify(args) } }] }, tokensIn: 1, tokensOut: 1 };
      },
      execute: async (call, _asOf, priorResults) => {
        calls.push(`${call.name}:${String(call.args["section"])}:${String(call.args["reusePrevious"])}`);
        priorIds.push(priorResults.map(result => result.callId));
        return { callId: call.id, status: "ok", complete: true, text: "Suite de lecture.", patientId,
          evidence: [], conditionKeys: [], data: { completed: true } };
      },
    }, new AbortController().signal);
    expect(calls).toEqual(["get_patient_context:notes:true"]);
    expect(priorIds[0]).toContain("cursor-note");
    expect(outcome.status).toBe("completed");
    expect(outcome.patientId).toBe(patientId);
  });
});
