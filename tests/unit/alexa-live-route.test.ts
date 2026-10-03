import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  actor: "doctor", cookie: vi.fn(), open: vi.fn(), rpc: vi.fn(), environment: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => { controls.cookie(); return { get: () => ({ value: "synthetic-cookie" }) }; } }));
vi.mock("@/server/auth/session", () => ({ NOM_COOKIE: "session" }));
vi.mock("@/app/api/jarvis/_commun", () => ({
  identite: async () => controls.actor || null,
  echec: (code: string, message: string) => Response.json({ ok: false, error: { code, message } }),
  succes: (data: unknown) => Response.json({ ok: true, data }),
}));
vi.mock("@/server/egress/external-call", () => ({
  ouvrirGeminiLive: controls.open, diagnosticLive: () => {}, geminiLiveAutorise: () => false,
}));
vi.mock("@/server/env", () => ({ env: () => {
  controls.environment(); return { GEMINI_API_KEY: "synthetic-server-key", VOICE_PROVIDER: "cloud" };
} }));
vi.mock("@/server/jarvis/client-sql", () => ({ clientSql: () => ({ rpc: controls.rpc }) }));
import { GET, POST } from "@/app/api/jarvis/jarvis-live/route";

const request = (body: unknown) => new Request("http://localhost:3000/api/jarvis/jarvis-live", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => { vi.clearAllMocks(); controls.actor = "doctor"; });

describe("retired authenticated Live route", () => {
  it("reports retirement and its local replacement without cloud readiness or secrets", async () => {
    const response = await GET(), result = await response.json();
    expect(result).toEqual({ ok: true, data: {
      status: "retired", provider: "local", cloudEnabled: false, replacement: "/api/alexa/turn",
    } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(controls.environment).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/keyConfigured|synthetic-server-key|gemini/);
  });

  it("keeps anonymous status and commands unavailable", async () => {
    controls.actor = "";
    expect(await (await GET()).json()).toMatchObject({ ok: false });
    expect(await (await POST(request({ action: "start", currentPatientId: null }))).json())
      .toMatchObject({ ok: false, error: { code: "non-authentifie" } });
    expect(controls.open).not.toHaveBeenCalled();
  });

  it.each(["start", "audio", "context", "stop"])("refuses %s without reading raw data or opening a provider", async (action) => {
    const req = request({ action, currentPatientId: null,
      sessionId: "00000000-0000-4000-8000-000000000001", pcmBase64: "AAAAAA==" });
    const response = await POST(req);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "voix-cloud-retiree" } });
    expect(req.bodyUsed).toBe(false);
    expect(controls.cookie).not.toHaveBeenCalled();
    expect(controls.open).not.toHaveBeenCalled();
    expect(controls.rpc).not.toHaveBeenCalled();
  });
});
