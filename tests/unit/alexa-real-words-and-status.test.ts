import { describe, expect, it } from "vitest";
import { correctReadTypos } from "@/shared/alexa/read-typos";
import { agendaQuestionFrame } from "@/shared/alexa/agenda-frame";
import { patientQuestionFrame } from "@/shared/alexa/patient-question";
import { planKnowledgeQuery } from "@/server/alexa/knowledge-query";
import { withoutSectionHeading } from "@/server/alexa/knowledge-references";

// Gaps found by the C200–C202 regression runs (doc 20 §38), fixed in general. Development wordings only, never C202/C270/H270.
const ASOF = "2026-10-26T09:30:00+01:00";
const context = { contextPatient: true, followup: false };

describe("a real French word is never taken for a slip", () => {
  it("leaves words one letter away from the read vocabulary as typed", () => {
    for (const text of ["Ses deux consultations les plus récentes.", "Le bilan annuel est prévu quand ?", "Il faut patienter.", "Je veux charger le document."]) expect(correctReadTypos(text), text).toBe(text);
  });
  it("still corrects a slip that is no French word", () => {
    expect(correctReadTypos("le traitemnt de la patiente")).toBe("le traitement de la patiente");
  });
});

describe("the agenda's cancelled appointments, and commands", () => {
  it("reads a cancellation said in the passive", () => {
    expect(agendaQuestionFrame("Lesquels de mes rendez-vous ont été annulés cette semaine ?", ASOF)).toMatch(/annulés/u);
    expect(agendaQuestionFrame("Les rendez-vous qui sont annulés jeudi ?", ASOF)).toMatch(/annulés/u);
  });
  it("never rewrites a change asked in the infinitive into a read", () => {
    for (const text of ["Il faut décaler mes rdv de cet après-midi.", "Je veux annuler mes rendez-vous de demain.", "Peux-tu confirmer mes rendez-vous de jeudi ?"]) expect(agendaQuestionFrame(text, ASOF), text).toBeNull();
  });
  it("still reads the appointments still to be confirmed", () => {
    expect(agendaQuestionFrame("Quels rendez-vous restent à confirmer demain ?", ASOF)).toMatch(/à confirmer/u);
  });
});

describe("the patient on screen", () => {
  it("counts the whole follow-up for « depuis qu'on le suit », and refuses a period bounded by an event", () => {
    expect(patientQuestionFrame("Combien de fois elle est venue depuis qu'on la suit ?", context, ASOF)?.text).toBe("Combien de consultations a le patient sélectionné ?");
    expect(patientQuestionFrame("Il a eu combien de séances depuis le début du suivi ?", context, ASOF)?.text).toBe("Combien de consultations a le patient sélectionné ?");
    expect(patientQuestionFrame("Combien de consultations depuis qu'on a changé son traitement ?", context, ASOF)).toBeNull();
  });
  it("reads what we prescribed as the record's treatment, not a book question", () => {
    expect(patientQuestionFrame("Qu'est-ce qu'on lui a prescrit actuellement ?", context, ASOF)?.section).toBe("treatments");
    expect(patientQuestionFrame("Que lui avons-nous prescrit ?", context, ASOF)?.section).toBe("treatments");
    expect(patientQuestionFrame("Quelle molécule prescrire dans un trouble bipolaire ?", context, ASOF)).toBeNull();
  });
});

describe("books", () => {
  it("keeps the aspect of a « what causes it » question in its English variant", () => {
    for (const text of ["Qu'est-ce qui cause l'insomnie ?", "D'où vient le délirium ?"]) {
      const plan = planKnowledgeQuery(text)!;
      expect(plan.queries.some((query) => /^(?:insomnia|delirium)$/u.test(query)), `${text} ${JSON.stringify(plan.queries)}`).toBe(false);
      expect(plan.queries.some((query) => /\bcause\b/u.test(query)), `${text} ${JSON.stringify(plan.queries)}`).toBe(true);
    }
  });
  it("shows a passage once when its label is only its own opening", () => {
    expect(withoutSectionHeading("Abrupt stopping of the drug may be followed — Abrupt stopping of the drug may be followed by rebound.", "Chapter 2 › Points")).toBe("Abrupt stopping of the drug may be followed by rebound.");
    expect(withoutSectionHeading("Chapter 2 › Points — Some text.", "Chapter 2 › Points")).toBe("Some text.");
  });
});
