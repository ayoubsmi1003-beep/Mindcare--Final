import { describe, expect, it } from "vitest";
import { agendaQuestionFrame } from "@/shared/alexa/agenda-frame";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";

// Development wordings, never C270/H270.
const ASOF = "2026-10-26T09:30:00+01:00";
describe("a day's first or last patient, asked with an arrival verb", () => {
  it("reads « arrive », « débute », « termine » as agenda words, not as a name", () => {
    expect(agendaQuestionFrame("À quelle heure arrive mon premier patient aujourd'hui ?", ASOF)).toBe("Quel est le premier rendez-vous aujourd'hui ?");
    // Another day than today: the day's list holds its first and last rows (renderer's own rule).
    expect(agendaQuestionFrame("Mon dernier rendez-vous termine à quelle heure demain ?", ASOF)).toBe("Quels sont les rendez-vous demain ?");
    expect(agendaQuestionFrame("Demain, mon premier patient débute à quelle heure ?", ASOF)).toBe("Quels sont les rendez-vous demain ?");
    const framed = agendaQuestionFrame("À quelle heure arrive mon premier patient aujourd'hui ?", ASOF)!;
    expect(frenchRequestAdmission(framed, false, ASOF).tools).toEqual(["query_agenda"]);
  });
  it("still refuses a sentence that names someone beside the arrival verb", () => {
    expect(agendaQuestionFrame("Karim Benali arrive à quelle heure demain ?", ASOF)).toBeNull();
  });
});
