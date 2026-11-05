# AUTONOMOUS_EXECUTION_PLAN — Alexa reliability

Scope authorised by the user: repair Alexa on the existing repository, keep
MiniCPM/llama.cpp (no Ollama), read-only access to the cabinet database, build
the desktop bundle but **do not install** it.

## A. Knowledge retrieval (Gate D)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| A1 | Fix the slash-lexeme and verb-form gaps in the bilingual terminology | `readKnowledge` returns `ok` for sertraline precautions and lithium monitoring; off-corpus still `sans-preuve` | DONE, verified |
| A2 | Regression tests for A1 | 3 tests pass: trace, full reader, e2e | DONE |
| A3 | Route generic medication questions correctly (1B router + patient parser) | « Comment surveiller un patient sous lithium ? » calls `search_knowledge` | DONE: `parsePatientMention` fixed; deterministic shortcut removed (it changed the synthesis path) | 
| A4 | Remove the section breadcrumb from extractive quotes | Sertraline quote starts with the clinical sentence, not `Sertraline › …` | DONE, verified |

## B. General answers (Gate E/UX)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| B1 | Stop applying the egress `c1:nom-complet` heuristic to local stateless answers | « Quelle est la capitale de l'Australie ? » completes with « C'est Canberra… » | DONE, verified |
| B2 | Unit regression for B1 | 6 tests pass (benign facts accepted, clinical/contact refused) | DONE |

## C. Status honesty (UX)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| C1 | A partial/limited turn must not be labelled « Réponse arrêtée à votre demande » | history uses a neutral partial wording; no user blame | DONE, pending typecheck |

## D. Validation

| ID | Task | Acceptance | Status |
|---|---|---|---|
| D1 | `pnpm typecheck` | exit 0 | PENDING (re-run) |
| D2 | Unit suite | no new failure beyond the known missing-`git` packaging test | PENDING (re-run) |
| D3 | Living HTTP/browser checks | sign-in + `/api/alexa/turn` + three reference questions | DONE: signed-in Chromium, no console errors, three answers rendered |
| D4 | 100-case read-only evaluation | exactly 100 cases, statuses PASS/FAIL/BLOCKED/NOT RUN | DONE: 45 PASS, 7 FAIL, 48 NOT RUN (all recorded) |

## E. Packaging

| ID | Task | Acceptance | Status |
|---|---|---|---|
| E1 | Build the desktop bundle with the repository scripts | `pnpm build` succeeds (Next production) | DONE for Next build; desktop bundle blocked by missing `git` |
| E2 | Install under `C:\Program Files` | **not authorised** — hand the elevated command to the user | BLOCKED (human) |

## F. Documentation

| ID | Task | Acceptance | Status |
|---|---|---|---|
| F1 | `docs/alexa-reliability-2026-11-04.md` | root causes, fix, measures, rollback | DONE (update at end) |
| F2 | `AUTONOMOUS_EXECUTION_FINAL_REPORT.md` | full evidence, honest limitations | PENDING |

## Known external blockers

- `git.exe` is absent: no diff/commit/rollback; source snapshots only.
- `%ProgramData%\MindCare` and `C:\Program Files` writes require elevation.
- No disposable evaluation database may be created (user rule); all data tests
  are read-only against `127.0.0.1:55441/mindcare`.
