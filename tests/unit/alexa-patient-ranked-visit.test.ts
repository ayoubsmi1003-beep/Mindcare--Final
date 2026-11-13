import { describe, expect, it } from "vitest";
import { classifyPatientQuestion, patientQuestionFrame } from "@/shared/alexa/patient-question";
import { parsePatientMention } from "@/shared/alexa/patient-mention";

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
    expect(classifyPatientQuestion("Depuis le 1er janvier, il a eu combien de séances ?")?.section).toBe("count");
  });
});

describe("a patient's next appointment, asked as coming or holding one", () => {
  // Development wordings, never C270/H270.
  const ASOF = "2026-10-26T09:00:00+01:00";
  it("reads « vient quand », « a-t-il un rendez-vous (de prévu) » as the next appointment, for a named patient or the one on screen", () => {
    expect(patientQuestionFrame("Samir Test a-t-il un rendez-vous de programmé ?", { contextPatient: false, followup: false }, ASOF)?.text).toBe("Quel est le prochain rendez-vous de Samir Test ?");
    expect(patientQuestionFrame("Et Samir Test, il passera quand ?", { contextPatient: false, followup: false }, ASOF)?.text).toBe("Quel est le prochain rendez-vous de Samir Test ?");
    expect(patientQuestionFrame("Elle a toujours un rdv ?", { contextPatient: true, followup: false }, ASOF)?.text).toBe("Quel est le prochain rendez-vous du patient sélectionné ?");
    expect(classifyPatientQuestion("Un rendez-vous à venir pour lui ?")?.section).toBe("nextappt");
  });
  it("leaves past visits and the practice's agenda alone", () => {
    expect(classifyPatientQuestion("Quand est-elle venue la dernière fois ?")?.section).toBe("lastdate");
    expect(classifyPatientQuestion("A-t-il eu un rendez-vous en septembre ?")).toBeNull();
    expect(patientQuestionFrame("Qui a un rendez-vous demain ?", { contextPatient: true, followup: false }, ASOF)).toBeNull();
  });
  it("never takes an appointment's state for a name", () => {
    expect(parsePatientMention("Samir Test a-t-il un rendez-vous de prévu ?")).toEqual({ status: "none" });
  });
});
