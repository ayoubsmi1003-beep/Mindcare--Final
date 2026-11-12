/**
 * Does a question about one aspect of one drug reach THAT drug's own monograph section? A structural check, no hand-written truth:
 * the Prescriber's Guide titles every monograph "<Drug> › … › <Rubric>", so the right passage is known from the drug and the aspect.
 * Development wordings only (never C270 or H270), several per aspect, on drugs chosen across classes, several of them spelled
 * differently in French ("disulfirame", "prégabaline"). Only pairs whose section exists in the corpus are judged: many monographs
 * have no "Elderly" or "Habit Forming" rubric of their own (a data limitation, not a retrieval failure).
 *   MINDCARE_ALEXA_TRACE_DATABASE_URL=postgres://postgres@…/alexa_eval_v8_intelligence_20261027 pnpm vitest run tests/integration/alexa-book-aspects.live.test.ts
 * Read-only transaction. The existing sections are listed first; the searches then run as role `authenticated`, book gates only.
 */
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { readKnowledge, dependancesReadKnowledge } from "@/server/alexa/knowledge-adapter";
import type { ClientSql, ReponseRpc } from "@/server/jarvis/client-sql";

process.env["KNOWLEDGE_VECTOR"] = "1";
process.env["KNOWLEDGE_VECTOR_RECETTE"] = "e5-base";
const url = process.env["MINDCARE_ALEXA_TRACE_DATABASE_URL"];

const DRUGS: readonly (readonly [string, string])[] = [
  ["mirtazapine", "mirtazapine"], ["clonidine", "clonidine"], ["prégabaline", "pregabalin"], ["vortioxétine", "vortioxetine"],
  ["quétiapine", "quetiapine"], ["lamotrigine", "lamotrigine"], ["zolpidem", "zolpidem"], ["buspirone", "buspirone"],
  ["modafinil", "modafinil"], ["naltrexone", "naltrexone"], ["agomélatine", "agomelatine"], ["trazodone", "trazodone"],
  ["disulfirame", "disulfiram"], ["gabapentine", "gabapentin"], ["prazosine", "prazosin"], ["méthylphénidate", "methylphenidate"],
  ["sertraline", "sertraline"], ["lithium", "lithium"], ["halopéridol", "haloperidol"], ["venlafaxine", "venlafaxine"],
];
const ASPECTS: readonly { rubric: string; ask: readonly ((drug: string) => string)[] }[] = [
  { rubric: "how the drug works", ask: [(d) => `Comment agit la ${d} ?`, (d) => `Quel est le mode d'action de la ${d} ?`, (d) => `Par quel mécanisme la ${d} fonctionne-t-elle ?`] },
  { rubric: "commonly prescribed for", ask: [(d) => `Dans quelles indications prescrit-on la ${d} ?`, (d) => `La ${d}, c'est indiqué pour quoi ?`, (d) => `Quelles sont les indications de la ${d} ?`] },
  { rubric: "elderly", ask: [(d) => `Quelles précautions avec la ${d} chez le sujet âgé ?`, (d) => `La ${d} chez la personne âgée ?`] },
  { rubric: "habit forming", ask: [(d) => `La ${d} entraîne-t-elle une dépendance ?`, (d) => `Risque d'accoutumance avec la ${d} ?`] },
  { rubric: "how long until it works", ask: [(d) => `Quel est le délai d'action de la ${d} ?`, (d) => `Au bout de combien de temps la ${d} agit-elle ?`] },
];
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

describe.skipIf(!url)("drug aspect → that drug's monograph section", () => {
  it("measures hit@1 and hit@5 per aspect", async () => {
    const client = new Client({ connectionString: url!, connectionTimeoutMillis: 20_000, statement_timeout: 30_000 });
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    const listed = await client.query<{ section: string }>("select distinct section from app.knowledge_chunks where statut = 'active'");
    const exists = new Set(listed.rows.map((row) => { const parts = fold(row.section).split("›").map((part) => part.trim()); return `${parts[0]}|${parts.at(-1)}`; }));
    await client.query("SET LOCAL ROLE authenticated");
    const failure = (technical: string): ReponseRpc<unknown[]> => ({ data: null, error: { code: "indisponible", message: "indisponible", technical, context: "aspects" } });
    const sql: ClientSql = {
      rpc: async <T = unknown>(name: string, args: Readonly<Record<string, unknown>> = {}): Promise<ReponseRpc<T>> => {
        if (!/^search_knowledge_(?:lexical|vector)/u.test(name) || Object.keys(args).length === 0) return failure(`unexpected:${name}`) as ReponseRpc<T>;
        try {
          const keys = Object.keys(args);
          const result = await client.query(`select * from app.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(", ")})`, keys.map((key) => args[key]));
          return { data: result.rows as T, error: null };
        } catch (error) {
          return failure(`sql:${(error as { code?: string }).code ?? "unknown"}`) as ReponseRpc<T>;
        }
      },
    };
    const tally: Record<string, { n: number; top1: number; top5: number }> = {};
    let absent = 0;
    const misses: string[] = [];
    try {
      for (const aspect of ASPECTS) for (const [index, [french, root]] of DRUGS.entries()) {
        if (!exists.has(`${root}|${aspect.rubric}`)) { absent++; continue; }
        const question = aspect.ask[index % aspect.ask.length]!(french);
        const result = await readKnowledge(sql, question, undefined, dependancesReadKnowledge());
        const right = (section: string | null | undefined) => { const parts = fold(section ?? "").split("›").map((part) => part.trim()); return (parts[0] ?? "").startsWith(root) && parts.at(-1) === aspect.rubric; };
        const ranks = result.preuves.map((proof) => right(proof.section));
        const row = (tally[aspect.rubric] ??= { n: 0, top1: 0, top5: 0 });
        row.n++; if (ranks[0]) row.top1++; if (ranks.slice(0, 5).some(Boolean)) row.top5++;
        if (!ranks[0]) misses.push(`${question} → ${result.etat} ${result.preuves.slice(0, 2).map((proof) => proof.section ?? "").join(" ; ")}`);
      }
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
    }
    const sum = Object.values(tally).reduce((all, row) => ({ n: all.n + row.n, top1: all.top1 + row.top1, top5: all.top5 + row.top5 }), { n: 0, top1: 0, top5: 0 });
    console.log(JSON.stringify({ ...tally, all: sum, pairsWithoutSection: absent }, null, 1));
    console.log(misses.join("\n"));
    expect(Object.keys(tally)).toHaveLength(ASPECTS.length);
  }, 3_600_000);
});
