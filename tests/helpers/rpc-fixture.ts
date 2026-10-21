import { ok, type Result } from "@/services/result";
/** Synthetic rows cross the generic RPC boundary; services still validate schemas. */
export function fixtureRows<T>(rows: readonly unknown[]): Result<readonly T[]> {
  return ok(rows as readonly T[]);
}
