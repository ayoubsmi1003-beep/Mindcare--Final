import { afterEach, describe, expect, it, vi } from "vitest";

const { native, actor, config } = vi.hoisted(() => ({
  native: vi.fn(),
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
vi.mock("@/server/voice/runtime", () => ({ demanderVoixNative: native }));

import { POST as stt } from "@/app/api/jarvis/jarvis-voice-in/route";
import { POST as tts } from "@/app/api/jarvis/jarvis-voice-out/route";

const ids = {
  runId: "00000000-0000-4000-8000-000000000001",
  utteranceId: "00000000-0000-4000-8000-000000000002",
};
const request = (body: unknown) =>
  new Request("http://localhost/api/jarvis/voice", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function wav(): Buffer {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0);
  b.writeUInt32LE(36, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24_000, 24);
  b.writeUInt32LE(48_000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(0, 40);
  return b;
}

afterEach(() => {
  native.mockReset();
  vi.clearAllMocks();
  actor.id = "doctor";
  config.JARVIS_VOICE_ENABLED = "true";
  config.ALEXA_LOCAL_VOICE = "true";
});

describe("local voice API boundary", () => {
  it("transcribes French PCM through the resident faster-whisper small int8 worker with no network", async () => {
    const reseau = vi.fn();
    vi.stubGlobal("fetch", reseau);
    native.mockResolvedValue({
      texte: "Pas d’insomnie. Sertraline 50 mg.",
      model: "faster-whisper-small-int8",
    });
    const response = await stt(
      request({
        ...ids,
        pcmBase64: Buffer.alloc(32_000).toString("base64"),
        sampleRate: 16_000,
        langue: "fr",
      }),
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { ...ids, texte: "Pas d’insomnie. Sertraline 50 mg." },
    });
    expect(native).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "stt",
        sessionId: "a".repeat(64),
        runId: ids.runId,
        utteranceId: ids.utteranceId,
        sampleRate: 16_000,
        langue: "fr",
        pcmBase64: expect.any(String),
      }),
      expect.any(AbortSignal),
    );
    expect(reseau).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("refuses anonymous, malformed, oversized and non-16kHz payloads before the worker", async () => {
    actor.id = "";
    expect(
      (await (await stt(request({ ...ids, pcmBase64: "AAAA", sampleRate: 16_000 }))).json()).ok,
    ).toBe(false);
    actor.id = "doctor";
    for (const body of [
      { ...ids, path: "note.wav" },
      { ...ids, pcmBase64: "AAAA", sampleRate: 44_100 },
      { ...ids, pcmBase64: "AAAA", sampleRate: 16_000, sessionId: "b".repeat(64) },
    ]) {
      expect((await (await stt(request(body))).json()).ok).toBe(false);
    }
    expect(native).not.toHaveBeenCalled();
  });

  it("maps worker failures to safe, named codes", async () => {
    native.mockRejectedValueOnce(new Error("silence"));
    expect(await (await stt(request({ ...ids, pcmBase64: "AAAA", sampleRate: 16_000 }))).json()).toMatchObject({
      ok: false,
      error: { code: "regle-metier" },
    });
    native.mockRejectedValueOnce(new Error("configuration: hash"));
    expect(await (await stt(request({ ...ids, pcmBase64: "AAAA", sampleRate: 16_000 }))).json()).toMatchObject({
      ok: false,
      error: { code: "configuration" },
    });
    native.mockRejectedValueOnce(new Error("timeout"));
    expect(await (await stt(request({ ...ids, pcmBase64: "AAAA", sampleRate: 16_000 }))).json()).toMatchObject({
      ok: false,
      error: { code: "transcription-indisponible" },
    });
  });

  it("synthesizes French text with the local Kokoro French voice at 24 kHz", async () => {
    native.mockResolvedValue({
      audioBase64: wav().toString("base64"),
      mimeType: "audio/wav",
      sampleRate: 24_000,
      model: "kokoro-82m-v1.0-ff_siwis",
    });
    const response = await tts(request({ ...ids, texte: "Bonjour. Comment allez-vous ?" }));
    expect(response.headers.get("X-Alexa-Voice-Provider")).toBe("local");
    expect(response.headers.get("X-Alexa-Voice-Model")).toBe("kokoro-82m-v1.0-ff_siwis");
    expect(response.headers.get("X-Alexa-Sample-Rate")).toBe("24000");
    expect(response.headers.get("Content-Type")).toBe("audio/wav");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Alexa-Utterance-ID")).toBe(ids.utteranceId);
    expect((await response.arrayBuffer()).byteLength).toBe(44);
    expect(native).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tts",
        texte: "Bonjour. Comment allez-vous ?",
        langue: "fr",
      }),
      expect.any(AbortSignal),
    );
  });

  it("speaks a completed patient-named answer through local Kokoro without a database admission call", async () => {
    const texte = "Ayoub Salmi a consulté la semaine dernière.";
    native.mockResolvedValue({
      audioBase64: wav().toString("base64"),
      mimeType: "audio/wav",
      sampleRate: 24_000,
      model: "kokoro-82m-v1.0-ff_siwis",
    });

    const response = await tts(request({ ...ids, texte }));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Alexa-Voice-Provider")).toBe("local");
    expect(native).toHaveBeenCalledWith(expect.objectContaining({ texte }), expect.any(AbortSignal));
  });

  it("maps local synthesis failures to safe named codes", async () => {
    native.mockRejectedValueOnce(new Error("configuration: assets"));
    expect(await (await tts(request({ ...ids, texte: "Bonjour." }))).json()).toMatchObject({
      ok: false,
      error: { code: "configuration" },
    });
    native.mockRejectedValueOnce(new Error("runtime"));
    expect(await (await tts(request({ ...ids, texte: "Bonjour." }))).json()).toMatchObject({
      ok: false,
      error: { code: "synthese-indisponible" },
    });
  });
});
