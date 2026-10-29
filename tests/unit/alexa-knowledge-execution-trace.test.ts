import { afterEach, expect, it, vi } from "vitest";
import { readKnowledge } from "@/server/alexa/knowledge-adapter";
import { agentExecutor } from "@/server/alexa/agent-tools";
import { runAlexa } from "@/server/alexa/orchestrator";
import type { ArgsJarvis, ClientSql } from "@/server/jarvis/client-sql";
import type { DependancesReadKnowledge } from "@/server/alexa/knowledge-adapter";
import type { LocalCompletion } from "@/server/alexa/local-model-protocol";

const { localText, localCompletion } = vi.hoisted(() => ({ localText: vi.fn(), localCompletion: vi.fn() }));
vi.mock("@/server/alexa/local-model", () => ({ inferLocalText: localText, inferLocalCompletion: localCompletion }));

const DSM = "DSM-5 — Manuel diagnostique et statistique des troubles mentaux";
const DSM_MARKER = "[dsm5-fr-2015-elsevier p.205|src:264]";
const question = "Explique le trouble panique selon DSM";
const sentence = "Le trouble panique se caractérise par des attaques récurrentes et inattendues.";

function client(texte = sentence) {
  const calls: { gate: string; args: ArgsJarvis }[] = [];
  const sql: ClientSql = { rpc: async <T,>(gate: string, args: ArgsJarvis = {}) => {
    calls.push({ gate, args });
    return { data: [{
      chunk_id: "trace-synthetic-chunk", source_id: "trace-synthetic-source", source_titre: DSM,
      source_version: "sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53",
      section: "Section II › Trouble panique › Critères diagnostiques", version_chunk: "trace-v1",
      langue: "fr", texte, score: 0.6, source_statut: "active", source_classification: "C4",
      source_approuvee_le: new Date("2026-09-01"), source_approuvee_par: "synthetic-reviewer",
      source_revue_a_jour: true, source_remplacee_par: null, unit_id: "trace-unit",
      parent_texte_hash: "trace-parent", enfant_index: 1, enfants_total: 1,
    }] as T, error: null };
  } };
  return { sql, calls };
}

function emptyClient(): ClientSql {
  return { rpc: async <T,>() => ({ data: [] as T, error: null }) };
}

function capturedTrace(info: ReturnType<typeof vi.spyOn>) {
  const payload = info.mock.calls.find(([event]) => event === "[alexa-knowledge-execution]")?.[1];
  return typeof payload === "string" ? JSON.parse(payload) as Record<string, unknown> : null;
}

function modelCalls(entries: { name: string; args: Record<string, unknown> }[]): LocalCompletion {
  return { kind: "calls", calls: entries.map((entry, index) => ({ id: `book-${index}-${entry.name}`, ...entry })),
    message: { role: "assistant", content: null, tool_calls: entries.map((entry, index) => ({
      id: `book-${index}-${entry.name}`, type: "function", function: { name: entry.name, arguments: JSON.stringify(entry.args) },
    })) }, tokensIn: 20, tokensOut: 10 };
}

async function runNativeBookAnswer(coverage: "supported" | "partial") {
  vi.stubEnv("KNOWLEDGE_VECTOR", "0");
  localText.mockResolvedValue(JSON.stringify({ coverage,
    sentences: [{ text: sentence, evidence: [{ index: 1, quoteId: "q1" }] }] }));
  const { sql } = client(`${sentence} ${DSM_MARKER}`);
  const events: unknown[] = [];
  let inference = 0;

  await runAlexa({ text: question, conversationId: `book-answer-${coverage}`, clientTurnId: `book-answer-${coverage}-turn`,
    appContext: { patientId: null, page: "/jarvis" } }, {
    native: true, actor: "synthetic-evaluation-actor", db: { rpc: async <T,>() => ({ ok: true, data: [] as T }) }, knowledge: sql,
    agentInfer: async () => inference++ === 0
      ? modelCalls([{ name: "declare_request", args: { parts: [{ id: "knowledge", goal: question, tools: ["search_knowledge"], conditions: [], dependsOn: [] }] } }])
      : modelCalls([{ name: "search_knowledge", args: { partIds: ["knowledge"], query: question } }]),
  }, event => events.push(event), new AbortController().signal);
  return events;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localText.mockReset();
  localCompletion.mockReset();
});

it.each(["direct", "agent_tool"] as const)("records safe %s readKnowledge execution metadata only when local timings are enabled", async origin => {
  vi.stubEnv("ALEXA_LOCAL_TIMINGS", "1");
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const { sql, calls } = client();
  const deps: DependancesReadKnowledge = { vectorActif: false };

  const result = await readKnowledge(sql, question, undefined, deps, { traceOrigin: origin });

  const payload = info.mock.calls.find(([event]) => event === "[alexa-knowledge-execution]")?.[1];
  const entry = typeof payload === "string" ? JSON.parse(payload) as Record<string, unknown> : null;
  expect(result.etat).toBe("ok");
  expect(entry).toMatchObject({
    origin,
    recipe: "lexical-only",
    lexical: { gate: "search_knowledge_lexical", calls: calls.length, rows: 1 },
    embedding: { invoked: false, status: "not-enabled" },
    vector: { invoked: false, gate: null },
    reranker: { invocations: 0, fallback: false },
    evidence: { selected: 1, pages: 0 },
    result: "ok",
  });
  const serialized = JSON.stringify(entry);
  expect(serialized).not.toContain(question);
  expect(serialized).not.toContain(DSM);
  expect(serialized).not.toContain(sentence);
  expect(serialized).not.toContain("trace-synthetic-source");
});

it("keeps the execution trace silent when local timings are disabled", async () => {
  vi.stubEnv("ALEXA_LOCAL_TIMINGS", "0");
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const { sql } = client();
  await readKnowledge(sql, question, undefined, { vectorActif: false }, { traceOrigin: "direct" });
  expect(info.mock.calls.some(([event]) => event === "[alexa-knowledge-execution]")).toBe(false);
});

it("marks the production direct Alexa knowledge branch with its trace origin", async () => {
  vi.stubEnv("ALEXA_LOCAL_TIMINGS", "1");
  vi.stubEnv("KNOWLEDGE_VECTOR", "0");
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const knowledge = emptyClient();
  const events: unknown[] = [];

  await runAlexa({
    text: question, conversationId: "trace-direct", clientTurnId: "trace-direct-turn",
    appContext: { patientId: null, page: "/jarvis" },
  }, {
    db: { rpc: async <T,>() => ({ ok: true, data: [] as T }) },
    knowledge, actor: "synthetic-evaluation-actor",
  }, event => events.push(event), new AbortController().signal);

  expect(capturedTrace(info)).toMatchObject({ origin: "direct", recipe: "lexical-only" });
  expect(events.some(event => typeof event === "object" && event !== null &&
    "type" in event && event.type === "sentence")).toBe(true);
});

it("marks the production search_knowledge tool with its trace origin", async () => {
  vi.stubEnv("ALEXA_LOCAL_TIMINGS", "1");
  vi.stubEnv("KNOWLEDGE_VECTOR", "0");
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const knowledge = emptyClient();
  const execute = agentExecutor({
    text: question, conversationId: "trace-agent-tool", clientTurnId: "trace-agent-tool-turn",
    appContext: { patientId: null, page: "/jarvis" },
  }, { rpc: async <T,>() => ({ ok: true, data: [] as T }) }, knowledge);

  const result = await execute({ id: "knowledge-read", name: "search_knowledge", args: { partIds: ["knowledge-read"], query: question } },
    "2026-10-29T10:00:00.000Z", [], new AbortController().signal);

  expect(capturedTrace(info)).toMatchObject({ origin: "agent_tool", recipe: "lexical-only" });
  expect(result.status).toBe("empty");
});

it("speaks a grounded book passage without its title through the native knowledge tool", async () => {
  const events = await runNativeBookAnswer("supported");

  const answer = events.find((event): event is { type: "sentence"; kind: string; text: string; sources: unknown[] } =>
    !!event && typeof event === "object" && "type" in event && event.type === "sentence") as { type: "sentence"; kind: string; text: string; sources: unknown[] } | undefined;
  const done = events.find((event): event is Record<string, unknown> =>
    !!event && typeof event === "object" && "type" in event && event.type === "done");
  expect(answer?.text).toContain(`Passage cité : « ${sentence} »`);
  expect(answer?.text).not.toContain(DSM);
  expect(answer?.kind).toBe("knowledge");
  expect(answer?.sources.length).toBeGreaterThan(0);
  expect(done).toMatchObject({ status: "partial", limited: true, speechAllowed: true });
});

it("keeps a partial book turn partial while allowing its grounded quote to be spoken", async () => {
  const events = await runNativeBookAnswer("partial");
  const done = events.find((event): event is Record<string, unknown> =>
    !!event && typeof event === "object" && "type" in event && event.type === "done");
  expect(done).toMatchObject({ status: "partial", limited: true, speechAllowed: true });
});

it("records the actual embedding recipe, SQL gate, and invocation result", async () => {
  vi.stubEnv("ALEXA_LOCAL_TIMINGS", "1");
  vi.stubEnv("KNOWLEDGE_VECTOR_RECETTE", "e5-base");
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const { sql } = client();
  const vector: DependancesReadKnowledge = {
    vectorActif: true,
    vectorielSecondaire: {
      modele: "intfloat/multilingual-e5-base",
      version: "d128750597153bb5987e10b1c3493a34e5a4502a",
      dimensions: 768,
    },
    vecteurRequete: async () => Array.from({ length: 768 }, () => 0.01),
  };

  await readKnowledge(sql, question, undefined, vector, { traceOrigin: "direct" });

  const payload = info.mock.calls.find(([event]) => event === "[alexa-knowledge-execution]")?.[1];
  const entry = typeof payload === "string" ? JSON.parse(payload) as Record<string, unknown> : null;
  expect(entry).toMatchObject({
    recipe: "e5-base",
    configuredRecipe: "e5-base",
    model: { embedding: "intfloat/multilingual-e5-base", embeddingVersion: "d128750597153bb5987e10b1c3493a34e5a4502a", dimensions: 768 },
    embedding: { invoked: true, status: "ok", outputDimensions: 768 },
    vector: { invoked: true, gate: "search_knowledge_vector_v2_768", rows: 1, status: "ok" },
  });
});

it("records the cross-encoder attempt and named fallback without source or query text", async () => {
  vi.stubEnv("ALEXA_LOCAL_TIMINGS", "1");
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const { sql } = client();
  const reranker = {
    nom: "synthetic-cross-encoder",
    version: "synthetic-v1",
    reranker: () => [],
    rerankerAsync: async () => { throw new Error("private synthetic failure text"); },
  } satisfies NonNullable<DependancesReadKnowledge["rerankerLocal"]>;

  const result = await readKnowledge(sql, question, undefined, { vectorActif: false, rerankerLocal: reranker }, { traceOrigin: "agent_tool" });

  const payload = info.mock.calls.find(([event]) => event === "[alexa-knowledge-execution]")?.[1];
  const entry = typeof payload === "string" ? JSON.parse(payload) as Record<string, unknown> : null;
  expect(result).toMatchObject({ reranker: "repli" });
  expect(entry).toMatchObject({
    model: { reranker: "synthetic-cross-encoder", rerankerVersion: "synthetic-v1" },
    reranker: { mode: "cross-encoder", invocations: expect.any(Number), fallback: true },
    fallbacks: ["reranker-fallback"],
  });
  expect(entry?.["reranker"]).toHaveProperty("invocations");
  expect((entry?.["reranker"] as { invocations: number }).invocations).toBeGreaterThan(0);
  const serialized = JSON.stringify(entry);
  expect(serialized).not.toContain(question);
  expect(serialized).not.toContain("private synthetic failure text");
  expect(serialized).not.toContain(DSM);
  expect(serialized).not.toContain(sentence);
});

 
const nativeBookCases = [
  { name: "DSM-5", question: "Explique le trouble panique selon DSM", title: DSM,
    version: "sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53",
    section: "Section II › Trouble panique › Critères diagnostiques", language: "fr",
    quote: sentence, marker: "[dsm5-fr-2015-elsevier p.205|src:264]", page: 205 },
  { name: "Maudsley/Taylor", question: "Quelles précautions de surveillance du lithium selon Taylor ?",
    title: "The Maudsley Prescribing Guidelines in Psychiatry",
    version: "sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0",
    section: "Lithium monitoring", language: "en",
    quote: "Lithium monitoring includes periodic renal and thyroid tests.",
    marker: "[maudsley-prescribing-guidelines-2021-taylor-14e p.248|src:269]", page: 248 },
  { name: "Stahl", question: "Comment agit le lithium selon le Prescriber's Guide ?",
    title: "Prescriber's Guide (Stahl's Essential Psychopharmacology)",
    version: "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3",
    section: "How the Drug Works", language: "en",
    quote: "Lithium works by modulating intracellular inositol signaling pathways involved in neuronal communication.",
    marker: "[stahl-prescribers-guide-7e-cup p.1029|src:1029]", page: 1029 },
] as const;

it.each(nativeBookCases)("answers $name through the native knowledge path without speaking its title", async book => {
  vi.stubEnv("KNOWLEDGE_VECTOR", "0");
  localText.mockResolvedValueOnce(JSON.stringify({ coverage: "supported",
    sentences: [{ text: book.quote, evidence: [{ index: 1, quoteId: "q1" }] }] }));
  if (book.language === "en") localText.mockResolvedValueOnce(JSON.stringify({ sentences: ["Le lithium agit sur les voies intracellulaires."] }));
  const knowledge: ClientSql = { rpc: async <T,>() => ({ data: [{
    chunk_id: "native-" + book.name, source_id: "source-" + book.name, source_titre: book.title,
    source_version: book.version, section: book.section, version_chunk: "native-" + book.name + "-v1",
    langue: book.language, texte: book.quote + " " + book.marker, score: 0.6,
    source_statut: "active", source_classification: "C4", source_approuvee_le: new Date("2026-09-01"),
    source_approuvee_par: "synthetic-reviewer", source_revue_a_jour: true, source_remplacee_par: null,
    unit_id: "unit-" + book.name, parent_texte_hash: "native-book-parent", enfant_index: 1, enfants_total: 1,
  }] as T, error: null }) };
  const events: unknown[] = [];
  let inference = 0;

  await runAlexa({ text: book.question, conversationId: "native-book-" + book.name, clientTurnId: "native-book-" + book.name + "-turn",
    appContext: { patientId: null, page: "/jarvis" } }, {
    native: true, actor: "synthetic-" + book.name, db: { rpc: async <T,>() => ({ ok: true, data: [] as T }) }, knowledge,
    agentInfer: async () => inference++ === 0
      ? modelCalls([{ name: "declare_request", args: { parts: [{ id: "knowledge", goal: book.question, tools: ["search_knowledge"], conditions: [], dependsOn: [] }] } }])
      : modelCalls([{ name: "search_knowledge", args: { partIds: ["knowledge"], query: book.question } }]),
  }, event => events.push(event), new AbortController().signal);

  const answer = events.find((event): event is { type: "sentence"; kind: string; text: string; sources: Array<{label:string;provenance?:Record<string,unknown>}> } =>
    !!event && typeof event === "object" && "type" in event && event.type === "sentence") as { type: "sentence"; kind: string; text: string; sources: Array<{label:string;provenance?:Record<string,unknown>}> } | undefined;
  const done = events.find((event): event is Record<string, unknown> =>
    !!event && typeof event === "object" && "type" in event && event.type === "done");
  expect(answer?.text).toContain("Passage cité : « " + book.quote + " »");
  expect(answer?.text).not.toContain(book.title);
  expect(answer?.kind).toBe("knowledge");
  expect(answer?.sources[0]?.label).toContain(book.title);
  expect(answer?.sources[0]?.provenance).toMatchObject({ pageImprimee: book.page });
  expect(done).toMatchObject({ status: "partial", limited: true, speechAllowed: true });
});
it("carries direct Alexa retrieval, quoted answer, and verified page provenance through the orchestrator", async () => {
  vi.stubEnv("ALEXA_LOCAL_TIMINGS", "1");
  vi.stubEnv("KNOWLEDGE_VECTOR", "0");
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  localText.mockResolvedValue(JSON.stringify({ coverage: "supported",
    sentences: [{ text: sentence, evidence: [{ index: 1, quote: sentence }] }] }));
  const { sql, calls } = client(`${sentence} ${DSM_MARKER}`);
  const events: unknown[] = [];

  await runAlexa({ text: question, conversationId: "trace-direct-citation", clientTurnId: "trace-direct-citation-turn",
    appContext: { patientId: null, page: "/jarvis" } }, {
    actor: "synthetic-evaluation-actor", db: { rpc: async <T,>() => ({ ok: true, data: [] as T }) }, knowledge: sql,
  }, event => events.push(event), new AbortController().signal);

  const answer = events.find((event): event is { type: "sentence"; kind: string; text: string; sources: Array<Record<string, unknown>> } =>
    !!event && typeof event === "object" && "type" in event && event.type === "sentence" && "sources" in event && Array.isArray(event.sources) && event.sources.length > 0) as
      { type: "sentence"; kind: string; text: string; sources: Array<Record<string, unknown>> } | undefined;
  expect(answer).toMatchObject({ type: "sentence", kind: "knowledge", text: `Passage cité : « ${sentence} »`,
    sources: [{ type: "knowledge", excerpt: sentence, provenance: { sourceId: "trace-synthetic-source", pageImprimee: 205, pagePdf: 264 } }] });
  expect(answer?.text).not.toContain(DSM);

  const trace = capturedTrace(info);
  expect(trace).toMatchObject({ origin: "direct", recipe: "lexical-only",
    lexical: { gate: "search_knowledge_lexical", calls: calls.length, rows: 1 },
    embedding: { invoked: false, status: "not-enabled" }, vector: { invoked: false, gate: null },
    evidence: { selected: 1, pages: 1 }, result: "ok" });
  expect(JSON.stringify(trace)).not.toContain(question);
  expect(JSON.stringify(trace)).not.toContain(sentence);
  expect(JSON.stringify(trace)).not.toContain("trace-synthetic-source");
});
