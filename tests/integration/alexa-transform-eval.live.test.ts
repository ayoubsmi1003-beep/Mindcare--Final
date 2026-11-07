import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { dependancesReadKnowledge, readKnowledge } from "@/server/alexa/knowledge-adapter";
import { runAlexa } from "@/server/alexa/orchestrator";
import { alexaDb } from "@/server/alexa/db";
import { clientSql } from "@/server/jarvis/client-sql";
import type { AlexaEvent } from "@/shared/alexa/turn";

/**
 * Layers L2 (retrieval) and L3 (conversation) of docs/alexa/07-evaluation-design.md.
 * Reports go to .eval-out/alexa-transform/ and measure; they don't fail on a score. Reports
 * hold ids and verdicts only: never a passage, an answer or a patient identity.
 *
 *   MINDCARE_ALEXA_TRANSFORM=retrieval|conversation with MINDCARE_DATABASE_URL on the evaluation database
 */
const mode = process.env["MINDCARE_ALEXA_TRANSFORM"];
const url = process.env["MINDCARE_DATABASE_URL"] ?? "";
const label = process.env["MINDCARE_ALEXA_TRANSFORM_LABEL"] ?? "run";
const root = process.cwd(), dataset = join(root, "tests", "eval", "alexa-transform", "v1"), out = join(root, ".eval-out", "alexa-transform");
const read = (file: string) => JSON.parse(readFileSync(join(dataset, file), "utf8"));
const report = (name: string, value: unknown) => { mkdirSync(out, { recursive: true }); writeFileSync(join(out, `${name}-${label}.json`), JSON.stringify(value, null, 1)); };
const ready = !!mode && /\/alexa_eval_v8_intelligence_20261027$/u.test(url);

async function fixture() {
  const client = new Client({ connectionString: url.replace("mindcare_app", "postgres") });
  await client.connect();
  try {
    const synthetic = (await client.query("SELECT count(*)::int AS n FROM app.patients WHERE NOT is_synthetic")).rows[0].n;
    if (synthetic !== 0) throw new Error("Evaluation database holds non-synthetic patients");
    const actor = (await client.query("SELECT id FROM app.profiles WHERE role='owner' LIMIT 1")).rows[0].id as string;
    const patient = (await client.query(`SELECT p.id, p.first_name, p.last_name FROM app.patients p
      WHERE EXISTS (SELECT 1 FROM app.consultations c WHERE c.patient_id=p.id AND c.status='closed')
        AND EXISTS (SELECT 1 FROM app.patient_treatments t WHERE t.patient_id=p.id)
      ORDER BY p.id LIMIT 1`)).rows[0] as { id: string; first_name: string; last_name: string };
    return { actor, patient };
  } finally { await client.end(); }
}

describe.skipIf(!ready || mode !== "retrieval")("L2 FR→EN retrieval", () => {
  it("measures recall without a book name", async () => {
    const { actor } = await fixture(), cases = read(process.env["MINDCARE_ALEXA_TRANSFORM_DATASET"] ?? "fr-en-retrieval.json").cases as { id: string; question: string; source: string; section: string[] }[];
    const rows: unknown[] = [];
    for (const item of cases) {
      const started = Date.now();
      const found = await readKnowledge(clientSql(actor), item.question, undefined, dependancesReadKnowledge());
      // "Chapter 1" must not match Chapters 10 to 14.
      const exact = (section: string, expected: string) => new RegExp(`${expected.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?!\\d)`, "u").test(section);
      const rank = found.preuves.findIndex(proof => proof.titre.includes(item.source) && item.section.some(section => exact(proof.section ?? "", section)));
      const rankSource = found.preuves.findIndex(proof => proof.titre.includes(item.source));
      rows.push({ id: item.id, etat: found.etat, selected: found.preuves.length, rank: rank < 0 ? null : rank + 1, rankSource: rankSource < 0 ? null : rankSource + 1, sections: found.preuves.map(proof => `${proof.titre.slice(0, 12)}: ${proof.section ?? ""}`.slice(0, 110)), ms: Date.now() - started });
    }
    const typed = rows as { id: string; rank: number | null; rankSource: number | null; ms: number }[];
    const metrics = (subset: typeof typed) => ({ n: subset.length,
      recallAt5: subset.filter(row => row.rank !== null).length / Math.max(1, subset.length),
      sourceRecallAt5: subset.filter(row => row.rankSource !== null).length / Math.max(1, subset.length),
      mrr: subset.reduce((sum, row) => sum + (row.rank ? 1 / row.rank : 0), 0) / Math.max(1, subset.length) });
    const ms = typed.map(row => row.ms).sort((a, b) => a - b);
    report("retrieval", { recipe: process.env["KNOWLEDGE_VECTOR"] === "1" ? process.env["KNOWLEDGE_VECTOR_RECETTE"] : "lexical-only", overall: metrics(typed),
      stahl: metrics(typed.filter(row => row.id.startsWith("S"))), maudsley: metrics(typed.filter(row => row.id.startsWith("M"))), dsm: metrics(typed.filter(row => row.id.startsWith("D"))),
      p50Ms: ms[Math.floor(ms.length / 2)], p95Ms: ms[Math.floor(ms.length * 0.95)], rows });
    expect(rows).toHaveLength(cases.length);
  }, 1_800_000);
});

// Same matcher as scripts/eval-book-rag.mjs, whose preflight needs read access to app.schema_migrations, which mindcare_app lacks.
describe.skipIf(!ready || mode !== "golden")("L2 Golden v4", () => {
  it("measures recall by source", async () => {
    const fold = (value: unknown) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const useful = (section: string) => fold(section).split(/[›»]/u).map(part => part.trim()).filter(Boolean).slice(1);
    interface Expected { source: string; section?: string[][]; sectionExclut?: string[]; texteContient?: string[] }
    const satisfied = (proof: { titre: string; section?: string | null; extrait?: string }, expected: Expected) =>
      fold(proof.titre).includes(fold(expected.source))
      && !(expected.sectionExclut ?? []).some(word => fold(proof.section).includes(fold(word)))
      && (!expected.section || expected.section.every(group => group.some(word => useful(proof.section ?? "").some(part => part.includes(fold(word))))))
      && (!expected.texteContient || expected.texteContient.every(fragment => fold(proof.extrait).includes(fold(fragment))));
    const { actor } = await fixture();
    const golden = JSON.parse(readFileSync(join(root, "tests", "eval", "knowledge.books-v4-2026-10-28.json"), "utf8").replace(/^﻿/u, "")) as { cas: { id: string; question: string; answerable?: boolean; attendu: Expected }[] };
    const rows: { id: string; source: string | null; answerable: boolean; etat: string; rank: number | null; ms: number }[] = [];
    for (const item of golden.cas) {
      const started = Date.now(), answerable = item.answerable !== false;
      const found = await readKnowledge(clientSql(actor), item.question, undefined, dependancesReadKnowledge());
      const index = answerable ? found.preuves.findIndex(proof => satisfied(proof as never, item.attendu)) : -1;
      rows.push({ id: item.id, source: answerable ? item.attendu.source : null, answerable, etat: found.etat, rank: index < 0 ? null : index + 1, ms: Date.now() - started });
    }
    const metrics = (subset: typeof rows) => ({ n: subset.length, recallAt5: subset.filter(row => row.rank !== null).length / Math.max(1, subset.length), recallAt1: subset.filter(row => row.rank === 1).length / Math.max(1, subset.length), mrr: subset.reduce((sum, row) => sum + (row.rank ? 1 / row.rank : 0), 0) / Math.max(1, subset.length) });
    const answerable = rows.filter(row => row.answerable), ms = rows.map(row => row.ms).sort((a, b) => a - b), sources = [...new Set(answerable.map(row => row.source))];
    report("golden", { overall: metrics(answerable), bySource: Object.fromEntries(sources.map(source => [source, metrics(answerable.filter(row => row.source === source))])),
      unanswerable: rows.filter(row => !row.answerable).map(row => ({ id: row.id, etat: row.etat })), p50Ms: ms[Math.floor(ms.length / 2)], p95Ms: ms[Math.floor(ms.length * 0.95)], rows });
    expect(rows).toHaveLength(golden.cas.length);
  }, 1_800_000);
});

// Retrieval can find the right passage and the answer can still quote another one, so this judges what is published.
describe.skipIf(!ready || mode !== "answers")("Published answers", () => {
  it("measures whether the answer cites the expected source", async () => {
    const fold = (value: unknown) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const { actor } = await fixture(), cases = read(process.env["MINDCARE_ALEXA_TRANSFORM_DATASET"] ?? "fr-en-answers-holdout-4.json").cases as { id: string; question: string; source?: string; section?: string[]; answerable?: boolean }[];
    const rows: { id: string; answerable: boolean; quotes: number; cited: boolean; first: boolean; fragments: number; status: string | null; ms: number }[] = [], answers: string[] = [];
    for (const item of cases) {
      const events: AlexaEvent[] = [], started = Date.now();
      await runAlexa({ text: item.question, conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId: null, page: "/jarvis" } },
        { actor, db: alexaDb(actor), knowledge: clientSql(actor), native: true }, event => events.push(event), new AbortController().signal).catch(() => undefined);
      const sentences = events.filter((event): event is Extract<AlexaEvent, { type: "sentence" }> => event.type === "sentence");
      const answer = sentences.map(event => event.text).join(" "), done = events.find(event => event.type === "done") as Extract<AlexaEvent, { type: "done" }> | undefined;
      const sources = sentences.flatMap(event => event.sources).filter(source => source.type === "knowledge");
      const expected = (label: string) => fold(label).includes(fold(item.source)) && (item.section ?? []).every(part => fold(label).includes(fold(part)));
      const quotes = [...answer.matchAll(/«\s*([^»]*?)\s*»/gu)].map(match => match[1] ?? "");
      rows.push({ id: item.id, answerable: item.answerable !== false, quotes: quotes.length, cited: sources.some(source => expected(source.label)), first: !!sources[0] && expected(sources[0].label),
        fragments: quotes.filter(quote => quote.split(/\s+/u).length < 5).length, status: done?.status ?? null, ms: Date.now() - started });
      // Book questions with no patient, so this file holds book passages only. It stays in .eval-out.
      answers.push(JSON.stringify({ id: item.id, question: item.question, answer, labels: sources.map(source => source.label) }));
    }
    const answerable = rows.filter(row => row.answerable), share = (subset: typeof rows, pick: (row: (typeof rows)[number]) => boolean) => subset.filter(pick).length / Math.max(1, subset.length);
    const by = (prefix: string) => { const subset = answerable.filter(row => row.id.startsWith(prefix)); return { n: subset.length, cited: share(subset, row => row.cited), first: share(subset, row => row.first) }; };
    report("answers", { overall: by("A-"), stahl: by("A-S"), maudsley: by("A-M"), dsm: by("A-D"), withQuote: share(answerable, row => row.quotes > 0), fragments: rows.reduce((sum, row) => sum + row.fragments, 0),
      unanswerableCited: rows.filter(row => !row.answerable && row.quotes > 0).map(row => row.id), rows });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `answers-${label}.answers.jsonl`), answers.join("\n"));
    expect(rows).toHaveLength(cases.length);
  }, 3_600_000);
});

interface Turn { text: string; tool?: string; alsoTool?: string; noTool?: boolean; patient?: "target" | "not-target"; noPatientRead?: boolean; textMatches?: string; evidence?: string; cited?: boolean }

describe.skipIf(!ready || mode !== "conversation")("L3 conversations", () => {
  it("measures multi-turn understanding", async () => {
    const { actor, patient } = await fixture(), flows = read(process.env["MINDCARE_ALEXA_TRANSFORM_DATASET"] ?? "conversation-flows.json").flows as { id: string; turns: Turn[] }[];
    const name = `${patient.first_name} ${patient.last_name}`, results: unknown[] = [];
    for (const flow of flows) {
      const conversationId = crypto.randomUUID();
      for (const [index, turn] of flow.turns.entries()) {
        const calls: { name: string; patientId?: unknown }[] = [], events: AlexaEvent[] = [], started = Date.now();
        const text = turn.text.replace("{name}", name);
        await runAlexa({ text, conversationId, clientTurnId: crypto.randomUUID(), appContext: { patientId: null, page: "/jarvis" } },
          { actor, db: alexaDb(actor), knowledge: clientSql(actor), native: true, agentObserve: call => calls.push({ name: call.name, patientId: call.args["patientId"] }) },
          event => events.push(event), new AbortController().signal).catch(() => undefined);
        const sentences = events.filter((event): event is Extract<AlexaEvent, { type: "sentence" }> => event.type === "sentence");
        const answer = sentences.map(event => event.text).join(" "), sources = sentences.flatMap(event => event.sources), done = events.find(event => event.type === "done") as Extract<AlexaEvent, { type: "done" }> | undefined;
        const tools = calls.map(call => call.name), patientReads = calls.filter(call => ["get_patient_context", "query_consultations", "query_documents"].includes(call.name));
        const checks: Record<string, boolean> = { notEmpty: answer.trim().length > 0 };
        if (turn.tool) checks["tool"] = tools.includes(turn.tool);
        if (turn.alsoTool) checks["alsoTool"] = tools.includes(turn.alsoTool);
        if (turn.noTool) checks["noTool"] = tools.length === 0;
        if (turn.noPatientRead) checks["noPatientRead"] = !patientReads.length;
        if (turn.patient === "target") checks["patient"] = done?.patientId === patient.id || patientReads.some(call => call.patientId === patient.id);
        if (turn.patient === "not-target") checks["patient"] = done?.patientId !== patient.id && !patientReads.some(call => call.patientId === patient.id);
        if (turn.textMatches) checks["text"] = new RegExp(turn.textMatches, "iu").test(answer);
        if (turn.evidence) checks["evidence"] = sources.some(source => source.type === "knowledge" && source.label.includes(turn.evidence!));
        if (turn.cited) checks["cited"] = sources.some(source => source.type === "knowledge" && !!source.excerpt);
        results.push({ id: `${flow.id}#${index + 1}`, pass: Object.values(checks).every(Boolean), checks, tools, status: done?.status ?? null, ms: Date.now() - started });
      }
    }
    const typed = results as { pass: boolean; ms: number }[], ms = typed.map(row => row.ms).sort((a, b) => a - b);
    report("conversation", { turns: typed.length, passed: typed.filter(row => row.pass).length, p50Ms: ms[Math.floor(ms.length / 2)], p95Ms: ms[Math.floor(ms.length * 0.95)], results });
    expect(typed.length).toBeGreaterThan(0);
  }, 7_200_000);
});
