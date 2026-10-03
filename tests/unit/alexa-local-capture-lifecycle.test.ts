import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ acquire: vi.fn(), invoke: vi.fn(), cut: vi.fn() }));
vi.mock("@/services/micro-partage", () => ({ prendreMicro: boundary.acquire }));
vi.mock("@/services/db", () => ({ db: () => ({ invokeFunction: boundary.invoke }) }));
vi.mock("@/services/jarvis-voix", () => ({
  arreterLecture: boundary.cut, lireTexte: vi.fn(),
  abonnerLecture: (subscriber: (active: boolean, source: null) => void) => { subscriber(false, null); return () => {}; },
}));
vi.mock("@/services/alexa-turn", () => ({ envoyerTourAlexa: vi.fn() }));
vi.mock("@/services/alexa-navigation", () => ({ navigateAlexa: vi.fn() }));
vi.mock("@/services/patient-actif", () => ({ patientActifCourant: () => null, abonnerPatientActif: () => () => {} }));
import * as local from "@/services/alexa-local";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

function browser(worklet: Promise<void>) {
  const release = vi.fn(), close = vi.fn(async () => {}), loadModule = vi.fn(() => worklet);
  const track = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const prise = { flux: { getTracks: () => [track] }, rendre: release };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const createSource = vi.fn(() => source), install = vi.fn();
  vi.stubGlobal("AudioContext", class {
    sampleRate = 48000;
    audioWorklet = { addModule: loadModule };
    destination = {};
    resume = async () => {};
    close = close;
    createMediaStreamSource = createSource;
    createGain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() });
  });
  vi.stubGlobal("AudioWorkletNode", class {
    constructor() { install(); }
    port = { onmessage: null, close: vi.fn() };
    connect = vi.fn(); disconnect = vi.fn();
  });
  return { prise, release, close, loadModule, track, createSource, install };
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.invoke.mockResolvedValue({ ok: true, data: { accepted: true } });
});
afterEach(async () => { local.arreterVoixLocale(); await flush(); vi.unstubAllGlobals(); });

describe("local capture preparation cancellation", () => {
  it("releases an acquired microphone immediately while the audio module is pending, with no late capture", async () => {
    const moduleReady = deferred<void>(), b = browser(moduleReady.promise);
    boundary.acquire.mockResolvedValue({ ok: true, data: b.prise });
    const opening = local.demarrerVoixLocale();
    try {
      await flush(); expect(b.loadModule).toHaveBeenCalledOnce();
      local.arreterVoixLocale();
      expect(b.release).toHaveBeenCalledOnce();
      expect(b.close).toHaveBeenCalledOnce();
      expect(b.track.removeEventListener).toHaveBeenCalledWith("ended", expect.any(Function));
    } finally { moduleReady.resolve(); await opening; local.arreterVoixLocale(); }
    expect(b.release).toHaveBeenCalledOnce();
    expect(b.createSource).not.toHaveBeenCalled();
    expect(b.install).not.toHaveBeenCalled();
  });

  it("closes the context during permission delay and returns a late microphone without installing capture", async () => {
    const access = deferred<{ ok: true; data: ReturnType<typeof browser>["prise"] }>(), b = browser(Promise.resolve());
    boundary.acquire.mockReturnValue(access.promise);
    const opening = local.demarrerVoixLocale();
    try {
      await flush(); local.arreterVoixLocale();
      expect(b.close).toHaveBeenCalledOnce();
    } finally { access.resolve({ ok: true, data: b.prise }); await opening; local.arreterVoixLocale(); }
    expect(b.release).toHaveBeenCalledOnce();
    expect(b.loadModule).not.toHaveBeenCalled();
    expect(b.createSource).not.toHaveBeenCalled();
    expect(b.install).not.toHaveBeenCalled();
  });
});
