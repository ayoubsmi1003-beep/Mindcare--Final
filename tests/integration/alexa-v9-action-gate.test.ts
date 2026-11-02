import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const actionUrl = process.env["MINDCARE_ALEXA_ACTION_DB_URL"];
const actionDescribe = actionUrl ? describe : describe.skip;

actionDescribe("Alexa V9 synthetic action gate", () => {
  it("proposes, confirms, executes, audits and rolls back real actions", () => {
    const stdout = execFileSync(process.execPath, [resolve("scripts/verify-alexa-v9-action-gate.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, MINDCARE_ALEXA_ACTION_DB_URL: actionUrl },
    });
    const result = JSON.parse(stdout) as { status?: string; checks?: Array<{ id: string; status: string }>; failed?: string[] };
    expect(result.status).toBe("PASS");
    expect(result.failed).toEqual([]);
    expect(result.checks?.length).toBeGreaterThanOrEqual(14);
    const byId = new Map((result.checks ?? []).map(check => [check.id, check.status]));
    for (const id of [
      "proposal-created", "proposal-confirmed", "proposal-executed",
      "appointment-created", "appointment-readback", "unrelated-unchanged",
      "audit-present", "reschedule-proposed", "reschedule-confirmed",
      "reschedule-executed", "reschedule-readback", "reschedule-audit",
      "rollback-restores-baseline",
    ]) {
      expect(byId.get(id), id).toBe("PASS");
    }
  }, 60_000);
});
