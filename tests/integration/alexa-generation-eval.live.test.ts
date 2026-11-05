import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";
import { readKnowledge, dependancesReadKnowledge } from "@/server/alexa/knowledge-adapter";
import { synthesizeKnowledge } from "@/server/alexa/knowledge-synthesis";
import type { ClientSql, ReponseRpc } from "@/server/jarvis/client-sql";

/**
 * Diagnostic: what the real compact synthesis does with real hybrid evidence.
 * It records why the selector rejects the model output; it never stores source
 * or answer text. Gated by MINDCARE_ALEXA_GEN=1.
 */
process.env["ALEXA_LOCAL_TIMINGS"] = "1";
process.env["KNOWLEDGE_VECTOR"] = "1";
process.env["KNOWLEDGE_VECTOR_RECETTE"] = "e5-base";

const url = process.env["MINDCARE_ALEXA_TRACE_DATABASE_URL"];
const enabled = process.env["MINDCARE_ALEXA_GEN"] === "1" && Boolean(url);
const questions = [
  "Quels sont les risques rénaux du lithium ?",
  "Quels effets hématologiques de la clozapine ?",
  "Contre-indications du valproate chez la femme enceinte ?",
  "Comment débuter la sertraline chez une personne âgée ?",
  "Quel est le mécanisme de la lamotrigine ?",
  "Que faire en cas de syndrome sérotoninergique ?",
  "Quelle posologie pour l'aripiprazole dans la schizophrénie ?",
  "Quelle surveillance biologique sous olanzapine ?",
  "Traitement de première intention du trouble bipolaire ?",
  "Quelles précautions rénales avec le lithium ?",
];

describe.skipIf(!enabled)("compact synthesis diagnostic", () => {
  it("records the selector outcome and fallback reason for ten questions", async () => {
    const client = new Client({ connectionString: url!, connectionTimeoutMillis: 20_000, statement_timeout: 30_000 });
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL ROLE authenticated");
    const failure = (technical: string): ReponseRpc<unknown[]> => ({ data: null, error: { code: "indisponible", message: "indisponible", technical, context: "gen-eval" } });
    const sql: ClientSql = {
      rpc: async <T = unknown>(name: string, args: Readonly<Record<string, unknown>> = {}): Promise<ReponseRpc<T>> => {
        const keys = Object.keys(args);
        if (!/^search_knowledge_(?:lexical|vector)/u.test(name) || keys.length === 0) return failure(`unexpected:${name}`) as ReponseRpc<T>;
        try {
          const named = keys.map((key, index) => `${key} => $${index + 1}`).join(", ");
          const result = await client.query(`select * from app.${name}(${named})`, keys.map(key => args[key]));
          return { data: result.rows as T, error: null };
        } catch (error) {
          return failure(`sql:${(error as { code?: string }).code ?? "unknown"}`) as ReponseRpc<T>;
        }
      },
    };
    const outcomes = [];
    try {
      for (const question of questions) {
        const started = performance.now();
        const retrieved = await readKnowledge(sql, question, undefined, dependancesReadKnowledge());
        const warnings: string[] = [];
        const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
          try { warnings.push(args.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" ")); } catch { warnings.push("unserializable"); }
        });
        let events;
        try {
          events = await synthesizeKnowledge(retrieved, question, "fr", new AbortController().signal, { compact: true });
        } finally {
          spy.mockRestore();
        }
        const ms = Math.round(performance.now() - started);
        const sentences = events.filter(event => event.type === "sentence");
        const text = sentences.map(event => event.type === "sentence" ? event.text : "").join(" ");
        const fallback = warnings.filter(line => line.includes("source-fallback")).map(line => line.replace(/^.*source-fallback\s*/u, ""));
        const languageShape = warnings.find(line => line.includes("language-shape")) ?? null;
        const localFailure = warnings.find(line => line.includes("local-failure")) ?? null;
        const outcome = {
          question,
          etat: retrieved.etat,
          proofs: retrieved.preuves.length,
          ms,
          chars: text.length,
          citation: /Passage cité/iu.test(text),
          unavailable: /synthèse .*indisponible/iu.test(text),
          fallback,
          languageShape,
          localFailure,
        };
        outcomes.push(outcome);
        console.log(JSON.stringify(outcome));
      }
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
    }
    const summary = {
      total: outcomes.length,
      cited: outcomes.filter(outcome => outcome.citation).length,
      unavailable: outcomes.filter(outcome => outcome.unavailable).length,
      fallbacks: outcomes.flatMap(outcome => outcome.fallback),
      modelFailures: outcomes.filter(outcome => outcome.localFailure).length,
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
    console.log(JSON.stringify({ summary }));
    expect(outcomes).toHaveLength(questions.length);
  }, 1_200_000);
});
