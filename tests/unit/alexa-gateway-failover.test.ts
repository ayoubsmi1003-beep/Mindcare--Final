import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("@/server/db", () => ({ withEgressGate: async (fn: (q: unknown) => Promise<unknown>) => fn({ query: vi.fn() }) }));
let directory: string;
const ids = ["essai/a:free", "essai/b:free", "essai/c:free"];
const originalFetch = globalThis.fetch;
beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(join(tmpdir(), "alexa-gateway-"));
  const file = join(directory, "qualification.json");
  await writeFile(file, JSON.stringify({ version: "alexa-free-multilingual-v2", at: Date.now(),
    models: ids.map((id, i) => ({ id, qualification: { json: true, streaming: true, qualite: 1, latenceMs: 10 + i } })) }));
  vi.stubEnv("MINDCARE_DATABASE_URL", "postgresql://test:test@127.0.0.1:1/test");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic"); vi.stubEnv("OPENROUTER_QUALIFICATION_FILE", file);
  vi.stubEnv("JARVIS_CHAT_MODEL", ids[0]!);
});
afterEach(async () => { globalThis.fetch = originalFetch; vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
const request = { purpose: "jarvis" as const, messages: [{ role: "user" as const, content: "bonjour" }],
  promptVersion: "test", promptHash: "test", sessionToken: "00000000-0000-4000-8000-000000000001", timeoutMs: 400 };
function transport(reply: (id: string, init: RequestInit) => Promise<Response>) {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    if (String(url).endsWith("/models")) return Response.json({ data: ids.map((id) => ({ id,
      context_length: 32000, supported_parameters: ["response_format"], pricing: { prompt: "0", completion: "0" } })) });
    const id = (JSON.parse(init?.body as string) as { model: string }).model;
    calls.push(id); return reply(id, init!);
  });
  return calls;
}
describe("production gateway, faults injected only at its real fetch transport", () => {
  it("A→429, B→timeout, C→success within one deadline, audit exposes C", async () => {
    const calls = transport(async (id, init) => {
      if (id === ids[0]) return Response.json({ error: { metadata: { provider_name: "upstream" } } }, { status: 429 });
      if (id === ids[1]) return await new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} });
    });
    const { llm } = await import("@/server/egress/external-call");
    const result = await llm({ ...request, besoin: { json: true } });
    expect(result).toMatchObject({ ok: true, inference: { model: ids[2], tentatives: [
      { model: ids[0], code: "MODEL_RATE_LIMIT" }, { model: ids[1], code: "MODEL_TIMEOUT" }, { model: ids[2], code: "OK" }] } });
    expect(calls).toEqual(ids);
  });
  it.each([401, 400, 402])("permanent/account HTTP %s stops after one model", async (status) => {
    const calls = transport(async () => Response.json({ error: {} }, { status }));
    const { llm } = await import("@/server/egress/external-call");
    expect((await llm(request)).ok).toBe(false); expect(calls).toEqual([ids[0]]);
  });
  it("invalid JSON switches before publishing text; does not silently accept malformed output", async () => {
    const calls = transport(async (id) => Response.json({ choices: [{ message: { content: id === ids[0] ? "broken" : '{"ok":true}' } }] }));
    const { llm } = await import("@/server/egress/external-call");
    expect(await llm({ ...request, besoin: { json: true } })).toMatchObject({ ok: true, inference: { model: ids[1] } });
    expect(calls).toEqual(ids.slice(0, 2));
  });
  it("C1/C2 refusal performs zero catalogue or inference requests", async () => {
    const fetch = vi.fn(); globalThis.fetch = fetch;
    const { llm } = await import("@/server/egress/external-call");
    expect(await llm({ ...request, messages: [{ role: "user", content: "P1 souffre d’angoisse" }] })).toMatchObject({ ok: false, error: { code: "frontiere" } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
