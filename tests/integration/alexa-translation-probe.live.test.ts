import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readKnowledge, dependancesReadKnowledge } from "@/server/alexa/knowledge-adapter";
import { inferLocalText } from "@/server/alexa/local-model";
import { KNOWLEDGE_FRENCH_REFORMULATION_PROMPT } from "@/i18n/alexa-knowledge";
import { requestedMedicationNames } from "@/server/alexa/knowledge-evidence-content";
import type { ClientSql, ReponseRpc } from "@/server/jarvis/client-sql";

/**
 * Feasibility probe for a faithful French translation layer.
 * Deterministic checks only; no answer text is persisted.
 * Gated by MINDCARE_ALEXA_TRANSLATE=1.
 */
process.env["KNOWLEDGE_VECTOR"] = "1";
process.env["KNOWLEDGE_VECTOR_RECETTE"] = "e5-base";

const url = process.env["MINDCARE_ALEXA_TRACE_DATABASE_URL"];
const enabled = process.env["MINDCARE_ALEXA_TRANSLATE"] === "1" && Boolean(url);
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

const numbers = (value: string) => [...value.matchAll(/\d+(?:[.,]\d+)?/gu)].map(match => match[0]!.replace(",", "."));
const negation = /\b(?:no|not|never|without|avoid|unless|except|contraindicat|warning|caution)\b/iu;
const frenchNegation = /\b(?:ne|pas|jamais|sans|éviter|eviter|sauf|contre|précaution|precaution)\b/iu;
const frenchShape = /\b(?:le|la|les|des|du|un|une|est|sont|avec|pour|chez|pendant|risque|effet|dose|surveillance|rein|grossesse|patient)\b/iu;
const englishShape = /\b(?:the|and|with|should|may|risk|kidney|pregnancy|unless|except|however|although)\b/iu;

describe.skipIf(!enabled)("faithful translation probe", () => {
  it("measures preservation on ten approved passages", async () => {
    const client = new Client({ connectionString: url!, connectionTimeoutMillis: 20_000, statement_timeout: 30_000 });
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL ROLE authenticated");
    const failure = (technical: string): ReponseRpc<unknown[]> => ({ data: null, error: { code: "indisponible", message: "indisponible", technical, context: "translate" } });
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
    const schema = z.object({ sentences: z.array(z.string().min(1).max(1600)).length(1) }).strict();
    const outcomes = [];
    try {
      for (const question of questions) {
        const retrieved = await readKnowledge(sql, question, undefined, dependancesReadKnowledge());
        const passage = retrieved.preuves[0]?.extrait;
        if (!passage) { outcomes.push({ question, status: "no-evidence" }); continue; }
        const first = passage.split(/(?<=[.!?])\s+/u)[0] ?? passage;
        const draft = (first.length >= 40 ? first : passage).slice(0, 600);
        let translated: string | null = null;
        let error: string | null = null;
        try {
          const completion = await inferLocalText([
            { role: "system", content: KNOWLEDGE_FRENCH_REFORMULATION_PROMPT },
            { role: "user", content: JSON.stringify({ draft }) },
          ], { jsonSchema: z.toJSONSchema(schema, { target: "draft-7" }), timeoutMs: 120_000, maxOutputTokens: 512 });
          translated = schema.parse(JSON.parse(completion)).sentences[0]!;
        } catch (caught) {
          error = caught instanceof Error ? caught.message.slice(0, 60) : "unknown";
        }
        if (translated === null) { outcomes.push({ question, status: "model-failure", error }); continue; }
        const draftNumbers = numbers(draft), translatedNumbers = numbers(translated);
        const missingNumbers = draftNumbers.filter(number => !translatedNumbers.includes(number));
        const addedNumbers = translatedNumbers.filter(number => !draftNumbers.includes(number));
        const draftDrugs = requestedMedicationNames(draft), translatedDrugs = requestedMedicationNames(translated);
        const missingDrugs = draftDrugs.filter(drug => !translatedDrugs.includes(drug));
        const negationLost = negation.test(draft) && !frenchNegation.test(translated);
        const negationAdded = frenchNegation.test(translated) && !negation.test(draft);
        const french = frenchShape.test(translated) && !englishShape.test(translated);
        const status = !french ? "not-french"
          : missingNumbers.length === 0 && addedNumbers.length === 0 && missingDrugs.length === 0 && !negationLost && !negationAdded ? "preserved" : "unsafe";
        outcomes.push({ question, status, chars: translated.length, french, missingNumbers, addedNumbers, missingDrugs, negationLost, negationAdded });
        console.log(JSON.stringify(outcomes.at(-1)));
      }
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
    }
    const summary = {
      total: outcomes.length,
      preserved: outcomes.filter(outcome => outcome.status === "preserved").length,
      unsafe: outcomes.filter(outcome => outcome.status === "unsafe").length,
      notFrench: outcomes.filter(outcome => outcome.status === "not-french").length,
      modelFailures: outcomes.filter(outcome => outcome.status === "model-failure").length,
      noEvidence: outcomes.filter(outcome => outcome.status === "no-evidence").length,
    };
    console.log(JSON.stringify({ summary }));
    expect(outcomes).toHaveLength(questions.length);
  }, 1_200_000);
});
