import { expect, it } from "vitest";
import { buildLocalRequest, parseLocalAnswer, localModelFailureCode } from "@/server/alexa/local-model-protocol";
import { assertLocalAssetAccess, localAssetLayout } from "@/server/alexa/local-model-assets";

const messages = [{ role: "user" as const, content: "Bonjour" }];
const response = (content: unknown, finish_reason = "stop", extra = {}) => JSON.stringify({
  choices: [{ finish_reason, message: { role: "assistant", content, ...extra } }],
});
it("builds a bounded tool-free request preserving message roles", () => {
  expect(buildLocalRequest([{ role: "system", content: "Réponds en français" }, ...messages], { json: true, maxOutputTokens: 1024 }))
    .toMatchObject({ stream: false, temperature: 0, max_tokens: 1024, response_format: { type: "json_object" },
      messages: [{ role: "system", content: "Réponds en français" }, { role: "user", content: "Bonjour" }],
      chat_template_kwargs: { enable_thinking: false } });
  expect(buildLocalRequest(messages)).not.toHaveProperty("tools");
});
it.each([{ value: [] }, { value: [{ role: "tool", content: "SQL" }] }, { value: [{ role: "user", content: "x".repeat(65000) }] }])
("rejects invalid input instead of trimming or forwarding it", ({ value }) => {
  expect(() => buildLocalRequest(value)).toThrow("LocalModelInput");
});
it("rejects nonfinite or unbounded output budgets", () => {
  for (const value of [NaN, 0, -1, 1025, 1.5])
    expect(() => buildLocalRequest(messages, { maxOutputTokens: value })).toThrow("LocalModelInput");
});
it("accepts bounded multi-part inference and rejects invalid timeouts before runtime access", () => {
  for (const timeoutMs of [90000, 170000, 180000]) expect(() => buildLocalRequest(messages, { timeoutMs })).not.toThrow();
  for (const timeoutMs of [NaN, Infinity, 0, -1, 180001]) expect(() => buildLocalRequest(messages, { timeoutMs })).toThrow("LocalModelInput");
});
it("accepts one complete assistant answer without interpreting it as tools", () => {
  expect(parseLocalAnswer(response("Bonjour."))).toBe("Bonjour.");
});
it.each([response(""), response("x".repeat(8193)), response("partial", "length"), response("answer", "tool_calls"),
  response("answer", "stop", { tool_calls: [{ function: { name: "write" } }] }),
  response("answer", "stop", { reasoning_content: "private thought" }),
  response("<think>thought</think>answer"), '{"choices":[]}', response({ text: "answer" })])
("refuses incomplete, tool-bearing or malformed output", value => {
  expect(() => parseLocalAnswer(value)).toThrow(JSON.parse(value).choices?.[0]?.finish_reason==="length"?"LocalModelTruncated":"LocalModelOutput");
});
it("refuses ambiguity between multiple candidate answers", () => {
  const value = JSON.parse(response("one"));
  value.choices.push({ finish_reason: "stop", message: { role: "assistant", content: "two" } });
  expect(() => parseLocalAnswer(JSON.stringify(value))).toThrow("LocalModelOutput");
});
it("resolves only the fixed packaged sibling or development cache", () => {
  expect(localAssetLayout("C:\\Program Files\\MindCare\\resources\\serveur")).toEqual({
    root: "C:\\Program Files\\MindCare\\resources\\alexa\\local-model", packaged: true,
  });
  expect(localAssetLayout("C:\\Work\\Doctor")).toEqual({
    root: "C:\\Work\\Doctor\\.cache\\alexa\\minicpm", packaged: false,
  });
});
const user = "S-1-5-21-111-222-333-1001", system = "S-1-5-18", admin = "S-1-5-32-544";
const full = 2032127, read = 1179817;
const entries = [{ owner: user, rules: [{ sid: user, allow: true, rights: full }, { sid: system, allow: true, rights: full }] }];
it("permits an owned development cache and harmless read access", () => {
  expect(() => assertLocalAssetAccess({ sid: user, protectedLocation: false,
    entries: [{ ...entries[0]!, rules: [...entries[0]!.rules, { sid: "S-1-5-32-545", allow: true, rights: read }] }] }, false)).not.toThrow();
});
it("refuses other users' write permission and foreign-owned development assets", () => {
  expect(() => assertLocalAssetAccess({ sid: user, protectedLocation: false,
    entries: [{ owner: user, rules: [{ sid: "S-1-1-0", allow: true, rights: full }] }] }, false)).toThrow("LocalModelAssetAccess");
  expect(() => assertLocalAssetAccess({ sid: user, protectedLocation: false,
    entries: [{ owner: "S-1-5-21-999-999-999-999", rules: [] }] }, false)).toThrow("LocalModelAssetAccess");
});
it("refuses SYSTEM loading a development cache or an unprotected packaged folder", () => {
  expect(() => assertLocalAssetAccess({ sid: system, protectedLocation: true, entries: [] }, false)).toThrow("LocalModelAssetAccess");
  expect(() => assertLocalAssetAccess({ sid: system, protectedLocation: false,
    entries: [{ owner: admin, rules: [{ sid: system, allow: true, rights: full }] }] }, true)).toThrow("LocalModelAssetAccess");
});
it("permits SYSTEM only for protected packaged assets with privileged writers", () => {
  const safe = { sid: system, protectedLocation: true, entries: [{ owner: admin,
    rules: [{ sid: admin, allow: true, rights: full }, { sid: system, allow: true, rights: full }, { sid: user, allow: true, rights: read }] }] };
  expect(() => assertLocalAssetAccess(safe, true)).not.toThrow();
  expect(() => assertLocalAssetAccess({ ...safe, entries }, true)).toThrow("LocalModelAssetAccess");
});

it("allows creation-only permissions on protected ancestors without trusting asset writes", () => {
  const ancestor = { owner: system, ancestor: true, rules: [{ sid: "S-1-5-11", allow: true, rights: 6 }] };
  expect(() => assertLocalAssetAccess({ sid: system, protectedLocation: true, entries: [ancestor] }, true)).not.toThrow();
  for (const rights of [64, 256, 65536, 262144, 524288]) {
    expect(() => assertLocalAssetAccess({ sid: system, protectedLocation: true,
      entries: [{ ...ancestor, rules: [{ sid: "S-1-5-11", allow: true, rights }] }] }, true)).toThrow("LocalModelAssetAccess");
  }
  expect(() => assertLocalAssetAccess({ sid: system, protectedLocation: true,
    entries: [{ ...ancestor, ancestor: false }] }, true)).toThrow("LocalModelAssetAccess");
});

it.skipIf(process.platform !== "win32")("qualifies actual protected Program Files ACLs with SYSTEM writer rules", async () => {
  const { readLocalAssetAccess } = await import("@/server/alexa/local-model-assets");
  const value = await readLocalAssetAccess("C:\\Program Files\\WindowsPowerShell\\Modules\\Microsoft.PowerShell.Operation.Validation");
  expect(value.protectedLocation).toBe(true);
  expect(() => assertLocalAssetAccess({ ...value, sid: system }, true)).not.toThrow();
});

it("refuses generic Windows write/all aliases on model assets", () => {
  for (const rights of [0x10000000, 0x40000000]) {
    expect(() => assertLocalAssetAccess({ sid: system, protectedLocation: true,
      entries: [{ owner: admin, rules: [{ sid: "S-1-5-11", allow: true, rights }] }] }, true)).toThrow("LocalModelAssetAccess");
  }
});

it('reports only closed local failure codes, never arbitrary exception messages or patient data',()=>{
 expect(localModelFailureCode(new Error('LocalModelAssetAccess'))).toBe('LocalModelAssetAccess');
 expect(localModelFailureCode(new DOMException('Deadline','TimeoutError'))).toBe('LocalModelTimeout');
 for(const error of [new Error('Patient FICTIF phone 0000000001'),{message:'LocalModelIntegrity'},null])expect(localModelFailureCode(error)).toBe('AgentLoopFailure');
});
