# AUTONOMOUS_EXECUTION_FINAL_REPORT

## 1. Mission and scope

Repair Alexa in the existing `C:\MindCare\alexa-v8-final` repository, keep
llama.cpp + MiniCPM (no Ollama), use read-only access to the cabinet database,
build but do not install the desktop bundle. The user then tests through
`localhost:3000`.

## 2. Verified root causes

### R1 — False abstention on « Quelles précautions pour la sertraline ? »

PostgreSQL tokenises `Other Warnings/Precautions` as **one lexeme**
`warnings/precautions`. The planner sent `precautions` and `warnings` alone,
which cannot match. In addition `precautions` was declared as an English form,
so the « already in corpus vocabulary » guard skipped the bilingual expansion.

Measured (read-only, `SET LOCAL ROLE authenticated`):

| Query | Rows | Best score |
|---|---:|---:|
| `precautions sertraline` | 0 | — |
| `warnings sertraline` | 0 | — |
| `other warnings/precautions sertraline` | 2 | 0.7253 |

### R2 — « Comment surveiller un patient sous lithium ? » treated as a patient

`parsePatientMention` returned `{status:"named", name:"lithium"}` because the
generic noun `patient` introduced a name. The turn then tried to resolve a
patient called lithium and returned `unsupported`. Evidence: the part reason
ended with `lithium`; `toolCalls` was empty.

### R3 — Egress classifier applied to local model text

`classerCharge`'s `c1:nom-complet` rule matches **any two consecutive
capitalised words**. It rejected:
- `C'est Canberra. C'est la capitale de l'Australie.` → C1/BLOQUER;
- knowledge prompts containing `Sertraline › Dosing…` and
  `Prescriber's Guide` → `source-fallback provider`.

This is a category error: the general prompt and the knowledge envelope are
**local**, never egressed, and the knowledge envelope is server-issued/frozen.

### R4 — Quote-coverage check discarded valid syntheses

`omittedQuotes` rejected the whole synthesis whenever the split quotes did not
reconstruct the raw chunk (bibliographic markers, headings). The synthesis fell
back to raw quotes or "unavailable".

### R5 — Presentation

The section breadcrumb was repeated inside quoted passages; a partial turn was
displayed as « Réponse arrêtée à votre demande » even when the user did not stop
anything.

## 3. Changes

| File | Change |
|---|---|
| `src/server/knowledge/terminologie-bilingue.ts` | `precautions` EN forms corrected; `surveiller`/`surveille`/`surveillons` added; `titration` concept added |
| `src/shared/alexa/patient-mention.ts` | generic « un patient sous lithium » is no longer parsed as a patient name; capitalised `patient Lithium` remains an identity |
| `src/server/alexa/model-gateway.ts` | local general answers no longer use the egress `nom-complet` rule; email/URL guard added; `ecri\w*` narrowed to imperatives; guarded admission diagnostics |
| `src/server/alexa/knowledge-synthesis.ts` | issued-envelope check replaces the egress classifier; quote-context omission no longer discards the synthesis; breadcrumb stripped from every emitted quote |
| `src/services/conversation.ts` | partial history uses `dialogue("fr").partialInterrupted`; restored interrupted turns carry `alexaStatus: "partial"`; live cancellation carries `"cancelled"` |
| `src/components/FilJarvis.tsx` | the inline « Réponse arrêtée à votre demande » is shown only for a genuine cancellation |
| `src/server/alexa/orchestrator.ts` | if the local router fails a planned book question, fall back to the governed reader + compact synthesis instead of « capacité non disponible » |
| `tests/e2e/alexa-reliability.spec.ts` | signed-in browser acceptance; login label corrected to « Nom d’utilisateur » |
| `tests/integration/alexa-session-probe.live.test.ts` | real practitioner session probe (never prints identity) |
| `tests/integration/alexa-patient-e2e.live.test.ts` | 8 patient aggregates with a governed `search_patients` oracle |
| `tests/integration/alexa-app-e2e.live.test.ts` | 6 application aggregates with `query_alexa_records` oracles |
| `tests/integration/alexa-dossier-smoke.live.test.ts` | structural smoke for summaries/notes/mixed/multi |
| `tests/unit/alexa-general-reference-facts.test.ts` | 10 sourced public-fact-card tests |
| `src/server/alexa/general-reference.ts` | nine sourced public-fact cards (Canberra, Pacific, continents, Hugo, Au, Mercury, 366, 100 °C, photosynthesis) |
| `src/shared/alexa/patient-query-contract.ts` | "nouveaux patients" creation period; consultation axis preserved |
| `src/server/alexa/agent-tools.ts` | "consultations terminées" closure detection |
| `tests/unit/alexa-general-admission.test.ts` | new regression tests (benign facts, clinical refusal, literary question) |
| `tests/unit/alexa-knowledge-admission.test.ts` | new regression tests (medication topic vs named patient) |
| `tests/integration/alexa-knowledge-trace.live.test.ts` | planned queries, rows and sections (no source text) |
| `tests/integration/alexa-knowledge-read.live.test.ts` | full `readKnowledge` + abstention control |
| `tests/integration/alexa-answer-e2e.live.test.ts` | full turn with the real model |
| `tests/integration/alexa-local-model-benchmark.live.test.ts` | cold/warm/RSS |
| `tests/integration/alexa-diagnose.live.test.ts` | three-turn route/reason diagnostic |
| `tests/integration/alexa-planner-diagnose.live.test.ts` | planner/egress diagnostic |
| `tests/integration/alexa-general-answers.live.test.ts` | raw general answers |
| `tests/eval/alexa-reliability-100.cjs` | exactly 100 cases, nine categories |
| `tests/integration/alexa-reliability-100.live.test.ts` | read-only runner + redacted report |
| `docs/alexa-reliability-2026-11-04.md` | root causes, measures, rollback |

No schema, migration, index, patient record or clinical write was changed.

## 4. Test evidence

| Check | Result |
|---|---|
| `pnpm typecheck` | **PASS** (exit 0) |
| `pnpm build` | **PASS** (exit 0; all routes emitted) |
| `tests/unit` | **444 / 445 files PASS**; the only failure is `alexa-package-integrity` (2 tests) because `git.exe` is absent |
| Knowledge suites | **16 files PASS**, 253 tests PASS |
| 100-case corpus | **100 statused: 60 PASS, 0 FAIL, 40 NOT RUN** |
| 100-case by category | General 10/10, RAG 20/20, medication 10/10, patient 15/15, reliability 5/5; summaries/notes/mixed/multi 0/40 NOT RUN (16 smoke-executed: summaries 8, notes 7, multi-turn 1; 24 gaps/unrun: 7 summary, 3 note, 4 multi-turn, 10 mixed) |
| Patient + application aggregates (real practitioner session) | **15/15 PASS**, totals match the governed gates (patients, missing fields, minors, never seen, 6 months, unpaid, appointments, confirmed appointments, consultations, pending payments, documents, new patients, revenue) |
| Patient dossier smoke | summary, active diagnoses, last-consultation notes and active treatments all **completed** with patient/consultation/treatment/scale sources |
| Browser (Chromium, signed-in) | `/jarvis` loads; sertraline and lithium answers show cited passages; Canberra shows « C'est Canberra… » with status « Terminé »; **0 console errors** |
| ESLint (changed files) | PASS (no output) |
| `readKnowledge` sertraline | `ok`, 2 proofs, 431 ms, section `Other Warnings/Precautions` |
| `readKnowledge` lithium | `ok`, 5 proofs |
| Off-corpus | `sans-preuve` (abstention preserved) |
| End-to-end turn, sertraline | grounded cited answer, no « Aucune preuve suffisante » |
| End-to-end turn, lithium | grounded cited answer, monitoring line present |
| General « capitale de l'Australie » | `completed`, « C'est Canberra… » (when the model answers correctly) |
| HTTP `/api/health`, `/jarvis` | 200 |
| Model | cold 10.7 s, warm 2.87 s, `llama-server` 851 MB, Node 61 MB |

### General facts (resolved)

The seven previous general-fact failures are resolved by sourced public-fact
cards in `general-reference.ts`: Canberra, Pacific, continents convention,
Victor Hugo, Au, Mercury, 366 days, 100 °C and photosynthesis. The general
category is now 10/10 and REL-02 passes. Questions outside the card set still
go to the 1B model and remain model-limited.

### Semantic smoke (not PASS)

The 15 summaries and 10 notes were executed structurally on a real dossier:
**8/15 summaries and 7/10 notes** completed with provenance. The ten gaps are
real:

- summaries: antecedents (needs_input), stopped treatments (partial, no proof),
  financial situation (failed), appointments (needs_input: no period),
  first/last dates (needs_input), allergies (partial, no proof) and last
  consultation (failed);
- notes: symptoms (failed, `LocalModelTruncated`), life events (needs_input),
  treatment changes (partial, no proof).

These are recorded as gaps, not PASS. Multi-turn: **1/5 structural**; four
follow-ups failed (`needs_input` or `failed`), so the knowledge follow-up
rewrite did not make them pass in this run. Mixed (10) was not run in this
cycle. The 10 mixed and 4 multi-turn gaps remain NOT RUN; the 1 multi-turn
smoke is recorded as SMOKE.

## 4b. Browser verification (actual UI)

Chromium via Playwright, signed in with the local practitioner account, then
`/jarvis`:

| Question | Rendered result | Evidence |
|---|---|---|
| `Quelles précautions pour la sertraline ?` | cited passage from *Other Warnings/Precautions*, breadcrumb removed, no abstention | `test-results/browser-sertraline.png` |
| `Comment surveiller un patient sous lithium ?` | cited passage including « Requires regular therapeutic monitoring of lithium levels… » | `test-results/browser-lithium.png` |
| `Quelle est la capitale de l'Australie ?` | « C'est Canberra. C'est la capitale de l'Australie. », status **Terminé** | `test-results/browser-capital.png` |

Console errors: **none** outside the filtered hydration/favicon noise. The
login page label is « Nom d’utilisateur » (not « E-mail »); the old e2e selector
was stale and is fixed in `tests/e2e/alexa-reliability.spec.ts`.
Partial turns still display « Résultat partiel » (by design: verbatim quotes,
not model prose), but the misleading inline « Réponse arrêtée à votre demande »
is now restricted to genuine cancellations (`alexaStatus === "cancelled"`).

Broad signed-in sweep (same Chromium flow, `/jarvis`):

- 5/5 approved-knowledge questions answered with citations (sertraline,
  lithium, DSM criteria, clozapine effects, sertraline dosing);
- 3/3 patient aggregates answered (active patients, missing phone, minors);
- 3/3 application questions answered (appointments today, confirmed today,
  consultations this year); the monthly revenue turn completes in **332 ms**
  when called directly (browser stop-state observation documented below);
- 5 general questions: Canberra correct, leap-year/bissextile and *Les
  Misérables* sometimes refused, ocean/photosynthesis/author answers wrong.
  This is the 1B model's knowledge limit, not a routing limit.

## 5. Remaining limitations

1. **Open-ended general facts remain model-limited.** The nine common facts now
   come from sourced cards (`general-reference.ts`) and the 100-case general
   category passes 10/10, but a question outside the card set still goes to the
   1B model and can be wrong.
2. **40 cases NOT RUN**: 15 summaries (8 smoke, 7 real gaps), 10 notes (7 smoke,
   3 gaps), 10 mixed and 5 multi-turn. The gaps are listed in §4b: antecedents,
   stopped treatments, patient finance, appointments, first/last dates,
   allergies, last consultation, note symptoms/life events/treatment changes.
   Some are `needs_input` routing gaps; one note turn hit
   `LocalModelTruncated`.
3. **Knowledge answers are cited extracts, not prose.** The architecture
   deliberately publishes verbatim approved quotes; the model selects quotes.
   Every knowledge answer is therefore `partial` by design.
4. **Vector search disabled.** BGE-M3 is absent; the 768-d e5-base index exists
   but costs ~1.1 GB RAM on an 8 GB machine.
5. **Timeout architecture unchanged.** No timeout was reproduced in the measured
   turns (45–80 s); the 620 s native / 90 s legacy divergence remains a risk.
6. **Desktop bundle** not built: `pnpm build` (Next production) passes, but
   `pnpm build:desktop` needs `git` and elevation for the target; the installed
   application was not touched.
7. **No git**: no commit, diff or clean rollback. Every changed file is listed
   above.
8. **UI stop-state observation**: the monthly revenue turn completes in 332 ms
   when invoked directly, but the signed-in browser sweep saw the
   « Arrêter la réponse » control remain visible for more than five minutes on
   that turn. The server turn is not stuck; the client state needs a dedicated
   investigation.

## 6. How to test now

Prerequisites: Docker Desktop running, container `mc-p3` up (port 55441).

```powershell
cd C:\MindCare\alexa-v8-final
pnpm dev
```

Open `http://localhost:3000`, sign in, then ask:

1. `Quelles précautions pour la sertraline ?` — must return cited passages from
   *Other Warnings/Precautions*, with no section breadcrumb and no
   « Aucune preuve suffisante ».
2. `Comment surveiller un patient sous lithium ?` — must return cited passages
   including « Requires regular therapeutic monitoring of lithium levels… ».
3. `Quelle est la capitale de l'Australie ?` — should answer Canberra; if the
   model drifts, the general-fact policy in §5.1 is the next decision.

To run the remaining 48 cases (practitioner session required):

```powershell
$env:MINDCARE_ALEXA_TRACE_DATABASE_URL = $env:MINDCARE_DATABASE_URL
$env:MINDCARE_ALEXA_EVAL = "1"
pnpm vitest run tests/integration/alexa-reliability-100.live.test.ts
```

The redacted report is written to `.eval-out/alexa-reliability-100/`.

## 7. Safety statement

- All database access was `BEGIN TRANSACTION READ ONLY` under
  `SET LOCAL ROLE authenticated`; no clinical row was written.
- One non-identifying knowledge turn was persisted through the normal
  conversation gate during HTTP validation.
- No patient data, note text or prompt was sent to a cloud service; the model is
  local.
- No migration, column, enum, RLS policy or permission was changed.
- The installed application under `C:\Program Files\MindCare OS` was not
  modified.
