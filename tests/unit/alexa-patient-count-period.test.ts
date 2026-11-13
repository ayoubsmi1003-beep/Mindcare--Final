import { describe, expect, it } from "vitest";
import { patientQuestionFrame } from "@/shared/alexa/patient-question";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";
import { applicationReadCopy } from "@/i18n/alexa-application";

// A Monday in the cabinet's calendar; development wordings, written apart from C270 and H270. Names are invented.
const asOf = "2026-10-26T09:30:00+01:00";
const onScreen = { contextPatient: true, followup: false };
const frame = (text: string) => patientQuestionFrame(text, onScreen, asOf)?.text ?? null;

describe("a patient's visit count keeps the period that was asked", () => {
  it.each([
    ["Il est venu combien de fois l'an passé ?", "Combien de consultations a le patient sélectionné du 01/01/2025 au 31/12/2025 ?"],
    ["Combien de séances avec lui depuis le début de l'année ?", "Combien de consultations a le patient sélectionné du 01/01/2026 au 26/10/2026 ?"],
    ["Elle est venue combien de fois la semaine dernière ?", "Combien de consultations a le patient sélectionné du 19/10/2026 au 25/10/2026 ?"],
    ["Salim Ouared est venu combien de fois depuis mars ?", "Nombre de consultations pour Salim Ouared du 01/03/2026 au 26/10/2026."],
    ["Nombre de passages de Nadia Kerrouche en 2024 ?", "Nombre de consultations pour Nadia Kerrouche du 01/01/2024 au 31/12/2024."],
  ])("%s", (text, canonical) => expect(frame(text)).toBe(canonical));

  it("the canonical sentence is read with those dates, for that patient", () => {
    const scope = frenchRequestAdmission("Combien de consultations a le patient sélectionné du 01/01/2025 au 31/12/2025 ?", false, asOf);
    expect(scope.tools).toEqual(["query_consultations"]);
    expect([scope.from?.slice(0, 10), scope.to?.slice(0, 10)]).toEqual(["2025-01-01", "2026-01-01"]);
  });

  it("without a period, the whole record is counted as before", () => {
    expect(frame("Il est venu combien de fois ?")).toBe("Combien de consultations a le patient sélectionné ?");
    expect(frame("Combien de séances a-t-il eues depuis le début ?")).toBe("Combien de consultations a le patient sélectionné ?");
    expect(frame("Combien de fois l'ai-je vu lors des trois dernières consultations ?")).not.toMatch(/du d/u);
  });

  it("a period it cannot read never becomes the whole record", () => {
    expect(frame("En septembre et octobre, combien de séances avec lui ?")).toBeNull();
    expect(frame("Combien de fois est-il venu ce semestre ?")).toBeNull();
  });

  it("a period still means the practice when nobody is named", () => {
    expect(frame("Combien de patients l'an passé ?")).toBeNull();
    expect(frame("Combien de consultations au cabinet ce mois ?")).toBeNull();
    expect(frame("Combien de séances la semaine dernière ?")).toBeNull();
  });

  it("other sections never drop a period silently", () => {
    expect(frame("Son traitement de l'an passé ?")).toBeNull();
  });
});

describe("the count says which period it covers", () => {
  it("names the period before the number", () => {
    expect(applicationReadCopy.consultationCount(12, "closed", true, { from: "2025-01-01T00:00:00+01:00", to: "2026-01-01T00:00:00+01:00" })).toBe("Du 01/01/2025 au 31/12/2025, ce dossier contient 12 consultations terminées.");
    expect(applicationReadCopy.consultationCount(0, "closed", true, { from: "2026-10-25T00:00:00+01:00", to: "2026-10-26T00:00:00+01:00" })).toBe("Le 25/10/2026, ce dossier ne contient aucune consultation terminée.");
    expect(applicationReadCopy.consultationCount(3, undefined, true)).toBe("Ce dossier contient 3 consultations enregistrées.");
  });
});

describe("words that only look like a period", () => {
  it("a word containing a period word, or a duration, is no period", () => {
    // "depuis le début" is no period: the question is read, as the treatment's recorded changes. (Development wording, not C270's.)
    expect(patientQuestionFrame("Sa posologie a-t-elle été ajustée depuis le début ?", onScreen, asOf)?.section).toBe("treatchanges");
    expect(frame("Depuis combien d'années le suit-on au cabinet ?")).not.toBeNull();
  });
});
