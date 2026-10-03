import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { creerBoucleVoixLocale, type TrameVoix, type PortsVoixLocale, type TourVoix } from "@/shared/alexa/voice-loop";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
function harness(overrides: Partial<PortsVoixLocale> = {}) {
  let receive: (frame: TrameVoix) => void = () => {};
  const calls: string[] = [], signals: AbortSignal[] = [];
  const ports: PortsVoixLocale = {
    ouvrir: async (cb) => { calls.push("capture"); receive = cb; return () => { calls.push("closed"); }; },
    transcrire: async (_samples, _rate, signal) => { calls.push("stt"); signals.push(signal); return "آخر خمس جلسات"; },
    repondre: async (text, signal, sentence) => { calls.push(`turn:${text}`); signals.push(signal); sentence("Une réponse vérifiée."); return { texte: "Une réponse vérifiée." }; },
    lire: async (text, signal) => { calls.push(`tts:${text}`); signals.push(signal); },
    couper: () => { calls.push("stop-playback"); },
    phase: (state) => { calls.push(`state:${state}`); }, tour: (turn) => { calls.push(turn.reponse ? "answer" : "transcript"); },
    ...overrides,
  };
  const loop = creerBoucleVoixLocale(ports);
  const frames = (count: number, value: number) => { for (let i = 0; i < count; i++) receive({ samples: new Float32Array(320).fill(value), sampleRate: 16000 }); };
  return { loop, calls, signals, frames };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe("voice benchmark evidence", () => {
  it("scores supplied transcripts but refuses qualification with insufficient corpus", () => {
    const directory = mkdtempSync(join(tmpdir(), "alexa-voice-eval-"));
    const corpus = join(directory, "corpus.jsonl"), results = join(directory, "results.json"), output = join(directory, "report.json");
    writeFileSync(corpus, [
      { id: "fr-1", language: "fr", synthetic: true, reference: "prendre sertraline demain", medicationNames: ["sertraline"] },
      { id: "ar-1", language: "ar", synthetic: true, reference: "الدواء اليوم" },
      { id: "quiet-1", language: "mixed", synthetic: true, reference: "", kind: "silence" },
    ].map((row) => JSON.stringify(row)).join("\n"));
    writeFileSync(results, JSON.stringify({ schema: 1, engine: "test-only-transcripts", hardware: { cpu: "synthetic", ramGiB: 16 }, rows: [
      { id: "fr-1", text: "prendre sertraline ce soir", latencyMs: 100 },
      { id: "ar-1", text: "الدواء اليوم", latencyMs: 120 },
      { id: "quiet-1", text: "bonjour", latencyMs: 110 },
    ] }));
    try {
      execFileSync(process.execPath, ["scripts/benchmark-alexa-voice.mjs", "--corpus", corpus, "--results", results, "--out", output], { cwd: process.cwd(), timeout: 5_000, stdio: "pipe" });
      const report = JSON.parse(readFileSync(output, "utf8"));
      expect(report.languages.fr.wer).toBeCloseTo(2 / 3);
      expect(report.languages.ar.wer).toBe(0);
      expect(report.silenceHallucinations).toBe(1);
      expect(report.medicationAccuracy).toBe(1);
      expect(report.qualification).toBe("FAIL");
      expect(JSON.stringify(report)).not.toContain("sertraline");
      expect(report.voiceEndToEnd).toBe("NOT RUN");
    } finally {
      for (const file of [corpus, results, output]) { try { unlinkSync(file); } catch { /* Missing failed output. */ } }
      rmdirSync(directory);
    }
  });
});

describe("continuous local Alexa voice loop", () => {
  it("keeps a long verified text answer complete when the bounded speech queue fills", async () => {
    const events: TourVoix[] = [], spoken: string[] = [];
    const text = Array.from({ length: 60 }, (_, index) => `Phrase enregistrée ${index}.`).join("\n");
    const h = harness({ repondre: async (_text, _signal, sentence) => { for (const row of text.split("\n")) sentence(row); return { texte: text }; },
      lire: async value => { spoken.push(value); }, tour: event => { events.push(event); } });
    await h.loop.demarrer(); h.frames(25, .05); h.frames(40, 0);
    for (let index = 0; index < 120; index++) await Promise.resolve();
    expect(events.at(-1)).toMatchObject({ reponse: text, speechLimited: true });
    expect(events.some(event => event.error)).toBe(false);
    expect(spoken.length).toBeLessThanOrEqual(33);
    expect(h.loop.active()).toBe(true); h.loop.arreter();
  });
  it("preserves decimal medication doses as one spoken sentence", async () => {
    const spoken: string[] = [];
    const text = "Dose enregistrée : 50.5 mg, sans modification.";
    const h = harness({ repondre: async (_text, _signal, sentence) => { sentence(text); return { texte: text }; }, lire: async value => { spoken.push(value); } });
    await h.loop.demarrer(); h.frames(25, .05); h.frames(40, 0); await flush();
    expect(spoken).toEqual([text]); h.loop.arreter();
  });
  it("navigates only after current speech finishes and suppresses a stale navigation after interruption", async () => {
    const played = deferred<void>(), targets: unknown[] = [];
    const h = harness({ repondre: async () => ({ texte: "J'ouvre le dossier.", navigation: { target: "agenda" as const } }),
      lire: () => played.promise, navigate: target => { targets.push(target); } });
    await h.loop.demarrer(); h.frames(25, .05); h.frames(40, 0); await flush();
    expect(targets).toEqual([]); h.loop.arreter(); played.resolve(); await flush();
    expect(targets).toEqual([]);
  });
  it("delivers a verified navigation after its spoken acknowledgement completes", async () => {
    const targets: unknown[] = [];
    const h = harness({ repondre: async () => ({ texte: "J'ouvre l'agenda.", navigation: { target: "agenda" as const } }), navigate: target => { targets.push(target); } });
    await h.loop.demarrer(); h.frames(25, .05); h.frames(40, 0); await flush();
    expect(targets).toEqual([{ target: "agenda" }]); h.loop.arreter();
  });
  it("carries verified citations and resolved patient scope from the actual turn result", async () => {
    const events: TourVoix[] = [];
    const sources = [{ id: "source-local", type: "consultation" as const, label: "Séance", version: "v3" }];
    const h = harness({
      repondre: async () => ({ texte: "Réponse sourcée.", sources, patientId: "resolved-local-patient", persiste: true }),
      tour: event => { events.push(event); },
    });
    await h.loop.demarrer(); h.frames(25, .05); h.frames(40, 0); await flush();
    expect(events.at(-1)).toMatchObject({ reponse: "Réponse sourcée.", sources, patientId: "resolved-local-patient", persiste: true });
    h.loop.arreter();
  });
  it("emits one terminal error when model failure follows a published transcript", async () => {
    const events: TourVoix[] = [];
    const h = harness({ repondre: async () => { throw new Error("unavailable"); }, tour: event => { events.push(event); } });
    await h.loop.demarrer(); h.frames(25, .05); h.frames(40, 0); await flush();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ id: events[0]?.id, error: "turn" });
    expect(h.loop.active()).toBe(false); h.loop.arreter(); expect(events).toHaveLength(2);
  });
  it("emits one interruption terminal turn and suppresses a late model result", async () => {
    const events: TourVoix[] = [], reply = deferred<{ texte: string }>();
    const h = harness({ repondre: () => reply.promise, tour: event => { events.push(event); } });
    await h.loop.demarrer(); h.frames(25, .05); h.frames(40, 0); await flush();
    h.loop.arreter(); expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ id: events[0]?.id, error: "interrompu" });
    reply.resolve({ texte: "Late result" }); await flush(); expect(events).toHaveLength(2);
  });
  it("all visible Alexa microphone entries use the local pipeline", () => {
    for (const file of ["SaisieJarvis.tsx", "SaisieAlexaLune.tsx", "AlexaLune.tsx", "OrbeVoix.tsx", "BootVoix.tsx"]) {
      const code = readFileSync(join(process.cwd(), "src/components", file), "utf8");
      expect(code, file).not.toContain('from "@/services/alexa-live"');
      expect(code, file).toContain('from "@/services/alexa-local"');
    }
  });
  it("does not acquire the microphone before an explicit start and ignores silence", async () => {
    const h = harness(); expect(h.calls).toEqual([]);
    await h.loop.demarrer(); h.frames(400, 0); await flush();
    expect(h.calls).toContain("capture"); expect(h.calls).not.toContain("stt");
    h.loop.arreter(); expect(h.calls).toContain("closed"); expect(h.loop.active()).toBe(false);
  });
  it("transcribes only a finalized utterance and stays ready for the next utterance", async () => {
    const h = harness(); await h.loop.demarrer(); h.frames(25, 0.05);
    expect(h.calls).not.toContain("stt");
    h.frames(40, 0); await flush();
    expect(h.calls).toContain("turn:آخر خمس جلسات"); expect(h.calls).toContain("tts:Une réponse vérifiée.");
    expect(h.calls).toContain("answer"); expect(h.loop.active()).toBe(true);
    h.frames(25, 0.06); h.frames(40, 0); await flush();
    expect(h.calls.filter((c) => c === "stt")).toHaveLength(2); h.loop.arreter();
  });
  it("new speech aborts the pending model and cuts playback within three 20 ms frames", async () => {
    const reply = deferred<{ texte: string }>(); let modelSignal: AbortSignal | undefined;
    const h = harness({ repondre: async (_t, signal) => { modelSignal = signal; return reply.promise; } });
    await h.loop.demarrer(); h.frames(25, 0.05); h.frames(40, 0); await flush();
    expect(modelSignal?.aborted).toBe(false);
    h.frames(3, 0.07); expect(modelSignal?.aborted).toBe(true);
    expect(h.calls).toContain("stop-playback");
    reply.resolve({ texte: "Late answer" }); await flush();
    expect(h.calls).not.toContain("tts:Late answer"); expect(h.calls).not.toContain("answer"); h.loop.arreter();
  });
  it("stop during capture permission closes a late microphone acquisition", async () => {
    const capture = deferred<() => void>(); let closed = 0;
    const h = harness({ ouvrir: () => capture.promise });
    const opening = h.loop.demarrer(); h.loop.arreter(); capture.resolve(() => { closed++; });
    await opening; expect(closed).toBe(1); expect(h.loop.active()).toBe(false);
  });
  it("scope cleanup cancels STT and suppresses a late transcription", async () => {
    const transcription = deferred<string>(); let signal: AbortSignal | undefined;
    const h = harness({ transcrire: async (_s, _r, sig) => { signal = sig; return transcription.promise; } });
    await h.loop.demarrer(); h.frames(25, 0.05); h.frames(40, 0); await flush();
    h.loop.arreter(); expect(signal?.aborted).toBe(true);
    transcription.resolve("A name from the old scope"); await flush();
    expect(h.calls.some((c) => c.startsWith("turn:"))).toBe(false);
  });
  it("stops a broken capture rather than sending invalid or unbounded PCM", async () => {
    const h = harness(); await h.loop.demarrer(); h.frames(1, Number.NaN); await flush();
    expect(h.loop.active()).toBe(false); expect(h.calls).toContain("state:erreur"); expect(h.calls).not.toContain("stt");
  });
});
