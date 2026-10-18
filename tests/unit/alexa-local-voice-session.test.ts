import { afterEach, describe, expect, it, vi } from "vitest";
const { native, admit, actor } = vi.hoisted(() => ({ native: { prepare: vi.fn(), stop: vi.fn() }, admit: vi.fn().mockResolvedValue(undefined), actor: { id: "doctor" } }));
vi.mock("@/app/api/jarvis/_commun", () => ({ identite: async () => actor.id || null, echec: (code: string, message: string) => Response.json({ ok: false, error: { code, message } }), succes: (data: unknown) => Response.json({ ok: true, data }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "synthetic-session-token" }) }) }));
vi.mock("@/server/auth/session", () => ({ NOM_COOKIE: "session" }));
vi.mock("@/server/voice/runtime", () => ({ preparerVoixNative: native.prepare, arreterVoixNative: native.stop }));
vi.mock("@/server/egress/external-call", () => ({ admitGeminiVoice: admit }));
vi.mock("@/server/env", () => ({ env: () => ({ GEMINI_API_KEY: "synthetic-key", JARVIS_VOICE_ENABLED: "true" }) }));
import { POST } from "@/app/api/jarvis/jarvis-voice-session/route";
const request = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/jarvis/jarvis-voice-session", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
afterEach(() => { vi.clearAllMocks(); actor.id = "doctor"; });
describe("Gemini capture lifecycle boundary", () => {
  it("admits authenticated capture and never accepts a client worker scope", async () => {
    expect(await (await POST(request({ action: "prepare" }))).json()).toMatchObject({ ok: true, data: { provider: "gemini" } });
    expect(admit).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect((await (await POST(request({ action: "stop", sessionId: "another-doctor" }))).json()).ok).toBe(false);
    expect(native.prepare).not.toHaveBeenCalled();
    expect(native.stop).not.toHaveBeenCalled();
  });
  it("stops authenticated capture and refuses anonymous and cross-origin lifecycle calls", async () => {
    expect(await (await POST(request({ action: "stop" }))).json()).toMatchObject({ ok: true, data: { stopped: true } });
    actor.id = "";
    expect((await (await POST(request({ action: "prepare" }))).json()).ok).toBe(false);
    actor.id = "doctor";
    expect((await POST(request({ action: "prepare" }, "https://untrusted.invalid"))).status).toBe(403);
    expect(admit).not.toHaveBeenCalled();
    expect(native.prepare).not.toHaveBeenCalled();
  });
});
