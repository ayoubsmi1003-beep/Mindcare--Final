import { describe, expect, it } from "vitest";
import { frenchManualTerms, planKnowledgeQuery } from "@/server/alexa/knowledge-query";

describe("retrieval: the doctor's word and the manual's word both get searched", () => {
  it("adds the French manual's term next to the doctor's, never instead", () => {
    const plan = planKnowledgeQuery("Quels sont les critères diagnostiques de la dépression majeure ?");
    expect(plan?.queries.some((query) => /depression/u.test(query))).toBe(true);
    expect(plan?.queries[0]).toContain("trouble depressif caracterise");
    expect(plan?.queries.some((query) => query.includes("trouble depressif caracterise"))).toBe(true);
  });
  it("only rewrites whole words and known conditions", () => {
    expect(frenchManualTerms("stocker du lithium")).toBeNull();
    expect(frenchManualTerms("criteres du tdah")).toBe("criteres du deficit attention hyperactivite");
    expect(frenchManualTerms("criteres du trouble anxieux generalise")).toBe("criteres du anxiete generalisee");
    expect(frenchManualTerms("dose de sertraline")).toBeNull();
  });
  it("keeps an English query for the English references", () => {
    const plan = planKnowledgeQuery("Quels sont les critères diagnostiques de la dépression majeure ?");
    expect(plan?.queries.some((query) => /major/u.test(query) && /criteria/u.test(query))).toBe(true);
  });
});

describe("retrieval: a disorder named in everyday words still reaches its own criteria section", () => {
  const plan = (question: string) => planKnowledgeQuery(question)!;
  it.each([
    ["Quels sont les critères diagnostiques de la dépression majeure ?", "trouble depressif caracterise"],
    ["Quels sont les critères du trouble dépressif majeur ?", "trouble depressif caracterise"],
    ["Quels sont les critères du trouble bipolaire de type II ?", "trouble bipolaire de type ii"],
    ["Quels sont les critères du bipolaire 2 ?", "trouble bipolaire de type ii"],
    ["Quels sont les critères du trouble bipolaire de type I ?", "trouble bipolaire de type i"],
  ])("reads the section of the disorder, leaf 'critères diagnostiques': %s", (question, focus) => {
    const result = plan(question);
    expect(result.sectionFocus).toBe(focus);
    expect(result.sectionLeaf).toBe("criteres diagnostiques");
  });
  it("leaves a comparison of the two bipolar types to its own two queries", () => {
    expect(plan("Quel critère permet de distinguer le trouble bipolaire de type I du type II dans le DSM-5 ?").sectionFocus).toBeUndefined();
  });
  it("does not let 'Qu'est-ce que' keep the English question from being asked", () => {
    expect(plan("Qu'est-ce que le syndrome sérotoninergique ?").queries).toContain("syndrome serotonin");
  });
  it("asks the books for 'withdrawal' alone when the doctor says 'withdrawal syndrome'", () => {
    const queries = plan("Comment arrêter une benzodiazépine sans syndrome de sevrage ?").queries;
    expect(queries).toContain("benzodiazepine withdrawal");
  });
  it("reads metabolic effects and monitoring of antipsychotics in English too", () => {
    expect(plan("Quels sont les effets métaboliques des antipsychotiques et comment les surveiller ?").queries).toContain("effects metabolic antipsychotics monitoring");
  });
});
