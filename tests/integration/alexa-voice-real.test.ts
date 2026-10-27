import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { arreterVoixNative, demanderVoixNative, preparerVoixNative, statutVoixNative } from "@/server/voice/runtime";

const SESSION = "a".repeat(64);
const RUN = "00000000-0000-4000-8000-000000000001";
const UTTERANCE = "00000000-0000-4000-8000-000000000002";

process.env["MINDCARE_DATABASE_URL"] ??= "postgresql://synthetic:unused@127.0.0.1:1/synthetic";
process.env["ALEXA_LOCAL_VOICE"] ??= "true";
process.env["ALEXA_VOICE_HEALTH"] ??= "1";

afterAll(() => arreterVoixNative());

describe("real local speech worker", () => {
  it(
    "loads large-v3-turbo once, proves STT/TTS inference, and reports the actual model",
    async () => {
      await preparerVoixNative(SESSION);
      expect(statutVoixNative()).toMatchObject({
        provider: "local",
        stt: "whisper-large-v3-turbo-q5_0",
        tts: "kokoro-82m-v1.0-ff_siwis",
        ready: true,
      });

      const tts = await demanderVoixNative({
        id: crypto.randomUUID(),
        sessionId: SESSION,
        runId: RUN,
        utteranceId: UTTERANCE,
        action: "tts",
        texte: "Bonjour. La voix locale est prête.",
        langue: "fr",
      });
      expect(tts.ok).toBe(true);
      expect(tts.model).toBe("kokoro-82m-v1.0-ff_siwis");
      expect(tts.sampleRate).toBe(24_000);
      expect(Buffer.from(tts.audioBase64 ?? "", "base64").subarray(0, 4).toString("ascii")).toBe("RIFF");

      const wav = readFileSync(join(process.cwd(), "resources", "voix", "health", "fr-bonjour.wav"));
      const stt = await demanderVoixNative({
        id: crypto.randomUUID(),
        sessionId: SESSION,
        runId: RUN,
        utteranceId: UTTERANCE,
        action: "stt",
        pcmBase64: wav.subarray(44).toString("base64"),
        sampleRate: 16_000,
        langue: "fr",
      });
      expect(stt.ok).toBe(true);
      expect(stt.model).toBe("whisper-large-v3-turbo-q5_0");
      expect(stt.texte?.toLowerCase()).toContain("bonjour");
    },
    360_000,
  );
});
