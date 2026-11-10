# Executive audit — working draft

**Status: INCOMPLETE / NOT APPROVED.** These findings are scoped to the evidence cited. This is not a claim that the complete repository, installed application, security model or clinical performance has been qualified. The remaining evidence and missing work are listed below and in the linked documents. No redesign has been implemented.

## Current position

The repository already contains an Alexa orchestration layer, deterministic and model-assisted routing, typed tools, patient-resolution checks, governed knowledge retrieval, local models, action confirmation and a broad practice application. Their existence does not prove their production activation or their correctness on a particular question. The audited worktree and two desktop artifacts are different states; see `02_CURRENT_ARCHITECTURE.md` and `25_PROVENANCE_DESKTOP.md`.

The main engineering direction is to preserve the existing modular monolith and database authority, define the real capability and data contracts, measure failures on isolated synthetic cases and approved reference material, and repair demonstrated root causes before broadening conversational behavior. The target design is a proposal in `09_TARGET_ALEXA_ARCHITECTURE.md`, not an approved implementation.

## Ten important confirmed observations

“Confirmed” below refers to the stated source behavior or specifically described test, not to a production incident. Items 5–9 are confirmed product limitations, not claims that every input fails.

1. **An unavailable treatment field can display as an absence.** A synthetic rendering with `traitementsV2: null` returned “Aucun traitement actif” (`20_ECRANS_PATIENT_CONSULTATION.md`). Current installed reachability is unverified.
2. **A lost HTTP response can be classified as a definite action failure.** The real client adapter plus a mocked rejected `fetch` produced `echec / ECHEC_PORTE`, bypassing the transport reconciliation branch (`22_ACTIONS_CONFIRMATION_ET_INCERTITUDE.md`). Whether a real action had committed was not tested.
3. **A provider refusal leaves no later state transition in the communication route.** A mocked call returned 422 after only `sending`; the SQL/transaction analysis indicates a possible persistent stuck state (`21_MESSAGERIE_ET_ENVOI.md`). Actual database persistence is unverified.
4. **Reception's initial date depends on the workstation timezone.** In a synthetic UTC example at an Algiers midnight boundary the selected date differed from `Africa/Algiers` (`26_ACCUEIL_PARAMETRES_OBSERVABILITE.md`). Actual workstation settings are unverified.
5. **Both inspected STT clients explicitly request French.** The endpoint supports other modes, but those clients send `langue: 'fr'`; recognition accuracy for mixed speech was not measured (`23_VOIX_ET_LATENCE.md`).
6. **The inspected TTS route rejects Arabic segments.** Arabic voice output is therefore not provided by that route; actual device behavior is untested (`23`).
7. **The observed local response path buffers generation.** The local completion request uses `stream: false`, the client combines batches, and the direct voice loop waits for the response before speech. SSE stages do not establish incremental token-to-speech (`07`, `23`).
8. **Some oldest-consultation requests are explicitly unsupported.** `agent-tools.ts` refuses the applicable `requestsOldestConsultations` branch rather than silently answering with recent visits (`04_ROUTING_AND_CONVERSATION_AUDIT.md`).
9. **A global document-body search is not generally available through the inspected Alexa branch.** The executor explicitly refuses the relevant body-search request without a selected document (`04`, `05`). Other document reads exist.
10. **A recorded mixed RAG run often had no selected knowledge evidence.** The prior repository audit reports nine of ten cases in its lexical-only process (`06_RAG_FORENSIC_AUDIT.md`). This observation has not been reproduced here and must not be extrapolated to all configurations.

## Ten recommended improvements, in dependency order

1. Verify source/build identity, current installed path and synthetic test isolation before touching runtime data.
2. Separate unavailable treatment data from a confirmed empty treatment list.
3. Treat lost action responses as unknown until actor-bound reconciliation and effect verification establish an outcome; never automatically replay uncertain writes.
4. Make communication refusal, delivery idempotency and uncertain external outcomes explicit and test them with a simulated provider and isolated database.
5. Derive reception's current civil date in `Africa/Algiers` and test midnight/timezone boundaries.
6. Complete a capability matrix grounded in actual SQL gates, authorized roles, data fields and business definitions, including unsupported operations.
7. Improve bounded conversation references and multi-step plans only where a synthetic multi-turn baseline shows gaps; preserve cohort, period, patient and source revision.
8. Measure the actual approved RAG corpus, compatible embeddings, lexical/vector fusion and reranker before changing models; maintain source provenance and clinical meaning across languages.
9. Qualify multilingual STT/TTS, interruption and latency on the target hardware; speak only validated content and report unavailable language modes honestly.
10. Establish a versioned evaluation and release gate with reviewed deterministic oracles, clinician review, per-role security tests and explicit PASS/FAIL/NOT RUN.

## Dependencies and proposed sequence

Finish source/SQL/screen tracing → identify the authoritative build and isolate synthetic evaluation → establish baseline → review and fix integrity findings → define capability contracts → improve conversation and mixed requests → qualify RAG and model routing → qualify physical voice and the exact release. `11_IMPLEMENTATION_ROADMAP.md` provides phase-level dependencies. This is a review draft; product implementation requires the completed audit and user review.

**First task for Claude:** a read-only source/artifact and synthetic-environment identity checkpoint, then complete missing evidence in this audit. Do not apply migrations, modify production or export patient information. See `12_CLAUDE_OPUS_HANDOFF.md`.

## Human decisions still open

Choose the authoritative checkout and delivery artifact; ratify definitions for new/seen patients and financial metrics; review clinical safety and target-language priorities; decide whether and under which policy any external provider could ever process patient-derived data; agree quantitative acceptance thresholds and clinician review; approve any schema additions, migration or change outside the authorized audit scope.

## Verification and gaps

Several targeted unit-test batches passed, as recorded in the specialized files; they use controlled fixtures and mocks. The synthetic reproductions establish the particular branches only. **NOT RUN:** complete route/screen and SQL-policy trace; actual migration/role verification; approved-book OCR and embedding coverage; RAG golden baseline; natural multilingual voice and hardware latency; clinical acceptance; second-PC/reboot release validation. These gaps prevent a claim that the application or Alexa is production-ready.
