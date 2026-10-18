import { appelGeminiInteraction } from "@/server/egress/external-call";

/**
 * Delivery voice gateway: fixed Gemini models, server key, no other STT/TTS
 * provider, no fallback. Alexa's ONLY transcription model is
 * gemini-3.5-transcribe; its ONLY speech model is gemini-3.8-flash-tts.
 * Failures throw — callers map them to the existing safe error envelopes,
 * and text always remains usable.
 */
import { ALEXA_STT_MODEL,ALEXA_TTS_MODEL,ALEXA_TTS_VOICE } from "./model-policy";
export { ALEXA_STT_MODEL,ALEXA_TTS_MODEL,ALEXA_TTS_VOICE };

/** Prepend a 44-byte WAV header to raw PCM16 mono bytes (no transcoding). */
export function envelopperWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Verbatim dictation: preserve clinical meaning,
 * medical terms, medication names, numbers, dosages, dates, negations and
 * uncertainty. Preserve the spoken language (French / Arabic);
 * never translate, never diagnose, never summarize.
 */
export async function transcrireGemini(wavBase64: string, langue: "fr" | "ar" | "auto", signal?: AbortSignal): Promise<string> {
  const result = await appelGeminiInteraction({ model: ALEXA_STT_MODEL, audio: wavBase64,
    language: langue, ...(signal ? { signal } : {}) });
  if (!result.text.trim()) throw new Error("AlexaVoiceEmpty");
  return result.text.trim();
}

/** Synthesize Alexa's final reply text only. Returns WAV bytes (header + PCM). */
export async function synthetiserGemini(texte: string, signal?: AbortSignal): Promise<Buffer> {
  const result = await appelGeminiInteraction({ model: ALEXA_TTS_MODEL, text: texte,
    voice: ALEXA_TTS_VOICE, ...(signal ? { signal } : {}) });
  if (!result.audio || result.audio.mimeType !== "audio/wav") throw new Error("AlexaVoiceEmpty");
  const wav = Buffer.from(result.audio.data, "base64");
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE")
    throw new Error("AlexaVoiceFormat");
  return wav;
}
