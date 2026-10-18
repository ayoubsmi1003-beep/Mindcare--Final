import { afterEach, expect, it, vi } from "vitest";
const { transcribe, synthesize, admit, admitted, actor } = vi.hoisted(() => ({ transcribe: vi.fn(), synthesize: vi.fn(), admit: vi.fn().mockResolvedValue(undefined), admitted: vi.fn().mockResolvedValue(true), actor: { id: "doctor" } }));
vi.mock("@/app/api/jarvis/_commun", () => ({ identite: async () => actor.id || null,
  echec: (code: string, message: string) => Response.json({ ok: false, error: { code, message } }),
  succes: (data: unknown) => Response.json({ ok: true, data }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "synthetic-session" }) }) }));
vi.mock("@/server/auth/session", () => ({ NOM_COOKIE: "session" }));
vi.mock("@/server/env", () => ({ env: () => ({ JARVIS_VOICE_ENABLED: "true" }) }));
vi.mock("@/server/alexa/gemini-voice", async importOriginal => ({ ...await importOriginal<typeof import("@/server/alexa/gemini-voice")>(), transcrireGemini: transcribe, synthetiserGemini: synthesize }));
vi.mock("@/server/egress/external-call", () => ({ admitGeminiVoice: admit }));
vi.mock("@/server/alexa/speech-admission", () => ({ serverAdmittedSpeech: admitted }));
import { POST as stt } from "@/app/api/jarvis/jarvis-voice-in/route";
import { POST as tts } from "@/app/api/jarvis/jarvis-voice-out/route";
const ids = { runId: "00000000-0000-4000-8000-000000000001", utteranceId: "00000000-0000-4000-8000-000000000002" };
const request = (body: unknown) => new Request("http://localhost/api/jarvis/voice", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(body) });
afterEach(() => { vi.clearAllMocks(); actor.id = "doctor"; admit.mockResolvedValue(undefined); admitted.mockResolvedValue(true); });
it("wraps captured PCM once and preserves transcription IDs and language", async () => {
  transcribe.mockResolvedValue("Pas d’insomnie. Sertraline 50 mg.");
  const response = await stt(request({ ...ids, pcmBase64: Buffer.alloc(32000).toString("base64"), sampleRate: 16000, langue: "fr" }));
  expect(await response.json()).toMatchObject({ ok: true, data: { ...ids, texte: "Pas d’insomnie. Sertraline 50 mg." } });
  const wav = Buffer.from(transcribe.mock.calls[0]![0] as string, "base64");
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.length).toBe(32044);
  expect(transcribe.mock.calls[0]![1]).toBe("fr");
  expect(transcribe.mock.calls[0]![2]).toBeInstanceOf(AbortSignal);
});
it("rejects anonymous and malformed requests before transcription", async () => {
  actor.id = "";
  expect((await (await stt(request({ ...ids, pcmBase64: "AAAA", sampleRate: 16000 }))).json()).ok).toBe(false);
  actor.id = "doctor";
  for (const body of [{ ...ids, path: "note.wav" }, { ...ids, pcmBase64: "AAAA", sampleRate: 44100 }])
    expect((await (await stt(request(body))).json()).ok).toBe(false);
  expect(transcribe).not.toHaveBeenCalled();
});
it("returns speech with correlated IDs, no-store and safe failure", async () => {
  synthesize.mockResolvedValue(Buffer.from("RIFFsynthetic"));
  const response = await tts(request({ ...ids, texte: "Bonjour." }));
  expect(response.headers.get("Content-Type")).toBe("audio/wav");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Alexa-Utterance-ID")).toBe(ids.utteranceId);
  synthesize.mockRejectedValue(new Error("AlexaVoiceHTTP503"));
  expect(await (await tts(request({ ...ids, texte: "Bonjour." }))).json()).toMatchObject({ ok: false, error: { code: "synthese-indisponible" } });
});
it("keeps a patient identity out of cloud speech", async () => {
  expect(await (await tts(request({ ...ids, texte: "Le dossier de Karim Boualem." }))).json()).toMatchObject({ ok: false, error: { code: "frontiere" } });
  expect(synthesize).not.toHaveBeenCalled();
});

it("blocks external audio before transcription when admission fails", async () => {
  admit.mockRejectedValueOnce(new Error("voice-not-admitted"));
  expect((await (await stt(request({ ...ids, pcmBase64: Buffer.alloc(32000).toString("base64"), sampleRate: 16000 }))).json()).ok).toBe(false);
  expect(transcribe).not.toHaveBeenCalled();
});
it("refuses client text that has no server-admitted answer", async () => {
  admitted.mockResolvedValueOnce(false);
  expect(await (await tts(request({ ...ids, texte: "Bonjour." }))).json()).toMatchObject({ ok: false, error: { code: "frontiere" } });
  expect(synthesize).not.toHaveBeenCalled();
});
