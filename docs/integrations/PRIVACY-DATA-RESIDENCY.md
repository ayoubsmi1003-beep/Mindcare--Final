# Data residency and privacy assessment

> Binding rules applied: `CLAUDE.md` R1 (nothing identifying leaves the machine; every
> external call through `src/server/egress/external-call.ts` after pseudonymisation),
> `docs/02-SECURITY-BOUNDARY.md` (**Tier 0 includes phone numbers: "never leaves, under any
> pretext"**), ADR-034 (single egress, closed purposes), Law 18-07 (health data is sensitive;
> transfers abroad are restricted — a lawyer must confirm the exact articles and procedure).
> Statements about providers below are from general knowledge as of 2026 and are marked
> **verify** where a contract or current documentation must be checked before production.

## 1. Data classes

| Class | Examples | Tier (02-SECURITY-BOUNDARY) |
|---|---|---|
| A · Public clinic information | address, hours, services, procedure, doctor-approved FAQ | Tier 3 — may leave |
| B · Ordinary administrative message | "Do you have a slot on Thursday?" (without name) | Tier 3 only if no identifier is attached |
| C · Contact identifiers | phone number, WhatsApp id, Instagram/Facebook user id, name | **Tier 0 — never leaves** |
| D · Appointment-request metadata | preferred day/period, channel, consent flags | Tier 0 once joined to C |
| E · Sensitive narrative typed by a person | "I can't sleep and I think about dying" | **Tier 0/1 — never leaves** |
| F · Patient record (notes, diagnoses, prescriptions) | anything behind `app.get_patient` | **Tier 0/1 — never leaves** |

## 2. The ten questions, per party

| # | Question | Meta (WhatsApp/FB/IG) | Gateway (Algeria VPS, recommended) | n8n Cloud | LLM / image provider | Website relay (Vercel + Upstash, exists) | Composio (exists) |
|---|---|---|---|---|---|---|---|
| 1 | What it receives | C + B/E as typed by the person; every reply the clinic sends (C + text) | Meta webhooks (C, B, E); clinic replies to route | must be **opaque ids only** | A only (public topics) or marketing text | C + D (website form) | today: real recipient (C) + text |
| 2 | What the webhook receives | full message JSON incl. phone and text | — | — | — | — | — |
| 3 | What n8n Cloud would receive | — | — | if misused: everything; allowed: event types + opaque ids for social workflows | — | — | — |
| 4 | What AI providers receive | — | — | — | normalised public topics; never C/E/F | — | — |
| 5 | Stored where | Meta data centres, outside Algeria (location not chosen by the clinic — **verify** Cloud API local-storage options; Algeria is not expected to be one) | Algeria (VPS) — encrypted queue, short retention | EU (**verify**) | provider-dependent | US/EU (Vercel, Upstash) — payload encrypted at rest by the relay | US |
| 6 | Logged where | Meta | must log ids and codes only | n8n execution logs keep payloads by default — must be disabled/pruned | provider logs | relay keeps metadata only (hashes, states) | Composio logs (**verify**) |
| 7 | Retention | Meta policy | request queue ≤ 72 h after ack (as the website relay) | must be minimal | provider policy | payload 72 h, receipt metadata 30 days (`booking-durable.ts`) | unknown |
| 8 | Location verifiable by the clinic? | No | Yes (contract + host) | Partly | Rarely | Partly | No |
| 9 | Satisfies the current rules? | **No** for C/E: replying sends a phone number (Tier 0) abroad | **Yes** if it stays in Algeria and keeps C off the clinic→outside leg | Only for class A/marketing | Only for class A/marketing | Clinic side: inbound only, status replies carry no identity; website hosting itself is governed by its own approval flags (D8) | **No** (unpseudonymised C + text) |
| 10 | Decision required | **D1**: owner-signed ADR-042 + Law 18-07 review | **D2**: hosting choice + contract | keep it out of patient flows | already covered by R1/ADR-034 | **D8** | **D3**: retire for WhatsApp/FB |

**Never claim the data stays local because PostgreSQL is local.** A WhatsApp conversation is
held by Meta before the clinic ever sees it, and every reply is processed by Meta abroad.

## 3. Verdict

- **Production WhatsApp, Facebook and Instagram messaging: BLOCKED.** The binding rule says a
  phone number never leaves; Meta requires one to deliver a message. No amount of engineering
  removes that leg. Only an explicit, owner-signed decision can (draft below), after a legal
  review of cross-border transfer under Law 18-07.
- **Social publishing of marketing content (class A): not blocked by residency**, because no
  personal data is involved. It still needs the approval workflow (SOCIAL-CONTENT.md).
- **Website requests:** from the clinic's side the flow is inbound and status replies carry no
  identity. The website's own hosting abroad is decided by its existing flags
  `MINDCARE_CLOUD_RELAY_APPROVED` / `MINDCARE_EDGE_RESIDENCY_APPROVED` (D8). The clinic poller is
  not built until that decision is recorded.
- **Composio path (existing, 112–118):** sends real recipients and text to a US intermediary.
  It must not be activated for patients. Recommendation D3: retire it for WhatsApp/Facebook in
  favour of the direct Meta Cloud API at the gateway.

## 4. Draft — ADR-042 "Contact-channel exception" (NOT adopted; owner's act)

> Status: **PROPOSED**. Adding it to `docs/00-DECISIONS.md` is the owner's decision, not an agent's.

1. **Scope.** Only for a person who **initiates** contact through WhatsApp/Messenger/Instagram.
   The clinic may answer in the same channel. No outbound first contact, no mass messaging.
2. **Data allowed on the Meta leg.** The person's own channel identifier and administrative
   text (classes A, B). Never class F. The agent never quotes clinical content back.
3. **Sensitive narrative (E).** Detected locally and deterministically; the conversation stops,
   a doctor-approved fixed text is sent, staff are notified inside MindCare (references only).
4. **Minimisation.** The gateway keeps the phone↔opaque-token map; the clinic stores the phone
   in `pending_patients` only once a request is made; n8n and LLMs only see opaque tokens.
5. **Consent.** First reply carries a short notice (what is processed, by whom, where); opt-out
   honoured via `communication_consents`.
6. **Retention.** Gateway queue ≤ 72 h after ack; clinic rows follow MindCare retention (D5).
7. **Legal.** Activation only after a written Law 18-07 review (cross-border transfer
   authorisation by the national authority, if required).

## 5. Threat model (STRIDE, condensed)

| Threat | Where | Mitigation (status) |
|---|---|---|
| Spoofed webhook | gateway | `verifyMetaSignature` X-Hub-Signature-256 on the raw body (implemented, tested); dedupe on provider message id (design) |
| Replay of a request | clinic intake | `submissionId` idempotency + digest conflict, advisory lock (implemented, tested incl. concurrency) |
| Flooding the agenda from a public channel | intake | unlinked requests hold no slot (063/117), 3 per phone per 24 h (implemented, tested) |
| Privilege escalation via the intake actor | DB | NOLOGIN role, INSERT-only policies with fixed values, no read on appointments/patients (implemented, tested) |
| Clinical text smuggled in a request | intake | closed key sets in Zod **and** SQL; no free-text field exists (implemented, tested) |
| Prompt injection from a patient message | future agents | messages are data; agents cannot call Jarvis tools; allowlisted capabilities only (design) |
| Data leak through logs | all | intake never logs the request; notifications carry ids only (implemented, tested); n8n logs pruned (design) |
| Confirmation without a human | DB | confirm refuses an unlinked request; accept requires a staff session + RLS (implemented, tested) |
| Approved post swapped after approval | future social | approval bound to version + content hash recomputed at publish (design) |
| Exposure of the clinic | network | no ingress; outbound polling only (design, consistent with existing proxy) |

## 6. Hosting comparison (n8n and the gateway)

| Option | Residency | Privacy | Cost | Ops effort | Availability | Connectivity to clinic | Verdict |
|---|---|---|---|---|---|---|---|
| n8n Cloud | EU (**verify**) | payloads in a third-party SaaS | subscription | lowest | high | n8n cannot reach the clinic (no ingress); needs a gateway anyway | **only for social/marketing workflows** |
| VPS abroad (n8n self-hosted) | foreign | operator-controlled | low | medium (updates, backups) | depends | outbound polling from clinic | acceptable for class A only |
| **Gateway + n8n on an Algeria-hosted VPS** | **Algeria** | operator-controlled, encrypted queue | low–medium | medium | depends on host SLA | clinic polls outbound | **recommended** |
| On-premise at the clinic | Algeria | best | hardware | high | clinic uptime, internet line | would need inbound exposure for Meta webhooks — **forbidden** | rejected for webhooks |

## 7. Risk register

| Risk | Likelihood | Impact | Owner action |
|---|---|---|---|
| WhatsApp activated without ADR-042 | medium | severe (legal) | keep BLOCKED until D1 |
| Composio path switched on with real patients | low | severe | D3 retire; no `COMPOSIO_*` on the clinic install |
| Unreviewed prospect identities kept indefinitely (expired requests are cancelled, identity kept) | high | medium | D5 retention/redaction rule |
| Requests routed to the owner when another practitioner should get them | medium | low | D6 |
| Audit cannot name the intake actor (actor NULL; source in `new_values`) | certain | low | accepted, documented; future audit column is a separate ADR |
| n8n execution logs retaining payloads | medium | medium | disable/prune before any workflow carries more than ids |
