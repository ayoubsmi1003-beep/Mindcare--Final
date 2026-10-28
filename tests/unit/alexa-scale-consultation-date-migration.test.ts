import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const migration=readFileSync(join(process.cwd(),"supabase/migrations/193_alexa_scale_consultation_date.sql"),"utf8");

it("adds the linked consultation date to the audited scale projection without adding business schema",()=>{
  expect(migration).toContain("'consultationStartedAt', c.started_at");
  expect(migration).toContain("'scaleId', s.scale_id");
  expect(migration).toContain("LEFT JOIN app.consultations c ON c.id = s.consultation_id AND c.patient_id = s.patient_id");
  expect(migration).toContain("ALTER FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) OWNER TO app_gatekeeper");
  expect(migration).toContain("GRANT EXECUTE ON FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) TO authenticated");
  expect(migration).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+TYPE/iu);
});
