# P8 WRITER/LOADER AUDIT

**Status:** FRESH TARGET CONTRACT NOT YET AVAILABLE

## Current canonical path

- Writer: `scripts/remplir-embeddings-sql.mjs`; accepts only `struct-v1` and `struct-v1.1`.
- Chunk producer: `src/server/knowledge/decoupage.ts`; `struct-v1`, 8-character FNV-1a IDs.
- Source gate: `src/server/knowledge/ingestion.ts`; pure validation, no writer.
- SQL/door contract: `src/server/knowledge/stockage.ts`; schema 092 shape.
- Local recipe loader: `src/server/knowledge/embeddings-local.ts`; pinned `struct-v1`.
- Applied schema: `supabase/migrations/092_knowledge_rag.sql`.
- Active decision: ADR-039 closed chunker list `struct-v1`/`struct-v1.1`.

## Fresh rebuild finding

The previous `struct-v2` handoff and historical `build-v2` artifacts belong to the deleted prior run. They are not the current target and must not be restored, merged, or used to infer the six fresh session outputs.

No current combined six-book manifest, writer, loader, target database, or execution contract exists. The existing writer and loader remain unchanged and continue to reject any unapproved chunker.

## Tests

The read-only knowledge regression suite passed: **13 files, 202 tests**. No database-backed write test was run.

## Next

Wait for the six current per-book sessions. Collect their outputs only after the doctor has reviewed them, then determine the current writer/loader contract from the actual fresh artifacts.
