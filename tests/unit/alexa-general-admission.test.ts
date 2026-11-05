import { describe, expect, it } from "vitest";
import { isValidFrenchGeneralAnswer, canAnswerGeneralAlexa } from "@/server/alexa/model-gateway";

/**
 * Regression: the local general path must not apply the egress classifier's
 * `c1:nom-complet` rule, which matches any two consecutive capitalised words
 * and rejected ordinary French sentences containing a proper noun.
 */
describe("general answer admission", () => {
  it.each([
    "C'est Canberra. C'est la capitale de l'Australie.",
    "La France est un pays d'Europe occidentale.",
    "Le Mont Everest est le plus haut sommet du monde.",
  ])("accepts a benign French public fact: %s", answer => {
    expect(isValidFrenchGeneralAnswer(answer, false)).toBe(true);
  });

  it.each([
    "Le patient Jean Dupont prend de la sertraline.",
    "Le dossier de Marie contient une note.",
    "Appelez le 0551234567 pour le rendez-vous.",
  ])("still refuses clinical, private or contact content: %s", answer => {
    expect(isValidFrenchGeneralAnswer(answer, false)).toBe(false);
  });

  it("admits a literary question whose past participle is not an instruction", () => {
    expect(canAnswerGeneralAlexa("Qui a écrit Les Misérables ?")).toBe(true);
    expect(canAnswerGeneralAlexa("Écris au patient Jean Dupont")).toBe(false);
  });
});
