# n8n guide and Meta readiness

## 1. n8n's role in MindCare

n8n is an **orchestrator**. It is not a database, not a backend, and it makes no decisions.

| n8n MAY | n8n MUST NOT |
|---|---|
| schedule a social draft request, call the image/text provider for **marketing** content, notify the doctor that a draft is ready (refs only) | hold any database credential (there is none to give: the clinic exposes no DB and no inbound API) |
| relay gateway events (opaque ids) to other tools | receive phone numbers, names, message bodies, or any patient reference |
| retry its own steps, report `WorkflowResultV1` | confirm an appointment, approve or publish a post, change consent |
| run on n8n Cloud **for social/marketing flows only** | run patient-adjacent flows anywhere but a self-hosted instance in Algeria (D2) |

Because the clinic is not reachable from the internet, n8n can only talk to the **gateway**,
through a narrow signed API (clinic-bridge HMAC scheme), never to the clinic. Execution logs
must be pruned or disabled for any workflow that sees more than ids.

## 2. Mock payloads (for building workflows without credentials)

These are **fabricated examples**: no real ids, no real person.

```json
// Gateway → n8n: a social draft was created (refs only)
{ "eventId": "00000000-0000-4000-8000-0000000000e1", "type": "SocialContentDraftCreated",
  "schemaVersion": 1, "occurredAt": "2026-12-01T09:00:00+01:00", "producer": "gateway",
  "correlationId": "00000000-0000-4000-8000-0000000000c1", "cabinetRef": "00000000-0000-4000-8000-0000000000a0",
  "payload": { "contentId": "00000000-0000-4000-8000-0000000000d1", "version": 1 } }
```
```json
// n8n → gateway: workflow outcome
{ "executionId": "00000000-0000-4000-8000-0000000000f1", "workflow": "social-draft",
  "correlationId": "00000000-0000-4000-8000-0000000000c1", "outcome": "failed", "attempt": 2,
  "errorCode": "UNAVAILABLE", "finishedAt": "2026-12-01T09:00:12+01:00" }
```
Validate both against `integrationEventV1` / `workflowResultV1`. Anything with a free-text field
fails validation by design.

## 3. Hosting choice

See [PRIVACY-DATA-RESIDENCY.md §6](PRIVACY-DATA-RESIDENCY.md#6-hosting-comparison-n8n-and-the-gateway).
The recommendation: gateway + n8n self-hosted on an Algeria-hosted VPS for anything near
patients; n8n Cloud acceptable for marketing-only workflows. The n8n self-hosted Community
Edition licence allows internal business use (**verify** for your case).

## 4. Meta readiness checklist (nothing below is done; all of it is external setup)

| Item | Notes |
|---|---|
| Owner decision D1 (ADR-042) + Law 18-07 review | **blocking** for WhatsApp/Messenger/IG DMs |
| Meta Business portfolio verified, own Meta app (not a SaaS's managed app) | the Composio-managed app was refused in the live test of 2026-09-29 (`diagnostic-refus.ts`) |
| WhatsApp Business Account + phone number on Cloud API | display name approval |
| Webhook URL on the gateway (HTTPS), verify token, app secret | gateway env only |
| Message templates in fr / ar (Darija has no separate Meta locale — use `ar` and approved wording) | needed to write outside the 24-hour customer-service window |
| 24-hour window | free-form replies only within 24 h of the person's last message; after that, approved templates only |
| Opt-in / opt-out | `communication_consents` per channel; honour "STOP"-style requests immediately |
| Rate and messaging limits | per-number throughput and per-portfolio business-initiated limits (**verify** current tiers) |
| Status callbacks | sent / delivered / read / failed → `WhatsAppMessageDeliveryUpdated` |
| Error mapping | policy/template/window errors → never retried; 429/5xx → backoff |
| Pages / Instagram | Page token, Instagram professional account linked to the Page, content-publishing permission (app review) |
| Credential rotation | documented in WEBHOOK-SECURITY.md §2.7 |
| End-to-end test on a **test number / test page** | the only evidence that "Meta works"; not performed |

## 5. Composio (existing path)

`src/server/communication/adaptateurs.ts` routes WhatsApp/Facebook/Instagram through Composio.
It is not the selected provider: it sends real identifiers to a US intermediary and was refused
by Meta. Recommendation **D3**: retire it for these channels once the direct Cloud API adapter
exists at the gateway. It was not modified here.
