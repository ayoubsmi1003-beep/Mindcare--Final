import { describe, expect, it } from "vitest";
import { classifyPatientQuestion, patientQuestionParts } from "@/shared/alexa/patient-question";
import { correctReadTypos } from "@/shared/alexa/read-typos";

// Development wordings, never C270/H270.
const ASOF = "2026-10-26T09:30:00+01:00";
const context = { contextPatient: true, followup: false };

describe("a treatment's history in other words than « changé »", () => {
  it("reads « augmentée », « dose de départ », « évolution », « historique » as the recorded changes", () => {
    for (const text of ["La posologie de son anxiolytique a-t-elle été augmentée ?", "Quelle était la dose de départ de son traitement ?", "Retrace l'évolution de son traitement.", "Montre l'historique de ses médicaments."]) {
      expect(classifyPatientQuestion(text)?.section, text).toBe("treatchanges");
    }
  });
  it("keeps the current treatment for a present question", () => {
    expect(classifyPatientQuestion("Quel est son traitement actuel ?")?.section).toBe("treatments");
  });
});

describe("two sections of one record asked together", () => {
  it("restates each part as its own closed question, for the same patient", () => {
    const parts = patientQuestionParts("Ses diagnostics et ses échelles ?", context, ASOF);
    expect(parts?.map((part) => part.section)).toEqual(["diagnoses", "scales"]);
    const named = patientQuestionParts("Pour Karim Benali : son traitement actuel et son prochain rendez-vous.", { contextPatient: false, followup: false }, ASOF);
    expect(named?.map((part) => part.section)).toEqual(["treatments", "nextappt"]);
    expect(named?.every((part) => part.text.includes("Karim Benali"))).toBe(true);
  });
  it("reads « combien de fois » beside a visit question as the visit count", () => {
    expect(patientQuestionParts("Il est venu quand pour la dernière fois, et combien de fois en tout ?", context, ASOF)?.map((part) => part.section)).toEqual(["lastdate", "count"]);
  });
  it("leaves one question with two words of the same section alone", () => {
    expect(patientQuestionParts("Quels sont son traitement et sa posologie ?", context, ASOF)).toBeNull();
    expect(patientQuestionParts("Sa première et sa dernière consultation ?", context, ASOF)).toBeNull();
  });
  it("never splits a book question into record reads", () => {
    expect(patientQuestionParts("Quel est le traitement et le diagnostic de la schizophrénie ?", context, ASOF)).toBeNull();
    expect(patientQuestionParts("Les critères du trouble bipolaire et son traitement de fond ?", context, ASOF)).toBeNull();
  });
});

describe("typos in a read question", () => {
  it("corrects one slip in a word of the read vocabulary", () => {
    expect(correctReadTypos("ordonance en cours du patien")).toBe("ordonnance en cours du patient");
    expect(correctReadTypos("combien de seanes cette semiane ?")).toBe("combien de seances cette semaine ?");
  });
  it("never touches a name, a short word or a correct word", () => {
    expect(correctReadTypos("Traitement de Karim Benali")).toBe("Traitement de Karim Benali");
    // Four letters and less are never corrected: "rose" is a name before it is a slip for "dose".
    expect(correctReadTypos("la dose de rose")).toBe("la dose de rose");
    expect(correctReadTypos("Quelles séances le mois dernier ?")).toBe("Quelles séances le mois dernier ?");
  });
});

describe("a clarification the local model wrote", () => {
  it("reaches the doctor only when it reads as French", async () => {
    const { frenchClarification } = await import("@/server/alexa/agent-loop");
    expect(frenchClarification("Who is next to the patient?")).toBeNull();
    expect(frenchClarification("Quelle posologie souhaitez-vous inscrire ?")).toBe("Quelle posologie souhaitez-vous inscrire ?");
    expect(frenchClarification("Le patient")).toBeNull();
  });
});
