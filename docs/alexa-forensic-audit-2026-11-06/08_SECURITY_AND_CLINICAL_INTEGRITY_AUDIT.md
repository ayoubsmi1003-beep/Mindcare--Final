# Security and clinical integrity audit

**Status: PARTIAL — not a security certification.** Evidence is static unless explicitly marked otherwise. No production data, secrets, database roles, installed configuration or external providers were inspected. Existing unit tests have not all been run in this audit. Requirements in the constitution are not proof that every path enforces them.

## Mandatory authority boundaries

`CLAUDE.md` §1 and `docs/domains/alexa-constitution.md` require local patient-identifying data, database-enforced permissions, audited patient reads, no autonomous authoritative clinical decision, and human confirmation before business writes. Notes and tool results are data, not instructions. Any redesign and any external provider must retain these rules. The current task does not authorize cloud transfer of patient data.

## Evidence examined

| Boundary | Observed implementation | Confidence / remaining work |
|---|---|---|
| Caller identity and pooled connections | `src/server/db/withCaller.ts`, `withCaller`: transaction, `SET LOCAL ROLE`, transaction-local `request.jwt.claim.sub`, `COMMIT`/`ROLLBACK`, `DISCARD ALL` before release, destroy connection on cleanup failure. | High for code path. Actual DB role memberships, RLS and simultaneous users NOT VERIFIED. |
| Browser-to-database boundary | `src/app/api/db/rpc/route.ts`, `POST`, uses `preparer`, Zod `EntreeRpc`, generated `rpcAutorise`, then `withCaller`; `src/app/api/db/select/route.ts` validates relation and all selected/filter/order columns. `src/server/db/frontiere.ts` defines scalar bounds and allowlists. | High for read code. HTTP guards and complete generated allowlist must be reviewed together with DB grants; allowlist is not an authorization substitute. |
| Alexa DB calls | `src/server/alexa/db.ts`, `alexaDb`, calls the PG port through `withCaller` per gate. `patient-resolver.ts`, `resolvePatient`, searches and revalidates via `get_patient`. | High for these paths. Read-audit behavior and rights for every domain remain to be proven in SQL and runtime. |
| Analytics confidentiality | `supabase/migrations/208_analysis_charts.sql`, `get_analysis_overview`, checks owner/practitioner, cabinet and practitioner scope; `207_analysis_gates.sql`, `get_analysis_drilldown`, checks role and calls `audit.log_read` before identity reads. | High for these SQL definitions, subject to later overrides and actual migration state. NOT VERIFIED against deployed roles or all dependent functions. |
| Model cannot grant access | `src/shared/alexa/agent.ts` defines strict tool schemas; `agent-tools.ts` performs additional grounding and calls authenticated services; `src/server/alexa/tool-executor.ts`, `executeRead`, only accepts `clinical_context` and checks the patient scope. | These controls exist; full end-to-end proof for every tool and role NOT VERIFIED. Tool schemas alone do not authorize calls. |
| Patient context and external inference | `src/server/alexa/privacy-boundary.ts`, `createSafeClinicalPayload`, constructs a typed allowlisted projection and withholds free narrative; identity tokens, unsupported shapes and unsupported facts can cause refusal. `model-gateway.ts`, `inferAlexa`, requires a locally issued payload and calls pinned local inference. | High for these functions. This is not proof that every other model path has the same input or egress policy. |
| External egress | `src/server/egress/external-call.ts`, `llm` and `llmStream`, call `autoriserInference` / `classerCharge` before provider selection. The free Gemini and Groq provider paths contain synthetic-deployment checks. Boundary logging can be best-effort in these paths. | High for the cited paths only. Inventory all external transports, test zero-byte denial and log failure behavior before claiming a universal fail-closed boundary. |
| Proposal versus execution | `src/server/alexa/action-proposal.ts`, `prepareActionProposal`, prepares a bounded proposal and does not itself execute or grant authority; `src/services/alexa-proposal.ts`, `alexaProposalLabels`, revalidates patient and target identity for presentation. | Confirmation, database transitions, idempotence, actual execution and audit still require an end-to-end trace for every action. |
| Voice ingress | `src/app/api/jarvis/jarvis-voice-in/route.ts` checks same origin, clinical AI admission, authenticated identity, local voice configuration, request bounds, cookie/session and input schema before invoking the local worker. | High for this route. Physical audio, local worker isolation and all alternate paths NOT VERIFIED. |

## Prompt injection and source authority

Typed clinical facts and their issued-object checks in `privacy-boundary.ts` constrain one model path; `knowledge-synthesis.ts` rejects several unsafe or ungrounded outputs and publishes controlled evidence excerpts. Neither mechanism alone proves that all free-text patient notes, extracted books, histories, model messages, and tool results remain non-authoritative at every call site. Trace each route and run injection tests on an isolated synthetic fixture, including instructions embedded in notes and retrieved passages, before granting a pass.

## Additional findings from the wider application

An isolated synthetic React rendering confirmed that `PatientProfilClinique` displays “Aucun traitement actif” when its treatment domain is `null`; see `20_ECRANS_PATIENT_CONSULTATION.md`. The screen's behavior is confirmed for the supplied contract object, while reachability in the deployed database is NOT VERIFIED. This is relevant to clinical integrity because unavailable information is presented as a negative fact.

A mocked route test confirmed that a communication provider refusal returns 422 after the only requested message transition is `sending`. The SQL definition and transaction wrapper indicate a possible persistent stuck state; actual database commit behavior was not tested. The same path has an unresolved duplicate-delivery risk on uncertain external outcomes. Details, evidence and a safe reproduction plan are in `21_MESSAGERIE_ET_ENVOI.md`; no real message was sent.

An additional synthetic test exercised the real HTTP adapter and action monitor with `fetch` mocked to reject. The monitor classified the result as definite `echec / ECHEC_PORTE`, rather than an uncertain transport outcome, and did not enter its transport reconciliation branch. The action might have committed before a lost response; no actual database commit was simulated or observed. See `22_ACTIONS_CONFIRMATION_ET_INCERTITUDE.md` for the precise chain and regression plan. No automatic replay was observed in this path.

## Target security constraints

1. Resolve the authenticated actor before selecting a patient or calling a tool; authorize every read and every stage of an action in the existing SQL gates.
2. Keep patient context local. External use is a separate human and technical decision: provider policy, residual reidentification risk, legal basis, exact payload, egress gate and zero-byte denial tests must all be reviewed. A model name or a promise of de-identification is insufficient.
3. Preserve distinction between read, draft, confirmation, execution, verification and audit. Recheck patient, revision, permissions and intended action at execution time; no silent auto-commit.
4. Keep least privilege, request bounds, cancellation, provenance, untrusted-content labeling and explicit incomplete/unauthorized outcomes. Do not replace database checks with prompt wording or UI hiding.

## Required verification

NOT RUN: effective RLS/grants/ownership in the installation; cross-practitioner and receptionist tests; field-level confidentiality; rollback and audit atomicity on every write; all external transport routes; malicious patient/knowledge text against all entry points; consent and retention for any prospective provider; real voice devices. Use a separately identified synthetic database, safe fixtures and a mock provider that records whether any bytes were attempted. These are acceptance work items, not claims of vulnerability or compliance.

**Focused tests, 2026-11-06: PASS.** Ten unit files, 100 tests, including `jarvis-egress-gate.test.ts` and `alexa-v2-privacy.test.ts`. The former injects a fake provider and deliberately targets a nonexistent local database at port 1; its passing assertions do not verify production audit writes, SQL permissions, or every egress path. Other files cover selected routing, evidence and application-read behavior with controlled fixtures. Logs include expected `LocalModelUnavailable` cases. The complete security suite and live installation were NOT RUN.
