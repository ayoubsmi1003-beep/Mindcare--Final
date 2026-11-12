import { describe, expect, it } from "vitest";
import { parsePatientMention } from "@/shared/alexa/patient-mention";
import { patientQuestionFrame } from "@/shared/alexa/patient-question";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";

// Development wordings, never C270/H270.
const ASOF = "2026-10-26T09:30:00+01:00";
const named = { contextPatient: false, followup: false } as const;
describe("a patient named first, as the topic of the sentence", () => {
  it("reads « Sur / Concernant / À propos de <nom>, … » as that patient, like « Pour <nom>, … »", () => {
    expect(parsePatientMention("Sur Amina Kaci, son dernier traitement ?")).toEqual({ status: "named", name: "Amina Kaci" });
    expect(parsePatientMention("Au sujet de amina kaci, combien de séances ?")).toEqual({ status: "named", name: "amina kaci" });
    expect(patientQuestionFrame("Concernant Amina Kaci, son traitement ?", named, ASOF)?.text).toBe("Quel est le traitement de Amina Kaci ?");
  });
  it("leaves a topic or a pointer after « Sur » unnamed", () => {
    for (const text of ["Sur la dépression, que dit le livre ?", "Sur ce point, quel est le délai ?"]) expect(parsePatientMention(text), text).toEqual({ status: "none" });
  });
});

describe("what the doctor wrote at a visit is the note", () => {
  it("reads « écrit », « consigné » with a visit word as the note, with its area", () => {
    expect(frenchRequestAdmission("Pour Amina Kaci, qu'avais-je écrit dans l'évaluation à la dernière séance ?", false, ASOF)).toMatchObject({ tools: ["get_patient_context"], patientSection: "notes", noteArea: "assessment" });
    expect(frenchRequestAdmission("Qu'ai-je consigné lors de son dernier entretien ?", false, ASOF)).toMatchObject({ tools: ["get_patient_context"], patientSection: "notes" });
    expect(patientQuestionFrame("Amina Kaci, qu'avais-je écrit à sa dernière visite ?", named, ASOF)?.text).toBe("Résume la dernière consultation de Amina Kaci.");
  });
  it("keeps a list of visits a list", () => {
    expect(frenchRequestAdmission("Liste les séances de Amina Kaci.", false, ASOF).tools).toEqual(["query_consultations"]);
  });
});
