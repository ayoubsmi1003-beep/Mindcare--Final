import { afterEach, describe, expect, it, vi } from "vitest";
const { native, actor, admit, admitted, transcribe, synthesize } = vi.hoisted(() => ({ native: vi.fn(), actor: { id: "doctor" }, admit: vi.fn().mockResolvedValue(undefined), admitted: vi.fn().mockResolvedValue(true), transcribe: vi.fn(), synthesize: vi.fn() }));
vi.mock("@/app/api/jarvis/_commun", () => ({ identite: async () => actor.id || null, echec: (code: string, message: string) => Response.json({ ok: false, error: { code, message } }), succes: (data: unknown) => Response.json({ ok: true, data }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "synthetic-session-token" }) }) }));
vi.mock("@/server/auth/session", () => ({ NOM_COOKIE: "session" }));
vi.mock("@/server/voice/runtime", () => ({ demanderVoixNative: native }));
vi.mock("@/server/env", () => ({ env: () => ({ JARVIS_VOICE_ENABLED: "true", ALEXA_LOCAL_VOICE: "true" }) }));
vi.mock("@/server/egress/external-call", () => ({ admitGeminiVoice: admit }));
vi.mock("@/server/alexa/speech-admission", () => ({ serverAdmittedSpeech: admitted }));
vi.mock("@/server/alexa/gemini-voice", async importOriginal => ({ ...await importOriginal<typeof import("@/server/alexa/gemini-voice")>(), transcrireGemini: transcribe, synthetiserGemini: synthesize }));
import { POST as stt } from "@/app/api/jarvis/jarvis-voice-in/route";
import { POST as tts } from "@/app/api/jarvis/jarvis-voice-out/route";
const ids = { runId: "00000000-0000-4000-8000-000000000001", utteranceId: "00000000-0000-4000-8000-000000000002" };
const syntheticWav = () => { const bytes = Buffer.alloc(44); bytes.write("RIFF", 0); bytes.write("WAVE", 8); return bytes; };
const request = (body: unknown, headers = {}) => new Request("http://localhost/api/jarvis/voice", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
afterEach(() => { vi.clearAllMocks(); actor.id = "doctor"; });
describe("authenticated voice API boundary", () => {
  it("transcribes admitted memory PCM with correlated IDs without a native worker", async () => {
    transcribe.mockResolvedValue("Bonjour");
    const response = await stt(request({ ...ids, pcmBase64: Buffer.alloc(32000).toString("base64"), sampleRate: 16000 }));
    expect(await response.json()).toMatchObject({ ok: true, data: { ...ids, texte: "Bonjour" } });
    expect(admit.mock.invocationCallOrder[0]).toBeLessThan(transcribe.mock.invocationCallOrder[0]!);
    expect(transcribe).toHaveBeenCalledWith(expect.any(String), "auto", expect.any(AbortSignal));
    expect(native).not.toHaveBeenCalled();
  });
  it("refuses anonymous calls, filenames, oversized payloads and unsupported formats before transport", async () => {
    actor.id = "";
    await stt(request({ ...ids, pcmBase64: "AAAA", sampleRate: 16000 }));
    actor.id = "doctor";
    for (const body of [{ ...ids, path: "note.wav" }, { ...ids, pcmBase64: "AAAA", sampleRate: 44100 }, { ...ids, audioBase64: "AAAA" }])
      expect((await (await stt(request(body))).json()).ok).toBe(false);
    expect((await (await stt(request({ ...ids, pcmBase64: "AAAA", sampleRate: 16000 }, { "Content-Length": "1300001" }))).json()).ok).toBe(false);
    expect((await stt(request({}, { Origin: "https://untrusted.invalid" }))).status).toBe(403);
    expect(admit).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
  });
  it("returns Piper WAV with correlated IDs and no-store, without external voice calls", async () => {
    native.mockImplementationOnce(async (input: { id: string; runId: string; utteranceId: string }) => ({
      id: input.id, runId: input.runId, utteranceId: input.utteranceId, ok: true,
      audioBase64: syntheticWav().toString("base64"), mimeType: "audio/wav", sampleRate: 22050, model: "piper",
    }));
    const r = await tts(request({ ...ids, texte: "Bonjour" }));
    expect(r.headers.get("X-Alexa-Voice-Provider")).toBe("piper");
    expect(r.headers.get("Content-Type")).toBe("audio/wav");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(r.headers.get("X-Alexa-Run-ID")).toBe(ids.runId);
    expect(r.headers.get("X-Alexa-Utterance-ID")).toBe(ids.utteranceId);
    expect(Buffer.from(await r.arrayBuffer())).toEqual(syntheticWav());
    expect(native).toHaveBeenCalledWith(expect.objectContaining({ action: "tts", texte: "Bonjour", ...ids,
      sessionId: expect.stringMatching(/^[a-f0-9]{64}$/u) }), expect.any(AbortSignal));
    expect(admit).not.toHaveBeenCalled(); expect(synthesize).not.toHaveBeenCalled();
  });
  it("speaks an authorized patient answer through local Piper without an egress classification or Gemini fallback", async () => {
    const texte = "Meriem Benali a eu deux consultations terminées.";
    native.mockImplementationOnce(async (input: { id: string; runId: string; utteranceId: string }) => ({
      id: input.id, runId: input.runId, utteranceId: input.utteranceId, ok: true,
      audioBase64: syntheticWav().toString("base64"), mimeType: "audio/wav", sampleRate: 22050, model: "piper",
    }));
    const r = await tts(request({ ...ids, texte }));
    expect(r.status).toBe(200); expect(r.headers.get("X-Alexa-Voice-Provider")).toBe("piper");
    expect(native).toHaveBeenCalledWith(expect.objectContaining({ action: "tts", texte }), expect.any(AbortSignal));
    expect(admit).not.toHaveBeenCalled(); expect(synthesize).not.toHaveBeenCalled();
  });
  it("reports Piper failure instead of silently switching to an external voice provider", async () => {
    native.mockRejectedValueOnce(Error("configuration: voix-locale"));
    const r = await tts(request({ ...ids, texte: "Bonjour" }));
    expect((await r.json()).error.code).toBe("configuration");
    expect(synthesize).not.toHaveBeenCalled();
  });
});
