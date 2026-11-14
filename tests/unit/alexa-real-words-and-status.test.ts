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
  it("leaves the patients seen over a month to the activity statistics, and keeps appointments named as such", () => {
    expect(agendaQuestionFrame("Combien de patients a-t-on vus le mois dernier ?", ASOF)).toBeNull();
    expect(agendaQuestionFrame("Combien de malades ai-je reçus en septembre ?", ASOF)).toBeNull();
    expect(agendaQuestionFrame("Combien de rendez-vous ce mois-ci ?", ASOF)).toMatch(/rendez-vous/u);
    expect(agendaQuestionFrame("Combien de patients demain ?", ASOF)).toMatch(/rendez-vous/u);
    // Patients booked for a month are appointments, whatever the word for booked.
    for (const text of ["Combien de patients sont prévus le mois prochain ?", "Combien de patients programmés ce mois-ci ?","Combien de patients attendus ce mois-ci ?"]) expect(agendaQuestionFrame(text, ASOF), text).toMatch(/rendez-vous/u);
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

describe("a verb with its pronoun is never a name", () => {
  it("keeps the patient on screen for « Rafraîchis-moi … ce patient »", async () => {
    const { patientSubject, unknownNameRuns } = await import("@/shared/alexa/patient-question");
    expect(unknownNameRuns("Rafraîchis-moi la mémoire sur ce patient").filter((run) => run.upper)).toEqual([]);
    expect(patientSubject("Rafraîchis-moi la mémoire sur ce patient", { ...context, ignoreUnknownWords: true }, "summary")).toEqual({ kind: "context" });
    expect(unknownNameRuns("Le dossier de Anne-Lise Testard").map((run) => run.words.join(" "))).toEqual(["Anne-Lise Testard"]);
  });
  it("never takes a noun phrase after an article for a name, typed in lower case or not", async () => {
    const { unknownNameRuns } = await import("@/shared/alexa/patient-question");
    for (const text of ["Que signifie la formule employée par le courrier ?", "Pourquoi cette consigne écrite ne vaut-elle rien ?"]) expect(unknownNameRuns(text).filter((run) => run.words.length >= 2), text).toEqual([]);
    expect(unknownNameRuns("le dossier de karim benlarbi").map((run) => run.words.join(" "))).toEqual(["karim benlarbi"]);
  });
});

describe("writing a document or scheduling is a change", () => {
  it("whatever the verb, while the same words used for a read stay a read", async () => {
    const { asksForAChange } = await import("@/shared/alexa/request-contract");
    for (const text of ["Rédige un certificat de repos pour lui.", "Écris une lettre au confrère.", "Fais-moi une ordonnance.", "Peux-tu planifier une consultation jeudi ?", "Il faut décaler mes rdv de cet après-midi.", "Rajoute une séance vendredi.", "Avance son rendez-vous d'une heure."]) expect(asksForAChange(text), text).toBe(true);
    for (const text of ["Le programme de la journée ?", "Prépare-moi une synthèse du dossier.", "Fais-moi la liste des certificats émis.", "Donne-moi les rendez-vous de demain.", "Avance la lecture."]) expect(asksForAChange(text), text).toBe(false);
  });
});

describe("a complex inversion repeats its subject", () => {
  it("names nobody when the subject is the practice's calendar or money, and still a person otherwise", async () => {
    const { readFamily } = await import("@/shared/alexa/patient-question");
    for (const text of ["Mon agenda de jeudi est-il complet ?", "Ma soirée de vendredi est-elle chargée ?", "Les recettes ont-elles augmenté ce mois-ci ?"]) expect(readFamily(text), text).toBe("practice");
    for (const text of ["La posologie a-t-elle évolué ?", "Son traitement a-t-il changé ce mois-ci ?", "La journée, a-t-il dit qu'il viendrait ?"]) expect(readFamily(text), text).toBe("patient");
  });
});

describe("thanks with their acknowledgements", () => {
  it("are a courtesy, not a request", async () => {
    const { planRequest } = await import("@/shared/alexa/request-plan");
    for (const text of ["D'accord, merci infiniment !", "Super, merci beaucoup, c'est noté.", "Merci bien"]) expect(planRequest(text, null, ASOF).intent, text).toBe("dialogue");
    expect(planRequest("Ok", null, ASOF).intent).not.toBe("dialogue");
  });
});

describe("an impersonal « y a-t-il » names nobody", () => {
  it("is not a question about one person, while « a-t-il » still is", async () => {
    const { questionConcernsAPerson } = await import("@/shared/alexa/request-contract");
    expect(questionConcernsAPerson("Combien de séances y a-t-il eu en mars ?")).toBe(false);
    expect(questionConcernsAPerson("Combien de séances a-t-il eues en mars ?")).toBe(true);
  });
  it("counts the practice's sessions over a period, and leaves a bare count to the patient on screen", async () => {
    const { activityQuestionFrame } = await import("@/shared/alexa/practice-frame");
    for (const text of ["Combien de séances y a-t-il eu en mars ?", "Il y a eu combien de consultations en juin ?"]) expect(activityQuestionFrame(text, ASOF), text).toMatch(/^Montre-moi les statistiques de /u);
    expect(activityQuestionFrame("Combien de séances y a-t-il eu ?", ASOF)).toBeNull();
    expect(activityQuestionFrame("Combien de séances a-t-il eues en mars ?", ASOF)).toBeNull();
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
  it("shows no chain of headings as a passage, but keeps a catalogue entry", async () => {
    const { referencesToRead } = await import("@/server/alexa/knowledge-references");
    const proof = (extrait: string) => ({ extrait, section: "Section II › Troubles du sommeil", page: { libelle: "p. 400" } }) as never;
    expect(referencesToRead("Facteurs de risque ?", [proof("Insomnie — Facteurs de risque et pronostiques — Environnementaux.")]).references).toHaveLength(0);
    expect(referencesToRead("Facteurs de risque ?", [proof("Insomnie — Facteurs de risque et pronostiques — Le stress est un facteur déclenchant fréquent de l'insomnie.")]).references).toHaveLength(1);
  });
  it("shows a passage once when its label is only its own opening", () => {
    expect(withoutSectionHeading("Abrupt stopping of the drug may be followed — Abrupt stopping of the drug may be followed by rebound.", "Chapter 2 › Points")).toBe("Abrupt stopping of the drug may be followed by rebound.");
    expect(withoutSectionHeading("Chapter 2 › Points — Some text.", "Chapter 2 › Points")).toBe("Some text.");
  });
});
