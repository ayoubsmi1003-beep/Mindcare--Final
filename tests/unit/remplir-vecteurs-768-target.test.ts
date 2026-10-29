import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const targetRules = await import("../../scripts/lib/alexa-v8-manifest.mjs");

it("defaults the 768 backfill to the verified V8 evaluation container and database", () => {
  expect(targetRules.resolveV8SyntheticDockerTarget?.()).toEqual({
    container: "mindcare-v8-intelligence-20261027",
    database: "alexa_eval_v8_intelligence_20261027",
  });
});

it.each([
  ["mc-p3", "alexa_eval_v8_intelligence_20261027"],
  ["mindcare-v8-intelligence-20261027", "mindcare"],
])("rejects the non-synthetic Docker target %s / %s", (container, database) => {
  expect(() => targetRules.resolveV8SyntheticDockerTarget?.(container, database))
    .toThrow(/synthetic evaluation target only/i);
});

it("requires migration 194 even when the container and database names match", () => {
  expect(() => targetRules.requireV8Migration194?.(false)).toThrow(/migration 194/i);
  expect(() => targetRules.requireV8Migration194?.(true)).not.toThrow();
});

it("refuses a non-synthetic vector target before running psql", () => {
  const result = spawnSync(process.execPath, [
    resolve("scripts/remplir-vecteurs-768-docker.mjs"),
    "--conteneur", `codex-v8-guard-test-${process.pid}`,
    "--base", "mindcare",
  ], { encoding: "utf8", timeout: 10_000, windowsHide: true });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(output).toContain("V8 synthetic evaluation target only");
});
