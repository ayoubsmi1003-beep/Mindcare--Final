import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd());
const AUDIT = join(ROOT, "STRUCT-V2-AUDIT.json");
const CONTRACT = join(ROOT, "STRUCT-V2-CONTRACT-PROPOSAL.md");
const PROPOSAL = join(ROOT, "EMBEDDING-V2-RECIPE-PROPOSAL.md");
const RECIPE = join(ROOT, "knowledge", "recette-embedding-struct-v2.json");
const QUARANTINE = join(ROOT, "STRUCT-V2-QUARANTINE-88.json");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("struct-v2 pre-embedding safety contract", () => {
  it("publishes a blocked machine audit for the frozen artifact", () => {
    expect(existsSync(AUDIT)).toBe(true);
    const audit = readJson(AUDIT);
    expect(audit["status"]).toBe("BLOCKED");
    expect(audit["chunk_count"]).toBe(14079);
    expect(audit["embedding_blockers"]).toContain("struct-v2-is-not-authorized-by-pinned-struct-v1-recipe");
    const gates = audit["safety_gates"] as Record<string, string>;
    expect(gates["required_fields"]).toBe("PASS");
    expect(gates["identity_and_source_hash"]).toBe("PASS");
    expect(gates["text_hash_and_chunk_id_determinism"]).toBe("PASS");
    expect(gates["indexable_text_determinism"]).toBe("PASS");
    expect(gates["page_mapping"]).toBe("BLOCKED");
    expect(gates["source_version_metadata"]).toBe("BLOCKED");
    expect(gates["duplicate_text_policy"]).toBe("BLOCKED");
    expect(gates["embedding_compatibility"]).toBe("BLOCKED");
    expect(gates["activation"]).toBe("BLOCKED");
  });

  it("records the requested anomaly counts without silently repairing them", () => {
    const audit = readJson(AUDIT);
    expect(audit["anomaly_counts"]).toMatchObject({
      missing_printed_page_chunks: 8,
      roman_printed_page_chunks: 43,
      printed_page_order_inversions: 99,
      source_page_order_inversions: 238,
      source_version_metadata_defects: 1457,
      duplicate_text_hash_groups: 2311,
      duplicate_rows_beyond_first: 2841,
      short_chunks_le_5: 17,
      multi_page_chunks_recomputed: 705,
      a_mark_chunks: 8,
      a_mark_occurrences: 8,
      coverage_only_units: 411,
      partial_embedding_rows: 88
    });
    expect(audit["canonical_artifact_modified"]).toBe(false);
  });

  it("proposes a new recipe without changing the pinned struct-v1 recipe", () => {
    expect(existsSync(PROPOSAL)).toBe(true);
    expect(existsSync(RECIPE)).toBe(true);
    const text = readFileSync(PROPOSAL, "utf8");
    expect(text).toContain("r3-struct-v2-2026-09-24");
    expect(text).toContain("chunker_version: struct-v2");
    expect(text).toContain("embedding_text_field: texte_indexable");
    expect(text).toContain("status: approved_for_structural_certification");
    const recipe = readJson(RECIPE);
    expect(recipe["recipe_id"]).toBe("r3-struct-v2-2026-09-24");
    expect(recipe["status"]).toBe("approved_for_structural_certification");
    expect(recipe["chunker_version"]).toBe("struct-v2");
    expect(recipe["embedding_text_field"]).toBe("texte_indexable");
    expect(recipe["activation_allowed"]).toBe(false);
    const pinned = readJson(join(ROOT, "knowledge", "recette-embedding-pinee.json"));
    expect(pinned["chunking_version"]).toBe("struct-v1");
  });

  it("specifies the contract rejection gates and the no-activation boundary", () => {
    expect(existsSync(CONTRACT)).toBe(true);
    const text = readFileSync(CONTRACT, "utf8");
    for (const gate of ["required fields", "identity", "text hash", "page mapping", "duplicate text", "short fragments", "embedding", "activation"]) {
      expect(text.toLowerCase()).toContain(gate);
    }
    expect(text.toLowerCase()).toContain("postgresql");
    expect(text.toLowerCase()).toContain("no activation");
  });

  it("marks all 88 existing vectors as non-production diagnostic output", () => {
    expect(existsSync(QUARANTINE)).toBe(true);
    const quarantine = readJson(QUARANTINE);
    expect(quarantine["count"]).toBe(88);
    expect(quarantine["production_compatible"]).toBe(false);
    expect(quarantine["reason"]).toContain("struct-v1 recipe");
    expect(quarantine["chunk_ids"]).toHaveLength(88);
    expect(quarantine["chunk_ids"]).toEqual([...new Set(quarantine["chunk_ids"] as string[])]);
  });
});
