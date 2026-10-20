/** Safe technical diagnostics only: never SQL messages, credentials or patient values. */
const CONNECTION_CODES = new Set(["CONNECTION_TIMEOUT", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EHOSTUNREACH"]);
export function databaseErrorCode(cause: unknown): string {
  let current = cause;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof current !== "object" || current === null) break;
    if ("code" in current && typeof current.code === "string" &&
        (/^[0-9][A-Z0-9]{4}$/.test(current.code) || CONNECTION_CODES.has(current.code))) return current.code;
    if (current instanceof Error && (
      current.message === "timeout exceeded when trying to connect" ||
      current.message === "Connection terminated due to connection timeout")) return "CONNECTION_TIMEOUT";
    current = "cause" in current ? current.cause : undefined;
  }
  return "UNKNOWN";
}
export function documentBoundaryDiagnostic(stage: "startup" | "session" | "transaction", cause: unknown): void {
  console.error("[db-boundary]", stage, databaseErrorCode(cause));
}
