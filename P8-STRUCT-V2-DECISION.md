# P8 STRUCT-V2 CONTRACT DECISION

**Decision:** No current P8 target chunk contract exists yet.

The previous `struct-v2` handoff and historical `build-v2` artifacts belong to the deleted prior run. They are not the current target and must not be restored, merged, or used to infer the six fresh book-session outputs.

## Current evidence

- Current executable code, applied migrations, and tests still define `struct-v1`/`struct-v1.1`.
- The current writer rejects `struct-v2`.
- The current rebuild has six independent sessions and a fixed source corpus of 5,228 pages.
- No current combined six-book manifest, chunk count, eligible count, quarantine count, or target database exists.

## Action

Do not update the writer or loader. Do not compare the fresh work to the deleted previous run. Wait for all six current book sessions, collect their per-book manifests after doctor review, and determine the execution contract from those actual fresh artifacts.

No writer, loader, database, embedding, migration, or activation was changed.
