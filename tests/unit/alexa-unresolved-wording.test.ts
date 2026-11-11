import { describe, expect, it } from "vitest";
import { unresolvedPartSentence, withDoctorsWords } from "@/server/alexa/unresolved-wording";

const UNSUPPORTED = "Cette condition ou capacité n’est pas disponible ; le résultat demandé reste non établi.";

describe("what an unanswered part says to the doctor", () => {
  it("does not repeat the question back when the part is the whole request", () => {
    const request = "J'ai oublié où on en était avec lui, tu peux me remettre au clair ?";
    expect(unresolvedPartSentence({ goal: request, reason: UNSUPPORTED }, 1, request)).toBe(UNSUPPORTED);
    expect(unresolvedPartSentence({ goal: "j'ai oublié où on en était avec lui, tu peux me remettre au clair ?", reason: UNSUPPORTED }, 2, request)).toBe(UNSUPPORTED);
  });
  it("names the part when there are several, so they can be told apart", () => {
    expect(unresolvedPartSentence({ goal: "Les rendez-vous de demain", reason: UNSUPPORTED }, 2, "Ses traitements et les rendez-vous de demain ?"))
      .toBe(`Les rendez-vous de demain — ${UNSUPPORTED}`);
  });
  it("repeats only the doctor's own words, never a code the model produced", () => {
    expect(withDoctorsWords(UNSUPPORTED, ["email:missing"], "J'ai oublié où on en était avec lui")).toBe(UNSUPPORTED);
    expect(withDoctorsWords(UNSUPPORTED, ["nadir_mazouni"], "Ça remonte à quand, le suivi de NADJAT MAZOUNI ?")).toBe(UNSUPPORTED);
    expect(withDoctorsWords(UNSUPPORTED, ["sans email"], "Liste les patients sans email")).toBe(`${UNSUPPORTED} sans email`);
  });
});
