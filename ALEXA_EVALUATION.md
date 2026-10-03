# Alexa — verification and acceptance

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
