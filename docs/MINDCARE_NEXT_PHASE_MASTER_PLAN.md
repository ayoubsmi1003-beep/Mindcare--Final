# MindCare OS — Next Phase Master Plan

```yaml
phase: "NEXT_PHASE"
current_mission: "M10-cockpit"
current_status: "READY"
last_updated: "2026-09-18"
architecture_status: "loop+registry+egress operational, M01 intents + M02 reference resolution behind refusal gate, M03 ContextAssembler (ratified 2026-09-15), M04 intent router + tool_call_id (COMPLETE 2026-09-15), M05 egress local-first firewall (COMPLETE 2026-09-15), M06 approval guard + execution monitor + response guard (COMPLETE 2026-09-16, NEG-1 9/9 on scratch base), M07 knowledge hybrid-live A3 (COMPLETE 2026-09-17, E1 44/46 accepte), M09 COMPLETE 2026-09-18 (reliquat : 097/098/099, v2 + approbations, UI inspection, voir §23)"
product_status: "V9 cockpit-tabs green, Alexa propose-only, J2-E manual writes ROUGE (still NOT RUN: needs live app + human)"
ai_status: "NLU intents + multi-turn resolution + ContextAssembler + egress firewall + approval guard live (0 new LLM calls for patient data), replay observability offline (simulate/observe/compare) + run history persisted + live v2 seam (tour + approval fingerprints, OFF by default)"
rag_status: "M07 COMPLETE 2026-09-17 (acceptée E1 44/46) : corpus 6 sources / 15666 chunks, portes 092/093 live, hybrid-live A3 cable (2 gaps safe-direction + parite-pin) ; R0 integral non atteint (tension golden prouvee)"
security_status: "M05 local-first ENFORCED + M06 execution single-path (execute by actionId only, tentatives:0, unverified never announced); zero C1/C2 external bytes proven at boundary; M09 tables hashes/metrics-only, RLS owner/practitioner, operator-only writes"
evaluation_status: "M08 gate PASS 2560/0/28 (exit 0, re-run M09-reliquat 2026-09-18) ; M09 replay fresh simulate VERT ; 12 evals Jarvis directes VERT (frontiere/boucle/ecritures/registre/sans-suppression-7-7/injection/routage/v2/intentions-47/conversation-256/chaine-28/briefs) ; vitest FULL 1223 PASS ; E2E observabilite 5/5 ; checkpoint-m09-097 PASS (RLS 3 roles, purge, retention) ; NEG-1 9/9 on scratch base (dropped after); knowledge-DB lexical 100/107, hybride-A3 105/107, smoke P9.1 NOT RUN (pas d'UI touchee)"
next_action: "M10-cockpit (READY — M09 COMPLETE, voir record §23)"
```

> Living execution state. Every implementation session must update `current_mission`, `current_status`, `last_updated`, Completed/Deferred/Known-Problems before ending. Code + tests beat this doc on any contradiction (see `ARCHITECTURE.md` Écarts).

## 0. Mission / North Star

Local-first AI-native psychiatric practice OS. The psychiatrist speaks naturally (French, Darija, Algerian Arabic); Jarvis understands, retrieves governed facts, proposes — the doctor confirms, Postgres executes, audit records. Patient data stays in the cabinet. Architecture stays a maintainable modular monolith: Next.js 15 + local PostgreSQL 16 + Electron. No LangChain, no external vector DB, no microservices without a demonstrated need.

Doctor test: no command manual; « Alexa, qui vient après Karim ? » → « Il est arrivé ? » → « Prépare-moi sa consultation. » all understood, correct patient, honest failures, zero silent wrong-patient actions.

## 1. Current Reality (verified 2026-09-14, exploratory reads + 2 codebase probes)

- **Layers** (`ARCHITECTURE.md:8-18`): UI (`app/*/page.tsx`) → Services (45, incl. `jarvis-*`×12) → `DbPort` (`services/db/port.ts`: select/rpc/auth/provision) → `/api/*` (13 routes, no `/v1/`) → `frontiere.ts` + `allowlist.generated.ts` (74 RPC) → `withCaller/withAuthGate/withEgressGate` → `PgDataPort` → 165 `app.*` doors (RLS decides, `FOR UPDATE` ×45, `trg_audit`) → Kernel Jarvis (`server/jarvis/*`, no I/O) → egress UNIQUE (`server/egress/external-call.ts`) → OpenRouter/Groq/ElevenLabs.
- **Jarvis runtime:** deterministic `classer()` (`src/shared/jarvis/routing.ts` + `normalisation.ts` + `lexique-multilingue.ts`) → prompts v3.1 (`api/jarvis/jarvis-chat/prompt.ts`) → OpenRouter `google/gemini-2.5-flash` → registries 22 reads (`services/jarvis-capacites.ts:992`) + 7 writes (`services/jarvis-ecritures.ts:567`) → loop `jarvis-boucle.ts` (MAX_TOURS_OUTIL 3, MAX_APPELS 6, MAX_OCTETS 24000, 20s/60s, 1 écriture/tour) → SSE client (`services/jarvis.ts`, watchdogs 15s, JSON fallback). Legacy `jarvis-tools.ts` + `jarvis.ts` frozen, do not extend.
- **Context/memory:** `assemblerAmorce()` (Algiers time + RefPatient + consultationOuverte + ~2Ko agenda) + `preparerPourLeModele()` (mask→verify); single-patient anchor, TTL 15min, `058_jarvis_conversations` persisted turns; active patient `adopterPatientActif()` exists. No named ContextAssembler, no long-term/vector memory (by design — DB is source of truth).
- **Security:** egress unique, double guard (client names / gateway tel+mail patterns), stable tokens resolved post-model, `garderVoix()` requires `VOICE_PROVIDER=cloud` AND `is_cloud_dev()` fail-closed, RLS + `app_gatekeeper`, `audit.boundary_crossings` per call. Known residues: free-text chat + cloud-dev re-toggle (see `ARCHITECTURE.md:49`).
- **DB:** 87 migration files 001→089 (031/035 absent); never edit applied files. Key doors: `search_patients`/`get_patient` (017–020), workspace (047/048/053/056/057/089), consultations/notes (026/027/032/037), agenda (022–025/046), finance (029/036/038–040), documents (030/043/045/061/088), Jarvis propose/confirm/execute (033/063) + conversations (058), dashboard (059/060), treatments (073–076/078–081), local auth (070), egress gatekeeper (071).
- **Tests:** ~37 unit (vitest, no DB) + 4 integration (need `MINDCARE_TEST_DATABASE_URL`, else NOT RUN) + 19 e2e (Playwright, need `pnpm start`+`/api/health`) + 18 `scripts/eval-jarvis-*.mjs` offline. `eval:jarvis` VERT; e2e 103/103 (2026-09-08). J2-E manual writes ROUGE (known). `tests/MAP.md` is stale (counts drifted) — do not trust counts, trust runs.
- **Missing:** structured LLM intents, hybrid search, pgvector, reranker, OTel/dashboard observability, golden multilingual NLU suite, RAG eval.
- **Human decisions pending:** DOC-AUTHORITY D-17 (Supabase Cloud dev) superseded by local pg (commit `e841955`) — ratification wait; vague-question denial behavior (« can u tell me abt patients ? ») — declined twice by prompt edits, needs routing fix or accepted fail-safe (STATE.md 2026-09-03).

## 2. New Phase Definition

Approach A (approved): incremental hardening. Keep loop+registry+gates green; add LLM understanding behind the firewall; formalize context; enforce local-first egress; then full RAG. Vertical missions, each shippable + eval-guarded. No rewrites, no opportunistic refactors (AGENTS.md budget rule).

Locked user decisions: egress **local-first** · first slice **NLU + intents** · RAG **full (pgvector + hybrid + reranker)** in-phase · plan lives here (new file).

## 3. Architecture Target

```text
DOCTOR → Alexa → LLM → structured intent → validation → Context+Conversation
→ Tool Router → Patient/Agenda/Finance/Consultation/Docs capabilities
→ MindCare services → PostgreSQL (CABINET DATA)
```

Knowledge: question → context → hybrid search → reranker (20→5) → evidence → LLM. Sensitive: Alexa proposes → doctor confirms → governed service executes → audit. External: only C3-after-approved-transform or C4 crosses the egress boundary (never raw or pseudonymized C1/C2).

## 4. AI Architecture

- `LLMProvider` interface (task routing: intent fast / summary stronger / reasoning strongest; begin with fewest models). Structured outputs + function/tool calling, timeouts/retry (transient only), fallback, health. Design for future local LLM swap without touching Alexa.
- Token/context budgeting; prompt versions hashed + written to audit trace (follow v3.1 precedent).

## 5. Jarvis Architecture

ReAct-lite internal orchestration (reason → tool → observe → answer), no LangChain. Keeps: `classer()` as fail-safe pre-filter, loop budgets, SSE protocol (`chemin/delta/attente/fin/erreur`), single-write-per-turn, honest named failures (never invent). Adds: M01 intent layer, M02 conversation, M03 assembler, M06 guard+monitor.

## 6. Agent Architecture

Small bounded set sharing one capability registry (voice Jarvis, text Jarvis, Ctrl-K, future agents — same tools): orchestration, consultation-prep, admin/agenda, finance-intel, document-draft, comms (draft-only; send structurally impossible until channels exist: `canal: null`, `envoye: false` literals). Each: identity, purpose, permissions, context scope, tools, success criteria, failure behavior. No unrestricted inter-agent access.

## 7. Context Architecture

`ContextAssembler`: question → required info → minimal retrieval → prioritize → build. Inputs: active patient/consultation, recent consultations, treatment, appointments, relevant docs/finance, conversation history, tool results. Minimal, relevant, traceable, scoped, token-efficient. Formalizes `assemblerAmorce`+`preparerPourLeModele`, not a parallel system.

## 8. Memory Architecture

Conversation (short-term) + working (task/session) + doctor preferences (long-term, non-clinical). No second EMR: clinical facts stay in patient record. Unified interface only if it grows.

## 9. Knowledge / RAG Architecture

Ingestion (references, protocols, cabinet knowledge) → semantic/structural chunking (section/recommendation/step, never blind fixed windows) + metadata (entry, version, section path) → embeddings (provider abstraction, local-capable, versioned, re-embed strategy) → pgvector. No Pinecone/Chroma/FAISS/Neo4j.

## 10. Retrieval / Hybrid / Reranking

Lexical (exact « sertraline 50 mg ») + vector (semantic « anxiété persistante malgré traitement ») + metadata filter (lang, type, version, status). Top-20 → local cross-encoder (bge-reranker-v2-m3 family or better fitting runtime) → top-5 → LLM with evidence (source/section/version/excerpt). Doctor distinguishes patient data vs approved knowledge vs AI interpretation.

## 11. Ontology

Smallest useful layer first: medication catalog exists (073/082) → ATC mapping; ICD-10 diagnoses exist → keep code-first; SNOMED/LOINC deferred until a retrieval/decision-support need proves itself.

## 12. Knowledge Graph — conditional

Postgres relations only, while sufficient. Apache AGE later if relationship reasoning proves value. Never Neo4j for fashion.

## 13. MCP / Integrations

Governed adapter under the tool layer, least-privilege, explicit registration, scoped, egress-controlled, confirmation for sensitive, audited. Internal logic stays authoritative. No patient data to external MCP servers.

## 14. Security / Data Sovereignty (non-negotiable)

Local-first: patient data → local inference; else de-identify per explicit policy; else block. Data classes C1–C4 are defined in `docs/AI_EVOLUTION_AUDIT.md` (AI DATA CLASSIFICATION): C1/C2 local-only, C3 external only after approved transform, C4 permitted. Chain: doctor → Alexa → LLM → tool firewall → service → DB. LLM never authorizes, never SQL, never bypasses app. Patient text = DATA (delimited, cannot close its own envelope — eval scenario M). Secrets server-only, never `NEXT_PUBLIC_*`, never terminal. Prove: scan LLM requests/logs/telemetry/errors/analytics/MCP/client bundle for patient leakage.

## 15. AI Evaluation

Golden suite categories: patient nav, agenda, consultation, treatment, finance, documents, conversation/pronouns, ambiguity (3 Mohameds → clarify), FR/Darija/Arabic/mixed/typos/voice-errors, security (injection, cross-patient, escalation, exfiltration), tool-failure honesty, grounding/hallucination. Each test: input, expected intent/tool/args/clarification/security. Regression on any model/prompt/tool/routing/retrieval/chunk/rerank change. RAG: recall/precision/ranking/reranker-gain/citation correctness (RAGAS concepts, no framework cult).

## 16. AI Observability / Debugging

AI run record: input, intent, context used, tools+args+results, retrieval candidates + rerank, evidence, model+version, latency/tokens/cost, approvals, errors. Trace inspection + replay + prompt/model comparison. OTel/GenAI conventions if useful; no external SaaS conflicting with local-first (evaluate Langfuse-like locally, do not adopt blindly).

## 17. Clinical UX

Consultation cockpit 3-col (patient | séance SOAP | context: previous/treatment/timeline/docs), previous consultations inline by date, treatment ACTIVE/PAUSED/STOPPED/HISTORY with dose/frequency/start/changes. Zero-AI résumé tab stays (works with gateway down — V9 Lot B precedent, O4 test). Minimal scroll, no duplicated info.

## 18. Premium UI/UX

White/light, MindCare blue, subtle gradients/glow, strong hierarchy, categorical chart colors (V9 Lot E fix locked by `jetons-graphes.test.ts`: 6 distinct families, ≥120° hue). French UI via `src/i18n/`, tokens in `tokens.css` only. Ctrl-K universal surface on the same capability registry. No dark-first, no card-grid noise, no generic AI slop.

## 19. Implementation Phases → 20. Missions

Statuses: NOT_STARTED · READY · IN_PROGRESS · BLOCKED · COMPLETE · DEFERRED. Priority: P0 foundational · P1 core · P2 enhancement · P3 future.

Bounded file inventory per mission is normative in `docs/AI_EVOLUTION_AUDIT.md` (§ FILES TO MODIFY / NOT TO MODIFY, incl. the `jarvis.ts` additive-fields exception for M02/M03 only) — missions here do not broaden it. Cross-references like §36, §40/§41, §54, §57 point to the source evolution brief's sections (example tests, agenda/finance questions, daily-workflow checklist, security acceptance), not to sections of this plan.

### M00 — Foundation audit & alignment (P0, READY → IN_PROGRESS on start)
- Objective: write `docs/AI_EVOLUTION_AUDIT.md`, ground every claim.
- Why: no speculative refactoring; know the real flow first.
- Dependencies: none. Files: read-only (services, server/jarvis, shared/jarvis, routes, migrations 033/058/063/071, evals, tests/MAP.md).
- Steps: map doctor→Alexa→model→routing→tool→DB→result→response; inventory tools (defined vs allowlist-exposed); egress map; test inventory; weaknesses; files to modify / not modify.
- Tests: re-reads only; cite file+line or migration number per claim.
- Acceptance: audit exists, every section CLAIM → EVIDENCE, no implementation.
- Risks: doc-fiction; mitigate by `rg` + targeted reads.
- DoD: `docs/AI_EVOLUTION_AUDIT.md` complete, M01 unblocked. Status: READY.

### M01 — Structured NLU intents (P0, READY after M00)
- Objective: LLM produces validated `Intent{name,entities,references,confidence,missingInformation}`; app validates before tool selection. « Qui vient après Karim ? » → `GET_NEXT_PATIENT{patientName:Karim}`.
- Why now: first engineering slice; unlocks natural FR/Darija/Arabic and unblocks every later mission. Intent layer is testable without touching doors or cloud policy.
- Dependencies: M00.
- Current reality: deterministic `classer()` regex only; no intent schema; paraphrase fragility; vague-question denial unfixable by prompt.
- Target state: intent JSON schema + validator; LLM classifier behind `classer()` fail-safe (regex stays, disagreements fall back safe); tool selection consumes validated intents only.
- In scope: schema, validator, classifier wiring, FR/Darija/Arabic fixtures (typos/voice errors), M08-A harness bootstrap (persistent cases + expected intent/tool/args/clarification/security), minimal trace seam (`conversation_id`, `turn_id`, `run_id` on every NLU call).
- Explicitly out of scope: conversation memory, ContextAssembler, RAG, local-model migration, new tools/doors, UX redesign, full observability (M09).
- Security rule: M01 may establish and test the NLU architecture, but NO new patient-sensitive production inference path may bypass the required egress policy. Experimental calls run under the existing boundary; M05 defines/enforces the production local-first boundary. M05 blocks any sensitive external inference not explicitly allowed.
- Implementation steps: 1) define intent schema + validator (unit-tested); 2) add LLM classifier behind `classer()`; 3) wire validated intent → tool selection; 4) add fixtures + M08-A harness; 5) attach trace IDs; 6) before/after refusal measurement.
- Tests / evaluation: M08-A golden intent cases (≥30, incl. §36 tests 1–6 + Darija/Arabic variants); `eval:jarvis` VERT; refusal set measured before/after (must be unchanged, 2026-09-03 precedent); invalid JSON → honest failure cases.
- Acceptance criteria (binary): PASS = same intent for all listed paraphrases per case; unknown/invalid → named failure, never invented intent; refusal set diff = empty; `eval:jarvis` VERT. FAIL otherwise. No "mostly works".
- Regression risks: model latency/cost (mitigate: fast-model routing + regex fallback); classifier overriding refusals (mitigate: refusals decided before classifier, diff-gated).
- Deliverables: schema + validator + wiring + M08-A harness + trace seam + measurement report.
- Status: COMPLETE (2026-09-15, see §23; M08-A harness + trace seam shipped, gates green).

### M02 — Conversation & active patient (P0, after M01)
- Objective: pronouns/references/follow-ups (« sa dernière ? », « et avant ? », « qu'est-ce qui a changé ? »); ambiguity → clarify, never silent wrong-patient.
- Why now: turns single commands into usable clinical dialogue; builds directly on M01 intents + trace seam.
- Dependencies: M01 (intents, trace IDs, M08-A harness).
- Current reality: single-patient anchor + TTL + `besoinDeClarification()` exist; no pronoun resolution; no multi-turn intent chaining.
- Target state: reference resolution (explicit > screen > conversation), follow-up chaining, mandatory clarification on ambiguous patient identity.
- In scope: resolver, follow-up logic, clarification prompts + UI hook, multi-turn golden cases (extends M08-A), propagate `turn_id`/`run_id`.
- Explicitly out of scope: ContextAssembler, RAG, new tools, treatment/consultation UX changes, long-term memory architecture.
- Implementation steps: 1) reference-resolution rules on top of existing anchor precedence; 2) follow-up intent chaining; 3) clarification gate (blocks tool call until resolved); 4) extend harness with 5-turn scripts + 3-Mohameds cases.
- Tests / evaluation: multi-turn scenarios; 3-Mohameds → ASK_CLARIFICATION (never silent selection); wrong-patient prevention suite; `eval:jarvis` VERT.
- Acceptance criteria (binary): PASS = scripted 5-turn consultation-prep dialogue green; ambiguous name → clarification, zero tool calls before resolution; same-patient pronoun chains resolve correctly. FAIL otherwise.
- Regression risks: over-eager resolution picking wrong patient (mitigate: confidence threshold + clarify-by-default on clinical actions).
- Deliverables: resolver + chaining + clarification gate + extended golden cases.
- Status: COMPLETE (2026-09-15, see §23; 0 new LLM calls, gates green).

### M03 — ContextAssembler (P0, after M02)
- Objective: formalize minimal scoped assembly from `assemblerAmorce`+`preparerPourLeModele`; budgets enforced; sensitive minimization; per-call traceability.
- Why now: M04's cross-domain reasoning needs bounded, auditable context — not whole-record dumps.
- Dependencies: M02 (conversation references determine what is "relevant").
- Current reality: two functions do the job with no contract, no snapshot, no size assertions.
- Target state: named `ContextAssembler` with task-specific context snapshots attached to `run_id`; hard budgets; minimization proven by assertion.
- In scope: assembler contract, budget enforcement, context snapshot in trace, no-dump assertions.
- Explicitly out of scope: RAG, new memory architecture, new tools, unrelated UI work, full run records (M09).
- Implementation steps: 1) define assembler interface over existing functions (no parallel system); 2) budget + minimization assertions; 3) snapshot context per `run_id`; 4) unit + trace tests.
- Tests / evaluation: context-size assertions; entire-record-never-in-prompt proofs; snapshot present for every NLU/tool call in M08-A runs.
- Acceptance criteria (binary): PASS = all budget assertions green; every traced call carries its context snapshot; no test prompt contains a full record. FAIL otherwise.
- Regression risks: over-trimming breaking answer quality (mitigate: golden answers in M08-A must stay green).
- Deliverables: assembler contract + budgets + snapshot mechanism + assertions.
- Status: COMPLETE (2026-09-15, see §23; doc state corrected by M04 gate — implementation was present in worktree, verified by executed tests, not by documentation).

### M04 — Patient/agenda/consultation/finance/docs intelligence + cross-domain (P1, after M03)
- Objective: excellent local tools at doctor-workflow level (`get_patient_summary`, `prepare_consultation`, `get_today_revenue`…); multi-tool questions (« qui vient demain et n'a pas payé ? »); useful next-step suggestions with UI actions.
- Why now: first mission the doctor feels; proves the M01–M03 stack on real workflows.
- Dependencies: M03 (assembler), M08-A (harness covers new tools).
- Current reality: 22 reads + 7 writes defined; single-tool turns; no composed reasoning; finance computed in PG but not exposed conversationally.
- Target state: composed multi-tool turns via loop; `prepare_consultation(patientId)` assembly; suggestions with [Ouvrir/Résumé/Préparer] actions; LLM interprets, PG computes (never LLM arithmetic).
- In scope: tool-composition via existing loop, preparation assembly, suggestion UI hooks, cross-domain golden cases, `tool_call_id` on every call.
- Explicitly out of scope: new PG doors without migration + human decision, RAG, egress changes, cockpit redesign (M10), finance chart redesign (M11/M12).
- Implementation steps: 1) compose multi-tool flows in loop within existing budgets; 2) build preparation assembly from existing doors; 3) suggestion rendering; 4) cross-domain golden cases.
- Tests / evaluation: cross-domain scenarios (agenda+finance, patient+treatment+consultation); finance totals equal PG door values exactly; `eval:jarvis` VERT; Playwright only if suggestion UI touched (loading/empty/error/no-AI/slow-AI states).
- Acceptance criteria (binary): PASS = §54 daily-workflow checklist demonstrable turn-by-turn with expected tool+args per step; finance figures byte-equal to door output. FAIL otherwise.
- Regression risks: budget overruns on composed turns (mitigate: MAX_TOURS/APPELS enforced, honest partial-failure); scope creep into new doors (mitigate: stop-and-ask rule).
- Constraint: one write = one PG door; new column/table/enum outside `01-SCHEMA`/ADR → stop, ask. No `DELETE` clinical/financial. `amount_dzd` int, `timestamptz` Africa/Algiers.
- Deliverables: composed flows + preparation + suggestions + cross-domain cases.
- Status: COMPLETE (2026-09-15, see §23).

### M05 — Local-first egress + tool firewall + injection defense (P0, starts after M01, matures alongside M02–M04)
- Objective: define and enforce the production local-first boundary: patient-sensitive inference → local-only (C1/C2 per audit classification); external inference only for C3-after-approved-transform or C4; tool permission declarations; patient content always DATA.
- Why now: M01 intentionally comes first as an engineering slice, but security must not become an afterthought — "parallel" means concurrent enforcement work, never "optional". M05 blocks any sensitive external inference not explicitly allowed, including anything M01–M04 prototypes.
- Dependencies: M01 (must know what the NLU path sends); audit classification C1–C4 (input policy).
- Current reality: pseudonymized cloud calls incl. raw free text; free-text + cloud-dev re-toggle residues; no tool permission declarations; envelope tests exist (scenario M) but no egress scan suite.
- Target state: enforced boundary at `external-call.ts` (still the single `fetch`); per-tool declarations (read/write, role, patient scope, network, confirmation); injection battery green; fail-closed where local inference unavailable (unavailable > leaked).
- In scope: boundary policy + enforcement, tool declarations, egress scan suite (requests/logs/telemetry/errors/bundle/MCP), injection battery, fail-closed behavior.
- Explicitly out of scope: local model integration itself (M13), RAG content work (M07), UX changes, full observability (M09).
- Implementation steps: 1) codify C1–C4 policy; 2) enforce at egress (classify → local-only / transform / block); 3) declare per-tool permissions; 4) injection + exfiltration battery; 5) fail-closed drills (local unavailable → honest refusal).
- Tests / evaluation: egress scan suite; injection battery incl. « ignore tes règles… », malicious tool args, cross-patient, escalation; §57 acceptance proven end-to-end.
- Acceptance criteria (binary): PASS = zero C1/C2 bytes in any external payload/log/bundle across the suite; all injection cases contained; unavailable-local → named refusal, never silent cloud fallback. FAIL otherwise.
- Regression risks: over-blocking breaking working turns (mitigate: M08-A golden must stay green; blocks must be named, never silent).
- Deliverables: policy + enforcement + declarations + scan/injection suites + §57 proof.
- Status: NOT_STARTED.

### M06 — Approval + ResponseGuard + execution monitor (P1, after M04)
- Objective: propose→confirm→execute→verify→log for sensitive; lightweight ResponseGuard (right patient? grounded in tool result? complete? safe?); per-tool timeout/retry/idempotency; honest failure.
- Why now: M04's composed turns need grown-up failure and confirmation behavior before RAG/UX scale.
- Dependencies: M04 (composed flows to guard), M05 (boundary the guard operates inside).
- Current reality: confirm/execute doors exist; NEG-1 path proven manually; no response-level guard; silent-failure classes previously fixed ad hoc.
- Target state: guard on important results; monitor with sensible timeout/retry/idempotency per tool; failures named (« je n'arrive pas à récupérer l'agenda »), never invented.
- In scope: guard checks, monitor, approval UX hooks, timeout/retry drills, unverified-write messaging.
- Explicitly out of scope: new tools, RAG, egress redesign, full run records (M09).
- Implementation steps: 1) guard checklist on composed results; 2) per-tool monitor config; 3) approval-path tests (approve/reject/timeout); 4) failure-message review (pronounceable, honest).
- Tests / evaluation: approve/reject paths (NEG-1 pattern); unverified-write never announced as success; timeout drills; `eval:jarvis` ecritures/boucle VERT.
- Acceptance criteria (binary): PASS = no « c'est fait » without verification across the suite; rejected approvals execute nothing via any path; timeouts named. FAIL otherwise.
- Regression risks: guard false-positives blocking good answers (mitigate: golden answers stay green).
- Deliverables: guard + monitor + approval tests + failure-message set.
- Status: NOT_STARTED.

### M07 — Knowledge/RAG full (P1, after M03+M05)
- Objective: ingestion → structural chunks + metadata → embeddings (local-capable) → pgvector → hybrid → local reranker 20→5 → evidence UI (« Pourquoi ? » with source/section/version).
- Why now: local patient intelligence (M01–M04) first; knowledge second — per approved strategy.
- Dependencies: M03 (scoped context to ground answers), M05 (C4-only external embeddings until local ready; C1/C2 knowledge never external).
- Current reality: no pgvector, no chunks, no embeddings, no retrieval; medication catalog + ICD-10 codes exist as future anchors.
- Target state: versioned corpus, hybrid retrieval, reranked top-5 evidence attached to answers, doctor-visible provenance.
- In scope: ingestion, structural chunking + metadata, embedding abstraction, pgvector schema (NEW migration only), hybrid + reranker, evidence UI, retrieval eval.
- Explicitly out of scope: Jarvis orchestration redesign, ontology expansion beyond agreed anchors, knowledge graph, MCP.
- Implementation steps: 1) corpus + chunking rules per doc type; 2) migration (new tables, never edit applied); 3) embeddings + hybrid + reranker; 4) evidence plumbing to answers; 5) retrieval eval.
- Tests / evaluation: recall/precision/ranking/reranker-gain/citation correctness; grounded-answer checks; sample clinical questions cite correct source/section/version.
- Acceptance criteria (binary): PASS = eval thresholds met on pinned set; every RAG answer carries verifiable evidence or an explicit no-evidence statement. FAIL otherwise.
- Regression risks: embedding-model drift (mitigate: versioned embeddings + re-embed strategy + M08-B gate).
- Deliverables: corpus pipeline + schema + retrieval + evidence UI + retrieval eval.
- Status: COMPLETE 2026-09-17 (acceptée avec résiduel documenté : E1 44/46, R0 partiel — tension golden prouvée ; voir §23). Hybride-live A3 câblée, DB eval 105/107, p95 1935 ms, déterminisme ×2.

### M08 — Golden eval + regression gate (P1, harness from M01, full gate as system matures)
- M08-A — Golden Harness Bootstrap (introduced during M01): persistent test cases, schemas, expected intent/tool/args/clarification/security/failure outcomes; regression visibility during M01–M07. No full RAG eval required before M01 begins.
- M08-B — Full Regression Gate (enforced once tooling/retrieval surface is sufficiently complete, at latest after M07): runs on every model/prompt/tool/routing/retrieval/chunk/rerank change; regressions block merge/release. Verdicts PASS/FAIL/NOT RUN only.
- Explicitly out of scope (both stages): implementing the features under test; new product surface.
- Acceptance criteria (binary): A: harness runs in CI-local (`pnpm eval:jarvis` + golden) with NOT RUN explicitly declared where env-gated. B: zero regressions on gate runs; any red blocks the change.
- Status: COMPLETE (2026-09-16, gate v1 green by executed verification — see record).
-
- ### M08 execution record (2026-09-16, session M08-gate)
-
- DONE: canonical schema `tests/eval/golden-schema.json` (m08-schema-v1, 3 families) + `scripts/valider-golden.mjs` (strict, 154 cas VERT) + `scripts/eval-golden.mjs` (`pnpm eval:golden`, 42 suites, verdicts PASS/FAIL/NOT RUN, exit 0/1/2) + 6 golden cases (M01-45/46/47, conversation M/N/O) + reports `artifacts/m08-gate-bf54dea-dirty.{json,txt}` + unblock fix below.
- CHANGED: `tests/eval/jarvis-intentions.golden.json` (44→47), `tests/eval/jarvis-conversation.golden.json` (12→15 scripts), `package.json` (+`eval:golden` only), `tsconfig.test.json` (+`allowJs`, test program only — see unblock), 3 M07 test files (type-only, see unblock).
- DELETED: none (temp probes removed; `eval:jarvis`/checkpoint untouched).
- VERIFIED (executed, final run): gate rev bf54dea-dirty — PASS 2375 / FAIL 0 / NOT RUN 28 → VERDICT: PASS, exit 0 (reproduced 4×: node ×3 with identical counts, pnpm ×1). Green: compiles ×3, typecheck ×2, lint-m08, vitest 74 files/1041+ tests, 19 evals (frontiere 49, boucle 42, chaine 28, ecritures 26, briefs 44, reveil 24, voix ×4, registre 26, sans-suppression 7, injection 11, routage 120, v2 25, intentions 47→70 checks, conversation 15 scripts/256, knowledge fixture 329 checks recall@5-proxy 100%, pipeline 11/11), schema 154 cas, 6 grep guards, validator integrity 6/6, mutation M01-01→FAIL detected, PII 7 files green. NOT RUN (all with reason): integration (no DB), e2e (no app), contexte-seance + resume-cas (stale supabase/functions/_shared, pre-existing), knowledge-DB + live-model + voice-positive (env-gated).
- UNBLOCK (user-authorized scope expansion 2026-09-16): `typecheck-tests` was FAIL on 3 untracked M07 WIP files importing untyped `.mjs` operators (TS7016) + implicit-anys + literal-union mismatches. Fixed type-only, zero runtime change (38/38 vitest on those files before=after): `lot(n: number)`, `langue`/`classification` + `as const`, `m[1] as string`, and `allowJs: true` confined to `tsconfig.test.json` (resolves .mjs unchecked, as vitest executes them; main `tsconfig.json` keeps `allowJs: false`). No `any`, no ts-comment suppression (both banned by repo lint — verified `eslint` clean on touched files). M07 remains owner of the `.mjs` signatures.
- NOT DONE: nothing in scope.
- OUT-OF-SCOPE (left as NOT RUN, pre-existing): stale eval paths, bash-PATH env, live-model/DB-gated passes.
- NEXT: M06-garde (still the single next mission per §22).

### M09 — Observability (P1, after M04; minimal seam already required in M01–M04)
- Objective: full AI run records + trace inspection + replay + prompt/model comparison + latency/tokens/cost; « why did Jarvis answer this? » answerable from trace. Builds on the M01–M04 correlation seam (`conversation_id`, `turn_id`, `run_id`, `tool_call_id`), expanding to retrieval/approval/execution IDs per audit run-trace requirement.
- Why now (full mission after M04): enough real traffic shapes (composed turns, approvals) to observe; early seam keeps M01–M04 debuggable without building M09 first.
- Dependencies: M04 (flows), M06 (approvals/executions to trace), M08-A (cases to replay).
- Current reality: traceId + PII-safe telemetry only; no run record, no replay.
- Target state: local-first trace store (new tables only), inspection + replay tooling, no external SaaS.
- In scope: run-record schema, trace/replay, comparison, cost/latency views.
- Explicitly out of scope: new AI behaviors, RAG tuning, UX redesign, external observability SaaS.
- Tests / evaluation: golden-case replay reproduces traces; PII scan on stored traces (C1/C2 handling per policy).
- Acceptance criteria (binary): PASS = any M08-A case replayable to an identical trace; no patient leakage into traces beyond policy. FAIL otherwise.
- Regression risks: trace volume/perf (mitigate: budgets + retention policy).
- Deliverables: trace store + inspection/replay + cost views.
- Status: COMPLETE 2026-09-18 (reliquat livré, voir record §23 ; coûts monétaires exclus par décision — vues durées/verdicts seules, doctrine boundary non-correlationniste).

### M10 — Consultation cockpit depth (P2, after M04)
- Objective: 3-col cockpit polish, inline previous consultations, treatment states, timeline/docs/appointment context. Composition over construction (V9 Lot A precedent).
- Why now: after intelligence lands, the workspace must present it without screen-leaving.
- Dependencies: M04. Current reality: tabbed cockpit exists; previous inline exists; zero-AI résumé tab locked (O4).
- Target state: doctor understands patient in seconds; O4 invariant preserved (résumé tab makes zero `/api/jarvis/` calls).
- In scope: cockpit composition, inline history, treatment states, context panels.
- Explicitly out of scope: new clinical logic, new doors if avoidable, AI behavior changes, RAG.
- Implementation steps: reuse-first assembly; lazy loading; O4 re-verified.
- Tests / evaluation: Playwright cockpit flows — workflow, loading, empty, error, no-AI, slow-AI, keyboard/voice where relevant; O4 zero-call assertion.
- Acceptance criteria (binary): PASS = all listed states covered and green; O4 holds. FAIL otherwise.
- Regression risks: breaking V9 green flows (mitigate: existing cockpit specs stay green).
- Deliverables: cockpit depth + state coverage.
- Status: READY (next mission 2026-09-17, after M04+M09s3).

### M11 — Command palette + morning + smart agenda/finance (P2, after M04)
- Objective: Ctrl-K on the same capability registry; concise morning brief; agenda gaps/delays/remaining; finance by type/category/week with elegant white/blue charts; PG computes, LLM formats.
- Why now: multiplies M04 intelligence across entry points with one shared registry.
- Dependencies: M04. Current reality: briefs composer exists (`jarvis-briefs.ts`); no palette; charts fixed V9 (token guard).
- Target state: one registry serving voice, text, and Ctrl-K; brief concise, never a feed.
- In scope: palette, brief, agenda answers, finance views.
- Explicitly out of scope: new registries per surface, AI arithmetic, chart-token changes, new doors if avoidable.
- Implementation steps: 1) palette on registry; 2) brief wiring; 3) agenda/finance answers with PG-backed figures.
- Tests / evaluation: §40/§41 questions with expected figures from fixtures; palette keyboard flows; loading/empty/error states.
- Acceptance criteria (binary): PASS = figures byte-equal to door output; palette actions resolve to the same tools as voice. FAIL otherwise.
- Regression risks: second command implementation drifting (mitigate: shared registry, no fork).
- Deliverables: palette + brief + agenda/finance answers.
- Status: NOT_STARTED.

### M12 — Design system lock (P2, parallel)
- Objective: centralize colors/spacing/typo/radius/shadows/icons/states; preserve V9 chart-token guard; French strings via `src/i18n/`, colors via `tokens.css` only.
- Why now: parallelizable; locks quality while M10/M11 build on it.
- Dependencies: none (coordinates with M10/M11).
- Current reality: tokens exist; V9 fixes locked by tests; some hard-coded values remain.
- Target state: token-complete system; no literals outside their homes.
- In scope: token audit + migration of literals, state/empty/loading patterns.
- Explicitly out of scope: UX restructuring, new screens, dark mode, AI work.
- Implementation steps: token inventory; literal migration; guard tests where missing.
- Tests / evaluation: token/grep guards; visual spot-checks at 1440×900.
- Acceptance criteria (binary): PASS = guards green; zero hard-coded colors/strings in touched scope. FAIL otherwise.
- Regression risks: visual regressions (mitigate: screenshot comparison on touched screens).
- Deliverables: locked token system + guards.
- Status: NOT_STARTED.

### M13 — Local AI readiness (P3, last; NOT the first moment local AI is supported)
- Clarification (resolves the apparent contradiction): M05 defines and enforces the local-first security boundary from early in the phase — local-first is policy from M05 onward. M13 is the later production-grade readiness mission: local model/provider integration, local embeddings, local reranker, quantization, GPU/VRAM management, operational model switching. If a sensitive capability cannot safely run locally yet, the system MUST fail closed or remain unavailable rather than silently sending sensitive data to a cloud model.
- Objective: production-grade local inference operations.
- Why later: policy (M05) precedes operations; premature GPU work would block product value.
- Dependencies: M05 (boundary), M07 (what must run locally), M09 (cost/latency evidence for what to localize first).
- Current reality: provider abstraction designed for swap; no local runtime.
- Target state: local models runnable + switchable with measured quality/latency; no custom CUDA; no foundation training.
- In scope: local runtime integration, quantization, VRAM mgmt, switching, model registry.
- Explicitly out of scope: training/fine-tuning (LoRA/QLoRA deferred further), custom kernels, cloud re-migration.
- Implementation steps: per-model integration behind `LLMProvider`; benchmarks vs cloud on M08 cases; cutover per capability with gate green.
- Tests / evaluation: M08 suite on local models; latency/VRAM budgets; fail-closed drills.
- Acceptance criteria (binary): PASS = gated capabilities green locally with no C1/C2 external calls; budgets met. FAIL otherwise.
- Regression risks: quality drops on small models (mitigate: per-capability cutover, never big-bang).
- Deliverables: local runtime + benchmarks + cutover log.
- Status: DEFERRED until M01–M09 stable.

### M14 — MCP adapter (P3, last)
- Objective: governed external integrations (calendar/messaging/printer/email) under §13 rules: least-privilege, explicit registration, scoped, egress-controlled, confirmation for sensitive, audited. No patient data to external MCP servers.
- Why later: only after boundary (M05) + approvals (M06) are proven.
- Dependencies: M05+M06 proven.
- Current reality: send structurally impossible (`canal: null`); no channels, no registries.
- Target state: narrow approved integrations, each permissioned and logged.
- In scope: adapter, registration, scoping, audit.
- Explicitly out of scope: new clinical features, patient-data sync to external tools, autonomous sending.
- Implementation steps: one integration at a time with Declarations + egress review + approval UX.
- Tests / evaluation: per-integration permission tests; exfiltration attempts blocked; audit lines present.
- Acceptance criteria (binary): PASS = integration works within declared scope; out-of-scope calls blocked + logged. FAIL otherwise.
- Regression risks: scope creep per integration (mitigate: one-at-a-time with explicit declarations).
- Deliverables: adapter + first integration proof (if approved) or deferred log.
- Status: DEFERRED until M05+M06 proven.

## 21. Dependency Graph

```text
M00 → M01 (+M08-A harness, +trace seam) → M02 → M03 → M04 → M06 → M08-B(gate) → M09
            ↘ M05 security boundary (CONCURRENT, never optional: blocks
              any sensitive external inference from M01–M04 prototypes too)
M05 + M03 → M07 → M08-B
M04 → M10, M11 · M12 parallel · M13, M14 last
```

Reading rule: "parallel" and "alongside" describe scheduling, never priority. M05's boundary binds every mission from M01 onward; a mission is not "done" if it violates the boundary, however green its own tests are.

## 22. Current Mission

Exactly one: **M10-cockpit (READY — next)**. M09 COMPLETE 2026-09-18 (reliquat livré, voir record ci-dessous).

### M09 reliquat — observabilité incrémentale filtrée (COMPLETE 2026-09-18, option A)

DONE: persistance live filtrée (`097_live_runs.sql` : runs/calls/proofs, hashes/enums/comptes/durées/C4 seuls, CHECK hex en base, RLS FORCE owner/practitioner, écriture opérateur seule, `get_live_history` + `purger_lives` + `get_observability_stats`, rétention 12 mois ; `098_live_issue.sql` : colonne `issue` + porte redéfinie, doctrine 089 ; `099_listes_observabilite.sql` : `list_live_runs`/`list_replay_runs`, en-têtes seuls, borne 1..100) + contrat `m09-live-v2` (enveloppe `{v1, approbation, outilsFp}`, v1 projeté octet-identique, `live-schema-v2.json` clés fermées) + corrélation (actionFp/executionFp/runFp FNV-1a, outilsFp parallèle aux appels, retrieval SHA-256 dérivé à l'ingest, chaîne tour→outil→preuve→approbation) + trio opérateur (`valider-live.mjs`, `ingerer-live.mjs` avec garde VERT + cabinet existant + SHA déterministes) + services lecture (`observabilite-lecture.ts` : 5 lecteurs Zod stricts, NULL→vide/erreur constante anti-oracle) + UI minimale (`/observabilite` : stats + listes + détail, assistante→erreur + zéro appel, états I11, i18n `m09.ts`, lien Paramètres gated, pas d'entrée rail car `fr.ts` gelé) + allowlist 73→78 par regen (mécanisme, jamais à la main).
CHANGED: `enregistrement-live.ts` (+v2 additif, `AnneauLive` générique défaut v1) ; `conversation.ts` (anneau v2, `capterApprobation`, liaison runFp sur carte, émission accepter/refuser — chemin d'exécution M06 intact) ; `allowlist.generated.ts` (regen) ; `parametres/documents` (+1 lien gated). BilanTour/boucle/execution/preuves/route/prompts/egress/RLS : intacts.
DELETED: `scripts/tmp-forage-m09-live.mjs` (sonde temporaire, preuve faite).
VERIFIED (exécuté 2026-09-18) : TDD RED→GREEN chaque lot (contrats 23+15+15, live 24, ingest 13, service 18, formats 5) ; `verifier-base` 97 migrations ; checkpoint-m09-097 PASS (RLS 3 rôles, CHECK base, purge comptes exacts, retention, audit trg, ROLLBACK propre — 2 défauts de maçonnerie attrapés : assertion inversée, vide replay supposé) ; forage ingest→portes→RLS→ROLLBACK PASS ; typecheck 2 passes 0 ; lint scope 0 ; vitest FULL 89 fichiers/1223 PASS (63 intégration NOT RUN, no TEST_DB) ; eval:golden PASS 2560/0/28 ; 12 evals Jarvis directes VERT (frontière/boucle/écritures/registre-26/sans-suppression-7-7/injection/routage/v2/intentions-47/conversation-256/chaîne-28/briefs, sur arbre final) ; E2E `observabilite.spec.ts` 5/5 isolé (sections+portes+l zéro-Jarvis, détail-ou-vide, géométrie 1440, panne-profil dite, assistante 0 appel).
NOT RUN (déclaré) : `pnpm eval:jarvis` script (bash sans node — panne env n°6 connue ; mêmes passes rejouées en direct via PowerShell node) ; valider-replay global (1 artefact stale 2026-09-16 pré-existant, rapport frais VERT) ; export live fichier en trafic réel (captation OFF, aucun trafic — même rationale slice 3) ; login praticienne E2E (aucun précédent credential a2, même branche que owner) ; intégration TEST_DB (absente) ; J2-E (humain requis) ; audit `boundary_crossings` en lecture (aucune porte, voir U4).
NOT DONE: rien du périmètre.
OUT-OF-SCOPE (verrouillé) : coûts monétaires (U4 — pas de porte audit, session_token non-corrélationniste par construction 028) ; chunk-ID plumbing (U5 — dérivation titres suffit) ; accept dashboard ColonneContexte (U6 — sans contexte run) ; M10, cross-encoder, OTel/SaaS, refactor.
NEXT: M10-cockpit (READY).

### M09 slice 3 — live seam (DONE 2026-09-17, anneau mémoire + OFF par défaut — approbations propriétaires obtenues)

DONE: couture live PII-safe (`shared/jarvis/enregistrement-live.ts` : `construireRecordLive` depuis l'entrée étroite, ids opaques sous empreinte FNV-1a jamais bruts, enums/comptes/latences/métadonnées C4, `AnneauLive` borné 200, `exporterAnneau` contrat `m09-live-v1`, drapeau OFF) + contrat `tests/eval/live-schema.json` (clés fermées) + hook au seul site post-bilan (`conversation.ts` : `capterTour` + `debutTour`, tours en échec sans record) + exports opérateur (`exporterCaptationLive`, `activerCaptationLive`, `reinitialiserCaptationLive` test-only).
CHANGED: `enregistrement-live.ts` (NEW, pur, browser-safe), `live-schema.json` (NEW), `conversation.ts` (~40 lignes : import, anneau, hook, exports), `jarvis-enregistrement-live.test.ts` (NEW, 11 tests TDD RED→GREEN).
DELETED: none.
VERIFIED (exécuté 2026-09-17) : TDD RED watched (module manquant) ; typecheck PASS (2 passes, exit 0 — 2 erreurs intermédiaires corrigées : excès de propriété, readonly) ; lint PASS scope (exit 0 — 1 double-assertion corrigée) ; vitest FULL 83 fichiers/1121 tests PASS (5 intégration NOT RUN, no DB) ; eval:golden PASS 2457/0/28 exit 0. Preuves : mapping fermé, adversarial (texte/ancre/args/snapshots/mention/UUIDs absents du JSON), chemin inconnu→`inconnu`, anneau 200 oldest-first + lecture défensive, export vs contrat (clés exactes), empreinte stable hors horodatage, scan PII vert sur record + positif planté détecté, OFF par défaut, hook OFF→rien / ON→record (scripted BilanTour, 0 DB/modèle).
NOT RUN (déclaré) : composition tour-réel→anneau sans app (pas d'app démarrée — le hook compile dans le flux, la logique est prouvée par `capterTour`) ; Playwright (pas d'UI touchée) ; persistance (décision : mémoire seule).
OUT-OF-SCOPE (pas implémenté, §29) : surface d'inspection UI, persistance/retention, vues coûts, IDs retrieval/approval/execution complets (M06 monitors), OTel/SaaS, toute écriture DB applicative (094 doctrine intacte, aucune migration), conversationId/patientId dans les records (même rationale que le retrait `patientId` de `log.ts`).
NEXT: M10-cockpit (READY).

### M07 — clôture (COMPLETE 2026-09-17, décision humaine (a) : E1 44/46 accepté)

Le détail d'exécution vit en §23 (record M07). Rappel : slice 3 câblée (A3 : 105/107 ×2 octet-identiques, rappel gold 3/3, TY-01 réparé, p95 1935 ms) ; seuils R0 intacts ; résiduel accepté — DJ-02/WD-02 vers silence + parité-pin (tension golden prouvée par paires de dominance, non séparable par calibration monotone) ; E1 44/46, Recall 3/5, MRR 0.6, nDCG 1.0, citations 100 %, no-answer 41/41, gouvernance 0. Composition route+provider+portes live NOT RUN ; cold modèle 54 s ; `p_inclure_historique` latent côté service (voir §23/§25.9).
NEXT (clos 2026-09-17) : M09 slice 3 DONE (voir record M09 ci-dessus) → M10-cockpit (READY).

When a mission becomes COMPLETE, record in §22/§23: what actually shipped (files + behavior), tests actually run with verdicts, NOT RUN explicitly listed, known problems found, and exactly one next mission. A mission is never marked complete from documentation alone — only from executed verification. Produce `DONE / CHANGED / DELETED / VERIFIED / NOT DONE / OUT-OF-SCOPE / NEXT` (AGENTS.md §8).

## 23. Completed Missions

### M01 — Structured NLU intents (COMPLETE 2026-09-15)

DONE: closed Intent contract (32 names, 1:1 existing capabilities) + strict Zod validator + injectable LLM classifier behind `classerMultilingue()` + server-side intent→capability compat gate + trace seam (`conversation_id`/`turn_id`/`run_id`, `run_id` = NLU `sessionToken`) + M08-A golden harness (44 cases) + checkpoint pass.
CHANGED: `src/app/api/jarvis/jarvis-chat/route.ts` (bounded: classifier call post-routing/non-refus, compat filter, additive `intent`/`runId` payload, `INTENT_CLASSIFIER_ENABLED=false` kill-switch); `scripts/checkpoint-jarvis-couche.sh` (intentions compile+pass).
NEW: `src/shared/jarvis/intentions.ts`, `src/server/jarvis/classifieur-intentions.ts`, `scripts/eval-jarvis-intentions.mjs`, `scripts/reecrire-alias-eval.mjs`, `.eval-intentions-tsconfig.json`, `tests/eval/jarvis-intentions.golden.json`, `tests/unit/jarvis-intentions-{schema,compat,route}.test.ts`, `tests/unit/jarvis-classifieur-intentions.test.ts`, `artifacts/M01-avant|apres-*`.
DELETED: none.
VERIFIED: typecheck PASS (2 passes); lint PASS on M01 scope (full `pnpm lint` FAIL is 341 pre-existing `.kilo/worktrees` parser errors, zero in M01 files); vitest PASS 41 files / 510 tests (4 integration files NOT RUN, no DB); eval passes PASS when run directly (frontiere/boucle/chaine/ecritures/briefs/reveil/registre/sans-suppression/injection/routage-120/v2/intentions-44/voix-x4/secrets/model-names/3-portes/boucle-ignore-ecritures); refusal BEFORE/AFTER diff EMPTY (`fc` identical); compat/invalid-output/trace proofs PASS. `pnpm eval:jarvis` as a script FAILS in this env (`node: command not found` under Git Bash — pre-existing, fails identically on unmodified passes); `eval-contexte-seance` path stale (`supabase/functions/_shared/` missing, live file is `src/server/jarvis/` — pre-existing).
NOT DONE: live-model quality measurement (pinned fakes only; free-tier variance) — M08-B concern.
OUT-OF-SCOPE (deferred, not implemented): M02 resolution, M03 assembler, write-intent execution (classified only), local-first enforcement (M05), run records (M09). `prompt.ts` intentionally untouched (dynamic intent block hashed per-call; classifier has own `intent-v1` version).
NEXT: M02-conversation (READY).

### M02 — Conversation & active patient (COMPLETE 2026-09-15)

DONE: deterministic reference resolution over the existing precedence machine. `resoudreCible` gains blocking `nonResolu` (M02-I1: explicit-but-unresolved mention NEVER falls back to screen/conversation/anchor — proven hole, now closed); pre-transport `search_patients` probe (registry path, `total_count` authority) → unique adopts pre-amorce, ambiguous clarifies listing candidates (ratified), zero-result clarifies naming the mention with thread preserved; hard fil gate post-proposal (`patient-hors-fil`, zero execution); follow-up chaining via server inlet (rebuilt+revalidated server-side, fills panne/UNKNOWN, escalates uncertain knowledge turns, never overrides decided/ASK/refusal, never chains meta+writes); `ContexteTravail` admitted as derived non-authoritative mirror (single slot, revalidated each use, existing lifecycle).
CHANGED: `src/shared/jarvis/resolution-references.ts` (NEW pure verdict+chaining+inverse-compat+kill-switch), `src/services/jarvis-contexte.ts` (tri-state signal, `nonResolu`, mention extraction incl. direct objects), `src/services/jarvis-boucle.ts` (probe/adopt pre-amorce, Gate-2, chaining send, `BilanTour.resolution`), `src/services/conversation.ts` (mirror lifecycle, ≤5-line gate call-sites, 2 test-seam exports), `src/services/jarvis.ts` (additive `intentionChainee` transport), `src/server/jarvis/intention-chainee.ts` (NEW pure inlet), `src/app/api/jarvis/jarvis-chat/route.ts` (surgical: body validation + inlet + Cas C suppression on chained-UNKNOWN + knowledge escalation), `src/i18n/resolution.ts` (NEW, `fr.ts` untouched), `scripts/eval-jarvis-conversation.mjs` + `tests/eval/jarvis-conversation.golden.json` (NEW, 12 scripts/196 checks) + checkpoint pass, 5 unit suites (97 tests), fixtures +3 patients.
DELETED: none.
VERIFIED: typecheck PASS (2 passes); lint PASS on M02 scope; vitest PASS 46 files/607 tests (4 integration NOT RUN, no DB); evals PASS direct: routage-120, injection, intentions-44, conversation-196, boucle, chaine-28, ecritures, briefs, registre-26, sans-suppression-7, frontiere, v2, reveil-24, voix×4; BEFORE/AFTER diffs EMPTY (routage, injection, intentions modulo latency jitter); no-new-LLM proven (no llm/fetch in touched client/shared code + ON/OFF transport parity test); no-UUID-forging (ids only from probe rows/struck tokens/cible); kill-switch both sides (`JARVIS_RESOLUTION_ENABLED` + module flag, rollback test). NOT RUN: `pnpm eval:jarvis` script as command (pre-existing bash-PATH, fails identically unmodified), `eval-reveil-pipeline` (needs physical ONNX model), `eval-resume-cas` (stale `supabase/functions/_shared` path, pre-existing), E2E (no UI touched). Live-model chaining quality (UNKNOWN-vs-GK on bare follow-ups) deferred to M08-B measurement.
NOT DONE: nothing in scope.
OUT-OF-SCOPE (deferred, not implemented): history-in-prompt, ContextAssembler (M03), retrieval, fuzzy matching, run records, `tool_call_id`, clarification UX, long-term memory, new capabilities, M05 enforcement. Vocative-at-0 mentions (« Karim, … ») intentionally unprobed (fil/clarify fallback, safe).
NEXT: M03-assembleur (READY).

### M03 — ContextAssembler (COMPLETE 2026-09-15, ratified by M04 gate)

DONE: named pure `ContextAssembler` (`src/services/jarvis-assembleur.ts`, 989 lines, ASCII-only, zero I/O — type imports + `BUDGETS` + byte-measure only) with closed 7-section vocabulary (`scope|patient|seances|traitements|agenda|finance|documents`), normative `SECTIONS_REQUISES` over all 32 M01 intents, explicit per-capability projectors (22/22, `get_patient_context` split in 4), semantic-only truncation (whole items, tail victims, newest never omitted, scope never truncated), epoch guard (`ResultatEpoque`, stale-scope drops counted), 15-key PII-free snapshot with `contributionHash = FNV-1a(jsonCanonique(contribution))` invariant, loop wiring (`assemblerAppel` per model call + final synthesis, `snapshots: ContextSnapshot[]`, `BilanTour.snapshots`).
CHANGED: `src/services/jarvis-boucle.ts` (assembly + snapshots + epoch wiring); `src/services/jarvis-assembleur.ts` (NEW); `tests/unit/jarvis-assembleur-contexte.test.ts` + `tests/unit/jarvis-boucle-assembleur.test.ts` (NEW).
DELETED: none.
VERIFIED (M04 gate, 2026-09-15, executed): vitest `jarvis-assembleur-contexte` 37/37 PASS + `jarvis-boucle-assembleur` 2/2 PASS (39/39); boundary re-run `jarvis-intentions-{schema,compat}` + `jarvis-resolution-references` + `jarvis-intention-chainee` + `jarvis-contexte-{precedence,nonresolu}` 141/141 PASS; grep confirms no fetch/db/network import in assembler (zero I/O); snapshot PII-scan + hash-invariant + budget + epoch + 32-intent table coverage per test headers. NOT RUN: full `eval:jarvis` script (pre-existing bash-PATH, fails identically unmodified), E2E (no UI touched), live-model answer-quality on trimmed context (M08-B concern).
NOT DONE: nothing in scope.
OUT-OF-SCOPE (deferred, not implemented): per-iteration intent filtering (M04), `tool_call_id` (M04), preparation assembly as section consumer (M04), run records (M09), RAG/relevance (M07).
NEXT: M04-routage (IN_PROGRESS).

### M04 — Routage intentions → capacites + tool_call_id (COMPLETE 2026-09-15)

DONE: pure deterministic router (`src/services/jarvis-routage-intentions.ts`, NEW — `capacitesAutorisees` accessor over M01 `COMPATIBLE` (no second table), `propositionAutorisee` family check, `intentionValideeDe` echo validator) + per-iteration family filter in `jarvis-boucle.ts` (server `intent` echo only, never the chainee; mismatch → `intention-incompatible`, zero execution, tour continues) + opaque `toolCallId` per real capability invocation (`TraceAppel.toolCallId?`, emitted in `executerCapacite` iff `lancer` invoked; absent on gates/dedup/pre-invocation/sonde) + server `intent` echo on outil payloads (`route.ts`, additive) threaded through `TourFlux` (flux + JSON fallback, transport-only, never validated client-side).
CHANGED: `src/services/jarvis-boucle.ts` (filter + toolCallId, ~40 lines); `src/services/jarvis.ts` (TourFlux `intent?` + passthrough ×2 paths); `src/app/api/jarvis/jarvis-chat/route.ts` (1 spread: outil payload `intent`); `tests/unit/jarvis-boucle-assembleur.test.ts` (1-line import fix: `SafeRechercheContext` from `jarvis-capacites`, pre-existing worktree breakage blocking `tsc -p tsconfig.test.json`).
NEW: `src/services/jarvis-routage-intentions.ts`, `tests/unit/jarvis-routage-intentions.test.ts` (14), `tests/unit/jarvis-boucle-routage.test.ts` (12), `tests/unit/jarvis-outil-call-id.test.ts` (3).
DELETED: none.
VERIFIED (executed 2026-09-15): TDD RED watched (router: module-missing; boucle: 3 failed pre-GREEN incl. M02-multitour regression caught mid-course; toolCallId: 3/3 failed with IDs undefined via stash check); GREEN 29/29 M04 tests; full vitest 52 files/680 tests PASS (54 integration skipped, no DB — declared); typecheck PASS (2 passes); lint PASS on touched scope (17 cast violations fixed via `fauxResultat` single-assertion idiom + typed TourFlux literals); evals VERT direct on final code: frontiere, boucle (B6 write→propositionInconnue preserved), chaine-28, ecritures, briefs, registre-26, injection-M, routage-120, intentions-44, conversation-196, v2, sans-suppression-7, reveil-24, voix×4; no-new-LLM proven (filter+IDs are local-only; multitour-J transport counts unchanged). NOT RUN: `pnpm eval:jarvis` script as command (pre-existing bash-PATH), `eval-reveil-pipeline` (needs ONNX model), `eval-contexte-seance` (stale path, pre-existing), `eval-resume-cas` (stale path, pre-existing), E2E (no UI touched), live-model quality (M08-B).
NOT DONE: nothing in scope.
OUT-OF-SCOPE (deferred, not implemented): widening COMPATIBLE families for agenda→patient-detail cross-flows (M01-table evolution, human decision); assembler intent threading from server echo (availability risk, no behavior change taken); `tool_call_id` persistence/replay (M09); suggestion UI hooks (existing next-step actions suffice); new capabilities/doors/migrations (zero).
DESIGN CORRECTION DURING BUILD: chainee-as-fallback removed after M02-multitour-A regression proved the loop must not judge follow-ups on the previous turn's intent (server decides fresh; echo-only signal). Documented in boucle header + test.
NEXT: M05-egress (COMPLETE 2026-09-15); M06-garde READY.

### M05 — Local-first egress + pare-feu (COMPLETE 2026-09-15)

DONE: pare-feu deterministe fail-closed au seul point de sortie (`src/server/egress/external-call.ts` + `classification.ts`). Classification C1/C2/C3/C4/INCONNU sur OCTETS serialises (jamais nom d'outil ni avis modele) : C1/C2/INCONNU BLOQUER (= local uniquement, zero appel fournisseur, `frontiere` honnete), C3 BLOQUER sans recu `agg-finance-v1` sinon AUTORISER, C4 AUTORISER. Pseudonymise ne declassifie jamais (jeton `{{PATIENT_001}}`/`PATIENT_001`/`P1` = C1). Free-text residue ferme : `message` libre + `contexte`/`resultatsOutils`/`historique` serialises, NFKC + base64 decode + espaces recolles + `+` query + encodages imbriques/json/unicode. Injection (`Ignore toutes les regles...`) reste DATA, cross-patient A+B bloque, canaux caches (metadata/headers/query/errors/telemetry/tool-args) bloques. Cloud-dev retoggle ne rouvre jamais : `frontiere` gagne contre tout flag (`VOICE_PROVIDER=cloud`, `JARVIS_ENABLED`, etc.). Local-unavailable → `Je ne peux pas traiter cette demande localement pour le moment.` (M13), jamais de repli cloud silencieux. Connaissance C4 passe, mal routee C1 comme C4 bloque.

CHANGED: `src/server/egress/external-call.ts` (gate `llm`/`llmStream` avant tout `fetch`, `LlmRequest.egress?`, `outcome:"blocked"` PII-safe, `MESSAGE_REFUS_FRONTIERE`); `src/app/api/jarvis/jarvis-chat/route.ts` (pre-filtre `chargeBloqueeParEgress` sur connaissance + patient + flux, extension `porteUnMotifIdentifiant` UUID/dossier/jeton, gate `classifierIntentSiUtile` via `messagePorteUnSignalPatient`); `src/server/egress/classification.ts` (NEW, pur, zero I/O) ; `tests/unit/jarvis-egress-{classification,gate,exfiltration,frontiere-source}.test.ts` (71).

NEW: `src/server/egress/classification.ts` (MOTIF_MOBILE/FIXE/INTL/COURRIEL/UUID/DOSSIER/JETON, NFKC/base64/espaces, NOM_COMPLET + NOM_COMPLET_MAJ sens unique + NOM_SIMPLE hors tete + NOM+VERBE + OBFUSCATION + REFERENCE_INCONNUE + MOTIFS injection/exfiltration, C3 agregat pur + `TRANSFORMATIONS_APPROUVEES=["agg-finance-v1"]`, `extraireScanUtilisateur` isole `role:user` des gabarits systeme).

DELETED: none (debug `zz-debug-m05` retire).

VERIFIED (executed 2026-09-15): TDD RED watched (4 suites, 81 tests, 11 failing pre-GREEN, inclus nom en capitales/bloque, base64, agregat, frontiere source); GREEN 71/71 M05 + 330/330 M01-M04 + `jarvis-parefeu-mots` 7/7 + `frontiere` 10/10; full vitest 56 files/761 PASS (54 integration NOT RUN, no DB — declared) + 4 integration suites NOT RUN; typecheck PASS (2 passes); lint PASS on touched scope (`classification`, `external-call`, `route`, `classifieur`, tests, log — full `pnpm lint` timeout is pre-existing `.kilo/worktrees` noise, verified on scope); codeEchecLlm/requalification `frontiere` distinct des pannes (`indisponible`/`configuration`), bloque jamais rendu `C'est fait.` ; no-new-firewall proven (single `llm`/`llmStream` gate, no `fetch` https hors `external-call.ts`, no MCP).

NOT RUN: `pnpm eval:jarvis` script as command (pre-existing bash-PATH, fails identically unmodified), `eval-contexte-seance` (stale path, pre-existing), `eval-reveil-pipeline` (needs ONNX model), `eval-resume-cas` (stale path), E2E (no UI touched — M05 is egress only).

NOT DONE: producteur C3 `agg-finance-v1` (aucun appelant ne presente le recu, donc C3 reste bloque partout — volontaire §12); local LLM M13 (produit refuse honnetement en C1/C2).

OUT-OF-SCOPE (deferred, not implemented): Google STT (audit only), local LLM runtime, RAG/pgvector/reranker, MCP, agents/memory, M09 run records/OTel/dashboard, UI redesign, new doors/migrations, prompt rewrite, model replacement.

DESIGN CORRECTION DURING BUILD: hybrid name scan vs prompt system — `classerCharge` isole désormais `role:user` pour les heuristiques de personne (sans cela `PROMPT_CONNAISSANCE` "Dans CETTE reponse" + "dossier" aurait bloque tout C4). Classifier NLU repli centralise sur route, pas dans `classifieur-intentions.ts` (test harness fake reste vert, prod reste bloquee par `external-call`).

NEXT: M06-garde (READY, P1 after M04+M05).

### M06 — Approval + ResponseGuard + execution monitor (COMPLETE 2026-09-16)

DONE: ratification + verification of the worktree implementation (zero code added by this mission — implementation predated it, uncommitted, never mission-verified). Single-path verified execution (`src/services/jarvis-execution.ts`: execute-by-actionId-only, DELAI 20 s → `inconnue`, tentatives:0 always, per-tool no-replay table, conservative reconciliation) + pure response guard (`jarvis-response-guard.ts`: ALLOW_SUCCESS only on proven execute+verify+full match, 7 BLOCK reasons incl. MISMATCH_PATIENT) + lecture guard (`jarvis-garde-lecture.ts`: success-claim filter on proposal tours, documented M08 limit) + both-surface wiring (`conversation.ts:714 accepterCarte`, `ColonneContexte.tsx:210`: success announced only on `issue.ok`, honest messages otherwise).

CHANGED: none (this mission). Pre-existing worktree files ratified: `jarvis-execution.ts`, `jarvis-response-guard.ts`, `jarvis-garde-lecture.ts`, `jarvis-ecritures.ts` verifier, `conversation.ts` accepter/refuserCarte, `ColonneContexte.tsx` confirmer/refuser, `fr.jarvis.ecriture.*` messages (dont `nonVerifiee`), `tests/unit/jarvis-{execution,response-guard,garde-lecture}.test.ts`, `tests/integration/jarvis-approbation.test.ts`.

DELETED: none.

VERIFIED (executed 2026-09-16): unit guard/execution 44/44 PASS; `eval-jarvis-ecritures.mjs` VERT (scenario N); **NEG-1 9/9 PASS on scratch base** (`mindcare_test_m06`: 94 migrations, dev trio, ephemeral login role; reject-terminal, execute-without-confirm, double-execute, double-confirm, cross-actor NULL, ID-only signatures) — base DROPPED + container cleaned after; procedure reproductible. Timeout drills (DELAI/expire/`inconnue`) + fr message review covered. Full vitest 1077 PASS + M08 gate 2412/0/28 (exit 0) re-run after adjacent M09 slices (no M06 file touched since).

NOT RUN: J2-E manual writes (needs live app + human, known ROUGE); E2E (no app started); NEG-1 as gate suite (no permanent TEST_DB — scratch procedure documented instead); `pnpm eval:jarvis` as command (pre-existing bash-PATH).

NOT DONE: nothing in scope.

OUT-OF-SCOPE (deferred, not implemented): new tools, RAG, egress redesign, M09 run records (delivered alongside as slices 1-2, separate record), J2-E closure (needs human session).

NEXT: M07-knowledge (READY).

### M07 — Knowledge/RAG full (COMPLETE 2026-09-17, acceptée avec résiduel documenté — décision humaine (a))

DONE (slices 1–3) : corpus 6 sources / 15666 chunks embeddés, portes 092/093 live ; lexical câblé + preuves UI (P9.1) ; slice 3 : calibration de fusion paramétrée (`rerank.ts` : `CalibrationFusion` α/β/γ/δ + `porteMajorite`, `CALIBRATION_COURANTE` ≡ historique pincée, `CALIBRATION_A3` = conjonction linéaire + majorité stricte voisins purs) + shell vecteur-requête production (`vecteur-production.ts` : BGE-M3 local paresseux, empreintes prouvées, fail-closed lexical, zéro octet externe) + câblage hybride-live (service `DEPENDANCES_REELLES` + passerelle `recupererPreuves`, jambe vectorielle via porte allowlistée, erreurs → lexical) + affordances `--calib` (eval-db, mesure-r3g, sonde-caractérisation).
CHANGED (slice 3) : `rerank.ts` (défaut inchangé), `recherche.ts` (param `calibration?`), `connaissance-recherche.ts` (deps hybride+A3), `preuves-recherche.ts` (jambe vectorielle + A3), `vecteur-production.ts` (NEW), `route.ts` (2 commentaires prose), 3 scripts + `--calib`, 3 suites tests (12 + 5 + 7, TDD RED→GREEN).
DELETED: `tests/unit/zz-debug-vecteur.test.ts` (sonde temporaire).
VERIFIED (exécuté 2026-09-17) : typecheck 2 passes exit 0 ; lint scope exit 0 ; vitest FULL 82 fichiers/1110 tests PASS (5 intégration NOT RUN, no DB) ; eval:golden PASS 2445/0/28 exit 0 (fixture 329 intacte) ; eval-knowledge-db `--reel` : lexical 100/7 reproduit, A3 `--vecteur` 105/107 ×2 OCTET-IDENTIQUES (DJ-02/WD-02 vers silence + parité-pin) ; passe G : E1 44/46, recall@5 3/5 (vs 2/5), MRR 0.6 (vs 0.4), nDCG 1.0, citations 3/3, no-answer 41/41, gouvernance 0, fencing 3/3, svc p95 1935 ms ≤ 3000 ; sonde-vecteur-production PRET (1024-dim, cold 54 s / warm ~0.3 s).
NOT DONE (résiduel accepté, tension prouvée) : E1 46/46, Recall ≥ 0.90, MRR ≥ 0.80, FR 35/35, darija 4/4. Paires de dominance (DJ-02 vs DS-01 ; WD-02 vs WDOSE-01/FRAR-01) : aucune fonction monotone en (couverture, similarité) ne satisfait le golden. Variants refusés par mesure : A1 14 findings, A2 6 (marge 0.017 fragile), A4 9 (TY-01 rétrogradé). Seuils R0 intacts.
NOT RUN (déclaré) : Playwright P9.1 (pas d'UI touchée) ; composition route+provider+portes live (pas d'app) ; J2-E.
OUT-OF-SCOPE : R4 cross-encoder ; révision golden/seuils ; warm-up démarrage ; bundle modèle packagé ; `p_inclure_historique` latent côté service (passerelle live correcte) ; tokenizer pin ROUGE (pré-existant).
NEXT: M09 slice 3 (live seam) — READY, approbation propriétaire requise.

## 24. Deferred / Rejected Items

- DEFERRED: M13 local LLM cutover, M14 MCP, LoRA/QLoRA, ontology beyond ATC/ICD-10, knowledge graph (AGE), semantic cache (patient-leak risk — only non-sensitive if ever).
- REJECTED for this phase: LangChain/Graph, crewAI, Pinecone/Chroma/FAISS/Neo4j, K8s, microservices, custom CUDA, foundation training, DPO/RLHF, multi-DB sprawl, dark-first redesign, `fr.ts` god-file edits (Phase 6 decision), applied-migration edits, Jarvis registry merge Phase 5 (no blind deletion).

## 25. Known Problems

1. Vague-question denial (« can u tell me abt patients ? »): M01 ships the fail-safe (confident UNKNOWN → honest clarification, zero tool; golden M01-25/26). Live-model confirmation still open for M08-B; deterministic chemin unchanged by design.
6. Env (Windows/Git Bash, pre-existing, found during M01): `node` absent from bash PATH so `pnpm eval:jarvis` fails on ALL passes — run evals directly via PowerShell `node` until fixed (fix = env/PATH or portable node invocation, not a product change; do not smuggle into a mission). `eval-contexte-seance` path stale (`supabase/functions/_shared/contexte-seance.ts` gone; live: `src/server/jarvis/`). Full `pnpm lint` red only via `.kilo/worktrees` stale copies (341 parser errors, zero in product files).
2. `tests/MAP.md` counts stale — verify by running, not reading.
3. E2E contention: never run lint/eval alongside suite (STATE.md 2026-09-08: 5min→18.6min + false reds); `commande | tail` masks exit codes.
4. Free-text chat + cloud-dev re-toggle residues — CLOSED by M05 (C1/C2 never leave, retoggle cannot bypass, proven at boundary). Remaining: local LLM M13 not yet available, so C1/C2 cloud path now refuses honestly.
5. Free-tier model latency 5s–180s makes behavior verdicts non-reproducible — M08 needs pinned/seeded or local model for green-gating.
6. M02 chaining depends on live classifier output for bare follow-ups (« Et avant ? » → UNKNOWN chaîné OK ; → GENERAL_KNOWLEDGE confiant reste savoir par décision) — M08-B must measure with a real model; deterministic contract holds either way.
7. Worktree durablement en avance sur HEAD (ex. boucle/contexte/route : centaines de lignes non commitées pré-M02) — les revues de diff se font contre l'état worktree réel + preuves d'exécution, jamais contre HEAD seul.
8. M05 C3 producer `agg-finance-v1` : transform approved but no caller emits receipt — C3 currently blocked everywhere (fail-closed, correct until dedicated finance verbaliser adopts receipt).
9. M07 hybrid-calibration — CLÔTURÉE 2026-09-17 (M07 COMPLETE, résiduel accepté, voir §23) : A3 mesurée `--reel` 105/107 ×2 octet-identiques (42 findings → DJ-02 + WD-02 vers silence + parité-pin), rappel gold 3/3, TY-01 réparé, p95 1935 ms ; A1 14 / A2 6 (fragile) / A4 9 refusés par mesure. Reste documenté : E1 44/46 + R0 partiel (tension golden prouvée, non séparable monotone) ; composition live NOT RUN ; cold 54 s ; `p_inclure_historique` latent côté service. Sûreté : `french`-dict RÉFUTÉ (aucune migration french-dict — la 097 actuelle est `097_live_runs`, M09) ; E2E sur build frais.
10. M09 résiduels acceptés (COMPLETE 2026-09-18, voir §23) : (a) coûts monétaires EXCLUS — `audit.boundary_crossings` sans porte de lecture (028) + `session_token` non-corrélationniste par construction : toute vue coûts exige une doctrine de lecture d'audit + ADR + décision humaine ; (b) `chunk_id` non plombé — retrieval dérivé (titre,section,version), plomberie du contrat gouverné refusée sans approbation ; (c) accept dashboard (`ColonneContexte`) sans record d'approbation — pas de contexte run là-bas, à dessiner séparément ; (d) aucun export live fichier en environnement de test (captation OFF, trafic nul — même rationale slice 3).
11. Artefact stale `artifacts/replay-compare-bf54dea-dirty-20260916-222947.json` (2026-09-16, totaux incohérents) : antérieur à M09-reliquat, intouché (jamais d'édition d'artefact), fait rougir `valider-replay.mjs` global — valider par rapport frais, pas en global.
12. Worktree M09-reliquat non commité (décision humaine requise) : 097/098/099 appliquées sur la base locale mc-p3 (97 migrations) mais fichiers non stagés, mêlés aux ~67 fichiers d'autres chantiers (problème n°7) — revue et commit par lot M09 explicite, jamais en bloc.

## 26. Architectural Decisions for This Phase

- D-N1: Approach A incremental (approved 2026-09-14) — keep green loop, add NLU behind firewall.
- D-N2: Egress local-first (approved 2026-09-14) — patient data local-only default.
- D-N3: RAG full-scope in-phase (approved 2026-09-14) — pgvector + hybrid + local reranker, sequenced after M03+M05.
- D-N4: Plan lives at `docs/MINDCARE_NEXT_PHASE_MASTER_PLAN.md` (approved 2026-09-14), superseding no existing contract docs; `ARCHITECTURE.md` écarts table stays the conflict log.
- D-N5 (hardening 2026-09-14): M01-first does not weaken security. M01 builds/tests NLU; M05's boundary binds M01–M04 prototypes and blocks unapproved sensitive external inference. "Parallel" = concurrent, never optional.
- D-N6 (hardening 2026-09-14): M08-A harness bootstraps inside M01 for early visibility; M08-B full gate enforces once the tooling/retrieval surface matures. No full RAG eval required before M01.
- D-N7 (hardening 2026-09-14): minimal trace seam (`conversation_id`, `turn_id`, `run_id`, `tool_call_id`) required in M01–M04; M09 expands it. Debugging seam ≠ observability mission.
- D-N8 (hardening 2026-09-14): M05 is local-first policy + enforcement from early phase; M13 is later production-grade local operations. Unsafe-local ⇒ fail closed, never silent cloud fallback.

## 27. Testing / Quality Gates

Per mission: READ (manifest → domain README → contract → targets → tests) → PLAN → IMPLEMENT (budget: only required files) → typecheck (2 passes) → lint → unit (vitest) → integration (or NOT RUN declared) → `eval:jarvis` + golden (M08-A from M01 on) → Playwright if UI touched → diff review → update this plan. Verdicts PASS/FAIL/NOT RUN only — never "looks good", "mostly works", "should be fine". Silent skip = FAIL. « Ça compile » ≠ done.

AI behavior verdicts require concrete expected: intent, tool, arguments, clarification behavior, security behavior, failure behavior. UI verdicts require: workflow, loading, empty, error, no-AI, slow-AI, keyboard/voice where relevant.

## 28. Session Handoff Protocol

> Every new AI implementation session must first read `docs/MINDCARE_NEXT_PHASE_MASTER_PLAN.md`, inspect the repository state relevant to the current mission, identify the current mission (§22), enter PLAN MODE, produce an implementation plan for that mission only, execute after planning, verify per §27, and update this master plan (§22/§23/§25/last_updated) before ending. The plan is the persistent navigation system — it must always reflect reality.

Mission execution is the absolute center of this document. The session loop is:

READ → identify current mission → inspect actual repository state → PLAN MODE → plan for THIS mission only → approved execution → implement only mission scope → verify → inspect diff → update master plan → stop.

An agent MUST NOT begin work on a future mission merely because it discovers something related to it. Future discoveries are recorded under Known Problems / Deferred Work and do not expand the current mission.

## 29. Mission Boundary Rule

> One session has one primary mission.
> One mission has one bounded objective.
> Discoveries outside the mission are recorded, not implemented.
> A future mission is never partially implemented "while already here".

This is one of the strongest execution rules in this phase. "While already here" work is how bounded missions leak into rewrites; the rule forbids it without exception. If the current mission cannot proceed without another mission's output, stop and re-plan — do not absorb the other mission.
