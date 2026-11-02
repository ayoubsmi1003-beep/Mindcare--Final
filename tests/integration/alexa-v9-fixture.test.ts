import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixtureUrl = process.env["MINDCARE_ALEXA_V9_FIXTURE_ADMIN_URL"];
const fixtureDescribe = fixtureUrl ? describe : describe.skip;

fixtureDescribe("Alexa V9 fixture acceptance", () => {
  it("passes the diagnosis, scale, payment, medication, document and RLS gates", () => {
    const directory = mkdtempSync(join(tmpdir(), "alexa-v9-fixture-"));
    const receiptPath = join(directory, "acceptance.json");
    try {
      const stdout = execFileSync(process.execPath, [resolve("scripts/verify-alexa-v9-fixture.mjs")], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          MINDCARE_ALEXA_V9_FIXTURE_ADMIN_URL: fixtureUrl,
          ALEXA_V9_FIXTURE_ACCEPTANCE: receiptPath,
        },
      });
      const result = JSON.parse(stdout) as { status?: string; failed?: string[] };
      expect(result.status).toBe("PASS");
      expect(result.failed).toEqual([]);

      const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as {
        status: string;
        checks: Array<{ id: string; status: string }>;
      };
      expect(receipt.status).toBe("PASS");
      expect(receipt.checks.length).toBeGreaterThanOrEqual(34);
      expect(receipt.checks.every(check => check.status === "PASS")).toBe(true);

      const byId = new Map(receipt.checks.map(check => [check.id, check.status]));
      for (const id of [
        "diagnoses",
        "payments",
        "scales",
        "medications",
        "medication-curated",
        "documents",
        "document-draft",
        "owner-context",
        "owner-diagnoses",
        "owner-treatments",
        "owner-scales",
        "scale-history",
        "finance-pending",
        "finance-collected",
        "consultation-count",
        "assistant-no-consultation",
        "assistant-context-denied",
        "practitioner-no-patients",
      ]) {
        expect(byId.get(id), id).toBe("PASS");
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
