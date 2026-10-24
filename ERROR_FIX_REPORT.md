# Error repair verification — 2026-10-07

## Confirmed causes and fixes

- The screenshot identifies extension-owned `bis_skin_checked` and `bis_register` attributes on Next's hidden layout wrapper. A development-only `beforeInteractive` script removes precisely those two attributes, including inserted nodes. It does not suppress hydration diagnostics or alter application attributes. Installed Next 15.5.22 bootstrapping runs these scripts before `hydrateRoot`.
- CLI hashbangs (`#!`) survived Vite SSR transformation after prepended imports, causing three knowledge test suites to fail with `SyntaxError`. A pre-transform strips the hashbang only in the test loader; executable scripts retain it. Native Node imports and transformed imports are separately verified.
- Whole knowledge passages were compared with a byte budget using character counts. The adapter now measures UTF-8 bytes and retains the existing all-or-nothing omission behavior. Arabic coverage verifies that a passage below the character limit can exceed the byte limit.
- Removing punctuation from continuation text left trailing whitespace. `Et avant ?` now matches the existing bounded continuation grammar.
- Conversation proposal guards accessed `window` before entering error handling during non-browser execution. A nullable pathname preserves browser scope checks and permits the tested non-browser path.
- Existing nullable provenance and generic RPC test fixtures, discriminated-union assertions and provider refusal fields were corrected without relaxing application schemas.
- Older tests were aligned with verified current contracts: dated agenda reads use `list_agenda`, private clinical answers remain local, only free model preferences are accepted, and explicit requests are not chained from unrelated earlier intents. Stale-source, changed-scope, denied-read and no-write assertions remain covered.
- Lint excludes generated Next verification output and transient cache files. Node CLI `createRequire` is allowed in scripts while application and Supabase restrictions remain active. The named legacy database rollback harness receives the same explicit database-import exception used by other integration harnesses.

## Verification

- Initial full audit: 13 failed files, 32 failed tests, 2739 passing tests, 93 skipped tests; full test typing failed and lint reported 39 errors / 1 warning.
- Focused loader, knowledge and conversation regressions: 75 PASS.
- Focused runtime and previously failing lint paths: PASS.
- Development page HTTP response serves the exact compatibility script and is not a Next server error page.
- Full test suite: 211 files passed, 18 skipped; 2800 tests passed, 93 skipped.
- Both TypeScript projects and full lint: PASS.
- Final hydration, RPC boundary, safe database diagnostics and no-write guards: 15 focused tests PASS.
- Authenticated local HTTP checks: all four reported RPCs returned HTTP 200 / ok=true across three parallel rounds (12 calls, 118–704 ms). No response patient values or credentials were printed.
- Embedded browser: Documents reloaded, existing Belkacem Nadia prescription opened, console error log empty.
- Fresh production build: PASS. Application restarted with `pnpm start` on localhost:3000; normal origin and database guards passed.
- Production runtime: login and all 12 repeated authenticated RPC checks PASS. Documents loaded with an empty browser console error log.

## Limits

The embedded browser initially timed out during heavy development compilation and the full audit, then recovered. The exact extension-injected Chrome hydration symptom has not been reproduced in Chrome; its two observed attributes are covered by the compatibility regression. Intermittent session/startup 503s occurred during compilation/load and cleared afterwards. Server logs include connection failures and PostgreSQL statement timeout 57014. Safe diagnostics now identify known pg connection timeout messages and preserve technical codes through the startup wrapper, without logging raw SQL/messages/credentials. The startup guard passes with all 129 migrations present. No timeout bound, schema guard, session check or authorization boundary was bypassed or weakened. Skipped integration tests are not live database acceptance. The successful runtime checks do not guarantee availability while the machine is overloaded.


## Issuance confirmation and print discoverability follow-up

- Reproduced the old confirmation: a fixed DIV with no backdrop/focus containment; both buttons had transparent backgrounds and 0px padding.
- Replaced the three document confirmations with a native modal dialog, centered in the browser top layer, with a backdrop, distinct buttons, keyboard focus and Escape dismissal. The issuance default focus is Fermer; closing remains blocked only while the operation is processing.
- Draft action now says Emettre pour imprimer; the confirmation explains where Imprimer appears. Successful issuance selects the Emis library tab and opens the frozen document with its prominent Imprimer action.
- Both TypeScript projects, focused lint and isolated production build PASS.
- Live browser: existing synthetic Belkacem Nadia prescription issued as DOC-2026-00067. Confirmed the native modal, 480px centered layout, colored/padded buttons and Escape dismissal. Confirmation closed after issuance; Imprimer was visible and enabled. Clicked Imprimer, cancelled the print check with Escape, and the application remained usable with no console errors. No paper print was requested.
- Screenshots: issuance-confirmation-fixed.jpg and issued-print-visible.jpg in this task's visualization directory.

## Automatic document header number follow-up

- User clarified that N° d’Ordre means a unique number per document. Removed the proposed manual physician-number control.
- Migration 140 uses the existing atomic document counter and renders its allocated DOC-YYYY-NNNNN number into the new issued header. Drafts show an em dash until issuance. Retrying the same draft returns its original piece and number.
- Patient/date header increased from 8pt to 9.5pt, line-height 1.45, in the shared preview/print stylesheet.
- Encrypted backup was restored into mindcare_documents_header_backup_20261007. Initial parallel HNSW creation exceeded Docker shared memory; serial restoration completed. Restored documents match the active database fingerprint: 8:51d2d36cff22149a64136ea8aae8aaf5.
- Isolated SQL issuance checkpoint PASS, including two distinct serials, matching header numbers, immutable issued HTML hashes, stale preview rejection and idempotent retry.
- Migration applied to the active database; all eight existing document HTML/hash records retained the same fingerprint. Normal schema/startup guard PASS. TypeScript projects PASS; scoped diff whitespace check PASS.
