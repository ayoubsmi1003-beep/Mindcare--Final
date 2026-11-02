import { describe, expect, it } from "vitest";
import { validateAuditTarget } from "../../scripts/audit-alexa-dataset-readonly.mjs";

describe("the Alexa dataset audit refuses unsafe targets", () => {
  it("requires an explicit URL", () => {
    expect(() => validateAuditTarget(undefined)).toThrow("AUDIT_DATABASE_URL_REQUIRED");
    expect(() => validateAuditTarget("")).toThrow("AUDIT_DATABASE_URL_REQUIRED");
  });

  it("rejects non-PostgreSQL and non-loopback targets", () => {
    expect(() => validateAuditTarget("https://127.0.0.1/db")).toThrow("AUDIT_DATABASE_URL_INVALID");
    expect(() => validateAuditTarget("postgresql://postgres@db.example/alexa_eval_v8_intelligence_20261027")).toThrow("AUDIT_LOOPBACK_ONLY");
  });

  it("requires the disposable synthetic database by default", () => {
    expect(() => validateAuditTarget("postgresql://postgres@127.0.0.1:55445/mindcare")).toThrow("AUDIT_SYNTHETIC_DATABASE_REQUIRED");
  });

  it("accepts the verified synthetic target", () => {
    expect(validateAuditTarget("postgresql://postgres@127.0.0.1:55445/alexa_eval_v8_intelligence_20261027")).toEqual({
      database: "alexa_eval_v8_intelligence_20261027",
      host: "127.0.0.1",
      port: "55445",
      cabinet: false,
    });
  });

  it("allows a cabinet target only with the explicit read-only flag", () => {
    expect(validateAuditTarget("postgresql://postgres@127.0.0.1:5432/mindcare", { allowCabinetReadonly: true })).toEqual({
      database: "mindcare",
      host: "127.0.0.1",
      port: "5432",
      cabinet: true,
    });
  });
});
