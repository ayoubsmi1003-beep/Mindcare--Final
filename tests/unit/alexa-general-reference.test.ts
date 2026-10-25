import { describe, expect, it } from "vitest";
import { findVerifiedPublicFact } from "@/server/alexa/general-reference";

describe("findVerifiedPublicFact", () => {
  it.each([
    ["Pourquoi la Lune ne tombe pas sur la Terre ?", "moon-orbit"],
    ["Comment se forment les couleurs d’un arc en ciel ?", "rainbow"],
    ["Pourquoi notre ciel apparaît-il bleu ?", "blue-sky"],
    ["Que fait le processeur quand un ordinateur exécute un programme ?", "computer"],
    ["Donne-moi une définition simple d’un algorithme.", "algorithm"],
    ["Pourquoi les saisons changent-elles au fil de l’année ?", "seasons"],
    ["Qu’est-ce qui permet à un avion de rester en vol ?", "airplane-flight"],
    ["Quelle distinction y a-t-il entre une planète et une étoile ?", "planet-star"],
    ["À quelle condition l’eau entre-t-elle en ébullition ?", "boiling"],
    ["Comment les gouttelettes deviennent-elles de la pluie ?", "rain"],
    ["Pourquoi le jour et la nuit se succèdent-ils ?", "day-night"],
    ["Pourquoi la glace flotte-t-elle sur l’eau ?", "ice-density"],
    ["Quelle est la différence entre un son aigu et un son grave ?", "sound-pitch"],
  ])("retrieves a verified local fact for a French paraphrase", (question, id) => {
    const fact = findVerifiedPublicFact(question);
    expect(fact).toMatchObject({ id, answer: expect.any(String), sourceUrl: expect.stringMatching(/^https:\/\//) });
    expect(fact!.answer.length).toBeLessThan(400);
  });

  it("does not guess when a public question has no matching local source", () => {
    expect(findVerifiedPublicFact("Pourquoi certaines montagnes sont-elles volcaniques ?")).toBeNull();
  });

  it.each([
    ["Pourquoi le ciel paraît bleu ?", "longueurs d'onde courtes"],
    ["Pourquoi l’eau bout-elle ?", "se transforme en vapeur"],
    ["Pourquoi le jour et la nuit se succèdent-ils ?", "tourne sur son axe"],
    ["Pourquoi la glace flotte-t-elle sur l’eau ?", "moins dense que l’eau liquide"],
    ["Quelle est la différence entre un son aigu et un son grave ?", "fréquence"],
  ])("keeps the key explanatory phrase in the sourced answer", (question, phrase) => {
    expect(findVerifiedPublicFact(question)?.answer).toContain(phrase);
  });
});
