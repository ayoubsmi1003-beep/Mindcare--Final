import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { planKnowledgeQuery } from "@/server/alexa/knowledge-query";

/**
 * Read-only knowledge trace.
 *
 * Proves, on the real database, which planned lexical queries are issued for a
 * question and how many governed chunks each one returns. It never writes, and
 * the artifact keeps no source text: only counts, source titles, sections and
 * scores. Questions below contain no patient data.
 *
 *   $env:MINDCARE_ALEXA_TRACE_DATABASE_URL = $env:MINDCARE_DATABASE_URL
 *   pnpm vitest run tests/integration/alexa-knowledge-trace.live.test.ts
 */
const url = process.env["MINDCARE_ALEXA_TRACE_DATABASE_URL"];

const questions = [
  "Quelles précautions pour la sertraline ?",
  "Quelle est la posologie de la sertraline dans la dépression ?",
  "Quels sont les critères diagnostiques du trouble dépressif caractérisé ?",
  "Que faire en cas d'insuffisance rénale sous lithium ?",
  "Quels effets indésirables de la clozapine ?",
  "Comment surveiller un patient sous lithium ?",
  "Quelles sont les contre-indications de la paroxétine ?",
  "Traitement de première intention du trouble bipolaire",
  "Comment titrer la clozapine chez un patient schizophrène ?",
] as const;

interface QueryTrace {
  query: string;
  ms: number;
  rows: number;
  error: string | null;
  titles: string[];
  sections: string[];
  topScore: number | null;
}

describe.skipIf(!url)("alexa knowledge trace (read-only)", () => {
  it("traces every planned lexical gate for fixed questions", async () => {
    const client = new Client({ connectionString: url!, connectionTimeoutMillis: 20_000, statement_timeout: 20_000 });
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL ROLE authenticated");
    const trace: unknown[] = [];
    try {
      for (const question of questions) {
        const plan = planKnowledgeQuery(question);
        if (plan === null) {
          trace.push({ question, planned: false, queries: [] });
          continue;
        }
        const queries: QueryTrace[] = [];
        for (const query of plan.queries.slice(0, 8)) {
          const started = performance.now();
          try {
            const rows = await client.query<{
              source_titre: string; section: string | null; score: number;
            }>("select source_titre, section, score from app.search_knowledge_lexical($1,$2,$3)", [
              query, plan.language, 20,
            ]);
            const titles = [...new Set(rows.rows.map(r => r.source_titre))];
            const sections = [...new Set(rows.rows.map(r => r.section ?? "").filter(Boolean))].slice(0, 6);
            const scores = rows.rows.map(r => Number(r.score)).filter(Number.isFinite);
            queries.push({
              query, ms: Math.round(performance.now() - started), rows: rows.rows.length, error: null,
              titles, sections, topScore: scores.length ? Math.max(...scores) : null,
            });
          } catch (error) {
            queries.push({
              query, ms: Math.round(performance.now() - started), rows: 0,
              error: error instanceof Error ? `${(error as { code?: string }).code ?? ""} ${error.message}`.slice(0, 160) : "unknown",
              titles: [], sections: [], topScore: null,
            });
          }
        }
        trace.push({ question, planned: true, language: plan.language, book: plan.sourceLabel ?? plan.sourceTitle, queries });
      }
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
    }

    const directory = join(".eval-out", "alexa-trace");
    await mkdir(directory, { recursive: true });
    const file = join(directory, `lexical-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
    await writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), questions: trace }, null, 2), "utf8");
    console.log(`[alexa-trace] ${file}`);
    for (const entry of trace as { question: string; planned: boolean; queries: QueryTrace[] }[]) {
      const total = entry.queries.reduce((sum, q) => sum + q.rows, 0);
      const ms = entry.queries.reduce((sum, q) => sum + q.ms, 0);
      console.log(`[alexa-trace] planned=${entry.planned} rows=${total} ms=${ms} :: ${entry.question}`);
      for (const q of entry.queries) {
        console.log(`    rows=${q.rows} ms=${q.ms} top=${q.topScore?.toFixed(4) ?? "-"} titles=${q.titles.join(" | ")} :: ${q.query}`);
      }
    }
    expect(trace).toHaveLength(questions.length);
  }, 120_000);
});
