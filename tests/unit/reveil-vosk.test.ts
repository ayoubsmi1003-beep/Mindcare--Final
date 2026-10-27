import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, detected, priseRendre, noeud } = vi.hoisted(() => {
  const node = { onaudioprocess: null as ((e: unknown) => void) | null, connect: vi.fn(), disconnect: vi.fn() };
  return { invoke: vi.fn(), detected: { value: false }, priseRendre: vi.fn(), noeud: node };
});

vi.mock("@/services/db", () => ({ db: () => ({ invokeFunction: invoke }) }));
vi.mock("@/services/micro-partage", () => ({
  prendreMicro: async () => ({
    ok: true,
    data: { flux: { getAudioTracks: () => [], getTracks: () => [] }, rendre: priseRendre },
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

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("AudioContext", class {});
  invoke.mockImplementation(async (_name: string, body: { action: string }) => {
    if (body.action === "audio") return { ok: true, data: { detected: detected.value } };
    return { ok: true, data: { ready: true } };
  });
  detected.value = false;
  noeud.onaudioprocess = null;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function frame(value = 0.1): void {
  noeud.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(8192).fill(value) } });
}

describe("Vosk wake-word detector", () => {
  it("resamples 48 kHz audio before sending bounded 16 kHz PCM, then fires exactly once", async () => {
    const detecteur = creerDetecteurVosk();
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
    const detecteur = creerDetecteurVosk();
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
    expect(await creerDetecteurVosk().disponible()).toBe(false);
    vi.stubGlobal("window", globalThis);

    const detecteur = creerDetecteurVosk();
    await detecteur.demarrer(vi.fn());
    detecteur.arreter();
    expect(priseRendre).toHaveBeenCalledTimes(1);
    expect(noeud.disconnect).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("jarvis-wake", { action: "stop" });
  });
});
