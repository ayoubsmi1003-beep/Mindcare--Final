import { describe, expect, it } from "vitest";

import { creerTracesVoix } from "@/shared/alexa/voice-trace";

describe("voice timing traces", () => {
  it("measures each stage per interaction and reports P50 / P95 / max", () => {
    let t = 0;
    const traces = creerTracesVoix(() => t);
    for (const decalage of [0, 100, 200]) {
      t = 1_000 + decalage; traces.marquer("onset");
      t += 300; traces.marquer("premierPartiel");
      t += 1_000; traces.marquer("finParole");
      t += 2_000 + decalage; traces.marquer("final");
      traces.marquer("tourEnvoye"); t += 1_500; traces.marquer("tourRecu");
      t += 800; traces.marquer("lectureDebut");
    }
    const r = traces.rapport();
    expect(r.premierPartiel).toEqual({ n: 3, p50: 300, p95: 300, max: 300 });
    expect(r.transcriptionFinale).toMatchObject({ n: 3, p50: 2_100, max: 2_200 });
    expect(r.kokoroPremierSon).toMatchObject({ p50: 800 });
    expect(r.reponseTotale).toMatchObject({ p50: 4_400 });
    expect(r.interruption).toBeNull();
  });
  it("keeps a bounded history and stores only timestamps", () => {
    const traces = creerTracesVoix(() => 1, 5);
    for (let i = 0; i < 12; i++) traces.marquer("onset");
    expect(traces.traces()).toHaveLength(5);
    expect(JSON.stringify(traces.traces())).toMatch(/^[\[\]{}",:a-zA-Z0-9]*$/);
  });
  it("a first mark never moves: the earliest timestamp of a stage wins", () => {
    let t = 10; const traces = creerTracesVoix(() => t);
    traces.marquer("onset"); traces.marquer("premierPartiel"); t = 50; traces.marquer("premierPartiel");
    expect(traces.traces()[0]!.marques.premierPartiel).toBe(10);
  });
});
