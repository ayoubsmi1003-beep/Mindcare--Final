# FALLBACK-DUPLICATE-POLICY

**Status:** reconciled / approved no-automatic-merge policy  
**Approval record:** `STRUCT-V2-APPROVAL-RECORD.json`  
**Current state:** approved no-automatic-merge policy; no source or medical content was changed.  

## Duplicate identity versus duplicate text

`chunk_id` remains the unique identity. `texte_hash` is content identity for the emitted normalized text. A repeated text hash does not authorize deletion, first-row selection, nearest-neighbor reuse, or vector reuse.

The frozen artifact contains 2,311 duplicate text-hash groups and 2,841 rows beyond the first occurrence. These groups must be classified independently.

## Classification before any fallback

Each duplicate group receives one review class:

- `genuine-repeat`: repeated source wording at distinct source locations;
- `header-footer-repeat`: repeated running material;
- `table-header-repeat`: repeated table header or cell material;
- `index-repeat`: repeated index entry;
- `short-fragment-artifact`: result of splitting or extraction;
- `ambiguous`: insufficient provenance;
- `defect`: conflicting content or invalid identity.

The class, reviewer, decision, and reason are recorded before a policy is applied.

## Permitted fallback

Only after human approval may a future recipe define a fallback for a class. A fallback must preserve the original chunk row and page/unit provenance, create an explicit derived-vector record, and never overwrite or silently delete the source chunk. No fallback is currently approved.

## Current disposition

- 2,311 duplicate groups: blocked pending classification.
- 2,841 excess rows: blocked pending classification.
- 17 short fragments: blocked; do not merge automatically.
- 8 `Â` occurrences: blocked pending source review.
- 411 coverage-only units: retain full text; do not discard because semantic atomization is incomplete.

## Embedding rule

No duplicate text may be embedded twice under the same chunk ID, and no vector may be copied to a different chunk without a recorded derived relation. A production resume must prove one vector per approved chunk ID, or stop with an explicit blocked state.

## Evidence

- `STRUCT-V2-AUDIT.json`: duplicate counts and blocked gate.
- `STRUCT-V2-CONTRACT-PROPOSAL.md`: rejection matrix.
- `chunks-v2.jsonl`: immutable frozen input.
- `FALLBACK-DUPLICATE-POLICY.md`: proposed decision boundary; no source edit.
