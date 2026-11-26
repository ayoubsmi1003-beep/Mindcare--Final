# Integration contracts v1

**Format.** No OpenAPI exists in this repository, and there is no versioned REST API (ADR-003:
internal `/api/*` routes only). Contracts are therefore **Zod schemas** in
[`src/shared/integrations/contracts.ts`](../../src/shared/integrations/contracts.ts) — I/O-free,
so the website, a future gateway and a future mobile app can mirror them byte for byte — plus
the closed-key validation repeated in SQL inside each gate (the database is the trust
boundary, règle 4). Tests: `tests/unit/integration-contracts.test.ts`.

**Compatibility policy.** Every payload carries `schemaVersion`. Additive optional fields keep
the version; any removal, rename or meaning change creates `v2` alongside `v1`. Objects are
`.strict()`: an unknown key is refused, never ignored — that is what keeps free text and
clinical fields out.

**Error vocabulary** (same as the website relay): `INVALID_INPUT · CONFLICT · CAPACITY ·
UNAVAILABLE · NOT_FOUND · EXPIRED · REPLAY`. SQL text is never returned to a caller.

## 1. AppointmentRequest v1 — `appointmentRequestV1`

```json
{
  "schemaVersion": 1,
  "submissionId": "7f0c…-uuid (the caller's idempotency key)",
  "channel": "whatsapp",
  "firstName": "…", "lastName": "…",
  "phone": "0554 00 00 01",
  "locale": "darija",
  "preferredDay": "2026-12-03",
  "preferredPeriod": "morning",
  "preferredTime": "09:30",
  "consent": { "contact": true, "whatsapp": true, "policyVersion": 1 }
}
```

| Field | Rule |
|---|---|
| `channel` | `web` \| `whatsapp` → stored in `appointments.source` |
| `phone` | canonicalised to E.164 (`0XXXXXXXXX` → `+213…`), same function as the website; an Algerian number must be `+213` + 9 digits (`+2130…` refused) |
| `locale` | `fr` \| `ar` \| `darija` (the `app.intake_lang` enum). The website's `en` maps to `fr` in its adapter |
| `preferredDay` | real calendar date; the gate enforces today…today+60 (Africa/Algiers) |
| `preferredPeriod` / `preferredTime` | `morning`/`afternoon`; optional `HH:MM` 08:30–15:30, must agree with the period |
| `firstName` / `lastName` | 1–80 chars; no control, invisible (U+200B…) or bidi-override character; no leading `=`, `+`, `@` (spreadsheet formulas) |
| `consent.contact` | must be `true` |
| anything else | refused (no reason, no symptom, no free text) |

Not collected, deliberately: diagnosis, history, medication, reason for consultation, "new
patient?" flag (reception matches the phone against existing files instead).

**Receipt** — `appointmentRequestReceiptV1`: `{ submissionId, delivery: "RECEIVED", duplicate }`.
No internal row id leaves the clinic. Review status (pending / confirmed / rejected / expired)
is a separate, later query, mapped as in [APPOINTMENT-REQUESTS.md §2](APPOINTMENT-REQUESTS.md).

### Entry point (implemented)

| | |
|---|---|
| Function | `submitAppointmentRequest(input)` — [`src/server/integrations/appointment-intake.ts`](../../src/server/integrations/appointment-intake.ts) |
| Not an HTTP route | it is called by a server-side channel adapter (website poller, future gateway poller) **after** that adapter verified its channel signature |
| Authentication | channel signature at the adapter; then the server's own DB role `mindcare_app` (`withIntakeTransport`) |
| Authorisation | only `mindcare_app` may EXECUTE `app.ingest_appointment_request`; staff (`authenticated`) and `anon` are refused (tested) |
| Validation | Zod (`appointmentRequestV1`), then closed-key SQL validation in the gate |
| Responses | `{ ok: true, receipt }` or `{ ok: false, error: INVALID_INPUT \| CONFLICT \| CAPACITY \| UNAVAILABLE }` |
| Idempotency | same `submissionId` + same content → `duplicate: true`, no second row; changed content → `CONFLICT`; concurrent retries serialise on an advisory lock (tested) |
| Rate limit | 3 requests per phone per 24 h (ADR-006) and 200 per cabinet per 24 h → `CAPACITY` |
| Audit | `trg_audit` on the appointment and the details row; actor is NULL (no user) and the channel is visible in `new_values.source` |
| Logging | none of the payload (name and phone are Tier 0) |

### Reception gates (implemented, called through `/api/db/rpc`)

| Gate | Args | Authorisation | Result / errors | Idempotency | Audit |
|---|---|---|---|---|---|
| `app.accept_appointment_request` | appointment id, patient id, agreed `starts_at` | staff session; SECURITY INVOKER — RLS decides; practitioner wall enforced; patient read through the audited `app.get_patient` | `true`; `false` = not found / out of scope (no oracle); readable French refusal otherwise (wall, occupied slot — whole acceptance rolled back) | retry of an accepted request → `true` | `trg_audit` (appointment, pending identity status), `audit.log_read` for the patient |
| `app.reject_appointment_request` | appointment id, motif (required) | as above | `true` / `false` / refusal | retry → `true` | `trg_audit`; motif appended to `notes_admin` |

## 2. IntegrationEvent v1 — `integrationEventV1`

`{ eventId, type, schemaVersion: 1, occurredAt, producer, correlationId, cabinetRef, payload }`

- `type`: AppointmentRequestCreated · AppointmentRequestReviewed · AppointmentConfirmed ·
  IntegrationWebhookReceived · WhatsAppMessageReceived · WhatsAppMessageDeliveryUpdated ·
  SocialContentDraftCreated · SocialContentApprovalRequested · SocialContentApproved ·
  SocialContentApprovalRevoked · SocialContentScheduled · SocialContentPublished ·
  SocialContentPublishFailed · IntegrationHealthChanged.
- `producer`: `mindcare-core` · `gateway` · `website` · `aftercare` · `n8n`.
- `payload`: **references only** — ≤16 keys, values limited to UUIDs, UPPER_CASE codes,
  integers 0–100 000, booleans, null. A phone number, as text or as an integer, is refused
  (tested).
- Delivery: today none (no remote consumer). When the gateway exists, events are written to an
  outbox **in the same transaction** as the business write (pattern `app.aftercare_events`,
  227) and consumers dedupe on `eventId`.

## 3. NotificationEvent v1 — `notificationEventV1`

Maps 1:1 to `app.notifications` (011): `kind` ∈ appointment_request · crisis_escalation ·
social_approval_requested · social_published · social_publish_failed ·
integration_disconnected · workflow_failed · sync_event; `recipientRole` ∈ owner ·
practitioner · assistant; refs-only payload. RLS (`notifications_mine`) decides who reads it,
on desktop and on any future mobile client alike. Implemented today: `appointment_request` →
owner, payload `{ appointment_id, channel }`.

## 4. WorkflowResult v1 — `workflowResultV1`

For n8n or any orchestrator reporting back: `{ executionId, workflow, correlationId, outcome:
succeeded|failed|retrying|dead_lettered, attempt, errorCode?, finishedAt }`. A failure must name
its `errorCode`; a success must not (tested).

## 5. Social content (contract only)

`socialContentVersionV1`, `socialSlideV1`, `socialApprovalV1`, `socialPublishJobV1` — see
[SOCIAL-CONTENT.md](SOCIAL-CONTENT.md). Slides are ordered 1…n; a carousel has ≥2 slides, other
formats exactly 1; `contentHash` is a SHA-256 hex computed by the database.

## 6. Retries and rate limits (rules for every adapter)

- Retry only transient failures (`UNAVAILABLE`, network, 5xx, 429) with exponential backoff and
  jitter (e.g. 1 s, 2 s, 4 s … capped at 5 min, max 8 attempts), then dead-letter with a
  visible notification (`workflow_failed`). Never retry `INVALID_INPUT`, `CONFLICT`, a policy
  refusal, or a Meta 24-hour-window/template error.
- Every retry reuses the same idempotency key (`submissionId`, `eventId`, `(version, platform)`).

## 7. Integration registry

No second configuration system is created. Today:

| Integration | Where its state lives | Secrets | Status |
|---|---|---|---|
| META_WHATSAPP · META_FACEBOOK · META_INSTAGRAM | `app.external_connections` (status + capabilities, **no token**, 112) | gateway env only (future) | BLOCKED (D1) |
| WEBSITE | `MINDCARE_BOOKING_*` env names already whitelisted by Electron (`electron/main/serveur-cabinet.ts:32`) | `MINDCARE_BOOKING_BRIDGE_SECRET` (server env) | contract ready |
| AFTERCARE | `AFTERCARE_ENABLED=synthetic` + bridge env (227–230) | server env | synthetic only |
| N8N | none on the clinic (n8n never talks to the clinic) | gateway env (future) | documented |
| AI_TEXT_PROVIDER | `src/server/alexa/model-policy.ts` + `external-call.ts` | server env | exists (Alexa/Jarvis) |
| AI_IMAGE_PROVIDER | none | — | not started |

A typed registry module is **not** added now: it would have no consumer (DOC-AUTHORITY §4: no
primitive without a real caller). It arrives with the first adapter that needs to read it.
