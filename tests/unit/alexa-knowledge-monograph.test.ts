import { describe, expect, it } from "vitest";
import { monographOwner, monographPriorityNames, monographsFirst, sectionOnAspect } from "@/server/alexa/knowledge-monograph";
import { planKnowledgeQuery } from "@/server/alexa/knowledge-query";

const order = (sections: string[], names: string[], rubrics: string[] = [], eligible: (row: string) => boolean = () => true) =>
  monographsFirst(sections, { sectionOf: row => row, keyOf: row => row, names, rubrics, eligible });

describe("own monograph priority", () => {
  it("recognizes a drug only from the exact section root", () => {
    expect(monographOwner("Lithium › Dosing and Use › Tests", ["lithium"])).toBe("lithium");
    expect(monographOwner("Valproate (Valproic Acid) › Dosing and Use", ["valproate"])).toBe("valproate");
    expect(monographOwner("Reboxetine › Side Effects › Mirtazapine", ["mirtazapine"])).toBeNull();
    expect(monographOwner("Part 1: Drug treatment › Chapter 2 › Lithium", ["lithium"])).toBeNull();
    expect(monographOwner("Lithium toxicity › Management", ["lithium"])).toBeNull();
    expect(monographOwner("Lithium", ["lithium"])).toBeNull();
  });
  it("puts the drug ahead of another drug's monograph that mentions it", () => {
    expect(order(["Reboxetine › Side Effects", "Mirtazapine › Side Effects"], ["mirtazapine"])[0]).toBe("Mirtazapine › Side Effects");
  });
  it("never removes evidence and leaves room for other books", () => {
    const rows = ["Part 1 › Chapter 2", "Lithium › A", "Lithium › B", "Lithium › C", "DSM › X"];
    const result = order(rows, ["lithium"]);
    expect([...result].sort()).toEqual([...rows].sort());
    expect(result.slice(0, 3)).toEqual(["Lithium › A", "Lithium › B", "Part 1 › Chapter 2"]);
  });
  it("only sections on the asked aspect lead", () => {
    const rows = ["Part 2 › Chapter 8 › Renal", "Lithium › Special Populations › Hepatic Impairment"];
    expect(order(rows, ["lithium"], ["Renal Impairment"])).toEqual(rows);
    expect(order([...rows, "Lithium › Special Populations › Renal Impairment"], ["lithium"], ["Renal Impairment"])[0]).toBe("Lithium › Special Populations › Renal Impairment");
  });
  it("a row that fails the eligibility floor can't lead", () => {
    expect(order(["Other › X", "Lithium › A"], ["lithium"], [], row => row !== "Lithium › A")[0]).toBe("Other › X");
  });
  it("duplicates don't use up a place", () => {
    const rows = [{ section: "Lithium › A", key: "a" }, { section: "Lithium › A", key: "a" }, { section: "Lithium › B", key: "b" }];
    const result = monographsFirst(rows, { sectionOf: row => row.section, keyOf: row => row.key, names: ["lithium"], rubrics: [], eligible: () => true });
    expect(result.slice(0, 2).map(row => row.key)).toEqual(["a", "b"]);
  });
  it("gives each drug a place when an aspect is asked", () => {
    expect(order(["Lithium › X › Pregnancy", "Lithium › Y › Pregnancy", "Valproate › X › Pregnancy"], ["lithium", "valproate"], ["Pregnancy"]).slice(0, 2)).toEqual(["Lithium › X › Pregnancy", "Valproate › X › Pregnancy"]);
  });
  it("changes nothing without a named drug", () => {
    const rows = ["DSM › X", "Lithium › A"];
    expect(order(rows, [])).toEqual(rows);
  });
});

describe("aspect matching", () => {
  it("reads the last segment, by whole words", () => {
    expect(sectionOnAspect("Lithium › Side Effects › Notable Side Effects", ["side effects"])).toBe(true);
    expect(sectionOnAspect("Lithium › Dosing and Use › Overdose", ["dose"])).toBe(false);
    expect(sectionOnAspect("Lithium › Dosing and Use › Other Warnings/Precautions", ["How to Dose", "Dosing Tips", "Usual Dosage Range"])).toBe(false);
    expect(sectionOnAspect("Lithium › Contraindications", ["indications"])).toBe(false);
  });
});

describe("a drug that may be excluded gets no priority", () => {
  for (const question of ["Traitement bipolaire sans lithium ?", "Quel traitement à la place du lithium ?", "Dans quels cas ne faut-il pas prescrire le lithium ?", "Le lithium est-il contre-indiqué ?", "Une femme qui n'est pas enceinte sous lithium ?", "Quoi d'autre que le lithium ?", "Par quoi remplacer le lithium ?"]) {
    it(question, () => expect(monographPriorityNames(question, ["lithium"], ["Pregnancy"])).toEqual([]));
  }
  it("a plain question with an aspect keeps it", () => expect(monographPriorityNames("Effets indésirables du lithium ?", ["lithium"], ["Side Effects"])).toEqual(["lithium"]));
  it("no aspect means no priority, even for one drug", () => expect(monographPriorityNames("Lithium et thyroïde ?", ["lithium"], [])).toEqual([]));
  for (const question of ["Quoi hormis le lithium ?", "Quoi à part le lithium pour le trouble bipolaire ?", "En dehors du lithium ?", "Autre chose que le lithium ?", "Échec du lithium, que faire ?", "Intolérance au lithium ?", "En cas de contre-indication au lithium ?", "Elle ne supporte plus le lithium ?", "Le lithium est inefficace ?", "Faut-il éviter le lithium ?", "What other than lithium?", "Valproate rather than lithium?"]) {
    it(`another exclusion wording: ${question}`, () => expect(monographPriorityNames(question, ["lithium"], ["Side Effects"])).toEqual([]));
  }
  it("an interaction with no aspect gets none", () => expect(monographPriorityNames("Interaction entre lithium et valproate ?", ["lithium", "valproate"], [])).toEqual([]));
});

describe("whole topics", () => {
  const queries = (question: string) => planKnowledgeQuery(question)?.queries ?? [];
  it("search on the English heading alone", () => {
    expect(queries("Comment traiter un sevrage alcoolique ?")).toContain("Alcohol withdrawal");
    expect(queries("Comment traiter un épisode maniaque aigu ?")).toContain("Treatment of acute mania");
    expect(queries("Quels psychotropes chez le sujet âgé ?")).toContain("Prescribing in older people");
  });
  it("alcohol withdrawal doesn't read as stopping a drug", () => {
    expect(queries("Comment traiter un sevrage alcoolique ?").some(query => /how to stop/iu.test(query))).toBe(false);
  });
  for (const [question, heading] of [
    ["Comment traiter un épisode maniaque chez l'enfant ?", "Treatment of acute mania"],
    ["Quelle dose de psilocybine dans un épisode maniaque ?", "Treatment of acute mania"],
    ["Sevrage alcoolique sous diazépam pendant la grossesse ?", "Alcohol withdrawal"],
    ["Critères de l'épisode maniaque ?", "Treatment of acute mania"],
  ] as const) {
    it(`another restriction keeps the heading from standing alone: ${question}`, () => expect(queries(question)).not.toContain(heading));
  }
  it("removed topics don't answer for another drug class", () => {
    expect(queries("Syndrome d'arrêt des benzodiazépines ?").join(" ")).not.toMatch(/antidepressant/iu);
    expect(queries("Quelle dose de psilocybine dans la dépression résistante ?").join(" ")).not.toMatch(/treatment.resistant/iu);
  });
  it("bare pregnant wording doesn't fire under a negation", () => {
    expect(planKnowledgeQuery("Le lithium chez une patiente qui n'est pas enceinte ?")?.queries.join(" ")).not.toMatch(/pregnancy/iu);
    expect(planKnowledgeQuery("Le lithium chez une patiente enceinte ?")?.queries.join(" ")).toMatch(/pregnancy/iu);
  });
  it("a restricted whole topic keeps no heading variant", () => {
    expect(queries("Sevrage alcoolique sous diazépam pendant la grossesse ?").join(" ")).not.toMatch(/alcohol withdrawal/iu);
  });
  it("a drug outside the closed list still anchors a retry", () => {
    expect(planKnowledgeQuery("Quelle posologie de la lurasidone dans la cyclothymie ?")?.recoveryQueries?.some(entry => /lurasidone/u.test(entry.query))).toBe(true);
  });
  it("a retry never pairs a drug with itself", () => {
    for (const question of ["Le modafinil est-il vendu à Alger ?", "La cariprazine est-elle disponible en Algérie ?", "Le topiramate est-il remboursé par la CNAS ?"]) {
      for (const entry of planKnowledgeQuery(question)?.recoveryQueries ?? []) {
        const [first, second] = entry.query.split(" ");
        expect(first).not.toBe(second);
      }
    }
  });
  it("an unknown subject with no known drug gets no retry", () => {
    expect(planKnowledgeQuery("Quelle dose de psilocybine dans la dépression ?")?.recoveryQueries).toBeUndefined();
  });
  it("a drug on the closed list still anchors a retry", () => {
    expect(planKnowledgeQuery("Quelle posologie du lithium dans la cyclothymie ?")?.recoveryQueries?.some(entry => /lithium/u.test(entry.query))).toBe(true);
  });
  it("French pregnancy wording reaches the English heading", () => {
    expect(queries("Le valproate chez la femme enceinte ?")).toContain("Pregnancy valproate");
  });
  it("a recognized aspect is exposed for ordering", () => {
    expect(planKnowledgeQuery("Comment agit l'aripiprazole ?")?.aspectRubrics).toContain("How the Drug Works");
  });
  it("opposite wording doesn't read as an indication", () => {
    expect(planKnowledgeQuery("Dans quels cas ne faut-il pas prescrire le lithium ?")?.aspectRubrics ?? []).not.toContain("Commonly Prescribed for");
    expect(planKnowledgeQuery("Dans quels cas arrêter le lithium ?")?.aspectRubrics ?? []).not.toContain("Commonly Prescribed for");
    expect(planKnowledgeQuery("À quelle dose prescrit-on le lithium ?")?.aspectRubrics ?? []).not.toContain("Commonly Prescribed for");
    expect(planKnowledgeQuery("Dans quels cas prescrit-on le lithium ?")?.aspectRubrics).toContain("Commonly Prescribed for");
  });
  it("a question without a clinical concept stays unexpanded", () => {
    expect(planKnowledgeQuery("Prix du lithium en Algérie ?")?.aspectRubrics).toBeUndefined();
  });
});
