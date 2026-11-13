import { describe, expect, it } from "vitest";
import { classifyPatientQuestion } from "@/shared/alexa/patient-question";
import { agendaQuestionFrame, periodFollowup } from "@/shared/alexa/agenda-frame";

// Development wordings, never C270/H270. 2026-10-26 is a Monday.
const ASOF = "2026-10-26T09:30:00+01:00";

describe("who the patient in front of the doctor is", () => {
  it("reads « qui ai-je devant moi », « de qui s'agit-il » as the identity", () => {
    for (const text of ["C'est qui, la personne que j'ai devant moi ?", "De qui s'agit-il exactement ?", "Dis-moi qui est en face de moi."]) expect(classifyPatientQuestion(text)?.section, text).toBe("identity");
  });
});

describe("cancellations in other words", () => {
  it("reads « désistements » and « s'est décommandé » as cancellations", () => {
    expect(agendaQuestionFrame("Combien de désistements hier ?", ASOF)).toBe("Combien de rendez-vous annulés hier ?");
    expect(agendaQuestionFrame("Qui s'est décommandé cette semaine ?", ASOF)).toBe("Quels sont les rendez-vous annulés cette semaine ?");
  });
});

describe("an ordinal follow-up after an agenda list", () => {
  it("reads « et lequel est le dernier ? » on the previous period", () => {
    expect(periodFollowup("Et lequel est le dernier ?", "Quels sont les rendez-vous demain ?", undefined, ASOF)).toBe("Quels sont les rendez-vous le 27 octobre 2026 ?");
        expect(periodFollowup("Et le premier ?", "Combien de rendez-vous aujourd'hui ?", undefined, ASOF)).toBe("Quels sont les rendez-vous le 26 octobre 2026 ?");
    expect(periodFollowup("Et le premier ?", "Quel est le solde du cabinet ?", undefined, ASOF)).toBeNull();
  });
});
