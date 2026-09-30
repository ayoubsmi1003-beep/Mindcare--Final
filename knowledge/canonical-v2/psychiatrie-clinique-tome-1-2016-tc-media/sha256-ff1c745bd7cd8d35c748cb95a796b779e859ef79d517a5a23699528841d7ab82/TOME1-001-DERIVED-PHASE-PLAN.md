# TOME1-001 Derived Fidelity and Structural Audit Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the immutable 1,220-page Tome 1 raw package into a deterministic, source-faithful derived audit package with repair inventory, numeric fidelity records, structural/locator/table/duplicate audits, machine assertions, and a human review package—without changing raw data or activating downstream knowledge.

**Architecture:** Add a book-local Python audit tool under the existing Tome 1 target. It reads the immutable raw JSON pages, page records, checkpoints, source lock, and manifest; it never mutates `raw/` and it treats the current native PDF text as the source representation. The first output stage is conservative inventory/evidence classification; no medical repair or trusted clinical assertion is emitted automatically.

**Tech Stack:** Python 3.14 standard library (`json`, `hashlib`, `re`, `unicodedata`, `pathlib`, `dataclasses`, `unittest`), local PyMuPDF for optional source-page probes, qpdf, pnpm test suite. No external service, OCR, embeddings, database, or retrieval.

**Spec:** User mission in the current session; governing authority is `AGENTS.md`, `CLAUDE.md`, `docs/domains/alexa-constitution.md`, ADR-037/038/039/040, current Tome 1 raw plan, and `STRUCT-V2-*` policies as historical precedent only.

## Global Constraints

- Scope is strictly Tome 1; do not read or modify other book source content.
- The 1,220 raw pages and their source hash are immutable.
- Never rewrite raw text, raw blocks, source-lock, or the source PDF.
- Preserve ambiguity; classify unresolved items instead of guessing.
- Native text is not OCR; `ocr_used` remains false and no OCR-derived repair may be claimed.
- No medical fact, dose, threshold, diagnostic criterion, contraindication, code, or numeric value becomes trusted knowledge automatically.
- Every derived record carries source page, raw file, block IDs, raw hash, and status.
- `printed_page_number` is null unless explicit source evidence exists; no global offset.
- No clinical activation, retrieval eligibility, chunking, embeddings, PostgreSQL, pgvector, or status activation.
- Historical `STRUCT-V2-*` artifacts are precedent/policy only, never current Tome 1 evidence.
- The stale Tome 1 plan header is a documentation discrepancy; record it and do not auto-correct it.
- No commit unless explicitly requested.

---

## 1. Output contract

All outputs stay inside the existing Tome 1 target:

```text
knowledge/canonical-v2/psychiatrie-clinique-tome-1-2016-tc-media/sha256-ff1c745bd7cd8d35c748cb95a796b779e859ef79d517a5a23699528841d7ab82/
```

New derived files:

```text
reconciliation-report.json
repair-inventory.jsonl
critical-numeric-audit.jsonl
pages.map.json
structure.json
units.jsonl
tables-audit.jsonl
duplicates-audit.jsonl
machine-assertions.json
qa-report.json
review-dossier.json
review-dossier.md
golden-candidates.jsonl
attestation-checklist.md
```

New book-local tools:

```text
tools/derived_audit.py
tools/test_derived_audit.py
```

No `reading/` or `repairs.jsonl` is created unless a source-confirmed repair is actually found. Because the source is native text and no OCR layer exists, the expected default is zero repairs; zero repairs is a valid result and must not be padded with guesses.

## 2. Common record contracts

### 2.1 Repair inventory item

```json
{
  "issue_id": "tome1-ri-<hash>",
  "book_id": "psychiatrie-clinique-tome-1-2016-tc-media",
  "source_version": "sha256:ff1c745bd7cd8d35c748cb95a796b779e859ef79d517a5a23699528841d7ab82",
  "category": "A|B|C|D|E",
  "severity": "critical|high|medium|low|none",
  "status": "DETECTED|EVIDENCE-CHECKED|EVIDENCE-CONFLICT|REJECTED|UNRESOLVED|NON-ISSUE",
  "source_page_index": 0,
  "source_page_display": 1,
  "raw_file": "raw/page-0000.json",
  "source_block_ids": ["page-0000-block-0001"],
  "raw_text_excerpt": "...",
  "raw_text_sha256": "...",
  "evidence_locator": {"kind": "raw_text|native_pdf_text|page_geometry", "span": {}},
  "evidence": [],
  "repair_allowed": false,
  "repair_id": null,
  "disposition": "PRESERVE|REVIEW|REJECT",
  "confidence": "high|medium|low|none"
}
```

### 2.2 Critical numeric candidate

```json
{
  "numeric_id": "tome1-num-<hash>",
  "raw_value": "...",
  "category": "dose|range|percentage|threshold|duration|frequency|age|score|scale|prevalence|incidence|laboratory|code|criterion|table_value|other",
  "source_page_index": 0,
  "source_page_display": 1,
  "raw_file": "raw/page-0000.json",
  "source_block_ids": [],
  "raw_context": "...",
  "verification_method": "native_source_text_comparison",
  "verification_status": "EVIDENCE-CHECKED|EVIDENCE-CONFLICT|UNRESOLVED",
  "clinical_review_status": "PENDING",
  "trusted_knowledge_eligible": false,
  "quarantine": true,
  "evidence": []
}
```

No numeric candidate is trusted even when `EVIDENCE-CHECKED`; it remains `PENDING` until human review.

### 2.3 Structural node

```json
{
  "node_id": "tome1-struct-<hash>",
  "node_type": "book|part|chapter|section|subsection|heading_candidate|table_candidate",
  "title": "...",
  "status": "DETECTED|EVIDENCE-CHECKED|REJECTED|UNRESOLVED",
  "structural_path": [],
  "parent_id": null,
  "source_page_index": 0,
  "source_page_display": 1,
  "source_block_ids": [],
  "evidence": [],
  "raw_text_hash": "...",
  "attestation_status": "PENDING"
}
```

`ATTESTED` is forbidden in this phase.

## 3. Reconciliation gate

Before any derived inventory, write `reconciliation-report.json` from the existing package and assert:

- source hash equals `ff1c745bd7cd8d35c748cb95a796b779e859ef79d517a5a23699528841d7ab82`;
- source byte size equals `30603439`;
- source page count equals `1220`;
- exactly 1,220 raw files `raw/page-0000.json` through `raw/page-1219.json` exist;
- exactly 1,220 page records exist;
- exactly 1,220 extraction checkpoints exist;
- every raw file hash matches the manifest output hash;
- every page record and checkpoint agrees with its raw page;
- every page index is contiguous and unique;
- all raw records remain `extracted` with `processing_state: pending`;
- no `reading/`, repair, structure, assertions, QA, chunks, embeddings, retrieval, or database outputs exist before this phase;
- all book-local tests remain green.

The report must include:

```json
{
  "status": "PASS|BLOCKED",
  "raw_count": 1220,
  "record_count": 1220,
  "checkpoint_count": 1220,
  "source_package_reconciled": true,
  "raw_hashes_unchanged": true,
  "document_discrepancies": [
    {
      "document": "KNOWLEDGE_INGESTION_PLAN.md",
      "status": "STALE_HEADER",
      "document_claim": "execution not started",
      "verified_reality": "TOME1-001 raw extraction completed"
    }
  ],
  "repair_started": false
}
```

## 4. Full-book repair inventory

The audit scans all 1,220 raw pages in source-page order and emits one deterministic JSONL item per detected issue candidate. It does not stop at the first issue.

### Category A — Critical fidelity

Detect conservatively from native raw text and block evidence:

- dose/range/unit expressions;
- percentages and thresholds;
- duration/frequency/age/score/scale values;
- ICD/code-like identifiers;
- diagnostic criterion numbers;
- table-like numeric values;
- negation and comparator-sensitive values;
- decimal/comma ambiguous expressions.

Every A candidate must be written to both `repair-inventory.jsonl` and `critical-numeric-audit.jsonl`. If a candidate cannot be source-checked, status is `UNRESOLVED`, `quarantine: true`, and `trusted_knowledge_eligible: false`.

### Category B — Structural

Detect candidate headings and boundaries from:

- explicit `PARTIE`, `CHAPITRE`, numbered headings;
- TOC lines with page locators;
- page openings and body headings;
- short block patterns with evidence;
- table/list/continuation patterns.

A heading is promoted only when both TOC/body evidence or explicit page evidence exists. Otherwise it remains `DETECTED` or `UNRESOLVED`. Rejected candidates are recorded; nothing is silently discarded.

### Category C — Locator/provenance

Record:

- raw page without a verified printed page;
- candidate heading without a source block;
- repeated content with conflicting page locators;
- page-boundary anomalies;
- missing source block references;
- external/Tome 2 references preserved as `unresolved_external`.

### Category D — OCR/character quality

Because `ocr_used: false`, this category means native extraction quality candidates, not OCR output. Detect only:

- Unicode replacement characters;
- private-use characters;
- malformed control characters;
- suspicious ligature artifacts;
- broken hyphenation;
- suspicious repeated characters;
- spacing anomalies.

Do not repair any D item without source evidence. If evidence is not conclusive, status is `UNRESOLVED`.

### Category E — Non-issue

Record stylistic differences that do not affect source fidelity, with `repair_allowed: false` and `disposition: NON-ISSUE`. Never “repair” a non-issue.

## 5. Numeric audit

Use deterministic, conservative patterns only. The scanner must not parse a number into a medical fact. It records the raw string and context.

Required candidate categories are listed in the user mission. Every candidate must include exact raw text, page, block IDs, raw hash, and verification state.

Verification rules:

- `EVIDENCE-CHECKED`: the exact native text is present at the declared source locator and no contradictory source text is found; human review is still pending.
- `EVIDENCE-CONFLICT`: the source text and the derived candidate disagree; preserve both and quarantine.
- `UNRESOLVED`: no conclusive evidence; preserve and quarantine.
- A verified numeric candidate is never `trusted_knowledge_eligible: true` in this phase.

The report must include counts by category and a separate count of candidates that remain quarantined.

## 6. Page locator and structure

### Page map

`pages.map.json` contains one record per source page and piecewise segments. It must:

- use zero-based `source_page_index` and one-based `source_page_display`;
- preserve `printed_page_number: null` unless observed;
- preserve Roman/unknown values without conversion;
- store evidence locator and confidence;
- never use a global offset;
- never mark a page as verified solely because the TOC appears plausible.

### Structure

`structure.json` contains candidate hierarchy. It must preserve:

- table of contents evidence;
- chapter openings;
- heading candidates;
- parent/child relationships only when supported;
- rejected/unresolved nodes;
- `attestation_status: PENDING`.

No `ATTESTED` status is allowed.

## 7. Tables and duplicates

### Tables

`tables-audit.jsonl` records table-like page candidates and preserves:

- source page/block IDs;
- caption evidence;
- headers/rows/cells only when observed in raw structure;
- continuation candidates;
- numeric cells;
- status `EVIDENCE-CHECKED`, `UNRESOLVED`, or `REJECTED`.

If reliable cell association cannot be established, the table is quarantined and not trusted.

### Duplicate/header/footer control

`duplicates-audit.jsonl` groups repeated raw lines/blocks by deterministic hash. Each group gets one class:

```text
genuine-repeat
header-footer-repeat
table-header-repeat
index-repeat
short-fragment-artifact
ambiguous
defect
```

Every group preserves all source page locators. No duplicate is deleted, merged, or selected as a canonical representative.

## 8. Derived unit and assertion rules

`units.jsonl` contains only stable, source-referenced structural/content units, not flattened raw text. It may include heading units, section anchors, and table candidates. Every unit has:

```text
unit_id
source_page_index
source_page_display
raw_file
source_block_ids
raw_text_hash
raw_text
structural_path
content_type
status
validation_status
provenance
```

`assertions.jsonl` may contain only audit assertions such as numeric candidates and evidence statuses. It must not claim a medical fact, dose, diagnosis, or treatment recommendation. Every assertion remains non-trusted and human-review-pending.

## 9. Machine assertions and negative tests

Create `machine-assertions.json` with machine-readable checks:

- `raw_count_unchanged == true`;
- `raw_hashes_unchanged == true`;
- `all_page_indices_contiguous == true`;
- `all_records_have_raw_refs == true`;
- `all_candidates_have_source_page == true`;
- `all_candidates_have_evidence_status == true`;
- `unresolved_candidates_quarantined == true`;
- `verified_candidates_not_clinically_trusted == true`;
- `unresolved_headings_not_authoritative == true`;
- `unresolved_tables_not_trusted == true`;
- `duplicates_preserved == true`;
- `no_forbidden_outputs == true`;
- `deterministic_output_hashes == true`.

Negative tests must prove:

- a corrupt numeric candidate cannot become trusted;
- missing provenance cannot become trusted;
- unresolved heading cannot become authoritative;
- unresolved table cannot become trusted structured data;
- raw page mutation is detected;
- duplicate content is not silently deduplicated;
- ambiguous OCR is reported, not guessed;
- a forged manifest hash blocks the derived audit.

## 10. Review package

### Review dossier

Create both JSON and Markdown with:

- reconciliation status;
- inventory counts A–E;
- numeric candidate counts and quarantine counts;
- heading/structure results;
- locator/provenance anomalies;
- table anomalies;
- duplicate/header/footer counts;
- test and determinism results;
- raw hashes and source version;
- blocked items;
- doctor attestation status.

### Golden candidates

`golden-candidates.jsonl` contains high-value questions or claim candidates derived only from evidence-backed source units. Every row has `status: PROPOSED`, source references, and `approved: false`. No retrieval evaluation or embedding uses them in this phase.

### Attestation

`attestation-checklist.md` lists doctor review questions. It must state `PENDING` and must not claim approval.

## 11. Implementation phases

### Phase 1 — Reconciliation and scanner skeleton

- Add `tools/derived_audit.py` with pure functions and explicit schemas.
- Add `tools/test_derived_audit.py` with failing tests first.
- Implement reconciliation report and inventory schema.
- Run the reconciliation gate before scanning.

### Phase 2 — Full repair and numeric inventory

- Scan all raw pages.
- Emit A–E repair inventory.
- Emit critical numeric audit.
- Verify every candidate has source locators and quarantine state.
- No repairs applied unless a deterministic, source-confirmed rule exists.

### Phase 3 — Structure, locator, table, and duplicate audit

- Parse TOC/headings conservatively.
- Build piecewise page map.
- Record rejected/unresolved nodes.
- Audit tables and duplicate/header/footer groups.
- Never flatten, merge, or activate content.

### Phase 4 — Assertions, determinism, and negative tests

- Add machine assertions.
- Add negative tests.
- Run the audit twice in isolated output directories and compare byte-for-byte hashes.
- Confirm raw fingerprint is unchanged.
- Run all book-local tests and canonical repository checks.

### Phase 5 — Review package and freeze boundary

- Write dossier, PROPOSED golden candidates, and PENDING attestation checklist.
- Confirm no forbidden downstream outputs.
- Do not run repair semantics beyond evidence-confirmed allowlisted derived corrections.
- Stop before activation.

## 12. Acceptance criteria

The derived phase is complete only when:

- [ ] Reconciliation report exists and records the stale plan-header discrepancy.
- [ ] 1,220 raw pages and hashes are unchanged.
- [ ] Repair inventory covers every page and counts A–E.
- [ ] Critical numeric audit is complete for all detected numeric candidates.
- [ ] Every unresolved/conflicting numeric candidate is quarantined and non-trusted.
- [ ] Page map is evidence-first and piecewise.
- [ ] Heading/structure audit is complete with DETECTED/EVIDENCE-CHECKED/REJECTED/UNRESOLVED statuses.
- [ ] Table audit preserves uncertain tables without flattening.
- [ ] Duplicate/header/footer report preserves all occurrences.
- [ ] Every derived record has source provenance.
- [ ] Machine assertions pass.
- [ ] Negative tests pass.
- [ ] Determinism replay passes byte-for-byte.
- [ ] Book-local tests pass.
- [ ] Canonical repository tests pass or unrelated failures are explicitly isolated.
- [ ] Review dossier exists.
- [ ] Golden candidates are `PROPOSED`, never approved.
- [ ] Doctor attestation remains `PENDING`.
- [ ] No raw modification, activation, chunking, embeddings, retrieval, or database work occurred.
