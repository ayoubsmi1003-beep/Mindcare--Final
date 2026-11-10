import { expect, it } from "vitest";
import { canAnswerGeneralAlexa, isValidFrenchGeneralAnswer } from "@/server/alexa/model-gateway";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";

it.each([
  "Quel est le nom de la capitale de l'Australie ?",
  "Quel est le rôle du foie dans la digestion d'un oiseau ?",
  "Comment prendre des notes efficacement ?",
])("does not refuse an ordinary public question: %s", question => expect(canAnswerGeneralAlexa(question)).toBe(true));

it.each([
  "Explique-moi ce qu'est la photosynthèse.",
  "C'est quoi la photosynthèse ?",
  "Que signifie le mot résilience ?",
  "Peux-tu m'expliquer la photosynthèse ?",
])("admits a natural general question without a model routing call: %s", question => {
  expect(frenchRequestAdmission(question, canAnswerGeneralAlexa(question)).tools).toEqual(["answer_general"]);
});

it.each([
  "Son nom est Karim.",
  "Le patient prend de la sertraline.",
  "Le traitement de la dépression repose sur les antidépresseurs.",
  "J'ai enregistré votre demande.",
  "Selon le livre de Taylor, voici la réponse.",
])("still keeps unsafe or clinical model text local: %s", answer => expect(isValidFrenchGeneralAnswer(answer, false)).toBe(false));

it.each(["Combien j'ai encaissé hier ?", "Quels patients ont un rendez-vous demain ?"])("never treats an application question as general: %s", question => {
  expect(frenchRequestAdmission(question, canAnswerGeneralAlexa(question)).tools ?? []).not.toContain("answer_general");
});
