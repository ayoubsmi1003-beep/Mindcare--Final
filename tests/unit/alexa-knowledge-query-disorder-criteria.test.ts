import { describe, expect, it } from "vitest";
import { ownsLeafSubject, planKnowledgeQuery } from "@/server/alexa/knowledge-query";

// Development wordings, never C270/H270.
describe("a disorder asked for what makes it is searched in its own diagnostic criteria", () => {
  it("adds the manual's term with « critères diagnostiques », and names the disorder whose criteria lead", () => {
    for (const [question, subject] of [
      ["Comment se manifeste la kleptomanie ?", "kleptomanie"],
      ["À partir de quel moment parle-t-on d'énurésie ?", "enuresie"],
      ["Que recouvre exactement la personnalité évitante ?", "personnalite evitante"],
      ["La pyromanie, elle devient diagnostique au bout de combien de temps ?", "pyromanie"],
      ["Qu'appelle-t-on dépersonnalisation ?", "depersonnalisation"],
    ] as const) {
      const plan = planKnowledgeQuery(question)!;
      expect(plan.queries, question).toContain(`${subject} criteres diagnostiques`);
      expect(plan.leafHint, question).toBe("criteres diagnostiques");
      expect(plan.leafSubject, question).toBe(subject);
    }
  });
  it("leaves another rubric, a treatment and a drug question to their own passages", () => {
    for (const question of ["La kleptomanie est-elle fréquente ?", "Comment évolue la pyromanie avec l'âge ?", "Quel traitement pour la boulimie ?", "Comment se présente un surdosage de lithium ?", "Quels diagnostics différentiels pour l'énurésie ?"]) {
      expect(planKnowledgeQuery(question)?.leafSubject, question).toBeUndefined();
    }
  });
  it("counts a criteria passage as the disorder's own only under that disorder's heading, never another's or the chapter's", () => {
    expect(ownsLeafSubject("Section II › Troubles des conduites alimentaires › Boulimie › Critères diagnostiques", "Boulimie — critères diagnostiques — A.", "boulimie")).toBe(true);
    expect(ownsLeafSubject("Section II › Troubles des conduites alimentaires", "Accès hyperphagiques 307.51 — critères diagnostiques — … sans boulimie", "boulimie")).toBe(false);
    expect(ownsLeafSubject("Section II › Troubles disruptifs, du contrôle des impulsions", "Trouble oppositionnel avec provocation — critères diagnostiques", "disruptif")).toBe(false);
  });
});
