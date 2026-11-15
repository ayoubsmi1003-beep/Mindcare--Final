/**
 * Barge-in on REAL speech waveforms (committed synthetic fixtures), through the
 * real conversation loop. Only the microphone frames and the speaker are fake:
 * the speaker "plays" a WAV in step with the frames fed to the microphone, and
 * the microphone hears that playback attenuated (the echo) plus, later, a voice.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { creerBoucleVoixLocale, type TrameVoix } from "@/shared/alexa/voice-loop";

const FIX = join(import.meta.dirname, "..", "fixtures", "voix");
const pcm = (nom: string) => { const b = readFileSync(join(FIX, nom)).subarray(44); const s = new Float32Array(b.length / 2); for (let i = 0; i < s.length; i++) s[i] = b.readInt16LE(i * 2) / 32768; return s; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const rms = (s: Float32Array) => Math.sqrt(s.reduce((n, v) => n + v * v, 0) / s.length);

/** `reference`: give the loop the speaker envelope, as the app does (`enveloppeLecture`). */
function piece(reference: boolean) {
  let micro: (f: TrameVoix) => void = () => {};
  let parle = false, coupe = false, position = 0;
  const joue = pcm("commande.wav"); // what Alexa's speaker emits, looped
  const loop = creerBoucleVoixLocale({
    ouvrir: async (r) => { micro = r; return () => {}; },
    transcrire: async () => "Et les doses ?",
    repondre: async () => ({ texte: "Vous avez trois rendez-vous demain. Le premier est à neuf heures." }),
    lire: (_t, signal, playing) => new Promise<void>((_, reject) => { parle = true; position = 0; playing(); signal.addEventListener("abort", () => { parle = false; coupe = true; reject(new Error("cancelled")); }); }),
    couper: () => {}, phase: () => {}, tour: () => {},
    ...(reference ? {
      echoReference: () => {
        if (!parle) return null;
        let max = 0; // loudest 20 ms block over the last 300 ms, like enveloppeLecture
        for (let b = 0; b <= 15; b++) { const o = ((position - b * 320) % joue.length + joue.length) % joue.length; max = Math.max(max, rms(joue.subarray(o, o + 320))); }
        return max;
      },
    } : {}),
  });
  /** The microphone hears `gain` x the playback (when Alexa speaks) plus `voix`. */
  const entendre = (ms: number, gain: number, voix?: Float32Array) => {
    for (let k = 0; k < ms / 20; k++) {
      const f = new Float32Array(320);
      for (let i = 0; i < 320; i++) f[i] = (parle ? gain * (joue[(position + i) % joue.length] ?? 0) : 0) + (voix?.[k * 320 + i] ?? 0);
      if (parle) position += 320;
      micro({ samples: f, sampleRate: 16_000 });
    }
  };
  const dire = (s: Float32Array) => { for (let o = 0; o + 320 <= s.length; o += 320) micro({ samples: s.slice(o, o + 320), sampleRate: 16_000 }); };
  return { loop, entendre, dire, parle: () => parle, coupe: () => coupe };
}

async function enConversationQuiParle(reference: boolean) {
  const p = piece(reference);
  await p.loop.demarrer();
  p.dire(pcm("commande.wav")); p.dire(new Float32Array(16_000)); await flush(); await flush();
  expect(p.parle()).toBe(true);
  return p;
}

// Without the speaker reference (never the case in the app: `enveloppeLecture`
// is always wired) the gate is deliberately conservative: only a voice clearly
// louder than the loudest echo interrupts; anything quieter uses STOP.
describe.each([["with the speaker reference", true, 1], ["without a reference (fallback)", false, 2]] as const)("barge-in on real waveforms, %s", (_nom, reference, voixGain) => {
  it("Alexa's own echo, even loud (40 %), never interrupts her over many seconds", async () => {
    const p = await enConversationQuiParle(reference);
    p.entendre(8_000, 0.4);
    expect(p.parle()).toBe(true);
  });

  it("the doctor speaking over the echo interrupts at once", async () => {
    const p = await enConversationQuiParle(reference);
    p.entendre(1_500, 0.15);
    p.entendre(2_000, 0.15, pcm("bonjour.wav").map((v) => v * voixGain));
    expect(p.coupe()).toBe(true);
  });

  it("a short word over the echo interrupts too", async () => {
    const p = await enConversationQuiParle(reference);
    p.entendre(1_500, 0.15);
    p.entendre(1_500, 0.15, pcm("alexia.wav").map((v) => v * voixGain));
    expect(p.coupe()).toBe(true);
  });
});
