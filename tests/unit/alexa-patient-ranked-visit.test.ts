import { describe, expect, it } from "vitest";
import { classifyPatientQuestion, patientQuestionFrame } from "@/shared/alexa/patient-question";

// Development wordings, never C270/H270.
describe("a visit ranked before the last one, and how long a patient has been followed", () => {
  it("reads a rank before the last visit as the list of the latest visits, with that rank", () => {
    for (const [text, n] of [
      ["Son avant-dernier rendez-vous, c'était quand ?", 2],
      ["La consultation juste avant sa dernière, quelle date ?", 2],
      ["Quand l'ai-je vue avant sa dernière visite ?", 2],
      ["Sa deuxième séance en partant de la fin, c'était quand ?", 2],
      ["La quatrième consultation en remontant, quel jour ?", 4],
    ] as const) expect(classifyPatientQuestion(text), text).toEqual({ section: "prev", n });
  });
  it("takes « depuis la plus récente » for where the counting starts, not for a period", () => {
    const framed = patientQuestionFrame("Sa quatrième consultation en remontant depuis la plus récente, quel jour ?", { contextPatient: true, followup: false }, "2026-10-26T09:00:00+01:00");
    expect(framed?.section).toBe("prev");
    expect(framed?.text).toBe("Montre l'historique du patient sélectionné.");
  });
  it("leaves the last visit and the first one alone", () => {
    expect(classifyPatientQuestion("Sa dernière séance, c'était quand ?")?.section).toBe("lastdate");
    expect(classifyPatientQuestion("Sa première consultation, c'était quand ?")?.section).toBe("firstdate");
    expect(classifyPatientQuestion("Combien de consultations a-t-il eues ?")?.section).toBe("count");
  });
  it("reads « depuis combien de temps est-il suivi » as the date of the first visit, never a count", () => {
    for (const text of ["Depuis combien de temps la suit-on ?", "Il vient au cabinet depuis combien d'années ?", "Depuis combien de mois est-elle suivie ici ?"]) expect(classifyPatientQuestion(text)?.section, text).toBe("firstdate");
    expect(classifyPatientQuestion("Combien de séances depuis janvier ?")?.section).toBe("count");
  });
});
