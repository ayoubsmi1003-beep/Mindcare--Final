import { afterEach, describe, expect, it, vi } from "vitest";

const { prepare, stop, status, actor, config } = vi.hoisted(() => ({
  prepare: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
  status: vi.fn().mockReturnValue({
    provider: "local",
    stt: "faster-whisper-small-int8",
    tts: "kokoro-82m-v1.0-ff_siwis",
    worker: "ready",
  }),
  actor: { id: "doctor" },
  config: { JARVIS_VOICE_ENABLED: "true", ALEXA_LOCAL_VOICE: "true" },
}));

vi.mock("@/app/api/jarvis/_commun", () => ({
  identite: async () => actor.id || null,
  echec: (code: string, message: string) => Response.json({ ok: false, error: { code, message } }),
  succes: (data: unknown) => Response.json({ ok: true, data }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "synthetic-session-token" }) }) }));
vi.mock("@/server/auth/session", () => ({ NOM_COOKIE: "session" }));
vi.mock("@/server/env", () => ({ env: () => config }));
vi.mock("@/server/voice/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/voice/session")>()),
  sessionVoix: async () => "a".repeat(64),
}));
vi.mock("@/server/voice/runtime", () => ({
  preparerVoixNative: prepare,
  arreterVoixNative: stop,
  statutVoixNative: status,
}));

import { POST } from "@/app/api/jarvis/jarvis-voice-session/route";

const request = (body: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/jarvis/jarvis-voice-session", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

afterEach(() => {
  vi.clearAllMocks();
  actor.id = "doctor";
  config.JARVIS_VOICE_ENABLED = "true";
  config.ALEXA_LOCAL_VOICE = "true";
  prepare.mockResolvedValue(undefined);
});

describe("local capture lifecycle", () => {
  it("prepares the native worker with the server-owned session scope", async () => {
    expect(await (await POST(request({ action: "prepare" }))).json()).toMatchObject({
      ok: true,
      data: {
        provider: "local",
        stt: "faster-whisper-small-int8",
        tts: "kokoro-82m-v1.0-ff_siwis",
      },
    });
    expect(prepare).toHaveBeenCalledWith("a".repeat(64), expect.any(AbortSignal), true);
  });

  it("reports the actual local worker state without starting a model", async () => {
    expect(await (await POST(request({ action: "status" }))).json()).toMatchObject({
      ok: true,
      data: { provider: "local", worker: "ready" },
    });
    expect(status).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("stops the worker for the authenticated scope and ignores a client-chosen scope", async () => {
    expect(await (await POST(request({ action: "stop" }))).json()).toMatchObject({
      ok: true,
      data: { stopped: true },
    });
    expect(stop).toHaveBeenCalledWith("a".repeat(64));
    expect((await (await POST(request({ action: "prepare", sessionId: "b".repeat(64) }))).json()).ok).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("refuses anonymous, cross-origin, disabled and uninstalled configurations", async () => {
    actor.id = "";
    expect((await (await POST(request({ action: "prepare" }))).json()).ok).toBe(false);
    actor.id = "doctor";
    expect((await POST(request({ action: "prepare" }, "https://untrusted.invalid"))).status).toBe(403);
    config.JARVIS_VOICE_ENABLED = "false";
    expect(await (await POST(request({ action: "prepare" }))).json()).toMatchObject({
      ok: false,
      error: { code: "configuration" },
    });
    config.JARVIS_VOICE_ENABLED = "true";
    config.ALEXA_LOCAL_VOICE = "false";
    expect(await (await POST(request({ action: "prepare" }))).json()).toMatchObject({
      ok: false,
      error: { code: "configuration" },
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("turns a missing or corrupt bundle into a recoverable configuration error", async () => {
    prepare.mockRejectedValueOnce(new Error("configuration: hash"));
    expect(await (await POST(request({ action: "prepare" }))).json()).toMatchObject({
      ok: false,
      error: { code: "configuration" },
    });
  });
});
