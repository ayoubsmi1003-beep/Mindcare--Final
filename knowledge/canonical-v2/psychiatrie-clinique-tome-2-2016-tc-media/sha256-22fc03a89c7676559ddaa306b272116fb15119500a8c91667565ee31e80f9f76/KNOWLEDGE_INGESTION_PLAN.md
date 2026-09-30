# Psychiatrie clinique — Tome 2 — Canonical Book Ingestion Plan

> Status: **DESIGN APPROVED IN CHAT; WRITTEN SPECIFICATION PENDING USER REVIEW.**
> This document is book-local. It does not authorize database writes, chunking, embeddings, retrieval, or clinical activation.

## Operating boundary

```text
TASK:      Canonical high-fidelity ingestion of one psychiatric textbook.
SCOPE:     This book only; no other book, shared ingestion artifact, database, or retrieval index.
ENTRYPOINT: Books/psychiatrie-clinique-approche-bio-psycho-sociale-tome-2-.pdf
TARGET:    knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/
STOP:      Canonical QA report and review queue are frozen; stop before chunking, embeddings, PG projection, or activation.
```

The only task manifest is `context/ingest-psychiatrie-clinique-tome-2.md`. The root `KNOWLEDGE_INGESTION_PLAN.md` is not modified or treated as this book's authority. Existing uncommitted work in the repository is preserved.

## 1. Verified source identity

| Field | Value or status |
|---|---|
| Canonical title | *Psychiatrie clinique : Approche bio-psycho-sociale* |
| Volume | Tome 2 — *Spécialités psychiatriques et traitements* |
| Edition | 4e édition |
| Publication year | 2016 |
| Directors | Pierre Lalonde and Georges-F. Pinard, with collaborators |
| Publisher | TC Média Livres Inc.; Chenelière appears as the publisher/distribution identity on the back cover |
| ISBN | 978-2-7650-4769-8 |
| Language | French (`fr`) |
| Source identifier | `Books/psychiatrie-clinique-approche-bio-psycho-sociale-tome-2-.pdf` |
| Source page count | 826 PDF pages, verified with qpdf and PyMuPDF |
| PDF state | PDF 1.4, not encrypted, qpdf reports no syntax or stream-encoding errors |
| Embedded text | Native text layer present; no OCR used |
| Source version | `sha256:22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76` |
| Book ID | `psychiatrie-clinique-tome-2-2016-tc-media` |
| Ingestion version | `canonical-v2.1-tome2` |

The hash is an immutable source identity, not a claim that the PDF is bibliographically complete. Final metadata validation remains responsible for recording any discrepancy rather than correcting it.

## 2. Verified structural probes

The source is a single Tome 2, not a combined two-volume extraction. The table of contents identifies Parts 5 and 6 and Chapters 49–85. Cross-references to Chapters 1–48 and other Tome 1 pages are retained as external references only; no Tome 1 content is loaded.

Observed boundaries are:

- PDF display page 1: cover.
- PDF display pages 4–17: publication data, authors, note au lecteur, préface, tables of contents, and abbreviations.
- PDF display page 12: Tome 2 table of contents; it lists Chapters 49–85, references, author/medication/subject indexes, and credits.
- PDF display page 18: Part 5 opening/contents page.
- PDF display page 19: Chapter 49 opening page; the contents page gives printed page 1083, but the page itself must be mapped and attested rather than assumed.
- PDF display page 20: printed page 1084 is visible; this is a confirmed mapping anchor.
- PDF display pages 823–824: subject index ending at I57 and credits.
- PDF display page 825: blank source page.
- PDF display page 826: publisher/back-cover material, including the ISBN and volume description.

`source_page_index` is zero-based. Human-readable PDF page numbers in this document are one-based display numbers. The printed-page mapping is piecewise; a single global offset is forbidden.

## 3. Architecture

```text
immutable PDF
  -> source lock and per-page extraction checkpoints
  -> raw text/blocks + immutable coordinates
  -> logged reading-layer repairs
  -> piecewise PDF-page/printed-page map
  -> TOC/heading structure
  -> typed content units and atomic claims
  -> tables, figures, algorithms, medications, concepts, relations, xrefs
  -> schema/provenance/continuity/clinical QA
  -> review queue
  -> frozen canonical-v2.1-tome2
  -> STOP
```

The order is fixed:

```text
source fidelity -> structure -> semantics -> provenance -> validation -> canonical units
```

No stage mutates an earlier stage. Every stage is replayable from the source lock and its declared extraction version. The canonical JSON is the authority for this book. PostgreSQL, embeddings, and retrieval are future consumers, not part of this task.

## 4. Isolated output layout

All generated files stay under the target directory:

```text
knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/
  sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/
    KNOWLEDGE_INGESTION_PLAN.md
    source-lock.json
    book.json
    pages.map.json
    manifest.json
    schema/
      canonical-v2.1-tome2.schema.json
    raw/
      pages.jsonl
      blocks.jsonl
    repairs.jsonl
    structure.json
    units.jsonl
    claims.jsonl
    tables.jsonl
    figures.jsonl
    algorithms.jsonl
    medications.jsonl
    concepts.jsonl
    relations.jsonl
    xrefs.jsonl
    checkpoints/
      register.json
      extract-pages.jsonl
      page-map.json
      structure.json
      semantics.json
      qa.json
    qa-report.json
    review-queue.json
```

The output directory is dedicated to this source version. A new source hash creates a new sibling version; an existing version is never edited in place. No shared schema, loader, migration, or script is changed by this plan.

## 5. Source lock and metadata

`source-lock.json` records the absolute source identifier, filename, byte size, SHA-256, page count, PDF version, parser family, extraction timestamp, and tool limitations. A failed or changed hash blocks extraction.

`book.json` records immutable bibliographic metadata and provenance status. Authors/editors remain a list, not a flattened string. Fields not verified from the source remain explicitly `null` with a reason; they are never inferred from web sources.

The source version is independent from the ingestion version. Changing extraction rules creates a new ingestion version. Replaying the same source and code must produce the same stable IDs and byte-identical canonical serialization.

## 6. Page-number authority

Every page record contains:

```text
source_page_index          zero-based immutable PDF index
source_page_display        one-based human display number
printed_page_number        exact printed string or null
printed_page_kind          front_matter | body | references | author_index | medication_index | subject_index | credits | cover | blank | unknown
mapping_status             certain | inferred | uncertain | missing | not_applicable
mapping_anchor             observed printed label, TOC evidence, or explicit rule
mapping_evidence           source page, text span, and extraction version
```

The body mapping is calibrated from multiple visible anchors. The observed relationship between PDF display page 20 and printed page 1084 is an anchor, not permission to extrapolate without verification. Front matter, body pages, references, indexes, credits, blank pages, and back cover each receive their own mapping rule and status.

Every knowledge object carries page ranges in both systems and the statuses of all pages touched. An uncertain mapping is never silently promoted. A claim depending on an uncertain page is `needs_review` or `blocked` according to the QA rules.

## 7. Text fidelity and repair ledger

The source has a usable native text layer but systematic ligature/glyph corruption, including private-use characters in words where a ligature was expected. The pipeline therefore stores two layers.

### Raw layer

`raw/pages.jsonl` and `raw/blocks.jsonl` preserve the decoder output, page coordinates, block order, line breaks, and source page identity. The raw layer is immutable. `raw_sha256` is recorded for every page and block sequence.

### Reading layer

A reading view may apply only allowlisted deterministic repairs:

- PUA/ligature mappings verified against the source font mapping;
- Unicode compatibility normalization where it does not change lexical content;
- line-break hyphenation joins when the source geometry proves a single word;
- whitespace normalization at block boundaries.

Every change is recorded in `repairs.jsonl` with `rule_id`, raw value, replacement value, page/block/character offsets, count, confidence, and review status. The reading layer never overwrites the raw layer.

Forbidden repairs include synonym substitution, diagnostic reinterpretation, dose normalization, translation, removal of uncertainty, correction of an author claim, or filling missing text. No OCR is permitted. If a page lacks usable text, it is quarantined as `missing`; it is not reconstructed from an image or an external edition.

## 8. Extraction and recovery pipeline

### Stage 0 — Register

Lock the source hash and metadata, verify the PDF is readable, create the target directory, and write the initial checkpoint. A changed source stops the run.

### Stage 1 — Native page extraction

Extract each page independently with the local PyMuPDF-compatible parser. Store text blocks and coordinates before any repair. Use bounded page batches only for orchestration; a single bad page cannot abort the book. The parser is an extraction transport, not a clinical authority.

### Stage 2 — Reading layer and page map

Apply the logged repair rules, identify printed page labels, detect blank/cover/index/credits pages, and calibrate piecewise mappings using visible anchors and TOC evidence. The current Citra probe timed out even on a two-page request; this limitation is recorded, and Citra may inspect or render a small page range later when it responds. A Citra timeout does not justify OCR or invented text.

### Stage 3 — Structure

Parse the Tome 2 table of contents first, then validate chapter openings and headings against the body. Preserve the author's hierarchy:

```text
Book -> Part -> author domain group -> Chapter -> Section -> Subsection -> Content Unit
```

Author domain groups include `Situations de crise`, `Psychiatrie légale`, `Pédopsychiatrie`, `Gérontopsychiatrie`, `Traitements biologiques`, and `Traitements psychosociaux`. A domain group is a structural node, not a discarded label.

### Stage 4 — Content units

Create typed units without flattening prose. Initial content types are `chapter_opening`, `heading`, `definition`, `prose`, `list`, `clinical_case`, `box`, `table`, `figure`, `algorithm`, `recommendation`, `diagnostic_criteria`, `differential`, `investigation`, `scale`, `medication_statement`, `reference`, `bibliography`, `index_entry`, `credits`, and `back_matter`.

Each unit stores structural path, title, parent, preceding/following context, semantic type, source spans, source and printed page ranges, language, provenance, confidence, extraction status, and validation status.

### Stage 5 — Semantics and clinical entities

Extract atomic claims where useful while retaining the original passage and hierarchy. Each claim stores:

```text
subject
predicate_or_relation
object
clinical_domain
population
age_group
context
temporal_qualifier
severity_qualifier
exception_or_condition
evidence_or_recommendation_wording
exact_source_passage_ref
confidence
extraction_status
validation_status
```

Preserve wording and modality such as `peut`, `devrait`, `est associé`, `suggère`, `il faut`, `contre-indiqué`, `preuves insuffisantes`, and `controversé`. The extractor may propose a normalized relation, but the source wording remains authoritative.

### Stage 6 — Visual and medication layers

Reconstruct tables, figures, algorithms, medications, concepts, relations, and cross-references as separate first-class records. These records point back to their host unit and exact source spans.

### Stage 7 — QA and review

Run all validation gates, write `qa-report.json` and `review-queue.json`, and freeze only when every page checkpoint has a terminal state. The book may be frozen with explicit warnings; it may not be silently declared clinically complete.

### Stage 8 — Stop

Stop after the frozen canonical package. Do not chunk, embed, project to PostgreSQL, activate a source, or alter another book.

## 9. Structural model

`structure.json` is the authoritative hierarchy. It includes stable node IDs, node type, title verbatim, parent/children, source order, page ranges, mapping status, and neighboring context IDs. TOC entries are retained as `toc` nodes and linked to their body heading; a TOC entry is never treated as body evidence by itself.

Body text outside a recognized heading is assigned to the nearest supported parent with an explicit `off_structure` or `orphan_context` flag. It is not discarded. Broken heading detection compares the TOC, opening pages, heading sequence, and chapter endings.

## 10. Canonical content units

A content unit is the smallest stable container for a coherent source passage, table, case, box, figure, algorithm, index entry, or medication passage. It must be large enough to preserve context and small enough to avoid merging unrelated claims. Units never cross a chapter boundary unless a cross-chapter structure is explicitly represented.

Each unit has a stable ID derived from source version, structural path, source span, content type, and occurrence. The occurrence prevents accidental collapse of repeated passages. IDs do not depend on a future chunker or embedding model.

## 11. Ontology and entity model

Entity classes include disorders and diagnoses, symptoms and signs, criteria, differential diagnoses, risk factors, treatments, medication classes, explicit dose rules, contraindications, adverse effects, interactions, investigations, scales and tools, recommendations, populations and age groups, legal/ethical concepts, and crisis concepts.

`concepts.jsonl` stores canonical name, source terminology, aliases, related concepts, and source references. `relations.jsonl` stores typed edges such as `symptom_of`, `diagnostic_feature_of`, `differential_with`, `risk_factor_for`, `associated_with`, `treated_by`, `contraindicated_with`, `adverse_effect_of`, `monitored_by`, `subtype_of`, `parent_of`, `referenced_by`, and `defined_by`.

No concept is linked merely because two strings look similar. An orphan concept, duplicate concept, or relation without a source reference is a QA warning. French source terminology remains French.

## 12. Tables, figures, and algorithms

### Tables

Each table record contains a stable table ID, caption verbatim, source and printed pages, geometry, headers, rows, cell coordinates, row/column relationships, footnotes, units, abbreviations, source context, and continuation links. A table split across pages is represented as one logical table with ordered page segments. An unreconstructable cell is `needs_review`; it is never guessed.

### Figures

Each figure record contains caption, page, host section, referenced concepts, explanatory text, image/region reference when available, and surrounding context. A figure without a reliable caption remains a visual artifact with an explicit unresolved status.

### Algorithms

Each algorithm contains ordered nodes with node type, condition, branch, action, endpoint, sequence, source span, and printed page. A branch is never inferred from a diagram unless the source visibly supports it.

## 13. Medication knowledge layer

Medication records preserve only explicit source claims and retain the source's distinctions between drug, class, formulation, route, population, and context. Fields include generic name, brand name, class, indication, target condition, population, dose, range, titration, minimum, maximum, route, frequency, duration, contraindication, precaution, adverse effect, interaction, monitoring, special population, pregnancy information, tapering/discontinuation, and comparative statement.

Every medication field is atomic enough to carry its own page and passage provenance. A dose is not converted between units, routes, or formulations. Abbreviations such as route/frequency codes remain verbatim and are parsed only when the source context is clear.

All doses, units, numerical thresholds, contraindications, interactions, and high-risk treatment recommendations enter the human review queue. A medication record is never marked clinically approved by extraction confidence.

## 14. Provenance and evidence

Every unit, claim, entity, table, figure, algorithm, medication field, and cross-reference resolves to:

```text
book_id
source_version
source_page_index range
printed page range and mapping status
structural path
host unit
source block and character/offset range
raw passage reference
reading-layer repair references
extractor and ingestion version
extraction status
validation status
```

The retrieval-ready evidence contract is future-facing: a question may later follow concept -> claim -> unit -> table/figure -> exact source pages. The present task stops before retrieval.

`confidence` means extraction confidence only. It is never a clinical certainty score and is never presented as the author's recommendation strength.

## 15. Validation model

Validation states are `auto_ok`, `needs_review`, `blocked`, and `approved`. This book cannot become `approved` during automated ingestion. Human approval is a separate signed act and is outside the current task.

Automated validation covers:

- source hash, byte size, page count, and readable PDF structure;
- one terminal checkpoint per page;
- raw/reading-layer integrity and repair-ledger completeness;
- page continuity, blank pages, missing text, duplicate pages, and printed-page mapping;
- heading/TOC/body agreement and parent/child consistency;
- table geometry, continuation, footnotes, and cell references;
- medication schema completeness and suspicious numeric/unit patterns;
- concept/entity/relation source references and duplicate detection;
- internal cross-reference resolution;
- external Tome 1 references marked `unresolved_external`;
- extraction gaps and text outside expected structure.

## 16. QA gates and report

`qa-report.json` contains a top-level `PASS`, `WARNING`, or `BLOCKED` verdict and one record per check. `WARNING` explains the exact affected pages/units and why human review is required. `BLOCKED` is used for unresolved page authority, missing text required for a claim, broken table/algorithm structure, unsafe high-risk extraction, or an inability to reproduce a checkpoint.

A book with explicit warnings can be frozen as a canonical research artifact, but it is not clinically active or retrieval-ready. Warnings are never converted to passes by assumption.

The human review queue includes at least:

- medication doses, units, routes, frequency, duration, and tapering;
- contraindications, interactions, adverse effects, and monitoring;
- diagnostic criteria, differentials, thresholds, and numerical claims;
- tables, algorithms, figures, and cross-page continuations;
- ambiguous or inferred page mappings;
- low-confidence concepts, duplicate entities, and unresolved internal references;
- external Tome 1 references that may require a future source.

## 17. Versioning and reproducibility

Three independent axes are recorded:

```text
source_version     SHA-256 of the immutable PDF
ingestion_version  canonical-v2.1-tome2 plus extractor/rule versions
downstream_version not created in this task
```

A new PDF byte sequence creates a new source version. A changed extraction or repair rule creates a new ingestion version. Stable IDs use the canonical serialization of the source version, structure, and source span. A replay of the same source and versions must produce identical files and hashes.

No migration is edited or added. No new table, column, enum, loader, or shared schema is introduced. A future PostgreSQL projector requires a separate ADR and human gate.

## 18. Future chunking contract

A future chunker consumes canonical units, not raw page dumps. Boundaries must not split a criterion, medication sentence, table row, or algorithm node. Each future chunk retains the full structural header trail, unit ID, concept/entity IDs, table/figure IDs, source page index range, printed page range, mapping status, and provenance.

A future chunk ID is derived from source version, unit ID, normalized reading text, and occurrence. Any chunker change creates a new chunker version and requires a controlled re-embedding decision. No chunking occurs in this task.

## 19. Future embedding and RAG contract

A future retrieval layer may project approved canonical records into the governed knowledge store and use the pinned local embedding recipe. It must retain C4, active, approved, review-current, non-superseded gates and return evidence plus provenance plus context. The present package must not be embedded, activated, or merged with another book.

## 20. Failure and recovery

- Source hash mismatch: stop before extraction.
- Parser error or timeout: isolate the page/batch, preserve the checkpoint, retry with a smaller range, and record the failure.
- Citra timeout: retain native extraction and mark visual verification unavailable; never switch to OCR.
- Missing text layer: mark page `missing`, quarantine dependent claims, and do not infer from an image.
- Uncertain printed number: retain both indices, mark the claim for review, and do not invent a number.
- Broken table or algorithm: quarantine the visual record and block dependent claims.
- Semantic contradiction between passages: preserve both claims with separate provenance; never reconcile silently.
- Process interruption: resume from the last page checkpoint; do not restart or overwrite a completed page without an explicit replay run.
- Schema or replay mismatch: stop, report the exact file/hash, and do not mark the book frozen.

## 21. Exact execution workflow after written-spec approval

1. Create the book-local source lock and register metadata.
2. Verify the PDF hash, 826-page count, and readable structure.
3. Extract every page independently into the raw layer and page checkpoints.
4. Apply only logged reading-layer repairs.
5. Build and verify the piecewise printed-page map.
6. Parse the TOC and build the Part/Chapter/Section/Subsection hierarchy.
7. Create typed content units for the entire book.
8. Extract claims, entities, relations, tables, figures, algorithms, medications, and xrefs.
9. Validate schemas, provenance, page continuity, clinical numerics, and cross-references.
10. Write the Book QA Report and human review queue.
11. Freeze `canonical-v2.1-tome2` with an explicit verdict.
12. Stop and report the exact PASS/WARNING/BLOCKED state.

## 22. Acceptance criteria

The task is complete only when:

- the source hash and page count are verified;
- all 826 source pages have a recorded extraction checkpoint;
- raw and reading layers are separate and repair changes are logged;
- page authority is explicit for every extracted object;
- the Tome 2 hierarchy covers Chapters 49–85 without importing Tome 1 content;
- tables, figures, algorithms, medication claims, and xrefs have first-class records where present;
- QA and review queue are written;
- replay is deterministic;
- no shared file, other book, database, retrieval index, or clinical activation was changed.

## 23. Out of scope

- Any other book or volume.
- Old OCR/graphify outputs or their semantic cache.
- Shared ingestion scripts, root plans, migrations, or database tables.
- Chunking, embeddings, vector search, RAG activation, or Jarvis wiring.
- OCR, translation, external research, or correction of the source.
- Human clinical approval.

## 24. Approval record

- Approach approved: page-first dual-layer file-first ingestion.
- Isolation approved: book-local writes only.
- External references approved: preserve Tome 1 references as `unresolved_external`.
- First gate selected: plan first, then full canonical ingestion after approval.
- Written specification: pending user review.
