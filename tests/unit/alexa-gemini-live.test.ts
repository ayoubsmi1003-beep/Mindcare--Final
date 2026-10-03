import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  config: { VOICE_PROVIDER: "cloud", GEMINI_API_KEY: "synthetic-test-key", ALEXA_LIVE_DEBUG: "false" },
  query: vi.fn(), environment: vi.fn(),
}));
vi.mock("@/server/env", () => ({ env: () => { controls.environment(); return controls.config; } }));
vi.mock("@/server/db/withCaller", () => ({
  withCaller: async (_actor: string | null, fn: (q: unknown) => unknown) => fn({ query: controls.query }),
  withEgressGate: async (fn: (q: unknown) => unknown) => fn({ query: controls.query }),
}));
import { ouvrirGeminiLive } from "@/server/egress/external-call";

const connect = vi.fn();
class Socket extends EventTarget {
  readyState = 0;
  bufferedAmount = 0;
  constructor(readonly url: string) {
    super(); connect(url);
    queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
  }
  send(text: string) {
    if ((JSON.parse(text) as { setup?: unknown }).setup) {
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({ setupComplete: {} }),
      })));
    }
  }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
}

beforeEach(() => {
  vi.clearAllMocks();
  controls.config.VOICE_PROVIDER = "cloud";
  controls.config.GEMINI_API_KEY = "synthetic-test-key";
  controls.query.mockImplementation(async (sql: string) => sql.includes("is_cloud_dev") ? [{ cloud: true }] : []);
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => vi.unstubAllGlobals());

describe("retired Gemini Live egress", () => {
  it.each(["cloud", "local"])("refuses %s configuration before secrets, database, network or tools", async (provider) => {
    controls.config.VOICE_PROVIDER = provider;
    const onEvent = vi.fn(), executeTool = vi.fn();
    const result = await ouvrirGeminiLive({
      sessionToken: "00000000-0000-4000-8000-000000000001", currentPatientId: null,
      onEvent, executeTool,
    });
    if (result.ok) result.data.close();
    expect(result).toMatchObject({ ok: false, error: { code: "configuration" } });
    expect(connect).not.toHaveBeenCalled();
    expect(controls.environment).not.toHaveBeenCalled();
    expect(controls.query).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("keeps the retirement fail-closed for an already aborted request", async () => {
    const signal = AbortSignal.abort();
    const result = await ouvrirGeminiLive({
      sessionToken: "00000000-0000-4000-8000-000000000001", currentPatientId: null,
      signal, onEvent: () => {}, executeTool: async () => ({}),
    });
    expect(result.ok).toBe(false);
    expect(connect).not.toHaveBeenCalled();
    expect(controls.query).not.toHaveBeenCalled();
  });
});
