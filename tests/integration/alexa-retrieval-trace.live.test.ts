import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { readKnowledge, dependancesReadKnowledge } from "@/server/alexa/knowledge-adapter";
import type { ClientSql, ReponseRpc } from "@/server/jarvis/client-sql";

process.env["KNOWLEDGE_VECTOR"] = "1";
process.env["KNOWLEDGE_VECTOR_RECETTE"] = "e5-base";
process.env["ALEXA_LOCAL_TIMINGS"] = "1";
const url = process.env["MINDCARE_ALEXA_TRACE_DATABASE_URL"];
const questions = [
  "Quelles précautions pour la sertraline ?",
  "Quelles précautions pour la sertraline ? Et pour la grossesse ?",
  "Quelles précautions pour la sertraline pendant la grossesse ?",
  "Quelle est la posologie de la sertraline ?",
  "Quelle est la posologie de la sertraline en cas d'insuffisance rénale ?",
  "Quels sont les risques rénaux du lithium ?",
  "Quels effets hématologiques de la clozapine ?",
];

describe.skipIf(!url)("retrieval trace", () => {
  it("records selected proof provenance without source text", async () => {
    const client = new Client({ connectionString: url!, connectionTimeoutMillis: 20_000, statement_timeout: 30_000 });
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL ROLE authenticated");
    const failure = (technical: string): ReponseRpc<unknown[]> => ({ data: null, error: { code: "indisponible", message: "indisponible", technical, context: "trace" } });
    const sql: ClientSql = {
      rpc: async <T = unknown>(name: string, args: Readonly<Record<string, unknown>> = {}): Promise<ReponseRpc<T>> => {
        if (!/^search_knowledge_(?:lexical|vector)/u.test(name) || Object.keys(args).length === 0) return failure(`unexpected:${name}`) as ReponseRpc<T>;
        try {
          const keys = Object.keys(args);
          const named = keys.map((key, index) => `${key} => $${index + 1}`).join(", ");
          const result = await client.query(`select * from app.${name}(${named})`, keys.map(key => args[key]));
          return { data: result.rows as T, error: null };
        } catch (error) {
          return failure(`sql:${(error as { code?: string }).code ?? "unknown"}`) as ReponseRpc<T>;
        }
      },
    };
    try {
      for (const question of questions) {
        const started = performance.now();
        const result = await readKnowledge(sql, question, undefined, dependancesReadKnowledge());
        console.log(JSON.stringify({
          question,
          etat: result.etat,
          proofs: result.preuves.length,
          ms: Math.round(performance.now() - started),
          sections: result.preuves.map(proof => proof.section ?? "").slice(0, 5),
          languages: result.preuves.map(proof => proof.langue).slice(0, 5),
        }));
      }
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
    }
    expect(questions).toHaveLength(7);
  }, 300_000);
});
