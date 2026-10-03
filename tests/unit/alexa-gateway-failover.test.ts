import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
vi.mock("@/server/db", () => ({ withEgressGate: async (fn: (q: unknown) => Promise<unknown>) => fn({ query: vi.fn() }) }));
let directory: string;
const ids = ["qwen/essai-a:free", "qwen/essai-b:free", "qwen/essai-c:free"];
const PRIMARY = "qwen/qwen3.7-flash";
const originalFetch = globalThis.fetch;
beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(join(tmpdir(), "alexa-gateway-"));
  const file = join(directory, "qualification.json");
  await writeFile(file, JSON.stringify({ version: "alexa-free-zdr-sourcebound-v7", at: Date.now(),
    models: ids.map((id, i) => ({ id, qualification: { json: true, streaming: true, qualite: 1, latenceMs: 10 + i } })) }));
  vi.stubEnv("MINDCARE_DATABASE_URL", "postgresql://test:test@127.0.0.1:1/test");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic"); vi.stubEnv("OPENROUTER_QUALIFICATION_FILE", file);
  vi.stubEnv("JARVIS_CHAT_MODEL", ids[0]);
});
afterEach(async () => {
  globalThis.fetch = originalFetch; vi.unstubAllEnvs(); vi.restoreAllMocks();
  if (dirname(resolve(directory)).toLowerCase() !== resolve(tmpdir()).toLowerCase() || !basename(directory).startsWith("alexa-gateway-")) throw new Error("unexpected test directory");
  await rm(directory, { recursive: true, force: true });
});
const request = { purpose: "jarvis" as const, messages: [{ role: "user" as const, content: "bonjour" }],
  promptVersion: "test", promptHash: "test", sessionToken: "00000000-0000-4000-8000-000000000001", timeoutMs: 400 };
function transport(reply: (id: string, init: RequestInit) => Promise<Response>) {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    if (String(url).endsWith("/models")) return Response.json({ data: ids.map((id) => ({ id,
      context_length: 32000, supported_parameters: ["response_format"], pricing: { prompt: "0", completion: "0" } })) });
    if (String(url).endsWith("/key")) return Response.json({ data: { free_model_daily_requests: { remaining: 50, used: 0, limit: 50 } } });
    const id = (JSON.parse(init?.body as string) as { model: string }).model;
    calls.push(id); return reply(id, init);
  });
  return calls;
}
async function maintainedGateway() {
  const gateway = await import("@/server/egress/external-call");
  await gateway.preparerPoolModelesGratuits({ timeoutMs: 100, maxModels: 3 });
  return gateway;
}
describe("production gateway, faults injected only at its real fetch transport", () => {
  it("explicit all-model maintenance tests every free family beyond the old six-model cap", async () => {
    await writeFile(join(directory, "qualification.json"), JSON.stringify({ version: "alexa-free-zdr-sourcebound-v7", at: Date.now(), models: [] }));
    const allIds = ["google/a:free", "mistralai/a:free", "meta-llama/a:free", "qwen/a:free", "nvidia/a:free", "deepseek/a:free", "nousresearch/a:free", "allenai/a:free"].map(id => id.replace("/a:", "/test-a:"));
    const calls: string[] = [];
    const realTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((handler, delay, ...args) => realTimeout(handler, delay === 3500 ? 0 : delay, ...args));
    globalThis.fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/models")) return Response.json({ data: allIds.concat("google/paid").map(id => ({ id,
        context_length: 32000, supported_parameters: ["response_format"], pricing: { prompt: "0", completion: "0" } })) });
      if (String(url).endsWith("/key")) return Response.json({ data: { free_model_daily_requests: { remaining: 47, used: 3, limit: 50 } } });
      const body = JSON.parse(init!.body as string) as { model: string; provider: unknown };
      calls.push(body.model);
      expect(body.provider).toEqual({ data_collection: "deny", zdr: true, require_parameters: true, max_price: { prompt: 0.05, completion: 0.2 } });
      return Response.json({ error: { metadata: { provider_name: "upstream" } } }, { status: 429 });
    });
    const { preparerPoolModelesGratuits } = await import("@/server/egress/external-call");
    const result = await preparerPoolModelesGratuits({ allModels: true, timeoutMs: 60000, maxModels: 2 });
    expect(calls).toEqual([...allIds].sort((a, b) => a.localeCompare(b)));
    expect(result.modeles).toHaveLength(8);
    expect(result.probes).toHaveLength(8);
    expect(result.modeles.every(model => model.qualification === null)).toBe(true);
  });
  it("all-model maintenance stops at actual account quota instead of switching models", async () => {
    await writeFile(join(directory, "qualification.json"), JSON.stringify({ version: "alexa-free-zdr-sourcebound-v7", at: Date.now(), models: [] }));
    const calls = transport(async () => Response.json({ error: { metadata: { provider_name: "upstream" } } }, { status: 429 }));
    const previousFetch = globalThis.fetch;
    let quotaReads = 0;
    globalThis.fetch = vi.fn(async (url, init) => String(url).endsWith("/key")
      ? Response.json({ data: { free_model_daily_requests: { remaining: ++quotaReads <= 2 ? 47 : 5, used: 3, limit: 50 } } })
      : previousFetch(url, init));
    const realTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((handler, delay, ...args) => realTimeout(handler, delay === 3500 ? 0 : delay, ...args));
    const { preparerPoolModelesGratuits } = await import("@/server/egress/external-call");
    const result = await preparerPoolModelesGratuits({ allModels: true, timeoutMs: 60000 });
    expect(calls).toEqual([ids[0]]);
    expect(result.probes).toHaveLength(1);
  });
  it("rechecks quota after the language probe before sending the clinical probe", async () => {
    await writeFile(join(directory, "qualification.json"), JSON.stringify({ version: "alexa-free-zdr-sourcebound-v7", at: Date.now(), models: [] }));
    const calls = transport(async (_id, init) => {
      expect(JSON.parse(init.body as string).stream).toBe(true);
      return new Response('data: {"choices":[{"delta":{"content":"{\\"intents\\":[\\"HELLO\\",\\"THANKS\\",\\"THANKS\\"]}"}}]}}\n\ndata: [DONE]\n\n');
    });
    const previousFetch = globalThis.fetch;
    let quotaReads = 0;
    globalThis.fetch = vi.fn(async (url, init) => String(url).endsWith("/key")
      ? Response.json({ data: { free_model_daily_requests: { remaining: ++quotaReads <= 2 ? 6 : 5, used: 44, limit: 50 } } })
      : previousFetch(url, init));
    const realTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((handler, delay, ...args) => realTimeout(handler, delay === 3500 ? 0 : delay, ...args));
    const { preparerPoolModelesGratuits } = await import("@/server/egress/external-call");
    const result = await preparerPoolModelesGratuits({ allModels: true, timeoutMs: 60000 });
    expect(calls).toHaveLength(1);
    expect(result.compte.code).toBe("MODEL_QUOTA_EXHAUSTED");
    expect(result.modeles.every(model => model.qualification === null)).toBe(true);
    expect(quotaReads).toBe(3);
  });
  it("identifies a catalog network failure without retaining its sensitive message", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("private-name secret-key provider-body"); });
    const { preparerPoolModelesGratuits } = await import("@/server/egress/external-call");
    const error = await preparerPoolModelesGratuits().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "NETWORK_FAILURE", phase: "catalog" });
    expect(JSON.stringify(error)).not.toMatch(/private-name|secret-key|provider-body/);
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(1);
  });
  it("distinguishes a quota timeout from inference and does not start probes", async () => {
    transport(async () => { throw new Error("probe must not run"); });
    const catalogFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/key")) throw new DOMException("private timeout metadata", "TimeoutError");
      return catalogFetch(url, init);
    });
    const { preparerPoolModelesGratuits } = await import("@/server/egress/external-call");
    const error = await preparerPoolModelesGratuits().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "MODEL_TIMEOUT", phase: "quota" });
    expect(JSON.stringify(error)).not.toContain("private timeout metadata");
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/chat/completions"))).toBe(false);
  });
  it("single-model: a 429 fails after exactly one primary attempt, audit exposes it", async () => {
    const calls = transport(async () => Response.json({ error: { metadata: { provider_name: "upstream" } } }, { status: 429 }));
    const { llm } = await maintainedGateway();
    vi.mocked(globalThis.fetch).mockClear();
    const result = await llm({ ...request, besoin: { json: true } });
    expect(result).toMatchObject({ ok: false, error: { diagnostic: "MODEL_RATE_LIMIT", tentatives: [{ model: PRIMARY, code: "MODEL_RATE_LIMIT" }] } });
    expect(calls).toEqual([PRIMARY]);
    expect(vi.mocked(globalThis.fetch).mock.calls.every(([url]) => String(url).endsWith("/chat/completions"))).toBe(true);
  });
  it("single-model: no second attempt exists — one failure is final", async () => {
    const calls = transport(async () => Response.json({ error: { metadata: { provider_name: "upstream" } } }, { status: 429 }));
    const { llm } = await maintainedGateway();
    expect((await llm(request)).ok).toBe(false);
    expect(calls).toEqual([PRIMARY]);
  });
  it.each(["complete", "stream"] as const)("single-model: one OpenRouter attempt on the primary (%s)", async mode => {
    const calls = transport(async () => Response.json({ error: { metadata: { provider_name: "upstream" } } }, { status: 429 }));
    const gateway = await maintainedGateway();
    const result = await (mode === "complete" ? gateway.llm : gateway.llmStream)({ ...request, maxAttempts: 1 });
    expect(result).toMatchObject({ ok: false, error: { tentatives: [{ model: PRIMARY, code: "MODEL_RATE_LIMIT" }] } });
    expect(calls).toEqual([PRIMARY]);
  });
  it("single-model: an empty qualification file does not gate the ordinary turn", async () => {
    await writeFile(join(directory, "qualification.json"), JSON.stringify({ version: "alexa-free-zdr-sourcebound-v7", at: Date.now(), models: [] }));
    const calls = transport(async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} }));
    const { llm } = await import("@/server/egress/external-call");
    expect(await llm(request)).toMatchObject({ ok: true, inference: { model: PRIMARY } });
    expect(calls).toEqual([PRIMARY]);
  });
  it("single-model: a cold process calls the primary directly, no discovery", async () => {
    const calls = transport(async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} }));
    const { llm } = await import("@/server/egress/external-call");
    expect(await llm(request)).toMatchObject({ ok: true, inference: { model: PRIMARY } });
    expect(calls).toEqual([PRIMARY]);
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/models"))).toBe(false);
  });
  it("single-model: expired catalog metadata does not gate the ordinary turn", async () => {
    const calls = transport(async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} }));
    const { llm } = await maintainedGateway();
    vi.mocked(globalThis.fetch).mockClear();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86_400_001);
    expect(await llm(request)).toMatchObject({ ok: true, inference: { model: PRIMARY } });
    expect(calls).toEqual([PRIMARY]);
  });
  it("cancelled maintenance performs no catalog, quota or inference request", async () => {
    const fetch = vi.fn(); globalThis.fetch = fetch;
    const { preparerPoolModelesGratuits } = await import("@/server/egress/external-call");
    const controller = new AbortController(); controller.abort();
    await expect(preparerPoolModelesGratuits({ signal: controller.signal })).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("cancellation reaches the quota transport and prevents a late successful quota result", async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(async (_url, init) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      return Response.json({ data: { free_model_daily_requests: { remaining: 50, used: 0, limit: 50 } } });
    });
    const { lireQuotaOpenRouter } = await import("@/server/egress/external-call");
    await expect(lireQuotaOpenRouter(controller.signal)).rejects.toMatchObject({ code: "CANCELLED" });
  });
  it.each([401, 400, 402])("single-model: permanent/account HTTP %s stops after the one primary attempt", async (status) => {
    const calls = transport(async () => Response.json({ error: {} }, { status }));
    const { llm } = await maintainedGateway();
    expect((await llm(request)).ok).toBe(false); expect(calls).toEqual([PRIMARY]);
  });
  it("single-model: invalid JSON fails closed on the primary without a silent accept", async () => {
    const calls = transport(async () => Response.json({ choices: [{ message: { content: "broken" } }] }));
    const { llm } = await maintainedGateway();
    expect(await llm({ ...request, besoin: { json: true } })).toMatchObject({ ok: false });
    expect(calls).toEqual([PRIMARY]);
  });
  it("C1/C2 refusal performs zero catalogue or inference requests", async () => {
    const fetch = vi.fn(); globalThis.fetch = fetch;
    const { llm } = await import("@/server/egress/external-call");
    expect(await llm({ ...request, messages: [{ role: "user", content: "P1 souffre d’angoisse" }] })).toMatchObject({ ok: false, error: { code: "frontiere" } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
