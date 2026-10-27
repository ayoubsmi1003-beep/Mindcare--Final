import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { resoudreCheminsVoix } from "@/server/voice/chemins";
import { arreterVoixNative, demanderVoixNative, preparerVoixNative, statutVoixNative } from "@/server/voice/runtime";

/**
 * Real inference proof. Skipped unless `MINDCARE_VOICE_REAL=1` so the default
 * `pnpm test` never loads the 484 MB model.
 *
 * Run: $env:MINDCARE_VOICE_REAL="1"; pnpm vitest run tests/integration/alexa-voice-final.test.ts
 *
 * Fixtures are synthetic (local Kokoro voice), never patient recordings:
 *   - bonjour.wav  → "Bonjour."
 *   - commande.wav → "Quel est le prochain patient ?"
 *   - silence.wav  → 2 s of digital zeros (must be refused as silence)
 */
const REEL = process.env["MINDCARE_VOICE_REAL"] === "1";
const SESSION = "a".repeat(64);
const RUN = "00000000-0000-4000-8000-000000000001";
const UTTERANCE = "00000000-0000-4000-8000-000000000002";
const ROOT = join(import.meta.dirname, "..", "..");
const FIXTURES = join(ROOT, "tests", "fixtures", "voix");
const CHEMIN = resoudreCheminsVoix({ cwd: ROOT, env: process.env });

process.env["MINDCARE_DATABASE_URL"] ??= "postgresql://synthetic:unused@127.0.0.1:1/synthetic";
process.env["ALEXA_LOCAL_VOICE"] ??= "true";
process.env["ALEXA_VOICE_HEALTH"] ??= "1";

afterAll(() => {
  if (REEL) arreterVoixNative();
});

/**
 * Read the PCM half of a fixture and reject a file that violates the contract
 * every voice fixture must meet: 16 kHz mono PCM16, non-empty, under 5 s.
 */
function pcmDuFixture(nom: string): string {
  const path = join(FIXTURES, nom);
  const wav = readFileSync(path);
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`FIXTURE VOIX FAIL: ${nom} n'est pas un fichier RIFF/WAVE`);
  }
  let format: { codec: number; canaux: number; taux: number; bits: number } | null = null;
  let data: Buffer | null = null;
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const taille = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      format = {
        codec: wav.readUInt16LE(offset + 8),
        canaux: wav.readUInt16LE(offset + 10),
        taux: wav.readUInt32LE(offset + 12),
        bits: wav.readUInt16LE(offset + 22),
      };
    }
    if (id === "data") {
      data = wav.subarray(offset + 8, offset + 8 + taille);
      break;
    }
    offset += 8 + taille + (taille % 2);
  }
  expect(format, `FIXTURE VOIX FAIL: ${nom} doit être 16 kHz mono PCM16`).toEqual({
    codec: 1,
    canaux: 1,
    taux: 16_000,
    bits: 16,
  });
  if (data === null || data.length === 0) throw new Error(`FIXTURE VOIX FAIL: ${nom} n'a pas de données`);
  const duree = data.length / (16_000 * 2);
  expect(duree, `FIXTURE VOIX FAIL: ${nom} doit durer moins de 5 s`).toBeLessThan(5);
  return data.toString("base64");
}

describe.skipIf(!REEL)("real local speech worker (faster-whisper small int8)", () => {
  it(
    "loads the pinned model once, proves STT/TTS/silence, and survives a restart",
    async () => {
      const debut = Date.now();
      const noter = (etape: string) => {
        console.log(`[voix-preuve] ${etape} — ${((Date.now() - debut) / 1000).toFixed(1)} s`);
      };
      await preparerVoixNative(SESSION);
      noter("worker prêt");
      expect(statutVoixNative()).toMatchObject({
        provider: "local",
        stt: "faster-whisper-small-int8",
        tts: "kokoro-82m-v1.0-ff_siwis",
        voice: "ff_siwis",
        ready: true,
      });

      const bonjour = await demanderVoixNative({
        id: crypto.randomUUID(),
        sessionId: SESSION,
        runId: RUN,
        utteranceId: UTTERANCE,
        action: "stt",
        pcmBase64: pcmDuFixture("bonjour.wav"),
        sampleRate: 16_000,
        langue: "fr",
      });
      expect(bonjour.ok).toBe(true);
      expect(bonjour.model).toBe("faster-whisper-small-int8");
      expect(bonjour.texte?.toLowerCase()).toContain("bonjour");
      noter("STT bonjour");

      // "Quel est le prochain patient ?" — the exact Kokoro transcript is
      // "Quelle est le prochain patient ?"; the assertion is on the command
      // word that matters, not on a spelling variant.
      const commande = await demanderVoixNative({
        id: crypto.randomUUID(),
        sessionId: SESSION,
        runId: RUN,
        utteranceId: UTTERANCE,
        action: "stt",
        pcmBase64: pcmDuFixture("commande.wav"),
        sampleRate: 16_000,
        langue: "fr",
      });
      expect(commande.ok).toBe(true);
      expect(commande.model).toBe("faster-whisper-small-int8");
      expect(commande.texte?.toLowerCase()).toContain("patient");
      noter("STT commande");

      // The committed silence fixture must itself be silent: the worker's
      // refusal must not be the only proof. Exactly 2 s of 16 kHz PCM16 zeros.
      const silence = Buffer.from(pcmDuFixture("silence.wav"), "base64");
      expect(silence.length).toBe(2 * 16_000 * 2);
      expect(silence.equals(Buffer.alloc(silence.length))).toBe(true);

      await expect(
        demanderVoixNative({
          id: crypto.randomUUID(),
          sessionId: SESSION,
          runId: RUN,
          utteranceId: UTTERANCE,
          action: "stt",
          pcmBase64: silence.toString("base64"),
          sampleRate: 16_000,
          langue: "fr",
        }),
      ).rejects.toThrow("silence");
      noter("silence refusé");

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
      const audio = Buffer.from(tts.audioBase64 ?? "", "base64");
      expect(audio.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(audio.length).toBeGreaterThan(44);
      noter("TTS Kokoro");

      // The worker patches the socket class before it imports NumPy,
      // faster-whisper or Kokoro; every STT/TTS call above ran inside that
      // patched process. The embedded interpreter probe proves the exact
      // patch blocks a real connect (no Node `fetch` stub is involved).
      const source = readFileSync(CHEMIN.worker, "utf8");
      const patch = source.indexOf("socket.socket.connect = no_network");
      expect(patch).toBeGreaterThan(-1);
      expect(patch).toBeLessThan(source.indexOf("import numpy as np"));
      expect(patch).toBeLessThan(source.indexOf("from faster_whisper import WhisperModel"));
      expect(patch).toBeLessThan(source.indexOf("from kokoro_onnx import Kokoro"));

      const sonde = [
        "import socket",
        "def no_network(*args, **kwargs):",
        "    raise RuntimeError('network-disabled')",
        "socket.socket.connect = no_network",
        "try:",
        "    socket.create_connection(('127.0.0.1', 1), timeout=1)",
        "except RuntimeError as exc:",
        "    print(str(exc))",
        "else:",
        "    raise SystemExit('socket.connect was not patched')",
      ].join("\n");
      const patche = spawnSync(CHEMIN.python, ["-I", "-c", sonde], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
      });
      expect(patche.error, patche.error?.message).toBeUndefined();
      expect(patche.signal).toBeNull();
      expect(patche.status, patche.stderr).toBe(0);
      expect(patche.stdout.trim()).toBe("network-disabled");
      noter("sonde réseau");

      arreterVoixNative(SESSION);
      await preparerVoixNative(SESSION);
      noter("worker redémarré");
      const encore = await demanderVoixNative({
        id: crypto.randomUUID(),
        sessionId: SESSION,
        runId: RUN,
        utteranceId: UTTERANCE,
        action: "stt",
        pcmBase64: pcmDuFixture("bonjour.wav"),
        sampleRate: 16_000,
        langue: "fr",
      });
      expect(encore.ok).toBe(true);
      expect(encore.texte?.toLowerCase()).toContain("bonjour");
      noter("STT après redémarrage");

      // Measured end-to-end at normal process priority on the reference
      // machine: 208.9 s, i.e. ~31 s of headroom under the 240 s bound below.
      // The worker runtime keeps its own 180 s ready cap, 60 s STT cap and
      // 120 s TTS cap. This whole-test bound is deliberately below the 300 s
      // Vitest timeout so the assertion can actually fire instead of the
      // runner killing the test; the extra runner time only covers startup and
      // teardown around the bounded body, not a model-operation budget.
      expect(Date.now() - debut).toBeLessThan(240_000);
    },
    300_000,
  );
});
