import { expect, it } from "vitest";

import { indexEvidence, indexRequested } from "@/server/alexa/knowledge-evidence-content";

it("reconnait le sommaire alphabétique comme non clinique", () => {
  expect(indexEvidence("Back matter › Index")).toBe(true);
  expect(indexEvidence("Index")).toBe(true);
  expect(indexEvidence("Index des matières")).toBe(true);
  expect(indexEvidence("Sertraline › Side Effects › Notable Side Effects")).toBe(false);
  expect(indexEvidence(null)).toBe(false);
});

it("ne filtre pas l'index quand la question le demande explicitement", () => {
  expect(indexRequested("Cherche dans l'index de Taylor la page de l'olanzapine")).toBe(true);
  expect(indexRequested("Quels effets indésirables de l'olanzapine ?")).toBe(false);
});
