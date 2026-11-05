import { describe, expect, it } from "vitest";
import { planRequest } from "@/shared/alexa/request-plan";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";
import { parsePatientMention } from "@/shared/alexa/patient-mention";
import { isKnowledgeFollowup, knowledgeFollowupQuestion } from "@/server/alexa/orchestrator";

const asOf = "2026-11-05T12:00:00+01:00";

describe("patient-record routing", () => {
  it("keeps a medical-history question on the selected dossier, not the administrative profile", () => {
    const text = "Quels sont les antécédents médicaux du patient sélectionné ?";
    expect(planRequest(text, null, asOf).intent).toBe("summary");
    expect(frenchRequestAdmission(text, false, asOf)).toMatchObject({
      tools: ["get_patient_context"],
      patientSection: "summary",
    });
  });

  it("answers active treatments from the dossier instead of approved books", () => {
    const text = "Quels traitements sont actuellement actifs ?";
    expect(frenchRequestAdmission(text, false, asOf)).toMatchObject({
      tools: ["get_patient_context"],
      patientSection: "treatments",
      treatmentState: "active",
    });
  });

  it("answers active and resolved diagnoses from the dossier", () => {
    for (const [text, state] of [
      ["Quels diagnostics sont actifs ?", "active"],
      ["Quels diagnostics sont résolus ?", "resolved"],
    ] as const) {
      expect(frenchRequestAdmission(text, false, asOf)).toMatchObject({
        tools: ["get_patient_context"],
        patientSection: "diagnoses",
        diagnosisState: state,
      });
    }
  });

  it("answers noted treatment changes from the treatment history", () => {
    expect(frenchRequestAdmission("Quelles modifications de traitement ont été notées ?", false, asOf)).toMatchObject({
      tools: ["get_patient_context"],
      patientSection: "treatments",
    });
  });

  it("routes a patient financial situation to the governed patient-finance read", () => {
    const text = "Quelle est la situation financière de ce patient ?";
    expect(planRequest(text, null, asOf).intent).toBe("patient_finance");
  });

  it("does not turn first-and-last consultation dates into a period clarification", () => {
    const text = "Quelles sont les dates de la première et de la dernière consultation ?";
    expect(frenchRequestAdmission(text, false, asOf)).toMatchObject({
      tools: ["get_patient_context"],
      patientSection: "summary",
      unboundedPeriod: true,
    });
  });

  it("reads life events from the subjective note area without a model synthesis", () => {
    expect(frenchRequestAdmission("Quels événements de vie sont rapportés dans les notes ?", false, asOf)).toMatchObject({
      tools: ["get_patient_context"],
      patientSection: "notes",
      noteArea: "subjective",
      unboundedPeriod: true,
    });
  });

  it("routes a scale inventory to the patient dossier", () => {
    const text = "Quelles échelles ont été administrées et avec quels scores ?";
    expect(frenchRequestAdmission(text, false, asOf)).toMatchObject({
      tools: ["get_patient_context"],
      patientSection: "scales",
    });
  });

  it("keeps a clinical evolution summary out of the cabinet application view", () => {
    const text = "Résume l'évolution clinique depuis un an.";
    expect(planRequest(text, null, asOf).intent).toBe("longitudinal");
    expect(frenchRequestAdmission(text, false, asOf)).toMatchObject({
      tools: ["get_patient_context"],
      patientSection: "summary",
    });
  });

  it("does not treat 'sans ajouter de fait' as a write proposal", () => {
    const text = "Résume la dernière consultation sans ajouter de fait absent.";
    expect(planRequest(text, null, asOf).intent).not.toBe("proposal");
    expect(frenchRequestAdmission(text, false, asOf)).toMatchObject({
      tools: ["get_patient_context"],
      patientSection: "summary",
    });
  });

  it("builds a focused clinical follow-up instead of concatenating two questions", () => {
    expect(isKnowledgeFollowup("Quelles précautions pour la sertraline ?", "Et pour la grossesse ?")).toBe(true);
    expect(knowledgeFollowupQuestion("Quelles précautions pour la sertraline ?", "Et pour la grossesse ?"))
      .toBe("Quelles précautions pour la sertraline pendant la grossesse ?");
    expect(isKnowledgeFollowup("Quelle est la posologie de la sertraline ?", "Et en cas d'insuffisance rénale ?")).toBe(true);
    expect(knowledgeFollowupQuestion("Quelle est la posologie de la sertraline ?", "Et en cas d'insuffisance rénale ?"))
      .toBe("Quelle est la posologie de la sertraline en cas d'insuffisance rénale ?");
    expect(parsePatientMention("Quelles précautions pour la sertraline pendant la grossesse ?")).toEqual({ status: "none" });
    expect(frenchRequestAdmission("Quelles précautions pour la sertraline pendant la grossesse ?", false, asOf))
      .toMatchObject({ tools: ["search_knowledge"] });
  });

  it("does not read a clinical noun as a patient identity", () => {
    expect(parsePatientMention("Quels événements de vie sont rapportés dans les notes ?")).toEqual({ status: "none" });
    expect(parsePatientMention("Et pour la grossesse ?")).toEqual({ status: "none" });
    expect(parsePatientMention("Et en cas d'insuffisance rénale ?")).toEqual({ status: "none" });
  });
});
