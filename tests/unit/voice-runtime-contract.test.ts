import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { ALEXA_STT_MODEL, ALEXA_TTS_MODEL, ALEXA_TTS_VOICE } from "@/server/alexa/model-policy";
import {
  MODELES_VOIX,
  verifierFichierModele,
} from "@/server/voice/modeles";
import { resoudreCheminsVoix } from "@/server/voice/chemins";

describe("canonical local voice identity", () => {
  it("pins Whisper large-v3-turbo and Kokoro French as the only active speech models", () => {
    expect(ALEXA_STT_MODEL).toBe("whisper-large-v3-turbo-q5_0");
    expect(ALEXA_TTS_MODEL).toBe("kokoro-82m-v1.0-ff_siwis");
    expect(ALEXA_TTS_VOICE).toBe("ff_siwis");

    expect(MODELES_VOIX.stt).toMatchObject({
      id: "whisper-large-v3-turbo-q5_0",
      file: "ggml-large-v3-turbo-q5_0.bin",
      bytes: 574_041_195,
      sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    });
    expect(MODELES_VOIX.ttsModel).toMatchObject({
      file: "kokoro-v1.0.fp16.onnx",
      bytes: 163_527_961,
      sha256: "f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96",
    });
    expect(MODELES_VOIX.ttsVoices).toMatchObject({
      file: "voices-v1.0.bin",
      bytes: 28_214_398,
      sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    });
  });

  it("rejects a truncated or changed model before runtime use", async () => {
    const root = mkdtempSync(join(tmpdir(), "mindcare-model-"));
    const file = join(root, "fake.bin");
    writeFileSync(file, "not-a-model");
    try {
      await expect(
        verifierFichierModele(file, {
          id: "fake",
          bytes: 11,
          sha256: "0".repeat(64),
        }),
      ).rejects.toThrow("configuration: modele");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("voice resource paths", () => {
  it("resolves development resources relative to the checkout, including spaces and Unicode", () => {
    const cwd = "C:\\MindCare Développement\\Final mindcare";
    const paths = resoudreCheminsVoix({ cwd, env: {} });
    expect(paths.root).toBe(join(cwd, "resources", "voix"));
    expect(paths.assets).toBe(join(paths.root, "assets"));
    expect(paths.python).toBe(join(paths.root, "python", "python.exe"));
    expect(paths.packages).toBe(join(paths.root, "packages"));
    expect(paths.worker).toBe(join(paths.root, "native-voice-worker.py"));
    expect(paths.wakeWorker).toBe(join(paths.root, "wake-voice-worker.py"));
  });

  it("uses explicit packaged paths and never falls back to cwd", () => {
    const packaged = "C:\\Program Files\\MindCare OS\\resources\\voix";
    const paths = resoudreCheminsVoix({
      cwd: "D:\\somewhere-else",
      env: {
        MINDCARE_PACKAGED: "1",
        ALEXA_VOICE_ROOT: packaged,
        ALEXA_VOICE_ASSETS: `${packaged}\\assets`,
        ALEXA_VOICE_PYTHON: `${packaged}\\python\\python.exe`,
        ALEXA_VOICE_PACKAGES: `${packaged}\\packages`,
      },
    });
    expect(paths.root).toBe(packaged);
    expect(paths.assets).toBe(`${packaged}\\assets`);
    expect(paths.worker).toBe(`${packaged}\\native-voice-worker.py`);
  });

  it("fails closed when packaged without an explicit root", () => {
    expect(() => resoudreCheminsVoix({ cwd: "C:\\dev", env: { MINDCARE_PACKAGED: "1" } })).toThrow(
      "configuration: chemins",
    );
  });
});
