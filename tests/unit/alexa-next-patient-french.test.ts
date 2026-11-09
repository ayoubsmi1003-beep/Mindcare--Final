import { describe, expect, it } from "vitest";
import { planRequest, requestsNextPatient } from "@/shared/alexa/request-plan";

describe("next patient: the many ways a doctor asks to move on", () => {
  for (const text of ["Patient suivant.", "Le patient suivant, s'il te plaît.", "On passe au patient suivant.", "Passons au suivant.", "Au suivant !", "Qui est le prochain ?",
    "Et le prochain ?", "C'est qui le prochain ?", "Qui vient ensuite ?", "Qui arrive après ?", "Qui est le prochain patient ?", "Prochain patient.", "Alors, le suivant ?"]) {
    it(`understands: ${text}`, () => expect(requestsNextPatient(text)).toBe(true));
  }
  for (const text of ["Quel est le prochain rendez-vous du cabinet ?", "Qui est le prochain sur la liste d'attente de septembre ?", "Quelle est la prochaine étape du traitement ?", "Combien de patients demain ?", "Qui est ce patient ?"]) {
    it(`does not take for a move to the next patient: ${text}`, () => expect(requestsNextPatient(text)).toBe(false));
  }
  it("plans a next-patient request as an agenda read, whichever the wording", () => {
    for (const text of ["Patient suivant.", "Qui est le prochain ?", "Au suivant !"]) expect(planRequest(text, null, "2026-11-10T08:00:00+01:00").intent, text).toBe("agenda");
  });
});
