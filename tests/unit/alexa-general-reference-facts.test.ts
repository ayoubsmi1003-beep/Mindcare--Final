import { describe, expect, it } from "vitest";
import { findVerifiedPublicFact } from "@/server/alexa/general-reference";

/** The verified public-fact cards must win before the local model. */
describe("verified public facts", () => {
  it.each([
    ["Quelle est la capitale de l'Australie ?", "capital-australia", /canberra/iu],
    ["Quel est le plus grand océan du monde ?", "largest-ocean", /pacifique/iu],
    ["Combien de continents y a-t-il sur Terre ?", "continents", /cinq|six|sept/iu],
    ["Qui a écrit Les Misérables ?", "les-miserables", /hugo/iu],
    ["Quel est le symbole chimique de l'or ?", "gold-symbol", /\bau\b/iu],
    ["Quelle est la planète la plus proche du Soleil ?", "closest-planet", /mercure/iu],
    ["Combien de jours compte une année bissextile ?", "leap-year", /366/iu],
    ["À quelle température l'eau bout-elle au niveau de la mer ?", "boiling", /100/iu],
    ["Qu'est-ce que la photosynthèse ?", "photosynthesis", /lumiere|lumière|chlorophylle/iu],
  ])("answers %s from %s", (question, id, expected) => {
    const fact = findVerifiedPublicFact(question);
    expect(fact?.id).toBe(id);
    expect(fact?.answer).toMatch(expected);
  });

  it("does not claim a verified fact for an unknown question", () => {
    expect(findVerifiedPublicFact("Quelle est la recette du couscous ?")).toBeNull();
  });
});
