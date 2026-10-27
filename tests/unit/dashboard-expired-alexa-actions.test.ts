import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/188_alexa_expired_actions_dashboard.sql",
  "utf8",
);

it("omits expired proposals from the same dashboard read that feeds confirmation cards", () => {
  expect(migration).toContain("j.state      = 'proposed'");
  expect(migration).toMatch(/j\.expires_at\s+IS NULL OR j\.expires_at\s*>=\s*now\(\)/u);
  expect(migration).toContain("ALTER FUNCTION app.dashboard_today(date) OWNER TO app_gatekeeper");
  expect(migration).toContain("GRANT EXECUTE ON FUNCTION app.dashboard_today(date) TO authenticated");
  expect(migration).not.toMatch(/UPDATE\s+app\.jarvis_actions|DELETE\s+FROM\s+app\.jarvis_actions/iu);
});
