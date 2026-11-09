import { describe, expect, it } from "vitest";
import { activityQuestionFrame, financeQuestionFrame } from "@/shared/alexa/practice-frame";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";

const ASOF = "2026-10-26T09:30:00+01:00";
const money = (text: string) => financeQuestionFrame(text, ASOF);
const activity = (text: string) => activityQuestionFrame(text, ASOF);

describe("finance frame: money questions in everyday words", () => {
  it("reads gained, received and collected as collected cash", () => {
    expect(money("Combien avons-nous gagné hier ?")?.text).toBe("Combien le cabinet a-t-il encaissé hier ?");
    expect(money("Combien le cabinet a-t-il encaissé aujourd'hui ?")?.text).toBe("Combien le cabinet a-t-il encaissé aujourd'hui ?");
    expect(money("Combien d'argent avons-nous encaissé cette semaine ?")?.text).toBe("Combien le cabinet a-t-il encaissé cette semaine ?");
    expect(money("Quelles sont les recettes de ce mois ?")?.text).toBe("Quelles sont les recettes de ce mois ?");
    expect(money("Combien avons-nous touché en septembre ?")?.text).toBe("Quelles sont les recettes de septembre 2026 ?");
    expect(money("Quel est le chiffre d'affaires de cette année ?")?.text).toBe("Quel est le chiffre d'affaires de cette année ?");
  });
  it("reads expenses and the net result for a month, not for a day", () => {
    expect(money("Quelles sont les dépenses du cabinet ce mois-ci ?")?.text).toBe("Quelles sont les dépenses du cabinet ce mois-ci ?");
    expect(money("Combien avons-nous dépensé en septembre ?")?.text).toBe("Quelles sont les dépenses du cabinet de septembre 2026 ?");
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
    for (const text of ["Quels sont les impayés ?", "Combien a payé ce patient ?", "Combien de rendez-vous demain ?", "Combien a gagné Karim Benali ?"]) expect(money(text), text).toBeNull();
  });
  it("restates each question in a form the finance gate admits", () => {
    for (const text of ["Combien avons-nous gagné hier ?", "Combien d'argent avons-nous encaissé cette semaine ?", "Combien avons-nous touché en septembre ?", "Combien avons-nous dépensé en septembre ?", "Quel est le résultat net de ce mois ?"]) {
      expect(frenchRequestAdmission(money(text)!.text, false, ASOF).tools, text).toEqual(["query_finance"]);
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
