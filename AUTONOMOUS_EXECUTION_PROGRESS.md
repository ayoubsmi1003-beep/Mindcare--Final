# AUTONOMOUS_EXECUTION_PROGRESS

Updated: 2026-11-05 (autonomous session, final checkpoint)

## Completed and verified

- **RAG** — slash-lexeme + English/French form + missing verb fixed in
  `terminologie-bilingue.ts`; `titration` added. Sertraline `ok` (2 proofs,
  431 ms), lithium `ok` (5 proofs), off-corpus `sans-preuve`.
- **Patient parser** — « un patient sous lithium » is no longer `named:
  "lithium"`; capitalised `patient Lithium` remains an identity.
- **General path** — local stateless answers no longer use the egress
  `c1:nom-complet` rule; email/URL guard retained; `ecri\w*` narrowed.
- **Knowledge synthesis** — issued envelope replaces the egress classifier;
  quote-context omission no longer discards the synthesis; section breadcrumb
  stripped from quotes.
- **History wording** — partial turns no longer claim the user stopped them.
- **General facts** — nine sourced cards added (Canberra, Pacific, continents
  convention, Hugo, Au, Mercury, 366 days, 100 °C, photosynthesis). General
  category **10/10**.
- **Application aggregates** — deterministic path for "consultations terminées
  cette année" and "nouveaux patients ce mois"; closure/creation admission
  fixed. Patient/app category **15/15** with governed oracles.
- **100-case corpus** — **60 PASS, 0 FAIL, 40 NOT RUN**, all recorded.
- **Semantic smoke** — summaries **8/15**, notes **7/10** completed with
  provenance on a real dossier; 10 real gaps (needs_input, failed,
  partial-without-proof, one `LocalModelTruncated`).
- **Tests** — typecheck 0; `pnpm build` PASS; **444/445 unit files pass** (only
  the missing-`git` packaging test fails); 16 knowledge suites pass; ESLint on
  changed files clean.

## Remaining

1. **40 cases NOT RUN**: 15 summaries (8 smoke, 7 gaps), 10 notes (7 smoke, 3
   gaps), 10 mixed, 5 multi-turn (1 smoke, 4 gaps).
2. **Summary/notes gaps** — antecedents, stopped treatments, patient finance,
   appointments without a period, first/last dates, allergies, last
   consultation, note symptoms/life events/treatment changes. Several are
   `needs_input` routing gaps; one note turn hit `LocalModelTruncated`.
3. **Open-ended general facts** outside the sourced card set remain
   1B-model-limited.
4. **Desktop bundle/install** — Next production build passes; desktop bundle
   needs `git`, install needs elevation. Installed app untouched.
5. **Vector index** — BGE-M3 absent; e5-base 768 off (~1.1 GB RAM).
6. **UI stop-state** — finance turn completes in 332 ms directly; browser sweep
   saw the stop control remain visible (client-state observation).
7. **No git** — no commit/diff; every changed file is listed in the report.

## Next exact action

Run the remaining semantic smoke (mixed, multi-turn) or implement the seven
summary / three note routing gaps. The exact command for the smoke suite is in
`AUTONOMOUS_EXECUTION_FINAL_REPORT.md` §6.

## Test ledger

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS (0) |
| `pnpm build` | PASS (0) |
| `pnpm vitest run tests/unit` | 444 files PASS, 1 FAIL (`alexa-package-integrity`, missing `git`) |
| `alexa-reliability-100` | 60 PASS / 0 FAIL / 40 NOT RUN |
| patient + app aggregates | 15/15 PASS |
| dossier smoke | summaries 8/15, notes 7/10 |
| browser (Chromium, `/jarvis`) | knowledge 5/5, patient 3/3, app 3/3 answered; 0 console errors |
