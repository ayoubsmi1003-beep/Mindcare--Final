import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { ALEXA_STT_MODEL, ALEXA_TTS_MODEL, ALEXA_TTS_VOICE } from "@/server/alexa/model-policy";
import {
  MODELES_VOIX,
  verifierDossierModele,
  verifierFichierModele,
  type ModeleDossier,
} from "@/server/voice/modeles";
import { resoudreCheminsVoix } from "@/server/voice/chemins";

const sha256 = (contenu: string | Buffer) => createHash("sha256").update(contenu).digest("hex");

describe("canonical local voice identity", () => {
  it("pins faster-whisper small int8 and Kokoro French as the only active speech models", () => {
    expect(ALEXA_STT_MODEL).toBe("faster-whisper-small-int8");
    expect(ALEXA_TTS_MODEL).toBe("kokoro-82m-v1.0-ff_siwis");
    expect(ALEXA_TTS_VOICE).toBe("ff_siwis");

    expect(MODELES_VOIX.stt).toMatchObject({
      id: "faster-whisper-small-int8",
      dir: "faster-whisper-small",
      files: [
        { path: "config.json", bytes: 2370, sha256: "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828" },
        { path: "model.bin", bytes: 483546902, sha256: "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671" },
        { path: "tokenizer.json", bytes: 2203239, sha256: "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab" },
        { path: "vocabulary.txt", bytes: 459861, sha256: "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913" },
      ],
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

  it("accepts a complete model directory and rejects one truncated file", async () => {
    const root = mkdtempSync(join(tmpdir(), "mindcare-dossier-"));
    const dossier = join(root, "faster-whisper-small");
    mkdirSync(dossier, { recursive: true });
    const config = JSON.stringify({ model: "synthetic" });
    writeFileSync(join(dossier, "config.json"), config);
    writeFileSync(join(dossier, "model.bin"), "tronque");

    const modele: ModeleDossier = {
      id: "faux-dossier",
      dir: "faster-whisper-small",
      files: [
        { path: "config.json", bytes: Buffer.byteLength(config), sha256: sha256(config) },
        { path: "model.bin", bytes: 483_546_902, sha256: "0".repeat(64) },
      ],
      source: "https://example.invalid/modele",
      revision: "synthetic",
      license: "MIT",
    };

    try {
      await expect(verifierDossierModele(dossier, modele)).rejects.toThrow("configuration: modele");
      const complet: ModeleDossier = {
        ...modele,
        files: [{ path: "config.json", bytes: Buffer.byteLength(config), sha256: sha256(config) }],
      };
      await expect(verifierDossierModele(dossier, complet)).resolves.toBeUndefined();
      const evasion: ModeleDossier = {
        ...modele,
        files: [{ path: "../config.json", bytes: Buffer.byteLength(config), sha256: sha256(config) }],
      };
      await expect(verifierDossierModele(dossier, evasion)).rejects.toThrow("configuration: modele");
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
