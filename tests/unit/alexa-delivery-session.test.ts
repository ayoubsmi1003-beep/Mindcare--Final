import { afterEach, expect, it, vi } from "vitest";
const { actor, config, admit, native } = vi.hoisted(() => ({ actor: { id: "doctor" }, config: { JARVIS_VOICE_ENABLED: "true", GEMINI_API_KEY: "synthetic-key", GOOGLE_API_KEY: "" }, admit: vi.fn().mockResolvedValue(undefined), native: vi.fn() }));
vi.mock("@/app/api/jarvis/_commun", () => ({ identite: async () => actor.id || null,
  echec: (code: string, message: string) => Response.json({ ok: false, error: { code, message } }),
  succes: (data: unknown) => Response.json({ ok: true, data }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "synthetic-session" }) }) }));
vi.mock("@/server/auth/session", () => ({ NOM_COOKIE: "session" }));
vi.mock("@/server/env", () => ({ env: () => config }));
vi.mock("@/server/voice/runtime", () => ({ preparerVoixNative: native, arreterVoixNative: native }));
vi.mock("@/server/egress/external-call", () => ({ admitGeminiVoice: admit }));
import { POST } from "@/app/api/jarvis/jarvis-voice-session/route";
const request = (action: string) => new Request("http://localhost/api/jarvis/voice-session", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
afterEach(() => { vi.clearAllMocks(); actor.id = "doctor"; admit.mockResolvedValue(undefined); config.GEMINI_API_KEY = "synthetic-key"; config.JARVIS_VOICE_ENABLED = "true"; });
it("prepares and stops Gemini capture without a native model installation", async () => {
  expect(await (await POST(request("prepare"))).json()).toMatchObject({ ok: true, data: { accepted: true } });
  expect(await (await POST(request("stop"))).json()).toMatchObject({ ok: true, data: { stopped: true } });
  expect(native).not.toHaveBeenCalled();
  expect(admit).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it("keeps authentication, disabled voice and missing-key refusals", async () => {
  actor.id = "";
  expect((await (await POST(request("prepare"))).json()).ok).toBe(false);
  actor.id = "doctor"; config.GEMINI_API_KEY = "";
  expect((await (await POST(request("prepare"))).json()).ok).toBe(false);
  config.GEMINI_API_KEY = "synthetic-key"; config.JARVIS_VOICE_ENABLED = "false";
  expect((await (await POST(request("prepare"))).json()).ok).toBe(false);
  expect(native).not.toHaveBeenCalled();
});

it("does not admit microphone capture without external-audio authorization", async () => {
  admit.mockRejectedValueOnce(new Error("voice-not-admitted"));
  expect(await (await POST(request("prepare"))).json()).toMatchObject({ ok: false, error: { code: "frontiere" } });
  expect(native).not.toHaveBeenCalled();
});
