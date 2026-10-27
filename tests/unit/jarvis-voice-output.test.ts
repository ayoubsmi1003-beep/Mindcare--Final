import { afterEach, expect, it, vi } from "vitest";

const { invokeFunctionStream } = vi.hoisted(() => ({ invokeFunctionStream: vi.fn() }));
vi.mock("@/services/db", () => ({ db: () => ({ invokeFunctionStream }) }));

import {
  abonnerLecture,
  arreterLecture,
  attendreFinLecture,
  estLectureInterrompue,
  lireTexte,
} from "@/services/jarvis-voix";

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
  vi.useRealTimers();
});

function fluxAudioValide(): { ok: true; data: ReadableStream<Uint8Array> } {
  return {
    ok: true,
    data: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(44));
        controller.close();
      },
    }),
  };
}

it("reads an answer containing a patient name through local voice at full element volume", async () => {
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
  expect(states).toContainEqual([true, "local"]);
  unsubscribe();
});

it("reports a deliberate stop while the synthesis is pending as an interrupted read", async () => {
  let resolveStream!: (value: unknown) => void;
  invokeFunctionStream.mockReturnValue(new Promise((resolve) => { resolveStream = resolve; }));

  const pending = lireTexte("Bonjour docteur.", false);
  // The user presses Stop before the voice route answers.
  arreterLecture();
  resolveStream({
    ok: true,
    data: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(44)); controller.close(); } }),
  });

  const result = await pending;
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a failed read");
  expect(estLectureInterrompue(result.error)).toBe(true);
});

it("keeps a genuine synthesis failure classified as a voice failure", async () => {
  invokeFunctionStream.mockResolvedValue({
    ok: false,
    error: { code: "indisponible", message: "La voix est indisponible." },
  });

  const result = await lireTexte("Bonjour docteur.", false);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a failed read");
  expect(estLectureInterrompue(result.error)).toBe(false);
});

it("waits for the published end of playback, not for the first sound", async () => {
  invokeFunctionStream.mockResolvedValue(fluxAudioValide());
  vi.stubGlobal("Audio", AudioSortieLocale);

  const lecture = await lireTexte("Bonjour docteur.", false);
  expect(lecture.ok).toBe(true);

  let termine = false;
  const attente = attendreFinLecture(10_000).then(() => {
    termine = true;
  });
  await Promise.resolve();
  expect(termine).toBe(false);

  AudioSortieLocale.instances[0]?.onended?.();
  await attente;
  expect(termine).toBe(true);
});

it("resolves after the timeout when no end event arrives", async () => {
  vi.useFakeTimers();
  invokeFunctionStream.mockResolvedValue(fluxAudioValide());
  vi.stubGlobal("Audio", AudioSortieLocale);

  const lecture = await lireTexte("Bonjour docteur.", false);
  expect(lecture.ok).toBe(true);

  let termine = false;
  const attente = attendreFinLecture(5_000).then(() => {
    termine = true;
  });

  await vi.advanceTimersByTimeAsync(4_999);
  expect(termine).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await attente;
  expect(termine).toBe(true);
});
