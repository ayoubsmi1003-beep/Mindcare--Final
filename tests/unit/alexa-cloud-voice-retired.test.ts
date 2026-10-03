import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  config: { VOICE_PROVIDER: "cloud", GROQ_API_KEY: "synthetic-groq-key", ELEVENLABS_API_KEY: "synthetic-elevenlabs-key" },
  environment: vi.fn(), query: vi.fn(), network: vi.fn(),
}));
vi.mock("@/server/env", () => ({ env: () => { controls.environment(); return controls.config; } }));
vi.mock("@/server/db/withCaller", () => ({
  withCaller: async (_actor: string | null, fn: (q: unknown) => unknown) => fn({ query: controls.query }),
  withEgressGate: async (fn: (q: unknown) => unknown) => fn({ query: controls.query }),
}));
import { elevenLabsTtsProvider, groqSttProvider, stt, tts } from "@/server/egress/external-call";

const audio = new Uint8Array([0, 0, 0, 0]);
const sessionToken = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  controls.query.mockImplementation(async (sql: string) => sql.includes("is_cloud_dev") ? [{ cloud: true }] : []);
  controls.network.mockImplementation(async (url: string) => url.includes("groq")
    ? Response.json({ text: "synthetic transcript" }) : new Response(audio));
  vi.stubGlobal("fetch", controls.network);
});
afterEach(() => vi.unstubAllGlobals());

function expectNoExternalWork() {
  expect(controls.environment).not.toHaveBeenCalled();
  expect(controls.query).not.toHaveBeenCalled();
  expect(controls.network).not.toHaveBeenCalled();
}

describe.each(["cloud", "local"])("retired cloud voice with %s configuration", (mode) => {
  beforeEach(() => { controls.config.VOICE_PROVIDER = mode; });

  it("refuses the legacy STT entry before configuration, database or audio transmission", async () => {
    const result = await stt({ audio, mimeType: "audio/wav", sessionToken });
    expect(result).toMatchObject({ ok: false, error: { code: "configuration" } });
    expectNoExternalWork();
  });

  it("refuses the legacy TTS entry before configuration, database or text transmission", async () => {
    const result = await tts({ text: "synthetic medical text", voiceId: "synthetic-voice", sessionToken });
    expect(result).toMatchObject({ ok: false, error: { code: "configuration" } });
    expectNoExternalWork();
  });

  it("also blocks a direct exported Groq provider call", async () => {
    await expect(groqSttProvider.transcribe({ audio, mimeType: "audio/wav", language: "fr",
      model: "whisper-large-v3-turbo", timeoutMs: 1000 })).rejects.toThrow("configuration: voix-cloud-retiree");
    expectNoExternalWork();
  });

  it("also blocks a direct exported ElevenLabs provider call", async () => {
    await expect(elevenLabsTtsProvider.synthesize({ text: "synthetic medical text", voiceId: "synthetic-voice",
      model: "eleven_multilingual_v2", timeoutMs: 1000 })).rejects.toThrow("configuration: voix-cloud-retiree");
    expectNoExternalWork();
  });
});

describe("legacy voice provider injection cannot bypass retirement", () => {
  beforeEach(() => { controls.config.VOICE_PROVIDER = "cloud"; });

  it("refuses an injected STT provider without calling it", async () => {
    const transcribe = vi.fn(async () => ({ text: "synthetic transcript" }));
    expect((await stt({ audio, mimeType: "audio/wav", sessionToken }, { name: "other", transcribe })).ok).toBe(false);
    expect(transcribe).not.toHaveBeenCalled();
    expectNoExternalWork();
  });

  it("refuses an injected TTS provider without calling it", async () => {
    const synthesize = vi.fn(async () => ({ audio, mimeType: "audio/wav" }));
    expect((await tts({ text: "synthetic text", voiceId: "synthetic-voice", sessionToken }, { name: "other", synthesize })).ok).toBe(false);
    expect(synthesize).not.toHaveBeenCalled();
    expectNoExternalWork();
  });
});
