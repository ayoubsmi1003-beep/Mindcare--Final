# STRUCT-V2 PRE-EMBEDDING CERTIFICATION IMPLEMENTATION PLAN

> **For agentic workers:** Execute the certification tasks in order; do not run embedding, PostgreSQL, migration, or activation tasks.

**Goal:** Certify the document/chunk layer, classify all existing diagnostic vectors, preserve unresolved provenance, and produce a human approval package without authorizing `struct-v2`.

**Architecture:** Read-only frozen JSONL/JSON artifacts are audited into derived certification reports. The proposed recipe receives explicit document/chunk contract metadata; canonical inputs and the pinned `struct-v1` recipe remain unchanged. All human-governed decisions remain blocked or pending.

**Tech Stack:** JSON/JSONL, Python read-only audit generation, Vitest, TypeScript typecheck, ESLint.

**Spec:** User-provided pre-embedding certification requirements and the frozen MindCare struct-v2 artifacts.

## Global Constraints

- Do not embed anything.
- Do not write PostgreSQL/Gate-C.
- Do not run migrations or activation.
- Do not authorize `struct-v2` without signed human approval artifacts.
- Do not mutate, translate, rewrite, correct, or merge medical source content.
- Preserve PDF/source page and printed page as separate fields.
- Keep unresolved values unresolved and quarantine them explicitly.
- Do not modify frozen canonical artifacts or the pinned `struct-v1` recipe.

---

### Task 1: Verify contract and authority

**Files:**
- Read: `knowledge/recette-embedding-struct-v2.json`, `knowledge/recette-embedding-pinee.json`, `book.json`, `AGENTS.md`, `CLAUDE.md`
- Modify: `knowledge/recette-embedding-struct-v2.json` only with proposed document/chunk contract fields

**Steps:**
1. Read the proposed recipe and source identity.
2. Confirm the pinned recipe and executable authority are `struct-v1`.
3. Add explicit document/chunk contract fields, preserving unresolved values.
4. Run the certification test for required fields.

### Task 2: Audit quarantine and provenance

**Files:**
- Read: frozen `chunks-v2.jsonl`, `embeddings-v2.jsonl`, manifests, page map
- Create: `STRUCT-V2-QUARANTINE-DISPOSITIONS.json`, `STRUCT-V2-PAGE-PROVENANCE.json`

**Steps:**
1. Match all 88 vector IDs to frozen chunks.
2. Classify each as exactly one allowed status; retain `QUARANTINED` because production compatibility and approval are absent.
3. Record reason, evidence, source/version, page evidence, and approval requirement for every item.
4. Emit one page-provenance record per chunk with PDF and printed fields separate.
5. Test counts, status values, and unresolved printed pages.

### Task 3: Audit source versions and repairability

**Files:**
- Read: `units.jsonl`, `book.json`, struct-v2 manifests
- Create: `STRUCT-V2-SOURCE-VERSION-REPAIR.json`

**Steps:**
1. Check every unit source-version reference.
2. Classify truncated, duplicated-prefix, and valid values.
3. Record deterministic repair candidates without applying new values.
4. Report title, edition, language, source-mixing, and stale-reference checks.
5. Test that 1,457 issues remain unrepaired and human-governed.

### Task 4: Define duplicate and short-fragment policies

**Files:**
- Create: `STRUCT-V2-DUPLICATE-CASES.json`, `STRUCT-V2-SHORT-FRAGMENT-DISPOSITIONS.json`
- Test: `tests/unit/struct-v2-certification.test.ts`

**Steps:**
1. Define exact duplicate, distinct-provenance duplicate, and legitimate repeated statement cases.
2. Require provenance preservation and prohibit automatic merging for cases 2 and 3.
3. Classify 17 short chunks using occurrence/parent structure only.
4. Test allowed decisions and human approval requirements.

### Task 5: Produce certification and approval package

**Files:**
- Create: `STRUCT-V2-CERTIFICATION-REPORT.json`, `STRUCT-V2-CERTIFICATION-REPORT.md`, `STRUCT-V2-MEDICAL-CONTENT-INTEGRITY.md`, `STRUCT-V2-HUMAN-APPROVAL-PACKAGE.md`

**Steps:**
1. Record all requested certification counts and blockers.
2. State medical-integrity evidence and its limitation.
3. List human approvals, affected files, provenance/retrieval/migration impacts, and missing artifacts.
4. Keep approval incomplete and activation forbidden.

### Task 6: Verify and stop

**Steps:**
1. Run the new certification tests.
2. Run prior knowledge/embedding regression tests.
3. Run lint and typecheck; report pre-existing failures separately.
4. Verify canonical hashes and changed-file scope.
5. Stop before embedding, PostgreSQL, migration, or activation.
