import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { vecteurRequeteSecondaireProduction } from "@/server/knowledge/vecteur-secondaire-production";

/**
 * C270 novelty, by meaning: no C270 turn (and no H270 holdout turn, when the private file is present) may sit at cosine ≥ 0.97
 * from a C200, C201 or C202 turn under the local e5-base model. The word-overlap check runs in build-cases.mjs; this one catches
 * the same question reworded with synonyms. It needs the local model, so it runs only on request:
 *   MINDCARE_C270_NOVELTY=1 KNOWLEDGE_VECTOR_RECETTE=e5-base pnpm exec vitest run tests/unit/alexa-c270-novelty.test.ts
 */
const run = process.env["MINDCARE_C270_NOVELTY"] === "1";
// The plan first set 0.92: it flagged 186 of 330 turns, and reading the pairs, most were the same record section asked in other
// words or another period, not the same request. Pairs from 0.97 up were reworded; those between 0.92 and 0.97 are listed in doc 21.
const THRESHOLD = 0.97;
const base = join(process.cwd(), "tests", "eval", "alexa-clinical-conversational");
const strip = (text: string) => text.replace(/\{[^}]+\}/gu, "le patient").trim();
const turnsOf = (file: string) => (JSON.parse(readFileSync(file, "utf8")) as { cases: { id: string; turns: { say: string }[] }[] }).cases
  .flatMap((item) => item.turns.map((turn, index) => ({ id: `${item.id}#${index + 1}`, say: strip(turn.say) })));
const cosine = (a: readonly number[], b: readonly number[]) => { let dot = 0, na = 0, nb = 0; a.forEach((x, i) => { dot += x * b[i]!; na += x * x; nb += b[i]! * b[i]!; }); return dot / Math.sqrt(na * nb); };

describe.skipIf(!run)("C270 novelty by meaning", () => {
  it("no C270 or H270 turn is a paraphrase of an earlier campaign turn", async () => {
    const earlier = [["v1", "cases.json"], ["v2", "cases.json"], ["v2", "holdout.json"], ["v3", "cases.json"]].flatMap(([dir, file]) => turnsOf(join(base, dir!, file!)));
    const holdoutFile = join(process.cwd(), ".eval-out", "alexa-c270", "holdout.json");
    const fresh = [...turnsOf(join(base, "v4", "cases.json")), ...(existsSync(holdoutFile) ? turnsOf(holdoutFile) : [])];
    const embed = async (say: string) => { const vector = await vecteurRequeteSecondaireProduction(say); if (!vector) throw new Error("e5 model unavailable"); return vector; };
    const earlierVectors = [];
    for (const turn of earlier) earlierVectors.push({ ...turn, v: await embed(turn.say) });
    const close: string[] = [];
    for (const turn of fresh) {
      const v = await embed(turn.say);
      const best = earlierVectors.reduce((top, other) => { const score = cosine(v, other.v); return score > top.score ? { score, id: other.id } : top; }, { score: -1, id: "" });
      // Identifiers only: the holdout wording must not reach a log.
      if (best.score >= THRESHOLD) close.push(`${turn.id} ~ ${best.id} (${best.score.toFixed(3)})`);
    }
    console.log(`novelty: ${close.length} close pairs\n${close.join("\n")}`);
    expect(close).toEqual([]);
  }, 1_800_000);
});
