import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/192_alexa_scale_consultation_context.sql"), "utf8");

it("adds the existing administration-to-consultation link to Alexa's audited context projection", () => {
  expect(migration).toContain("app.get_alexa_clinical_context(uuid,integer,timestamptz,uuid)");
  expect(migration).toContain("'consultationId', s.consultation_id");
  expect(migration).toContain("length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old)");
  expect(migration).toContain("ALTER FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) OWNER TO app_gatekeeper");
  expect(migration).toContain("GRANT EXECUTE ON FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) TO authenticated");
  expect(migration).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+TYPE/iu);
});
