import { describe, expect, it } from "vitest";
import { activityQuestionFrame, financePeriodFollowup, financeQuestionFrame } from "@/shared/alexa/practice-frame";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";

const ASOF = "2026-10-26T09:30:00+01:00";
const money = (text: string) => financeQuestionFrame(text, ASOF);
const activity = (text: string) => activityQuestionFrame(text, ASOF);

describe("finance frame: money questions in everyday words", () => {
  it("reads gained, received and collected as collected cash", () => {
    expect(money("Combien avons-nous gagné hier ?")?.text).toBe("Quel montant représentent les paiements encaissés du 25 octobre 2026 au 25 octobre 2026 ?");
    expect(money("Combien le cabinet a-t-il encaissé aujourd'hui ?")?.text).toBe("Quel montant représentent les paiements encaissés du 26 octobre 2026 au 26 octobre 2026 ?");
    expect(money("Combien d'argent avons-nous encaissé cette semaine ?")?.text).toBe("Quel montant représentent les paiements encaissés du 26 octobre 2026 au 1 novembre 2026 ?");
    expect(money("Quelles sont les recettes de ce mois ?")?.text).toBe("Quelles sont les recettes de ce mois ?");
    expect(money("Combien avons-nous touché en septembre ?")?.text).toBe("Quelles sont les recettes de septembre 2026 ?");
    expect(money("Quel est le chiffre d'affaires de cette année ?")?.text).toBe("Quel est le chiffre d'affaires du 1 janvier 2026 au 31 décembre 2026 ?");
  });
  it("reads expenses and the net result for a month, not for a day", () => {
    expect(money("Quelles sont les dépenses du cabinet ce mois-ci ?")?.text).toBe("Quelle est la répartition des charges de ce mois ?");
    expect(money("Combien avons-nous dépensé en septembre ?")?.text).toBe("Quelle est la répartition des charges de septembre 2026 ?");
    expect(money("Quel est le résultat net de ce mois ?")?.text).toBe("Quel est le résultat net de ce mois ?");
    expect(money("Quelles sont les dépenses d'aujourd'hui ?")).toBeNull();
  });
  it("answers a payment-method question with the cash total and says only cash exists", () => {
    const cash = money("Combien avons-nous reçu en espèces ce mois-ci ?");
    expect(cash).toEqual({ text: "Quelles sont les recettes de ce mois ?", cashOnlyNotice: true });
    expect(money("Combien a été payé par un autre moyen que les espèces ?")?.cashOnlyNotice).toBe(true);
  });
  it("compares this month with the last, in two named months of one year", () => {
    expect(money("Compare ce mois avec le mois dernier.")?.text).toBe("Compare les encaissements de septembre et d’octobre.");
    expect(financeQuestionFrame("Compare ce mois avec le mois dernier.", "2026-01-12T09:00:00+01:00")).toBeNull();
  });
  it("leaves unpaid balances, one patient and the agenda to their own routes", () => {
    for (const text of ["Combien a payé ce patient ?", "Combien de rendez-vous demain ?", "Combien a gagné Karim Benali ?"]) expect(money(text), text).toBeNull();
  });
  it("reads unpaid money as what is left to collect over the whole practice", () => {
    expect(money("Quels sont les impayés ?")?.text).toBe("Quel reste à encaisser pour l’ensemble du cabinet ?");
    expect(money("Quels sont les impayés de Karim Benali ?")).toBeNull();
    expect(frenchRequestAdmission(money("Quels sont les impayés ?")!.text, false, ASOF).financeState).toBe("all");
  });
  it("restates each question in a form the finance gate admits", () => {
    for (const text of ["Combien avons-nous gagné hier ?", "Combien d'argent avons-nous encaissé cette semaine ?", "Combien avons-nous touché en septembre ?", "Combien avons-nous dépensé en septembre ?", "Quel est le résultat net de ce mois ?"]) {
      const admission = frenchRequestAdmission(money(text)!.text, false, ASOF);
      expect(admission.tools, text).toEqual(["query_finance"]);
      if (/hier|semaine/u.test(text)) expect(admission.from && admission.to, text).toBeTruthy();
    }
  });
});

describe("activity frame: sessions, patients seen, new records, busiest days", () => {
  it("restates them as the statistics of a period", () => {
    expect(activity("Combien de patients avons-nous reçus ce mois-ci ?")).toBe("Montre-moi les statistiques de ce mois");
    expect(activity("Combien de patients différents avons-nous vus en septembre ?")).toBe("Montre-moi les statistiques de septembre 2026");
    expect(activity("Combien de nouveaux patients se sont inscrits ce mois-ci ?")).toBe("Montre-moi les statistiques de ce mois");
    expect(activity("Quels sont les jours les plus chargés ?")).toBe("Montre-moi les statistiques de ce mois");
    expect(activity("Donne-moi un aperçu de l'activité du cabinet ce mois-ci.")).toBe("Montre-moi les statistiques de ce mois");
    expect(activity("Combien de patients sont suivis au cabinet ?")).toBe("Montre-moi les statistiques de ce mois");
    expect(activity("Statistiques de la semaine.")).toBe("Montre-moi les statistiques de cette semaine");
  });
  it("is understood by the statistics read", () => {
    for (const text of ["Combien de patients avons-nous reçus ce mois-ci ?", "Combien de patients différents avons-nous vus en septembre ?", "Quels sont les jours les plus chargés ?"]) {
      const admission = frenchRequestAdmission(activity(text)!, false, ASOF);
      expect(admission.tools, text).toEqual(["query_app"]);
      expect(admission.applicationView, text).toBe("statistics");
    }
  });
  it("leaves one patient, the agenda, money and a single day alone", () => {
    for (const text of ["Combien de patients aujourd'hui ?", "Combien de rendez-vous demain ?", "Combien a-t-il de consultations ?", "Combien avons-nous encaissé ce mois-ci ?", "Quels patients a-t-il vus ?"]) expect(activity(text), text).toBeNull();
  });
});

describe("activity frame: consultations that took place and month-on-month comparison of activity", () => {
  it("reads them as the statistics of the period, which hold the previous period too", () => {
    expect(activityQuestionFrame("Combien de consultations ont eu lieu ce mois-ci ?", ASOF)).toBe("Montre-moi les statistiques de ce mois");
    expect(activityQuestionFrame("Compare le nombre de consultations de ce mois avec le mois dernier.", ASOF)).toBe("Montre-moi les statistiques de ce mois par rapport au mois dernier");
    expect(financeQuestionFrame("Compare le nombre de consultations de ce mois avec le mois dernier.", ASOF)).toBeNull();
  });
});

describe("finance period follow-up", () => {
  const previous = financeQuestionFrame("Combien avons-nous encaissé aujourd'hui ?", ASOF)!.text;
  it("asks the same money question for the new period", () => {
    expect(financePeriodFollowup("Et hier ?", previous, ASOF)).toBe("Quel montant représentent les paiements encaissés du 25 octobre 2026 au 25 octobre 2026 ?");
    expect(financePeriodFollowup("Et cette semaine ?", previous, ASOF)).toBe("Quel montant représentent les paiements encaissés du 26 octobre 2026 au 1 novembre 2026 ?");
    expect(financePeriodFollowup("Et ce mois-ci ?", previous, ASOF)).toBe("Quelles sont les recettes de ce mois ?");
  });
  it("leaves other previous questions and other follow-ups alone", () => {
    expect(financePeriodFollowup("Et hier ?", "Combien de rendez-vous aujourd'hui ?", ASOF)).toBeNull();
    expect(financePeriodFollowup("Et son traitement ?", previous, ASOF)).toBeNull();
    expect(financePeriodFollowup("Et hier ?", undefined, ASOF)).toBeNull();
  });
});

describe("sessions that were paid, and this month against last month", () => {
  it("reads paid sessions as the payments collected in the period", () => {
    expect(money("Combien de séances ont été payées ce mois-ci ?")?.text).toBe("Quelles sont les recettes de ce mois ?");
    expect(money("Combien de consultations ont été payées cette semaine ?")?.text).toBe("Quel montant représentent les paiements encaissés du 26 octobre 2026 au 1 novembre 2026 ?");
  });
  it("keeps the agenda and the activity frames away from paid sessions", () => {
    expect(activity("Combien de séances ont été payées ce mois-ci ?")).toBeNull();
    expect(frenchRequestAdmission("Quelles sont les recettes de ce mois ?", false, ASOF).tools).toEqual(["query_finance"]);
  });
  it("admits the statistics of this month against the last as one statistics read", () => {
    const sentence = activity("Compare le nombre de consultations de ce mois avec le mois dernier.")!;
    const admission = frenchRequestAdmission(sentence, false, ASOF);
    expect(admission.tools).toEqual(["query_app"]);
    expect(admission.applicationView).toBe("statistics");
  });
});

describe("activity: patients who came at least once", () => {
  // Development wordings, never C270/H270.
  it("reads it as the practice's figures over a month or a year the statistics read", () => {
    expect(activity("Cette année, combien de patients différents sont passés au cabinet ?")).toBe("Montre-moi les statistiques de cette année");
    expect(activity("Combien de patients ont consulté en septembre ?")).toBe("Montre-moi les statistiques de septembre 2026");
    expect(frenchRequestAdmission(activity("Combien de patients sont passés ce mois-ci ?")!, false, ASOF)?.tools).toEqual(["query_app"]);
  });
  it("never for one named person; last week is read as its explicit days", () => {
    expect(activity("Combien de patients ont consulté Karim Test ?")).toBeNull();
    expect(activity("Karim Test, combien de patients a-t-il vus ce mois-ci ?")).toBeNull();
    expect(activity("Le patient a consulté combien de fois cette année ?")).toBeNull();
    expect(activity("Combien de patients ont consulté la semaine dernière ?")).toBe("Montre-moi les statistiques du 19 octobre 2026 au 25 octobre 2026");
  });
});
