# P8 NEXT GATE

The current rebuild must remain unmerged until all of the following are true:

1. Each of the six current book sessions has completed independently.
2. The doctor has reviewed the output of each book session.
3. A per-book manifest exists for all six current outputs, with source identity, page provenance, artifact hash, status, and any quarantine decision.
4. The six-book source corpus is confirmed as 5,228 pages; OCR and page splitting are documented as preparation, not mistaken for chunk counts.
5. Sessions are merged only after the six reviewed manifests are available; no previous 17,131, 14,238, 14,079, or 15,666 figure is used as a target.
6. The current writer, loader, and database contract is selected from the fresh outputs; existing `struct-v1`/`struct-v1.1` behavior remains unchanged unless a separate decision is made.
7. A separate target database/environment is identified before any model or embedding work.
8. Only a later authorized block may verify the model/tokenizer, run a bounded canary, and perform embedding writes.

Current gate: **not passed**. The fresh rebuild is in progress; there is no current combined six-book target.
