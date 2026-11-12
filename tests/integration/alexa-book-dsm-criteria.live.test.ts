/**
 * Does a question that asks, by its meaning, what makes a disorder (its definition, its threshold of time or frequency, how it
 * shows, how to recognise it) reach THAT disorder's own diagnostic criteria? A structural check, no hand-written truth: the DSM
 * files them under "<Disorder> › Critères diagnostiques" or opens the chunk with "<Disorder> — critères diagnostiques —".
 * Development wordings only, on disorders no C270 book case uses (never C270 or H270), several wordings per disorder.
 *   MINDCARE_ALEXA_TRACE_DATABASE_URL=postgres://postgres@…/alexa_eval_v8_intelligence_20261027 pnpm vitest run tests/integration/alexa-book-dsm-criteria.live.test.ts
 * Read-only transaction; the searches run as role `authenticated`, book gates only.
 */
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { readKnowledge, dependancesReadKnowledge } from "@/server/alexa/knowledge-adapter";
import type { ClientSql, ReponseRpc } from "@/server/jarvis/client-sql";

process.env["KNOWLEDGE_VECTOR"] = "1";
process.env["KNOWLEDGE_VECTOR_RECETTE"] = "e5-base";
const url = process.env["MINDCARE_ALEXA_TRACE_DATABASE_URL"];

// [as said in a question, folded words the criteria chunk is filed under]
const DISORDERS: readonly (readonly [string, string])[] = [
  ["le trouble schizophréniforme", "schizophreniforme"], ["le trouble panique", "trouble panique"], ["l'anxiété de séparation", "anxiete de separation"],
  ["le mutisme sélectif", "mutisme selectif"], ["la personnalité borderline", "personnalite borderline"], ["la personnalité évitante", "personnalite evitante"],
  ["le trouble dysphorique prémenstruel", "dysphorique premenstruel"], ["le trouble schizoaffectif", "schizoaffectif"], ["la kleptomanie", "kleptomanie"],
  ["la pyromanie", "pyromanie"], ["la narcolepsie", "narcolepsie"], ["l'anorexie mentale", "anorexie mentale"], ["la boulimie", "boulimie"],
  ["l'énurésie", "enuresie"], ["le trouble explosif intermittent", "explosif intermittent"], ["le syndrome des jambes sans repos", "jambes sans repos"],
  ["le trouble de conversion", "trouble de conversion"], ["la phobie spécifique", "phobie specifique"],
  ["le trouble disruptif avec dysrégulation émotionnelle", "dysregulation emotionnelle"], ["la dépersonnalisation", "depersonnalisation"],
];
const ASK: readonly ((d: string) => string)[] = [
  (d) => `À partir de quel moment parle-t-on de ${d.replace(/^(?:le|la|l') ?/u, "")} ?`,
  (d) => `Comment se manifeste ${d} ?`,
  (d) => `Qu'est-ce qui permet de poser ${d.replace(/^le /u, "un ").replace(/^la /u, "une ").replace(/^l'/u, "une ")} ?`,
  (d) => `Que recouvre exactement ${d} ?`,
  (d) => `Quelle durée minimale exige ${d} ?`,
  (d) => `Comment repérer ${d} ?`,
  (d) => `Comment ${d} est-il défini dans la classification ?`,
  (d) => `Quels éléments font évoquer ${d} ?`,
];
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/’/gu, "'");

describe.skipIf(!url)("disorder, asked for what makes it → that disorder's diagnostic criteria", () => {
  it("measures hit@1 and hit@5", async () => {
    const client = new Client({ connectionString: url!, connectionTimeoutMillis: 20_000, statement_timeout: 30_000 });
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL ROLE authenticated");
    const failure = (technical: string): ReponseRpc<unknown[]> => ({ data: null, error: { code: "indisponible", message: "indisponible", technical, context: "dsm-criteria" } });
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
      for (const [index, [said, root]] of DISORDERS.entries()) for (const ask of [ASK[index % ASK.length]!, ASK[(index + 3) % ASK.length]!]) {
        const question = ask(said);
        const result = await readKnowledge(sql, question, undefined, dependancesReadKnowledge());
        const right = (proof: { section?: string | null; extrait?: string }) => {
          const parts = fold(proof.section ?? "").split("›").map((part) => part.trim());
          if (parts.at(-1) === "criteres diagnostiques" && parts.some((part) => part.includes(root))) return true;
          const head = /^([^—]{2,160})—\s*criteres diagnostiques/u.exec(fold(proof.extrait ?? ""));
          return !!head && head[1]!.includes(root);
        };
        const ranks = result.preuves.map(right);
        n++; if (ranks[0]) top1++; if (ranks.slice(0, 5).some(Boolean)) top5++;
        if (!ranks[0]) misses.push(`${question} → ${result.etat} ${result.preuves.slice(0, 3).map((proof, rank) => `${rank + 1}:${proof.extrait.replace(/\s+/gu, " ").slice(0, 60)}`).join(" | ")}; criteria at ${ranks.indexOf(true) + 1 || "-"}`);
      }
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
    }
    console.log(JSON.stringify({ n, top1, top5 }));
    console.log(misses.join("\n"));
    expect(n).toBe(DISORDERS.length * 2);
  }, 3_600_000);
});
