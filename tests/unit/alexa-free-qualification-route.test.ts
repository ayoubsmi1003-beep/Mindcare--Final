import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({ identity: vi.fn(), qualify: vi.fn() }));
vi.mock("@/app/api/jarvis/_commun", () => ({ identite: controls.identity }));
vi.mock("@/server/alexa/model-gateway", () => ({ qualifyAlexaModels: controls.qualify, getAlexaModelPolicy: () => ({ variant: "free" }) }));
import { POST } from "@/app/api/alexa/qualify/route";

beforeEach(() => {
  controls.identity.mockReset().mockResolvedValue({ id: "synthetic" });
  controls.qualify.mockReset().mockResolvedValue({ qualified: true });
});
function request(body?: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/alexa/qualify", { method: "POST", headers: { origin },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
describe("explicit authenticated free-provider qualification", () => {
  it("cross-origin requests cannot authenticate or consume provider quota", async () => {
    expect((await POST(request({ provider: "groq-free", freeTierConfirmed: true }, "https://untrusted.invalid"))).status).toBe(403);
    expect(controls.identity).not.toHaveBeenCalled(); expect(controls.qualify).not.toHaveBeenCalled();
  });
  it("unauthenticated requests consume no provider quota", async () => {
    controls.identity.mockResolvedValue(null);
    expect((await POST(request({ provider: "gemini-free", freeTierConfirmed: true }))).status).toBe(401);
    expect(controls.qualify).not.toHaveBeenCalled();
  });
  it("an empty request only reads the policy", async () => {
    expect(await (await POST(request())).json()).toEqual({ ok: true, data: { variant: "free" } });
    expect(controls.qualify).not.toHaveBeenCalled();
  });
  it.each([{ provider: "paid" }, { provider: "groq-free", unknown: true }, { provider: "gemini-free", freeTierConfirmed: "true" }])
    ("invalid provider/options never start qualification", async body => {
      expect((await POST(request(body))).status).toBe(400); expect(controls.qualify).not.toHaveBeenCalled();
    });
  it("OpenRouter options omit an absent free-tier assertion", async () => {
    expect((await POST(request({ provider: "openrouter" }))).status).toBe(200);
    expect(controls.qualify.mock.calls[0]![0]).not.toHaveProperty("freeTierConfirmed");
  });
  it.each(["gemini-free", "groq-free"] as const)("passes explicit confirmation and cancellation to %s maintenance", async provider => {
    const input = request({ provider, freeTierConfirmed: true });
    expect((await POST(input)).status).toBe(200);
    expect(controls.qualify).toHaveBeenCalledWith({ provider, freeTierConfirmed: true, timeoutMs: 30000, maxModels: 2, signal: input.signal });
  });
  it("a qualification failure cannot be returned as success", async () => {
    controls.qualify.mockRejectedValue(new Error("private provider detail"));
    const response = await POST(request({ provider: "groq-free", freeTierConfirmed: false }));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, code: "unavailable" });
  });
});
