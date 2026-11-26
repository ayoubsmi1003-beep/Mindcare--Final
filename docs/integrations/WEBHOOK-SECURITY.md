# Webhook and channel security

Principle: **the clinic is never a webhook target.** Inbound traffic from the internet lands on
an operator-controlled relay (the existing website relay, or the future Algeria-hosted
gateway); the clinic **polls it outbound**, re-validates every payload (Zod, then closed-key SQL)
and writes only through a gate. Nothing is trusted because it is valid-looking JSON.

## 1. Signature schemes in the repository (verified)

| Scheme | Where | Signed string | Window | Replay | Used for |
|---|---|---|---|---|---|
| **Meta** `X-Hub-Signature-256: sha256=<hex>` | `src/server/integrations/meta-webhook.ts` (new) | HMAC-SHA256(app secret, **raw body**) | none (Meta sends no timestamp) | dedupe on provider message id | future gateway |
| **Clinic bridge** `x-clinic-time/nonce/signature` | `mindcare-website/lib/clinic-bridge-auth.ts` | `POST\n/api/clinic-bridge\n{ms}\n{nonce}\n{body}` | 15 s | nonce store (30 s; Redis in cloud mode) | clinic ⇄ website relay (the clinic side is not built) |
| **Aftercare V2** `X-Sanad-Timestamp/Signature/Clinic` | `src/server/aftercare/transport.ts` | `{ts}\nPOST\n{path}\n{body}` | 300 s | event id + digest in the outbox | clinic ⇄ Sanad (synthetic only) |
| `x-comm-signature` | `src/server/communication/signature.ts` | HMAC-SHA256(raw body) | **none** | provider message id only | existing communication webhook — **not fit for internet use** (§4) |

**For any new pull channel, reuse the clinic-bridge scheme** (method + path + time + nonce +
body, 15 s window, nonce store): it already binds the path, defeats replay without state on the
clinic, and the website relay speaks it. No fourth scheme is introduced.

## 2. Meta inbound (gateway, future)

1. `GET` subscription: `verifyMetaChallenge(params, verifyToken)` — `hub.mode=subscribe`,
   constant-time token comparison, challenge restricted to `[A-Za-z0-9_-]{1,128}`; else 403.
2. `POST`: read the **raw bytes** (≤ 256 KB, `META_WEBHOOK_MAX_BYTES`) before any parsing;
   `verifyMetaSignature(raw, header, appSecret)`; on failure answer 401 with no detail.
3. Parse, Zod-validate the provider shape, drop anything not needed (classes A/B/C only).
4. Dedupe on the provider message id (unique key in the gateway queue) — Meta retries.
5. Answer 200 quickly; never call the clinic synchronously.
6. Status callbacks (sent/delivered/read/failed) update the gateway queue; the clinic pulls
   them as `WhatsAppMessageDeliveryUpdated` events (refs only).
7. Secrets (app secret, verify token, access token) live **only** in the gateway's environment;
   rotation = new value in env + Meta dashboard, old one revoked; nothing in the clinic, nothing
   in git, nothing in n8n exports.

Tested now (`tests/unit/meta-webhook.test.ts`, 16 cases): valid signature, tampered body,
wrong secret, missing header, missing prefix, sha1 scheme, truncated or non-hex digest,
upper-case hex, oversized body, weak secret, challenge with wrong token / wrong mode / markup.

## 3. Requirements every channel adapter must meet

| Requirement | Rule |
|---|---|
| Size limit | read with a byte cap before parsing (website: 4 KB public / 64 KB bridge; Meta: 256 KB) |
| Signature | HMAC over the raw body (+ method/path/time/nonce for our own schemes), constant-time compare |
| Timestamp | reject outside the window; clocks are server clocks |
| Replay | nonce store (own schemes) or provider-id dedupe (Meta) |
| Schema | Zod `.strict()` at the adapter, closed keys again in SQL |
| Authorisation | the adapter runs as `mindcare_app` and may call **only** its gate (`withIntakeTransport` is confined to `appointment-intake.ts` by preflight control 12b) |
| Idempotency | the caller's key travels to the gate (`submissionId`) |
| Safe errors | contract codes only; never SQL text, never a stack |
| Audit | the gate's `trg_audit`; adapters log codes and ids, never payloads |

## 4. Existing defects (reported, not fixed — owner decision: note only)

- **S1** `src/app/api/communication/webhook/route.ts:97` re-reads the message it just inserted
  by matching its text against a list sorted oldest-first: a repeated text ("Bonjour") marks
  the **oldest** copy as classified and attaches the provider reference to it.
- **S2** dedupe is check-then-insert (`comm_ref_existe`, then `comm_ajouter_ref_externe` with
  `ON CONFLICT DO NOTHING`): two concurrent replays can both insert a message.
- **S4** `x-comm-signature` has no timestamp/replay window.
- **S5** the delivery idempotency key is registered but the result is ignored and the key is
  never sent to the provider.

These routes require a staff session today, so Meta cannot reach them. The future gateway
ingestion replaces this path with one atomic gate (insert-if-absent keyed on the provider id).
