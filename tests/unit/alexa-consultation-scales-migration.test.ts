import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/194_alexa_consultation_scale_read.sql"), "utf8");

it("reads all scale administrations only for the authorized patient and exact consultation", () => {
  expect(migration).toContain("app.get_alexa_consultation_scales(");
  expect(migration).toContain("FROM app.get_patient(p_patient_id)");
  expect(migration).toContain("app.can_see_clinical(v_patient.practitioner_id)");
  expect(migration).toContain("c.id = p_consultation_id AND c.patient_id = p_patient_id");
  expect(migration).toContain("sa.patient_id = p_patient_id");
  expect(migration).toContain("sa.consultation_id = p_consultation_id");
  expect(migration).toContain("'responses', sa.responses");
  expect(migration).toContain("'definition'");
  expect(migration).toContain("ORDER BY sa.administered_at, sa.id");
  expect(migration).toContain("GRANT EXECUTE ON FUNCTION app.get_alexa_consultation_scales(uuid, uuid) TO authenticated");
  expect(migration).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+TYPE/iu);
});
