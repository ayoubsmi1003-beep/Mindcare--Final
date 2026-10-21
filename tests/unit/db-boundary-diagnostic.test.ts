import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseErrorCode, documentBoundaryDiagnostic } from "@/server/db/boundary-diagnostic";

afterEach(() => vi.restoreAllMocks());
describe("database boundary diagnostics", () => {
  it("classifies pg connection timeouts without printing raw messages", () => {
    expect(databaseErrorCode(new Error("timeout exceeded when trying to connect"))).toBe("CONNECTION_TIMEOUT");
    expect(databaseErrorCode(new Error("Connection terminated due to connection timeout"))).toBe("CONNECTION_TIMEOUT");
  });
  it("retains PostgreSQL and socket codes", () => {
    expect(databaseErrorCode({ code: "57014" })).toBe("57014");
    expect(databaseErrorCode({ code: "ECONNREFUSED" })).toBe("ECONNREFUSED");
    expect(databaseErrorCode({ code: "CONNECTION_TIMEOUT" })).toBe("CONNECTION_TIMEOUT");
  });
  it("finds a safe underlying connection code", () => {
    expect(databaseErrorCode(new Error("wrapped", { cause: { code: "ETIMEDOUT" } }))).toBe("ETIMEDOUT");
  });
  it("never logs arbitrary codes, messages or patient values", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    documentBoundaryDiagnostic("session", { code: "secret/value", message: "patient-secret" });
    expect(spy).toHaveBeenCalledWith("[db-boundary]", "session", "UNKNOWN");
  });
});
