import { beforeEach, expect, it, vi } from "vitest";
import { runAlexa } from "@/server/alexa/orchestrator";
import { readKnowledge } from "@/server/alexa/knowledge-adapter";
import { patientMention } from "@/server/alexa/patient-mention";
import type { ClinicalContext } from "@/shared/alexa/clinical";
import type { AlexaEvent, TurnInput } from "@/shared/alexa/turn";
import type { DbPort } from "@/services/db/port";

vi.mock("@/server/alexa/knowledge-adapter", () => ({ readKnowledge: vi.fn() }));
const patientId = "11111111-1111-4111-8111-111111111111";
const actor = "progressive-unit";
const db: Pick<DbPort, "rpc"> = { rpc: async <T>() => ({ ok: true as const, data: [{ id: patientId, first_name: "Synthetic", last_name: "Test" }] as T[] }) };
const knowledge = { rpc: async <T>() => ({ data: null as T | null, error: null }) };
const context = (count = 2, sourceRevision = "a".repeat(64)): ClinicalContext => ({ patientId,
  consultations: Array.from({ length: count }, (_, i) => ({ id: `${String(i + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
    startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T01:00:00Z", notes: [] })),
  treatments: { current: [], history: [], historyComplete: true }, diagnoses: [], scales: [], sourceRevision,
  coverage: { requested: count, returned: count, complete: true, hasMore: false } });
const input = (text: string): TurnInput => ({ text, clientTurnId: patientId, conversationId: text,
  appContext: { patientId, page: "/patients/unit" } });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(readKnowledge).mockResolvedValue({ etat: "sans-preuve", preuves: [] }); });

it("publishes before inference completes and supplements missing requested facts without duplicate sources", async () => {
  const events: AlexaEvent[] = [];
  await runAlexa(input("Analyse les 20 dernières consultations"), { db, knowledge, actor,
    build: async (_db, _scope, request) => context(request.count), infer: async (payload, options) => {
      const item = { text: "recorded fact", evidence: [payload.facts[0]!.evidence], kind: "fact" as const };
      await options?.onSentence?.(item);
      expect(events.filter(event => event.type === "sentence")).toHaveLength(1);
      expect(events.some(event => event.type === "done")).toBe(false);
      return { ok: true, model: "qwen/synthetic:free", data: { sentences: [item] } };
    } }, event => events.push(event), new AbortController().signal);
  const ids = events.filter(event => event.type === "sentence").flatMap(event => event.sources.map(source => source.id));
  expect(ids).toHaveLength(20);
  expect(new Set(ids).size).toBe(20);
  expect(events.at(-1)).toMatchObject({ type: "done", coverage: { returned: 20 }, limited: true });
});

it.each(["source", "scope", "tail"])("refuses a complete answer after a streamed fact and changed %s", async cause => {
  const events: AlexaEvent[] = [];
  let reads = 0;
  const turn = { ...input("Analyse les deux dernières consultations"), conversationId: `changed-${cause}` };
  await runAlexa(turn, { db, knowledge, actor,
    build: async (_db, _scope, request) => context(request.count, cause === "source" && ++reads > 2 ? "b".repeat(64) : "a".repeat(64)),
    infer: async (payload, options) => {
      const item = { text: "recorded fact", evidence: [payload.facts[0]!.evidence], kind: "fact" as const };
      await options?.onSentence?.(item);
      if (cause === "scope") await runAlexa({ ...input("traitement actuel"), conversationId: turn.conversationId,
        appContext: { patientId: null, page: "/agenda" } }, { db, knowledge, actor }, () => {}, new AbortController().signal);
      if (cause === "tail") return { ok: false, code: "invalid-response", localFallback: true, partial: true };
      if (cause === "source") await options?.onSentence?.({ ...item, evidence: [payload.facts[1]!.evidence] });
      return { ok: true, model: "qwen/synthetic:free", data: { sentences: [item] } };
    } }, event => events.push(event), new AbortController().signal);
  expect(events.filter(event => event.type === "sentence")).toHaveLength(1);
  expect(events.at(-1)).toMatchObject({ type: "error", partial: true });
  expect(events.some(event => event.type === "done")).toBe(false);
});

it("combines patient facts and book excerpts while retaining separate provenance", async () => {
  const events: AlexaEvent[] = [];
  vi.mocked(readKnowledge).mockResolvedValue({ etat: "ok", preuves: [{ titre: "Book", section: "Section", version: "v1", extrait: "Approved general excerpt",
    sourceId: "source", chunkId: "chunk", versionChunk: "chunk-v1", unitId: null, parentTexteHash: null, enfantIndex: null, enfantsTotal: null }] });
  await runAlexa(input("résumé ce dossier selon le livre"), { db, knowledge, actor, build: async () => context() }, event => events.push(event), new AbortController().signal);
  const facts = events.filter(event => event.type === "sentence" && event.kind === "fact");
  const books = events.filter(event => event.type === "sentence" && event.kind === "knowledge");
  expect(facts.length).toBeGreaterThan(0);
  expect(books).toHaveLength(2);
  expect(books.at(-1)).toMatchObject({ sources: [{ type: "knowledge", id: "chunk", version: "v1" }] });
  expect(readKnowledge).toHaveBeenCalledOnce();
});

it("reads no patient data for a general treatment-book question", async () => {
  const get = vi.fn();
  await runAlexa(input("explique le traitement de la dépression selon le livre"), { db: { rpc: get }, knowledge, actor }, () => {}, new AbortController().signal);
  expect(get).not.toHaveBeenCalled();
  expect(readKnowledge).toHaveBeenCalledOnce();
});

it.each(["consultations selon le DSM", "لخص هذا المريض حسب المراجع"])("does not extract a reference marker as a patient name: %s", text => {
  expect(patientMention(text)).toBeUndefined();
});
