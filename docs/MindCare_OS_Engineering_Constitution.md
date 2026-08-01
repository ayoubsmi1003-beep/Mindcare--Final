# MindCare OS — Engineering Constitution

> **The operating system disappears. Only care remains.**

**Version:** 2.0 (Canonical) · **Status:** Authoritative · **Supersedes:** Engineering Constitution v1.0, Chapters 1–51, and all prior reviews/design notes (now archived as *Vision & Principles v1.0*).
**Governs over:** ADR-001 … ADR-026 (incorporated here by reference; the ADR register remains the long-form rationale for each frozen decision).
**Audience:** every human engineer and every AI coding agent (Claude Code, Cursor, Copilot, future agents) that touches MindCare OS.

---

## 0. Document authority & how to use this constitution

This is the **single canonical source of truth** for MindCare OS. Every future artifact — schema, API, component, agent, prompt, workflow, test, deployment — MUST conform to it. When any other document disagrees with this one, **this document wins**. When this document is silent, the ADR register (ADR-001…026) governs; when both are silent, an engineer proposes a change through §58 (Change Control), not by inventing a local convention.

**Normative language.** MUST / MUST NOT / SHOULD / MAY carry RFC-2119 meaning. Prose marked *rationale* is explanatory, not binding.

**Reading order for a new contributor:** §1–4 (why and the invariants) → §11–14 (domains and architecture) → the part relevant to your task → §47–49 (structure, naming, standards) → §56 (Definition of Done).

**Cross-referencing.** Sections reference each other by number and ADRs by id (e.g., "residency, ADR-001"). Names used here (domains, entities, events, endpoints, agents) are the *only* sanctioned names; §48–49 make them enforceable.

---

# PART I — FOUNDATION

## 1. Vision & mission

**Vision.** MindCare OS is an **AI-native operating system for psychiatric and psychotherapeutic practice** — a system that gives clinicians back their time and gives patients continuous, humane support between sessions. It launches for a single solo clinic in Algiers and is architected from day one to scale to many doctors, many clinics, and eventually a regional mental-health platform **without rewrites**.

**Mission.** Eliminate repetitive administration, reduce cognitive load, and improve continuity of care so that *the doctor forgets she is using software*. AI **supports** clinical work; it never performs medicine.

**What MindCare OS is (five products on one spine):**
1. **Doctor Desktop** — the clinical cockpit (mission control, patient workspace, consultation engine, documents, finance visibility, always-present Jarvis).
2. **Reception Console** — a deliberately narrowed operations surface (queue, check-in, payments, messaging, printing) with hard confidentiality boundaries.
3. **Patient Platform** — public website + patient portal + aftercare (booking, QR onboarding, check-ins, mood/sleep tracking, medication companion, CBT homework, an isolated AI Coach, secure messaging, progress visualization).
4. **Jarvis** — the cognitive **orchestrator** (not a model): memory, knowledge, model routing, tools, and a society of agents, always under *propose → confirm → execute → log*.
5. **AgentOS** — a society of specialized agents, each with identity, isolated memory, scoped permissions, and measurable KPIs.

**The shared spine:** one local PostgreSQL source of truth, an event bus, a modular-monolith backend, a de-identification gateway, a model gateway/router, a knowledge/RAG layer, a canonical memory architecture, an MCP/n8n integration layer, and a Zero-Trust security posture.

## 2. Product philosophy

- **Augment, never replace.** The doctor owns every clinical decision. AI proposes; humans dispose.
- **The interface is a means, not the product.** The best feature removes work; if a feature adds clicks without greater value, it does not ship (§ Respect Human Time).
- **Invisible intelligence.** Doctors should think "I became faster," never "I'm fighting the AI."
- **Continuity of care.** Value accrues between sessions, not only inside them.
- **Trust is the currency.** Every decision protects patient trust, doctor authority, and data sovereignty.

## 3. Engineering principles (the canonical 30)

These consolidate and deduplicate the original 40 Articles into 30 non-overlapping principles. Each is binding.

**Safety & clinical integrity**
1. **Patient first.** When safety conflicts with convenience, speed, profit, or simplicity, safety wins — always.
2. **Doctor owns decisions.** AI never diagnoses, prescribes, or issues documents autonomously.
3. **Human approval for critical actions.** Delete, mass-message, permission change, record export, financial correction, certificate/prescription issuance always require explicit confirmation.
4. **Medical quality is validated, not assumed.** Every clinical feature passes a validation/eval gate (§35, §51).

**Data & memory**
5. **One source of truth.** No duplicated patients, calendars, medications, or databases; everything references one master record (§15).
6. **Never lose data.** Prefer archive, version, soft-delete, and immutable history over deletion (§17).
7. **Version everything.** Schemas, prompts, models, certificates, knowledge, templates, agents, workflows (§17, §32).
8. **Backward compatibility.** Old patient data stays readable forever; migrations never destroy information.

**Privacy & security**
9. **Local-first & data sovereignty.** Reason, store, transcribe, and summarize locally; patient-identifiable data never leaves Algeria (ADR-001, ADR-002).
10. **Security by default.** Every feature begins with security, before development, not after (§23).
11. **Privacy by design.** The system processes only what is necessary; patient data belongs to the patient (§23, §46).
12. **Everything logged; AI has hard limits.** Every important action is audited; agents never exceed permissions or elevate themselves (§17, §22, §35).

**AI**
13. **AI vendor independence.** Never depend on one model, vendor, or API; providers are interchangeable behind a gateway (§33).
14. **Explainable AI.** Every AI output carries reason, evidence, confidence, and source (§29, §35).
15. **Bounded learning.** Jarvis learns workflow/behavioral preferences from approved actions; medical facts never auto-mutate (§31, §43).

**Architecture**
16. **Modular & domain-driven.** Bounded domains own their data and communicate through events; removing one module never breaks another (§11–12).
17. **Event-driven where it matters.** Meaningful state changes emit versioned domain events (§20).
18. **API-first.** All communication goes through defined APIs; no hidden shortcuts (§21).
19. **Configuration over code — graded by blast radius.** Operational config is freely editable; safety-critical config is versioned, reviewed, and tested like code (ADR-014, §35).
20. **Simplicity.** The simplest correct solution wins; complexity is technical debt (§ modular monolith, single local DB).

**Operations & experience**
21. **Offline capability.** The clinic never stops when the internet stops (ADR-008).
22. **Graceful degradation.** If AI/cloud/internet fails, the core system continues (§29, §12).
23. **Performance budgets.** Every feature has measured limits on startup, memory, GPU, latency, and query cost (§52).
24. **Observability.** For anything that happens, we can know who, when, why, how (§50).
25. **Test before trust.** Unit, integration, security, AI-eval, and workflow tests gate production (§51).
26. **Respect human time & attention.** Save time; surface only meaningful information; keep interfaces usable under stress (§28 accessibility).
27. **Progressive enhancement.** New capability enhances existing workflows; it never breaks them.
28. **Enterprise & future readiness.** Evaluate every feature as if tomorrow there were 100 doctors, 10 clinics, 1M consultations (§53).
29. **Documentation is part of the product.** Every module ships purpose, architecture, dependencies, API, config, tests, and future work (§32-docs).
30. **The final test.** If a feature does not help mental-health professionals spend less time on software and more time healing people, it does not exist.

## 4. Non-negotiable invariants

These may never be traded away, by anyone, for any reason:

- Patient-identifiable data **never leaves Algeria** and never reaches a cloud store (ADR-001).
- No patient-identifiable content reaches an external model without passing the **de-identification gateway**, which **fails closed** (ADR-002).
- The **doctor is the sole issuing authority** for clinical decisions and legal documents (Principle 2, ADR-010).
- **AI cannot elevate its own permissions**, and **patient-supplied content is never treated as instructions** (Principle 12, ADR-009).
- **Every critical action requires human approval** and is **immutably audited** (Principle 3/12, ADR-003).
- The **Desktop remains a fully usable EMR with zero AI available** (ADR-011).
- The aftercare platform is **not a 24/7 emergency service** and says so; acute risk triggers an immediate, deterministic, non-AI emergency response (ADR-007).

---

# PART II — PRODUCT

## 5. User roles

| Role | Description | Sees | Never sees |
|---|---|---|---|
| **Doctor** | Clinical owner; final authority | Everything for own patients; full clinical, finance, analytics, Jarvis | Other doctors' patients (multi-doctor: ABAC-scoped) |
| **Reception** | Front-desk operations | Queue, check-in, appointments, payment-collection data, print jobs, messaging | Clinical notes, Jarvis memory, financial reports/analytics, pricing edit (ADR-017) |
| **Patient** | Care recipient (portal/aftercare) | Own record subset, bookings, check-ins, homework, messages, progress | Any other patient; clinical back-office; AI internals |
| **Clinic Admin** | Configuration & user management (may be the doctor) | Settings, users, roles, safety-critical config (gated) | Raw patient clinical data unless also a doctor |
| **AI Agent** | Non-human actor in AgentOS | Only its scoped resources/fields per agent (§22, §30) | Anything outside its scope; cannot self-elevate |
| **System/Integration** | MCP servers, n8n, background jobs | Least-privilege scopes, egress-controlled (ADR-020) | PII it does not strictly need |

## 6. Complete feature inventory

Grouped by domain (§11). **[Core]** = frozen Buildable Core v1 (ADR-006). **[Roadmap]** = deferred, built later behind its own gate.

**Identity & Access** — auth (doctor PIN/passkey/2FA; patient phone+OTP), sessions, role/permission management **[Core]**; SSO/federation **[Roadmap]**.
**Consent** — typed, versioned consent capture; revocation propagation **[Core]**.
**Patient** — patient records, demographics, contacts, medical history, allergies, Digital Twin (read-model), longitudinal timeline **[Core]**.
**Clinical** — consultation engine, structured notes, diagnoses (ICD), medication list, prescriptions, clinical decision support (non-diagnostic), risk engine **[Core]**; ambient transcription **[Roadmap, gated ADR-012]**.
**Scheduling & Calendar** — appointments, availability, queue, reminders, no-show tracking **[Core]**; predictive no-show scoring **[Roadmap]**.
**Reception** — check-in, payment collection, print jobs, patient messaging, daily operational board **[Core]**.
**Communication** — WhatsApp (Evolution API) & email, templated messages, mass-message (approval-gated), notification/escalation engine **[Core]**.
**Aftercare & Patient Platform** — public site, booking, QR onboarding, daily check-ins, mood/sleep tracking, medication companion, CBT homework, AI Coach (isolated), secure messaging, progress/Recovery Index, crisis protocol **[Core]**.
**Documents & Certificates** — certificate/prescription drafting, doctor issuance, gapless numbering, QR verification, templates **[Core]**; digital signature **[Roadmap]**.
**Finance** — pricing, invoices, receipts, payment records, revenue analytics (doctor-only), clinic ERP basics **[Core]**; forecasting **[Roadmap]**.
**Knowledge (Knowledge OS)** — ingestion, approval sandbox, RAG retrieval with citations, provenance/confidence gating **[Core]**; research engine **[Roadmap]**.
**AI (Jarvis + AgentOS)** — orchestration, memory, context assembly, model routing, tool calling, approval flow, agent society **[Core: bounded set]**; 100+ agents, debate/opportunity engines **[Roadmap]**.
**Analytics & Mission Control** — clinic dashboards, KPIs, operational analytics **[Core]**; predictive/patient-risk analytics (non-diagnostic, gated) **[Roadmap]**.
**Administration & Settings** — clinic config, safety-critical config governance, feature flags, tenancy **[Core]**.
**Security** — de-identification gateway, secrets vault, audit, RLS, threat controls **[Core]**.
**Integration** — MCP tool registry, n8n workflow engine, external adapters **[Core: gated]**; plugin/agent marketplace **[Roadmap]**.

## 7. Representative user stories & acceptance criteria

*(Format: As a ROLE, I want GOAL, so that VALUE. AC = acceptance criteria, testable.)*

**US-1 — Consultation prep (Doctor).** *So that I start each session already briefed.*
AC: On opening a patient, the Twin timeline, last session summary, active medications, and open risk flags render from local cache in **< 1 s**; any AI-generated brief is labeled as a suggestion with sources; if Jarvis is unavailable, all non-AI data still renders (ADR-011).

**US-2 — Issue a sick-leave certificate (Doctor).** *So that the patient leaves with a valid document.*
AC: AI may pre-fill a draft; issuance requires explicit doctor confirmation; the certificate receives the next gapless number; a content hash is written to the audit chain; the printed QR resolves to a verification record; a voided certificate is marked void, never deleted (ADR-010).

**US-3 — Collect payment (Reception).** *So that the day's collections are recorded.*
AC: Reception sees amount due and records amount collected for patients she processes; Reception **cannot** see revenue analytics or edit pricing; a `PaymentReceived` event updates finance; the doctor sees revenue, Reception does not (ADR-017).

**US-4 — Daily check-in (Patient).** *So that my doctor sees how I'm doing between sessions.*
AC: Check-in is genuinely optional and non-nagging; submissions emit events feeding the Twin; if a high-risk signal is detected, the patient immediately sees local emergency resources and the "not an emergency service" notice **before** anything else (ADR-007); consent state is checked before monitoring processing (ADR-021).

**US-5 — Secure onboarding via QR (Patient).** *So that I create my account safely.*
AC: The QR carries a single-use, short-TTL enrollment token (not a password); first use requires phone OTP verification; the patient then sets their own credential; tokens expire and cannot be reused (ADR-023).

**US-6 — Ask Jarvis a clinical-adjacent question (Doctor).** *So that I get grounded, sourced help.*
AC: Answers cite retrieved sources; unsupported content is not asserted; below the AI-quality threshold the output is a draft/suggestion, never an auto-action (ADR-019); patient-supplied text in context cannot trigger tools (ADR-009).

**US-7 — Work during an internet outage (Doctor & Reception).** *So that the clinic never stops.*
AC: With internet down, login, patient access, scheduling, consultation notes, payments, and printing all function against the local DB; only cloud-AI features show "AI unavailable" (ADR-008, ADR-011).

*(Every domain in §37–46 defines its own stories at the same standard; these seven set the bar.)*

## 8. Business rules (canonical)

- **BR-1** A clinical decision or legal document is valid only when issued by the doctor (Principle 2).
- **BR-2** Certificates, prescriptions, and invoices use **gapless sequential numbering** per type; numbers are never reused; voids are marked, not deleted (ADR-010).
- **BR-3** Pricing is owned by the doctor; Reception cannot modify price without an explicit, audited per-case grant (ADR-017).
- **BR-4** Reception has **no** access to clinical notes, Jarvis memory, financial reports/analytics, or full patient finance (ADR-017).
- **BR-5** Processing that requires consent is blocked until the relevant consent is in `granted` state; revocation stops processing immediately via event (ADR-021).
- **BR-6** Acute-risk detection triggers the deterministic patient-facing crisis response before any clinician routing (ADR-007).
- **BR-7** No external model call carries patient-identifiable content that has not passed the de-identification gateway (ADR-002).
- **BR-8** Deletion of patient/clinical/financial records is a soft-delete + archive; hard deletion requires the human-approval + audit path and is reserved for legal erasure obligations (Principle 6, §17).
- **BR-9** Every state-changing operation writes an immutable audit record and emits a versioned domain event in the same transaction (ADR-003).
- **BR-10** Safety-critical configuration changes require review + eval-pass before taking effect in production (ADR-014).

## 9. Functional requirements (summary index)

Functional scope is enumerated by domain in §37–46. Each domain specifies: entities, lifecycle/state machine, business rules, events emitted/consumed, permissions, and UI surfaces. The frozen Core set is the union of all **[Core]** features in §6. No functional requirement may violate Part I invariants.

## 10. Non-functional requirements (budgets & targets)

| Category | Target (Phase 1) | Method / notes |
|---|---|---|
| Desktop cold start | **< 5 s** to interactive cockpit | Render from local cache; warm AI async; never block UI on model load (§52) |
| Patient open | **< 1 s** | Indexed reads + paginated timeline (§15) |
| Search | **< 300 ms** | Postgres + pgvector (HNSW) |
| Session summary (AI) | best-effort with **explicit "AI working" state** | No sub-second promise on Phase-2 GPU (ADR-013) |
| Document generation | **< 2 s** | Local templating |
| Availability | Clinic operational through internet outage | Local DB + local auth (ADR-008) |
| RPO / RTO | **RPO ≤ 24 h (log ≤ 1 h) / RTO ≤ 4 h** | Immutable off-box backups (ADR-024) |
| Audit integrity | Tamper-evident | Append-only + hash-chain (ADR-003/024) |
| Security | Zero-Trust, encrypted at rest, least privilege | §23 |
| Accessibility | Usable under stress; FR/AR/Darija/EN, RTL | §28 |

Performance is **budgeted and monitored** (Principle 23); a feature that blows its budget does not ship until it fits or the budget is formally revised.

---

# PART III — DOMAIN MODEL & ARCHITECTURE

## 11. Bounded domains

MindCare OS is decomposed into **16 bounded domains**. Each domain **owns its tables**, exposes behavior through its API and events, and never reaches into another domain's tables directly (Principle 16). Cross-domain effects happen through events (§20).

| # | Domain | Owns (core entities) | Emits (examples) |
|---|---|---|---|
| 1 | **Identity & Access** | `users`, `roles`, `permissions`, `sessions` | `UserAuthenticated`, `PermissionChanged` |
| 2 | **Consent** | `consents`, `consent_versions`, `consent_events` | `ConsentGranted`, `ConsentRevoked` |
| 3 | **Patient** | `patients`, `patient_contacts`, `patient_flags` | `PatientRegistered`, `PatientUpdated` |
| 4 | **Clinical** | `consultations`, `clinical_notes`, `diagnoses`, `medications`, `prescriptions`, `risk_assessments` | `SessionStarted`, `SessionFinished`, `RiskFlagRaised`, `PrescriptionIssued` |
| 5 | **Scheduling** | `appointments`, `availability_slots`, `queue_entries` | `AppointmentBooked`, `AppointmentCheckedIn`, `NoShowRecorded` |
| 6 | **Reception** | `checkins`, `print_jobs` (operational only) | `PatientCheckedIn`, `DocumentPrinted` |
| 7 | **Communication** | `messages`, `message_templates`, `notifications` | `MessageSent`, `NotificationRaised` |
| 8 | **Aftercare** | `checkins_daily`, `mood_logs`, `sleep_logs`, `homework`, `coach_sessions`, `recovery_index` | `CheckinSubmitted`, `HomeworkCompleted`, `RiskSignalDetected` |
| 9 | **Documents** | `documents`, `certificates`, `document_templates`, `document_counters` | `CertificateIssued`, `DocumentVoided` |
| 10 | **Finance** | `invoices`, `payments`, `prices`, `invoice_counters` | `InvoiceCreated`, `PaymentReceived`, `PriceOverridden` |
| 11 | **Knowledge** | `knowledge_items`, `knowledge_chunks`, `ingestion_jobs` | `KnowledgeApproved`, `KnowledgeRetrieved` |
| 12 | **AI (Jarvis + AgentOS)** | `agents`, `agent_runs`, `memory_*` (§31), `model_registry`, `prompts` | `AgentRunStarted`, `ApprovalRequested`, `ApprovalGranted` |
| 13 | **Analytics** | read-models, `kpi_snapshots` | `KpiComputed` |
| 14 | **Administration** | `clinics`, `settings`, `feature_flags`, `config_versions` | `SettingChanged`, `FeatureFlagToggled` |
| 15 | **Security** | `audit_events`, `secrets_refs`, `deident_decisions`, `access_grants` | `AuditRecorded`, `DeidentificationPerformed` |
| 16 | **Integration** | `tools`, `tool_scopes`, `workflows`, `workflow_runs` | `ToolInvoked`, `WorkflowCompleted` |

The **Digital Twin** (§14) is not a domain — it is a **read-model** projected over Patient, Clinical, Aftercare, Finance, and Analytics tables.

## 12. System architecture

**Style: a modular monolith** (ADR-026) — one deployable process with strict internal module boundaries (one module per domain), extractable into services later without a rewrite. This honors Principle 20 (simplicity) and Principle 28 (future readiness) simultaneously.

```
┌──────────────────────────── Clients ────────────────────────────┐
│  Doctor Desktop (Tauri)   Reception (Web)   Patient Platform (Web)│
└───────────────┬───────────────┬────────────────────┬─────────────┘
                │  REST /v1 (JWT) │  + Realtime (WS)   │
        ┌───────▼───────────────▼────────────────────▼───────┐
        │                 API Gateway (single)                │
        └───────────────────────┬─────────────────────────────┘
        ┌───────────────────────▼─────────────────────────────┐
        │                   KERNEL (no business logic)         │
        │  identity · permissions · event bus · audit · config │
        └───────┬───────────────────────────────┬─────────────┘
        ┌───────▼───────────┐          ┌─────────▼───────────┐
        │  Domain modules   │  events  │   AI plane (Jarvis)  │
        │  (16, §11)        │◄────────►│ AgentOS · Memory ·   │
        │                   │          │ Knowledge · Router   │
        └───────┬───────────┘          └─────────┬───────────┘
        ┌───────▼──────────────────────────────── ▼───────────┐
        │  De-identification Gateway  │  Model Gateway (LiteLLM)│
        └───────┬─────────────────────┴─────────────┬─────────┘
        ┌───────▼─────────────────────┐   ┌──────────▼─────────┐
        │  PostgreSQL / Supabase       │   │ Local GPU (Phase 2)│
        │  (source of truth, pgvector) │   │ / Cloud (de-ID only)│
        └──────────────────────────────┘   └────────────────────┘
        Integration plane: n8n · MCP tool registry (egress-controlled)
```

**Kernel** provides identity, permission checks, the event bus, audit, and configuration — and **contains no business logic** (Principle 16/20). Domains hold all rules. The **AI plane** is reached only through Jarvis, which is the **policy/orchestration authority**, not a runtime relay — inter-agent traffic flows over the governed event bus (ADR-011).

**Deployment topology & trust zones** are specified in §54 (Data / Application / Integration / Observability zones; Tailscale remote access).

## 13. Frozen architecture decisions (ADR index)

The 26 ADRs are the binding decision record; this constitution is consistent with all of them. Summary:

| ADR | Decision (one line) |
|---|---|
| 001 | PII lives only on local PostgreSQL/Supabase inside Algeria |
| 002 | Mandatory, fail-closed de-identification gateway; Tier-0 narrative stays local |
| 003 | CRUD + append-only hash-chained audit + versioned domain events (not event-sourcing) |
| 004 | Digital Twin = materialized read-model, never written directly |
| 005 | ERD, event catalog, permission matrix, state machines are freeze artifacts |
| 006 | Freeze the Buildable Core; defer the 2035 scope |
| 007 | Crisis protocol: immediate non-AI emergency response; "not an emergency service" |
| 008 | One shared local DB; internet-offline not LAN-offline; no per-client write caches |
| 009 | Content trust tiers T0–T3; patient text is data, never instructions |
| 010 | Doctor sole issuer; gapless numbering; content hash + QR verification |
| 011 | Desktop fully usable without AI; agents talk via governed event bus |
| 012 | Ambient transcription deferred until GPU + Darija STT eval + consent |
| 013 | Model registry + VRAM budget + priority queue + honest busy states |
| 014 | Safety-critical config versioned/reviewed/tested like code |
| 015 | Mandatory secrets vault + masked inputs + rotation runbook |
| 016 | One canonical six-store memory model |
| 017 | RBAC+ABAC, field-level authz, RLS; reception/pricing boundaries frozen |
| 018 | Risk engine on validated instruments; decision-support, non-diagnostic |
| 019 | AI evaluation harness + AI-quality budget gate |
| 020 | MCP/n8n least-privilege + egress control + approval gates |
| 021 | Typed, versioned consent state model with revocation events |
| 022 | `clinic_id` + RLS from day one |
| 023 | Patient identity = verified phone; single-use QR enrollment + OTP |
| 024 | RPO ≤ 24h / RTO ≤ 4h; immutable off-box encrypted backups |
| 025 | Docker-Compose topology with explicit trust zones |
| 026 | Confirmed stack: Supabase, Tauri, LiteLLM, n8n, modular monolith, REST/v1 |

## 14. The Digital Twin

The **Digital Twin** is the canonical, unified view of a patient: identity + timeline + clinical state + medications + aftercare signals + risk + financial standing. It is a **materialized read-model** (ADR-004): writes always go to the owning domain; the Twin is refreshed incrementally from domain events (§20) and carries an explicit `as_of` timestamp. It can be dropped and rebuilt from source domains at any time. Graph relationships (relational join tables + pgvector similarity) are **derived**, never primary. The Twin's shape is a **versioned view contract** consumed identically by every client (no client invents its own patient shape — the root cause of prior drift).

---

# PART IV — DATA ARCHITECTURE

## 15. Database architecture

- **Engine:** self-hosted **PostgreSQL** via **Supabase** (Postgres + pgvector + GoTrue auth + Storage + Realtime), local, inside Algeria (ADR-001).
- **Source of truth:** relational **latest-state tables** (ADR-003). One master record per real-world entity (Principle 5).
- **Semantic layer:** **pgvector** with **HNSW** indexes for embeddings (search, memory, knowledge, Twin similarity).
- **Multi-tenancy:** every tenant-scoped table carries **`clinic_id`** from day one; **Row-Level Security (RLS)** policies scope by `clinic_id` and by owning doctor (ADR-022, §22).
- **Access pattern:** clients never touch the DB directly; all access is via the API gateway and domain modules (Principle 18). The only in-clinic exception is the single shared LAN DB connection model (ADR-008), still mediated by the backend.

## 16. Schema overview & entity relationships

High-level relationships (full ERD is the Phase-2 artifact mandated by ADR-005; naming here is canonical):

- `clinics 1—* users`, `clinics 1—* patients` (tenant root).
- `patients 1—* appointments`, `patients 1—* consultations`, `patients 1—* invoices`, `patients 1—* documents`, `patients 1—* consents`.
- `consultations 1—* clinical_notes`, `consultations 1—* prescriptions`, `consultations 1—0..1 risk_assessments`.
- `appointments 1—0..1 checkins`, `appointments 1—0..1 payments`.
- `invoices 1—* payments`; `documents *—1 document_templates`; numbering via `document_counters` / `invoice_counters`.
- `patients 1—* checkins_daily / mood_logs / sleep_logs / homework` (Aftercare).
- `agents 1—* agent_runs`; `memory_*` tables keyed by `clinic_id` + scope (§31).
- `audit_events` append-only, hash-chained, references any entity by `(entity_type, entity_id)`.
- **Digital Twin** = a materialized view/read-model joining Patient, Clinical, Aftercare, Finance, Analytics (§14).

Every table includes standard columns: `id` (uuid), `clinic_id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at` (nullable, soft-delete), `version` (optimistic concurrency where relevant).

## 17. Audit, versioning, soft-delete, retention

- **Immutable audit (ADR-003).** Every state-changing operation writes an append-only `audit_events` row (actor, action, `entity_type`, `entity_id`, before/after digest, `correlation_id`, timestamp) **in the same transaction** as the change, and emits a versioned domain event. Audit rows are never updated or deleted; a **hash-chain** links rows for tamper-evidence (ADR-024).
- **Versioning (Principle 7).** Schemas, prompts, models, certificates, knowledge, templates, agents, and workflows are versioned; historical versions remain retrievable (Principle 8).
- **Soft-delete & archive (Principle 6, BR-8).** `deleted_at` marks records inactive; data is archived, not destroyed. Hard deletion is reserved for legal-erasure obligations and always runs through the human-approval + audit path.
- **Retention.** A per-data-type **retention schedule** (aligned to Algerian medical-record law) is a Phase-2 deliverable; backups honor it (ADR-024). Logs never contain PII or secrets (§23, §50).

## 18. Backup, disaster recovery, synchronization & offline

- **Backup/DR (ADR-024).** Automated encrypted backups with at least one **immutable/append-only off-box copy inside Algeria**; **RPO ≤ 24 h** (transaction log ≤ 1 h), **RTO ≤ 4 h**; **restores are tested on a schedule**; a device-loss/DR runbook exists (§54). Backup encryption keys live in the vault (§23) with a sealed recovery copy.
- **Synchronization / offline (ADR-008).** Phase 1 uses **one shared local PostgreSQL on the clinic LAN**; **per-client offline write caches are forbidden**. "Offline" means **internet-offline, not LAN-offline** — the clinic keeps operating without internet; only cloud-AI degrades (§29). Any future genuinely-disconnected client (e.g., mobile) requires its own sync ADR before it may write.

---

# PART V — BACKEND, API & SECURITY

## 19. Backend architecture

A **modular monolith** (ADR-026): one deployable, **one module per bounded domain** (§11), each exposing a typed internal interface and its API surface. Modules **never import another module's internals** — they call its interface or react to its events. The **Kernel** provides identity, permission enforcement, the event bus, audit, and configuration, and holds **no business logic**. This structure is service-extraction-ready: a module can become a separate service later because its boundary and events already exist.

**Layering inside a module:** `api` (controllers/validation) → `application` (use-cases, orchestration, approval flow) → `domain` (entities, business rules, state machines) → `infrastructure` (repositories, external adapters). Dependencies point inward only.

## 20. Event system

- **Bus:** durable domain events on **PostgreSQL LISTEN/NOTIFY + an `outbox` table** (Phase 1); a dedicated broker (Redis/NATS) is a deferred upgrade if throughput demands it (§53).
- **Contract:** every event is **PascalCase, past tense** (`AppointmentBooked`), **versioned**, with a defined payload schema, producer, subscribers, and **idempotency + ordering guarantees** (the event catalog is the Phase-3/4 artifact, ADR-005).
- **Transactional outbox:** events are written in the same transaction as the state change and audit row (ADR-003), then published after commit — guaranteeing no lost or phantom events.
- **Consumption:** handlers are **idempotent** (keyed by event id) and retried with backoff; agent messaging also rides this bus under permission policy (ADR-011).

## 21. API architecture & conventions

- **Style:** **REST** through a **single API gateway** for all three clients; **versioned** under `/v1`.
- **Resources:** plural nouns, kebab-free lowercase (`/v1/patients`, `/v1/appointments`, `/v1/consultations/{id}/notes`).
- **Auth:** **JWT** access tokens (short-lived) + refresh + server-side revocation; issued by Supabase GoTrue; every request is permission-checked (§22).
- **Mutations:** require an **`Idempotency-Key`** header; the gateway dedupes retries.
- **Errors:** a **standard error taxonomy** — stable machine `code`, human `message`, `details[]`, `correlation_id` — with consistent HTTP status mapping (`400/401/403/404/409/422/429/5xx`). Never leak internals or PII in errors.
- **Realtime:** **WebSocket / Supabase Realtime** powers the "no refresh" UX; subscriptions are permission-scoped.
- **Pagination:** cursor-based on all list/timeline endpoints.
- **Contract-first:** the OpenAPI spec (Phase 3) is the source of truth for shapes; clients generate types from it.

## 22. Authentication & authorization

- **Authentication.** Doctor/admin: password + PIN/passkey + optional 2FA, with defined session lifetime and lockout; auto-launch-with-Windows still requires OS lock + app auth so an unlocked PC never exposes records (§23). Patient: **verified phone + credential**, onboarded via single-use QR + OTP (ADR-023).
- **Authorization = RBAC + ABAC, enforced defense-in-depth (ADR-017).**
  - The **permission matrix** (role × resource × field × action, incl. **per-agent AI scopes**) is the single source of authorization truth (Phase-2/3 artifact).
  - **Row-level:** Postgres **RLS** scoped by `clinic_id` + owning doctor.
  - **Field-level:** application-layer authorization hides columns RLS cannot (the multi-client leak fix).
  - **ABAC attributes:** owning doctor, patient assignment, **consent state** (§46), time/context.
  - **Default-deny:** any unlisted field/action is denied.
  - **Reads are audited**, not only writes (insider-threat control).
- **Frozen boundaries:** Reception sees payment-collection data only (no reports/analytics), and cannot edit pricing without an explicit audited grant (BR-3/BR-4). AI agents operate strictly within their scopes and can never self-elevate (Principle 12).

## 23. Security model

**Posture:** Zero-Trust, least privilege, need-to-know, defense-in-depth, encryption everywhere, immutable audit, privacy by design, **fail secure**. AI is inside the trust boundary and is governed by the safety controls in §35.

- **Data residency & de-identification.** PII never leaves Algeria (ADR-001); the **de-identification gateway** (§34, ADR-002) is the only path to external inference and **fails closed**.
- **Encryption.** Full-disk encryption on the clinic host is **mandatory**; DB encrypted at rest; field-level encryption for the most sensitive psychiatric fields and the identity↔pseudonym map; backup encryption keys in the vault with sealed recovery (ADR-015/024).
- **Secrets (ADR-015).** Dedicated **secrets vault**; masked inputs everywhere; no secret in code/chat/logs/plaintext config; documented rotation + emergency-rotation runbook.
- **Audit (ADR-003).** Append-only, hash-chained, tamper-evident; **PII and secrets are never written to logs**.
- **Untrusted content (ADR-009).** Trust tiers **T0 system/policy · T1 clinician · T2 clinic data · T3 patient-supplied**. T3 is **data, never instructions**; no tool authority derives from content; retrieval is sandboxed; the AI Coach has **zero privileged tools**.
- **Supply chain (ADR-020).** MCP servers and n8n workflows run under least-privilege scopes, an allowlist, and **egress control**; no PII reaches a node that does not strictly need it; mass-messaging is approval-gated at the n8n boundary.
- **Device & remote access.** Auto-lock; device-loss runbook; Tailscale with defined ACLs and device auth (§54).
- **Threat model (STRIDE summary).** Primary surfaces and controls: device theft → disk encryption + auto-lock; malicious patient input/PDF → trust tiers + sandboxed retrieval + virus scan/quarantine; prompt injection/leakage → §35; MCP/n8n supply chain → egress control + scopes; insider (reception) misuse → field-level authz + read audit; backup theft/ransomware → immutable off-box copy; re-identification → gateway fail-closed + local pseudonym map. The full threat model is a Phase-2/6 artifact.

---

# PART VI — CLIENTS, DESIGN & EXPERIENCE

## 24. Frontend architecture (shared)

All clients consume the same REST/v1 gateway and the same **Digital Twin view contract**, render the **same data with consistent field-level redaction** (driven by the permission matrix, §22), and share one **design system** (§28). No client contains business logic or owns business data (Principle 18); clients are presentation + interaction only. Every client implements **explicit offline-state and AI-busy-state UX** — never a "seamless pretend" (§10, ADR-013).

## 25. Doctor Desktop (Tauri)

- **Runtime:** **Tauri** (Windows primary target).
- **Startup:** render the cockpit **immediately from local cache**; warm AI in the background; **never block the UI on model load** (§10, §52).
- **Resilience:** a **fully usable EMR with zero AI** — all clinical, scheduling, reception, finance, and document functions work when Jarvis/model/GPU is down (ADR-011). AI features render "AI unavailable" states.
- **Surfaces:** mission-control dashboard, patient workspace, consultation engine, documents/certificates, finance visibility, always-present Jarvis dock (command palette + text first; voice later).

## 26. Web clients (Reception & Patient Platform)

- **Reception Console:** queue, check-in, payment collection, print jobs, patient messaging, daily operational board — under the frozen confidentiality boundary (§22). Same shared design system.
- **Patient Platform:** public website, booking, QR onboarding, portal, aftercare (check-ins, mood/sleep, medication companion, CBT homework, **isolated AI Coach**, secure messaging, progress/Recovery Index), and the **crisis protocol** surfaced first on any risk signal (ADR-007).

## 27. Mobile (Roadmap)

Mobile is **deferred**. When built, it reuses the REST/v1 contract and design system; because it may operate genuinely disconnected, it requires its own **sync ADR** before it may write (ADR-008). No mobile requirement may leak into Core v1 effort (ADR-006).

## 28. Design system, motion & accessibility

- **Design system.** One token-based system (color, type, spacing, elevation, components) shared across Desktop, Reception, and Patient clients; a single source for components guarantees visual and behavioral consistency.
- **Motion.** Purposeful, calm, and fast; motion communicates state (loading, success, AI-working) and never decorates. Respect reduced-motion preferences.
- **Accessibility (Principle 26).** Usable by clinicians under stress: fast, readable, high-contrast, keyboard-navigable, large touch targets. **Languages at launch: French, Arabic, Darija, English**, with **RTL** support. Clinical text must remain legible and unambiguous; the "AI got it wrong" one-click correction loop is a first-class UI affordance (feeds bounded learning, §31/§43).

---

# PART VII — AI ARCHITECTURE

## 29. Jarvis (the orchestrator, not a model)

Jarvis is a **stable orchestration layer** over swappable LLMs — the single best idea in the architecture and the source of vendor independence (Principle 13). Jarvis owns **identity, memory, knowledge access, context assembly, model routing, tool calling, the approval flow, and policy**; it does **not** own the model, and it is **not a runtime message relay** for agents (ADR-011).

**Every Jarvis action follows *propose → confirm → execute → log*:**
1. **Propose** — assemble context, reason, produce a suggestion with reason/evidence/confidence/sources (Principle 14).
2. **Confirm** — for any write or critical action, request human approval (Principle 3).
3. **Execute** — act only within the actor's permissions (Principle 12); tools require authority the content cannot grant (ADR-009).
4. **Log** — write the audit trail and emit events (ADR-003).

Jarvis is a **single point of AI value but not a single point of clinic failure**: the Desktop remains a full EMR without it (ADR-011).

## 30. AgentOS (the agent society)

A society of **specialized agents**, each with: an **identity**, **isolated scoped memory**, **explicit permissions** (per-agent scopes in the matrix, §22), a **model selection/routing policy**, and **measurable KPIs**. Agents **never call each other directly**; they communicate over the **governed event bus** under Jarvis-defined policy (ADR-011).

**Core v1 agent set (bounded — not 100+):** Clinical, Scheduling, Reception, Communication, Aftercare/Coach, Documents, Finance, Knowledge, Analytics, Security, Workflow. Additional agents are **Roadmap**, added one at a time behind their own scope + eval gate. The patient-facing **AI Coach** is a permanently **sandboxed** agent with **zero privileged tools**, strict allow-scope, and refusal/escalation rules routing to the crisis protocol (ADR-007/009).

## 31. Memory architecture (canonical six-store model)

Exactly **six typed memory stores** (ADR-016), each with defined storage, owner, retention, and permission scope. This replaces the five conflicting prior models.

| Store | Purpose | Storage | Scope / retention |
|---|---|---|---|
| **Working** | current task/session context | in-memory + ephemeral rows | session; discarded after |
| **Episodic** | approved doctor actions & interactions | Postgres + pgvector | doctor-scoped; long-lived, versioned |
| **Semantic (Knowledge)** | approved clinical/knowledge facts | Postgres + pgvector | clinic scope; **approval-gated** (§36) |
| **Procedural** | learned workflow/behavioral preferences | Postgres | doctor-scoped; versioned |
| **Doctor profile** | the doctor "digital twin" preferences | Postgres | doctor-scoped |
| **Patient memory** | per-patient longitudinal context (read-model over §14) | pgvector + relational | patient-scoped; permissioned |

**Rules:** (1) **medical facts never auto-mutate** — Semantic memory changes only through the approval sandbox (Principle 15, §36); (2) memory **never bypasses permissions** — every read is permission-checked (Principle 12); (3) each store is **versioned** and **explainable** — memory-derived suggestions cite their source memory (Principles 7/14). Richer stores (emotional, correction, relationship, business) are **Roadmap** and, if added, extend this table via ADR — never replace it.

## 32. Context & prompt architecture

- **Context assembly** draws from the six memory stores + retrieved knowledge + the Digital Twin, compressed to fit the active model's window with an explicit **retrieval/context budget** (Phase-2 model sizes force discipline). Truncation is deterministic and logged.
- **Prompts are versioned artifacts** (Principle 7) stored in the AI domain (`prompts`), with rollback. **Safety-critical prompts** are classified T0, reviewed and tested like code (ADR-014), and treated as **secrets** (§23).
- Every prompt records which model, version, and memory/knowledge sources it used, so any output is reproducible and explainable.

## 33. Model gateway, routing & GPU

- **Gateway:** **LiteLLM** — model-agnostic; the cloud→local migration is a **config swap, not a rebuild** (Principle 13).
- **Model registry as data (ADR-013):** per task → **model** → **VRAM budget** → **privacy tier** (`Always-Local` / `Prefer-Local` / `Cloud-Allowed` / `Cloud-Only` / `Disabled`) → **fallback chain**.
- **Privacy routing:** Tier-0 clinical narrative is **Always-Local** (ADR-002); only de-identified, `Cloud-Allowed` traffic may reach an external provider.
- **GPU reality (Phase 2):** single-GPU heavy tasks run **serially** behind a **priority queue** (interactive doctor tasks > background consolidation/research/embeddings); a **load/unload policy** keeps a bounded working set warm within the VRAM budget; nightly batch jobs are windowed away from clinic hours and backups. AI features show **explicit "AI working" states** — no false real-time promises (§10).

## 34. De-identification gateway

The **legal linchpin** (ADR-002). Mandatory subsystem between the application and every external inference provider:
1. Content is classified by trust tier (§23). **Tier-0 (raw clinical narrative, journals, transcripts) never leaves the clinic** — local models only (CPU in Phase 1 with accepted latency, GPU in Phase 2).
2. Structured identifiers (name, phone, national ID, address, DOB, kin/place names) are replaced with **stable per-patient pseudonyms** before any cloud call.
3. The **identity↔pseudonym map lives only in the local encrypted DB**, access-controlled and audited; it is never transmitted.
4. A **hard allowlist** defines what may ever leave; unclassifiable content is treated as Tier-0 (**fail closed**).
5. Every decision is audited (`DeidentificationPerformed`).
6. Narrative NER de-identification may be enabled **only after** it passes the de-identification-recall gate (§35); until then, narrative → local-only.

## 35. AI safety, evaluation & the AI-quality budget

- **Safety firewall.** Every AI response is validated for permission compliance, context isolation, injection resistance, and leakage, with **fail-closed** behavior. Patient-supplied content cannot authorize tools (ADR-009); the Coach cannot invoke privileged tools at all.
- **Evaluation harness (ADR-019).** Versioned gold sets + metrics for at least: **(a) de-identification recall**, **(b) summary faithfulness**, **(c) risk-flag sensitivity/specificity**, **(d) Darija/Arabic STT WER**, **(e) retrieval citation accuracy**. Eval runs are **CI gates** for AI-affecting changes and safety-critical config.
- **AI-quality budget.** Mirroring the performance budget: **an AI feature reaches auto-action/production only when it passes its threshold; below threshold it stays a draft/suggestion requiring doctor confirmation — never an autonomous action.** This operationalizes Principles 2, 4, 14, 25.
- **Bounded learning (Principle 15).** Jarvis learns workflow/behavioral preferences from **approved** actions; **medical facts never auto-mutate**; new knowledge passes the sandbox (§36). The one-click correction loop (§28) feeds this safely.
- **Risk engine (ADR-018).** Uses **validated instruments (PHQ-9, GAD-7, a validated suicidality item)** as primary signals, journal/sleep trends as secondary non-diagnostic context; transparent, explainable scoring; **false-negative-conscious** (ambiguous cases escalate); decision-support, never diagnosis; routes through the crisis protocol (§42, ADR-007).

## 36. Tools, MCP & n8n integration

- **Tool registry** stores tools and their **least-privilege scopes** as data; nothing runs by default (ADR-020).
- **MCP servers** (Composio + self-hosted) and **n8n workflows** run under allowlist + **egress control**; **no PII reaches a node that doesn't strictly need it** (always downstream of the gateway, §34); mass-messaging is **approval-gated at the n8n boundary** (Principle 3).
- **Knowledge ingestion** is **approval-gated**: uploads are virus-scanned, quarantined, and enter active retrieval only after doctor approval with provenance/confidence recorded; **provenance gates retrieval** (anti-poisoning). This is how Semantic memory (§31) grows safely.
- All tool invocations are audited (`ToolInvoked`); tool authority derives from the **actor's** permissions, never from content.

---

# PART VIII — DOMAIN WORKFLOWS & STATE MACHINES

*Canonical lifecycles. Allowed transitions and emitted events are binding; the full state-machine artifact is delivered per ADR-005.*

## 37. Scheduling & Calendar

**Appointment lifecycle:** `requested → booked → confirmed → checked_in → in_consultation → completed` with side-paths `→ cancelled`, `→ no_show`, `→ rescheduled`. Events: `AppointmentBooked`, `AppointmentConfirmed`, `AppointmentCheckedIn`, `NoShowRecorded`, `AppointmentRescheduled`. Reminders are sent via Communication (consent-checked). Predictive no-show scoring is Roadmap.

## 38. Reception

Reception operates the front of the appointment lifecycle (`checked_in`) and payment collection, within the frozen confidentiality boundary (§22). On check-in, `PatientCheckedIn` updates the doctor's queue in realtime. When the doctor finishes a session and adjusts price, Reception receives the updated amount to collect (BR-3). Reception prints documents already issued by the doctor (never issues them).

## 39. Clinical & Consultation

**Consultation lifecycle:** `scheduled → started → documented → signed → closed` (side-path `→ amended` with full version history, Principle 7/8). Events: `SessionStarted`, `SessionFinished`, `PrescriptionIssued`, `RiskFlagRaised`. On `SessionFinished`, downstream domains react via events (Finance prepares payment, Aftercare activates, Analytics updates, Jarvis updates Episodic memory). AI may **draft** notes/summaries as suggestions with sources; the doctor signs. Ambient transcription is **deferred** (ADR-012). Clinical decision support is non-diagnostic (Principle 2, §35).

## 40. Documents & Certificates

**Document lifecycle:** `draft → confirmed → issued → (voided)`. AI may prepare a **draft**; **the doctor is the sole issuer** (BR-1). On issuance: allocate the **next gapless number** from the counter table (BR-2), write a **content hash** to the audit chain, and generate a **QR** that resolves to a verification record proving "this exact content was issued by this doctor under this number on this date" (ADR-010). Voided documents are marked void, never deleted. Digital signature is a Roadmap upgrade.

## 41. Finance

**Invoice/payment lifecycle:** `invoice.draft → issued → (paid | partially_paid | void)`; `payment.recorded → reconciled`. Pricing is doctor-owned; overrides emit `PriceOverridden` (audited). Gapless invoice numbering (BR-2). **Revenue analytics are doctor-only** (BR-4). Events: `InvoiceCreated`, `PaymentReceived`, `PriceOverridden`. Forecasting is Roadmap.

## 42. Aftercare, Patient Platform & Crisis Protocol

Aftercare provides check-ins, mood/sleep tracking, medication companion, CBT homework, the **isolated AI Coach**, secure messaging, and progress via the **Recovery Index** (one canonical name; the prior "Recovery Score" is retired). All processing is **consent-gated** (§46).

**Crisis protocol (ADR-007) — non-negotiable:**
1. On any high-risk signal, the app **immediately** shows **local Algerian emergency resources** and "**If you are in danger, contact emergency services now**" — it **never** routes a patient in acute crisis into an AI conversation.
2. The app states in writing, accepted as consent: "**This application is not an emergency service and is not monitored 24/7.**"
3. Clinician escalation is **bounded by an SLA tied to clinic hours**; after-hours signals queue top-priority for next clinic-open review, while the patient has already received step 1.
4. Risk detection is **decision-support, never autonomous action**; the doctor owns all follow-up. Every signal, response, and escalation is audited. Emits `RiskSignalDetected` / `RiskFlagRaised`.

## 43. Knowledge OS

Ingestion → **approval sandbox** → RAG retrieval with **citations** and **provenance/confidence gating** (§36). Feeds Semantic memory (§31) and Jarvis/agents. Medical facts never auto-mutate (Principle 15). Faithfulness and citation accuracy are eval-gated (§35). Research engine is Roadmap.

## 44. Communication & Notifications

Channels: **WhatsApp (Evolution API)** and email, via templated messages. **Mass-messaging is human-approval-gated at the n8n boundary** (Principle 3, ADR-020). The **notification/escalation engine** enforces a strict **priority model with quiet hours** to prevent alert fatigue for a solo doctor (Principle 26); only meaningful, top-priority items interrupt. Consent governs channel use (§46).

## 45. Analytics & Reporting

Operational dashboards and KPIs computed from **read-models** (not the audit event store), refreshed via events. Doctor-facing clinic analytics are Core; **patient-risk/predictive analytics are Roadmap and, when built, are explicitly non-diagnostic and gated** (§35). Reception has no analytics access (BR-4).

## 46. Consent

A dedicated domain (ADR-021). Consent **types** (data processing, aftercare monitoring, ambient audio, caregiver access, communication channel), each with **versioned text** and a state machine `requested → granted → (revoked | expired)` capturing the exact accepted version. **Revocation emits `ConsentRevoked`** which propagates to dependent domains (e.g., revoking monitoring stops risk scoring; revoking ambient-audio disables capture). Consent is an **ABAC precondition** checked before processing (§22). Crisis-protocol disclosures are recorded as accepted consent.

---

# PART IX — ENGINEERING PRACTICE

## 47. Monorepo & folder structure

A single monorepo. Each top-level folder has one responsibility; AI agents and humans place code by domain, never by accident.

```
mindcare-os/
├── apps/
│   ├── desktop/            # Tauri doctor cockpit
│   ├── reception-web/      # Reception console
│   └── patient-web/        # Public site + portal + aftercare
├── backend/                # Modular monolith
│   ├── kernel/             # identity, permissions, event bus, audit, config (NO business logic)
│   └── modules/            # one folder per bounded domain (§11)
│       ├── identity/  consent/  patient/  clinical/  scheduling/
│       ├── reception/ communication/ aftercare/ documents/ finance/
│       ├── knowledge/ ai/  analytics/ administration/ security/ integration/
│       └── <module>/{api,application,domain,infrastructure}
├── ai/
│   ├── jarvis/             # orchestrator
│   ├── agents/             # AgentOS agents
│   ├── memory/             # six-store implementation (§31)
│   ├── gateway/            # LiteLLM routing + model registry
│   ├── deident/            # de-identification gateway (§34)
│   ├── prompts/            # versioned prompts
│   └── evals/              # gold sets + harness (§35)
├── packages/               # shared: types (from OpenAPI), design-system, ui, utils, config
├── database/               # migrations (forward-only), seeds, RLS policies, ERD
├── workflows/              # n8n definitions + scopes/egress config
├── infra/                  # docker-compose, trust-zone config, Tailscale ACLs, vault
├── tests/                  # unit, integration, security, ai-eval, e2e
├── scripts/                # deploy, backup, restore-test, rotate-secrets
├── ci/                     # pipelines + gates
└── docs/                   # this constitution + ADRs + generated contracts
```

**Rules:** no cross-module imports of internals; shared code lives in `packages/`; clients import generated types from the OpenAPI contract, never hand-written duplicates; the **mock-data isolation pattern** keeps test/mock data out of production paths.

## 48. Naming conventions

- **Tables:** `snake_case`, plural (`patients`, `clinical_notes`, `audit_events`). Standard columns per §16.
- **Domain events:** `PascalCase`, past tense (`AppointmentBooked`, `ConsentRevoked`).
- **API resources:** lowercase plural nouns under `/v1` (`/v1/appointments`).
- **Agents:** `PascalCase` + `Agent` (`ClinicalAgent`).
- **Prompts / configs / migrations:** versioned, prefixed, timestamped where relevant.
- **Code:** language-idiomatic (`camelCase` functions/vars, `PascalCase` types/components, `SCREAMING_SNAKE` constants).
- Names in this constitution are the **only** sanctioned names; introduce a new one only via §58.

## 49. Coding standards

- **Typed everywhere.** Types flow from the OpenAPI contract and DB schema; no `any` on public boundaries.
- **Inward dependencies only** (§19). Business rules live in `domain`, orchestration in `application`.
- **No duplication** (Principle 5 at the code level); shared logic goes to `packages/`.
- **Never break an existing API** (Principle 8/27); change via versioning.
- **Security in every change** (Principle 10): permission check, input validation, no PII in logs.
- **AI-agent coding rules (Principle 29/33):** read this constitution first; explain architectural decisions in the PR; never invent entities/events/endpoints outside the canonical names; plan-mode-first for non-trivial work; respect checkpoint discipline.

## 50. Error handling, logging, monitoring & observability

- **Errors:** standard taxonomy (§21); fail secure; never expose internals or PII.
- **Logging:** structured, correlation-id-threaded; **PII and secrets are never logged** (§23). Audit is separate from operational logs (§17).
- **Monitoring (solo-operator-appropriate):** DB health, backup success, GPU/temperature, AI error rate, event-bus lag — with **local alerting**; **Langfuse** for AI tracing/quality. SLIs are defined per critical path.
- **Observability principle:** for anything that happens, we can reconstruct who, when, why, how (Principle 24/31).

## 51. Testing strategy

Because much code is AI-generated, guardrails are the quality system.
- **Test pyramid:** unit (domain rules, state machines) → integration (module + DB + events) → security (authz, RLS, injection) → **AI-eval** (the harness, §35) → e2e (critical user journeys, §7).
- **CI gates (§55):** no merge without passing unit/integration/security **and** the relevant AI-eval thresholds and safety-critical-config gates (ADR-014/019).
- **Definition of Done includes an eval pass** for any AI feature (§56).

## 52. Performance targets

The budgets in §10 are binding and monitored (Principle 23). Key engineering rules: render clients from local cache first; warm AI asynchronously; paginate timeline/Twin reads; index hot paths (B-tree + pgvector HNSW); window nightly batch jobs away from clinic hours/backups; show honest AI-busy states instead of implying sub-second AI (ADR-013). A feature that misses its budget does not ship until it fits or the budget is formally revised.

## 53. Scalability strategy

Scale is judged on two axes: *can the frozen architecture grow without redesign*, and *is the far-future scale realistic* (defer it).
- **Cheap forward-compatibility taken now:** `clinic_id` + RLS from day one (ADR-022), versioned events (§20), the AI gateway abstraction (§33), governed agent bus (ADR-011), modular boundaries (§19).
- **Known bottlenecks & the plan:** maintainer capacity (dominant → scope cut, §57); single clinic PC + single GPU (serial AI, priority queue); single Postgres (fine to tens of doctors; read-replicas/partitioning later); event bus (Postgres now, broker later); tenant boundary (already present).
- **Deferred (expensive) work:** HA, multi-region, GPU clusters, federation — each behind its own future ADR (§57). The "no redesign ever" claim is treated as aspirational, not literal.

## 54. Deployment strategy

Phase 1: **Docker-Compose on clinic-controlled hardware inside Algeria** (ADR-025), with trust zones:
- **Data zone (highest trust):** Postgres/Supabase, object storage, secrets vault, pseudonym map — no internet exposure; full-disk encryption mandatory.
- **Application zone:** API gateway, domain modules, Jarvis/AgentOS, event bus.
- **Integration zone:** LiteLLM, n8n, MCP servers — the only outbound-egress components, allowlisted, always downstream of the de-identification gateway.
- **Observability:** Langfuse + local health checks with local alerting.
- **Remote access:** Tailscale with ACLs + device auth to the single local DB (never a separate store).
- **Runbooks:** device-loss/DR, restore-test, secret-rotation (scripts in `scripts/`).

## 55. CI/CD

Forward-only DB migrations with backward-compatibility guarantees (Principle 8). Pipelines run lint/type → unit/integration/security → AI-eval gates → build → (manual approval) deploy. Safety-critical config changes pass the same gates as code (ADR-014). Secrets are injected from the vault, never committed. Every release is reproducible and rollback-able.

---

# PART X — GOVERNANCE, ROADMAP & GLOSSARY

## 56. Definition of Done

A unit of work is **done** only when: it conforms to this constitution and the relevant contracts; it has unit + integration + security tests passing; **AI features pass their eval thresholds** (below threshold → suggestion-only, never auto-action); permissions and RLS are enforced and read/write audited; no PII/secret reaches logs; performance fits budget; docs (purpose/API/config/tests) are updated (Principle 29); and, for critical/clinical/legal actions, the human-approval path is present and audited.

## 57. Roadmap

- **Buildable Core v1 (frozen, ADR-006):** Identity · Consent · Patient · Clinical (read→write) · Scheduling · Reception · Aftercare + crisis · Documents/Certificates · Finance (basic) · Jarvis (propose-confirm-execute-log) · one Knowledge/RAG · Security · Audit — on local Postgres + cloud LLM via the de-identification gateway. **The doctor can run this MVP now.**
- **Near-term, evidence-gated:** ambient transcription (GPU + Darija STT eval + consent, ADR-012); local GPU inference (ADR-013); richer analytics.
- **Deferred (2035 vision — roadmap, not built in v1):** 100+ agents, multi-GPU orchestration, federated learning, private medical foundation model, VR, wearables, plugin/agent marketplaces, multi-clinic/multi-region HA, debate/opportunity/expansion engines. **These may not consume v1 effort and may not leak requirements into v1 contracts.** Each re-enters only via its own ADR, gated on its named precondition.

## 58. Change control (how this constitution changes)

This document is **living but disciplined**. A change requires: (1) a proposed diff with rationale; (2) if it alters a frozen decision, a **superseding ADR** recording why the prior decision no longer holds; (3) consistency review across affected sections; (4) version bump. No engineer or agent introduces a competing convention locally — the fix is to change the constitution, not to work around it. The precedence rule stands: **constitution > ADRs > (silence → propose a change).**

## 59. Technical glossary

- **ABAC** — Attribute-Based Access Control (owning doctor, consent state, context).
- **AgentOS** — the society of specialized AI agents.
- **AI-quality budget** — release gate; AI ships to auto-action only above its eval threshold.
- **Buildable Core v1** — the frozen MVP scope.
- **`clinic_id`** — tenant discriminator present on every scoped table from day one.
- **De-identification gateway** — mandatory, fail-closed subsystem stripping identity before external inference.
- **Digital Twin** — materialized read-model unifying a patient's state; never written directly.
- **Domain event** — versioned, past-tense fact emitted on state change.
- **Jarvis** — the AI orchestrator (not a model); policy/memory/routing/tools authority.
- **Loi 18-07** — Algerian data-protection law; source of the residency invariant.
- **Modular monolith** — one deployable with strict per-domain module boundaries.
- **Propose → confirm → execute → log** — the mandatory autonomy discipline for AI writes.
- **Recovery Index** — canonical progress metric (retires "Recovery Score").
- **RLS** — Postgres Row-Level Security, scoped by `clinic_id` + owning doctor.
- **Trust tiers (T0–T3)** — content trust levels; T3 (patient-supplied) is data, never instructions.

---

*End of the MindCare OS Engineering Constitution. This document is the permanent, canonical source of truth. Build from it.*





