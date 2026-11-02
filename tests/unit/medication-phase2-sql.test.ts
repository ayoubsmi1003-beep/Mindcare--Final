import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SCHEMA = resolve(process.cwd(), "supabase/migrations/212_medication_phase2_schema.sql");
const GATES = resolve(process.cwd(), "supabase/migrations/213_medication_phase2_gates.sql");

function lire(chemin: string): string {
  return readFileSync(chemin, "utf8");
}

describe("migration 212 — schéma Phase 2", () => {
  it("ajoute les faits cliniques attendus sans toucher aux tables existantes", () => {
    const sql = lire(SCHEMA);
    for (const table of [
      "patient_allergy_events",
      "patient_adverse_events",
      "patient_measurements",
      "treatment_adherence_reports",
      "treatment_interaction_reviews",
      "interaction_review_treatments",
      "prescription_renewal_links",
    ]) {
      expect(sql).toContain(`app.${table}`);
    }
    expect(sql).not.toMatch(/ALTER TABLE app\.patient_treatments/);
    expect(sql).not.toMatch(/ALTER TABLE app\.documents/);
    expect(sql).not.toMatch(/\bDROP TABLE\b/i);
  });

  it("force la RLS clinique et ne crée aucune policy assistant", () => {
    const sql = lire(SCHEMA);
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
    expect(sql).toContain("app.can_see_clinical(p.practitioner_id)");
    expect(sql).not.toMatch(/TO assistant/i);
    expect(sql).not.toMatch(/role\s*=\s*'assistant'/i);
  });

  it("rend chaque fait append-only", () => {
    const sql = lire(SCHEMA);
    expect(sql).toContain("forbid_phase2_mutation");
    expect(sql).toContain("BEFORE UPDATE OR DELETE");
    expect(sql).toContain("interaction_review_treatments");
  });
});

describe("migration 213 — portes Phase 2", () => {
  it("trace chaque lecture et vérifie la cloison clinique", () => {
    const sql = lire(GATES);
    expect(sql.match(/audit\.log_read/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(sql.match(/can_see_clinical/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(sql).toContain("app.current_role() NOT IN ('owner','practitioner')");
  });

  it("passe les portes à app_gatekeeper sans élargir PUBLIC", () => {
    const sql = lire(GATES);
    expect(sql.match(/OWNER TO app_gatekeeper/g)?.length ?? 0).toBeGreaterThanOrEqual(12);
    expect(sql.match(/REVOKE ALL ON FUNCTION/g)?.length ?? 0).toBeGreaterThanOrEqual(12);
    expect(sql.match(/GRANT EXECUTE ON FUNCTION/g)?.length ?? 0).toBeGreaterThanOrEqual(12);
  });

  it("refuse toute écriture non clinique et toute suppression", () => {
    const sql = lire(GATES);
    expect(sql).toContain("Rôle non clinique");
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+app\./i);
    expect(sql).not.toMatch(/\\bTRUNCATE\\b/i);
  });
});
