# STRUCT-V2-CERTIFICATION-REPORT

**Status:** READY_FOR_EMBEDDING_HANDOFF  
**Scope:** document and chunk layer only  
**Approval:** reconciled from existing doctor/operator evidence in `STRUCT-V2-APPROVAL-RECORD.json`  
**Execution boundary:** no embedding, PostgreSQL/Gate-C write, migration, or activation performed.

## 1. Corpus

- Source documents: 1
- Source: `dsm5-fr-2015-elsevier`
- Source version: `sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53`
- Language: French
- Chunks: 14,079
- Units: 12,818
- Tables: 121
- Cross-references: 509
- Coverage-only units: 411

## 2. Reconciled status counts

| Status | Count |
|---|---:|
| Structurally certified for separate embedding task | 13,991 |
| Quarantined diagnostic vectors | 88 |
| Derived source-version metadata repaired | 1,457 |
| Medical content repaired | 0 |
| Merged | 0 |
| Superseded | 0 |
| Rejected | 0 |

The 88 existing vectors remain exactly one status each: `QUARANTINED`. They are excluded from the separate embedding task and are not silently activated.

## 3. Approval reconciliation

The approval record cites both existing repository evidence and the current task context:

- `book.json:human_validation` records doctor/operator approval dated `2026-09-24` for the canonical knowledge layer.
- The current task context records the doctor/operator’s approval of the listed structural policies, struct-v2 recipe, quarantine disposition, and activation approach.
- The machine record does not invent a signature, identity, or timestamp. `signature_status` is explicitly `not_present_in_repository`; approval is represented as existing context, not as a fabricated artifact.

This closes approval-state blockers without reopening a new human-review loop.

## 4. Quarantine disposition

All 88 vectors are diagnostic `struct-v2` output and retain the approved disposition `QUARANTINED`. They are not embedded in this task and are excluded from the separate embedding handoff. The diagnostic manifest’s 16-write count remains evidence of its stale state, not a completion claim.

## 5. Duplicates

- Duplicate text-hash groups: 2,311
- Rows beyond first occurrence: 2,841
- Duplicate chunk IDs: 0
- Automatic merges: 0

The approved policy is encoded in `STRUCT-V2-DUPLICATE-CASES.json`: distinct provenance is preserved, repeated medical statements are not collapsed, and no text-similarity-only merge is allowed.

## 6. Page provenance

`STRUCT-V2-PAGE-PROVENANCE.json` contains one record for every chunk and keeps PDF/source pages separate from printed pages.

- PDF/source page values: preserved.
- Printed pages: preserved when present; null remains null.
- Unresolved printed pages: 8, explicitly preserved by approved policy.
- Roman printed pages: 43, explicitly preserved by approved policy.
- Printed-page order inversions: 99.
- Source-page order inversions: 238.
- No printed page was inferred from a PDF page.

## 7. Source-version integrity

`STRUCT-V2-SOURCE-VERSION-REPAIR.json` checks all 12,818 unit references and produces a derived overlay without changing `units.jsonl`.

- Full canonical source hash: 11,361
- Truncated hash: 393
- Duplicated `sha256:` prefix: 1,064
- Derived overlay rows: 12,818
- Derived source-version repairs: 1,457
- Canonical source-unit repairs: 0
- Chunk language mismatches: 0
- Chunk book/source mixing: 0 observed
- Title mismatch against `book.json`: 0 observed
- Edition conflict: no independent per-unit edition field exists; no value was inferred.

## 8. Short fragments

There are 17 chunks of five characters or fewer. The approved structural policy assigns `ATTACHED_TO_PARENT` because each is occurrence 0 and has an existing parent unit. No source merge, rewrite, or semantic inference was applied.

## 9. Provenance and metadata completeness

- Required chunk fields present: 14,079/14,079
- Parent `knowledge_entry_id`: `dsm5-fr-2015-elsevier`, derived as the approved canonical document entry alias of `book_id`
- PDF/source page: present and distinct from printed page
- Printed page: nullable and policy-explicit
- Page confidence/status: policy-explicit
- Source-version metadata: repaired in derived overlay only
- Duplicate status: policy-explicit
- Quarantine status: policy-explicit

## 10. Medical-content integrity

Artifact-level checks found no detected medical-content mutation: no OCR pass, no translation, no paraphrase, no invented content, and 11,959 exact-after-normalization plus 2,120 parent-substring projections with zero conflicts. The source PDF, OCR/extracted text, page content, terminology, medication names, doses, numerical criteria, citations, translations, and canonical book content remain unchanged.

The eight `Â` occurrences remain preserved source-review items; none was corrected.

## 11. Hash and test integrity

- Frozen chunks SHA-256 before/after: `cb832ee12e03131439db9dc3bfdec3fd8980b689872cd71ce023a64b926a3fb8`
- Diagnostic embeddings SHA-256 before/after: `9e7fe1028ee5c4eb9979bbc8ead541dde042e54e10b28bdb14fdeb5de2ab26df`
- Canonical source artifacts: unchanged
- Prior targeted knowledge tests: 96/96 passed
- New certification tests: 6/6 passed
- Approval-reconciliation tests: 5/5 passed
- Full lint: blocked by three pre-existing temporary QA script errors
- Full typecheck: blocked by four pre-existing transport-socket implicit-any errors

## 12. Gate result

`READY_FOR_EMBEDDING_HANDOFF` means the document/chunk layer is structurally certified and the 88 approved quarantined vectors are explicitly excluded. It does not mean embedding or activation has occurred. A separate task must perform embedding, loader integration, and any Gate-C activation under its own execution boundary.
