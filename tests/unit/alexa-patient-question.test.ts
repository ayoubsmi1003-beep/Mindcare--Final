import { describe, expect, it } from "vitest";
import { classifyPatientQuestion, patientQuestionFrame, renderPatientQuestion } from "@/shared/alexa/patient-question";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";
import { parsePatientMention } from "@/server/alexa/patient-mention";

const onScreen = { contextPatient: true, followup: false };
const afterTurn = { contextPatient: false, followup: true };
const nobody = { contextPatient: false, followup: false };
const section = (text: string, options = onScreen) => patientQuestionFrame(text, options)?.section ?? null;

describe("patient question frame: the same intention in many registers reads as one section", () => {
  const cases: [string, string][] = [
    // current treatment
    ["Quel est son traitement actuel ?", "treatments"],
    ["Il prend quoi comme traitement en ce moment ?", "treatments"],
    ["Il prend quoi comme cachets ?", "treatments"],
    ["Ses médicaments ?", "treatments"],
    ["Rappelle-moi son ordonnance en cours.", "treatments"],
    ["À quelle dose est-il actuellement ?", "treatments"],
    ["Dis, tu peux me rappeler ce qu'il prend comme traitement ces temps-ci ?", "treatments"],
    // visits
    ["Combien de consultations a-t-il eues ?", "count"],
    ["Il est venu combien de fois depuis le début ?", "count"],
    ["Combien de fois l'ai-je vu en tout ?", "count"],
    ["Il a déjà eu une consultation ?", "count"],
    ["C'est quand, sa dernière visite ?", "lastdate"],
    ["À quelle date est-il venu pour la dernière fois ?", "lastdate"],
    ["Il est passé quand la dernière fois, lui ?", "lastdate"],
    ["Depuis quand je le suis ?", "firstdate"],
    ["Quand l'ai-je vu pour la première fois ?", "firstdate"],
    ["Quel était son traitement précédent ?", "treatchanges"],
    ["Son traitement a-t-il changé récemment ?", "treatchanges"],
    ["Quelle est la première et la dernière consultation de ce patient ?", "bounds"],
    ["De quoi avons-nous parlé à la dernière séance ?", "lastnote"],
    ["Résume sa dernière consultation.", "lastnote"],
    ["Qu'est-ce que j'ai noté la dernière fois ?", "lastnote"],
    ["Montre-moi ses consultations précédentes.", "prev"],
    ["Qu'est-ce qui s'est dit pendant les séances d'avant ?", "prev"],
    // overview
    ["Fais-moi un résumé de ce patient.", "summary"],
    ["Je le vois dans une minute, rappelle-moi l'essentiel de son dossier.", "summary"],
    ["Où en est ce patient ?", "summary"],
    ["Un petit point sur lui ?", "summary"],
    ["Quoi de neuf sur ce patient ?", "summary"],
    ["Donne-moi son historique.", "history"],
    ["Retrace son parcours.", "history"],
    ["Comment a-t-il évolué ces derniers temps ?", "evolution"],
    ["A-t-il un prochain rendez-vous ?", "nextappt"],
    ["Quels documents a-t-il dans son dossier ?", "documents"],
    ["A-t-il des échelles enregistrées ?", "scales"],
    ["Quels diagnostics sont enregistrés pour lui ?", "diagnoses"],
    ["Qui est ce patient ?", "identity"],
    ["Résume ce malade.", "summary"],
  ];
  for (const [text, expected] of cases) it(`${text} → ${expected}`, () => expect(section(text)).toBe(expected));
});

describe("patient question frame: a name wins over the screen and is kept as written", () => {
  it("names the patient when two unknown words stand together", () => {
    const frame = patientQuestionFrame("Qu'est-ce qu'on sait sur Karim Benali ?", nobody);
    expect(frame?.subject).toEqual({ kind: "named", name: "Karim Benali" });
    expect(frame?.text).toBe("Résumé de Karim Benali.");
    expect(patientQuestionFrame("Combien de consultations a Karim Benali ?", onScreen)?.text).toBe("Nombre de consultations pour Karim Benali.");
    expect(patientQuestionFrame("Quels médicaments Nadia Test prend-elle actuellement ?", onScreen)?.text).toBe("Quel est le traitement de Nadia Test ?");
  });
  it("keeps a lowercase compound name whole", () => {
    expect(patientQuestionFrame("Dernière consultation de mohamed taki eddine araibia ?", nobody)?.subject).toEqual({ kind: "named", name: "mohamed taki eddine araibia" });
  });
  it("leaves a first name alone, or two different names, to the route that asks", () => {
    expect(patientQuestionFrame("Je voudrais des nouvelles de Samir.", nobody)).toBeNull();
    expect(patientQuestionFrame("Résume Samir.", onScreen)).toBeNull();
    expect(patientQuestionFrame("Compare le traitement de Karim Benali et de Nadia Test.", nobody)).toBeNull();
  });
  it("restates a named question in a form the name parser still reads as that name", () => {
    for (const text of ["Qu'est-ce qu'on sait sur Karim Benali ?", "Quel est l'historique de Karim Benali ?", "Dernière consultation de Karim Benali ?", "Quelles sont les trois dernières dates de visite de Karim Benali ?"]) {
      const frame = patientQuestionFrame(text, nobody)!;
      expect(frame, text).not.toBeNull();
      expect(parsePatientMention(frame.text), frame.text).toMatchObject({ status: "named", name: "Karim Benali" });
    }
  });
});

describe("patient question frame: it never answers from the record what is not about the record", () => {
  it("leaves reference questions to the books, with or without a patient on screen", () => {
    for (const text of ["Quelle est la dose habituelle de sertraline ?", "Quelles sont les contre-indications de l'halopéridol ?", "Quels sont les critères diagnostiques de la dépression majeure ?", "Quelle surveillance faut-il pour un patient sous lithium ?", "Quelle est la dose de bromazépam ?"]) {
      expect(patientQuestionFrame(text, onScreen), text).toBeNull();
      expect(patientQuestionFrame(text, nobody), text).toBeNull();
    }
  });
  it("leaves clinic-wide, agenda, finance and relatives questions to their own routes", () => {
    for (const text of ["Combien de patients aujourd'hui ?", "Combien de consultations ont eu lieu ce mois-ci ?", "Qui ai-je demain ?", "Quel est le prochain rendez-vous du cabinet ?", "Quelles sont les recettes du mois ?", "Quels antécédents a sa mère ?", "Combien de consultations au cabinet ?"]) {
      expect(patientQuestionFrame(text, onScreen), text).toBeNull();
    }
  });
  it("needs a patient: nobody on screen, no conversation and no name leaves a pronoun question unanswered", () => {
    expect(patientQuestionFrame("Il prend quoi comme traitement ?", nobody)).toBeNull();
    expect(patientQuestionFrame("Combien de visites ?", nobody)).toBeNull();
  });
  it("lets a short follow-up continue the conversation's patient, but not a treatment question without a pronoun", () => {
    expect(section("Combien de visites ?", afterTurn)).toBe("count");
    expect(section("Et sa première visite ?", afterTurn)).toBe("firstdate");
    expect(patientQuestionFrame("Quelle est la dose ?", afterTurn)).toBeNull();
  });
});

describe("patient question frame: every restatement is understood by the deterministic admission", () => {
  const expected: Record<string, { tool: string; section?: string; mode?: string }> = {
    summary: { tool: "get_patient_context", section: "summary" }, history: { tool: "get_patient_context", section: "history" },
    treatments: { tool: "get_patient_context", section: "treatments" }, count: { tool: "query_consultations", mode: "count" },
    lastdate: { tool: "get_patient_context", section: "summary" }, firstdate: { tool: "get_patient_context", section: "summary" }, bounds: { tool: "get_patient_context", section: "summary" }, treatchanges: { tool: "get_patient_context", section: "treatments" }, lastnote: { tool: "get_patient_context", section: "summary" },
    prev: { tool: "get_patient_context", section: "history" }, nextappt: { tool: "query_agenda" }, documents: { tool: "query_documents" },
    scales: { tool: "get_patient_context", section: "scales" }, diagnoses: { tool: "get_patient_context", section: "diagnoses" },
    evolution: { tool: "get_patient_context", section: "summary" }, identity: { tool: "get_patient_context", section: "profile" },
  };
  for (const [key, want] of Object.entries(expected)) {
    for (const subject of [{ kind: "context" as const }, { kind: "named" as const, name: "Karim Benali" }]) {
      it(`${key} (${subject.kind})`, () => {
        const text = renderPatientQuestion({ section: key as never, n: 3 }, subject);
        const admission = frenchRequestAdmission(text, false, "2026-10-26T09:30:00+01:00");
        expect(admission.tools, text).toEqual([want.tool]);
        if (want.section) expect(admission.patientSection, text).toBe(want.section);
        if (want.mode) expect(admission.consultationMode, text).toBe(want.mode);
      });
    }
  }
  it("classifies nothing for a sentence that asks about no section", () => {
    expect(classifyPatientQuestion("Bonjour, comment allez-vous ?")).toBeNull();
  });
});

import { patientSwitchFollowup, reaskForSelectedPatient } from "@/shared/alexa/patient-question";

describe("patient question frame: a restatement keeps its meaning when read again", () => {
  const sections = ["summary", "history", "treatments", "treatchanges", "bounds", "count", "lastnote", "nextappt", "documents", "scales", "diagnoses", "identity"] as const;
  for (const key of sections) {
    for (const subject of [{ kind: "context" as const }, { kind: "named" as const, name: "Karim Benali" }]) {
      it(`${key} (${subject.kind}) classifies as itself`, () => {
        const text = renderPatientQuestion({ section: key, n: 3 }, subject);
        expect(classifyPatientQuestion(text)?.section, text).toBe(key);
      });
    }
  }
});

describe("patient switch: a bare name asks the previous question again, for that patient", () => {
  it("restates the previous question for the new name", () => {
    expect(patientSwitchFollowup("Et celui de Nazim Hamza ?", "Quel est le traitement de Karim Benali ?")?.text).toBe("Quel est le traitement de Nazim Hamza ?");
    expect(patientSwitchFollowup("Passons à Imed Zarat.", "Résumé de Karim Benali.")?.text).toBe("Résumé de Imed Zarat.");
    expect(patientSwitchFollowup("Pour Tabelait Adadaine maintenant.", "Date de la dernière consultation de Karim Benali ?")?.text).toBe("Quelles sont les dates de la première à la dernière consultation de Tabelait Adadaine ?");
    expect(patientSwitchFollowup("Maintenant celles de Mohamed Taki Eddine Araibia.", "Montre les résultats d’échelles de Karim Benali.")?.text).toContain("Mohamed Taki Eddine Araibia");
  });
  it("does nothing when the sentence asks something itself, names nobody, or the last turn asked about no patient", () => {
    expect(patientSwitchFollowup("Quel est le traitement de Nazim Hamza ?", "Résumé de Karim Benali.")).toBeNull();
    expect(patientSwitchFollowup("Et celui-là ?", "Résumé de Karim Benali.")).toBeNull();
    expect(patientSwitchFollowup("Passons à Imed Zarat.", "Combien de patients aujourd'hui ?")).toBeNull();
    expect(patientSwitchFollowup("Passons à Imed Zarat.", undefined)).toBeNull();
    expect(patientSwitchFollowup("Et sa mère Imed Zarat ?", "Résumé de Karim Benali.")).toBeNull();
  });
  it("answers the question that was asked once a patient is picked from a list", () => {
    expect(reaskForSelectedPatient("Combien de consultations a Kouider ?")).toBe("Combien de consultations a le patient sélectionné ?");
    expect(reaskForSelectedPatient("Je voudrais des nouvelles de Kouider.")).toBe("Résume le dossier du patient sélectionné.");
    expect(reaskForSelectedPatient("Bonjour")).toBeNull();
    expect(reaskForSelectedPatient(undefined)).toBeNull();
  });
});

describe("patient question frame: stray vocabulary is tolerated, a first name is not", () => {
  it("reads past words no list knows when nobody is named", () => {
    expect(section("Donne-moi les points importants avant que je commence la consultation.")).toBe("summary");
    expect(section("Rappelle-moi ce qu'il prend comme gélules.")).toBe("treatments");
  });
  it("still refuses a first name alone, or a name in a group of unknown words", () => {
    expect(patientQuestionFrame("Parle-moi de kouider.", onScreen)).toBeNull();
    expect(patientQuestionFrame("Résume Samir.", onScreen)).toBeNull();
    expect(patientQuestionFrame("Combien de consultations a Karim Benali, et Nadia Test ?", onScreen)).toBeNull();
  });
});
