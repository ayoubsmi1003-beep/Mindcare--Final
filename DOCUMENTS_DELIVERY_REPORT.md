# Documents — delivery and verification, 7 October 2026

Implemented in G:/Final mindcare, v7-design. The doctor-approved A5 certificate rendering is preserved. Latest user amendment replaces the rich prescription form with exactly two fields per medicine: name and daily count. The explicit count renders as “N fois par jour”; no dose is inferred. Catalogue selection is optional and manual name changes clear its binding.

The screen now uses a compact draft/issued library, a patient heading, one primary action, automatic saving and canonical preview refresh. Duplication, archive, regeneration and history live under “Autres actions”; advanced formatting lives under “Mise en forme”. Prescription ordering buttons and optional dosing fields are removed from the main workflow per the user's latest instruction.

## Verification

- PASS: 41 focused unit tests covering closed content, civil dates, save state, service responses, RPC envelope, pagination fragments and the two-field prescription mapping.
- PASS: all eight actual PostgreSQL integration tests with MINDCARE_DOCUMENTS_CHECKPOINT=1: clinical access, draft revisions, immutable issue, stale identity/hash rejection, simultaneous issue, prescription linkage, revision creation, four original template text compatibility and ordered-list fragments.
- PASS: fresh isolated replay of migrations 128–139 with seven transactional checkpoints; encrypted backup, real restore and original document fingerprint comparison.
- PASS: final application TypeScript check and scoped lint after the three review fixes and UX refinement. Final isolated production build PASS (25 pages). Build configuration skips lint/type checks, so those are checked separately.
- PASS: real signed-in browser, existing synthetic patient P-1016: two prescription inputs, automatic saving, preview “2 fois par jour”, issuance DOC-2026-00066 and reopening the immutable piece. Existing suivi DOC-2026-00065 verified in issued list.
- PASS earlier browser: justification save/reload/issue/reopen, print request audit/iframe cleanup, mental certificate issue. A5 measured 559.36 × 793.69 CSS px, one header and no overflow for checked sample.
- PARTIAL: intermittent local database session 503 and browser timeouts under development compilation; saved draft retained and issued prescription subsequently reopened. No security/timeouts bypass was introduced.
- NOT RUN: physical paper output, full latest mobile/keyboard/Arabic long-document browser acceptance matrix. Native print dialogue previously opened and closed by the user.
- FAIL outside Documents: full repository test run had 32 failures, 2734 passes and 92 skips in existing Alexa/Jarvis/knowledge tests. Full lint had 693 errors and one warning including generated output and existing tests; these were not repaired in this scope.

## Review

One independent read-only final review found three Important issues, all addressed: pause input during issued-document transitions; refuse snapshot errors instead of silently selecting the legacy print layout; ignore stale draft recovery responses. No Critical issue reported. These fixes are source-reviewed with scoped checks; a slow-request browser race reproduction remains NOT RUN.

## Local deployment and preservation

Migrations 128–139 are applied to the active local database after the backup and isolated replay. Applied migrations are not rewritten. The correction to pending 129 occurred before its first active application, with 136 retained as forward repair for the earlier disposable test database. Existing numbered pieces remain immutable and new versions create separate drafts. No treatment is silently activated by issuing a prescription.

Encrypted backup and its Windows DPAPI key remain in the ignored .superpowers/sdd/2026-10-07-documents-editor folder. Unrelated Alexa/Electron/legacy work is preserved. No merge, push or publishing was requested.
