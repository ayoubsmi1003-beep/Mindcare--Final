/**
 * END-TO-END VOICE PIPELINE ON THE REAL ENGINES — no microphone, no speaker.
 *
 *   $env:MINDCARE_VOICE_REAL="1"; pnpm vitest run tests/integration/alexa-voice-pipeline-real.test.ts
 *
 * Real: the conversation loop (VAD, endpointing, partial streaming, barge-in,
 * echo guard, STOP), Vosk live partials, Faster-Whisper final text, Kokoro
 * synthesis — the same server runtimes the app calls.
 * Simulated, and only these: the HARDWARE boundary (20 ms microphone frames
 * fed from synthetic speech; a speaker that "plays" a Kokoro WAV for its real
 * duration) and Alexa's reasoning (a fixed answer: the clinical turn has its
 * own suites and needs the database and the model).
 *
 * Speech is Kokoro-synthesized at run time (never stored): it proves the
 * chain, not accuracy on a human voice.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { creerBoucleVoixLocale, type PhaseVoixLocale, type TourVoix } from "@/shared/alexa/voice-loop";
import { encoderPCM16 } from "@/shared/jarvis/pcm";
import { arreterVoixNative, demanderVoixNative, preparerVoixNative } from "@/server/voice/runtime";
import { arreterReveil, demanderReveil, preparerReveil } from "@/server/voice/wake-runtime";
import { decouperDictee } from "@/services/jarvis-voix";

const REEL = process.env["MINDCARE_VOICE_REAL"] === "1";
const SESSION = "b".repeat(64);
process.env["MINDCARE_DATABASE_URL"] ??= "postgresql://synthetic:unused@127.0.0.1:1/synthetic";
process.env["ALEXA_LOCAL_VOICE"] ??= "true";

const b64 = (s: Float32Array) => Buffer.from(encoderPCM16([s], 16_000)).toString("base64");
const ids = () => ({ id: crypto.randomUUID(), sessionId: SESSION, runId: crypto.randomUUID(), utteranceId: crypto.randomUUID() });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function wav16k(base64: string): Float32Array {
  const buf = Buffer.from(base64, "base64");
  let o = 12, rate = 0, data = Buffer.alloc(0);
  while (o + 8 <= buf.length) {
    const id = buf.toString("ascii", o, o + 4), n = buf.readUInt32LE(o + 4);
    if (id === "fmt ") rate = buf.readUInt32LE(o + 12);
    if (id === "data") data = buf.subarray(o + 8, o + 8 + n);
    o += 8 + n + (n % 2);
  }
  const src = new Float32Array(data.length / 2);
  for (let i = 0; i < src.length; i++) src[i] = data.readInt16LE(i * 2) / 32768;
  const ratio = rate / 16_000, out = new Float32Array(Math.floor(src.length / ratio));
  for (let i = 0; i < out.length; i++) { const k = Math.floor(i * ratio); out[i] = ((src[k] ?? 0) + (src[k + 1] ?? 0)) / 2; }
  return out;
}
async function kokoro(texte: string): Promise<Float32Array> {
  const r = await demanderVoixNative({ ...ids(), action: "tts", texte, langue: "fr" });
  return wav16k(r.audioBase64!);
}
const mots = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").match(/\p{L}+/gu) ?? [];

/** The simulated room: microphone frames in (20 ms, optional real-time pacing), speaker out. */
function piece() {
  let micro: ((f: { samples: Float32Array; sampleRate: number }) => void) | null = null;
  const phases: PhaseVoixLocale[] = [], tours: TourVoix[] = [], apercus: (string | null)[] = [];
  const joue: string[] = [];
  let enLecture: { fin: () => void; couper: () => void } | null = null;
  // What the speaker is emitting, and how far into it the microphone has heard.
  let enCours: Float32Array | null = null, position = 0;
  const bloc = (s: Float32Array, o: number) => { let p = 0; for (let i = o; i < o + 320 && i < s.length; i++) p += s[i]! * s[i]!; return Math.sqrt(p / 320); };
  const loop = creerBoucleVoixLocale({
    ouvrir: async (recevoir) => { micro = recevoir; return () => { micro = null; }; },
    partiel: async (samples, _rate, reset, signal) => {
      if (reset) await demanderReveil(SESSION, "partial-reset", undefined, signal);
      return (await demanderReveil(SESSION, "partial", b64(samples), signal)).texte ?? "";
    },
    apercu: (t) => { apercus.push(t); },
    transcrire: async (samples, _rate, signal) => {
      // Same contract as the app (alexa-local): nothing intelligible is not a failure.
      try { return (await demanderVoixNative({ ...ids(), action: "stt", pcmBase64: b64(samples), sampleRate: 16_000, langue: "fr" }, signal)).texte ?? ""; }
      catch (cause) { if (cause instanceof Error && (cause.message === "silence" || cause.message === "confiance")) return ""; throw cause; }
    },
    repondre: async (texte) => ({ texte: /doses/i.test(texte)
      ? "La dose est de cinquante milligrammes le matin."
      : "Vous avez trois rendez-vous demain. Le premier est à neuf heures. Le deuxième est à onze heures trente. Le troisième est à quinze heures, en téléconsultation.",
    speechAllowed: true }),
    // The speaker: real Kokoro audio, "played" for its true duration.
    lire: async (texte, signal, playing) => {
      const audio = await kokoro(texte);
      if (signal.aborted) throw new Error("cancelled");
      joue.push(texte); enCours = audio; position = 0; playing();
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { enLecture = null; enCours = null; resolve(); }, (audio.length / 16_000) * 1000);
        const couper = () => { clearTimeout(t); enLecture = null; enCours = null; reject(new Error("cancelled")); };
        enLecture = { fin: resolve, couper };
        signal.addEventListener("abort", couper, { once: true });
      });
    },
    couper: () => { enLecture?.couper(); },
    // The app wires `enveloppeLecture`; here: the loudest 20 ms block of the last 300 ms played.
    echoReference: () => {
      if (enCours === null) return null;
      let max = 0;
      for (let b = 0; b <= 15; b++) max = Math.max(max, bloc(enCours, Math.max(0, position - b * 320)));
      return max;
    },
    phase: (p) => { phases.push(p); },
    tour: (t) => { tours.push(t); },
  });
  return {
    loop, phases, tours, apercus, joue,
    parle: () => enLecture !== null,
    stop: () => enLecture?.couper(),
    /** Feeds 16 kHz audio as 20 ms frames; `tempsReel` paces them like a microphone. */
    async dire(samples: Float32Array, tempsReel = true) {
      for (let o = 0; o < samples.length; o += 320) {
        micro?.({ samples: samples.slice(o, o + 320), sampleRate: 16_000 });
        if (tempsReel) await pause(20); else if (o % 3200 === 0) await pause(0);
      }
    },
    silence: (ms: number) => new Float32Array(Math.round(ms * 16)),
    /** The microphone hears `gain` x what the speaker plays now, plus an optional voice. */
    async entendre(ms: number, gain: number, voix?: Float32Array) {
      for (let k = 0; k < ms / 20; k++) {
        const f = new Float32Array(320);
        for (let i = 0; i < 320; i++) f[i] = (enCours ? gain * (enCours[position + i] ?? 0) : 0) + (voix?.[k * 320 + i] ?? 0);
        if (enCours) position += 320;
        micro?.({ samples: f, sampleRate: 16_000 });
        await pause(20);
      }
    },
  };
}
async function attendre(cond: () => boolean, ms: number) {
  const fin = Date.now() + ms;
  while (!cond()) { if (Date.now() > fin) throw new Error("timeout"); await pause(50); }
}

describe.skipIf(!REEL)("voice pipeline on the real engines (hardware boundary simulated)", () => {
  let question: Float32Array, suivi: Float32Array;
  beforeAll(async () => {
    await preparerVoixNative(SESSION);
    await preparerReveil(SESSION); // the app warms the live-transcript recognizer when the conversation opens
    question = await kokoro("Quels sont les rendez-vous de demain ?");
    // "Et les doses ?" alone is misheard by Whisper small in this synthetic voice
    // (ALEXA_STT_BENCHMARK.md); the pipeline, not that phrase, is under test here.
    suivi = await kokoro("Quelles sont les doses actuelles ?");
  }, 600_000);
  afterAll(() => { arreterVoixNative(SESSION); arreterReveil(SESSION); });

  it("A + D: live words while speaking, final text, spoken answer, then a follow-up with no microphone restart", async () => {
    const p = piece();
    await p.loop.demarrer();
    await p.dire(question); await p.dire(p.silence(900));
    await attendre(() => p.joue.length > 0, 300_000);
    // A: live partials appeared while she was still speaking, then were withdrawn for the final text.
    expect(p.apercus.some((t) => t !== null && mots(t).length > 0)).toBe(true);
    expect(p.apercus.at(-1)).toBeNull();
    const premier = p.tours.find((t) => t.reponse === undefined)!;
    expect(mots(premier.texte)).toEqual(expect.arrayContaining(["rendez", "demain"]));
    expect(p.phases).toEqual(expect.arrayContaining(["voixDetectee", "transcription", "traitement", "parole"]));
    await attendre(() => p.phases.at(-1) === "ecoute" && !p.parle(), 300_000);
    // D: the follow-up is captured by the same open conversation.
    await p.dire(suivi); await p.dire(p.silence(900));
    await attendre(() => p.tours.filter((t) => t.reponse !== undefined).length === 2, 300_000);
    expect(mots(p.tours.filter((t) => t.reponse === undefined).at(-1)!.texte)).toContain("doses");
    expect(p.loop.active()).toBe(true);
    p.loop.arreter();
  }, 900_000);

  it("E: STOP silences a long answer at once, keeps its text, and the conversation listens again", async () => {
    const p = piece();
    await p.loop.demarrer();
    await p.dire(question, false); await p.dire(p.silence(900), false);
    await attendre(() => p.parle(), 300_000);
    const t = performance.now(); p.stop(); const msStop = performance.now() - t;
    expect(p.parle()).toBe(false);
    expect(msStop).toBeLessThan(50);
    await attendre(() => p.phases.at(-1) === "ecoute", 10_000);
    expect(p.tours.at(-1)!.reponse).toMatch(/trois rendez-vous/);
    expect(p.phases).not.toContain("erreur");
    p.loop.arreter();
  }, 900_000);

  it("F: her voice over Alexa's interrupts; Alexa's own echo alone never does", async () => {
    const p = piece();
    await p.loop.demarrer();
    await p.dire(question, false); await p.dire(p.silence(900), false);
    await attendre(() => p.parle(), 300_000);
    // Echo: what the speaker really plays, leaking into the microphone at 15 %, for 3 s.
    await p.entendre(3_000, 0.15);
    expect(p.parle()).toBe(true);
    // Then the doctor speaks over it.
    await p.entendre(suivi.length / 16, 0.15, suivi);
    expect(p.parle()).toBe(false);
    await p.dire(p.silence(900));
    await attendre(() => p.tours.filter((t) => t.reponse !== undefined).length === 2, 300_000);
    expect(mots(p.tours.filter((t) => t.reponse === undefined).at(-1)!.texte)).toContain("doses");
    p.loop.arreter();
  }, 900_000);

  it("H: a consultation note longer than Whisper's 30 s window is transcribed whole, in order", async () => {
    // Two dictated paragraphs separated by a natural pause, like a real note.
    const premier = await kokoro(
      "Patiente vue ce matin pour un suivi de trouble anxieux généralisé. Elle décrit une amélioration du sommeil depuis trois semaines. " +
      "Les ruminations du soir persistent mais sont moins intenses. Pas d'idées suicidaires, pas de conduites à risque. " +
      "Le traitement par sertraline est bien toléré, sans nausées ni céphalées. L'appétit est conservé et le poids est stable.",
    );
    const second = await kokoro(
      "Elle a repris le travail à mi-temps et souhaite poursuivre la psychothérapie hebdomadaire. Son entourage la soutient. " +
      "Elle pratique la marche chaque jour et a réduit sa consommation de café. " +
      "Nous convenons de maintenir la même posologie et de revoir la patiente dans un mois.",
    );
    const note = new Float32Array(premier.length + 9_600 + second.length);
    note.set(premier); note.set(second, premier.length + 9_600);
    expect(note.length / 16_000).toBeGreaterThan(30);
    const parties = decouperDictee(note, 16_000);
    expect(parties.length).toBeGreaterThan(1);
    const textes: string[] = [];
    for (const partie of parties) {
      try { textes.push((await demanderVoixNative({ ...ids(), action: "stt", pcmBase64: b64(partie), sampleRate: 16_000, langue: "fr" })).texte ?? ""); }
      catch (cause) { if (!(cause instanceof Error && (cause.message === "silence" || cause.message === "confiance"))) throw cause; }
    }
    const tout = mots(textes.join(" "));
    // Words from the beginning, the middle and the end, in that order.
    const positions = ["sommeil", "sertraline", "psychotherapie", "mois"].map((m) => tout.findIndex((w) => w.startsWith(m)));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  }, 900_000);

  it("G: a voice engine that cannot start is reported, nothing stays stuck, and voice recovers", async () => {
    const python = process.env["ALEXA_VOICE_PYTHON"];
    arreterVoixNative(SESSION);
    process.env["ALEXA_VOICE_PYTHON"] = "C:\\introuvable\\python.exe";
    const p = piece();
    try {
      await p.loop.demarrer();
      await p.dire(question, false); await p.dire(p.silence(900), false);
      await attendre(() => p.phases.at(-1) === "erreur", 60_000);
      expect(p.loop.active()).toBe(false);
      // No transcript exists: no user bubble; the error phase (with its reason) is what the doctor sees.
      expect(p.tours).toHaveLength(0);
    } finally {
      if (python === undefined) delete process.env["ALEXA_VOICE_PYTHON"]; else process.env["ALEXA_VOICE_PYTHON"] = python;
    }
    const q = piece();
    await q.loop.demarrer();
    await q.dire(suivi, false); await q.dire(q.silence(900), false);
    await attendre(() => q.tours.some((t) => t.reponse !== undefined), 600_000);
    expect(mots(q.tours[0]!.texte)).toContain("doses");
    q.loop.arreter();
  }, 900_000);
});
