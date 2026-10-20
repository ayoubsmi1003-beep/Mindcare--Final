import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type SyntheticFixture = {
  target: { host: string; port: number; database: string };
  records: {
    patients: Array<{
      id: string; first_name: string; last_name: string; is_active: boolean;
      is_synthetic: boolean; id_document_number: string | null;
    }>;
    consultations: Array<{ id: string; patient_id: string; status: string; started_at: string }>;
    clinical_notes: Array<{
      consultation_id: string; status: string; ai_draft: boolean;
      subjective: string; objective: string; assessment: string; plan: string;
    }>;
  };
};
type NamedCase = {
  id: string; language: string; input: string; context: { patientId: string | null; page: string }; permittedToolSequence: string[][];
  expected: {
    sourceRefs: Array<{ type: string; id: string; provenance?: { area: string } }>;
    toolArguments: Array<{ name: string; args: Record<string, unknown> }>;
    rpcResults: Array<{
      name: string;
      args: { p_spec: { patientId: string; query: string } };
      path: string[];
      equals: number;
    }>;
  };
};

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "tests/eval/alexa-qwen2-50-patients-fixture.json"), "utf8")) as SyntheticFixture;
const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "tests/eval/alexa-minicpm-100-algerian-cases.json"), "utf8")) as { cases: NamedCase[] };

const namedPatients = [
  {
    patientId: "b5000000-0000-4000-8000-000000000021",
    firstName: "Ayoub",
    lastName: "Salmi",
    marker: "SUBJ-021-S01",
    consultationId: "b5100000-0000-4000-8000-000000000121",
    caseId: "mc-100-051",
    usesSelectedPatient: true,
  },
  {
    patientId: "b5000000-0000-4000-8000-000000000022",
    firstName: "Belkacem",
    lastName: "Ndia",
    marker: "SUBJ-022-S01",
    consultationId: "b5100000-0000-4000-8000-000000000127",
    caseId: "mc-100-055",
    usesSelectedPatient: false,
  },
] as const;

describe("synthetic Alexa evaluation patients", () => {
  it("keeps the requested named patients and their six months of synthetic consultation notes", () => {
    expect(fixture.target).toEqual({ host: "127.0.0.1", port: 55449, database: "alexa_eval_qwen2_50" });
    expect(fixture.records.patients).toHaveLength(50);
    expect(fixture.records.patients.every((patient) => patient.is_synthetic)).toBe(true);
    expect(fixture.records.patients.some((patient) => !patient.id_document_number)).toBe(true);
    expect(fixture.records.patients.some((patient) => patient.id_document_number)).toBe(true);

    for (const spec of namedPatients) {
      const patient = fixture.records.patients.find((candidate) => candidate.id === spec.patientId);
      expect(patient).toMatchObject({
        first_name: spec.firstName,
        last_name: spec.lastName,
        is_active: true,
        is_synthetic: true,
      });

      const consultations = fixture.records.consultations
        .filter((consultation) => consultation.patient_id === spec.patientId)
        .sort((a, b) => a.started_at.localeCompare(b.started_at));
      expect(consultations).toHaveLength(6);
      expect(consultations.every((consultation) => consultation.status === "closed"
        && consultation.started_at >= "2026-04-01T00:00:00+01:00"
        && consultation.started_at < "2026-10-01T00:00:00+01:00")).toBe(true);

      const notes = fixture.records.clinical_notes.filter((note) =>
        consultations.some((consultation) => consultation.id === note.consultation_id));
      expect(notes).toHaveLength(6);
      expect(notes.every((note) => note.status === "draft" && !note.ai_draft
        && [note.subjective, note.objective, note.assessment, note.plan]
          .every((section) => section.includes("FICTIF")))).toBe(true);

      const testCase = manifest.cases.find((candidate) => candidate.id === spec.caseId);
      expect(testCase?.language).toBe("fr");
      expect(testCase?.input).toContain(spec.marker);
      if (spec.usesSelectedPatient) {
        expect(testCase?.context).toEqual({ patientId: spec.patientId, page: "/jarvis" });
        expect(testCase?.input).not.toContain(`${spec.firstName} ${spec.lastName}`);
      } else {
        expect(testCase?.context).toMatchObject({ patientId: null });
        expect(testCase?.input).toContain(`${spec.firstName} ${spec.lastName}`);
      }
      expect(testCase?.permittedToolSequence).toEqual([["get_patient_context"]]);
      expect(testCase?.expected.sourceRefs).toContainEqual({
        type: "consultation",
        id: spec.consultationId,
        provenance: { area: "subjective" },
      });
      expect(testCase?.expected.toolArguments).toContainEqual({
        name: "get_patient_context",
        args: { area: "subjective", query: spec.marker },
      });
      expect(testCase?.expected.rpcResults).toContainEqual({
        name: "query_alexa_note_sections",
        args: { p_spec: { patientId: spec.patientId, query: spec.marker } },
        path: ["total"],
        equals: 1,
      });
    }
  });

  it("keeps 100 distinct French questions in the MiniCPM qualification manifest", () => {
    expect(manifest.cases).toHaveLength(100);
    expect(new Set(manifest.cases.map((testCase) => testCase.id)).size).toBe(100);
    expect(new Set(manifest.cases.map((testCase) => testCase.input.trim())).size).toBe(100);
    expect(manifest.cases.every((testCase) => testCase.language === "fr")).toBe(true);
  });
});
