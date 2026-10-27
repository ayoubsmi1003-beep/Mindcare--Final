import { afterEach, describe, expect, it, vi } from "vitest";

const { prepare, demand, stop, actor } = vi.hoisted(() => ({
  prepare: vi.fn().mockResolvedValue(undefined),
  demand: vi.fn().mockResolvedValue({ detected: true }),
  stop: vi.fn(),
  actor: { id: "doctor" },
}));

vi.mock("@/app/api/jarvis/_commun", () => ({
  identite: async () => actor.id || null,
  echec: (code: string, message: string) => Response.json({ ok: false, error: { code, message } }),
  succes: (data: unknown) => Response.json({ ok: true, data }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "synthetic-session-token" }) }) }));
vi.mock("@/server/auth/session", () => ({ NOM_COOKIE: "session" }));
vi.mock("@/server/env", () => ({
  env: () => ({ JARVIS_VOICE_ENABLED: "true", ALEXA_LOCAL_VOICE: "true" }),
}));
vi.mock("@/server/voice/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/voice/session")>()),
  sessionVoix: async () => "a".repeat(64),
}));
vi.mock("@/server/voice/wake-runtime", () => ({
  preparerReveil: prepare,
  demanderReveil: demand,
  arreterReveil: stop,
}));

import { POST } from "@/app/api/jarvis/jarvis-wake/route";

const request = (body: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/jarvis/jarvis-wake", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

afterEach(() => {
  vi.clearAllMocks();
  actor.id = "doctor";
  demand.mockResolvedValue({ detected: true });
});

describe("wake-word boundary", () => {
  it("starts the local spotter and returns readiness only", async () => {
    expect(await (await POST(request({ action: "start" }))).json()).toMatchObject({
      ok: true,
      data: { ready: true, engine: "vosk-fr-FR-small" },
    });
    expect(prepare).toHaveBeenCalledWith("a".repeat(64), expect.any(AbortSignal));
    expect(demand).not.toHaveBeenCalled();
  });

  it("returns a boolean detection and never a transcript", async () => {
    const response = await POST(request({ action: "audio", pcmBase64: "AAAA" }));
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, data: { detected: true } });
    expect(JSON.stringify(body)).not.toMatch(/texte|transcript/i);
    expect(demand).toHaveBeenCalledWith("a".repeat(64), "audio", "AAAA", expect.any(AbortSignal));
  });

  it("answers a ping without touching audio or returning a transcript", async () => {
    const response = await POST(request({ action: "ping" }));
    const body = await response.json();
    expect(body).toEqual({ ok: true, data: { pong: true } });
    expect(demand).toHaveBeenCalledWith("a".repeat(64), "ping", undefined, expect.any(AbortSignal));
    expect(JSON.stringify(body)).not.toMatch(/texte|transcript/i);
  });

  it("keeps answering five detections without disarming the spotter", async () => {
    for (let i = 0; i < 5; i += 1) {
      expect(await (await POST(request({ action: "audio", pcmBase64: "AAAA" }))).json()).toEqual({
        ok: true,
        data: { detected: true },
      });
    }
    expect(demand).toHaveBeenCalledTimes(5);
    expect(stop).not.toHaveBeenCalled();
  });

  it("survives a transient worker failure and answers the next chunk", async () => {
    demand.mockRejectedValueOnce(new Error("timeout"));
    expect(await (await POST(request({ action: "audio", pcmBase64: "AAAA" }))).json()).toMatchObject({
      ok: false,
      error: { code: "configuration" },
    });
    demand.mockResolvedValueOnce({ detected: true });
    expect(await (await POST(request({ action: "audio", pcmBase64: "AAAA" }))).json()).toMatchObject({
      ok: true,
      data: { detected: true },
    });
    expect(stop).not.toHaveBeenCalled();
  });

  it("stops the worker for the authenticated scope", async () => {
    expect(await (await POST(request({ action: "stop" }))).json()).toMatchObject({
      ok: true,
      data: { stopped: true },
    });
    expect(stop).toHaveBeenCalledWith("a".repeat(64));
  });

  it("refuses anonymous, cross-origin and malformed requests before the worker", async () => {
    actor.id = "";
    expect((await (await POST(request({ action: "start" }))).json()).ok).toBe(false);
    actor.id = "doctor";
    expect((await POST(request({ action: "start" }, "https://untrusted.invalid"))).status).toBe(403);
    expect((await (await POST(request({ action: "audio" }))).json()).ok).toBe(false);
    expect((await (await POST(request({ action: "start", sessionId: "b".repeat(64) }))).json()).ok).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
    expect(demand).not.toHaveBeenCalled();
  });
});
