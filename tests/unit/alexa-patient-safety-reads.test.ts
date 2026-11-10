import { describe, expect, it } from "vitest";
import { PATIENT_SAFETY_GATES, PATIENT_SAFETY_SECTIONS, patientSafetyRead } from "@/server/alexa/patient-safety-reads";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";
import { agentSchemas } from "@/shared/alexa/agent";
import { resolvePatientFollowup } from "@/server/alexa/conversation-frame";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const noted = { substance: "Pénicilline", substance_key: "penicilline", reaction: "urticaire", severity: "severe", event_kind: "noted", recorded_at: "2026-01-10T10:00:00Z" };

describe("patientSafetyRead", () => {
  it("never words an empty result as the patient having none", () => {
    for (const section of PATIENT_SAFETY_SECTIONS) {
      const read = patientSafetyRead(section, []);
      expect(read.empty).toBe(true);
      expect(read.text).toMatch(/consign/u);
      expect(read.text).toMatch(/visible/u);
    }
  });
  it("uses the newest event per substance", () => {
    const read = patientSafetyRead("allergies", [
      { ...noted, event_kind: "resolved", recorded_at: "2026-03-01T10:00:00Z" },
      noted,
      { ...noted, substance: "Lithium", substance_key: "lithium", severity: null, reaction: null },
    ]);
    expect(read.text).toContain("Lithium");
    expect(read.text).not.toContain("Pénicilline, sévère");
    expect(read.text).toContain("1 allergie(s) consignée(s) ensuite résolue(s)");
  });
  it("does not report a resolved allergy as active", () => {
    const read = patientSafetyRead("allergies", [{ ...noted, event_kind: "refuted", recorded_at: "2026-03-01T10:00:00Z" }, noted]);
    expect(read.text).toMatch(/^Aucune allergie/u);
    expect(read.empty).toBe(false);
  });
  it("states recorded severity and resolution without interpretation", () => {
    const read = patientSafetyRead("adverse_events", [{ symptom: "Tremblement", severity: "modere", onset_date: "2026-02-01", resolved_date: null, recorded_at: "2026-02-02T10:00:00Z" }]);
    expect(read.text).toContain("Tremblement, modéré, depuis le 2026-02-01, non résolu");
  });
  it("keeps exact measurement values and their source", () => {
    const read = patientSafetyRead("measurements", [{ kind: "lithiémie", value: "0.8", unit: "mmol/L", measured_at: "2026-02-01T08:00:00Z", source: "laboratoire" }]);
    expect(read.text).toContain("lithiémie : 0,8 mmol/L le 2026-02-01 (laboratoire)");
  });
  it("says when the list is cut", () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({ kind: `k${index}`, value: 1, unit: "u", measured_at: "2026-02-01T08:00:00Z", source: "consultation" }));
    const read = patientSafetyRead("measurements", rows);
    expect(read.complete).toBe(false);expect(read.rows).toBe(25);expect(read.text).toContain("D’autres éléments");
  });
  it("fails on an unexpected row rather than guessing", () => {
    expect(() => patientSafetyRead("adverse_events", [{ symptom: "x", severity: "inconnu" }])).toThrow();
  });
});

describe("routing", () => {
  it.each([
    ["Quelles allergies du patient sélectionné ?", "allergies"],
    ["Ce patient a-t-il des allergies ?", "allergies"],
    ["Quelle est l'observance de ce patient ?", "adherence"],
    ["Quels effets indésirables sont consignés dans son dossier ?", "adverse_events"],
    ["Quel est le poids de ce patient ?", "measurements"],
    ["Quelle est la dernière lithiémie du patient sélectionné ?", "measurements"],
  ])("%s -> %s", (question, section) => {
    expect(frenchRequestAdmission(question, false)).toMatchObject({ tools: ["get_patient_context"], patientSection: section });
  });
  it("accepts every section in the tool schema", () => {
    for (const section of PATIENT_SAFETY_SECTIONS) expect(agentSchemas.get_patient_context.safeParse({ partIds: ["p"], section, patientId: "22222222-2222-4222-8222-222222222222" }).success).toBe(true);
  });
  it("leaves a book question about a drug's side effects to the books", () => {
    expect(frenchRequestAdmission("Quels sont les effets indésirables de la sertraline ?", false).patientSection).toBeUndefined();
  });
  it("resolves a bare follow-up", () => {
    expect(resolvePatientFollowup("Et ses allergies ?")).toEqual({ kind: "rewrite", text: "Quelles allergies du patient sélectionné ?" });
  });
  it("only reads through allowlisted gates", () => {
    const allowlist = readFileSync(join(process.cwd(), "src", "server", "db", "allowlist.generated.ts"), "utf8");
    for (const gate of Object.values(PATIENT_SAFETY_GATES)) expect(allowlist).toContain(`"${gate}"`);
  });
});
