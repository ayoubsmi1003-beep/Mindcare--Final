import { describe, expect, it } from "vitest";
import { classifyPatientQuestion, patientQuestionFrame } from "@/shared/alexa/patient-question";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";

// Development wordings, never C270/H270.
const ASOF = "2026-10-26T09:30:00+01:00";

describe("what was written at the very first visit", () => {
  it("is that visit's note, read by the notes reader", () => {
    for (const text of ["Qu'avais-je écrit à sa toute première séance ?", "Que contenait la note de la première consultation de Karim Benali ?", "La première fois qu'on l'a vu, qu'est-ce qui a été consigné ?"]) {
      expect(classifyPatientQuestion(text)?.section, text).toBe("firstnote");
    }
    const frame = patientQuestionFrame("Que contenait la note de la première consultation de Karim Benali ?", { contextPatient: false, followup: false }, ASOF)!;
    expect(frenchRequestAdmission(frame.text, false, ASOF)).toMatchObject({ tools: ["get_patient_context"], patientSection: "notes" });
  });
  it("keeps the date of the first visit, and the first and last visits together, as before", () => {
    expect(classifyPatientQuestion("C'était quand sa première consultation ?")?.section).toBe("firstdate");
    expect(classifyPatientQuestion("Sa première et sa dernière consultation, c'était quand ?")?.section).toBe("bounds");
  });
});

describe("« ouvre-moi » a person named in full", () => {
  it("reads that person's record summary", () => {
    const frame = patientQuestionFrame("Ouvre-moi Karim Benali.", { contextPatient: true, followup: false }, ASOF);
    expect(frame?.section).toBe("summary");
    expect(frame?.subject).toEqual({ kind: "named", name: "Karim Benali" });
  });
  it("never reads a screen as a person", () => {
    for (const text of ["Ouvre l'agenda.", "Ouvre le planning de demain.", "Ouvre-moi les finances.", "Ouvre la liste des patients."]) expect(classifyPatientQuestion(text), text).toBeNull();
  });
});

describe("a visit count asked again for another period", () => {
  it("replaces only the period, « d'avant » counted from the previous one", async () => {
    const { patientCountPeriodFollowup } = await import("@/shared/alexa/patient-question");
    const previous = "Combien de consultations a le patient sélectionné du 01/01/2026 au 26/10/2026 ?";
    expect(patientCountPeriodFollowup("Pareil pour l'année d'avant.", previous, ASOF)).toBe("Combien de consultations a le patient sélectionné du 01/01/2025 au 31/12/2025 ?");
    expect(patientCountPeriodFollowup("Et en 2023 ?", "Nombre de consultations pour Karim Benali du 01/01/2025 au 31/12/2025.", ASOF)).toBe("Nombre de consultations pour Karim Benali du 01/01/2023 au 31/12/2023.");
    expect(patientCountPeriodFollowup("Et en 2023 ?", "Quel est le traitement de Karim Benali ?", ASOF)).toBeNull();
  });
});

describe("« côté … » and « celui-ci » in a follow-up", () => {
  it("read the patient in context, never a person named « Côté » or « celui-ci »", () => {
    for (const text of ["Côté traitement, elle en est où ?", "Et pour celle-ci, quel traitement en cours ?"]) {
      expect(patientQuestionFrame(text, { contextPatient: true, followup: true }, ASOF)?.subject, text).toEqual({ kind: "context" });
    }
  });
});

describe("a visit count in other words", () => {
  it("reads « à combien de reprises a-t-elle consulté » as the count over the year named", () => {
    expect(patientQuestionFrame("En 2024, à combien de reprises a-t-elle consulté ?", { contextPatient: true, followup: false }, ASOF)?.text).toBe("Combien de consultations a le patient sélectionné du 01/01/2024 au 31/12/2024 ?");
  });
});

describe("more of the doctor's wordings", () => {
  it("reads « point rapide sur <nom> : … » as that patient's two parts", async () => {
    const { patientQuestionParts } = await import("@/shared/alexa/patient-question");
    const parts = patientQuestionParts("Point rapide sur Karim Benali : dernière consultation et traitement.", { contextPatient: false, followup: false }, ASOF);
    expect(parts?.map((part) => part.section)).toEqual(["lastnote", "treatments"]);
    expect(parts?.[0]?.subject).toEqual({ kind: "named", name: "Karim Benali" });
  });
  it("reads « ce que je dois savoir avant de la faire entrer » as the summary", () => {
    expect(patientQuestionFrame("Avant de la faire entrer, que dois-je savoir ?", { contextPatient: true, followup: false }, ASOF)?.section).toBe("summary");
  });
  it("reads all appointments, past and to come, as the history", () => {
    expect(classifyPatientQuestion("Affiche tous ses rendez-vous, passés et futurs.")?.section).toBe("history");
  });
});
