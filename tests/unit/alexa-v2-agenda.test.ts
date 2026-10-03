import { expect, it } from "vitest";
import { runAlexa } from "@/server/alexa/orchestrator";
import type { AlexaEvent } from "@/shared/alexa/turn";
import type { DbPort } from "@/services/db/port";
import type { ClientSql } from "@/server/jarvis/client-sql";
import { planRequest } from "@/shared/alexa/request-plan";
import { conversationState } from "@/server/alexa/conversation-state";

const patientId = "11111111-1111-4111-8111-111111111111";
const appointmentId = "22222222-2222-4222-8222-222222222222";
const appointment = { id: appointmentId, patient_id: patientId, starts_at: "2026-10-01T13:00:00Z", ends_at: "2026-10-01T14:00:00Z", status: "confirmed" };
async function ask(suivant: unknown, visible: boolean, text = "le prochain patient") {
  const events: AlexaEvent[] = [], calls: string[] = [];
  const db: Pick<DbPort, "rpc"> = { rpc: async <T>(name: string) => {
    calls.push(name);
    return { ok: true, data: (visible ? [{ id: patientId, first_name: "Synthetic", last_name: "Test" }] : []) as T[] };
  } };
  const knowledge: ClientSql = { rpc: async <T>(name: string) => { calls.push(name); const fixture: unknown = { suivant, journee: suivant ? [suivant] : [] }; return { data: fixture as T, error: null }; } };
  await runAlexa({ text, conversationId: crypto.randomUUID(), clientTurnId: patientId, appContext: { patientId: null, page: "/jarvis" } },
    { actor: "agenda-test", db, knowledge }, event => events.push(event), new AbortController().signal);
  return { events, calls };
}
it.each(["le prochain patient", "Qui arrive ensuite ?", "Qui vient après ?"])("reads %s through the dashboard gate and audits the patient before adopting scope", async text => {
  const { events, calls } = await ask(appointment, true, text);
  expect(calls).toEqual(["dashboard_today", "get_patient"]);
  expect(events.at(-1)).toMatchObject({ type: "done", patientId, patientScope: "replace" });
  expect(events.find(event => event.type === "sentence")).toMatchObject({ sources: [{ id: appointmentId }] });
  expect(JSON.stringify(events.filter(event => event.type === "sentence").map(event => event.text))).not.toContain("Synthetic");
});
it("does not adopt the next patient when its audited read is denied", async () => {
  const { events } = await ask(appointment, false);
  expect(events.at(-1)).toMatchObject({ type: "done", patientId: null, patientScope: "replace" });
});
it("reports an empty next appointment without reusing a previous patient", async () => {
  const { events, calls } = await ask(null, true);
  expect(calls).toEqual(["dashboard_today"]);
  expect(events.at(-1)).toMatchObject({ type: "done", patientId: null, patientScope: "replace" });
});

it("preserves the working patient for a global agenda read without adopting appointment identities", async () => {
  const { events, calls } = await ask(appointment, true, "agenda");
  expect(calls).toEqual(["dashboard_today"]);
  expect(events.at(-1)).toMatchObject({ type: "done", patientId: null, patientScope: "preserve" });
});

it.each(["Voir l'agenda de demain", "agenda d'hier", "planning de la semaine", "agenda du 15/10/2026", "موعد غدوة", "موعد أمس", "موعد هذا الأسبوع", "agenda demain وفق المراجع"])("does not silently replace an unsupported agenda period with today: %s", text => {
  expect(planRequest(text, null).intent).toBe("clarify");
});

it.each(["agenda", "Explique selon le DSM", "Bonjour", "supprime le dossier"])("a completed explicit nonclinical turn replaces the old consultation reference: %s", async text => {
  const actor = "nonclinical-reference", conversationId = crypto.randomUUID(), page = "/jarvis";
  const prior = conversationState.begin(actor, conversationId, patientId, page);
  conversationState.finish(prior, { intent: "history", count: 5, cursor: { startedAt: "2026-09-01T10:00:00Z", id: appointmentId } });
  const knowledge: ClientSql = { rpc: async <T>(name: string) => {
    const data: unknown = name === "dashboard_today" ? { suivant: null, journee: [] } : [];
    return { data: data as T, error: null };
  } };
  const events: AlexaEvent[] = [];
  await runAlexa({ text, conversationId, clientTurnId: crypto.randomUUID(), appContext: { patientId, page } },
    { actor, db: { rpc: async <T>() => ({ ok: true, data: [] as T[] }) }, knowledge }, event => events.push(event), new AbortController().signal);
  expect(events.at(-1)).toMatchObject({ type: "done", patientScope: "preserve" });
  expect(planRequest("avant ?", conversationState.read(actor, conversationId, patientId, page)).intent).toBe("clarify");
});

async function patientAgenda(text: string, found = true) {
  const events: AlexaEvent[] = [], calls: string[] = [];
  const db: Pick<DbPort, "rpc"> = { rpc: async <T>(name: string) => {
    calls.push(name);
    return { ok: true, data: (found ? [{ id: patientId, first_name: "Nadia", last_name: "Test", total_count: 1 }] : []) as T[] };
  } };
  const other = { ...appointment, id: "33333333-3333-4333-8333-333333333333", patient_id: "44444444-4444-4444-8444-444444444444" };
  const knowledge: ClientSql = { rpc: async <T>(name: string) => { calls.push(name); const data: unknown = { suivant: other, journee: [appointment, other] }; return { data: data as T, error: null }; } };
  await runAlexa({ text, conversationId: crypto.randomUUID(), clientTurnId: patientId, appContext: { patientId, page: "/jarvis" } },
    { actor: "named-agenda", db, knowledge }, event => events.push(event), new AbortController().signal);
  return { events, calls };
}

it.each(["Les rendez-vous de Nadia Test aujourd'hui", "موعد تاع «Nadia Test» اليوم", "Son rendez-vous aujourd'hui", "Ses rendez-vous du jour", "موعد المريض اليوم", "مواعيدها اليوم", "موعده اليوم", "موعدو اليوم"])("audits patient scope and excludes other appointments for %s", async text => {
  const { events, calls } = await patientAgenda(text);
  expect(calls).toEqual(text.includes("Nadia") ? ["search_patients", "get_patient", "dashboard_today"] : ["get_patient", "dashboard_today"]);
  const sources = events.filter(event => event.type === "sentence").flatMap(event => event.sources.map(source => source.id));
  expect(sources).toEqual([appointmentId]);
  expect(events.at(-1)).toMatchObject({ type: "done", patientId, patientScope: "replace", limited: false });
  expect(events.at(-1)).not.toHaveProperty("navigation");
});

it("does not read the global agenda or reuse the active dossier for an unknown explicit name", async () => {
  const { events, calls } = await patientAgenda("Les rendez-vous de Nadia Inconnue aujourd'hui", false);
  expect(calls).toContain("search_patients");
  expect(calls.every(name => name === "search_patients")).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: "done", patientId: null, patientScope: "replace", limited: true });
});

it.each(["Les rendez-vous de «Nadia Test» et de «Omar Test» aujourd'hui", "Ouvre l'agenda de Nadia Test", "Le prochain patient de Nadia Test", "Ouvre son agenda", "Va à son tableau de bord"])("does not silently turn a qualified or ambiguous request into a global operation: %s", async text => {
  const { events, calls } = await patientAgenda(text);
  expect(calls).toEqual([]);
  expect(events.at(-1)).toMatchObject({ type: "done", patientId: null, patientScope: "replace", limited: true });
  expect(events.at(-1)).not.toHaveProperty("navigation");
});
