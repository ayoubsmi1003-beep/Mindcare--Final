import { expect, it } from "vitest";
import { runAlexa } from "@/server/alexa/orchestrator";
import type { ClinicalContext } from "@/shared/alexa/clinical";
import type { AlexaEvent, TurnInput } from "@/shared/alexa/turn";
import type { DbPort } from "@/services/db/port";

const patientId = "11111111-1111-4111-8111-111111111111";
const db: Pick<DbPort, "rpc"> = { rpc: async <T>() => ({ ok: true as const, data: [{ id: patientId, first_name: "Synthetic", last_name: "Test" }] as T[] }) };
const knowledge = { rpc: async <T>() => ({ data: null as T | null, error: null }) };
function context(count: number, revision = "a".repeat(64)): ClinicalContext {
  return { patientId, consultations: Array.from({ length: count }, (_, index) => ({ id: `${(index + 1).toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`, startedAt: new Date(Date.UTC(2026, 0, 100 - index)).toISOString(), endedAt: new Date(Date.UTC(2026, 0, 100 - index, 1)).toISOString(), notes: [] })),
    treatments: { current: [], history: [], historyComplete: true }, diagnoses: [], scales: [], sourceRevision: revision,
    coverage: { requested: count, returned: count, complete: true, hasMore: false } };
}
function input(conversationId: string): TurnInput { return { text: "les 20 dernières consultations", conversationId, clientTurnId: patientId, appContext: { patientId, page: "/patients/test" } }; }

it("rejects a changed record before any clinical sentence is published", async () => {
  const events: AlexaEvent[] = []; let reads = 0;
  await runAlexa(input("stale"), { actor: "unit-actor", db, knowledge, build: async () => context(++reads === 1 ? 20 : 1, reads === 1 ? "a".repeat(64) : "b".repeat(64)), infer: async () => ({ ok: false, code: "unavailable", localFallback: true }) }, event => events.push(event), new AbortController().signal);
  expect(events.filter(event => event.type === "sentence")).toHaveLength(0);
  expect(events.at(-1)).toMatchObject({ type: "error", code: "stale" });
});

it("preserves exact-N coverage if the model only selects one of twenty consultations", async () => {
  const events: AlexaEvent[] = []; let modelCalls = 0;
  await runAlexa({ ...input("all-twenty"), text: "Analyse les 20 dernières consultations" }, { actor: "unit-actor", db, knowledge, build: async (_db, _scope, request) => context(request.count),
    infer: async payload => { modelCalls++; return { ok: true, model: "qwen/synthetic:free", data: { sentences: [{ text: "Une seule séance.", kind: "fact", evidence: [payload.facts[0]!.evidence] }] } }; } }, event => events.push(event), new AbortController().signal);
  expect(modelCalls).toBe(1);
  const sentences = events.filter((event): event is Extract<AlexaEvent, { type: "sentence" }> => event.type === "sentence");
  expect(new Set(sentences.flatMap(event => event.sources.map(source => source.id))).size).toBe(20);
  expect(sentences.map(event => event.text).join(" ")).not.toContain("Une seule séance.");
  expect(events.at(-1)).toMatchObject({ type: "done", coverage: { returned: 20 } });
});

it("carries a terminal last-session cursor so before does not repeat the latest session", async () => {
  const first = context(1), events: AlexaEvent[] = [];
  const reads: { count: number; before?: { startedAt: string; id: string } }[] = [];
  const build = async (_db: Pick<DbPort, "rpc">, _scope: { patientId: string }, request: { count: number; before?: { startedAt: string; id: string } }) => {
    reads.push(request);
    return request.before ? { ...context(0), coverage: { requested: 1, returned: 0, complete: false, hasMore: false } } : first;
  };
  const deps = { actor: "unit-actor", db, knowledge, build, infer: async () => ({ ok: false as const, code: "unavailable" as const, localFallback: true as const }) };
  const initial = { ...input("terminal-before"), text: "la dernière consultation" };
  await runAlexa(initial, deps, () => {}, new AbortController().signal);
  reads.length = 0;
  await runAlexa({ ...initial, text: "et avant ?" }, deps, event => events.push(event), new AbortController().signal);
  expect(reads[0]?.before).toEqual({ startedAt: first.consultations[0]!.startedAt, id: first.consultations[0]!.id });
  expect(events.filter(event => event.type === "sentence").flatMap(event => event.sources)).toEqual([]);
  expect(events.at(-1)).toMatchObject({ type: "done", coverage: { returned: 0 } });
});

it("answers a clear French summary locally with sourced structured sentences and no model call", async () => {
  const events: AlexaEvent[] = [];
  let modelCalls = 0;
  const build = async (_db: Pick<DbPort, "rpc">, _scope: { patientId: string }, request: { count: number }) => ({
    ...context(request.count), diagnoses: [{ id: "33333333-3333-4333-8333-333333333333", label: "Trouble anxieux", code: null, primary: true, onsetDate: null, resolvedAt: null }],
  });
  await runAlexa({ ...input("structured-summary"), text: "résumé du cas" }, { actor: "unit-actor", db, knowledge, build,
    infer: async () => { modelCalls++; return { ok: false, code: "unavailable", localFallback: true }; } }, event => events.push(event), new AbortController().signal);
  const sentences = events.filter((event): event is Extract<AlexaEvent, { type: "sentence" }> => event.type === "sentence");
  expect(modelCalls).toBe(0);
  expect(sentences).toHaveLength(4);
  expect(sentences[0]?.text).toContain("Trouble anxieux");
  expect(sentences[0]?.sources).toMatchObject([{ id: "33333333-3333-4333-8333-333333333333", type: "diagnostic" }]);
  expect(sentences.at(-1)?.text).toContain("ne sont pas interprétées");
});

it.each(["ملخص الحالة", "حضر الاستشارة", "Prépare الاستشارة"])("uses the shared sourced summary for %s without external inference", async text => {
  const events: AlexaEvent[] = [];
  let modelCalls = 0;
  const build = async (_db: Pick<DbPort, "rpc">, _scope: { patientId: string }, request: { count: number }) => {
    const record = context(request.count);
    record.diagnoses = [{ id: "33333333-3333-4333-8333-333333333333", label: "Trouble anxieux", code: null, primary: true, onsetDate: null, resolvedAt: null }];
    record.consultations[0]!.notes = [{ id: "n1", version: "v2", subjective: "Le sommeil reste interrompu, sans changement de dose.", objective: null, assessment: null, plan: null, amendments: [] }];
    return record;
  };
  await runAlexa({ ...input(`summary-${text}`), text }, { actor: "multilingual-summary", db, knowledge, build,
    infer: async () => { modelCalls++; return { ok: false, code: "unavailable", localFallback: true }; } }, event => events.push(event), new AbortController().signal);
  expect(modelCalls).toBe(0);
  const sentences = events.filter((event): event is Extract<AlexaEvent, { type: "sentence" }> => event.type === "sentence");
  expect(sentences).toHaveLength(5);
  expect(sentences[0]?.text).toMatch(/التشخيص/u);
  expect(sentences[0]?.text).toContain("Trouble anxieux");
  expect(sentences[0]?.sources).toMatchObject([{ id: "33333333-3333-4333-8333-333333333333", type: "diagnostic" }]);
  expect(sentences[2]?.text).toContain("Le sommeil reste interrompu, sans changement de dose.");
  expect(sentences[2]?.sources[0]?.id).toBe(context(1).consultations[0]!.id);
  expect(sentences[3]?.text).toMatch(/لا يتم تفسير/u);
  expect(sentences[4]?.text).toContain("Le sommeil reste interrompu, sans changement de dose.");
  expect(sentences[4]?.sources[0]?.id).toBe(context(1).consultations[0]!.id);
  expect(events.at(-1)).toMatchObject({ type: "done", coverage: { requested: 5, returned: 5 } });
});
