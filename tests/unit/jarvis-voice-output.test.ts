import { afterEach, expect, it, vi } from "vitest";

const { invokeFunctionStream } = vi.hoisted(() => ({ invokeFunctionStream: vi.fn() }));
vi.mock("@/services/db", () => ({ db: () => ({ invokeFunctionStream }) }));

import { abonnerLecture, arreterLecture, lireTexte } from "@/services/jarvis-voix";

class AudioSortieLocale {
  static instances: AudioSortieLocale[] = [];
  volume = 0;
  muted = true;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onpause: (() => void) | null = null;
  constructor(readonly url: string) { AudioSortieLocale.instances.push(this); }
  async play(): Promise<void> { this.onplaying?.(); }
  pause(): void { this.onpause?.(); }
}

afterEach(() => {
  arreterLecture();
  invokeFunctionStream.mockReset();
  AudioSortieLocale.instances = [];
  vi.unstubAllGlobals();
});

it("reads an answer containing a patient name through local Piper at full element volume", async () => {
  invokeFunctionStream.mockResolvedValue({
    ok: true,
    data: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(44)); controller.close(); } }),
  });
  vi.stubGlobal("Audio", AudioSortieLocale);
  const states: Array<[boolean, string | null]> = [];
  const unsubscribe = abonnerLecture((active, source) => states.push([active, source]));

  const text = "Meriem Benali a deux consultations terminées.";
  const result = await lireTexte(text, true);

  expect(result.ok).toBe(true);
  expect(invokeFunctionStream).toHaveBeenCalledWith("jarvis-voice-out", expect.objectContaining({ texte: text }), expect.any(AbortSignal));
  expect(AudioSortieLocale.instances).toHaveLength(1);
  expect(AudioSortieLocale.instances[0]).toMatchObject({ volume: 1, muted: false });
  expect(states).toContainEqual([true, "piper"]);
  unsubscribe();
});
