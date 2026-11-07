import { describe, expect, it } from "vitest";
import { isClinicalKnowledgeQuestion } from "@/shared/alexa/request-contract";
import { asksForTreatment, rowCanAnswer } from "@/server/alexa/knowledge-source-fit";
import { substantiveQuote } from "@/server/alexa/knowledge-evidence-content";

const DSM = "DSM-5 — Manuel diagnostique", MAUDSLEY = "The Maudsley Prescribing Guidelines";

describe("what the filter leaves", () => {
  it("a definition question keeps the DSM", () => expect(rowCanAnswer("Qu'est-ce que le traitement de la manie ?", "DSM-5", "Manie", false)).toBe(true));
  it("a question about the index keeps the index", () => expect(rowCanAnswer("Que dit l'index sur la dose de lithium ?", "Stahl", "Index", false)).toBe(true));
});

describe("which rows can answer a question", () => {
  for (const question of ["Que faire devant une dyskinésie tardive ?", "Quel traitement du TDAH ?", "Comment traiter la dépendance aux opioïdes ?", "Quelle dose de psilocybine ?"]) {
    it(`the DSM doesn't answer: ${question}`, () => {
      expect(rowCanAnswer(question, DSM, "Section II › Troubles", false)).toBe(false);
      expect(rowCanAnswer(question, MAUDSLEY, "Part 1 › Chapter 1", false)).toBe(true);
    });
  }
  for (const question of ["Quels sont les critères du trouble panique ?", "Quelle dose de sertraline selon DSM5 ?", "Traitement et diagnostic de la manie ?"]) {
    it(`the DSM stays: ${question}`, () => expect(rowCanAnswer(question, DSM, "Section II › Troubles", false)).toBe(true));
  }
  it("an index row only answers a location question", () => {
    expect(rowCanAnswer("Critères du trouble panique ?", DSM, "Annexes › Index › Panique", false)).toBe(false);
    expect(rowCanAnswer("Où trouver le trouble panique ?", DSM, "Annexes › Index › Panique", true)).toBe(true);
  });
  it("a Generic? row only answers a question about generics", () => {
    expect(rowCanAnswer("La fluoxétine pendant la grossesse ?", "Prescriber's Guide", "Fluoxetine › Therapeutics › Generic?", false)).toBe(false);
    expect(rowCanAnswer("La fluoxétine existe-t-elle en générique ?", "Prescriber's Guide", "Fluoxetine › Therapeutics › Generic?", false)).toBe(true);
  });
  it("a location question keeps the DSM", () => expect(rowCanAnswer("Où trouver le traitement de la manie ?", DSM, "Section II › Troubles", true)).toBe(true));
  it("asking about symptoms isn't a treatment question", () => expect(asksForTreatment("Quels symptômes dans la manie ?")).toBe(false));
});

describe("quotes that say nothing", () => {
  for (const quote of ["Yes", "Increase if necessary.", "2009; Wittchen et al.", "2001).", "Trouble stress — 2011) et parfois pendant plus de 50 ans."]) {
    it(`rejects: ${quote}`, () => expect(substantiveQuote(quote)).toBe(false));
  }
  it("keeps a real sentence", () => expect(substantiveQuote("Withdraw antidepressants very gradually and inform patients.")).toBe(true));
});

describe("clinical questions go to the books", () => {
  for (const question of ["Comment traiter la dépendance aux opioïdes ?", "L'escitalopram chez le sujet âgé ?", "Posologie de la rispéridone ?", "Que faire en cas de dyskinésie tardive ?"]) {
    it(question, () => expect(isClinicalKnowledgeQuestion(question)).toBe(true));
  }
  for (const question of ["Son lithium ?", "Le lithium de ce patient ?", "Quel est le prix de la sertraline ?", "Le dossier est-il à jour ?", "Il fait beau ?"]) {
    it(`not: ${question}`, () => expect(isClinicalKnowledgeQuestion(question)).toBe(false));
  }
});
