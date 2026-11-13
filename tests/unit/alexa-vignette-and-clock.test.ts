import { describe, expect, it } from "vitest";
import { requestsPatientScope } from "@/shared/alexa/request-plan";
import { parsePatientMention } from "@/shared/alexa/patient-mention";
import { explicitAgendaClockWindow } from "@/server/alexa/agent-period";

// Development wordings, never C270/H270.
const ASOF = "2026-10-26T09:30:00+01:00";

describe("a clinical vignette's possessive is its own person, not the working patient", () => {
  it("does not ask for the selected patient after « un patient », « une femme », « un enfant »", () => {
    expect(requestsPatientScope("Un patient qui entend des voix depuis son adolescence, quel diagnostic évoquer ?")).toBe(false);
    expect(requestsPatientScope("Une femme enceinte qui arrête brutalement son antidépresseur, quels risques ?")).toBe(false);
  });
  it("still reads a possessive with no vignette, or « ce patient », as the working patient", () => {
    expect(requestsPatientScope("Quel est son traitement ?")).toBe(true);
    expect(requestsPatientScope("Un patient comme ce patient, quelle dose ?")).toBe(true);
  });
});

describe("a family noun is not a patient's name", () => {
  it("reads « la mère », « le père », « le bébé » as people of the question", () => {
    for (const text of ["Faut-il traiter la dépression de la mère pendant l'allaitement ?", "Le traitement du père peut-il passer au bébé ?"]) expect(parsePatientMention(text).status, text).toBe("none");
  });
  it("still reads a full name", () => {
    expect(parsePatientMention("Quel est le traitement de Karim Benali ?").status).toBe("named");
  });
});

describe("one clock time in an agenda read", () => {
  it("reads « de 15 h » as the hour that starts then", () => {
    expect(explicitAgendaClockWindow("Le rendez-vous de 15 h demain ?", ASOF)).toMatchObject({ from: "2026-10-27T15:00:00+01:00", to: "2026-10-27T16:00:00+01:00" });
  });
  it("reads minutes as that exact start", () => {
    expect(explicitAgendaClockWindow("Qui vient à 14 h 30 aujourd'hui ?", ASOF)).toMatchObject({ from: "2026-10-26T14:30:00+01:00", to: "2026-10-26T14:31:00+01:00" });
  });
  it("keeps refusing a time with no day", () => {
    expect(explicitAgendaClockWindow("Le rendez-vous de 15 h ?", ASOF)).toBeNull();
  });
});

describe("a general question about stopping a treatment belongs to the books", () => {
  it("is not read from the record when nobody is in it", async () => {
    const { frenchRequestAdmission } = await import("@/shared/alexa/request-contract");
    expect(frenchRequestAdmission("Peut-on arrêter brutalement un traitement par lithium ?", false, ASOF).tools).toEqual(["search_knowledge"]);
    expect(frenchRequestAdmission("Faut-il stopper le traitement d'une femme qui allaite si le médicament passe dans le lait ?", false, ASOF).tools).toEqual(["search_knowledge"]);
  });
  it("still reads a stopped treatment from the record for the patient", async () => {
    const { frenchRequestAdmission } = await import("@/shared/alexa/request-contract");
    expect(frenchRequestAdmission("Quels traitements arrêtés pour ce patient ?", false, ASOF).tools).toEqual(["get_patient_context"]);
  });
});
