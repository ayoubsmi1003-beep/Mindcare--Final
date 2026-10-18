import { expect, it } from "vitest";
import { buildLocalRequest, parseLocalCompletion } from "@/server/alexa/local-model-protocol";

const tools = [{ type: "function" as const, function: { name: "query_patients", description: "Read patients", parameters: { type: "object" } } }];
const call = { id: "call-1", type: "function" as const, function: { name: "query_patients", arguments: '{"mode":"count"}' } };
const response = (finish_reason: string, message: unknown) => JSON.stringify({ choices: [{ finish_reason, message }], usage: { prompt_tokens: 20, completion_tokens: 10 } });
it("preserves native calls and result roles through more than four messages", () => {
  const body = buildLocalRequest([{ role: "system", content: "Read first" }, { role: "user", content: "Combien ?" },
    { role: "assistant", content: null, tool_calls: [call] }, { role: "tool", tool_call_id: call.id, content: '{"total":3}' },
    { role: "assistant", content: "Trois patients." }, { role: "user", content: "Lesquels ?" }], { tools });
  expect(body.messages).toHaveLength(6);
  expect(body.tools).toEqual(tools);
  expect(body.temperature).toBe(0);
});
it("parses native calls without publishing their preamble as a final answer", () => {
  expect(parseLocalCompletion(response("tool_calls", { role: "assistant", content: "Je cherche", tool_calls: [call] })))
    .toMatchObject({ kind: "calls", calls: [{ id: "call-1", name: "query_patients", args: { mode: "count" } }] });
});
it("distinguishes final text and records actual usage", () => {
  expect(parseLocalCompletion(response("stop", { role: "assistant", content: "Trois patients." })))
    .toMatchObject({ kind: "answer", text: "Trois patients.", tokensIn: 20, tokensOut: 10 });
});
it("rejects truncation, malformed arguments, duplicate calls and orphan results", () => {
  expect(() => parseLocalCompletion(response("length", { role: "assistant", content: "Tro" }))).toThrow("LocalModelTruncated");
  expect(() => parseLocalCompletion(response("tool_calls", { role: "assistant", tool_calls: [{ ...call, function: { ...call.function, arguments: "[]" } }] }))).toThrow();
  expect(() => parseLocalCompletion(response("tool_calls", { role: "assistant", tool_calls: [call, call] }))).toThrow();
  expect(() => buildLocalRequest([{ role: "tool", tool_call_id: "unknown", content: "3" }], { tools })).toThrow();
});
