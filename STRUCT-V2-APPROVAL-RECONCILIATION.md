# STRUCT-V2-APPROVAL-RECONCILIATION

**State:** RECONCILED  
**Approval source:** existing repository evidence plus current task context  
**No new approval loop:** required

## Approval already present

The doctor/operator approval is represented by:

- `knowledge/canonical-v2/.../book.json:human_validation`, which records doctor/operator approval dated `2026-09-24` for the canonical knowledge layer;
- the current task context, which explicitly extends that approval to source/version interpretation, page/provenance policy, parent/source identity, duplicate policy, short-fragment policy, 88-vector disposition, struct-v2 recipe, and the activation approach.

The machine-readable record is `STRUCT-V2-APPROVAL-RECORD.json`. It preserves the distinction between:

- canonical book/content approval;
- approved structural policies;
- automation-generated certification evidence;
- separate embedding and activation execution.

## Reconciled decisions

- Parent document identity: `dsm5-fr-2015-elsevier` / canonical `knowledge_entry_id` alias.
- Source version: full canonical source hash; malformed parent references are corrected only in a derived overlay.
- Page policy: PDF/source page and printed page remain distinct; 8 unresolved and 43 Roman values remain explicitly unresolved/preserved.
- Duplicates: preserve provenance; no text-only automatic merge.
- Short fragments: approved structural disposition `ATTACHED_TO_PARENT`; no semantic merge.
- 88 vectors: approved disposition remains `QUARANTINED`; excluded from the separate embedding task.
- Struct-v2: approved for structural certification; embedding execution and activation remain separate and unexecuted.

## Integrity boundary

No source PDF, OCR/extracted text, page content, printed-page relationship, medical terminology, medication name, dose, numerical criterion, citation, translation, canonical book content, or pinned struct-v1 recipe was modified.

## Automation is not approval

Hashes, schema checks, deterministic metadata, tests, and certification reports are evidence produced by automation. They do not replace or fabricate a doctor/operator signature. The repository does not contain a signature artifact; this is recorded explicitly without treating the absence as a new approval blocker.

## Handoff

The separate embedding task may consume `STRUCT-V2-EMBEDDING-HANDOFF.json`. It must not embed the 88 quarantined vectors and must not perform PostgreSQL/Gate-C, migration, or activation in the structural-certification task.
