# STRUCT-V2-AUDIT

**Status:** historical pre-approval audit; superseded by `STRUCT-V2-CERTIFICATION-REPORT.md`  
**Purpose:** pre-embedding safety audit; no model execution, PostgreSQL/Gate-C write, migration, or activation  
**Frozen input:** `chunks-v2.jsonl`  
**Input SHA-256:** `cb832ee12e03131439db9dc3bfdec3fd8980b689872cd71ce023a64b926a3fb8`

## Verdict

The deterministic structural checks pass, but the artifact is not production-compatible. The pinned production recipe accepts `struct-v1`, not `struct-v2`; the parent units contain 1,457 malformed source-version values; page mapping is not ratified; duplicate, short-fragment, and `Â` handling is unresolved; and the existing 88 vectors are diagnostic output with a stale manifest.

The machine-readable source of truth for this report is `STRUCT-V2-AUDIT.json`.

## Counts

- 14,079 chunks, 12,818 units, 121 tables, 509 cross-references.
- 0 missing required fields, 0 text-hash mismatches, 0 chunk-ID determinism mismatches, 0 indexable-text mismatches, 0 orphan unit links.
- 11,959 chunks equal their normalized parent wording; 2,120 are contiguous substrings; 0 conflicts.
- 2,311 duplicate text-hash groups, 2,841 rows beyond the first.
- 17 chunks at most five characters, 0 chunks over 2,000 characters.
- 8 `Â` occurrences across 8 chunks, 7 degenerate structural paths.
- 8 missing printed-page values, 43 Roman printed-page values, 99 printed-page order inversions, 238 source-page order inversions.
- 705 source multi-page ranges and 72 numeric printed multi-page ranges in the current artifact; the prior reported 682 figure is retained as unverified historical evidence.
- 411 coverage-only units, 19 tables auto-OK, 102 tables needing layout review, 297 unresolved and 212 resolved cross-references.
- 88 existing embedding rows, all 1,024-dimensional and finite, but diagnostic-only.

## Gate result

| Gate | Result | Reason |
|---|---|---|
| Required fields | PASS | All 25 required fields are present and typed |
| Identity/source hash | PASS | All chunks carry the expected book and full source version |
| Text/ID determinism | PASS | SHA-256 checks pass against the struct-v2 algorithm |
| Indexable text | PASS | Deterministic from declared source/path/unit/text inputs |
| Page mapping | BLOCKED | Null, Roman, mixed-offset, and ordering decisions unresolved |
| Source-version metadata | BLOCKED | 1,457 parent-unit defects require human repair decision |
| Duplicate text | BLOCKED | 2,311 groups require classification; no deduplication allowed |
| Short fragments | BLOCKED | 17 rows require explicit fallback decision |
| `Â` quality | BLOCKED | 8 occurrences require source review |
| Tables/xrefs | BLOCKED | Layout and 297 unresolved cross-references remain review work |
| Embedding compatibility | BLOCKED | Pinned recipe and executable code accept struct-v1 only |
| Resume safety | BLOCKED | Existing script does not meet the proposed atomic contract |
| Activation | BLOCKED | No signed approval, Gate-C, migration, or activation |

## Canonical changes

No canonical source artifact was changed. In particular, `book.json`, `units.jsonl`, `pages.map.json`, `structure.json`, `chunks-v2.jsonl`, `chunks-v2.manifest.json`, `tables.jsonl`, `xrefs.jsonl`, `embeddings-v2.jsonl`, `embeddings-v2.manifest.json`, and `knowledge/recette-embedding-pinee.json` remain untouched.

The new files are audit/proposal documents, one proposed recipe, one quarantine manifest, and safety tests. `APPROVALS.md`, `CORPUS-REPORT.md`, and `CITRA-SPOTS.md` were requested for inspection but are absent; no approval or approval substitute is inferred.
