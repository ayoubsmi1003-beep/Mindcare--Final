import { describe, expect, it } from "vitest";
import { estQuestionMedicale } from "../../src/server/jarvis/domaine-medical";
import { classerMultilingue } from "../../src/shared/jarvis/normalisation";

describe("medical knowledge routing", () => {
  it("routes an explicit book dose question to knowledge without mounting patient tools", () => {
    expect(classerMultilingue("Que disent les livres sur la posologie du lithium ?").chemin).toBe("connaissance");
    expect(classerMultilingue("Que disent les livres sur la posologie du patient ?").chemin).toBe("patient");
    expect(classerMultilingue("Que disent les livres sur la posologie du lithium pour Karim ?").chemin).toBe("patient");
  });
  it.each([
    "sertraline 50 mg", "Quel est le diagnostic de la dépression ?",
    "What are the contraindications of lithium?", "ما هو علاج الاكتئاب؟",
    "wach dwa pour l'anxiété?", "Trouble bipolaire et sommeil", "Is clozapine safe?",
  ])("routes %s to book-only evidence", (text) => {
    expect(estQuestionMedicale(text)).toBe(true);
  });
  it.each(["budget de performance", "Traduis cette phrase", "Bonjour", "résume le document administratif"])(
    "keeps %s in general knowledge", (text) => {
      expect(estQuestionMedicale(text)).toBe(false);
    },
  );
});
