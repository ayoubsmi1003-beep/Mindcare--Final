# Alexa free pool execution ledger

Plan: approved in this chat, 2026-09-30. Baseline: `baseline.patch`, `baseline/`, and `baseline-status.txt`.

- Ruling: implement in the requested dirty `v7-design` checkout, with targeted backups; do not merge or replace the earlier Alexa worktrees.
- Constraints: free-only OpenRouter; C1/C2 remain local; existing SQL authorization and confirmation unchanged; no migration or source activation; no changes to fr.ts.
- Tasks: 1 baseline/reproduction; 2 pool/gateway; 3 local operations/voice/RAG; 4 live qualification/regressions; 5 documentation/report.
- Baseline targeted tests: 53/53 PASS. Full baseline and local database guard running.
- Shared interfaces: pool returns eligible model IDs and metadata to the existing gateway; gateway returns actual inference metadata to audit callers; local voice preserves existing route envelopes.
- Final verdict requires real-provider, DB, source, and hardware evidence. Simulated voice is not hardware qualification.
