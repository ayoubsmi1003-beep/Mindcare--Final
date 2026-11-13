import { describe, expect, it } from "vitest";
import { classifyPatientQuestion, patientQuestionParts } from "@/shared/alexa/patient-question";
import { correctReadTypos } from "@/shared/alexa/read-typos";
import { agendaQuestionFrame } from "@/shared/alexa/agenda-frame";
import { requestsPatientScope } from "@/shared/alexa/request-plan";
import { unresolvedPartSentence } from "@/server/alexa/unresolved-wording";
import { frenchClarification } from "@/server/alexa/agent-loop";

// Findings of the security review of the C270 campaign diff (doc 20 §35). Development wordings, never C270/H270.
const ASOF = "2026-10-26T09:30:00+01:00";
const context = { contextPatient: true, followup: false };

describe("a question naming two people is never split onto one of them", () => {
  it("keeps a second, even lower-case, name from being dropped", () => {
    expect(patientQuestionParts("Le traitement de Karim Benali et le prochain rendez-vous de samia ?", context, ASOF)).toBeNull();
    expect(patientQuestionParts("Les diagnostics de Karim Benali et les échelles de Nadia Test ?", context, ASOF)).toBeNull();
  });
  it("never splits a book question into record reads", () => {
    expect(patientQuestionParts("Ses échelles et le traitement de la schizophrénie ?", context, ASOF)).toBeNull();
  });
});

describe("typo correction never touches a name", () => {
  it("leaves words of a name run, and a word right after « de », as typed", () => {
    expect(correctReadTypos("le prochain rendez-vous de amina combier ?")).toBe("le prochain rendez-vous de amina combier ?");
    expect(correctReadTypos("le solde de charles martin")).toBe("le solde de charles martin");
    expect(correctReadTypos("le dossier de karim patien")).toBe("le dossier de karim patien");
    expect(correctReadTypos("les rendez-vous de charles")).toBe("les rendez-vous de charles");
  });
  it("still corrects a slip between known words", () => {
    expect(correctReadTypos("traitemnt actuel du patiant")).toBe("traitement actuel du patient");
  });
});

describe("a command is never rewritten into a read that could look carried out", () => {
  it("leaves « confirme / annule / décommande les rendez-vous » to the change routes", () => {
    for (const text of ["Confirme les rendez-vous de demain.", "Décommande les rendez-vous de demain.", "Annule les rendez-vous de jeudi.", "Valide les rendez-vous de cet après-midi."]) expect(agendaQuestionFrame(text, ASOF), text).toBeNull();
  });
  it("still reads a question about confirmed or cancelled appointments", () => {
    expect(agendaQuestionFrame("Combien de rendez-vous confirmés demain ?", ASOF)).toBe("Combien de rendez-vous confirmés demain ?");
    expect(agendaQuestionFrame("Qui s'est décommandé hier ?", ASOF)).toBe("Quels sont les rendez-vous annulés hier ?");
  });
});

describe("text the local model wrote", () => {
  it("names an unanswered part only by the doctor's own whole words", () => {
    expect(unresolvedPartSentence({ goal: "rendez", reason: "R" }, 2, "Ses rendez-vous et son traitement ?")).toBe("R");
    expect(unresolvedPartSentence({ goal: "son traitement", reason: "R" }, 2, "Ses rendez-vous et son traitement ?")).toBe("son traitement — R");
  });
  it("shows a clarification only when it is a French question", () => {
    for (const text of ["Necesita la fecha de la cita?", "请问 le patient ?", "Patient name for le rendez-vous?"]) expect(frenchClarification(text), text).toBeNull();
    for (const text of ["Quelle fréquence souhaitez-vous inscrire ?", "Quel cabinet ?", "Pour quel jour voulez-vous ce rendez-vous ?"]) expect(frenchClarification(text), text).toBe(text);
  });
});

describe("smaller findings", () => {
  it("never reads « ouvre-moi celui-ci » as a named record", () => {
    expect(classifyPatientQuestion("Ouvre-moi celui-ci.")).toBeNull();
  });
  it("keeps the selected patient's scope when the indefinite person is not a clinical vignette", () => {
    expect(requestsPatientScope("Une personne a appelé : quand est son rendez-vous demain ?")).toBe(true);
    expect(requestsPatientScope("Un patient qui entend des voix depuis son adolescence, quel diagnostic évoquer ?")).toBe(false);
  });
});

describe("the understanding layer's change request", () => {
  it("is detected for the commands the frames used to rewrite into reads", async () => {
    const { understandTurn } = await import("@/shared/alexa/turn-understanding");
    for (const text of ["Confirme les rendez-vous de demain.", "Arrête son traitement actuel."]) expect(understandTurn(text, { selected: true }).wantsChange, text).toBe(true);
  });
});
