# EMBEDDING-RESUME-HARDENING

**Status:** reconciled handoff contract / implementation not executed  
**Approval record:** `STRUCT-V2-APPROVAL-RECORD.json`  
**Current state:** approved as the handoff contract; no resume or embedding execution occurred.  

## Resume invariant

A resume may continue only when the checkpoint and input prove the same ordered job. The minimum checkpoint identity is:

- input artifact path and SHA-256;
- book ID and full source version;
- chunker version and normalisation;
- recipe ID and model revision;
- embedding text field;
- dimensions and maximum token limit;
- ordered chunk IDs;
- completed chunk IDs;
- failed chunk IDs and error class;
- atomic checkpoint generation.

A checkpoint with missing fields, stale input, duplicate IDs, unknown IDs, reordered input, incompatible recipe, or a bounded-run `termine` flag is invalid. A bounded run is not a complete run.

## One-to-one proof

Before accepting a resumed row, verify that its `chunk_id` belongs to the current input, its text hash and text field match the frozen chunk, its source version matches, its vector length equals 1024, and every value is finite. Any row failing these checks is quarantined and recomputed; it is never silently skipped or overwritten.

## Atomic checkpoint protocol

1. Acquire a single-writer lock bound to the input digest and recipe.
2. Read the checkpoint and validate its full identity.
3. Validate all existing rows before selecting the next ID.
4. Process only the next approved ID.
5. Write the new row to a temporary file.
6. Flush and atomically rename the output.
7. Atomically replace the checkpoint with the new completed set and generation.
8. On failure, retain the last valid checkpoint and record the failed ID without advancing completion.

A process crash may leave a temporary file, but it may not leave a partially trusted production row or an advanced completion count.

## Quarantine

Existing 88 vectors are stored separately as diagnostic evidence. They must not be selected as a resume source merely because their IDs exist. The current manifest is stale: it reports 16 writes while the JSONL contains 88 rows. Any future resume must use a new checkpoint and an explicit migration decision, not the stale manifest.

## Completion

Completion requires all approved chunk IDs to have exactly one validated vector, no unclassified failures, an atomic final checkpoint, and a human approval boundary. Completion is not inferred from a timer, a bounded batch, a model response, or a local file write.

## Current decision

The current repository script lacks sufficient compatibility, full-row validation, and atomic checkpoint guarantees for this contract. It is not used by this task and is not declared safe for production.
