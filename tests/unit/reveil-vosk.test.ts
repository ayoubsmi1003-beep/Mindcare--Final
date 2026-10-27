import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, detected, priseRendre, noeud, piste } = vi.hoisted(() => {
  const node = { onaudioprocess: null as ((e: unknown) => void) | null, connect: vi.fn(), disconnect: vi.fn() };
  const track = {
    ecouteurs: new Map<string, () => void>(),
    addEventListener: vi.fn((type: string, cb: () => void) => {
      track.ecouteurs.set(type, cb);
    }),
    removeEventListener: vi.fn((type: string) => {
      track.ecouteurs.delete(type);
    }),
    fin: () => track.ecouteurs.get("ended")?.(),
  };
  return { invoke: vi.fn(), detected: { value: false }, priseRendre: vi.fn(), noeud: node, piste: track };
});

vi.mock("@/services/db", () => ({ db: () => ({ invokeFunction: invoke }) }));
vi.mock("@/services/micro-partage", () => ({
  prendreMicro: async () => ({
    ok: true,
    data: { flux: { getAudioTracks: () => [piste], getTracks: () => [piste] }, rendre: priseRendre },
  }),
  sourcePartagee: () => ({ connect: vi.fn() }),
  contexteAudioPartage: () => ({
    sampleRate: 48_000,
    resume: async () => {},
    destination: {},
    createScriptProcessor: () => noeud,
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
  }),
}));

import { creerDetecteurVosk } from "@/services/reveil-vosk";

const detecteurs: ReturnType<typeof creerDetecteurVosk>[] = [];

function creer(surErreur?: (code: "micro" | "transport") => void) {
  const detecteur = creerDetecteurVosk(surErreur);
  detecteurs.push(detecteur);
  return detecteur;
}

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("AudioContext", class {});
  invoke.mockImplementation(async (_name: string, body: { action: string }) => {
    if (body.action === "audio") return { ok: true, data: { detected: detected.value } };
    return { ok: true, data: { ready: true } };
  });
  detected.value = false;
  noeud.onaudioprocess = null;
  piste.ecouteurs.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  for (const detecteur of detecteurs.splice(0)) detecteur.arreter();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function frame(value = 0.1): void {
  noeud.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(8192).fill(value) } });
}

function audioCalls(): number {
  return invoke.mock.calls.filter(([, body]) => (body as { action: string }).action === "audio").length;
}

async function unBloc(): Promise<void> {
  frame();
  frame();
  frame();
}

describe("Vosk wake-word detector", () => {
  it("resamples 48 kHz audio before sending bounded 16 kHz PCM, then fires exactly once", async () => {
    const detecteur = creer();
    const reveil = vi.fn();
    expect(await detecteur.demarrer(reveil)).toMatchObject({ ok: true });
    expect(invoke).toHaveBeenCalledWith("jarvis-wake", { action: "start" });

    detected.value = true;
    frame();
    frame();
    frame();
    await vi.waitFor(() => expect(reveil).toHaveBeenCalledTimes(1));
    frame();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reveil).toHaveBeenCalledTimes(1);

    const audio = invoke.mock.calls.filter(([, body]) => (body as { action: string }).action === "audio");
    expect(audio.length).toBeGreaterThan(0);
    const pcm = (audio[0]![1] as { pcmBase64: string }).pcmBase64;
    expect(Buffer.from(pcm, "base64").length).toBe(16_000); // 500 ms of 16 kHz PCM16
  });

  it("does not fire during suspension and resumes cleanly", async () => {
    const detecteur = creer();
    const reveil = vi.fn();
    await detecteur.demarrer(reveil);
    detecteur.suspendre();
    detected.value = true;
    frame();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reveil).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("jarvis-wake", { action: "reset" });

    detecteur.reprendre();
    frame();
    frame();
    frame();
    await vi.waitFor(() => expect(reveil).toHaveBeenCalledTimes(1));
  });

  it("reports unavailability without a microphone API and releases resources on stop", async () => {
    vi.stubGlobal("window", undefined);
    expect(await creer().disponible()).toBe(false);
    vi.stubGlobal("window", globalThis);

    const detecteur = creer();
    await detecteur.demarrer(vi.fn());
    detecteur.arreter();
    expect(priseRendre).toHaveBeenCalledTimes(1);
    expect(noeud.disconnect).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("jarvis-wake", { action: "stop" });
  });

  it("fires five wake words with resets between them and never disarms the microphone", async () => {
    const detecteur = creer();
    const reveil = vi.fn();
    await detecteur.demarrer(reveil);
    for (let i = 0; i < 5; i++) {
      detected.value = true;
      frame();
      frame();
      frame();
      await vi.waitFor(() => expect(reveil).toHaveBeenCalledTimes(i + 1));
      detecteur.suspendre();
      detecteur.reprendre();
    }
    expect(priseRendre).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("jarvis-wake", { action: "stop" });
  });

  it("keeps the microphone open through three transport failures and retries the worker", async () => {
    const detecteur = creer();
    const reveil = vi.fn();
    await detecteur.demarrer(reveil);
    const demarrages = invoke.mock.calls.filter(([, body]) => (body as { action: string }).action === "start").length;

    invoke.mockImplementation(async (_name: string, body: { action: string }) => {
      if (body.action === "audio") return { ok: false, error: { code: "indisponible" } };
      return { ok: true, data: { ready: true } };
    });

    for (let i = 0; i < 3; i++) {
      await unBloc();
      await vi.waitFor(() => expect(audioCalls()).toBe(i + 1));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(priseRendre).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("jarvis-wake", { action: "stop" });

    // Three failures schedule the 2 s retry; a later `start` must succeed and
    // leave the detector able to fire again.
    await vi.waitFor(
      () =>
        expect(
          invoke.mock.calls.filter(([, body]) => (body as { action: string }).action === "start").length,
        ).toBeGreaterThan(demarrages),
      { timeout: 4_000 },
    );
    invoke.mockImplementation(async (_name: string, body: { action: string }) => {
      if (body.action === "audio") return { ok: true, data: { detected: true } };
      return { ok: true, data: { ready: true } };
    });
    detected.value = true;
    frame();
    frame();
    frame();
    await vi.waitFor(() => expect(reveil).toHaveBeenCalledTimes(1));
  });

  it("pings while active and reports transport after two unanswered pings", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const erreurs: string[] = [];
    const detecteur = creer((code) => erreurs.push(code));
    await detecteur.demarrer(vi.fn());

    invoke.mockImplementation(async (_name: string, body: { action: string }) => {
      if (body.action === "ping") return { ok: false, error: { code: "timeout" } };
      return { ok: true, data: { ready: true } };
    });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(invoke).toHaveBeenCalledWith("jarvis-wake", { action: "ping" }, expect.anything());
    expect(erreurs).toEqual([]);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(erreurs).toEqual(["transport"]);
    expect(priseRendre).not.toHaveBeenCalled();
  });

  it("reports a lost microphone once, closes the graph, and re-acquires on a later start", async () => {
    const erreurs: string[] = [];
    const detecteur = creer((code) => erreurs.push(code));
    await detecteur.demarrer(vi.fn());

    piste.fin();
    expect(erreurs).toEqual(["micro"]);
    expect(priseRendre).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("jarvis-wake", { action: "stop" });

    expect(await detecteur.demarrer(vi.fn())).toMatchObject({ ok: true });
    expect(invoke).toHaveBeenCalledWith("jarvis-wake", { action: "start" });
  });

  it("re-arms an already active detector without leaving a detection latched", async () => {
    const detecteur = creer();
    const reveil = vi.fn();
    await detecteur.demarrer(reveil);

    detected.value = true;
    frame();
    frame();
    frame();
    await vi.waitFor(() => expect(reveil).toHaveBeenCalledTimes(1));

    expect(await detecteur.demarrer(reveil)).toMatchObject({ ok: true });
    detected.value = true;
    frame();
    frame();
    frame();
    await vi.waitFor(() => expect(reveil).toHaveBeenCalledTimes(2));
    expect(priseRendre).not.toHaveBeenCalled();
  });
});
