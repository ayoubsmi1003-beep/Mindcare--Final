# EMBEDDING-V2-RECIPE-PROPOSAL

**Status:** approved for structural certification; embedding/activation remain separate and unexecuted  
**Approval record:** `STRUCT-V2-APPROVAL-RECORD.json`  
**Current state:** approved for structural certification; embedding execution and activation remain separate and unexecuted.  
**Recipe identifier:** `r3-struct-v2-2026-09-24`  
**Canonical input:** `dsm5-fr-2015-elsevier` / `struct-v2` / `sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53`  
**Activation:** separate task; not performed here

## Proposed recipe

```yaml
recipe_id: r3-struct-v2-2026-09-24
status: approved_for_structural_certification
book_id: dsm5-fr-2015-elsevier
source_version: sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53
chunker_version: struct-v2
normalisation: nfkc-espace-v1
embedding_text_field: texte_indexable
language: fr
model: BAAI/bge-m3
model_revision: 5617a9f61b028005a4858fdac845db406aefb181
dimensions: 1024
max_tokens: 1024
activation_allowed: false
```

The machine-readable proposal is `knowledge/recette-embedding-struct-v2.json`. The pinned production recipe `knowledge/recette-embedding-pinee.json` is not modified and remains `struct-v1`.

## Required preflight

Before any model call, the job must verify:

- exact input artifact digest;
- exact source version and book ID;
- struct-v2 schema and required fields;
- `texte_indexable` as the sole text field;
- one-to-one chunk IDs and ordered input list;
- source-version repair decision;
- page-map approval;
- duplicate/fallback classification;
- short-fragment and `Â` review;
- table and cross-reference review disposition;
- model revision, dimensions, and token limit;
- quarantine separation from production output.

## Blockers

The current pinned loader/tests accept only `struct-v1` and `struct-v1.1`. The proposed recipe is not executable until code/tests/contracts are deliberately updated through the repository’s authority process. The 88 existing diagnostic vectors are not valid production evidence and must remain quarantined.

## No-write boundary

This proposal authorizes no model execution, PostgreSQL write, migration, Gate-C load, or knowledge activation. It is a contract proposal only.
