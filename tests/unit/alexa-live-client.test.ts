import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encoderPCM16 } from "@/shared/jarvis/pcm";

const fixture = vi.hoisted(() => ({ post: vi.fn(), stream: vi.fn(), release: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/services/db", () => ({ db: () => ({ invokeFunction: fixture.post, invokeFunctionStream: fixture.stream }) }));
vi.mock("@/services/micro-partage", () => ({ prendreMicro: async () => ({ ok: true, data: {
  flux: { getTracks: () => [] }, rendre: fixture.release,
} }) }));
vi.mock("@/services/patient-actif", () => ({ patientActifCourant: () => null, abonnerPatientActif: () => fixture.unsubscribe }));
vi.mock("@/services/log", () => ({ log: { info: () => {} } }));
import { arreterLive, demarrerLive, liveActif, vueLive } from "@/services/alexa-live";

class AudioNode {
  connect() {}
  disconnect() {}
}
class Context {
  sampleRate = 48000;
  currentTime = 0;
  state = "running";
  destination = new AudioNode();
  audioWorklet = { addModule: async () => {} };
  resume = async () => {};
  close = vi.fn(async () => { this.state = "closed"; });
  createMediaStreamSource() { return new AudioNode(); }
  createGain() { return Object.assign(new AudioNode(), { gain: { value: 1 } }); }
}
class Capture extends AudioNode {
  static latest: Capture;
  port: { onmessage: ((event: { data: Float32Array }) => void) | null; close: () => void } = { onmessage: null, close: () => {} };
  constructor() { super(); Capture.latest = this; }
}
const sessionId = "00000000-0000-4000-8000-000000000001";
let events: ReadableStreamDefaultController<Uint8Array>;
const commands: { action: string; pcmBase64?: string }[] = [];
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); commands.length = 0;
  vi.stubGlobal("AudioContext", Context); vi.stubGlobal("AudioWorkletNode", Capture);
  fixture.stream.mockImplementation(async () => ({ ok: true, data: new ReadableStream<Uint8Array>({ start(controller) {
    events = controller;
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: "ready", sessionId }) + "\n"));
  } }) }));
  fixture.post.mockImplementation(async (_name: string, command: typeof commands[number]) => {
    commands.push(command);
    if (command.action === "audio") await new Promise((resolve) => setTimeout(resolve, 750));
    return { ok: true, data: { accepted: true } };
  });
});
afterEach(() => { arreterLive(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function activate() { await demarrerLive(); await vi.advanceTimersByTimeAsync(0); expect(vueLive().etat).toBe("ecoute"); }

describe("native Live microphone transport", () => {
  it("keeps listening and preserves ordered PCM when authenticated HTTP is slower than one capture frame", async () => {
    await activate();
    const expected: Uint8Array[] = [];
    for (let i = 0; i < 20; i++) {
      const samples = new Float32Array(12000).fill((i + 1) / 100);
      expected.push(encoderPCM16([samples], 48000));
      Capture.latest.port.onmessage?.({ data: samples });
      await vi.advanceTimersByTimeAsync(250);
      expect(vueLive().etat).toBe("ecoute");
    }
    await vi.advanceTimersByTimeAsync(2000);
    const audio = commands.filter((command) => command.action === "audio");
    expect(audio.every((command) => command.pcmBase64!.length <= 48000)).toBe(true);
    expect(Buffer.concat(audio.map((command) => Buffer.from(command.pcmBase64!, "base64"))))
      .toEqual(Buffer.concat(expected));
    expect(liveActif()).toBe(true);
  });
  it("releases capture and the stream on an error, then opens a fresh usable session", async () => {
    await activate(); const oldCapture = Capture.latest;
    events.enqueue(new TextEncoder().encode('{"type":"error"}\n'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vueLive().etat).toBe("erreur"); expect(liveActif()).toBe(false);
    expect(oldCapture.port.onmessage).toBeNull(); expect(fixture.release).toHaveBeenCalledOnce();
    await activate(); expect(Capture.latest).not.toBe(oldCapture);
    arreterLive(); expect(fixture.release).toHaveBeenCalledTimes(2); expect(fixture.unsubscribe).toHaveBeenCalledTimes(2);
  });
  it("absorbs a short burst of worklet messages without cutting the microphone or losing samples", async () => {
    await activate();
    const samples = new Float32Array(12000).fill(0.1), pcm = encoderPCM16([samples], 48000);
    for (let i = 0; i < 12; i++) Capture.latest.port.onmessage?.({ data: samples });
    expect(vueLive().etat).toBe("ecoute");
    await vi.advanceTimersByTimeAsync(4000);
    const received = Buffer.concat(commands.filter((command) => command.action === "audio")
      .map((command) => Buffer.from(command.pcmBase64!, "base64")));
    expect(received).toEqual(Buffer.concat(Array.from({ length: 12 }, () => pcm)));
    expect(liveActif()).toBe(true);
  });
});
