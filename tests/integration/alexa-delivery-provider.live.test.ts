import { expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { inferGeneralAlexa } from "@/server/alexa/model-gateway";
import { synthetiserGemini, transcrireGemini } from "@/server/alexa/gemini-voice";

it.skipIf(process.env.MINDCARE_DELIVERY_LIVE !== "1")("real Gemini answer, TTS WAV and French clinical dictation round trip (synthetic audio, no microphone)", async () => {
  process.loadEnvFile(".env");
  const answer = await inferGeneralAlexa("Pourquoi le ciel est-il bleu ?", { timeoutMs: 30000 });
  expect(answer.ok).toBe(true);
  if (answer.ok) expect(answer.model).toBe("gemini-3.5-flash");
  const wav = await synthetiserGemini("Pas d’insomnie. Sertraline, cinquante milligrammes le matin.");
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.length).toBeGreaterThan(1000);
  mkdirSync(".cache/delivery", { recursive: true });
  writeFileSync(".cache/delivery/synthetic-dictation.wav", wav);
  const text = await transcrireGemini(wav.toString("base64"), "fr");
  expect(text).toMatch(/pas d.insomnie/iu);
  expect(text).toMatch(/sertraline/iu);
  expect(text).toMatch(/50|cinquante/iu);
  expect(text).toMatch(/matin/iu);
}, 180000);
