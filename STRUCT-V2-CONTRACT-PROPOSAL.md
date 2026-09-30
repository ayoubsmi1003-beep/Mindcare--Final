# STRUCT-V2-CONTRACT-PROPOSAL

**Status:** reconciled / approved for structural certification  
**Approval record:** `STRUCT-V2-APPROVAL-RECORD.json` (existing doctor/operator evidence; no new approval loop)  
**Current state:** this proposal is reconciled and approved for structural certification; the sections below preserve the original contract rationale.  
**Artifact:** `dsm5-fr-2015-elsevier` / `struct-v2`  
**Scope:** pre-embedding contract only. This document does not authorize embedding, PostgreSQL/Gate-C, migrations, or knowledge activation.

## 1. Identity and immutability

An embedding job is eligible only when the input declares one exact `book_id`, full `source_version`, `chunker_version`, normalisation, and artifact digest. The frozen input is:

- `book_id`: `dsm5-fr-2015-elsevier`
- `source_version`: `sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53`
- `chunker_version`: `struct-v2`
- `normalisation`: `nfkc-espace-v1`
- chunks: 14,079
- units: 12,818
- tables: 121
- cross-references: 509

Any changed digest, source version, chunker version, field schema, or field semantics requires a new recipe and a new review. The existing pinned recipe remains `struct-v1` and is not changed.

## 2. Required chunk shape

Every row must contain the existing canonical fields: `chunk_id`, `book_id`, `source_version`, `unit_id`, `titre_source`, `structural_path`, `section`, `occurrence`, `langue`, `texte`, `texte_hash`, `texte_indexable`, `page_start`, `page_end`, `printed_page_start`, `printed_page_end`, `concept_ids`, `entity_ids`, `table_figure_ids`, `chunker_version`, `normalisation`, `provenance`, `confidence`, and `validation_status`.

The embedding text is exactly `texte_indexable`. It must not be reconstructed from a different field at runtime.

## 3. Deterministic identity and text gates

- `chunk_id` is SHA-256 of the versioned struct-v2 identity input: `source_version|unit_id|unit_text_hash|occurrence`.
- `texte_hash` is SHA-256 of the emitted chunk text after the declared normalisation.
- `texte_indexable` is deterministic from the declared source title, structural path, unit title, and emitted text.
- Every chunk must link to an existing unit.
- The normalized chunk text must be either the complete normalized parent wording or a contiguous substring of it.
- All 14,079 rows pass the current field, identity, text-hash, ID-determinism, indexable-text, and orphan-link checks.

## 4. Page and source-version gates

Printed pages may be strings, integers, or null according to the current artifact. A production candidate must have an approved interpretation for all page forms and must pass:

- 8 missing printed-page values;
- 43 Roman printed-page values;
- 99 printed-page order inversions;
- 238 source-page order inversions under source-order comparison;
- mixed page offsets: 58 and 59 dominate the artifact, with smaller 60/118/119 groups;
- 1,457 malformed parent-unit source-version values: 393 truncated and 1,064 with a duplicated `sha256:` prefix.

No page value or source-version value is silently corrected by this proposal.

## 5. Duplicate and quality gates

- Duplicate text hashes are not duplicate identities: there are 2,311 groups and 2,841 rows beyond the first occurrence.
- No deduplication is permitted before a policy identifies whether a repeated text is a genuine repeated citation, a table/header repetition, a short-fragment artifact, or an extraction duplicate.
- 17 chunks are at most five characters and require an explicit fallback decision.
- 8 chunks contain the `Â` character and require source review.
- 7 structural paths are degenerate under the current diagnostic check and require classification.
- 411 units remain coverage-only and are not a reason to discard source text.

## 6. Embedding, resume, and quarantine gates

The proposed recipe is `knowledge/recette-embedding-struct-v2.json`, with identifier `r3-struct-v2-2026-09-24`. It is a proposal, not a pinned production recipe.

A resume is allowed only when the checkpoint records the exact input digest, recipe, chunker, source version, model revision, dimensions, text field, ordered chunk IDs, completed IDs, failed IDs, and atomic write status. A bounded run is not a complete run. A vector with a wrong chunk ID, wrong dimensions, non-finite value, wrong source version, wrong text field, or unverifiable text hash is invalid and must be quarantined or recomputed.

The existing 88 vectors are diagnostic output. They are explicitly quarantined because they were produced under a `struct-v2` diagnostic manifest while the active production recipe is `struct-v1`; the manifest also reports only 16 writes although the file contains 88 rows. They must not be loaded, copied into production, or treated as proof of completion.

## 7. Rejection matrix

| Gate | PASS condition | Current result | Action |
|---|---|---:|---|
| Required fields | 100% present and typed | PASS | Preserve |
| Identity | exact book/source/chunker and unit links | PASS | Preserve |
| Text hash and chunk ID | deterministic and matching | PASS | Preserve |
| Indexable text | deterministic from declared inputs | PASS | Preserve |
| Page mapping | approved and internally consistent | BLOCKED | Human page decision |
| Source-version metadata | every parent value full and exact | BLOCKED | Human metadata decision |
| Duplicate text | policy assigned per group | BLOCKED | Human fallback decision |
| Short fragments | no unclassified short rows | BLOCKED | Human quality decision |
| `Â` anomalies | source review complete | BLOCKED | Human source review |
| Cross-references | unresolved references dispositioned | BLOCKED | Review queue |
| Embedding compatibility | struct-v2 recipe accepted by loader/tests | BLOCKED | Ratify proposal |
| Resume safety | atomic, one-to-one, verified checkpoint | BLOCKED | Implement gate |
| Activation | signed approval and Gate-C path | BLOCKED | No activation |

## 8. Authority boundary

There is no authoritative `struct-v2` ADR/schema/recipe. `APPROVALS.md`, `CORPUS-REPORT.md`, and `CITRA-SPOTS.md` are absent and are recorded as missing evidence. The proposal cannot override executable code, migrations, tests, or signed human decisions. No PostgreSQL write or knowledge activation is part of this contract.
