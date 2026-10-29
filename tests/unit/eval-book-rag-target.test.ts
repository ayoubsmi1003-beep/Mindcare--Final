import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const targetRules = await import("../../scripts/lib/alexa-v8-manifest.mjs");
const evaluationUrl = "postgresql://postgres@127.0.0.1:55445/alexa_eval_v8_intelligence_20261027";

it("accepts only the explicit disposable V8 book-evaluation URL", () => {
  expect(targetRules.resolveBookRagDatabaseUrl({ MINDCARE_ALEXA_EVAL_DATABASE_URL: evaluationUrl }))
    .toBe(evaluationUrl);
  expect(() => targetRules.resolveBookRagDatabaseUrl({
    MINDCARE_DATABASE_URL: "postgresql://postgres@127.0.0.1:55441/mindcare",
    MINDCARE_TEST_DATABASE_URL: "postgresql://postgres@127.0.0.1:55441/mindcare",
  })).toThrow(/explicit.*V8.*evaluation/i);
  expect(() => targetRules.resolveBookRagDatabaseUrl({
    MINDCARE_ALEXA_EVAL_DATABASE_URL: "postgresql://postgres@127.0.0.1:55441/mindcare",
  })).toThrow(/disposable/i);
});

it("requires the verified synthetic snapshot and every application migration 195 through 200", () => {
  const verified = {
    database: "alexa_eval_v8_intelligence_20261027",
    patients: 1558,
    consultations: 8143,
    nonSynthetic: 0,
    appliedMigrationsThrough200: 6,
  };
  expect(() => targetRules.validateBookRagSource(verified)).not.toThrow();
  expect(() => targetRules.validateBookRagSource({ ...verified, appliedMigrationsThrough200: 5 }))
    .toThrow(/migrations 195 through 200/i);
  expect(() => targetRules.validateBookRagSource({ ...verified, nonSynthetic: 1 }))
    .toThrow(/synthetic/i);
  expect(() => targetRules.validateBookRagSource({ ...verified, patients: 0 }))
    .toThrow(/snapshot/i);
});

it("does not permit an arbitrary database override on the book evaluator", () => {
  expect(() => targetRules.assertBookRagArguments(["--url", "postgresql://example/mindcare"]))
    .toThrow(/--url.*not supported/i);
  expect(() => targetRules.assertBookRagArguments(["--golden", "tests/eval/knowledge.books-v4-2026-10-28.json"]))
    .not.toThrow();
});

it("wires the read-only evaluator to the V8 gates and records safe direct-path traces", () => {
  const evaluator = readFileSync(resolve("scripts/eval-book-rag.mjs"), "utf8");
  expect(evaluator).toContain("assertBookRagArguments(args)");
  expect(evaluator).toContain("resolveBookRagDatabaseUrl(process.env)");
  expect(evaluator).toContain("validateBookRagSource(source)");
  expect(evaluator).toContain("BOOK_RAG_REQUIRED_MIGRATIONS");
  expect(evaluator.indexOf("resolveBookRagDatabaseUrl(process.env)")).toBeLessThan(evaluator.indexOf("new pg.Pool"));
  expect(evaluator).toContain("BEGIN READ ONLY");
  expect(evaluator).toContain("SET LOCAL ROLE authenticated");
  expect(evaluator).toContain("knowledge.books-v4-2026-10-28.json");
  expect(evaluator).toContain('{ traceOrigin: "direct" }');
  expect(evaluator).toContain("execution: tracesDuCas");
  expect(evaluator).toContain('join(RACINE, ".eval-out", "alexa-v8-upgrade")');
  expect(evaluator).toContain("writeFileSync(artifactPath");
  expect(evaluator).not.toMatch(/chargerEnv|MINDCARE_(?:ADMIN|TEST|DATABASE)_DATABASE_URL/u);
});
