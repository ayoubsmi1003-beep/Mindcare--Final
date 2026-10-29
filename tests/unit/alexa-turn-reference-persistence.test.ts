import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlexaEvent } from "@/shared/alexa/turn";
import { conversationState } from "@/server/alexa/conversation-state";

const controls = vi.hoisted(() => ({
  actor: "synthetic-doctor" as string,
  rpc: vi.fn(),
  runAlexa: vi.fn(),
}));

vi.mock("@/app/api/jarvis/_commun", () => ({
  identite: async () => controls.actor,
  refusIaClinique: async () => null,
}));
vi.mock("@/app/api/alexa/turn/legacy", () => ({ legacyAlexaTurn: vi.fn() }));
vi.mock("@/server/alexa/db", () => ({ alexaDb: () => ({ rpc: vi.fn() }) }));
vi.mock("@/server/alexa/agent-loop", () => ({
  savedAgentTask: () => null,
  restoreAgentTask: vi.fn(),
}));
vi.mock("@/server/alexa/orchestrator", () => ({ runAlexa: controls.runAlexa }));
vi.mock("@/server/jarvis/client-sql", () => ({ clientSql: () => ({ rpc: controls.rpc }) }));

import { POST } from "@/app/api/alexa/turn/route";

const patientId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const page = "/patients/test";
const appContext = { patientId, page };
const contextKey = JSON.stringify(appContext);
const firstTurnId = "33333333-3333-4333-8333-333333333333";
const secondTurnId = "44444444-4444-4444-8444-444444444444";

function request(text: string, clientTurnId: string): Request {
  return new Request("http://localhost:3000/api/alexa/turn", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "localhost:3000",
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify({ text, conversationId, clientTurnId, appContext }),
  });
}

function finishTurn(emit: (event: AlexaEvent) => void): void {
  emit({ type: "sentence", text: "Synthèse de test.", kind: "fact", sources: [] });
  emit({
    type: "done", patientId, patientScope: "preserve", sourceRevision: null,
    coverage: null, limited: false, status: "completed", parts: [], speechAllowed: true,
  });
}

afterEach(() => {
  conversationState.clear(controls.actor, conversationId);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

beforeEach(() => {
  controls.actor = "synthetic-doctor";
  controls.rpc.mockReset();
  controls.runAlexa.mockReset();
  vi.stubEnv("ALEXA_NATIVE_AGENT_ENABLED", "1");
});

describe("Alexa turn reference persistence boundary", () => {
  it("stores the utterance as a human turn but never restores it from the working reference", async () => {
    const firstText = "Résume les consultations de ce dossier.";
    let savedMetadata: Record<string, unknown> | null = null;
    const claims: Record<string, unknown>[] = [];
    const completions: Record<string, unknown>[] = [];
    controls.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "get_alexa_task_context") return { data: savedMetadata, error: null };
      if (name === "claim_alexa_turn") {
        claims.push(args);
        return { data: { state: "claimed" }, error: null };
      }
      if (name === "complete_jarvis_turn") {
        completions.push(args);
        savedMetadata = JSON.parse(String(args["p_outil"])) as Record<string, unknown>;
        return { data: true, error: null };
      }
      return { data: null, error: null };
    });

    controls.runAlexa.mockImplementationOnce(async (
      _input: unknown,
      _dependencies: unknown,
      emit: (event: AlexaEvent) => void,
    ) => {
      const lease = conversationState.begin(controls.actor, conversationId, patientId, page, Date.now(), contextKey);
      conversationState.finish(lease, { intent: "history", count: 1, lastRequest: firstText });
      finishTurn(emit);
    });

    const firstResponse = await POST(request(firstText, firstTurnId));
    await firstResponse.text();

    expect(firstResponse.status).toBe(200);
    expect(claims[0]).toMatchObject({ p_demande: firstText });
    const firstPersistedReference = (savedMetadata?.["reference"] ?? {}) as Record<string, unknown>;
    expect(firstPersistedReference).toEqual({ intent: "history", count: 1 });
    expect(firstPersistedReference).not.toHaveProperty("lastRequest");

    // Simulate a server restart: only the persisted structured reference survives.
    conversationState.clear(controls.actor, conversationId);
    let restoredReference: unknown;
    controls.runAlexa.mockImplementationOnce(async (
      _input: unknown,
      _dependencies: unknown,
      emit: (event: AlexaEvent) => void,
    ) => {
      restoredReference = conversationState.read(controls.actor, conversationId, patientId, page, Date.now(), contextKey);
      finishTurn(emit);
    });

    const secondResponse = await POST(request("Et la précédente ?", secondTurnId));
    await secondResponse.text();

    expect(secondResponse.status).toBe(200);
    expect(restoredReference).toEqual({ intent: "history", count: 1 });
    expect(restoredReference).not.toHaveProperty("lastRequest");
    expect(completions).toHaveLength(2);
  });
});