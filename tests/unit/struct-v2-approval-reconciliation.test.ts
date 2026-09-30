import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd());
const RECORD = join(ROOT, "STRUCT-V2-APPROVAL-RECORD.json");
const REPORT = join(ROOT, "STRUCT-V2-CERTIFICATION-REPORT.json");
const HANDOFF = join(ROOT, "STRUCT-V2-EMBEDDING-HANDOFF.json");
const METADATA = join(ROOT, "STRUCT-V2-CHUNK-METADATA.jsonl");
const VERSIONS = join(ROOT, "STRUCT-V2-SOURCE-VERSION-REPAIRED.jsonl");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("struct-v2 approval reconciliation", () => {
  it("records existing doctor/operator approval without inventing a signature", () => {
    expect(existsSync(RECORD)).toBe(true);
    const record = readJson(RECORD);
    expect(record["approval_state"]).toBe("RECONCILED_FROM_EXISTING_EVIDENCE");
    expect(record["canonical_content_approved"]).toBe(true);
    expect(record["structural_policies_approved"]).toBe(true);
    expect(record["embedding_or_activation_approved"]).toBe(false);
    expect(record["approver_roles"]).toEqual(["doctor", "operator"]);
    expect(record["approval_evidence"]).toEqual(expect.arrayContaining([
      "book.json:human_validation",
      "current_task_context:doctor_and_operator_approval"
    ]));
    expect(record["signature_status"]).toBe("not_present_in_repository");
    expect(record["fabricated_identity_or_timestamp"]).toBe(false);
  });

  it("keeps the struct-v2 recipe approved for certification but not activated", () => {
    const recipe = readJson(join(ROOT, "knowledge", "recette-embedding-struct-v2.json"));
    expect(recipe["status"]).toBe("approved_for_structural_certification");
    expect(recipe["activation_allowed"]).toBe(false);
    expect(recipe["embedding_execution_allowed"]).toBe(false);
    expect(recipe["approval_record"]).toBe("STRUCT-V2-APPROVAL-RECORD.json");
  });

  it("repairs only derived source-version metadata and leaves canonical units unchanged", () => {
    expect(existsSync(VERSIONS)).toBe(true);
    const report = readJson(REPORT);
    expect(report["source_version_metadata_repair"]).toEqual({
      canonical_units_modified: false,
      derived_overlay_applied: true,
      repaired_issue_count: 1457
    });
    const lines = readFileSync(VERSIONS, "utf8").trim().split(/\r?\n/);
    expect(lines).toHaveLength(12818);
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(first["source_version"]).toBe("sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53");
    expect(first["source_version_original"]).toBeDefined();
  });

  it("produces complete deterministic struct-v2 derived metadata", () => {
    expect(existsSync(METADATA)).toBe(true);
    const lines = readFileSync(METADATA, "utf8").trim().split(/\r?\n/);
    expect(lines).toHaveLength(14079);
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(first["parent_knowledge_entry_id"]).toBe("dsm5-fr-2015-elsevier");
    expect(first["chunk_hash"]).toBeDefined();
    expect(first["pdf_page"]).toBeDefined();
    expect(first["printed_page"]).toBeDefined();
    expect(first["page_confidence_status"]).toBeDefined();
    expect(first["quarantine_status"]).toBe("QUARANTINED");
  });

  it("provides a separate embedding handoff without activating it", () => {
    expect(existsSync(HANDOFF)).toBe(true);
    const handoff = readJson(HANDOFF);
    expect(handoff["status"]).toBe("READY_FOR_SEPARATE_EMBEDDING_TASK");
    expect(handoff["total_chunks"]).toBe(14079);
    expect(handoff["quarantined_chunks"]).toBe(88);
    expect(handoff["excluded_chunks"]).toBe(0);
    expect(handoff["embedding_execution_performed"]).toBe(false);
    expect(handoff["activation_execution_performed"]).toBe(false);
  });
});
