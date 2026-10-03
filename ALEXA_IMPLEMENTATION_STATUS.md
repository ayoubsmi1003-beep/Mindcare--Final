# Alexa — implementation status, 2 October 2026

The presentation changes are implemented in the approved v7-design working checkout, based on 738977b. This is a synthetic development demonstration, not a clinical release certificate. The newest provider choice is Gemini Free tier for test patients only; all explicit OpenRouter free families were tested under the retained real-patient privacy policy.

Implemented:
- One authenticated local turn path for text and final local transcription, with cancellation, scope/revision checks and sourced events.
- Shared clinical engine reads the requested completed consultations directly, with deterministic date/ID ordering, current consultation separate and declared coverage. Current treatments and treatment history retain recorded dose, frequency and state.
- All five saved note areas are available locally: the separate working note and four SOAP fields. Draft/unsigned provenance is explicit. Whole fields up to 4,000 characters and 20,000 per consultation can appear in summary details; omitted fields are disclosed. Addenda and late qualifiers are retained. No clinical conclusions are invented from excerpts.
- The three consultation sliders update their local values without writing to Subjective or the working note. Existing historical note content is preserved.
- Case summary v4 uses the shared context, grouped diagnosis/treatment cards, five-area note details, sources and freshness. Older schemas remain readable.
- Natural French/Arabic/Darija/mixed routing separates named/possessive patient questions from general medication/book questions. Presence, follow-ups, patient ambiguity, counts, navigation and today's actual receipts are covered by regression tests.
- Governed lexical RAG removes question formulas, retains dose/population/restrictions, and uses closed multilingual aliases. Explicit unknown books and unsupported DSM editions fail closed. Whole approved excerpts retain their source version and lineage. OCR, chunking, embeddings and frozen vector policy are unchanged.
- Click starts local VAD capture; final transcription alone can execute a turn. Cancellation releases capture resources immediately and prevents late permission/module completion from installing an old session. Cloud speech endpoints remain disabled.

Verified current evidence:
- Installed PostgreSQL checkpoint: 27 PASS assertions in a rollback transaction, including all five notes, revision invalidation, roles, history and summary persistence.
- Final consolidated Alexa/cockpit/compatibility suite: **902 PASS in 56 files**, 169.82s, including Gemini transport, immediate bounded quota fallback, concurrent quota-state preservation, cancellation and streaming. Evidence: `.cache/alexa/presentation-final-verification.txt`. Transport fault injection is software evidence, separate from real provider qualification.
- Final application and scoped test TypeScript and changed-file lint passed. The independent follow-up review reproduced and verified the quota-race, cancellation and remaining-deadline fixes. Installer-content regressions: **7 PASS**, including development qualification cache exclusion.
- Real PostgreSQL RAG: 20 cases, with eight previously empty natural questions returning governed whole excerpts, canonical source/version checks and no patient or model calls. Unsupported DSM editions/unknown books issue zero retrieval calls; missing contraindication evidence remains honest absence.
- Real OpenRouter: 17 explicit free candidates attempted, zero qualified; 47/50 daily requests remaining. Per-model outcomes are in ALEXA_FREE_MODEL_EVALUATION.md.
- Real native Piper/Whisper smoke on this i3-4150/8 GB PC: French/Arabic generated speech in RAM produced nonempty transcription, numerical silence was rejected and cleanup passed. Isolated cold French TTS was 12.25s and STT 4.28s; Arabic TTS 4.88s and STT 3.69s. This is not a natural speech accuracy benchmark or P95.

The user confirmed Gemini's key belongs to a Free-tier project with no billing account linked and authorised synthetic patients. Real qualification at 2026-10-02T22:24:51.899Z passed for Gemini 3.5 and 3.1 Flash-Lite: streaming, multilingual structured output and source-bound synthetic clinical facts. Gemini 2.5 Flash-Lite was unavailable. Its data policy is incompatible with the real-patient no-collection/zero-retention requirement; runtime verifies PostgreSQL synthetic deployment before each provider call. Names, raw notes and audio remain local. On quota/rate limits, one already qualified free OpenRouter model can take over immediately within the remaining deadline, without waiting or probing. The current compliant OpenRouter pool has zero qualified models. No billing setting, environment file or paid fallback is changed.

Remaining limits:
- No microphone, natural 240+60 recordings or access to the doctor's i7/16 GB PC: real speech recognition accuracy, Darija, echo, interruption P95 and hardware qualification are NOT RUN. Always-on wake-word detection is not enabled; start by clicking the microphone.
- Clinical interpretation, diagnostic hypotheses and long-history batch synthesis are NOT DONE. Model prose is untrusted; only verified coded facts are rendered clinically.
- Actual Electron session and doctor acceptance are NOT RUN. Earlier installer/build evidence is stale for the newest changes until rebuilt.
- Historical full repository suite remains FAIL: 1,994 PASS, four assertions FAIL, three import-error suites and one explicit NOT RUN. Pre-existing communication/OCR test type errors remain outside this change. A scoped green suite does not erase them.

Migrations 120, 121 and 122 are applied and immutable. RLS, confirmation, locked records, corpus/OCR, STATE.md, archive, .env and fr.ts remain unchanged. No clinical write occurs without the existing confirmation path; summary saves remain derived content through the existing gate.
