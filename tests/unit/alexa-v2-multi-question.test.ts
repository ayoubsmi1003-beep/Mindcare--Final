import { describe, expect, it } from "vitest";
import { runAlexa, type OrchestratorDependencies } from "@/server/alexa/orchestrator";
import type { ClinicalContext } from "@/shared/alexa/clinical";
import type { AlexaEvent, TurnInput } from "@/shared/alexa/turn";
import { conversationState } from "@/server/alexa/conversation-state";

const patientId = "a1000000-0000-4000-8000-000000001012";
const treatmentId = "11111111-1111-4111-8111-111111111111";
const diagnosisId = "22222222-2222-4222-8222-222222222222";
const context: ClinicalContext = { patientId, consultations: [],
  treatments: { current: [{ id: treatmentId, medication: "Sertraline", version: 1, status: "active", dose: "50", doseUnit: "mg", frequency: "1x/j", timing: [], instructions: null, startDate: "2026-01-01", endDate: null }], history: [], historyComplete: true },
  diagnoses: [{ id: diagnosisId, label: "Dépression enregistrée", code: "F32", primary: true, onsetDate: null, resolvedAt: null }], scales: [], sourceRevision: "a".repeat(64),
  coverage: { requested: 1, returned: 0, complete: true, hasMore: false } };
function dependencies(): OrchestratorDependencies {
  return { actor: "multi-test", db: { rpc: async <T>() => ({ ok: true as const, data: [{ id: patientId, first_name: "Mohamed", last_name: "Belkacem", total_count: 1 }] as T[] }) },
    knowledge: { rpc: async <T>() => ({ data: null as T | null, error: null }) }, build: async () => context,
    infer: async () => { throw new Error("record questions must remain local"); } };
}
async function answer(text: string, active: string | null = null) {
  const input: TurnInput = { text, conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId: active, page: "/patients" } };
  const events: AlexaEvent[] = [];
  await runAlexa(input, dependencies(), event => events.push(event), new AbortController().signal);
  conversationState.clear("multi-test", input.conversationId);
  return events;
}
const sentences = (events: AlexaEvent[]) => events.filter((event): event is Extract<AlexaEvent, {type:"sentence"}> => event.type === "sentence");
describe("Alexa bounded independent questions", () => {
  it("answers all three short dialogue questions and publishes one completion", async () => {
    const events = await answer("Bonjour Alexa ? Merci beaucoup ? Tu es là ?");
    const texts = sentences(events).map(event => event.text).join("\n");
    expect(texts).toContain("Bonjour"); expect(texts).toContain("Avec plaisir"); expect(texts).toContain("Oui, je suis là");
    expect(events.filter(event => event.type === "done")).toHaveLength(1);
  });
  it("returns both requested recorded categories rather than choosing only the treatment", async () => {
    const events = await answer("Le traitement actuel ; Quel est son diagnostic ?", patientId);
    const sources = sentences(events).flatMap(event => event.sources);
    expect(sources.some(source => source.id === treatmentId)).toBe(true);
    expect(sources.some(source => source.id === diagnosisId)).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "done", patientId });
  });
  it("understands a conjunction that starts a second explicit clinical question", async () => {
    const events = await answer("Le traitement actuel et quel est son diagnostic ?", patientId);
    const sources = sentences(events).flatMap(event => event.sources);
    expect(sources.some(source => source.id === treatmentId)).toBe(true);
    expect(sources.some(source => source.id === diagnosisId)).toBe(true);
  });
  it("retains the full named scope for a later unnamed question outside the dossier", async () => {
    const events = await answer("Traitement de Mohamed Belkacem ; Quel est son diagnostic ?");
    expect(sentences(events).flatMap(event => event.sources).some(source => source.id === diagnosisId)).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "done", patientId });
  });
  it("rejects more than three parts before answering any subset", async () => {
    const events = await answer("Bonjour ? Merci ? Tu es là ? Que peux-tu faire ?");
    expect(sentences(events).map(event => event.text).join("\n")).toMatch(/trois|3/);
    expect(events.at(-1)).toMatchObject({ type: "done", limited: true });
  });
  it("does not turn a write embedded in several questions into an executable action", async () => {
    const events = await answer("Le traitement actuel ; Supprime le dossier", patientId);
    expect(sentences(events).map(event => event.text).join("\n")).toContain("confirmation");
    expect(sentences(events).flatMap(event => event.sources)).toHaveLength(0);
  });
  it("keeps explicit distinct patients ambiguous instead of silently mixing dossiers", async () => {
    const events = await answer("Traitement de Mohamed Belkacem ; Diagnostic de Nadia Belkacem", patientId);
    expect(sentences(events).flatMap(event => event.sources)).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: "done", patientId: null });
  });
  it("marks the whole reply partial when a later question loses its scope", async () => {
    const input: TurnInput = { text: "Le traitement actuel ; Pourquoi le ciel est bleu ?", conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: {patientId, page:"/patients"} };
    const deps = dependencies();
    deps.general = async () => { conversationState.clear(deps.actor, input.conversationId); return {ok:true, text:"Late general answer", model:"qualified:free"}; };
    const events: AlexaEvent[] = [];
    await runAlexa(input, deps, event=>events.push(event), new AbortController().signal);
    expect(sentences(events).flatMap(event=>event.sources).some(source=>source.id===treatmentId)).toBe(true);
    expect(events.at(-1)).toMatchObject({type:"error",code:"stale",partial:true});
  });
});
