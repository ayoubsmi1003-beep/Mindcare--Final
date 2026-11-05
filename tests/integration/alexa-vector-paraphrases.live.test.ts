import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { readKnowledge, dependancesReadKnowledge } from "@/server/alexa/knowledge-adapter";
import type { ClientSql, ReponseRpc } from "@/server/jarvis/client-sql";

/**
 * Paraphrase recall: lexical-only vs the existing 768-d e5-base index.
 * These questions are deliberately NOT the frozen golden questions.
 *
 *   $env:MINDCARE_ALEXA_TRACE_DATABASE_URL = $env:MINDCARE_DATABASE_URL
 *   $env:MINDCARE_ALEXA_VECTOR = "1"
 */
process.env["KNOWLEDGE_VECTOR"] = "1";
process.env["KNOWLEDGE_VECTOR_RECETTE"] = "e5-base";

const url = process.env["MINDCARE_ALEXA_TRACE_DATABASE_URL"];
const enabled = process.env["MINDCARE_ALEXA_VECTOR"] === "1" && Boolean(url);
const questions = [
  "Quels sont les risques rénaux du lithium ?",
  "Que faire si un patient sous lithium a une insuffisance rénale ?",
  "Effets secondaires hématologiques de la clozapine ?",
  "Comment débuter la sertraline chez une personne âgée ?",
  "Contre-indications du valproate chez la femme enceinte ?",
  "Quel est le mécanisme de la lamotrigine ?",
  "Que faire en cas de syndrome sérotoninergique ?",
  "Posologie de l'aripiprazole dans la schizophrénie ?",
  "Surveillance biologique sous olanzapine ?",
  "Traitement de première intention du trouble bipolaire ?",
];

describe.skipIf(!enabled)("vector paraphrase recall", () => {
  it("compares lexical and hybrid retrieval", async () => {
    const client = new Client({ connectionString: url!, connectionTimeoutMillis: 20_000, statement_timeout: 30_000 });
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL ROLE authenticated");
    const failure = (technical: string): ReponseRpc<unknown[]> => ({ data: null, error: { code: "indisponible", message: "indisponible", technical, context: "vector-test" } });
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
    try {
      const hybrid = dependancesReadKnowledge();
      console.log(JSON.stringify({ hybridActif: hybrid.vectorActif, recipe: hybrid.vectorielSecondaire ?? null, rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) }));
      for (const question of questions) {
        const lexicalStart = performance.now();
        const lexical = await readKnowledge(sql, question, undefined, { vectorActif: false });
        const lexicalMs = Math.round(performance.now() - lexicalStart);
        const hybridStart = performance.now();
        const vector = await readKnowledge(sql, question, undefined, hybrid);
        const hybridMs = Math.round(performance.now() - hybridStart);
        console.log(JSON.stringify({
          question,
          lexical: { etat: lexical.etat, proofs: lexical.preuves.length, ms: lexicalMs, section: lexical.preuves[0]?.section ?? null },
          hybrid: { etat: vector.etat, proofs: vector.preuves.length, ms: hybridMs, section: vector.preuves[0]?.section ?? null, vectoriel: "vectoriel" in vector ? vector.vectoriel ?? null : null },
          rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        }));
      }
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
    }
    expect(questions).toHaveLength(10);
  }, 900_000);
});
