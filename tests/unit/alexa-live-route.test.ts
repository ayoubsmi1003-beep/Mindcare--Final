import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientSql, ReponseRpc, ArgsJarvis } from "@/server/jarvis/client-sql";
import type { ouvrirGeminiLive } from "@/server/egress/external-call";

const controls = vi.hoisted(() => ({ actor: "doctor", cookie: "synthetic-cookie", synthetic: true,
  open: vi.fn(), rpc: vi.fn(), audio: vi.fn(), context: vi.fn(), close: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: controls.cookie }) }) }));
vi.mock("@/server/auth/session", () => ({ NOM_COOKIE: "session" }));
vi.mock("@/app/api/jarvis/_commun", () => ({ identite: async () => controls.actor || null,
  echec: (code: string, message: string) => Response.json({ ok: false, error: { code, message } }),
  succes: (data: unknown) => Response.json({ ok: true, data }) }));
vi.mock("@/server/egress/external-call", () => ({ ouvrirGeminiLive: controls.open, diagnosticLive: () => {} }));
vi.mock("@/server/env", () => ({ env: () => ({ GEMINI_API_KEY: "synthetic-server-key", VOICE_PROVIDER: "cloud" }) }));
vi.mock("@/server/jarvis/client-sql", () => ({ clientSql: () => {
  const client: ClientSql = { rpc: async <T>(name: string, args?: ArgsJarvis) => {
    const result = await controls.rpc(name, args) as ReponseRpc;
    return { data: result.data as T | null, error: result.error };
  } }; return client;
} }));
import { GET, POST } from "@/app/api/jarvis/jarvis-live/route";

const patientId = "00000000-0000-4000-8000-000000000009";
const request = (body: unknown) => new Request("http://localhost:3000/api/jarvis/jarvis-live", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
const opened: Parameters<typeof ouvrirGeminiLive>[0][] = [];
async function start() {
  const response = await POST(request({ action: "start", currentPatientId: patientId }));
  expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
  const reader = response.body!.getReader(); readers.push(reader);
  const ready = JSON.parse(new TextDecoder().decode((await reader.read()).value)) as { sessionId: string };
  return ready.sessionId;
}
beforeEach(() => {
  vi.clearAllMocks(); controls.actor = "doctor"; controls.cookie = "synthetic-cookie"; controls.synthetic = true; opened.length = 0;
  controls.rpc.mockImplementation(async (name: string, args: ArgsJarvis): Promise<ReponseRpc> => ({ error: null,
    data: name === "get_patient" ? [{ id: args.p_id, is_synthetic: controls.synthetic }] : null }));
  controls.open.mockImplementation(async (req: Parameters<typeof ouvrirGeminiLive>[0]) => {
    opened.push(req); return { ok: true, data: { sendAudio: controls.audio, updateContext: controls.context, close: controls.close } };
  });
});
afterEach(async () => { for (const reader of readers.splice(0)) await reader.cancel().catch(() => {}); });
describe("authenticated ephemeral Live route", () => {
  it("refuses anonymous and non-synthetic records before opening Google", async () => {
    controls.actor = "";
    expect(await (await POST(request({ action: "start", currentPatientId: patientId }))).json()).toMatchObject({ ok: false });
    controls.actor = "doctor"; controls.synthetic = false;
    expect(await (await POST(request({ action: "start", currentPatientId: patientId }))).json()).toMatchObject({ ok: false });
    expect(controls.open).not.toHaveBeenCalled();
  });
  it("keeps the provider key private even in the configuration diagnostic", async () => {
    const result = await (await GET()).text();
    expect(result).toContain('"keyConfigured":true'); expect(result).not.toContain("synthetic-server-key");
  });
  it("rejects another authenticated cookie and cleans up on reader cancellation", async () => {
    const sessionId = await start(); controls.cookie = "another-cookie";
    expect(await (await POST(request({ action: "audio", sessionId, pcmBase64: "AAAAAA==" }))).json()).toMatchObject({ ok: false });
    expect(controls.audio).not.toHaveBeenCalled();
    await readers[0]!.cancel();
    expect(opened[0]?.signal?.aborted).toBe(true); expect(controls.close).toHaveBeenCalledOnce();
  });
  it("closes the preceding session before reopening and rejects old audio", async () => {
    const oldId = await start(), newId = await start();
    expect(newId).not.toBe(oldId); expect(opened[0]?.signal?.aborted).toBe(true);
    expect(await (await POST(request({ action: "audio", sessionId: oldId, pcmBase64: "AAAAAA==" }))).json()).toMatchObject({ ok: false });
    expect(await (await POST(request({ action: "audio", sessionId: newId, pcmBase64: "AAAAAA==" }))).json()).toMatchObject({ ok: true });
    expect(controls.audio).toHaveBeenCalledOnce();
  });
  it("closes immediately when navigation selects a non-synthetic patient", async () => {
    const sessionId = await start(); controls.synthetic = false;
    expect(await (await POST(request({ action: "context", sessionId, currentPatientId: patientId }))).json()).toMatchObject({ ok: false });
    expect(opened[0]?.signal?.aborted).toBe(true); expect(controls.context).not.toHaveBeenCalled();
  });
});
