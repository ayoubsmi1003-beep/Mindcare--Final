import { describe, expect, it } from "vitest";
import { planKnowledgeQuery } from "@/server/alexa/knowledge-query";

describe("French questions map to approved English book headings without naming a book", () => {
  it.each([
    ["Quelles précautions d’emploi avec la clozapine ?", ["clozapine", "warnings"]],
    ["Comment agit l’aripiprazole ?", ["aripiprazole", "works"]],
    ["Quel est le mécanisme d’action du lithium sur les messagers intracellulaires ?", ["lithium", "mechanism", "messenger", "intracellular"]],
    ["Quelle surveillance pour le lithium ?", ["lithium", "tests"]],
    ["Que rapporte la source sur le syndrome sérotoninergique ?", ["serotonin", "syndrome"]],
    ["Que couvre la prise en charge de l’agitation aiguë ?", ["acute", "agitation"]],
  ])("%s produces a complete English retrieval variant", (question, requiredTerms) => {
    const plan = planKnowledgeQuery(question);
    expect(plan).not.toBeNull();
    expect(plan?.sourceTitle).toBeNull();
    expect(plan?.queries.some(query => requiredTerms.every(term => query.includes(term))), plan?.queries.join(" | ")).toBe(true);
  });

  it("keeps the monitoring query while adding the approved Tests heading alternative", () => {
    const queries = planKnowledgeQuery("Quelle surveillance pour le lithium ?")?.queries ?? [];
    expect(queries.some(query => query.includes("lithium") && query.includes("monitoring"))).toBe(true);
    expect(queries.some(query => query.includes("lithium") && query.includes("tests"))).toBe(true);
  });

  it("adds Maudsley's measured acute-agitation heading without replacing the French query", () => {
    const question = "Que couvre la prise en charge de l’agitation aiguë ?";
    const plan = planKnowledgeQuery(question);
    expect(plan?.queries[0]).toContain("agitation aigue");
    expect(plan?.queries).toContain("acute agitation");

    const dsmPlan = planKnowledgeQuery("Que dit le DSM-5 sur l’agitation aiguë ?");
    expect(dsmPlan?.queries).not.toContain("acute agitation");
  });

  it("keeps medication action wording while adding the approved Works heading alternative", () => {
    const queries = planKnowledgeQuery("Quel est le mécanisme d’action du lithium sur les messagers intracellulaires ?")?.queries ?? [];
    const hasRequiredTerms = (query: string, actionTerm: string) =>
      ["lithium", "mechanism", actionTerm, "messenger", "intracellular"].every(term => query.includes(term));
    expect(queries.some(query => hasRequiredTerms(query, "action"))).toBe(true);
    expect(queries.some(query => hasRequiredTerms(query, "works"))).toBe(true);
  });
});
