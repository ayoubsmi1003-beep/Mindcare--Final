import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/191_alexa_timeline_revision.sql"), "utf8");

it("adds an audited, bounded timeline fingerprint gate without changing business schema", () => {
  expect(migration).toMatch(/CREATE OR REPLACE FUNCTION app\.get_patient_timeline_revision\(p_id uuid\)/iu);
  expect(migration).toMatch(/FROM app\.list_patient_timeline\(p_id, v_before_at, v_before_id, 50\)/iu);
  expect(migration).toMatch(/md5\(v_total::text \|\| ':' \|\| v_digest\)/iu);
  expect(migration).toMatch(/v_total > 50000[\s\S]*ERRCODE = '54000'/iu);
  expect(migration).toMatch(/ALTER FUNCTION app\.get_patient_timeline_revision\(uuid\) OWNER TO app_gatekeeper/iu);
  expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION app\.get_patient_timeline_revision\(uuid\) TO authenticated/iu);
  expect(migration).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+TYPE/iu);
});
