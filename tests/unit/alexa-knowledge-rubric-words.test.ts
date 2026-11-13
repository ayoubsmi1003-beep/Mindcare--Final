import { describe, expect, it } from "vitest";
import { planKnowledgeQuery } from "@/server/alexa/knowledge-query";

// Development wordings, never C270/H270. Each English word is checked against the corpus vocabulary by the planner itself.
const rubrics = (question: string) => planKnowledgeQuery(question)?.aspectRubrics ?? [];
const queries = (question: string) => planKnowledgeQuery(question)?.queries ?? [];

describe("a word spelled the same in French and English still chooses its rubric", () => {
  it("reads « indications » as the monograph's « Commonly Prescribed for »", () => {
    expect(rubrics("Quelles sont les indications du lithium ?")).toContain("Commonly Prescribed for");
    expect(rubrics("Indications de la mirtazapine ?")).toContain("Commonly Prescribed for");
  });
  it("reads the singular « indication » too, before the population it is asked for", () => {
    const found = rubrics("La prégabaline, on la prescrit dans quelle indication chez l'adulte ?");
    expect(found[0]).toBe("Commonly Prescribed for");
  });
});

describe("abuse and diet in English words of the books", () => {
  it("reads « risque d'abus » as the « Habit Forming » rubric", () => {
    expect(rubrics("Le zolpidem expose-t-il à un abus ?")).toContain("Habit Forming");
  });
  it("searches « régime » as « diet »", () => {
    expect(queries("Sous tranylcypromine, faut-il suivre un régime ?").some((query) => /\bdiet\b/u.test(query))).toBe(true);
  });
});
