# Psychiatrie clinique — Tome 1 — Canonical Knowledge Ingestion Plan

> Status: DESIGN APPROVED; WRITTEN SPECIFICATION READY FOR USER REVIEW; EXECUTION NOT STARTED.
> This document is book-local. It does not authorize shared-code changes, database writes, chunking, embeddings, retrieval, or clinical activation.

## Operating boundary

```text
TASK:       Canonical high-fidelity ingestion of one psychiatric textbook.
BOOK:       Psychiatrie clinique — Approche bio-psycho-sociale, Tome 1
SOURCE:     Books/dokumen.pub_psychiatrie-clinique-approche-bio-psycho-sociale-tome-1-.pdf
TARGET:     knowledge/canonical-v2/psychiatrie-clinique-tome-1-2016-tc-media/sha256-ff1c745bd7cd8d35c748cb95a796b779e859ef79d517a5a23699528841d7ab82/
VERSION:    canonical-v2.1-tome1
STOP:       Frozen canonical package, human-review-ready, retrieval-ineligible, clinically inactive.
```

The following are explicitly out of scope:

```text
Tome 2
root ingestion plan changes
shared ingestion code changes
PostgreSQL
chunks
embeddings
retrieval
RAG activation
clinical activation
OCR
translation
cloud upload
```

The original PDF is immutable. The canonical JSON package is the authority for this book until a future, separately approved PostgreSQL projection is designed.

## 1. Verified source identity

The source was inspected locally without OCR and without external upload.

| Field | Value |
|---|---|
| Canonical title | Psychiatrie clinique — Approche bio-psycho-sociale |
| Volume | Tome 1 |
| Edition | 4e édition |
| Publication year | 2016 |
| Language | French (`fr`) |
| Source identifier | `Books/dokumen.pub_psychiatrie-clinique-approche-bio-psycho-sociale-tome-1-.pdf` |
| Source page count | 1220 PDF pages |
| PDF version | 1.4 |
| Encryption | None |
| PDF check | `qpdf --check`: no syntax or stream encoding errors found |
| Native text layer | Present; no OCR used |
| Source version | `sha256:ff1c745bd7cd8d35c748cb95a796b779e859ef79d517a5a23699528841d7ab82` |
| Book ID | `psychiatrie-clinique-tome-1-2016-tc-media` |
| Ingestion version | `canonical-v2.1-tome1` |

The source hash is an immutable source identity. It is not a substitute for bibliographic verification. Any unverified metadata field remains `null` with a reason until verified from the source.

## 2. Architecture

```text
immutable PDF
  → source lock
  → independent raw page extraction
  → immutable raw page files
  → deterministic repair ledger
  → repaired reading layer
  → evidence-first piecewise page mapping
  → TOC and heading structure
  → typed content units
  → source assertions, concepts, and explicit relations
  → tables, figures, algorithms, medications, and cross-references
  → technical QA and source-to-output traceability
  → human review queue
  → frozen canonical package
  → STOP
```

The order is mandatory:

```text
source fidelity
→ raw extraction
→ deterministic reading representation
→ printed-page authority
→ structure
→ semantics
→ provenance
→ validation
→ canonical units
→ later chunking
→ later embeddings
→ later retrieval
```

No later stage may mutate an earlier stage.

## 3. Package layout

```text
knowledge/canonical-v2/psychiatrie-clinique-tome-1-2016-tc-media/
└── sha256-ff1c745bd7cd8d35c748cb95a796b779e859ef79d517a5a23699528841d7ab82/
    ├── source-lock.json
    ├── run-manifest.json
    ├── book.json
    ├── raw/
    │   ├── page-0000.json
    │   ├── page-0001.json
    │   └── ...
    │       └── page-1219.json
    ├── reading/
    │   ├── page-0000.json
    │   ├── page-0001.json
    │   └── ...
    │       └── page-1219.json
    ├── repairs.jsonl
    ├── page-records.jsonl
    ├── pages.map.json
    ├── structure.json
    ├── units.jsonl
    ├── assertions.jsonl
    ├── concepts.jsonl
    ├── relations.jsonl
    ├── tables.jsonl
    ├── figures.jsonl
    ├── algorithms.jsonl
    ├── medications.jsonl
    ├── xrefs.jsonl
    ├── qa-report.json
    ├── review-queue.json
    ├── checkpoints/
    │   ├── register.json
    │   ├── extract-raw.jsonl
    │   ├── repair.jsonl
    │   ├── page-map.json
    │   ├── structure.json
    │   ├── assertions.json
    │   └── qa.json
    ├── content-manifest.json
    └── governance/
        ├── lifecycle/
        │   ├── events.jsonl
        │   └── state.json
        └── review-decisions.jsonl
```

`governance/` is append-only metadata outside the frozen content hash. It may receive later human-review events without modifying the immutable canonical content.

## 4. Source identity contract

`source-lock.json` describes only the source.

```json
{
  "source_id": "psychiatrie-clinique-tome-1-2016-tc-media",
  "sha256": "ff1c745bd7cd8d35c748cb95a796b779e859ef79d517a5a23699528841d7ab82",
  "byte_size": 30603439,
  "pdf_page_count": 1220,
  "source_path": "Books/dokumen.pub_psychiatrie-clinique-approche-bio-psycho-sociale-tome-1-.pdf",
  "source_identifier": "Books/dokumen.pub_psychiatrie-clinique-approche-bio-psycho-sociale-tome-1-.pdf",
  "locked_at": "ISO-8601 timestamp",
  "lock_version": "1"
}
```

Rules:

- Write once.
- Never edit after extraction begins.
- Never place parser, repair, or mapping details here.
- A changed byte sequence creates a new source version.
- A hash mismatch stops before page extraction.

## 5. Run identity contract

`run-manifest.json` describes one processing execution.

```json
{
  "run_key": "deterministic hash of source and processing versions",
  "run_id": "unique execution identifier",
  "source_id": "psychiatrie-clinique-tome-1-2016-tc-media",
  "source_sha256": "...",
  "book_id": "psychiatrie-clinique-tome-1-2016-tc-media",
  "package_version": "v1",
  "parser_version": "...",
  "extraction_version": "canonical-v2.1-tome1",
  "repair_version": "reading-repair-v1",
  "mapping_version": "piecewise-page-map-v1",
  "schema_version": "canonical-v2.1",
  "code_revision": "book-local tool revision",
  "started_at": "ISO-8601 timestamp",
  "completed_at": null,
  "page_count": 1220,
  "processed_page_count": 0,
  "run_status": "running",
  "failure": null,
  "output_hashes": {}
}
```

`run_key` identifies the same source and processing recipe. `run_id` identifies one execution. An intentional replay has the same `run_key` and a new `run_id`.

## 6. Page state contract

Every page has two independent state axes.

### Extraction state

```text
pending
extracted
failed
missing
blocked
```

### Processing state

```text
pending
repaired
mapped
structured
terminal
not_applicable
blocked
```

Rules:

- `missing` extraction uses `processing_state: not_applicable`.
- `failed` extraction uses `processing_state: not_applicable` or `blocked`.
- A page cannot become repaired, mapped, or structured unless raw extraction succeeded.
- `terminal` means successful processing completion, not merely parser return.
- Failure details are mandatory and preserved.

Page record:

```json
{
  "page_id": "psychiatrie-clinique-tome-1-2016-tc-media:page-0000",
  "source_page_index": 0,
  "source_page_display": 1,
  "page_kind": "cover",
  "extraction_state": "extracted",
  "processing_state": "pending",
  "is_terminal": false,
  "raw_file": "raw/page-0000.json",
  "reading_file": null,
  "raw_text_sha256": "...",
  "repaired_text_sha256": null,
  "coordinates_sha256": "...",
  "block_sequence_sha256": "...",
  "repair_set_sha256": null,
  "printed_page_number": null,
  "mapping_status": "not_applicable",
  "mapping_confidence": "none",
  "mapping_segment_id": null,
  "mapping_evidence": [],
  "failure_code": null,
  "failure_detail": null,
  "checkpoint": "extract-raw:0000"
}
```

## 7. Immutable raw page contract

Each PDF page has one immutable raw file.

```text
raw/page-0000.json
raw/page-0001.json
...
raw/page-1219.json
```

Contract:

```json
{
  "page_id": "psychiatrie-clinique-tome-1-2016-tc-media:page-0000",
  "source_page_index": 0,
  "source_page_display": 1,
  "raw_text": "...",
  "raw_text_sha256": "...",
  "coordinates_sha256": "...",
  "block_sequence_sha256": "...",
  "blocks": [
    {
      "block_id": "page-0000-block-0001",
      "order": 1,
      "text": "...",
      "bbox": [0.0, 0.0, 100.0, 20.0],
      "text_sha256": "..."
    }
  ],
  "parser": {
    "name": "local-native-parser",
    "version": "..."
  },
  "extraction_status": "extracted"
}
```

Raw rules:

- Never modify a raw file.
- Never repair a raw file in place.
- Never regenerate into the same run output.
- Preserve raw text, block order, and coordinates.
- Isolate a parser failure to the affected page.
- Preserve already written pages when a later page fails.

## 8. Reading layer and repair ledger

The reading layer is always derived from the raw layer.

```text
raw/page-XXXX.json
→ deterministic repair rules
→ reading/page-XXXX.json
```

Allowed repair classes:

- verified ligature or PUA repair;
- safe Unicode compatibility normalization;
- geometry-proven line-break hyphenation repair;
- whitespace normalization at block boundaries.

Every change is recorded in `repairs.jsonl`.

```json
{
  "repair_id": "repair-000123",
  "page_id": "psychiatrie-clinique-tome-1-2016-tc-media:page-0184",
  "block_id": "page-0184-block-0007",
  "rule_id": "ligature-pua-approved",
  "raw_value": "...",
  "replacement_value": "...",
  "raw_offset_start": 120,
  "raw_offset_end": 122,
  "confidence": "high",
  "review_status": "auto_ok|needs_review|blocked"
}
```

Forbidden repairs:

```text
OCR
translation
medical reinterpretation
dose conversion
missing-text completion
uncertainty removal
author terminology replacement
broken table or algorithm guessing
```

A wrong repair rule is handled by rebuilding `reading/` from immutable `raw/`, creating a new repair version and a new run manifest.

## 9. Evidence-first page mapping

`pages.map.json` contains piecewise mapping segments.

```json
{
  "mapping_version": "piecewise-page-map-v1",
  "mapping_policy": "evidence-first-no-silent-interpolation",
  "segments": [
    {
      "mapping_segment_id": "map-segment-001",
      "source_page_index_start": 0,
      "source_page_index_end": 18,
      "source_page_display_start": 1,
      "source_page_display_end": 19,
      "printed_page_number_start": null,
      "printed_page_number_end": null,
      "mapping_type": "front_matter",
      "mapping_status": "verified",
      "mapping_confidence": "high",
      "evidence": [
        {
          "evidence_type": "visible_page_label",
          "source_page_display": 10,
          "observed_text": "viii"
        }
      ]
    }
  ],
  "unresolved_pages": []
}
```

Mapping enums:

```text
mapping_type:
- explicit
- piecewise_linear
- front_matter
- roman_numeral
- no_printed_number
- unresolved
```

```text
mapping_status:
- verified
- inferred
- uncertain
- missing
- not_applicable
```

```text
mapping_confidence:
- high
- medium
- low
- none
```

Mapping rules:

- No printed page number without evidence.
- No silent interpolation.
- Every inferred mapping records its rule and evidence.
- Every inferred mapping creates a warning.
- Critical assertions depending on uncertain mappings cannot be clinically approved.
- `printed_page_number: null` is valid and preferred to guessing.

## 10. Structure and content units

`structure.json` preserves:

```text
Book
→ Part
→ Chapter
→ Section
→ Subsection
```

TOC entries are retained as evidence but are not treated as body content by themselves. Every body heading is checked against the TOC and page evidence.

`units.jsonl` contains stable typed units.

```json
{
  "unit_id": "...",
  "unit_type": "chapter_opening|heading|definition|prose|list|clinical_case|box|table|figure|algorithm|diagnostic_criteria|differential|investigation|scale|medication_statement|reference|bibliography|index_entry|credits|back_matter",
  "title": "...",
  "structural_path": ["..."],
  "parent_unit_id": "...",
  "preceding_unit_id": "...",
  "following_unit_id": "...",
  "source_page_index_start": 120,
  "source_page_index_end": 121,
  "printed_page_start": "101",
  "printed_page_end": "102",
  "source_block_ids": [],
  "source_text_hash": "...",
  "language": "fr",
  "provenance": {},
  "extraction_status": "extracted",
  "validation_status": "auto_ok"
}
```

Units never cross a chapter boundary unless the source explicitly establishes a cross-chapter structure.

## 11. Source assertions and clinical entities

The authoritative clinical file is named `assertions.jsonl`.

An assertion is a statement found in the source, not an automatically verified medical fact.

```json
{
  "assertion_id": "...",
  "source_unit_id": "...",
  "claim_type": "definition|diagnostic_criterion|symptom_association|differential|risk_factor|treatment|medication_statement|contraindication|adverse_effect|interaction|investigation|scale|recommendation",
  "source_text": "...",
  "normalized_form": null,
  "normalization": {
    "status": "none|proposed|approved",
    "version": null,
    "rule_id": null,
    "reason": "No normalization applied."
  },
  "subject": "...",
  "predicate": "...",
  "object": "...",
  "qualifiers": {
    "modality": "...",
    "temporality": null,
    "severity": null,
    "exception": null,
    "evidence_wording": "..."
  },
  "source_location": {
    "page_id": "...",
    "source_page_index": 184,
    "source_page_display": 185,
    "printed_page_number": "101",
    "block_id": "...",
    "char_start": 120,
    "char_end": 184
  },
  "traceability": {
    "raw_file": "raw/page-0184.json",
    "raw_text_sha256": "...",
    "coordinates_sha256": "...",
    "source_block_ids": [],
    "repair_ids": []
  },
  "provenance": {
    "source_lock_id": "...",
    "run_id": "...",
    "parser_version": "...",
    "extraction_version": "...",
    "mapping_segment_id": "..."
  },
  "extraction_method": "direct|deterministic_repair|structural_parse|human_validated",
  "extraction_confidence": 0.98,
  "review_status": "not_reviewed|needs_review|approved|rejected",
  "validation_status": "auto_ok|needs_review|blocked|approved"
}
```

Author uncertainty is preserved. The extractor may not convert `may`, `can`, `suggests`, `associated with`, `contraindicated`, `insufficient evidence`, or `controversial` into stronger wording.

### Source text and normalization

`source_text` is authoritative. `normalized_form` is optional and subordinate.

```json
{
  "source_text": "Trouble bipolaire de type I",
  "normalized_form": "Trouble bipolaire de type I",
  "normalization": {
    "status": "proposed",
    "version": "rules-v1",
    "rule_id": "exact-preserving-normalization"
  }
}
```

Cross-language translation is never ordinary normalization. A future translation must be a separate explicit relationship with its own version and provenance.

### Extraction methods

Authoritative methods:

```text
direct
deterministic_repair
structural_parse
human_validated
```

`ai_inferred` is forbidden in `assertions.jsonl`.

AI suggestions, if later added, must be stored separately in `suggestions.jsonl` with `suggestion_status: proposed`, `activated: false`, and `reviewed_by: null`.

### Concepts and relations

`concepts.jsonl` stores source terminology, aliases only when supported by the source, related concepts, and source references.

`relations.jsonl` stores explicit relations only:

```text
symptom_of
diagnostic_feature_of
differential_with
risk_factor_for
associated_with
treated_by
contraindicated_with
adverse_effect_of
monitored_by
subtype_of
parent_of
referenced_by
defined_by
```

Every relation requires source references and provenance.

## 12. Tables, figures, algorithms, medications, and cross-references

These are first-class records.

### Tables

Preserve caption, headers, rows, cell coordinates, footnotes, units, abbreviations, surrounding context, page ranges, and continuation links.

### Figures

Preserve caption, host section, explanatory text, page, referenced concepts, and visual verification status.

### Algorithms

Preserve ordered nodes:

```text
decision
condition
branch
action
endpoint
sequence
```

A branch is never inferred unless visibly supported by the source.

### Medications

Preserve only explicit source statements, including generic name, brand name, class, indication, population, dose, range, route, frequency, duration, contraindication, precaution, adverse effect, interaction, monitoring, pregnancy information, tapering, and comparative statements.

All doses, units, thresholds, contraindications, interactions, and high-risk treatment statements enter human review.

### Cross-references

Allowed statuses:

```text
resolved_internal
resolved_explicit
unresolved
unresolved_external
```

Tome 2 references remain `unresolved_external`. No Tome 2 content is imported.

## 13. Source-to-output traceability gate

This gate is mandatory.

Every assertion must resolve through this chain:

```text
assertion_id
→ content_unit_id
→ source_page_index
→ raw/page-XXXX.json
→ source block IDs
→ raw_text_sha256
→ source-lock SHA-256
→ original PDF
```

The gate is `BLOCKED` if any assertion lacks:

- source unit;
- source page;
- raw file;
- source block or span;
- raw hash;
- source lock;
- mapping evidence.

Traceability is separate from clinical review.

## 14. QA model

`qa-report.json` contains separate QA dimensions.

```json
{
  "technical_qa": {
    "source_integrity": "PASS|WARNING|BLOCKED",
    "raw_extraction": "PASS|WARNING|BLOCKED",
    "repair_integrity": "PASS|WARNING|BLOCKED",
    "page_mapping": "PASS|WARNING|BLOCKED",
    "structure": "PASS|WARNING|BLOCKED",
    "traceability": "PASS|WARNING|BLOCKED",
    "replay_reproducibility": "PASS|WARNING|BLOCKED"
  },
  "visual_verification": {
    "status": "PASS|WARNING|BLOCKED|not_required",
    "reason": null
  },
  "clinical_review": {
    "status": "NOT_REVIEWED|NEEDS_REVIEW|APPROVED|REJECTED",
    "queue_size": 0,
    "approved_by": null
  },
  "promotion": {
    "retrieval_eligible": false,
    "clinical_active": false
  },
  "overall_package": "PASS|WARNING|BLOCKED"
}
```

The following distinction is mandatory:

```text
native extraction = PASS
visual verification = WARNING
clinical review = NOT_REVIEWED
```

A missing visual-inspection tool does not downgrade correct native extraction to warning. It downgrades visual verification only.

### Technical checks

- source hash, byte size, page count, PDF readability;
- 1220 page records;
- one terminal page checkpoint per page, with an explicit extraction outcome;
- raw text, coordinates, and block-order hashes;
- repair-ledger completeness;
- piecewise page mapping;
- heading and TOC consistency;
- parent-child structure;
- source-to-output traceability;
- duplicate IDs;
- orphan concepts and relations;
- unresolved cross-references;
- broken tables and algorithms;
- suspicious medication numbers and units;
- deterministic replay.

### Human review queue

The queue includes at least:

- doses, units, routes, frequency, duration, tapering;
- contraindications, interactions, adverse effects, monitoring;
- diagnostic criteria, differentials, thresholds;
- tables, figures, algorithms, and cross-page continuations;
- uncertain page mappings;
- low-confidence assertions;
- contradictory source statements;
- unresolved internal references;
- extraction gaps.

Warnings are never converted into passes by assumption.

## 15. Lifecycle and governance

The processing lifecycle is:

```text
REGISTERED
→ RAW_EXTRACTED
→ REPAIRED
→ STRUCTURED
→ CLAIMS_EXTRACTED
→ QA_READY
→ FROZEN
```

The downstream governance lifecycle is:

```text
FROZEN
→ HUMAN_REVIEWED
→ RETRIEVAL_ELIGIBLE
→ CLINICAL_ACTIVE
```

Rules:

- `FROZEN` does not mean retrieval-ready.
- `FROZEN` does not mean clinically active.
- No automatic transition from `FROZEN` to `RETRIEVAL_ELIGIBLE`.
- No automatic transition from `FROZEN` to `CLINICAL_ACTIVE`.
- Human approval is never fabricated.
- Governance events are append-only and do not mutate frozen content.
- A correction after freeze creates a new package version.

```text
Frozen v1
→ correction proposal
→ new run
→ new package version
→ review
→ Frozen v2
```

## 16. Implementation phases

### Phase 1 — Register and raw extraction

- Verify the source.
- Create the book-local package.
- Write `source-lock.json`.
- Write initial `run-manifest.json`.
- Write `book.json`.
- Extract all 1220 pages independently.
- Write immutable `raw/page-XXXX.json`.
- Write page records and checkpoints.
- Stop before repairs.

### Phase 2 — Deterministic reading layer

- Read raw pages.
- Apply allowlisted repairs.
- Write `reading/page-XXXX.json`.
- Write `repairs.jsonl`.
- Record repaired hashes.
- Rebuild from raw if repair rules change.

### Phase 3 — Page mapping

- Parse the TOC.
- Detect front matter and body boundaries.
- Detect references, indexes, credits, and back matter.
- Build piecewise mapping segments.
- Store mapping evidence per page.
- Never use a global offset.

### Phase 4 — Structural analysis

- Parse the TOC.
- Validate body headings.
- Build the hierarchy.
- Detect missing or broken headings.
- Preserve off-structure text explicitly.

### Phase 5 — Content units

- Create typed units.
- Link units to pages, blocks, raw hashes, and mapping evidence.
- Do not create chunks.

### Phase 6 — Assertions and knowledge layers

- Extract source assertions.
- Extract concepts and explicit relations.
- Extract tables, figures, algorithms, medications, and xrefs.
- Preserve source wording and uncertainty.
- Do not translate or normalize silently.

### Phase 7 — QA and review queue

- Run technical QA.
- Run the source-to-output traceability gate.
- Run replay verification.
- Generate the review queue.
- Separate technical, visual, clinical, and promotion states.
- Generate `PASS`, `WARNING`, or `BLOCKED`.

### Phase 8 — Freeze and stop

- Write `content-manifest.json`.
- Record package version.
- Record lifecycle state.
- Freeze the content package.
- Stop before retrieval or clinical activation.

## 17. First executable task

### TOME1-001 — Register and extract immutable raw pages

**Purpose:** create the source-locked raw layer for all 1220 pages.

**Input:**

```text
Books/dokumen.pub_psychiatrie-clinique-approche-bio-psycho-sociale-tome-1-.pdf
```

**Allowed writes:**

```text
knowledge/canonical-v2/psychiatrie-clinique-tome-1-2016-tc-media/sha256-ff1c745bd7cd8d35c748cb95a796b779e859ef79d517a5a23699528841d7ab82/**
context/ingest-psychiatrie-clinique-tome-1.md
```

No other project files may be modified.

**Required implementation tool:**

```text
knowledge/canonical-v2/psychiatrie-clinique-tome-1-2016-tc-media/sha256-ff1c745bd7cd8d35c748cb95a796b779e859ef79d517a5a23699528841d7ab82/tools/tome1_pipeline.py
```

The tool must expose these explicit subcommands:

```text
register
extract-raw
verify-raw
```

The shared scripts are not used or modified.

**TOME1-001 steps:**

1. Verify the source path exists.
2. Verify the source SHA-256.
3. Verify the byte size.
4. Verify the page count is 1220.
5. Run `qpdf --check`.
6. Create `source-lock.json`.
7. Create the initial `run-manifest.json`.
8. Create `book.json`.
9. Extract every page independently using the local native text layer.
10. Preserve raw text, blocks, coordinates, and block order.
11. Generate raw text, coordinates, and block-sequence hashes.
12. Write `raw/page-0000.json` through `raw/page-1219.json`.
13. Write `page-records.jsonl`.
14. Write `checkpoints/register.json`.
15. Write `checkpoints/extract-raw.jsonl`.
16. Run raw verification.
17. Stop before repairs, mapping, structure, assertions, or QA freeze.

**TOME1-001 validation:**

```text
source hash = ff1c745bd7cd8d35c748cb95a796b779e859ef79d517a5a23699528841d7ab82
raw page files = 1220
page records = 1220
every page has an extraction_state
every extracted page has raw_text_sha256
every extracted page has coordinates_sha256
failed or missing pages are explicit
no raw file is modified after creation
```

**TOME1-001 stop condition:**

```text
The immutable raw layer is complete and verified.
No repair, mapping, structure, assertion, QA freeze, chunking, embedding, database projection, or activation has occurred.
```

## 18. Acceptance criteria

The complete Tome 1 package is accepted only if:

### Source

- SHA-256 matches the locked value.
- Byte size matches.
- Page count is 1220.
- PDF structure passes `qpdf --check`.
- Source is not encrypted.

### Raw extraction

- All 1220 pages have records.
- Every page has an explicit extraction state.
- Every extracted page has raw text, coordinates, and block-order hashes.
- Failed or missing pages are explicit.
- Raw files are immutable.

### Repairs

- Every change has a repair record.
- Reading output is rebuildable from raw.
- No OCR, translation, or medical correction exists.

### Page mapping

- No global-offset assumption exists.
- Every printed page number has evidence.
- Uncertain mappings are visible.
- Null printed pages are not guessed.

### Structure

- TOC and body hierarchy are linked.
- Chapter boundaries are explicit.
- Broken headings are detected.
- No text is silently discarded.

### Assertions

- Every assertion has source text.
- Every assertion has exact source location.
- Every assertion has provenance.
- Every assertion resolves to raw source.
- No `ai_inferred` assertion exists in the authoritative layer.

### QA

- Source-to-output traceability passes.
- Technical, visual, clinical, and promotion states are separate.
- Review queue is complete.
- Replay produces the same output hashes.

### Isolation

- No Tome 2 file changed.
- No root plan changed.
- No shared ingestion script changed.
- No PostgreSQL write occurred.
- No chunks were created.
- No embeddings were created.
- No retrieval was activated.
- No OCR or cloud upload occurred.

## 19. Review and approval record

- Approach A approved: book-local, file-first, immutable raw layer.
- Six canonical schema amendments approved.
- Seven extraction and QA hardening constraints approved.
- Piecewise page mapping approved.
- Source assertion model approved.
- Lifecycle and promotion separation approved.
- Root plan and Tome 2 remain untouched.
- Written book-local specification is ready for user review.
- TOME1-001 execution is not yet authorized by this file alone.
