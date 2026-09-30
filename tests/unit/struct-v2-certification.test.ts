import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd());
const BASE = join(ROOT, "knowledge", "canonical-v2", "dsm5-fr-2015-elsevier", "sha256-be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53");
const RECIPE = join(ROOT, "knowledge", "recette-embedding-struct-v2.json");
const QUARANTINE = join(ROOT, "STRUCT-V2-QUARANTINE-DISPOSITIONS.json");
const PAGES = join(ROOT, "STRUCT-V2-PAGE-PROVENANCE.json");
const VERSIONS = join(ROOT, "STRUCT-V2-SOURCE-VERSION-REPAIR.json");
const SHORTS = join(ROOT, "STRUCT-V2-SHORT-FRAGMENT-DISPOSITIONS.json");
const DUPLICATES = join(ROOT, "STRUCT-V2-DUPLICATE-CASES.json");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("struct-v2 pre-embedding certification", () => {
  it("defines document and chunk contract fields without inventing missing values", () => {
    expect(existsSync(RECIPE)).toBe(true);
    const recipe = readJson(RECIPE);
    const document = recipe["document_contract"] as Record<string, unknown>;
    const chunk = recipe["chunk_contract"] as Record<string, unknown>;
    expect(document).toMatchObject({
      knowledge_entry_id: "dsm5-fr-2015-elsevier",
      source_id: "dsm5-fr-2015-elsevier",
      canonical_title: "DSM-5 — Manuel diagnostique et statistique des troubles mentaux",
      edition: "5e édition, traduction française (DSM-5, Fifth Edition 1-1276)",
      language: "fr",
      publisher: "Elsevier Masson",
      publication_year: 2015,
      source_version: "sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53",
      provenance_status: "registered",
      review_status: "certified_pending_embedding_handoff"
    });
    expect(document["approval_status"]).toEqual({
      canonical_layer: "approved",
      structural_policies: "approved",
      chunk_layer: "approved_for_structural_certification",
      activation: "not_approved"
    });
    expect(Object.keys(chunk)).toEqual(expect.arrayContaining([
      "chunk_id", "chunk_hash", "parent_knowledge_entry_id", "source_version", "language",
      "section_chapter_hierarchy", "section_path", "pdf_page", "printed_page",
      "page_confidence_status", "chunk_ordinal", "chunking_strategy_version",
      "text_integrity_status", "duplicate_status", "quarantine_status"
    ]));
  });

  it("classifies all 88 quarantined vectors as explicitly quarantined", () => {
    expect(existsSync(QUARANTINE)).toBe(true);
    const report = readJson(QUARANTINE);
    expect(report["before_count"]).toBe(88);
    expect(report["after_count"]).toBe(88);
    expect(report["items"]).toHaveLength(88);
    for (const item of report["items"] as Record<string, unknown>[]) {
      expect(item["status"]).toBe("QUARANTINED");
      expect(item["reason"]).toContain("diagnostic struct-v2 vector");
      expect(item["evidence"]).toBeInstanceOf(Array);
      expect(item["affected_chunk_ids"]).toHaveLength(1);
      expect(item["source_version"]).toBe("sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53");
      expect(item["page_evidence"]).toHaveProperty("pdf_page");
      expect(item["page_evidence"]).toHaveProperty("printed_page");
      expect(item["human_approval_required"]).toBe(false);
    }
  });

  it("preserves page distinction and unresolved printed pages", () => {
    expect(existsSync(PAGES)).toBe(true);
    const report = readJson(PAGES);
    expect(report["chunk_count"]).toBe(14079);
    expect(report["unresolved_printed_page_count"]).toBe(8);
    expect(report["roman_printed_page_count"]).toBe(43);
    expect(report["pdf_and_printed_are_distinct_fields"]).toBe(true);
    expect(report["items"]).toHaveLength(14079);
  });

  it("creates a deterministic source-version repair report without applying repairs", () => {
    expect(existsSync(VERSIONS)).toBe(true);
    const report = readJson(VERSIONS);
    expect(report["unit_count"]).toBe(12818);
    expect(report["issue_count"]).toBe(1457);
    expect(report["derived_overlay_applied"]).toBe(true);
    expect(report["canonical_repair_applied"]).toBe(false);
    expect(report["new_values_are_inferred"]).toBe(false);
    expect(report["items"]).toHaveLength(12818);
  });

  it("defines deterministic duplicate and short-fragment policies", () => {
    expect(existsSync(DUPLICATES)).toBe(true);
    const duplicates = readJson(DUPLICATES);
    const duplicateCases = duplicates["cases"] as Record<string, unknown>[];
    expect(duplicateCases).toHaveLength(3);
    expect(duplicateCases.map((item) => item["case"])).toEqual([
      "exact_duplicate_same_normalized_content_and_provenance",
      "content_duplicate_distinct_provenance",
      "legitimate_repeated_statement_distinct_source_or_section"
    ]);
    expect(duplicateCases[1]?.["automatic_merge"]).toBe(false);
    expect(duplicateCases[2]?.["automatic_merge"]).toBe(false);

    expect(existsSync(SHORTS)).toBe(true);
    const shorts = readJson(SHORTS);
    expect(shorts["items"]).toHaveLength(17);
    for (const item of shorts["items"] as Record<string, unknown>[]) {
      expect(["VALID_BY_ITSELF", "ATTACHED_TO_PARENT", "MERGED_WITH_CONTINUATION", "QUARANTINED"]).toContain(item["decision"]);
      expect(item["human_approval_required"]).toBe(false);
    }
  });

  it("records medical-content integrity and does not mark chunk approval complete", () => {
    const qa = readJson(join(BASE, "qa-report.json"));
    expect(qa["ocr_used"]).toBe(false);
    const recipe = readJson(RECIPE);
    expect(recipe["activation_allowed"]).toBe(false);
    expect(recipe["status"]).toBe("approved_for_structural_certification");
    expect(recipe["embedding_execution_allowed"]).toBe(false);
  });
});
