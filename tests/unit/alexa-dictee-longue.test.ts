import { describe, expect, it } from "vitest";

import { decouperDictee } from "@/services/jarvis-voix";

const TAUX = 16_000;
/** Speech-like noise with silent gaps at the given seconds. */
function dictee(secondes: number, pauses: readonly number[]): Float32Array {
  const s = new Float32Array(secondes * TAUX);
  let x = 1;
  for (let i = 0; i < s.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s[i] = (x / 0x7fffffff - 0.5) * 0.4; }
  for (const p of pauses) s.fill(0, Math.floor(p * TAUX), Math.floor((p + 0.3) * TAUX));
  return s;
}

describe("long consultation dictation", () => {
  it("leaves a note under 28 s whole", () => {
    const parties = decouperDictee(dictee(12, []), TAUX);
    expect(parties).toHaveLength(1);
    expect(parties[0]!.length).toBe(12 * TAUX);
  });

  it("cuts a 70 s note in the pauses, every piece within Whisper's window, no sample lost or repeated", () => {
    const note = dictee(70, [23, 47.5]);
    const parties = decouperDictee(note, TAUX);
    expect(parties.length).toBe(3);
    for (const p of parties) expect(p.length).toBeLessThanOrEqual(28 * TAUX);
    expect(parties.reduce((n, p) => n + p.length, 0)).toBe(note.length);
    const coupe1 = parties[0]!.length / TAUX, coupe2 = (parties[0]!.length + parties[1]!.length) / TAUX;
    expect(coupe1).toBeGreaterThanOrEqual(23); expect(coupe1).toBeLessThanOrEqual(23.3);
    expect(coupe2).toBeGreaterThanOrEqual(47.5); expect(coupe2).toBeLessThanOrEqual(47.8);
  });

  it("still cuts a note with no pause at all, at most every 28 s", () => {
    const parties = decouperDictee(dictee(90, []), TAUX);
    expect(parties.length).toBeGreaterThanOrEqual(4);
    for (const p of parties) expect(p.length).toBeLessThanOrEqual(28 * TAUX);
    expect(parties.reduce((n, p) => n + p.length, 0)).toBe(90 * TAUX);
  });
});
