import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { readKnowledge } from "@/server/alexa/knowledge-adapter";
import type { ClientSql, ReponseRpc } from "@/server/jarvis/client-sql";

/**
 * Gate D — the real `readKnowledge()` pipeline on the cabinet database.
 *
 * Read-only, loopback, no patient table. The test asserts retrieval outcomes
 * and section provenance; it never prints or stores a source excerpt.
 *
 *   $env:MINDCARE_ALEXA_TRACE_DATABASE_URL = $env:MINDCARE_DATABASE_URL
 *   pnpm vitest run tests/integration/alexa-knowledge-read.live.test.ts
 */
const url = process.env["MINDCARE_ALEXA_TRACE_DATABASE_URL"];

describe.skipIf(!url)("readKnowledge on the cabinet database (read-only)", () => {
  it("returns approved evidence for the two measured failures, and still abstains outside the corpus", async () => {
    const client = new Client({ connectionString: url!, connectionTimeoutMillis: 20_000, statement_timeout: 20_000 });
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL ROLE authenticated");

    const failure = (technical: string): ReponseRpc<unknown[]> => ({
      data: null,
      error: { code: "indisponible", message: "indisponible", technical, context: "test.trace" },
    });
    const sql: ClientSql = {
      rpc: async <T = unknown>(name: string, args: Readonly<Record<string, unknown>> = {}): Promise<ReponseRpc<T>> => {
        if (name !== "search_knowledge_lexical") return failure(`unexpected:${name}`) as ReponseRpc<T>;
        try {
          const result = await client.query(
            "select * from app.search_knowledge_lexical($1,$2,$3)",
            [args["p_requete"], args["p_langue"], args["p_limite"]],
          );
          return { data: result.rows as T, error: null };
        } catch (error) {
          return failure(`sql:${(error as { code?: string }).code ?? "unknown"}`) as ReponseRpc<T>;
        }
      },
    };

    try {
      const started = performance.now();
      const sertraline = await readKnowledge(sql, "Quelles précautions pour la sertraline ?", undefined, { vectorActif: false });
      const sertralineMs = Math.round(performance.now() - started);
      const lithium = await readKnowledge(sql, "Comment surveiller un patient sous lithium ?", undefined, { vectorActif: false });
      const offCorpus = await readKnowledge(sql, "Quelle est la capitale de l'Australie ?", undefined, { vectorActif: false });

      const sections = (value: typeof sertraline) => value.preuves.map(proof => proof.section ?? "").join(" || ");
      console.log(JSON.stringify({
        sertraline: { etat: sertraline.etat, preuves: sertraline.preuves.length, ms: sertralineMs, sections: sections(sertraline) },
        lithium: { etat: lithium.etat, preuves: lithium.preuves.length, sections: sections(lithium) },
        offCorpus: { etat: offCorpus.etat, preuves: offCorpus.preuves.length },
      }, null, 2));

      expect(sertraline.etat).toBe("ok");
      expect(sertraline.preuves.length).toBeGreaterThan(0);
      expect(sections(sertraline)).toMatch(/Warnings\/Precautions/u);

      expect(lithium.etat).toBe("ok");
      expect(lithium.preuves.length).toBeGreaterThan(0);

      expect(offCorpus.etat).toBe("sans-preuve");
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
    }
  }, 120_000);
});
