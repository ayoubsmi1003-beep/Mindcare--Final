import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = resolve("supabase/migrations/120_alexa_context_reads.sql");
const source = () => existsSync(file) ? readFileSync(file, "utf8") : "";
describe("Alexa audited read gate SQL contract (does not qualify live RLS)", () => {
  it("adds direct chronological keyset reads rather than event-window filtering", () => {
    expect(source()).toMatch(/c\.status\s*=\s*'closed'/);
    expect(source()).toMatch(/ORDER BY c\.started_at DESC, c\.id DESC/);
    expect(source()).toMatch(/\(c\.started_at, c\.id\)\s*<\s*\(p_before_at, p_before_id\)/);
    expect(source()).not.toContain("list_patient_timeline");
  });
  it("audits through the existing RLS-bearing gatekeeper without granting data to callers", () => {
    expect(source()).toContain("app.get_patient(p_patient_id)");
    expect(source()).toContain("OWNER TO app_gatekeeper");
    expect(source()).toContain("FROM PUBLIC");
    expect(source()).toMatch(/GRANT EXECUTE ON FUNCTION app\.get_alexa_clinical_context/);
    expect(source().replace(/--[^\n]*/g, "")).not.toMatch(/(?:CREATE TABLE|ALTER TABLE|CREATE TYPE|CREATE POLICY|\bBYPASSRLS\b|GRANT SELECT[^;]+TO authenticated)/i);
  });
  it("covers all notes, amendments and treatment mutations in the source revision", () => {
    for (const table of ["clinical_notes", "clinical_note_amendments", "patient_treatments", "patient_treatment_history", "diagnoses", "scale_administrations"]) expect(source()).toContain(`app.${table}`);
    expect(source()).toContain("sourceRevision");
    expect(source()).toMatch(/sha256\(/);
    expect(source()).toContain("historyComplete");
  });
});
