import { afterEach, describe, expect, it, vi } from "vitest";
import { runAlexa } from "@/server/alexa/orchestrator";
import { planRequest } from "@/shared/alexa/request-plan";
import { envoyerTourAlexa, clearAlexaConversation } from "@/services/alexa-turn";
import type { AlexaEvent, TurnInput } from "@/shared/alexa/turn";
import type { DbPort } from "@/services/db/port";

vi.mock("@/services/db", async () => {
  const { httpDbPort } = await import("@/services/db/http");
  return { db: () => ({ rpc: async () => ({ ok: true, data: ["navigation-conversation"] }), invokeFunctionStream: httpDbPort.invokeFunctionStream }) };
});
afterEach(() => { clearAlexaConversation(); vi.unstubAllGlobals(); });
const patientId = "11111111-1111-4111-8111-111111111111";
const knowledge = { rpc: async <T>() => ({ data: null as T | null, error: null }) };
const input = (text: string): TurnInput => ({ text, conversationId: `nav-${text}`, clientTurnId: patientId, appContext: { patientId, page: "/patients" } });
describe("explicit navigation through the unified turn", () => {
  it.each([["Ouvre l'agenda", "agenda"], ["Va au tableau de bord", "dashboard"], ["Ouvre la liste des patients", "patients"], ["افتح الاجندة", "agenda"], ["روح لقائمة المرضى", "patients"]])("understands %s without model-selected URLs", (text, target) => {
    expect(planRequest(text, null)).toMatchObject({ intent: "navigation", navigationTarget: target });
  });
  it("does not navigate just because an appointment read mentions the agenda", () => {
    expect(planRequest("Combien de rendez-vous aujourd'hui ?", null)).toMatchObject({ intent: "agenda" });
  });
  it.each(["Ouvre le prochain patient", "Ouvre le dossier du prochain patient", "افتح ملف المريض التالي", "Ouvre le prochain  patient", "افتح ملف المريض الجاي"])("resolves the next appointment instead of opening the active dossier: %s", text => {
    expect(planRequest(text, null).intent).toBe("agenda");
  });
  it.each(["Le traitement du prochain patient", "Résume les notes du patient suivant", "علاج المريض التالي"])("clarifies an unsupported clinical request about the next patient: %s", text => {
    expect(planRequest(text, null).intent).toBe("clarify");
  });
  it("opens a global app page without reading a patient or calling inference", async () => {
    const rpc = vi.fn(), infer = vi.fn(), build = vi.fn(), events: AlexaEvent[] = [];
    await runAlexa(input("Ouvre l'agenda"), { actor: "nav-unit", db: { rpc }, knowledge, infer, build }, event => events.push(event), new AbortController().signal);
    expect(rpc).not.toHaveBeenCalled(); expect(infer).not.toHaveBeenCalled(); expect(build).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "done", patientScope: "preserve", navigation: { target: "agenda" } });
  });
  it("audits an explicit patient before issuing a patient navigation", async () => {
    const calls: string[] = [];
    const db: Pick<DbPort, "rpc"> = { rpc: async <T>(name: string) => { calls.push(name); return { ok: true, data: [{ id: patientId, first_name: "Nadia", last_name: "Test", total_count: 1 }] as T[] }; } };
    const events: AlexaEvent[] = [];
    await runAlexa(input("Ouvre le dossier de «Nadia Test»"), { actor: "nav-named", db, knowledge }, event => events.push(event), new AbortController().signal);
    expect(calls).toEqual(["search_patients", "get_patient"]);
    expect(events.at(-1)).toMatchObject({ type: "done", patientId, patientScope: "replace", navigation: { target: "patient", patientId } });
  });
  it("does not navigate to the previous dossier when an explicit name is unavailable", async () => {
    const events: AlexaEvent[] = [], db: Pick<DbPort, "rpc"> = { rpc: async <T>() => ({ ok: true, data: [] as T[] }) };
    await runAlexa(input("Ouvre le dossier de «Nadia Inconnue»"), { actor: "nav-unknown", db, knowledge }, event => events.push(event), new AbortController().signal);
    expect(events.at(-1)).toMatchObject({ type: "done", patientId: null, patientScope: "replace" });
    expect(events.at(-1)).not.toHaveProperty("navigation");
  });
  it("does not execute deletion disguised as navigation", () => {
    expect(planRequest("Ouvre le dossier et supprime le diagnostic", null).intent).toBe("proposal");
  });
  it.each(["Ouvre le dossier de «Nadia Test» ou de «Omar Test»", "Ouvre le dossier de Nadia Test ou de Omar Test", "Ouvre le dossier de «Nadia Test» ou de Omar Test"])("clarifies multiple explicit names instead of selecting the first: %s", async text => {
    const rpc = vi.fn(), events: AlexaEvent[] = [];
    await runAlexa(input(text), { actor: `ambiguous-${text}`, db: { rpc }, knowledge }, event => events.push(event), new AbortController().signal);
    expect(rpc).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "done", patientId: null, patientScope: "replace", limited: true });
    expect(events.at(-1)).not.toHaveProperty("navigation");
  });
});
describe("client navigation contract", () => {
  const response = (navigation: unknown, donePatientId: string | null = patientId) => new Response(`data: ${JSON.stringify({ type: "done", patientId: donePatientId, patientScope: "replace", limited: false, navigation })}\n\n`);
  it("accepts a completed patient navigation matching its verified patient scope", async () => {
    vi.stubGlobal("fetch", async () => response({ target: "patient", patientId }));
    expect(await envoyerTourAlexa("Ouvre son dossier")).toMatchObject({ navigation: { target: "patient", patientId } });
  });
  it.each([{ target: "https://external.example" }, { target: "patient", patientId: "other" }, { target: "agenda", url: "https://external.example" }, { target: "patient", patientId: "22222222-2222-4222-8222-222222222222" }])("rejects a malformed or mismatched navigation %j", async navigation => {
    vi.stubGlobal("fetch", async () => response(navigation));
    await expect(envoyerTourAlexa("Ouvre son dossier")).rejects.toThrow();
  });
  it("does not accept navigation before a complete turn", async () => {
    vi.stubGlobal("fetch", async () => new Response('data: {"type":"sentence","text":"Partiel","sources":[],"navigation":{"target":"agenda"}}\n\n'));
    await expect(envoyerTourAlexa("Ouvre l'agenda")).rejects.toThrow();
  });
});
