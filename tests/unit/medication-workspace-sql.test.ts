import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/211_medication_workspace_reads.sql",
);

function lire(): string {
  return readFileSync(MIGRATION, "utf8");
}

describe("migration 211 — lectures de l'espace traitements", () => {
  it("reste strictement en lecture : aucune table, colonne ou enum", () => {
    const sql = lire();
    expect(sql).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+TYPE\b/i);
    expect(sql).not.toMatch(/\bADD\s+COLUMN\b/i);
  });

  it("étend la lecture existante et ouvre les trois lectures ciblées", () => {
    const sql = lire();
    expect(sql).toContain("CREATE OR REPLACE FUNCTION app.get_patient_treatments(");
    expect(sql).toContain("app.list_patient_medication_timeline(");
    expect(sql).toContain("app.get_patient_session_measures(");
    expect(sql).toContain("app.list_medication_workload(");
  });

  it("garde la cloison clinique et la trace de lecture sur chaque porte", () => {
    const sql = lire();
    expect(sql.match(/can_see_clinical/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(sql.match(/audit\.log_read/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(sql).toMatch(/v_role\s+NOT\s+IN\s+\('owner',\s*'practitioner'\)/i);
  });

  it("sépare l'émission de l'annulation d'une ordonnance", () => {
    const sql = lire();
    expect(sql).toContain("'document_issued'::text");
    expect(sql).toContain("'document_voided'::text");
    expect(sql).toContain("uuid_generate_v5");
    expect(sql).toContain("d.voided_at");
  });

  it("filtre la file de charge côté base, avec un tri total", () => {
    const sql = lire();
    expect(sql).toContain("p_attention text");
    expect(sql).toContain("v_attention = 'revue'");
    expect(sql).toContain("v_attention = 'fin'");
    expect(sql).toContain("first_name ASC, patient_id ASC");
    expect(sql).toContain("DROP FUNCTION IF EXISTS app.list_medication_workload(text, integer, integer)");
  });

  it("passe chaque porte à app_gatekeeper sans élargir PUBLIC", () => {
    const sql = lire();
    expect(sql.match(/OWNER TO app_gatekeeper/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(sql.match(/REVOKE ALL ON FUNCTION/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(sql.match(/GRANT EXECUTE ON FUNCTION/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("INSERT INTO app.schema_migrations");
  });
});
