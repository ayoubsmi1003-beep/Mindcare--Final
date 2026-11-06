import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deployment = vi.hoisted(() => ({ read: vi.fn<() => Promise<unknown>>() }));
vi.mock("@/server/db/withCaller", () => ({
  withCaller: async (_actor: unknown, fn: (q: unknown) => Promise<unknown>) => fn({ query: async () => [{ cloud: await deployment.read() }] }),
}));

import { lireQuotaOpenRouter, llm, llmStream, openRouterProvider, preparerPoolModelesGratuits } from "../../src/server/egress/external-call";
import { reinitialiserEnv } from "../../src/server/env";

const originalFetch = globalThis.fetch;
const requete = { model: "qwen/qwen3.8-27b:free", messages: [{ role: "user" as const, content: "Bonjour" }], timeoutMs: 100 };
const llmRequest = { purpose: "jarvis" as const, promptVersion: "v", promptHash: "h", sessionToken: "s", messages: requete.messages, timeoutMs: 500 };

beforeEach(() => {
  process.env.MINDCARE_DATABASE_URL = "postgresql://essai:essai@127.0.0.1:1/essai";
  process.env.OPENROUTER_API_KEY = "synthetic-key"; reinitialiserEnv();
  globalThis.fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: "Bonjour" } }], data: [] })) as never;
  deployment.read.mockReset();
});
afterEach(() => { globalThis.fetch = originalFetch; delete process.env.OPENROUTER_API_KEY; reinitialiserEnv(); });

describe("OpenRouter stays closed outside the synthetic deployment", () => {
  it.each([
    ["a real-patient deployment", () => Promise.resolve(false)],
    ["an unknown deployment state", () => Promise.resolve(null)],
    ["a database failure", () => Promise.reject(new Error("down"))],
  ])("sends nothing on %s", async (_label, state) => {
    deployment.read.mockImplementation(state);
    await expect(openRouterProvider.complete(requete)).rejects.toMatchObject({ code: "SECURITY_BLOCK" });
    await expect(openRouterProvider.stream(requete)).rejects.toMatchObject({ code: "SECURITY_BLOCK" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("makes no OpenRouter call at all through llm() or llmStream()", async () => {
    deployment.read.mockResolvedValue(false);
    const answer = await llm(llmRequest), stream = await llmStream(llmRequest);
    expect(answer.ok).toBe(false);expect(stream.ok).toBe(false);
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url).includes("openrouter.ai"))).toEqual([]);
  });

  it("re-checks every call rather than caching a positive answer", async () => {
    deployment.read.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(openRouterProvider.complete(requete)).resolves.toBeDefined();
    await expect(openRouterProvider.complete(requete)).rejects.toMatchObject({ code: "SECURITY_BLOCK" });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it.each(["1", "true"])("refuses a packaged install even when the database says cloud-dev (MINDCARE_PACKAGED=%s)", async packaged => {
    // A restored snapshot keeps environment = 'cloud-dev' while holding production records.
    vi.stubEnv("MINDCARE_PACKAGED", packaged);
    try {
      deployment.read.mockResolvedValue(true);
      await expect(openRouterProvider.complete(requete)).rejects.toMatchObject({ code: "SECURITY_BLOCK" });
      await expect(lireQuotaOpenRouter()).rejects.toMatchObject({ code: "SECURITY_BLOCK" });
      expect((await llm(llmRequest)).ok).toBe(false);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(deployment.read).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("refuses by install layout when the variable is absent", async () => {
    const cwd = vi.spyOn(process, "cwd").mockReturnValue("C:\\Program Files\\MindCare OS\\resources\\serveur");
    try {
      deployment.read.mockResolvedValue(true);
      await expect(openRouterProvider.complete(requete)).rejects.toMatchObject({ code: "SECURITY_BLOCK" });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { cwd.mockRestore(); }
  });

  it("keeps maintenance from contacting OpenRouter outside the synthetic deployment", async () => {
    deployment.read.mockResolvedValue(false);
    await preparerPoolModelesGratuits({ timeoutMs: 200 }).catch(() => undefined);
    await lireQuotaOpenRouter().catch(() => undefined);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("still works on the synthetic deployment", async () => {
    deployment.read.mockResolvedValue(true);
    await expect(openRouterProvider.complete(requete)).resolves.toBeDefined();
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("does not read the deployment for a paid model it refuses anyway", async () => {
    await expect(openRouterProvider.complete({ ...requete, model: "openai/gpt-6-astra" })).rejects.toMatchObject({ code: "CONFIGURATION" });
    expect(deployment.read).not.toHaveBeenCalled();
  });
});
