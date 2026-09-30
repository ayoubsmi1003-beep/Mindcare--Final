import { afterEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  VOICE_PROVIDER: "cloud", GEMINI_API_KEY: "synthetic-test-key", ALEXA_LIVE_DEBUG: "false",
}));
const gate = vi.hoisted(() => ({ cloud: true }));
vi.mock("@/server/env", () => ({ env: () => config }));
vi.mock("@/server/db/withCaller", () => ({
  withEgressGate: async (fn: (q: unknown) => unknown) => fn({ query: async (sql: string) =>
    sql.includes("is_cloud_dev") ? [{ cloud: gate.cloud }] : [] }),
}));
import * as gateway from "@/server/egress/external-call";

class Socket extends EventTarget {
  static sockets: Socket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  sent: unknown[] = [];
  constructor(readonly url: string) {
    super(); Socket.sockets.push(this);
    queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
  }
  send(text: string) {
    const data = JSON.parse(text) as { setup?: unknown };
    this.sent.push(data);
    if (data.setup) queueMicrotask(() => this.receive({ setupComplete: {} }));
  }
  receive(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
}

afterEach(() => { vi.unstubAllGlobals(); Socket.sockets = []; config.VOICE_PROVIDER = "cloud"; gate.cloud = true; });

describe("Gemini native Live egress", () => {
  it("has a native Live entry point instead of the STT/text/TTS chain", () => {
    expect(gateway).toHaveProperty("ouvrirGeminiLive", expect.any(Function));
  });
  it("opens the requested native model, sends PCM and returns provider audio in the same session", async () => {
    vi.stubGlobal("WebSocket", Socket);
    const events: unknown[] = [];
    const r = await gateway.ouvrirGeminiLive({ sessionToken: "00000000-0000-4000-8000-000000000001",
      currentPatientId: null, onEvent: (e) => events.push(e), executeTool: async () => ({ status: "unavailable" }) });
    expect(r.ok).toBe(true); if (!r.ok) return;
    const socket = Socket.sockets[0]!;
    expect(socket.sent[0]).toMatchObject({ setup: { model: "models/gemini-3.8-live",
      generationConfig: { responseModalities: ["AUDIO"] } } });
    await r.data.sendAudio("AAAAAA==");
    expect(socket.sent.at(-1)).toEqual({ realtimeInput: { audio: { data: "AAAAAA==", mimeType: "audio/pcm;rate=16000" } } });
    socket.receive({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAAAA==", mimeType: "audio/pcm;rate=24000" } }] }, turnComplete: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toContainEqual({ type: "audio", data: "AAAAAA==", sampleRate: 24000 });
    expect(events).toContainEqual({ type: "turn_complete" });
    r.data.close(); expect(socket.readyState).toBe(3);
  });
  it("refuses local deployment mode before opening a cloud socket", async () => {
    vi.stubGlobal("WebSocket", Socket); config.VOICE_PROVIDER = "local";
    const r = await gateway.ouvrirGeminiLive({ sessionToken: "00000000-0000-4000-8000-000000000001",
      currentPatientId: null, onEvent: () => {}, executeTool: async () => ({}) });
    expect(r.ok).toBe(false); expect(Socket.sockets).toHaveLength(0);
  });
  it("returns tool results with the exact call ID and preserves multilingual conversational context", async () => {
    vi.stubGlobal("WebSocket", Socket);
    const tool = vi.fn(async () => ({ status: "ok", resume: { contenu: "synthetic exact summary" } }));
    const r = await gateway.ouvrirGeminiLive({ sessionToken: "00000000-0000-4000-8000-000000000001",
      currentPatientId: null, onEvent: () => {}, executeTool: tool });
    expect(r.ok).toBe(true); if (!r.ok) return;
    const socket = Socket.sockets[0]!;
    socket.receive({ toolCall: { functionCalls: [{ id: "call-1", name: "get_patient_summary", args: {} }] } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tool).toHaveBeenCalledWith("get_patient_summary", {}, expect.any(AbortSignal));
    expect(socket.sent.at(-1)).toMatchObject({ toolResponse: { functionResponses: [{ id: "call-1",
      name: "get_patient_summary", response: { result: { resume: { contenu: "synthetic exact summary" } } } }] } });
    expect(Socket.sockets).toHaveLength(1); r.data.close();
  });
});
