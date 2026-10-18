import { z } from "zod";

const nativeCall = z.object({ id: z.string().min(1).max(100), type: z.literal("function"),
  function: z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/), arguments: z.string().max(12000) }).strict() }).strict();
export type NativeCall = z.infer<typeof nativeCall>;
export interface LocalTool { readonly type: "function"; readonly function: { readonly name: string; readonly description: string; readonly parameters: Record<string, unknown> } }
export type LocalMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string | null; readonly tool_calls?: readonly NativeCall[] }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };
export interface LocalTextOptions {
  readonly json?: boolean; readonly jsonSchema?: Record<string, unknown>; readonly maxOutputTokens?: number;
  readonly timeoutMs?: number; readonly signal?: AbortSignal | undefined; readonly tools?: readonly LocalTool[];
  readonly toolChoice?: "auto" | "required" | "declare_request";
}
/** Bounded CPU inference; the caller's abort signal can impose a shorter whole-turn deadline. */
export function localModelTimeoutMs(options: LocalTextOptions = {}): number {
  const timeout = options.timeoutMs ?? 60000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 180000) throw new Error("LocalModelInput");
  return Math.ceil(timeout);
}
/** Deliberately excludes exception text, arguments, prompts and source content from operational logs. */
export function localModelFailureCode(error: unknown): string {
  if (!(error instanceof Error)) return "AgentLoopFailure";
  if (error.name === "TimeoutError") return "LocalModelTimeout";
  return /^LocalModel(?:Input|Busy|Timeout|Truncated|Output|Context|Integrity|AssetAccess|Unavailable)$/.test(error.message) ? error.message : "AgentLoopFailure";
}
const message = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: z.string().min(1) }).strict(),
  z.object({ role: z.literal("user"), content: z.string().min(1) }).strict(),
  z.object({ role: z.literal("assistant"), content: z.string().nullable(), tool_calls: z.array(nativeCall).min(1).max(6).optional() }).strict(),
  z.object({ role: z.literal("tool"), content: z.string().min(1), tool_call_id: z.string().min(1).max(100) }).strict(),
]);
export function buildLocalRequest(messages: unknown, options: LocalTextOptions = {}) {
  const parsed = z.array(message).min(1).max(options.tools ? 24 : 4).safeParse(messages);
  const budget = options.maxOutputTokens ?? 512;
  localModelTimeoutMs(options);
  if (!parsed.success || Buffer.byteLength(JSON.stringify(messages), "utf8") > 64000
    || !Number.isInteger(budget) || budget < 1 || budget > 1024
    || (options.tools && (options.tools.length > 12 || options.json || options.jsonSchema))) throw new Error("LocalModelInput");
  const pending = new Set<string>(), seen = new Set<string>();
  for (const entry of parsed.data) {
    if (entry.role === "tool") { if (!options.tools || !pending.delete(entry.tool_call_id)) throw new Error("LocalModelInput"); }
    else {
      if (pending.size) throw new Error("LocalModelInput");
      if (entry.role === "assistant" && entry.tool_calls) for (const call of entry.tool_calls) {
        if (!options.tools || seen.has(call.id)) throw new Error("LocalModelInput"); seen.add(call.id); pending.add(call.id);
      }
    }
  }
  if (pending.size) throw new Error("LocalModelInput");
  return { model: "local", stream: false, temperature: 0, max_tokens: budget,
    reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false }, messages: parsed.data,
    ...(options.tools ? { tools: options.tools, tool_choice: options.toolChoice==="declare_request"?{type:"function",function:{name:"declare_request"}}:options.toolChoice??"auto", parallel_tool_calls: true } : {}),
    ...(options.jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: "alexa_response", strict: true, schema: options.jsonSchema } } }
      : options.json ? { response_format: { type: "json_object" } } : {}),
  };
}
export type LocalCompletion = ({ kind: "calls"; calls: { id: string; name: string; args: Record<string, unknown> }[]; message: Extract<LocalMessage, { role: "assistant" }> }
  | { kind: "answer"; text: string }) & { tokensIn: number; tokensOut: number };
export function parseLocalCompletion(raw: string): LocalCompletion {
  try {
    const decoded:unknown=JSON.parse(raw);
    const finish=z.object({choices:z.array(z.object({finish_reason:z.string()})).length(1)}).safeParse(decoded);
    if(finish.success&&finish.data.choices[0]!.finish_reason==="length")throw new Error("LocalModelTruncated");
    const value = z.object({ choices: z.array(z.object({ finish_reason: z.enum(["stop", "tool_calls"]),
      message: z.object({ role: z.literal("assistant"), content: z.string().max(12000).nullable().optional(),
        tool_calls: z.array(nativeCall).max(6).optional(), reasoning_content: z.literal("").optional() }).passthrough() })).length(1),
      usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).passthrough().optional(),
    }).passthrough().parse(decoded);
    const choice = value.choices[0]!, m = choice.message;
    const usage = { tokensIn: value.usage?.prompt_tokens ?? 0, tokensOut: value.usage?.completion_tokens ?? 0 };
    if (choice.finish_reason === "tool_calls") {
      if (!m.tool_calls?.length || new Set(m.tool_calls.map(c => c.id)).size !== m.tool_calls.length) throw new Error();
      const calls = m.tool_calls.map(c => ({ id: c.id, name: c.function.name, args: z.record(z.string(), z.unknown()).parse(JSON.parse(c.function.arguments)) }));
      return { kind: "calls", calls, message: { role: "assistant", content: null, tool_calls: m.tool_calls }, ...usage };
    }
    if (m.tool_calls?.length || !m.content?.trim() || m.content.length > 8192 || /<\/?think>|<\|(?:im_start|im_end|tool_call)/i.test(m.content)) throw new Error();
    return { kind: "answer", text: m.content.trim(), ...usage };
  } catch(error) { if(error instanceof Error&&error.message==="LocalModelTruncated")throw error;throw new Error("LocalModelOutput"); }
}
export function parseLocalAnswer(raw: string): string {
  const value = parseLocalCompletion(raw);
  if (value.kind !== "answer") throw new Error("LocalModelOutput");
  return value.text;
}
