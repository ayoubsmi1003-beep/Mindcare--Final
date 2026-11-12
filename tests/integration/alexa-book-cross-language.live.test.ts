/**
 * A French question whose answer is an English passage that shares no wording with it ("Le lithium abîme-t-il la thyroïde ?" →
 * "hypothyroidism" under lithium): does that passage come first? Development wordings on drugs and effects no C270 book case
 * uses (never C270 or H270). The right passage is known without a hand-written answer: it holds the English term of the effect and
 * names the drug. Every pair was checked to exist in the approved English books.
 *   MINDCARE_ALEXA_TRACE_DATABASE_URL=postgres://postgres@…/alexa_eval_v8_intelligence_20261027 pnpm vitest run tests/integration/alexa-book-cross-language.live.test.ts
 * Read-only transaction; the searches run as role `authenticated`, book gates only.
 */
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { readKnowledge, dependancesReadKnowledge } from "@/server/alexa/knowledge-adapter";
import type { ClientSql, ReponseRpc } from "@/server/jarvis/client-sql";

process.env["KNOWLEDGE_VECTOR"] = "1";
process.env["KNOWLEDGE_VECTOR_RECETTE"] = "e5-base";
const url = process.env["MINDCARE_ALEXA_TRACE_DATABASE_URL"];

// [question, English term of the effect, drug the passage names]
const PAIRS: readonly (readonly [string, string, string])[] = [
  ["La lamotrigine peut-elle donner une éruption cutanée grave ?", "stevens-johnson", "lamotrigine"],
  ["Le lithium abîme-t-il la thyroïde ?", "hypothyroidism", "lithium"],
  ["Le valproate est-il dangereux pour le foie ?", "hepatotoxicity", "valpro"],
  ["La mirtazapine fait-elle prendre du poids ?", "weight gain", "mirtazapine"],
  ["Le bupropion peut-il déclencher une crise d'épilepsie ?", "seizure", "bupropion"],
  ["La carbamazépine fait-elle baisser les globules blancs ?", "agranulocytosis", "carbamazepine"],
  ["La quétiapine donne-t-elle de la cataracte ?", "cataract", "quetiapine"],
  ["L'olanzapine augmente-t-elle le sucre dans le sang ?", "hyperglycemia", "olanzapine"],
  ["La paroxétine en début de grossesse, quel risque pour le cœur du bébé ?", "cardiac malformations", "paroxetine"],
  ["Le méthylphénidate ralentit-il la croissance de l'enfant ?", "growth", "methylphenidate"],
  ["Faut-il doser l'ammoniémie sous valproate ?", "ammonia", "valpro"],
  ["La rispéridone fait-elle monter la prolactine ?", "prolactin", "risperidone"],
  ["L'aripiprazole peut-il pousser à jouer de façon compulsive ?", "gambling", "aripiprazole"],
  ["La venlafaxine fait-elle monter la tension ?", "blood pressure", "venlafaxine"],
  ["Le zolpidem peut-il faire marcher en dormant ?", "sleepwalking", "zolpidem"],
  ["Le pramipexole peut-il aider dans la dépression ?", "pramipexole", "pramipexole"],
  ["Peut-on associer la fluoxétine avec un IMAO ?", "serotonin syndrome", "fluoxetine"],
  ["La prégabaline peut-elle être détournée ?", "misuse", "pregabalin"],
];
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/’/gu, "'");

describe.skipIf(!url)("French question → the English passage holding the answer", () => {
  it("measures hit@1 and hit@5", async () => {
    const client = new Client({ connectionString: url!, connectionTimeoutMillis: 20_000, statement_timeout: 30_000 });
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL ROLE authenticated");
    const failure = (technical: string): ReponseRpc<unknown[]> => ({ data: null, error: { code: "indisponible", message: "indisponible", technical, context: "cross-language" } });
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
    let n = 0, top1 = 0, top5 = 0;
    const misses: string[] = [];
    try {
      for (const [question, effect, drug] of PAIRS) {
        const result = await readKnowledge(sql, question, undefined, dependancesReadKnowledge());
        const right = (proof: { extrait: string; section: string | null }) => fold(proof.extrait).includes(effect) && fold(`${proof.extrait} ${proof.section ?? ""}`).includes(drug);
        const ranks = result.preuves.map(right);
        n++; if (ranks[0]) top1++; if (ranks.slice(0, 5).some(Boolean)) top5++;
        if (!ranks[0]) misses.push(`${question} → ${result.etat}, right passage at ${ranks.indexOf(true) + 1 || "-"}; first: ${(result.preuves[0]?.section ?? "").split("›").slice(-2).join("›")}`);
      }
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
    }
    console.log(JSON.stringify({ n, top1, top5 }));
    console.log(misses.join("\n"));
    expect(n).toBe(PAIRS.length);
  }, 3_600_000);
});
