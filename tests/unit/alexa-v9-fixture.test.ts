import { describe, expect, it } from "vitest";
import { validateFixtureTarget } from "../../scripts/seed-alexa-v9-fixture.mjs";

describe("the Alexa V9 fixture seeder refuses unsafe targets", () => {
  it("requires an explicit URL", () => {
    expect(() => validateFixtureTarget(undefined)).toThrow("FIXTURE_DATABASE_URL_REQUIRED");
    expect(() => validateFixtureTarget("")).toThrow("FIXTURE_DATABASE_URL_REQUIRED");
  });

  it("rejects non-PostgreSQL and non-loopback targets", () => {
    expect(() => validateFixtureTarget("https://127.0.0.1/db")).toThrow("FIXTURE_DATABASE_URL_INVALID");
    expect(() => validateFixtureTarget("postgresql://postgres@db.example/alexa_eval_v9_fixture_20261030")).toThrow("FIXTURE_LOOPBACK_ONLY");
  });

  it("requires the dedicated V9 fixture database name", () => {
    expect(() => validateFixtureTarget("postgresql://postgres@127.0.0.1:55445/alexa_eval_v8_intelligence_20261027")).toThrow("FIXTURE_DATABASE_NAME_REQUIRED");
    expect(() => validateFixtureTarget("postgresql://postgres@127.0.0.1:55445/mindcare")).toThrow("FIXTURE_DATABASE_NAME_REQUIRED");
  });

  it("accepts only the dedicated fixture target", () => {
    expect(validateFixtureTarget("postgresql://postgres@127.0.0.1:55445/alexa_eval_v9_fixture_20261030")).toEqual({
      database: "alexa_eval_v9_fixture_20261030",
      host: "127.0.0.1",
      port: "55445",
    });
  });
});
