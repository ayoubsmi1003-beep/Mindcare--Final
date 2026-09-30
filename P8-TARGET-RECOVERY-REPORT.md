# P8 TARGET STATUS

**Status:** FRESH SIX-BOOK REBUILD IN PROGRESS

The only fixed current invariant is:

- **6 books**
- **5,228 source pages**
- OCR and page splitting are current preparation steps, not a fixed chunk target.

Each current session works on one book. Sessions are independent; the agent will not merge their outputs automatically. The doctor reviews each book result.

The previous run was deleted before this rebuild. These figures are historical context only and must not be reused as the current target:

- 17,131 historical Gate-C chunks
- 14,238 historical file units
- 14,079 prior DSM-5 `struct-v2` handoff chunks
- 15,666 prior `mc-p3` `struct-v1` chunks

There is currently no combined six-book manifest, chunk count, eligible count, quarantine count, or activation state. After all six current sessions finish, collect their per-book manifests and reconcile them once.

**Safety:** no files restored, no database writes, no model calls, no embeddings, no migrations, and no activation.
