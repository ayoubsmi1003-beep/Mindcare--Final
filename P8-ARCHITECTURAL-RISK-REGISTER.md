# P8 ARCHITECTURAL RISK REGISTER

## CRITICAL NOW

- **Session merge risk:** six current sessions work independently. Never merge their outputs automatically or infer one book's count for another.
- **Prior-run contamination risk:** 17,131, 14,238, 14,079, and 15,666 are deleted-prior-run or historical figures. They are not the fresh target.
- **Wrong-database write risk:** `mc-p3` contains a prior `struct-v1` corpus. Never write to it for the fresh rebuild.
- **Credential boundary:** do not repair credentials or expose secrets as part of P8.
- **Activation boundary:** no source or chunk activation may occur during the fresh rebuild.
- **Doctor review boundary:** each book result requires doctor review before the six are reconciled.

## HIGH PRIORITY

- Preserve per-book session identity, source hashes, page provenance, and artifact hashes.
- Keep OCR and page splitting separate from chunk-count decisions.
- Reconcile the six reviewed manifests only after all sessions finish.
- Add a read-only target inventory before selecting a writer, loader, or database.

## NOT NEEDED

- No restoration or reuse of the deleted previous work.
- No model, embedding, migration, or activation work now.
- No deletion, relabeling, or repair of the historical `mc-p3` data.
- No automatic cross-session merge.
