import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentTerminal, RequestPart } from "@/shared/alexa/agent";
import type { TurnOutcome } from "@/shared/alexa/turn";

/**
 * Privacy-safe record of how a turn was handled, so that "why did Alexa fail?" has an
 * answer. It holds closed codes only: never question text, patient identity or evidence.
 */
export type TurnRoute = "closed" | "direct" | "model_loop" | "knowledge_fallback" | "none";
/** What a tool call became. `authorized` is not here: confirming a proposal is a later request, recorded by confirmed_at in the database. */
export type ToolState = "executing" | "proposed" | "succeeded" | "partial" | "needs_input" | "unsupported" | "failed" | "cancelled";
export function toolStateOf(status: string): ToolState {
  if (status === "ok" || status === "empty") return "succeeded";
  if (status === "partial" || status === "needs_input" || status === "unsupported" || status === "cancelled") return status;
  if (status === "proposed" || status === "needs_confirmation") return "proposed";
  return status === "called" ? "executing" : "failed";
}
export interface TurnTraceTool { name: string; status: string; state: ToolState; direct: boolean; errorCode?: string }
export interface TurnTraceCode { stage: string; code: string }
export interface TurnTrace { traceId: string; route: TurnRoute; followup?: string; tools: TurnTraceTool[]; codes: TurnTraceCode[]; ms?: number; outcome?: TurnOutcome }

const CLOSED_CODE = /^[a-z0-9][a-z0-9_:.-]{0,79}$/iu;
const MAX_ENTRIES = 40;
function closed(code: string): string { return CLOSED_CODE.test(code) ? code : "other"; }

export class TurnTraceRecorder {
  private readonly startedAt = Date.now();
  readonly trace: TurnTrace = { traceId: crypto.randomUUID(), route: "none", tools: [], codes: [] };
  route(route: TurnRoute): void { this.trace.route = route; }
  followup(kind: string): void { this.trace.followup = closed(kind); }
  /** A call id starting with `direct-` was chosen by deterministic routing. */
  call(callId: string, name: string): void {
    const direct = callId.startsWith("direct-") || callId.startsWith("deterministic_");
    if (this.trace.route === "none") this.trace.route = direct ? "direct" : "model_loop";
    if (this.trace.tools.length < MAX_ENTRIES) this.trace.tools.push({ name: closed(name), status: "called", state: "executing", direct });
  }
  result(name: string, status: string, errorCode?: string): void {
    const tool = [...this.trace.tools].reverse().find(entry => entry.name === closed(name) && entry.status === "called");
    if (!tool) return;
    tool.status = closed(status);
    tool.state = toolStateOf(status);
    if (errorCode) tool.errorCode = closed(errorCode);
  }
  code(stage: string, code: string): void {
    if (this.trace.codes.length < MAX_ENTRIES) this.trace.codes.push({ stage: closed(stage), code: closed(code) });
  }
  finish(outcome: TurnOutcome): TurnTrace {
    this.trace.outcome = outcome;
    this.trace.ms = Date.now() - this.startedAt;
    return this.trace;
  }
}

const current = new AsyncLocalStorage<TurnTraceRecorder>();
export function withTurnTrace<T>(recorder: TurnTraceRecorder, operation: () => T): T { return current.run(recorder, operation); }
/** Lets deep code report a closed code without threading the recorder through every call. */
export function noteTurnCode(stage: string, code: string): void { current.getStore()?.code(stage, code); }

const PERMISSION = /denied|forbidden|permission|refus|unauthori[sz]ed/iu;
const MODEL = /model|inference|local-|general-invalid/iu;

/** One intelligible, closed result for every turn. An empty answer can never count as answered. */
export function deriveTurnOutcome(status: AgentTerminal | undefined, parts: readonly RequestPart[] | undefined, trace: TurnTrace, hasAnswer: boolean): TurnOutcome {
  if (status === "cancelled") return "cancelled";
  if (status === "needs_input") return "clarification";
  if (status === "needs_confirmation") return "confirmation";
  const errors = trace.tools.flatMap(tool => tool.errorCode ? [tool.errorCode] : []);
  if (errors.some(code => PERMISSION.test(code))) return "permission_denied";
  const failure = (): TurnOutcome => errors.some(code => !MODEL.test(code)) ? "tool_failed" : "model_unavailable";
  if (!hasAnswer) return failure();
  if (status === "completed" || status === undefined) return "answered";
  if (parts?.length && parts.every(part => part.status === "unsupported")) return "capability_unavailable";
  if (trace.codes.some(entry => entry.stage === "knowledge" && entry.code === "sans-preuve") && !parts?.some(part => part.status === "answered" && part.tools?.some(tool => tool !== "search_knowledge"))) return "insufficient_evidence";
  return status === "failed" ? failure() : "partial";
}
