/**
 * The single Kokoro speech queue (`lireReponse`): sentence segmentation,
 * one-ahead prefetch, strict order, one response at a time, STOP.
 * The hardware boundary (HTMLAudioElement, the local voice API) is faked; the
 * queue itself is the real code.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeFunctionStream } = vi.hoisted(() => ({ invokeFunctionStream: vi.fn() }));
vi.mock("@/services/db", () => ({ db: () => ({ invokeFunctionStream }) }));

import { arreterLecture, estLectureInterrompue, estWavValide, lireReponse, segmenterPhrases } from "@/services/jarvis-voix";
import { playbackBusy, setPlaybackBusy } from "@/services/voice-activity";

function wav(): Uint8Array {
  const b = new Uint8Array(48);
  b.set([0x52, 0x49, 0x46, 0x46], 0); b.set([0x57, 0x41, 0x56, 0x45], 8);
  return b;
}
const flux = (bytes: Uint8Array) => ({ ok: true as const, data: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }) });

class FauxAudio {
  static instances: FauxAudio[] = [];
  static enCours = 0;
  static maxSimultane = 0;
  volume = 0; muted = true; joue = false;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onpause: (() => void) | null = null;
  constructor(readonly url: string) { FauxAudio.instances.push(this); }
  async play(): Promise<void> {
    this.joue = true; FauxAudio.enCours++; FauxAudio.maxSimultane = Math.max(FauxAudio.maxSimultane, FauxAudio.enCours);
    queueMicrotask(() => this.onplaying?.());
  }
  pause(): void { if (this.joue) { this.joue = false; FauxAudio.enCours--; } this.onpause?.(); }
  finir(): void { if (this.joue) { this.joue = false; FauxAudio.enCours--; } this.onended?.(); }
}

/** Each synthesis request waits until the test releases it, so prefetch timing is observable. */
function syntheseControlee() {
  const demandes: { texte: string; signal: AbortSignal; liberer: () => void }[] = [];
  invokeFunctionStream.mockImplementation((_route: string, corps: { texte: string }, signal: AbortSignal) =>
    new Promise((resolve) => { demandes.push({ texte: corps.texte, signal, liberer: () => resolve(flux(wav())) }); }));
  return demandes;
}

const attendre = () => new Promise((r) => setTimeout(r, 0));
const TROIS = "Voici la première phrase de la réponse. Puis vient une deuxième phrase complète. Et enfin la troisième et dernière phrase.";

afterEach(() => {
  arreterLecture(); setPlaybackBusy(false); invokeFunctionStream.mockReset();
  FauxAudio.instances = []; FauxAudio.enCours = 0; FauxAudio.maxSimultane = 0;
  vi.unstubAllGlobals();
});

describe("segmentation", () => {
  it("keeps a dosage's decimal dot, keeps order, and joins tiny fragments", () => {
    expect(segmenterPhrases("Sertraline 0.5 mg le matin. Oui. Puis réévaluer dans deux semaines.")).toEqual([
      "Sertraline 0.5 mg le matin.",
      "Oui. Puis réévaluer dans deux semaines.",
    ]);
    expect(segmenterPhrases(TROIS)).toHaveLength(3);
    expect(segmenterPhrases("  \n ")).toEqual([]);
  });
  it("never yields a segment above the synthesizer cap", () => {
    for (const s of segmenterPhrases("mot ".repeat(2_000))) expect(s.length).toBeLessThanOrEqual(2_000);
  });
  it("accepts only a RIFF/WAVE body with samples", () => {
    expect(estWavValide(wav().buffer)).toBe(true);
    expect(estWavValide(new Uint8Array(44).buffer)).toBe(false);
    expect(estWavValide(new Uint8Array(100).buffer)).toBe(false);
  });
});

describe("lireReponse", () => {
  it("plays sentences in order, synthesizing the next one while the current one plays, never two at once", async () => {
    vi.stubGlobal("Audio", FauxAudio);
    const demandes = syntheseControlee();
    const lecture = lireReponse(TROIS);
    await attendre();
    expect(demandes.map((d) => d.texte)).toEqual(["Voici la première phrase de la réponse."]);
    demandes[0]!.liberer(); await attendre(); await attendre();
    // Sentence 1 plays; sentence 2 is already being synthesized (prefetch), not 3.
    expect(FauxAudio.instances).toHaveLength(1);
    expect(demandes).toHaveLength(2);
    expect(playbackBusy()).toBe(true);
    demandes[1]!.liberer(); await attendre();
    expect(FauxAudio.instances).toHaveLength(1); // waits for the end of sentence 1
    FauxAudio.instances[0]!.finir(); await attendre(); await attendre();
    expect(FauxAudio.instances).toHaveLength(2);
    expect(demandes).toHaveLength(3);
    expect(playbackBusy()).toBe(true); // no flicker between sentences
    demandes[2]!.liberer(); FauxAudio.instances[1]!.finir(); await attendre(); await attendre();
    FauxAudio.instances[2]!.finir();
    expect((await lecture).ok).toBe(true);
    expect(FauxAudio.maxSimultane).toBe(1);
    expect(playbackBusy()).toBe(false);
  });

  it("STOP silences at once, cancels the pending synthesis, plays nothing more, and is idempotent", async () => {
    vi.stubGlobal("Audio", FauxAudio);
    const demandes = syntheseControlee();
    const lecture = lireReponse(TROIS);
    await attendre(); demandes[0]!.liberer(); await attendre(); await attendre();
    expect(FauxAudio.instances[0]!.joue).toBe(true);
    arreterLecture(); arreterLecture();
    const resultat = await lecture;
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(estLectureInterrompue(resultat.error)).toBe(true);
    expect(FauxAudio.instances[0]!.joue).toBe(false);
    expect(demandes[1]!.signal.aborted).toBe(true);
    demandes[1]!.liberer(); await attendre();
    expect(FauxAudio.instances).toHaveLength(1);
    expect(playbackBusy()).toBe(false);
  });

  it("a new response replaces the one playing: one response at a time", async () => {
    vi.stubGlobal("Audio", FauxAudio);
    const demandes = syntheseControlee();
    const premiere = lireReponse(TROIS);
    await attendre(); demandes[0]!.liberer(); await attendre(); await attendre();
    const seconde = lireReponse("Une autre réponse, entièrement différente.");
    expect((await premiere).ok).toBe(false);
    await attendre(); demandes.at(-1)!.liberer(); await attendre(); await attendre();
    FauxAudio.instances.at(-1)!.finir();
    expect((await seconde).ok).toBe(true);
    expect(FauxAudio.maxSimultane).toBe(1);
  });

  it("names a synthesis that returns no valid audio; it never claims speech", async () => {
    vi.stubGlobal("Audio", FauxAudio);
    invokeFunctionStream.mockResolvedValue(flux(new Uint8Array(44)));
    const resultat = await lireReponse("Bonjour docteur, voici la réponse.");
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(estLectureInterrompue(resultat.error)).toBe(false);
    expect(FauxAudio.instances).toHaveLength(0);
    expect(playbackBusy()).toBe(false);
  });

  it("stops when the caller's own cancellation turns true between sentences", async () => {
    vi.stubGlobal("Audio", FauxAudio);
    const demandes = syntheseControlee();
    let annule = false;
    const lecture = lireReponse(TROIS, () => annule);
    await attendre(); demandes[0]!.liberer(); await attendre(); await attendre();
    annule = true; demandes[1]!.liberer(); FauxAudio.instances[0]!.finir();
    const resultat = await lecture;
    expect(resultat.ok).toBe(false);
    expect(FauxAudio.instances).toHaveLength(1);
  });
});
