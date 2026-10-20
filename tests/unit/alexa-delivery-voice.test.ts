import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { interaction } = vi.hoisted(() => ({ interaction: vi.fn() }));
vi.mock("@/server/egress/external-call", () => ({ appelGeminiInteraction: interaction }));
vi.mock("@/server/env", () => ({ env: () => ({ GEMINI_API_KEY: "synthetic-test-key" }) }));
import { envelopperWav, synthetiserGemini, transcrireGemini } from "@/server/alexa/gemini-voice";
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "completed", steps: [] }))));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
it("uses Transcribe interactions and preserves the transcript", async () => {
  interaction.mockResolvedValue({ text: "Pas d’insomnie. Sertraline 50 mg.", audio: null });
  expect(await transcrireGemini("AAAA", "auto")).toBe("Pas d’insomnie. Sertraline 50 mg.");
  expect(interaction).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-3.5-transcribe", audio: "AAAA" }));
});
it("returns the provider WAV intact without wrapping an existing header", async () => {
  const wav = envelopperWav(Buffer.alloc(32), 24000);
  interaction.mockResolvedValue({ text: "", audio: { data: wav.toString("base64"), mimeType: "audio/wav" } });
  expect(await synthetiserGemini("Bonjour.")).toEqual(wav);
  expect(interaction).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-3.8-flash-tts", text: "Bonjour.", voice: "Kore" }));
});
it("refuses an empty transcription and malformed audio", async () => {
  interaction.mockResolvedValue({ text: "", audio: null });
  await expect(transcrireGemini("AAAA", "auto")).rejects.toThrow();
  interaction.mockResolvedValue({ text: "", audio: { data: "AAAA", mimeType: "audio/wav" } });
  await expect(synthetiserGemini("Bonjour.")).rejects.toThrow();
});
