import { afterEach, describe, expect, it, vi } from "vitest";
const { native, actor } = vi.hoisted(() => ({ native: { prepare: vi.fn(), stop: vi.fn() }, actor: { id: "doctor" } }));
vi.mock("@/app/api/jarvis/_commun", () => ({ identite: async () => actor.id || null, echec: (code: string, message: string) => Response.json({ ok: false, error: { code, message } }), succes: (data: unknown) => Response.json({ ok: true, data }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "synthetic-session-token" }) }) }));
vi.mock("@/server/auth/session", () => ({ NOM_COOKIE: "session" }));
vi.mock("@/server/voice/runtime", () => ({ preparerVoixNative: native.prepare, arreterVoixNative: native.stop }));
vi.mock("@/server/env", () => ({ env: () => ({}) }));
import { POST } from "@/app/api/jarvis/jarvis-voice-session/route";
const request = (body: unknown) => new Request("http://localhost/api/jarvis/jarvis-voice-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
afterEach(() => { vi.clearAllMocks(); actor.id = "doctor"; });
describe("local voice lifecycle boundary", () => {
  it("derives private worker scope from authentication and never trusts a supplied scope", async () => {
    const result = await POST(request({ action: "prepare" }));
    expect(await result.json()).toMatchObject({ ok: true });
    expect(native.prepare).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/u), expect.any(AbortSignal), true);
    expect((await (await POST(request({ action: "stop", sessionId: "another-doctor" }))).json()).ok).toBe(false);
    expect(native.stop).not.toHaveBeenCalled();
  });
  it("stops only the authenticated session and refuses anonymous lifecycle calls", async () => {
    await POST(request({ action: "stop" })); expect(native.stop).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/u));
    actor.id = ""; expect((await (await POST(request({ action: "prepare" }))).json()).ok).toBe(false);
    expect(native.prepare).not.toHaveBeenCalled();
  });
});
