import { expect, it, vi } from "vitest";
import { runAlexa, type OrchestratorDependencies } from "@/server/alexa/orchestrator";
import { conversationState } from "@/server/alexa/conversation-state";
import { patientMention } from "@/server/alexa/patient-mention";
import type { ClinicalContext } from "@/shared/alexa/clinical";
import type { AlexaEvent, TurnInput } from "@/shared/alexa/turn";
import type { DbPort } from "@/services/db/port";

const patientId = "11111111-1111-4111-8111-111111111111";
const actor = "local-read-actor";
const db: Pick<DbPort, "rpc"> = { rpc: async <T>() => ({ ok: true as const, data: [{ id: patientId, first_name: "Synthetic", last_name: "Test" }] as T[] }) };
const knowledge = { rpc: async <T>() => ({ data: null as T | null, error: null }) };
const unavailable = async () => ({ ok: false as const, code: "unavailable" as const, localFallback: true as const });
function context(count: number, revision = "a".repeat(64)): ClinicalContext {
  return {
    patientId, consultations: Array.from({ length: count }, (_, index) => ({
      id: `${(index + 1).toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
      startedAt: new Date(Date.UTC(2026, 0, 10 - index)).toISOString(), endedAt: new Date(Date.UTC(2026, 0, 10 - index, 1)).toISOString(), notes: [],
    })),
    treatments: { current: [{ id: "22222222-2222-4222-8222-222222222222", medication: "Sertraline", version: 1, status: "active",
      dose: "50", doseUnit: "mg", frequency: "1x/j", timing: [], instructions: null, startDate: "2026-01-01", endDate: null }], history: [], historyComplete: true },
    diagnoses: [], scales: [], sourceRevision: revision,
    coverage: { requested: count, returned: count, complete: true, hasMore: false },
  };
}
function input(text: string): TurnInput {
  return { text, conversationId: `local-read-${text}`, clientTurnId: patientId, appContext: { patientId, page: "/patients/test" } };
}
const sentences = (events: AlexaEvent[]) => events.filter((event): event is Extract<AlexaEvent, { type: "sentence" }> => event.type === "sentence");

it.each(["les 5 dernières consultations", "آخر خمس استشارات", "آخر 5 consultations"])("reads exact consultation fields locally for %s", async text => {
  const infer = vi.fn(unavailable), events: AlexaEvent[] = [];
  await runAlexa(input(text), { actor, db, knowledge, build: async (_db, _scope, request) => context(request.count), infer }, event => events.push(event), new AbortController().signal);
  expect(infer).not.toHaveBeenCalled();
  expect(new Set(sentences(events).flatMap(event => event.sources.map(source => source.id))).size).toBe(5);
  expect(events.at(-1)).toMatchObject({ type: "done", coverage: { requested: 5, returned: 5 } });
});

it.each(["traitement actuel", "والدواء؟"])("reads current treatment fields locally for %s", async text => {
  const infer = vi.fn(unavailable), events: AlexaEvent[] = [];
  await runAlexa(input(text), { actor, db, knowledge, build: async (_db, _scope, request) => context(request.count), infer }, event => events.push(event), new AbortController().signal);
  expect(infer).not.toHaveBeenCalled();
  const treatment = sentences(events).find(event => event.sources.some(source => source.id === "22222222-2222-4222-8222-222222222222"));
  expect(treatment?.text).toMatch(/\b50\b\D+\bmg\b/u);
  expect(treatment?.text).toContain("1x/j");
  expect(events.at(-1)).toMatchObject({ type: "done" });
});

it.each([
  "Compare les 5 dernières consultations", "Résume les 5 dernières consultations",
  "تلخيص آخر خمس جلسات", "لخص آخر خمس جلسات", "قارن آخر 5 consultations",
])("uses source-linked local excerpts for %s", async text => {
  const infer = vi.fn(unavailable), events: AlexaEvent[] = [];
  await runAlexa(input(text), { actor, db, knowledge, build: async (_db, _scope, request) => context(request.count), infer }, event => events.push(event), new AbortController().signal);
  expect(infer).not.toHaveBeenCalled();
  expect(new Set(sentences(events).flatMap(event => event.sources.map(source => source.id))).size).toBe(5);
  expect(events.at(-1)).toMatchObject({ type: "done", limited: true });
});

it.each([
  "واش تبدل في آخر خمس جلسات",
  "Analyse l'évolution du traitement",
  "Traitement: est-il compatible ?",
  "العلاج: هل هو مناسب؟",
])("preserves the interpretation path and its limits for %s", async text => {
  const infer = vi.fn(unavailable), events: AlexaEvent[] = [];
  await runAlexa(input(text), { actor, db, knowledge, build: async (_db, _scope, request) => context(request.count), infer }, event => events.push(event), new AbortController().signal);
  expect(infer).toHaveBeenCalledOnce();
  expect(events).toContainEqual({ type: "stage", stage: "analysis" });
  expect(events.at(-1)).toMatchObject({ type: "done", limited: true });
});

it("checks the latest source revision before publishing a local read", async () => {
  const infer = vi.fn(unavailable), events: AlexaEvent[] = []; let reads = 0;
  await runAlexa(input("la dernière consultation"), { actor, db, knowledge, infer,
    build: async (_db, _scope, request) => context(request.count, ++reads === 1 ? "a".repeat(64) : "b".repeat(64)) }, event => events.push(event), new AbortController().signal);
  expect(infer).not.toHaveBeenCalled();
  expect(sentences(events)).toHaveLength(0);
  expect(events.at(-1)).toMatchObject({ type: "error", code: "stale" });
});

it("rejects a changed conversation scope before publishing a local read", async () => {
  const infer = vi.fn(unavailable), events: AlexaEvent[] = [], turn = input("traitement actuel"); let reads = 0;
  await runAlexa(turn, { actor, db, knowledge, infer, build: async (_db, _scope, request) => {
    if (++reads === 2) conversationState.clear(actor, turn.conversationId);
    return context(request.count);
  } }, event => events.push(event), new AbortController().signal);
  expect(infer).not.toHaveBeenCalled();
  expect(sentences(events)).toHaveLength(0);
  expect(events.at(-1)).toMatchObject({ type: "error", code: "stale" });
});

it("cancels a local read before any clinical sentence is published", async () => {
  const infer = vi.fn(unavailable), events: AlexaEvent[] = [], controller = new AbortController(); let reads = 0;
  await runAlexa(input("les 5 dernières séances"), { actor, db, knowledge, infer, build: async (_db, _scope, request) => {
    if (++reads === 2) controller.abort();
    return context(request.count);
  } }, event => events.push(event), controller.signal);
  expect(infer).not.toHaveBeenCalled();
  expect(sentences(events)).toHaveLength(0);
  expect(events.at(-1)).toMatchObject({ type: "error", code: "cancelled" });
});

it.each(["لخص آخر خمس جلسات", "لخص الجلسة السابقة"])("does not treat Arabic consultation references as a patient name: %s", text => {
  expect(patientMention(text)).toBeUndefined();
});

it("still extracts an explicit Arabic patient name", () => {
  expect(patientMention("لخص أحمد")).toBe("أحمد");
});

it("does not reuse the previous dossier when an explicit Arabic name is unknown", async () => {
  const infer = vi.fn(unavailable), build = vi.fn<NonNullable<OrchestratorDependencies["build"]>>(async (_db, _scope, request) => context(request.count));
  const conversationId = "unknown-arabic-name", events: AlexaEvent[] = [];
  await runAlexa({ ...input("traitement actuel"), conversationId }, { actor, db, knowledge, build, infer }, () => {}, new AbortController().signal);
  build.mockClear();
  const noPatient: Pick<DbPort, "rpc"> = { rpc: async <T>() => ({ ok: true as const, data: [] as T[] }) };
  await runAlexa({ ...input("لخص خالد"), conversationId }, { actor, db: noPatient, knowledge, build, infer }, event => events.push(event), new AbortController().signal);
  expect(build).not.toHaveBeenCalled();
  expect(infer).not.toHaveBeenCalled();
  expect(sentences(events).flatMap(event => event.sources)).toEqual([]);
  expect(events.at(-1)).toMatchObject({ type: "done", patientId: null });
  expect(conversationState.read(actor, conversationId, patientId, "/patients/test")).toBeNull();
});
