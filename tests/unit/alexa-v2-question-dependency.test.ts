import { describe, expect, it } from "vitest";
import { splitAlexaQuestions } from "@/shared/alexa/questions";

describe("question separation preserves antecedents and quoted text", () => {
  it.each([
    "Quels sont les effets du lithium et comment cela fonctionne ?",
    "Qu’est-ce que la pneumonie ? Comment la traiter ?",
    "ما هو الاكتئاب؟ كيف نعالج ذلك؟",
  ])("keeps dependent clinical clauses on one evidence request: %s", text => {
    expect(splitAlexaQuestions(text)).toEqual([text]);
  });
  it("does not split two clinical topics that share the same question", () => {
    expect(splitAlexaQuestions("Quelle est la différence entre dépression et anxiété ?")).toHaveLength(1);
  });
  it("preserves punctuation inside a quoted patient identifier", () => {
    expect(splitAlexaQuestions('Traitement de «Jean; Pierre» ; Quel est son diagnostic ?')).toEqual(['Traitement de «Jean; Pierre»', 'Quel est son diagnostic ?']);
  });
  it("still separates independent public questions and patient categories", () => {
    expect(splitAlexaQuestions("Pourquoi le ciel est bleu ? Combien font sept fois huit ?")).toHaveLength(2);
    expect(splitAlexaQuestions("Le traitement actuel et quel est son diagnostic ?")).toHaveLength(2);
  });
});
