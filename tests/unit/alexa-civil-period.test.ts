import { describe, expect, it } from "vitest";
import { relativeFrenchPeriod } from "@/shared/alexa/civil-period";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";
import { parsePatientMention } from "@/shared/alexa/patient-mention";

// A Monday in the cabinet's calendar; development wordings, written apart from C270 and H270.
const asOf = "2026-10-26T09:30:00+01:00";
const days = (text: string) => { const r = relativeFrenchPeriod(text, asOf); return r ? [r.from.slice(0, 10), r.to.slice(0, 10)] : null; };

describe("one civil period named in a sentence", () => {
  it.each([
    ["Séances d'hier", ["2026-10-25", "2026-10-26"]],
    ["Le planning d'avant-hier", ["2026-10-24", "2026-10-25"]],
    ["Le bilan de la semaine passée", ["2026-10-19", "2026-10-26"]],
    ["Pour la semaine prochaine", ["2026-11-02", "2026-11-09"]],
    ["Activité du mois précédent", ["2026-09-01", "2026-10-01"]],
    ["Recettes de l'année précédente", ["2025-01-01", "2026-01-01"]],
    ["Tout ce qui s'est passé l'an passé", ["2025-01-01", "2026-01-01"]],
    ["Pour l'exercice 2024", ["2024-01-01", "2025-01-01"]],
    ["Depuis le début de la semaine", ["2026-10-26", "2026-10-27"]],
    ["depuis le début de cette année", ["2026-01-01", "2026-10-27"]],
    ["Depuis mars", ["2026-03-01", "2026-10-27"]],
    ["Depuis le 15 septembre", ["2026-09-15", "2026-10-27"]],
    ["Depuis décembre", ["2025-12-01", "2026-10-27"]],
    ["Le trimestre en cours", ["2026-10-01", "2027-01-01"]],
    ["Le trimestre dernier", ["2026-07-01", "2026-10-01"]],
  ])("%s", (text, range) => expect(days(text)).toEqual(range));
  it("names no period, two periods, or a date the explicit parsers own", () => {
    for (const text of ["Maintenant, ses notes", "Le fichier du patient", "Septembre comparé à octobre", "hier et aujourd'hui", "le 3 mars 2025", "en mai", "Depuis le 31 février"]) expect(days(text)).toBeNull();
  });
});

describe("the admission reads the period instead of asking or reading everything", () => {
  it.each(["Nombre de séances la semaine passée", "Liste des consultations d'avant-hier", "Combien de consultations l'année précédente ?", "Consultations depuis le début du mois"])("%s", (text) => {
    const scope = frenchRequestAdmission(text, false, asOf);
    expect(scope.tools).toEqual(["query_consultations"]);
    expect(scope.from && scope.to).toBeTruthy();
  });
  it("a rank among visits is not a calendar period", () => {
    expect(frenchRequestAdmission("Résume la dernière séance de Salim Ouared", false, asOf).unboundedPeriod).not.toBe(false);
  });
  it("a period it cannot read is still a period: never all of history in silence", () => {
    expect(frenchRequestAdmission("Combien de consultations ce semestre ?", false, asOf).unboundedPeriod).toBe(false);
  });
  it("calendar words are never a patient's name", () => {
    for (const text of ["Combien de consultations avant-hier ?", "Consultations du trimestre", "Rendez-vous d'après-demain"]) expect(parsePatientMention(text).status).not.toBe("named");
  });
});

describe("practice reads keep the period that was asked", () => {
  it("money over a relative period carries its dates", () => {
    const scope = frenchRequestAdmission("Les dépenses du cabinet la semaine passée ?", false, asOf);
    expect(scope.tools).toEqual(["query_finance"]);
    expect([scope.from?.slice(0, 10), scope.to?.slice(0, 10)]).toEqual(["2026-10-19", "2026-10-26"]);
  });
  it("activity over a period its frame cannot write is not read as the current month", async () => {
    const { activityQuestionFrame } = await import("@/shared/alexa/practice-frame");
    // Last week is read as its explicit days (Monday to Sunday), never as the current month.
    expect(activityQuestionFrame("Combien de patients différents avons-nous reçus la semaine passée ?", asOf)).toMatch(/^Montre-moi les statistiques du \d+ \S+ \d{4} au \d+ \S+ \d{4}$/u);
    expect(activityQuestionFrame("Combien de patients différents avons-nous reçus l'an passé ?", asOf)).toBeNull();
    expect(activityQuestionFrame("Combien de patients différents avons-nous reçus ce mois-ci ?", asOf)).toContain("ce mois");
  });
});
