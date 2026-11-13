import { describe, expect, it } from "vitest";
import { activityQuestionFrame, financePeriodFollowup, financeQuestionFrame } from "@/shared/alexa/practice-frame";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";

// Development wordings, never C270/H270. 2026-10-26 is a Monday.
const ASOF = "2026-10-26T09:30:00+01:00";
const money = (text: string) => financeQuestionFrame(text, ASOF)?.text ?? null;
const activity = (text: string) => activityQuestionFrame(text, ASOF);
const statistics = (sentence: string | null) => frenchRequestAdmission(sentence!, false, ASOF).applicationView;

describe("activity over a period the statistics read had no words for", () => {
  it("reads last week and the year so far as explicit days", () => {
    expect(activity("Combien de patients ont consulté la semaine passée ?")).toBe("Montre-moi les statistiques du 19 octobre 2026 au 25 octobre 2026");
    expect(activity("Le bilan d'activité depuis le début de l'année ?")).toBe("Montre-moi les statistiques du 1 janvier 2026 au 26 octobre 2026");
    expect(statistics(activity("Combien de patients ont consulté la semaine passée ?"))).toBe("statistics");
  });
  it("reads « jour de la semaine » as weekdays, not as this week", () => {
    expect(activity("Quel jour de la semaine compte le plus de patients en septembre ?")).toBe("Montre-moi les statistiques de septembre 2026");
    expect(activity("Quels jours ont le plus de séances cette année ?")).toBe("Montre-moi les statistiques de cette année");
  });
  it("compares two named months, never silently only the first", () => {
    const sentence = activity("Compare l'activité de juillet avec celle d'août.");
    expect(sentence).toBe("Montre-moi les statistiques de août 2026 par rapport à juillet 2026");
    expect(statistics(sentence)).toBe("statistics");
  });
});

describe("money words and periods", () => {
  it("reads what the practice « a rapporté » and « la caisse » as collected money", () => {
    expect(money("Combien le cabinet a rapporté en septembre ?")).toBe("Quelles sont les recettes de septembre 2026 ?");
    expect(money("La caisse d'aujourd'hui, ça fait combien ?")).toBe("Quel montant représentent les paiements encaissés du 26 octobre 2026 au 26 octobre 2026 ?");
  });
  it("reads a named month beside a profit, and last week", () => {
    expect(money("Quel bénéfice au mois de juillet ?")).toBe("Quel est le résultat net de juillet 2026 ?");
    expect(money("Combien avons-nous encaissé la semaine passée ?")).toBe("Quel montant représentent les paiements encaissés du 19 octobre 2026 au 25 octobre 2026 ?");
  });
  it("states the period's total of charges (the finance page's own figure) for expenses", () => {
    const sentence = money("Nos dépenses de septembre, ça représente combien ?");
    expect(sentence).toBe("Quelle est la répartition des charges de septembre 2026 ?");
    expect(frenchRequestAdmission(sentence!, false, ASOF).financeMode).toBe("composition");
    expect(money("Combien avons-nous dépensé la semaine passée ?")).toBe("Quelle est la répartition des charges du 19 octobre 2026 au 25 octobre 2026 ?");
  });
});

describe("money follow-ups that only change the period", () => {
  const previous = money("Combien avons-nous encaissé aujourd'hui ?")!;
  it("reads « et en <mois> », « sur le mois », « élargis à la semaine »", () => {
    expect(financePeriodFollowup("Et en juin ?", previous, ASOF)).toBe("Quelles sont les recettes de juin 2026 ?");
    expect(financePeriodFollowup("Et sur l'année ?", previous, ASOF)).toBe("Quel est le chiffre d'affaires du 1 janvier 2026 au 31 décembre 2026 ?");
    expect(financePeriodFollowup("Étends à toute la semaine.", previous, ASOF)).toBe("Quel montant représentent les paiements encaissés du 26 octobre 2026 au 1 novembre 2026 ?");
  });
  it("follows a month question too", () => {
    expect(financePeriodFollowup("Et en mai ?", "Quelles sont les recettes de juin 2026 ?", ASOF)).toBe("Quelles sont les recettes de mai 2026 ?");
  });
});
