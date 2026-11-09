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
