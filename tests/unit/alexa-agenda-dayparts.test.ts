import { describe, expect, it } from "vitest";
import { agendaQuestionFrame, periodFollowup } from "@/shared/alexa/agenda-frame";

// Development wordings, never C270/H270. 2026-10-26 is a Monday.
const ASOF = "2026-10-26T09:30:00+01:00";
const frame = (text: string) => agendaQuestionFrame(text, ASOF);

describe("an impersonal « il » is not a person", () => {
  it("reads « il y a », « il reste », « y a-t-il » as agenda questions", () => {
    expect(frame("Il y a eu des absents la semaine dernière ?")).toBe("Quels sont les rendez-vous non honorés du 19 octobre 2026 au 25 octobre 2026 ?");
    expect(frame("Il reste combien de rendez-vous demain ?")).toBe("Combien de rendez-vous demain ?");
    expect(frame("Y a-t-il des annulations aujourd'hui ?")).toBe("Quels sont les rendez-vous annulés aujourd'hui ?");
  });
  it("still leaves a personal « il » to the patient routes", () => {
    expect(frame("Est-ce qu'il a un rendez-vous demain ?")).toBeNull();
  });
});

describe("a part of the day", () => {
  it("is kept beside a weekday", () => {
    expect(frame("Combien de rendez-vous vendredi matin ?")).toBe("Combien de rendez-vous le 30 octobre 2026 matin ?");
  });
  it("is read from « la matinée de », « l'après-midi de », « dans la soirée »", () => {
    expect(frame("Combien de patients dans la matinée de jeudi ?")).toBe("Combien de rendez-vous le 29 octobre 2026 matin ?");
    expect(frame("L'après-midi d'après-demain, j'ai combien de patients ?")).toBe("Combien de rendez-vous le 28 octobre 2026 après-midi ?");
    expect(frame("Demain dans la soirée, combien de rendez-vous ?")).toBe("Combien de rendez-vous demain soir ?");
  });
});

describe("the day's start or end asked with a verb", () => {
  it("reads « je finis » as the last and « je commence » as the first appointment", () => {
    expect(frame("À quelle heure je finis demain ?")).toBe("Quels sont les rendez-vous demain ?");
    expect(frame("Je commence à quelle heure aujourd'hui ?")).toBe("Quel est le premier rendez-vous aujourd'hui ?");
  });
});

describe("other agenda wordings", () => {
  it("reads « qui avait annulé »", () => {
    expect(frame("Qui avait annulé la semaine dernière ?")).toBe("Quels sont les rendez-vous annulés du 19 octobre 2026 au 25 octobre 2026 ?");
  });
  it("reads a gap in the planning as a free-time question", () => {
    expect(frame("Y a-t-il un creux dans mon agenda jeudi après-midi ?")).toBe("Quels sont les rendez-vous le 29 octobre 2026 après-midi ?");
  });
  it("reads a range between two weekdays", () => {
    expect(frame("Combien de rendez-vous du mercredi au vendredi ?")).toBe("Combien de rendez-vous du 28 octobre 2026 au 30 octobre 2026 ?");
    expect(frame("Quels rendez-vous entre jeudi et lundi ?")).toBe("Quels sont les rendez-vous du 29 octobre 2026 au 2 novembre 2026 ?");
  });
});

describe("« même question » follow-ups", () => {
  it("replaces only the period", () => {
    expect(periodFollowup("Pareil pour vendredi ?", "Combien de rendez-vous demain ?", "2026-10-27", ASOF)).toBe("Combien de rendez-vous le 30 octobre 2026 ?");
    expect(periodFollowup("La même chose pour hier.", "Quels sont les rendez-vous annulés aujourd'hui ?", "2026-10-26", ASOF)).toBe("Quels sont les rendez-vous annulés hier ?");
  });
});
