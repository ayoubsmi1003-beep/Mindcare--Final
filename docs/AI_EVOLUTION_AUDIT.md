# AI Evolution Audit (M00 — read-only discovery, 2026-09-14)

> No code changed in this pass. Every claim below was verified by targeted reads + 2 parallel codebase probes on 2026-09-14. File references are the evidence.

## CURRENT ARCHITECTURE

Modular monolith, ESLint-enforced layers (`ARCHITECTURE.md:8-18`): UI → 45 services (incl. `jarvis-*`×12) → `DbPort` (`services/db/port.ts`) → `httpDbPort` (same-origin `/api/*`, httpOnly cookie) → 13 API routes → `frontiere.ts` + `allowlist.generated.ts` (74 RPC) → `withCaller/withAuthGate/withEgressGate` → `PgDataPort` (`server/db/pgPort.ts`) → 165 `app.*` doors (RLS decides, `FOR UPDATE` ×45, `trg_audit`) → Kernel Jarvis (`server/jarvis/*`, no I/O) → egress UNIQUE (`server/egress/external-call.ts`) → OpenRouter/Groq/ElevenLabs. Local embedded PG (`resources/pgsql`, `070_local_auth`); 87 migration files 001→089 (031/035 absent).

## CURRENT ALEXA FLOW

Doctor input (text bubble `BulleAlexa` floating launcher, voice via `jarvis-voix.ts` MediaRecorder→base64, or Ctrl-K) → `demanderAJarvis[EnFlux]` (`services/jarvis.ts`, SSE `chemin/delta/attente/fin/erreur`, 15s watchdogs, JSON fallback) → gateway `api/jarvis/jarvis-chat/route.ts` → `classer()` deterministic regex (`src/shared/jarvis/routing.ts` + `normalisation.ts` + `lexique-multilingue.ts`, FR/darija/arabe/EN, default=`connaissance`) → prompts v3.1 (`prompt.ts`: `PROMPT_CONNAISSANCE` / `PROMPT_PATIENT` + `DESCRIPTION_OUTILS`, response-first, pronounceable) → OpenRouter `google/gemini-2.5-flash` (max_tokens 2000 JSON / 8000 stream, 1× transient retry) → `proposition.ts` shapes tool proposal → client `jarvis-boucle.ts` (MODELE→RENDU / LECTURE→EXEC→PROJECTION→reboucle / ECRITURE→PROPOSE→human wait; budgets 3 tours / 6 appels / 24Ko / 20s·60s; dedup via `jarvis-alias.ts`) → capabilities execute via existing services → `Safe*` DTOs (`jarvis-projections.ts`) → `preparerPourLeModele`/`verifierSortant` (`jarvis-confidentialite.ts`) + stable tokens (`{{PATIENT_001}}`, `jarvis-identite.ts`) → natural response + optional next-step actions. Refusals decided BEFORE operational routing (widening operational cannot swallow a refusal — STATE.md 2026-08-26).

## CURRENT TOOLS

- Defined: 22 reads (`jarvis-capacites.ts:992` LECTURES) + 7 writes (`jarvis-ecritures.ts:567` ECRITURES, PROPOSE→CONFIRM→EXECUTE→VERIFY→LOG, never imported by loop directly). Legacy `jarvis-tools.ts` (5, `AssertionCinq`, Zod strictObject) is frozen — do not extend (retirement Phase 5, no blind deletion). `jarvis.ts` (SSE client) is BEHAVIOR-FROZEN with one narrow exception: SSE event protocol, 15s watchdogs, abort semantics, request/response shape, and all legacy business behavior stay untouched; ADDITIVE context/transport fields are permitted only where M02/M03 explicitly require them; no semantic refactor, rewrite, or opportunistic cleanup is allowed.
- Exposed: subset via `jarvis_tool_allowlist` (033→063) + `allowlist.generated.ts`; check defined-vs-exposed gap before adding (contract `docs/contracts/jarvis-tools.md:5`).
- DB cycle: `confirm_jarvis_action` (033:141, `confirmed_at` separate transaction) → `execute_jarvis_action` (033:249, 063:164, re-verifies) → CHECK `jarvis_must_confirm` (012). Conversations persisted (058, `UNIQUE(client_turn_id,role)`).
- Not tools: `execute_sql`/raw queries do not exist anywhere in the registry — good (workflow-level capabilities only).

## CURRENT MODEL FLOW

`resolveModel()` from env (`OPENROUTER_MODEL`/`LLM_MODEL`); STT Groq `whisper-large-v3-turbo`; TTS ElevenLabs `eleven_multilingual_v2` (free-tier voices EN-accented FR — known, env-only fix). Single-flight analyses per consultation (`analysesEnCours` map, `services/jarvis.ts:136`). Known model quirks already patched: qwen naked `{type:<outil>}` → `lireProposition` folds 5 known names, unknown → null; lowercase voice names missed `NOM_PROPRE_COMPLEMENT` → narrow factual-pattern fix on frozen file (measured 60/60, zero refusals changed — STATE.md 2026-09-03).

## CURRENT CONTEXT FLOW

`assemblerAmorce()` (deterministic Algiers time + RefPatient + `consultationOuverte:bool` + ~2Ko agenda) → candidate anchor (precedence ambigu>explicite>écran>conversation) → `preparerPourLeModele()` (mask→verify, fail-closed `FuiteDetectee`) → model → `verifierSortant` → rehydrate stable tokens → render. Conversation: 058 turns + module single-target + TTL 15min + `besoinDeClarification()` pronouns. No named ContextAssembler, no whole-record dumps (budgets enforced), no long-term clinical memory (DB is truth).

## CURRENT SECURITY BOUNDARY

Model executes nothing; writes need human confirm + `confirmed_at` before execution; `canal: null` / `envoye: false` literals make send structurally impossible. Audio never on disk; raw-audio egress needs `VOICE_PROVIDER=cloud` AND `is_cloud_dev()` (fail-closed). Pseudonymization: client names + gateway tel/mail patterns (order fixed after the `nadia@example.dz` leak class — mask AFTER motif strip). Audit: `audit.log_boundary_crossing` (model, hash, tokens, cost, latency) + read/audit triggers. Adversarial pass `cloison-consultation.spec.ts` 5/5, no findings (STATE.md 2026-09-08); Phase-5 live leak probe: 57 real identities, 0 occurrences in emitted payload.

## CURRENT DATA EGRESS

Patient-derived facts DO reach cloud models today (pseudonymized, not anonymous: free-text message goes RAW with names the doctor typed; UUIDs in clear — `services/jarvis.ts:388-395` comment says so explicitly). TTS path fixed to local synthesis when tokens present. Pseudonymization is NOT a resolution of this finding: a token-substituted payload sent to an external model is still patient-sensitive external inference. Target: patient-sensitive inference → local-first; external inference → only after explicit data-classification and egress-policy approval (M05). Decision locked 2026-09-14: move to local-first. M05 must close: free-text chat residue + cloud-dev re-toggle + bundle/log/telemetry scan.

## AI DATA CLASSIFICATION (input to M05 egress policy — practical, not a compliance framework)

- **C1 — patient-identifiable / clinical narrative** (names, dossier numbers, phones, addresses, SOAP/raw notes, consultation content, doctor free-text naming a patient): external inference **local-only**. Never leaves the cabinet.
- **C2 — sensitive derived clinical data** (case summaries, session analyses, treatment plans, briefs derived from C1): external inference **local-only**; inherits C1 until an explicitly approved de-identification transform + policy reclassifies a specific artifact.
- **C3 — approved de-identified data** (aggregates with no patient link produced by an approved transform, e.g. day-revenue totals): external inference **permitted only after the approved transformation**, per the M05 policy.
- **C4 — generic / non-patient knowledge** (medical references, prompt templates, UI strings, lexicon): external inference **permitted**.

"Approved non-sensitive data" in the master plan means C3-after-approved-transform or C4 only — never raw or pseudonymized C1/C2.

## RUN-TRACE REQUIREMENT (architectural input to M09 — no implementation here)

Future Jarvis observability must preserve one correlation chain across: `conversation_id` → `turn_id` → `run_id` → `tool_call_id` → `retrieval_id` → `approval_id` → `execution_id`. M01–M04 establish the minimal seam (`conversation_id`, `turn_id`, `run_id`, `tool_call_id` where applicable); M09 expands it into full run records, retrieval traces, replay, and prompt/model comparison.

## CURRENT TEST COVERAGE

- Unit ~37 (`vitest run`, no DB): routing-multilingual, proposition-envelope, alias/dedup, boucle-verbalisation, contexte-precedence, capacites-description, firewall-words, prompt-knowledge/style, analyse-session, heure-cabinet, jetons-graphes (locks 6 distinct chart hues ≥120°), etc.
- Integration 4 (need `MINDCARE_TEST_DATABASE_URL` else NOT RUN — declared, not silent).
- E2E 19 (Playwright `workers:1`, need `pnpm start`+`/api/health`): connexion, dashboard, patients×3, agenda, alexa-lanceur, hors-cadre geometry, civilite, cloison-consultation, consultation×3, critical-chain, documents×2, finances, jarvis, role-resolution. 103/103 green 2026-09-08 (uncontended; never run lint/eval alongside).
- Offline evals 18 (`scripts/eval-jarvis-*.mjs` + `checkpoint-jarvis-couche.sh` = `pnpm eval:jarvis`): routage, registre, frontiere (49: no identifying value crosses; model DOES get clinical facts), injection (12, scenario M envelope), boucle (42, reboucle proven), ecritures (26, scenario N honest failure), briefs (29+H: draft never sent), reveil-pipeline 11/11 (plumbing only — human-voice recognition UNPROVEN), resume-cas, chaine, contexte-seance. J2-E manual writes ROUGE (known gap).
- `tests/MAP.md` counts stale — run, don't read.

## CURRENT WEAKNESSES (M01–M09 fuel)

1. No structured intents — regex + lexicon; paraphrase/darija fragility; vague-question denial unfixable by prompt (2 tries failed).
2. No ContextAssembler contract — two functions do the job, no snapshot/trace/size assertions.
3. No RAG — `search_patients` SQL only; no pgvector/hybrid/reranker/evidence.
4. Egress not local-first — pseudonymized cloud calls incl. raw free text.
5. Observability partial — traceId + PII-safe telemetry, no run record/replay/OTel dashboard.
6. No golden multilingual NLU suite — paraphrase regressions undetectable.
7. Free-tier model variance (5s–180s) — behavior verdicts non-reproducible; gate needs pinned/local model.
8. Wake-word engine unproven on human voice; TTS FR accent; `public/wakeword/` git-untracked (fresh clone has no wake word).

## RECOMMENDED CHANGES (→ master-plan missions)

M01 intents → M02 conversation → M03 assembler → M04 cross-domain tools → M05 egress/firewall → M06 approval/guard/monitor → M07 RAG → M08 golden gate → M09 observability → M10–M12 UX → M13/M14 deferred. Full order + acceptance in `docs/MINDCARE_NEXT_PHASE_MASTER_PLAN.md` §19–§21.

## FILES TO MODIFY (per mission, bounded)

- M01: `src/shared/jarvis/*`, `src/app/api/jarvis/jarvis-chat/*`, `src/server/jarvis/proposition.ts`, `scripts/eval-jarvis-*`, new `tests/unit/jarvis-intentions*`.
- M02/M03: `src/services/jarvis-boucle.ts`, `jarvis-contexte.ts`, `jarvis-identite.ts`, `jarvis.ts` (client context fields only).
- M04: `src/services/jarvis-capacites.ts`, `jarvis-briefs.ts`, `jarvis-messages.ts`, cockpit/patient/agenda/finance screens (composition first, zero new doors if possible).
- M05/M06: `src/server/egress/external-call.ts`, `src/services/jarvis-confidentialite.ts`, `src/server/jarvis/pseudonymize.ts`, eval security battery.
- M07: new migration `0NN_knowledge_rag.sql` (NEW tables only) + new `src/server/rag/*` + evidence UI.
- M08/M09: `scripts/eval-*`, new `tests/eval/*` golden suite, run-record store (new tables only).

## FILES NOT TO MODIFY

- Applied migrations (`supabase/migrations/0NN_*` — new `0NN_sujet.sql` only); `STATE.md` (active journal); `docs/archive/` (hook-guarded); PII into docs; `src/i18n/fr.ts` god-file + god-files (Phase 6 slicing decision); `jarvis-tools.ts` (frozen) + `jarvis.ts` behavior (frozen except additive context/transport fields explicitly required by M02/M03 — see CURRENT TOOLS); SSE protocol + abort chain; `external-call.ts` egress singularity (extend, never duplicate `fetch`); RLS/door ownership (`app_gatekeeper`, no BYPASSRLS).

## ARCHITECTURAL INTERPRETATION RULE

This audit is a factual baseline of what the repository IS. It authorizes nothing by itself. Implementation agents must use `docs/MINDCARE_NEXT_PHASE_MASTER_PLAN.md` as the execution/navigation document: mission scope, ordering, and acceptance come from the plan, never from this audit. The bounded file inventory (§ FILES TO MODIFY / NOT TO MODIFY above) is the normative file-scope constraint and is referenced — not broadened — by the plan.
