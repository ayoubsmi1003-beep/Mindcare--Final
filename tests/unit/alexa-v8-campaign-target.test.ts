import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const targetRules = await import("../../scripts/lib/alexa-v8-manifest.mjs");
const applicationUrl = "postgresql://postgres@127.0.0.1:55445/alexa_eval_v8_intelligence_20261027";
const adminUrl = "postgresql://admin@127.0.0.1:55445/alexa_eval_v8_intelligence_20261027";

it("binds the V8 campaign application and preflight URLs to the same exact disposable database", () => {
  expect(targetRules.resolveV8CampaignDatabaseUrls({
    MINDCARE_ALEXA_EVAL_DATABASE_URL: applicationUrl,
    MINDCARE_ALEXA_EVAL_ADMIN_URL: adminUrl,
    MINDCARE_DATABASE_URL: "postgresql://postgres@127.0.0.1:55441/mindcare",
  })).toEqual({ applicationUrl, adminUrl });
});

it.each([
  ["cabinet", "postgresql://postgres@127.0.0.1:55441/mindcare"],
  ["other evaluation database", "postgresql://postgres@127.0.0.1:55444/alexa_eval_clinical_20261022"],
  ["remote host", "postgresql://postgres@example.org:55445/alexa_eval_v8_intelligence_20261027"],
])("rejects %s before the live V8 campaign can connect", (_label, rejectedUrl) => {
  expect(() => targetRules.resolveV8CampaignDatabaseUrls({
    MINDCARE_ALEXA_EVAL_DATABASE_URL: rejectedUrl,
    MINDCARE_ALEXA_EVAL_ADMIN_URL: rejectedUrl,
  })).toThrow(/disposable/i);
});

it("rejects mismatched application and admin databases", () => {
  expect(() => targetRules.resolveV8CampaignDatabaseUrls({
    MINDCARE_ALEXA_EVAL_DATABASE_URL: applicationUrl,
    MINDCARE_ALEXA_EVAL_ADMIN_URL: "postgresql://admin@127.0.0.1:55445/other_disposable",
  })).toThrow(/disposable/i);
});

it("requires an explicit admin preflight URL", () => {
  expect(() => targetRules.resolveV8CampaignDatabaseUrls({
    MINDCARE_ALEXA_EVAL_DATABASE_URL: applicationUrl,
  })).toThrow(/admin.*URL/i);
});

it("gates the existing live runner on the same snapshot and migrations before model work", () => {
  const runner = readFileSync(resolve("scripts/eval-alexa-agent.mjs"), "utf8");
  const targetResolution = runner.indexOf("resolveV8CampaignDatabaseUrls(process.env)");
  const connection = runner.indexOf("await preflight.connect()");
  const check = runner.indexOf("const check =");
  const validation = runner.indexOf("validateBookRagSource(check)");
  const modelBuild = runner.indexOf("await build({");

  expect(runner).toContain("resolveV8CampaignDatabaseUrls(process.env)");
  expect(runner).toContain("validateBookRagSource(check)");
  expect(targetResolution).toBeGreaterThanOrEqual(0);
  expect(targetResolution).toBeLessThan(connection);
  expect(validation).toBeGreaterThan(check);
  expect(validation).toBeLessThan(modelBuild);
  expect(runner).toContain("BOOK_RAG_REQUIRED_MIGRATIONS");
  const inventoryValidation = runner.indexOf("validateV8MigrationInventory({");
  expect(runner).toContain("SELECT version FROM app.schema_migrations");
  expect(inventoryValidation).toBeGreaterThan(validation);
  expect(inventoryValidation).toBeLessThan(modelBuild);
});

it("requires every live V8 evaluation runner to match applied migrations to the current source inventory", () => {
  const runners = [
    ["scripts/eval-alexa-agent.mjs", "await build({"],
    ["scripts/eval-book-rag.mjs", "await compilerConnaissance("],
    ["scripts/eval-alexa-v8-adversarial.mjs", "await bundleRuntime(outDir)"],
  ] as const;
  for (const [file, modelWork] of runners) {
    const runner = readFileSync(resolve(file), "utf8");
    const inventoryValidation = runner.indexOf("validateV8MigrationInventory({");
    const modelWorkIndex = runner.indexOf(modelWork);
    expect(runner, file).toContain("SELECT version FROM app.schema_migrations");
    expect(inventoryValidation, file).toBeGreaterThanOrEqual(0);
    expect(modelWorkIndex, file).toBeGreaterThan(inventoryValidation);
  }
});

it("restores per-oracle results into the privacy-safe adversarial report on resume", () => {
  const runner = readFileSync(resolve("scripts/eval-alexa-v8-adversarial.mjs"), "utf8");

  expect(runner).toContain("restoreV8AdversarialOracleResults");
  expect(runner).toContain("previousReport");
  expect(runner).toContain("oracleStatuses");
});

it("retains validated migration evidence for the adversarial preflight return", () => {
  const runner = readFileSync(resolve("scripts/eval-alexa-v8-adversarial.mjs"), "utf8");
  const start = runner.indexOf("async function preflightDatabase(inputs)");
  const end = runner.indexOf("\nasync function bundleRuntime", start);
  const preflight = runner.slice(start, end);

  expect(preflight).toMatch(/let migrationInventory\s*;/u);
  expect(preflight).toMatch(/migrationInventory\s*=\s*validateV8MigrationInventory/u);
  expect(preflight).toMatch(/return\s*\{[\s\S]*migrationInventory/u);
});

it("resolves the bundler from Vitest's package location before building live turns", () => {
  const runner = readFileSync(resolve("scripts/eval-alexa-v8-adversarial.mjs"), "utf8");

  expect(runner).toContain('const vitestPackage = require.resolve("vitest/package.json")');
  expect(runner).toContain('const vitePackage = createRequire(vitestPackage).resolve("vite/package.json")');
  expect(runner).toContain('const { build } = createRequire(vitePackage)("esbuild")');
});

it("scopes mmarco to retrieval-contract turns and restores the prior process environment", () => {
  const runner = readFileSync(resolve("scripts/eval-alexa-v8-adversarial.mjs"), "utf8");

  expect(runner).toContain("v8AdversarialRequiresCrossEncoder(scenario)");
  expect(runner).toContain('process.env["KNOWLEDGE_RERANK"] = "mmarco"');
  expect(runner).toContain('delete process.env["KNOWLEDGE_RERANK"]');
  expect(runner).toContain("finally");
  expect(runner).toContain('process.env["KNOWLEDGE_RERANK"] = previousReranker');
});
