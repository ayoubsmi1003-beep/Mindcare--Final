import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const controls = vi.hoisted(() => ({ synthetic: true, query: vi.fn(), deployment: vi.fn() }));
vi.mock("@/server/db/withCaller", () => ({
  withCaller: async (_actor: unknown, fn: (q: unknown) => Promise<unknown>) => fn({ query: async () => [{ cloud: await controls.deployment() }] }),
  withEgressGate: async (fn: (q: unknown) => Promise<unknown>) => fn({ query: controls.query }),
}));
const ids = ["qwen/test-a:free", "qwen/test-b:free"];
let directory: string;
beforeEach(async () => {
  vi.resetModules(); controls.synthetic = true; controls.query.mockReset();
  controls.deployment.mockReset().mockImplementation(async () => controls.synthetic);
  directory = await mkdtemp(join(tmpdir(), "alexa-free-routing-"));
  vi.stubEnv("MINDCARE_DATABASE_URL", "postgresql://test:test@127.0.0.1:1/test");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic"); vi.stubEnv("GEMINI_API_KEY", "synthetic-gemini");
  vi.stubEnv("OPENROUTER_QUALIFICATION_FILE", join(directory, "openrouter.json"));
  vi.stubEnv("GROQ_API_KEY", "synthetic-groq");
  vi.stubEnv("GROQ_FREE_QUALIFICATION_FILE", join(directory, "groq.json"));
  vi.stubEnv("GEMINI_FREE_QUALIFICATION_FILE", join(directory, "gemini.json"));
  vi.stubEnv("JARVIS_CHAT_MODEL", ids[0]);
  await writeFile(join(directory, "openrouter.json"), JSON.stringify({ version: "alexa-free-zdr-sourcebound-v7", at: Date.now(),
    models: ids.map((id, i) => ({ id, qualification: { json: true, streaming: true, qualite: 2, latenceMs: 10 + i } })) }));
});
afterEach(async () => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  if (dirname(resolve(directory)).toLowerCase() !== resolve(tmpdir()).toLowerCase() || !basename(directory).startsWith("alexa-free-routing-")) throw new Error("unexpected test directory");
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
});
const request = { purpose: "jarvis" as const, messages: [{ role: "user" as const, content: "bonjour" }],
  promptVersion: "free-routing-test", promptHash: "synthetic", sessionToken: "00000000-0000-4000-8000-000000000001", timeoutMs: 5000 };
async function geminiProof(at = Date.now()) {
  await writeFile(join(directory, "gemini.json"), JSON.stringify({ version: "alexa-gemini-free-v1", at, model: "gemini-3.5-flash-lite",
    keyHash: createHash("sha256").update("synthetic-gemini").digest("hex"), freeTierConfirmed: true }));
}
async function groqProof(at = Date.now()) {
  await writeFile(join(directory, "groq.json"), JSON.stringify({ version: "alexa-groq-free-v1", at, model: "openai/gpt-oss-20b",
    keyHash: createHash("sha256").update("synthetic-groq").digest("hex"), freeTierConfirmed: true }));
}
function transport(reply: (model: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).endsWith("/models")) return Response.json({ data: ids.map(id => ({ id, context_length: 32000,
      supported_parameters: ["response_format"], pricing: { prompt: "0", completion: "0" } })) });
    if (String(url).includes("generativelanguage")) { calls.push("gemini"); return reply("gemini", init); }
    if (String(url).includes("api.groq.com")) { calls.push("groq"); return reply("groq", init); }
    const body = JSON.parse(init.body as string); calls.push(body.model);
    expect(body.provider).toMatchObject({ max_price: { prompt: 0, completion: 0 }, data_collection: "deny", zdr: true });
    return reply(body.model, init);
  }));
  return calls;
}
describe("free-only production routing, transport faults injected", () => {
  it("starts a qualified small-model answer without an unrelated OpenRouter catalogue request", async () => {
    await groqProof(); await geminiProof();
    const calls = transport(() => Response.json({ choices: [{ message: { content: "Bonjour" }, finish_reason: "stop" }], usage: {} }));
    const { llm } = await import("@/server/egress/external-call");
    expect(await llm({ ...request, preferSmallFreeModel: true, maxOutputTokens: 256 })).toMatchObject({ ok: true, inference: { model: "openai/gpt-oss-20b" } });
    expect(calls).toEqual(["groq"]);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(JSON.parse(init!.body as string)).toEqual({ model: "openai/gpt-oss-20b", messages: request.messages,
      max_completion_tokens: 256, reasoning_effort: "low", reasoning_format: "hidden", temperature: 0 });
  });
  it.each([
    ["groq", { choices: [{ message: { content: null }, finish_reason: "content_filter" }] }],
    ["groq", { choices: [{ message: { content: "Refused", refusal: "policy" }, finish_reason: "stop" }] }],
    ["gemini", { promptFeedback: { blockReason: "SAFETY" } }],
    ["gemini", { candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }],
  ] as const)("HTTP 200 %s policy refusals stop before another provider", async (provider, response) => {
    await geminiProof(); if (provider === "groq") await groqProof();
    const calls = transport(model => Response.json(model === provider ? response : { choices: [{ message: { content: "must not run" } }] }));
    const { llm } = await import("@/server/egress/external-call");
    expect(await llm({ ...request, preferSmallFreeModel: true })).toMatchObject({ ok: false, error: { diagnostic: "POLICY_REJECTION" } });
    expect(calls).toEqual([provider]);
  });
  it.each([
    ["complete", "content_filter"], ["complete", "refusal"], ["stream", "content_filter"], ["stream", "refusal"],
  ] as const)("OpenRouter %s %s policy refusals do not switch to another provider", async (mode, marker) => {
    await geminiProof();
    const calls = transport(model => {
      if (model === "gemini") return Response.json({ candidates: [{ content: { parts: [{ text: "must not run" }] }, finishReason: "STOP" }] });
      const choice = { [mode === "stream" ? "delta" : "message"]: { content: null, ...(marker === "refusal" ? { refusal: "policy" } : {}) },
        finish_reason: marker === "content_filter" ? "content_filter" : "stop" };
      return mode === "stream" ? new Response(`data: ${JSON.stringify({ choices: [choice] })}\n\ndata: [DONE]\n\n`)
        : Response.json({ choices: [choice] });
    });
    const { llm, llmStream } = await import("@/server/egress/external-call");
    expect(await (mode === "complete" ? llm : llmStream)(request)).toMatchObject({ ok: false, error: { diagnostic: "POLICY_REJECTION" } });
    expect(calls).toEqual([ids[0]]);
  });
  it.each(["failure", "success"] as const)("best-effort %s audit cannot delay the healthy answer", async mode => {
    await groqProof(); await geminiProof();
    const release: Array<() => void> = [];
    controls.query.mockImplementation(() => new Promise<void>(resolve => { release.push(resolve); }));
    const calls = transport(model => model === "groq"
      ? mode === "failure" ? Response.json({ error: {} }, { status: 503 }) : Response.json({ choices: [{ message: { content: "Bonjour" }, finish_reason: "stop" }] })
      : Response.json({ candidates: [{ content: { parts: [{ text: "Bonjour" }] }, finishReason: "STOP" }] }));
    const { llm } = await import("@/server/egress/external-call");
    const controller = new AbortController();
    const pending = llm({ ...request, preferSmallFreeModel: true, signal: controller.signal });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve({ auditStalled: true }), 1500); })]);
      expect(result).toMatchObject({ ok: true, data: "Bonjour" });
      expect(calls).toEqual(mode === "failure" ? ["groq", "gemini"] : ["groq"]);
    } finally {
      clearTimeout(timer); controller.abort(); release.forEach(resolve => resolve()); await pending;
    }
  });
  it.each(["complete", "stream"] as const)("%s bounds the deployment preflight and prevents a late external request", async mode => {
    await groqProof(); await geminiProof();
    let release!: (value: boolean) => void;
    controls.deployment.mockImplementation(() => new Promise<boolean>(resolve => { release = resolve; }));
    const calls = transport(() => { throw new Error("late transport"); });
    const { llm, llmStream } = await import("@/server/egress/external-call");
    expect(await (mode === "complete" ? llm : llmStream)({ ...request, timeoutMs: 30, preferSmallFreeModel: true }))
      .toMatchObject({ ok: false, error: { diagnostic: "MODEL_TIMEOUT" } });
    release?.(true); await new Promise(resolve => setTimeout(resolve, 5));
    expect(calls).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["expired", "rotated", "future"] as const)("a %s Groq free-tier proof cannot authorize a transport", async state => {
    await groqProof(state === "expired" ? Date.now() - 86_400_001 : state === "future" ? Date.now() + 60_000 : Date.now());
    if (state === "rotated") vi.stubEnv("GROQ_API_KEY", "new-synthetic-groq");
    const calls = transport(() => Response.json({ error: {} }, { status: 503 }));
    const { llm } = await import("@/server/egress/external-call");
    expect((await llm({ ...request, preferSmallFreeModel: true })).ok).toBe(false); expect(calls).toEqual(ids);
  });
  it.each(["complete", "stream"] as const)("%s cancellation interrupts a pending deployment preflight", async mode => {
    await groqProof(); await geminiProof();
    const controller = new AbortController();
    controls.deployment.mockImplementation(() => { controller.abort(); return new Promise<boolean>(() => {}); });
    const calls = transport(() => { throw new Error("cancelled transport"); });
    const { llm, llmStream } = await import("@/server/egress/external-call");
    expect(await (mode === "complete" ? llm : llmStream)({ ...request, signal: controller.signal, preferSmallFreeModel: true }))
      .toMatchObject({ ok: false, error: { diagnostic: "CANCELLED" } });
    expect(calls).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["groq", "gemini"] as const)("temporarily skips a failing %s transport on the next question", async provider => {
    await geminiProof(); if (provider === "groq") await groqProof();
    const calls = transport(model => {
      if (model === provider) throw new TypeError("synthetic transport outage");
      return Response.json(model === "gemini" ? { candidates: [{ content: { parts: [{ text: "Bonjour" }] }, finishReason: "STOP" }] }
        : { choices: [{ message: { content: "Bonjour" } }], usage: {} });
    });
    const { llm } = await import("@/server/egress/external-call");
    const backup = provider === "groq" ? "gemini" : ids[0];
    expect((await llm({ ...request, preferSmallFreeModel: true })).ok).toBe(true);
    expect((await llm({ ...request, preferSmallFreeModel: true })).ok).toBe(true);
    expect(calls).toEqual([provider, backup, backup]);
  });
  it("rechecks synthetic deployment at the actual Groq boundary", async () => {
    await groqProof();
    controls.deployment.mockResolvedValueOnce(true).mockResolvedValue(false);
    const calls = transport(() => { throw new Error("non-synthetic transport"); });
    const { llm } = await import("@/server/egress/external-call");
    expect(await llm({ ...request, preferSmallFreeModel: true })).toMatchObject({ ok: false, error: { diagnostic: "SECURITY_BLOCK" } });
    expect(calls).toEqual([]);
  });
  it("prefers the qualified small Groq model and immediately switches exhausted quota to Gemini", async () => {
    await groqProof(); await geminiProof();
    const calls = transport(model => model === "groq" ? Response.json({ error: { message: "daily quota exhausted" } }, { status: 429 })
      : Response.json({ candidates: [{ content: { parts: [{ text: "bonjour" }] }, finishReason: "STOP" }] }));
    const { llm } = await import("@/server/egress/external-call");
    expect(await llm({ ...request, preferSmallFreeModel: true, maxOutputTokens: 256 })).toMatchObject({ ok: true,
      inference: { model: "gemini-3.5-flash-lite", tentatives: [{ model: "openai/gpt-oss-20b", code: "MODEL_QUOTA_EXHAUSTED" }, { code: "OK" }] } });
    expect(calls).toEqual(["groq", "gemini"]);
    expect((await llm({ ...request, preferSmallFreeModel: true })).ok).toBe(true);
    expect(calls).toEqual(["groq", "gemini", "gemini"]);
  });
  it("a cold catalogue network failure preserves previously qualified models on disk", async () => {
    const path = join(directory, "openrouter.json"); const before = await readFile(path, "utf8");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("synthetic network failure"); }));
    const { llm } = await import("@/server/egress/external-call");
    expect((await llm(request)).ok).toBe(false);
    expect(await readFile(path, "utf8")).toBe(before);
  });
  it("switches immediately from a failing free model to another qualified free model", async () => {
    const calls = transport(model => model === ids[0] ? Response.json({ error: { metadata: { provider_name: "upstream" } } }, { status: 429 })
      : Response.json({ choices: [{ message: { content: "Bonjour" } }], usage: {} }));
    const { llm } = await import("@/server/egress/external-call");
    expect(await llm(request)).toMatchObject({ ok: true, inference: { model: ids[1], tentatives: [{ code: "MODEL_RATE_LIMIT" }, { code: "OK" }] } });
    expect(calls).toEqual(ids);
    expect(await llm(request)).toMatchObject({ ok: true, inference: { model: ids[1], tentatives: [{ code: "OK" }] } });
    expect(calls).toEqual([ids[0], ids[1], ids[1]]);
  });
  it("switches exhausted OpenRouter quota to confirmed Gemini free quota, with a zero-cost audit", async () => {
    await geminiProof();
    const calls = transport(model => model === "gemini" ? Response.json({ candidates: [{ content: { parts: [{ text: "Bonjour" }] }, finishReason: "STOP" }], usageMetadata: {} })
      : Response.json({ error: { message: "daily quota exhausted" } }, { status: 429 }));
    const { llm } = await import("@/server/egress/external-call");
    expect(await llm(request)).toMatchObject({ ok: true, inference: { model: "gemini-3.5-flash-lite", tentatives: [{ code: "MODEL_QUOTA_EXHAUSTED" }, { code: "OK" }] } });
    expect(calls).toEqual([ids[0], "gemini"]);
    expect(controls.query.mock.calls.some(([, values]) => values?.[1] === "gemini-free" && values?.[9] === 0)).toBe(true);
  });
  it.each([401, 400, 403])("auth/request/policy HTTP %s never switches providers", async status => {
    await geminiProof(); const calls = transport(() => Response.json({ error: {} }, { status }));
    const { llm } = await import("@/server/egress/external-call");
    expect((await llm(request)).ok).toBe(false); expect(calls).toEqual([ids[0]]);
  });
  it("an expired free-tier confirmation cannot authorize Gemini", async () => {
    await geminiProof(Date.now() - 86_400_001);
    const calls = transport(() => Response.json({ error: {} }, { status: 503 }));
    const { llm } = await import("@/server/egress/external-call");
    expect((await llm(request)).ok).toBe(false); expect(calls).toEqual(ids);
  });
  it("rechecks synthetic deployment at the actual Gemini boundary", async () => {
    await geminiProof();
    const calls = transport(() => { controls.synthetic = false; return Response.json({ error: { metadata: { provider_name: "upstream" } } }, { status: 429 }); });
    const { llm } = await import("@/server/egress/external-call");
    expect((await llm(request)).ok).toBe(false); expect(calls).toEqual([ids[0]]);
  });
  it("never replays a published stream when its provider fails afterwards", async () => {
    let finish!: () => void;
    const calls = transport(() => new Response(new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Bonjour"}}]}\n\n'));
    }, async pull(c) { await new Promise<void>(resolve => { finish = resolve; }); c.close(); } })));
    const { llmStream } = await import("@/server/egress/external-call");
    const result = await llmStream(request); expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reader = result.data.deltas.getReader(); expect((await reader.read()).value).toBe("Bonjour"); finish();
    await expect(reader.read()).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    await expect(result.data.usage).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    expect(calls).toEqual([ids[0]]);
  });
});
