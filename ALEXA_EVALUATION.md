# Alexa — verification and acceptance

> **Périmé pour la voix (2026-10-27).** Les mentions de moteurs vocaux
> ci-dessous sont historiques ; la pile active est faster-whisper small int8,
> Kokoro `ff_siwis` et Vosk (voir `resources/voix/README.md`).

## Continuation réelle — 5 octobre 2026

Les tableaux du 2 octobre ci-dessous restent historiques. La continuation explicite du but maître est active ; login/mot de passe sont résolus et hors du travail courant. Chaque nouvel appel modèle de cette réception part du compositeur visible du navigateur, sans mock ni réponse injectée.

| Réception actuelle | Résultat | Preuve et limite |
|---|---|---|
| Réponses publiques FR/AR/EN, saisons/photosynthèse | PASS échantillons | Réponses réelles vues ; échecs antérieurs conservés ; darija surtout arabe standard PARTIAL |
| Agenda du jour + encaissements | PASS lecture | Deux parties vues, chiffres cohérents avec le tableau de bord |
| Agenda de demain + demandes à confirmer | PASS portée | Deux parties explicitement au 06/10/2026 ; listes vides ; screenshot16 |
| Agenda non vide / prochain patient | PASS lecture | Deux rendez-vous existants le03/10 ; retour au jour courant après la question de demain |
| Dates ambiguës/modifiées | PASS sûreté, PARTIAL présentation | Pas de substitution semaine→aujourd’hui ou après-demain arabe→demain ; copie spécifique en réception |
| RAG protégé | PASS récupération | SQL123 appliqué,113migrations vérifiées ; RLS forcée conservée ; bonne section DSM complète |
| Synthèse DSM réelle | PARTIAL complétude | Aperçu IA sourcé avec citations littérales visibles ; liste des symptômes omise ; instruction de complétude en réception |
| Hamilton / édition absente DSM-5-TR | PASS abstention | « Aucune preuve suffisante dans les sources approuvées » ; aucune explication inventée |
| Compilation et contrôles ciblés | PASS tranche de lecture | TypeScript,lint,build ; nouveaux ajustements de rendu/prompt suivis dans les plans du5octobre |
| Compréhension sémantique globale, synthèses individuelles/longitudinales, voix acoustique | NOT DONE / NOT RUN | Le but maître n’est pas terminé et aucune perfection n’est annoncée |

Preuves : `artifacts/alexa-free-routing-2026-10-04/RESULTS.md` et `browser/runtime-2026-10-05.json`. Plans : `docs/superpowers/plans/2026-10-05-alexa-rag-browser.md` et `2026-10-05-alexa-agenda-browser.md`. Aucun corpus, golden, donnée clinique ou rendez-vous n’a été modifié pour obtenir un PASS. La migration123 appliquée est immuable.

## Snapshot historique du 2 octobre

Snapshot: approved v7-design checkout based on 738977b, 2 October 2026. Results below distinguish actual external calls, real PostgreSQL/browser execution and code tests. A provider catalogue, synthetic engine sample or successful build does not prove clinical release or microphone accuracy.

| Check | Result | Evidence |
|---|---|---|
| Final scoped Alexa/cockpit/compatibility suite | PASS | 902 tests / 56 files / 169.82s; .cache/alexa/presentation-final-verification.txt |
| Free-model policy and quota reread | PASS | 42 tests / 4 files; actual RED for a second probe after quota fell to five, then GREEN; independent actual-function review agrees |
| Gemini quota fallback, cancellation and concurrent state | PASS | Immediate quota/rate fallback capped at one OpenRouter attempt, remaining deadline, partial-stream no retry, source/value rejection and preserved concurrent account pause; included in final suite; transport fault injection |
| Final application/scoped test types and changed-file lint | PASS | presentation-app-typecheck.txt, presentation-test-typecheck.txt, presentation-lint.txt |
| Installer content checker | PASS software regression | Seven actual content-checker regressions, including exclusion of development caches and provider proofs |
| Installed local PostgreSQL / RLS / five-note context | PASS | 27 assertions, scripts/checkpoint-alexa-context.sql, transaction rolled back; migrations120/121/122 applied and immutable |
| Actual governed lexical RAG | PASS | 20 cases, eight formerly empty natural questions now return whole approved excerpts; exact source/version/whole-chunk checks, zero patient/model calls; knowledge-readiness-result.json |
| All explicit OpenRouter free candidates | FAIL qualification | Real transport for 17 candidates, zero qualified; quota47/3/50; ALEXA_FREE_MODEL_EVALUATION.md |
| Gemini Free-tier small models | PASS synthetic qualification | Real streaming/multilingual/clinical source-bound probes passed for 3.5 and 3.1 Flash-Lite; 2.5 unavailable; 2026-10-02T22:24:51.899Z; no real-patient eligibility or known remaining quota |
| Local Piper/Whisper engine smoke | PASS smoke only | Real pinned engines, generated French/Arabic speech in RAM, nonempty STT and numerical silence rejection; voice-engine-smoke.json |
| Fresh production build / assembly | NOT RUN | Required after Gemini source freeze |
| Fresh summary/sliders/book UI | NOT RUN | Required on the new production build; earlier browser evidence remains historical |
| Electron TypeScript | PASS | Fresh compiler exit0, presentation-electron-typecheck.txt |
| Fresh installer / final package contents | NOT RUN | Previous installer completed but predates five-note, slider, RAG and Gemini changes |
| Actual Electron session | NOT RUN | No native UI acceptance recorded |
| Real microphone, WER/CER, Darija and i7 performance | NOT RUN | User has no microphone/corpus; target doctor's PC is separate |
| Doctor acceptance | NOT RUN | No natural-session acceptance yet |
| Historical full repository suite | FAIL | 1,994 PASS / 4 FAIL / 3 import-error suites / 1 explicit NOT RUN; 168 files,162.74s; repository-unit-final.txt |

The historical assertions are in jarvis-conversation-multitour (two), jarvis-boucle-routage and jarvis-runid-route. Import errors are in connaissance-activation-r3, connaissance-taylor-chargeur and connaissance-taylor-v2, on unchanged knowledge scripts. Pre-existing communication/OCR test type errors also remain. Their results were not removed or rewritten to claim repository-wide green.

Final scoped test selection includes every Alexa unit file, configured-model/Jev/summary/context compatibility, workspace contract and the three consultation cockpit regression files. Use one worker and no file parallelism on this8GBPC. Exact final counts belong to the resulting verification log. Fault-injection tests execute real logic against artificial dependencies; they do not count as external-provider, PostgreSQL, browser or voice acceptance.

| Acceptance gate | Current conclusion |
|---|---|
| A Architecture / contracts | PASS written architecture, with explicit synthetic Gemini exception |
| B Free provider / no paid fallback | OpenRouter FAIL actual qualification; two Gemini Flash-Lite models PASS real synthetic probes, synthetic deployment only |
| C Identity / scope / memory | PASS code and prior real keyboard checks; spoken identities and clinician workflow NOT RUN |
| D History / treatments / five notes | PASS installed27PostgreSQL checks and code; newest UI pending |
| E Privacy / sources | PASS immutable coded projection, source/value validation and runtime development restriction; no raw notes/audio/name export authorised |
| F Clinical intelligence / case summary | PASS sourced record presentation; FAIL full note interpretation, hypotheses and long batch synthesis, which are not implemented |
| G Governed knowledge | PASS real retrieval/provenance checks; clinician relevance/medical answer-quality acceptance NOT RUN |
| H Voice / performance | PASS software lifecycle and native synthetic smoke; NOT RUN microphone/benchmark/doctorhardware |
| I Application / failures | Fresh build/UI/package pending; full repository FAIL; actual Electron NOT RUN |
| J Doctor acceptance | NOT RUN |

No gate is silently skipped. This remains an incomplete clinical qualification under the free-only requirement until the required real voice, privacy, reliability and clinician acceptance evidence exists.

## 20 October 2026 — MiniCPM French 100-case application evaluation

| Gate | Result | Evidence |
|---|---|---|
| French synthetic 100-case run | **90 PASS / 10 FAIL** | Run 175b43a9-0442-4a11-b257-91f943534122; report .eval-out/alexa-agent/minicpm-app-mc001-100-full-2026-10-20.json |
| Application/tool cases in this manifest | **90 PASS** | Passing questions and answers: outputs/ALEXA_90_PASSED_QUESTIONS_AND_ANSWERS.md |
| General knowledge | **FAIL (10/10)** | MC001–MC010; exact questions and reasons are in the report and handoff |
| Fresh baseline | **NOT RUN** | No before/after improvement claim is supported |
| Browser/Electron/real voice/doctor acceptance | **NOT RUN** | Not covered by this synthetic evaluator run |

The fixture is synthetic and the text model is the installed local MiniCPM. This result does not qualify every application read or action and does not establish production or clinical readiness. Do not weaken factual assertions to convert the ten general-knowledge failures to PASS.


## 20 October 2026 — MiniCPM French 100-case grounded re-run

| Gate | Result | Evidence |
|---|---|---|
| French synthetic 100-case run | **100 PASS / 0 FAIL / 0 PARTIAL / 0 NOT RUN** | Run d0a61f31-e595-4697-a445-015008bc7f87; raw report .eval-out/alexa-agent/minicpm-app-mc001-100-grounded-100-2026-10-20.json |
| Tool selection / valid arguments | **108/108 / 108/108** | All attempted calls matched the permitted tool and validated on first attempt |
| Requested-part identification / accounting | **145/145 / 145/145** | Exact independent expected manifests; no silent outcome omissions |
| Material filter preservation | **49/49** | All material predicates asserted by this manifest were preserved |
| Unsupported success claims | **0** | Evaluator counter |
| Fresh baseline | **NOT RUN** | No before/after claim supported |
| Browser, desktop, real voice, doctor acceptance | **NOT RUN** | Outside this server/synthetic evaluation |

The run covers 90 synthetic application/navigation cases and 10 general factual cases. The latter use ten local source-linked fact cards; unmatched questions still route to local MiniCPM. This demonstrates only the listed test questions and assertions, not general-purpose accuracy. No business write calls were made. Privacy/manual/voice evaluator gates remain NOT RUN. The earlier 90/100 report above is retained as historical evidence.

The focused final checks passed: 77/77 unit tests across the local-reference, general-tool, and evaluator suites; `pnpm exec tsc --noEmit --pretty false` exited 0; and the 100-case evaluator passed all assertions. The full repository run (`pnpm test --maxWorkers=1 --no-file-parallelism`) was **NOT GREEN**: 3,732 passed, 19 failed, 105 skipped, across 306 files, with one Vitest worker timeout. A later sequential rerun of the 10 previously reported Alexa files produced 196 passed and 15 failed tests across 8 files; the MiniCPM protocol and turn-ownership files passed on rerun. Afterward, the patient-scope root cause was fixed and that full file passed 5/5; a fresh rerun of those 10 files now reports 198 passed and 14 failed across seven files, with the patient-scope, MiniCPM protocol, and turn-ownership files passing. Keep both suite results visible; the focused 100/100 result does not override the unresolved broader failures.

## 20 October 2026 — Fresh 100-case rerun after patient-scope fix

| Gate | Result | Evidence |
|---|---|---|
| French synthetic 100-case run | **100 PASS / 0 FAIL / 0 PARTIAL / 0 NOT RUN** | Run 0215b88e-faa5-406d-afd8-28ed8bfae4e8; report .eval-out/alexa-agent/minicpm-app-mc001-100-after-scope-fix-2026-10-20.json |
| Tool selection / valid arguments | **108/108 / 108/108** | Current run metrics |
| Requested-part identification / accounting | **145/145 / 145/145** | Independently authored manifest |
| Material filter preservation | **49/49** | Current run metrics |
| Business write calls | **0** | Synthetic evaluation record |
| Patient identity scope regression | **PASS, 5/5 tests** | `alexa-part-patient-scope.test.ts`; named part stays bound despite stale global patient name |
| Focused tests / TypeScript | **82/82 / PASS** | Four Alexa unit files; `pnpm exec tsc --noEmit --pretty false` exit 0 |
| Proposal/action controls | **18/18 PASS** | Four focused suites for action catalogue, proposal, editable action, and reconciliation |
| Fresh baseline | **NOT RUN** | No before/after claim supported |

The answer text for all 100 cases is identical to the preceding 100/100 run; the Q&A document now points to this fresh report. The evaluator preflight confirmed the disposable synthetic database and zero approved knowledge rows. The 18 action-control tests are unit-level checks; the evaluation itself made no business writes. This does not establish browser, production RLS, real voice, or doctor acceptance. The latest sequential rerun of the ten previously failing Alexa files produced 198 passed and 14 failed across seven files. The full repository test suite has not been rerun after the patient-scope fix and remains an open gate.
