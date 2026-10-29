import { describe, expect, it } from "vitest";

import { resumeDeSeance } from "@/components/consultation/resume-seance";
import type { AnalyseSeance } from "@/services/jarvis";
import type { Consultation } from "@/services/consultations";

function consultation(soap: Partial<NonNullable<Consultation["note"]>["soap"]> | null): Consultation {
  return {
    id: "a4000000-0000-4000-8000-000000000001",
    patientId: null,
    startedAt: "2026-10-25T16:45:00Z",
    endedAt: "2026-10-25T17:15:00Z",
    status: "closed",
    kind: "suivi",
    practitionerName: "Praticienne",
    rawNotes: null,
    sessionDetails: null,
    note: soap === null ? null : {
      id: "a5000000-0000-4000-8000-000000000001",
      version: "1",
      status: "draft",
      signerName: null,
      signedAt: null,
      soap: {
        subjective: soap.subjective ?? "",
        objective: soap.objective ?? "",
        assessment: soap.assessment ?? "",
        plan: soap.plan ?? "",
      },
      amendments: [],
    },
  } as unknown as Consultation;
}

function analyse(resume: string): AnalyseSeance {
  return {
    resume,
    resumeNotes: resume,
    aJour: true,
    evaluations: [],
    noteStructuree: { subjective: "", objective: "", assessment: "", plan: "" },
    evolution: [],
    pointsNonExplores: [],
    analyseId: "a6000000-0000-4000-8000-000000000001",
    version: 1,
    persistee: true,
    sources: { historiqueNotes: 0 },
  };
}

describe("resumeDeSeance", () => {
  it("keeps a recorded analysis as the authoritative summary", () => {
    const result = resumeDeSeance(analyse("La séance documente une anxiété persistante."), consultation(null));
    expect(result.source).toBe("analyse");
    expect(result.texte).toBe("La séance documente une anxiété persistante.");
  });

  it("composes one factual paragraph from the recorded SOAP fields", () => {
    const result = resumeDeSeance(null, consultation({
      subjective: "- Humeur stable.\n- Sommeil conservé.",
      objective: "Contact adapté.",
      assessment: "Anxiété contenue.",
      plan: "Poursuivre le traitement. Revoir dans un mois.",
    }));
    expect(result.source).toBe("factuel");
    expect(result.texte).toMatch(/humeur stable/iu);
    expect(result.texte).toMatch(/contact adapté/iu);
    expect(result.texte).toMatch(/anxiété contenue/iu);
    expect(result.texte).toMatch(/poursuivre le traitement/iu);
    expect(result.texte).not.toContain("\n");
    expect(result.texte).not.toContain("- Humeur");
    expect(result.actions).toContain("Poursuivre le traitement");
  });

  it("never invents a summary when the session is empty", () => {
    const result = resumeDeSeance(null, consultation(null));
    expect(result.source).toBe("aucun");
    expect(result.texte).toBe("");
  });

  it("normalizes a multi-line analysis into one paragraph", () => {
    const result = resumeDeSeance(analyse("Première phrase.\n\nDeuxième phrase."), consultation(null));
    expect(result.texte).toBe("Première phrase. Deuxième phrase.");
  });
});
