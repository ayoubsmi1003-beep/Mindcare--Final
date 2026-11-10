# Claude Opus 5.5 — engineering handoff (working draft)

**STOP: the forensic audit and architecture review are not complete. Do not implement a redesign from this draft.** The user requested an audit first, review of the finished architecture, and only then implementation. This file preserves what has been established so far and identifies work still required. It is not a release or clinical acceptance.

## Mission and authority

MindCare OS is a local-first psychiatry practice application in Algiers. Alexa is an application-aware clinical assistant: deterministic, authorized data for patients, appointments and finances; governed evidence for medical knowledge; natural French/Arabic/Darija conversation; no fabricated capabilities or facts. The practitioner makes clinical decisions and explicitly confirms critical actions. Real patient identifiers and free records remain local; external evaluation uses only separately approved synthetic/non-identifying inputs.

First read the applicable `AGENTS.md`, `CLAUDE.md` §1 and closest task manifest; obey its `DO NOT LOAD` restrictions. Executable code/tests and applied migrations have the authority described in `docs/DOC-AUTHORITY.md`. Do not modify `STATE.md`, archived docs, applied migrations, `fr.ts` or large protected files without the required decision. Do not open or print secrets from environment files or `%ProgramData%\MindCare`. Never write synthetic records into a real patient database.

## Which code and build?

The audited worktree was `C:\MindCare\alexa-v8-final`, HEAD `b4bd811`, with numerous pre-existing changes and a deleted migration in `git status`; preserve them. The stated canonical path `C:\MindCare\Final mindcare` was absent when checked. Two existing artifacts, Program Files and `dist/doctor-next/win-unpacked`, have different archives/build IDs/source fingerprints despite the same declared commit `93bf185...`; see `25_PROVENANCE_DESKTOP.md`. No running instance, effective private configuration, database identity, live migrations or artifact provenance has been independently established. Do not copy one build over another or repair an installation as part of the audit.

## Read this audit in order

1. `00_ETAT_PARTIEL.md` — scope and evidence limits.
2. `02_CURRENT_ARCHITECTURE.md`, `03_ALEXA_CODEBASE_INVENTORY.md` — current pathways and owners.
3. `13_CARTOGRAPHIE_APPLICATION.md`, `14_DONNEES_ET_PREUVES.md`, `16_ANALYSE_ET_ACCUEIL.md`, `17_PATIENT_CONTEXTE_ET_RESUME.md`, `18_INDEX_ECRANS_CODE.md`, `19_INDEX_MODULES_ALEXA.md`, `24_INDEX_API.md`, `27_ECRANS_INVENTAIRE_JSX.md` — screens, schemas, modules and API navigation. Mechanical indexes are leads, not behavioral proof.
4. `04_ROUTING_AND_CONVERSATION_AUDIT.md`, `05_APPLICATION_INTELLIGENCE_AUDIT.md`, `06_RAG_FORENSIC_AUDIT.md`, `07_MODEL_AND_PROVIDER_AUDIT.md`, `08_SECURITY_AND_CLINICAL_INTEGRITY_AUDIT.md` — domain evidence and explicitly unverified areas.
5. `20_ECRANS_PATIENT_CONSULTATION.md`, `21_MESSAGERIE_ET_ENVOI.md`, `22_ACTIONS_CONFIRMATION_ET_INCERTITUDE.md`, `23_VOIX_ET_LATENCE.md`, `26_ACCUEIL_PARAMETRES_OBSERVABILITE.md`, `29_AGENDA_ET_PREMIER_LANCEMENT.md`, `30_ECRAN_FINANCES.md` — concrete findings, suspected risks and safe reproductions.
6. `09_TARGET_ALEXA_ARCHITECTURE.md`, `10_ALEXA_EVALUATION_PLAN.md`, `11_IMPLEMENTATION_ROADMAP.md` — draft target, evaluation and ordering, **not approved**.

## Current execution map

The text client `src/services/alexa-turn.ts` obtains a conversation and consumes SSE from `src/app/api/alexa/turn/route.ts`. The route selects `legacyAlexaTurn` unless `ALEXA_NATIVE_AGENT_ENABLED=1`; the native path claims a turn and calls `src/server/alexa/orchestrator.ts` `runAlexa`. Direct deterministic handling and `agent-loop.ts` `runAgentLoop` coexist. `src/shared/alexa/agent.ts` defines bounded parts and tools; `agent-tools.ts` executes validated reads via `alexaDb`/`clientSql` and the caller-scoped PG port. `knowledge-adapter.ts` connects governed lexical retrieval and optional vector/rerank to `knowledge-synthesis.ts`. `conversation-state.ts` and `agent-continuation.ts` bind references and cursors to scope and revision. Legacy and all action branches remain to be completely traced.

Important existing services to reuse and verify: patients and workspace (`src/services/patients.ts`, `patient-resolver.ts`, `clinical-context.ts`); statistics (`src/services/analyse.ts`, SQL `207`/`208`); finance (`finance-cash.ts`, `application-reads.ts`, SQL `180`); agenda and reception (`appointments.ts`, `reception.ts`); documents (`documents.ts`, `document-drafts.ts`); medication (`patient-treatments.ts`, `medication-workspace.ts`, `medication-phase2.ts`). Do not assume a screen's entire data is already exposed as an Alexa tool. `05_APPLICATION_INTELLIGENCE_AUDIT.md` lists initial mappings and gaps.

## Evidence-backed findings so far

- A synthetic React render showed `PatientProfilClinique` presents a null treatment domain as “Aucun traitement actif”. Current deployed reachability is unverified (`20`).
- A mocked communication route returned a provider refusal after requesting only the `sending` transition. SQL suggests a possible stuck state; actual DB commit and provider idempotence remain unverified (`21`).
- A synthetic fetch rejection through the real HTTP adapter made the action monitor report `echec / ECHEC_PORTE` rather than unknown, and bypassed its transport reconciliation branch. No real action was sent (`22`).
- A historical mixed RAG report recorded nine no-evidence results out of ten under lexical-only conditions; that is environment-specific and not reproduced here. Current runtime code gates vector and rerank paths, and current modified desktop source has packaged defaults; actual installed behavior is unknown (`06`, `25`).
- Two examined STT clients explicitly request French; the current TTS route refuses Arabic segments. This is a code limitation, not a measured recognition score (`23`).
- SQL statistics count newly created dossiers separately from distinct patients seen; their intersection must not be invented (`16`). Finance overview average counts collected payment rows, not automatically consultations delivered in the same period (`16`).
- Reception uses workstation-local date accessors for its initial day; an artificial UTC midnight test differs from the Algiers civil day (`26`). The actual workstation timezone is unknown.

## Security and change constraints

The model never grants access or obtains an unrestricted database connection. Use existing authenticated `withCaller`, audited SQL gates, RLS and role boundaries. Preserve explicit patient disambiguation, source revision, pagination, abstention and evidence provenance. Writes use existing proposal → human confirmation → execute → verify → log, with no automatic retry of uncertain clinical/financial effects. Verify current SQL and tests, not comments alone. `22` identifies an error/unknown mismatch that must be addressed in an independently reviewed fix; `21` identifies transport/state questions that require a fake provider and isolated DB.

Do not send patient or identifying content to Claude or any other external provider on the basis of model availability. The [official model page](https://platform.claude.com/docs/en/models/opus-5-5/overview) identifies `claude-opus-5-5`; provider availability, policy, pricing and organizational authorization must be checked separately. There is no authorization here to change provider, billing, residency, prompts, production code or configuration.

## Implementation sequence — conditional on completed audit and approval

Use `11_IMPLEMENTATION_ROADMAP.md`: (0) complete trace and inventory; (1) establish synthetic baselines and human-reviewed gold data; (2) fix confirmed integrity problems; (3) map/register actual capabilities; (4) improve scoped conversation and bounded multi-source planning; (5) improve retrieval/faithfulness based on measured failures; (6) evaluate task-based model routing without weakening privacy; (7) qualify voice and performance on real hardware; (8) verify the exact release artifact and obtain clinical/user acceptance. `28_GOLDEN_SYNTHETIQUE_BROUILLON.json` is an initial standalone 15-case draft with independently checked arithmetic, not an executed or complete golden suite. Each phase has exit evidence in the roadmap. Any database table/column/enum proposal goes through the decision process before migration authoring; applied migrations are immutable.

## First task

Read-only: verify the intended checkout and artifact, inspect `git status` and recent commits, compare source/build provenance without reading secrets, then identify a disposable synthetic target and existing test prerequisites. Return findings and the remaining audit gaps. Do not create migrations or touch patient data. The user must review the completed audit and architecture before any redesign implementation.

## Definition of done for this handoff

All 12 requested documents completed and mutually consistent; every screen/domain/API and critical SQL/voice/RAG path traced to evidence or explicitly marked unverified; source/build and permissions identified; ten genuinely confirmed problems and ten prioritized improvements supported by evidence; baselines and evaluation thresholds specified with measured values or explicit NOT RUN; unresolved decisions listed for the human; independent targeted verification and report of PASS/FAIL/NOT RUN. This draft does not meet that definition yet.
