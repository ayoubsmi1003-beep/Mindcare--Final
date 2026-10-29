import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const racine = resolve(process.cwd());
const migration = readFileSync(resolve(racine, "supabase/migrations/205_diagnosis_gates.sql"), "utf8");
const syntheticMigration = readFileSync(resolve(racine, "supabase/migrations/206_diagnosis_synthetic_flag.sql"), "utf8");
const service = readFileSync(resolve(racine, "src/services/diagnoses.ts"), "utf8");

describe("portes diagnostic (migration 205)", () => {
  it("expose les deux gestes et rien de plus", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.record_diagnosis");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.resolve_diagnosis");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION app.record_diagnosis");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION app.resolve_diagnosis");
    expect(migration).toContain("REVOKE ALL ON FUNCTION app.record_diagnosis");
    expect(migration).toContain("REVOKE ALL ON FUNCTION app.resolve_diagnosis");
  });

  it("ne crée aucune table, colonne ni type", () => {
    expect(migration).not.toMatch(/CREATE\s+TABLE/iu);
    expect(migration).not.toMatch(/ALTER\s+TABLE[\s\S]*ADD\s+COLUMN/iu);
    expect(migration).not.toMatch(/CREATE\s+TYPE/iu);
  });

  it("porte le périmètre, le verrou et la trace", () => {
    expect(migration).toMatch(/FROM app\.patients p[\s\S]*FOR UPDATE/iu);
    expect(migration).toContain("is_primary = false");
    expect(migration).toContain("trg_audit");
    expect(migration).toContain("'205_diagnosis_gates'");
  });

  it("dérive is_synthetic de l'environnement, jamais de l'appelant", () => {
    expect(syntheticMigration).toContain("is_synthetic");
    expect(syntheticMigration).toContain("app.is_cloud_dev()");
    expect(syntheticMigration).toContain("'206_diagnosis_synthetic_flag'");
    expect(syntheticMigration).not.toMatch(/CREATE\s+TABLE/iu);
    expect(syntheticMigration).not.toMatch(/ADD\s+COLUMN/iu);
  });

  it("le service ne lit ni n'écrit aucune table", () => {
    expect(service).toContain('rpc<z.infer<typeof LIGNE>>("record_diagnosis"');
    expect(service).toContain('rpc<z.infer<typeof LIGNE>>("resolve_diagnosis"');
    expect(service).not.toMatch(/from\(\s*["']diagnoses["']/u);
    expect(service).not.toMatch(/insert\s+into/iu);
  });
});
