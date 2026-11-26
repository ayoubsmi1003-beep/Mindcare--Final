# Operations — environment, runbook, test report, open decisions

## 1. Environment variables (server only — never `NEXT_PUBLIC_*`, never in git)

| Variable | Where | Status |
|---|---|---|
| `MINDCARE_DATABASE_URL` | clinic server | exists; the intake entry point uses the same pool (`mindcare_app`) |
| `COMPOSIO_API_KEY`, `COMPOSIO_BASE_URL`, `COMPOSIO_ENTITY_ID`, `COMPOSIO_LIST_PATH`, `COMM_WEBHOOK_SECRET` | clinic server (`src/server/env.ts`) | exist; **must stay unset on a real clinic install** until D3 |
| `AFTERCARE_ENABLED`, `AFTERCARE_BRIDGE_URL`, `AFTERCARE_BRIDGE_KEY`, clinic UUID | clinic server | exist; `synthetic` + loopback only |
| `MINDCARE_BOOKING_ENABLED`, `MINDCARE_BOOKING_EDGE_ORIGIN`, `MINDCARE_BOOKING_BRIDGE_SECRET`, `MINDCARE_BOOKING_IDLE_POLL_MS` | clinic server (whitelisted by Electron) | names exist; consumer not built |
| `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, page tokens | **gateway only** (future) | proposed; never on the clinic |
| `MINDCARE_TEST_PG_BIN` | developer machine | new; path to PostgreSQL 16 binaries for the checkpoint |

## 2. Runbook

**Never apply 234/235 to the clinic database without a verified backup.** At the time of
writing, the clinic database is the single main database and has no backup (memory note,
2026-11-24). Migration order on any installed database: 231–233 from the deployment branch
first (already applied on the clinic database), then 234, then 235 (`scripts/db-migrate.sh` runs
one file per psql call).

Rollback of 235 (only if no request exists yet):
1. restore the previous bodies of 063 / 117 / 025 / 181 / 046 / 014 by re-running those
   function definitions;
2. drop `app.ingest/accept/reject_appointment_request`, the five new policies and the table;
3. drop the role.

234 cannot be rolled back (PostgreSQL cannot drop an enum value); it is harmless if unused.

Proof that nothing broke, on a **throwaway** PostgreSQL 16 cluster (never a URL, never `.env`):

```
MINDCARE_TEST_PG_BIN="<…>/resources/pgsql/bin" node scripts/checkpoint-appointment-requests.mjs --ts --regression
```

It applies the whole chain plus `010_app_role` and switches to `self-hosted`, exactly as
`electron/main/provisionnement.ts` does. It runs the scenarios, the real TS entry point, and the
existing checks of every redefined function. The cluster is stopped and kept for diagnosis
(its path is printed).

## 3. Test and acceptance report (2026-11-26, actually run)

| Run | Result |
|---|---|
| `tests/unit/integration-contracts.test.ts` + `tests/unit/meta-webhook.test.ts` | **PASS** 48/48 (32 contract + 16 Meta verifier) |
| `scripts/checkpoint-appointment-requests.mjs --ts --regression` | **PASS — 56 checks, 0 failures**, on PostgreSQL 16.15, 209 migrations |
| ↳ includes the real `submitAppointmentRequest` against the cluster (vitest) | **PASS** 2/2 |
| ↳ regression `scripts/checkpoint-reception.sql` (046 and the redefined functions) | **PASS** 34 green, 0 red |
| ↳ regression `tests/integration/communication-booking.test.ts` (117 race) | **KNOWN-FAIL, pre-existing** — fails identically on the chain **without** 234/235 (measured). The test expects one winner, but 117 has always counted the other overlapping `requested` row as a conflict. Not fixed (out of scope) |
| `pnpm typecheck` (main + test configs) | **PASS** |
| ESLint on every changed file | **PASS** |
| Full `vitest run` (unit + integration; DB suites skipped without their cluster) | 7,219 passed · **5 failed** · 152 skipped. The 5 failures are unrelated to this change (none imports a changed file): `alexa-native-voice-routes` and `voice-bundle-inventory` (voice assets excluded from git), `alexa-v8-adversarial-manifest` (frozen manifest line endings), `knowledge-stahl-chunker` (missing knowledge asset), `contrat-workspace` ×2 (Jarvis, pre-existing) |
| Browser check of the Demandes dialog (Next dev on a throwaway cluster, synthetic requests, synthetic reception account) | **PASS**. Content (matching file preselected), accept → "Demande acceptée, rendez-vous confirmé." and the appointment shows as confirmed, empty state with "Créer le dossier", two-step reject with mandatory motif → "Demande refusée.", database stopped → offline banner + dialog error state with both writes disabled. One defect found and fixed during the check: the disabled "Confirmer le refus" button was nearly invisible |
| Security review (adversarial agent, own throwaway cluster) | 4 findings, **all fixed and pinned by checkpoint checks**: practitioner could read owner request identities in `pending_patients`; the `withIntakeTransport` alias escaped preflight control 12 (now 12b); a stranger's request could overwrite a patient's WhatsApp consent; an overdue request left the queue. Reservations also fixed: `pg_temp` last in search_path, invisible/bidi/formula characters in names, `+2130…` phone variants, a global 200/24 h cap |
| `scripts/checkpoint-s4.sh` | **NOT RUN**: needs Docker and a database URL, which this work never supplies |
| Meta / WhatsApp / Instagram / Facebook / n8n end-to-end | **NOT RUN**: blocked by design (no credential, no live account, no publishing) |

## 4. Open decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | Contact-channel exception for WhatsApp/Messenger/IG (draft ADR-042) + Law 18-07 legal review | required before any production messaging |
| D2 | Gateway hosting | Algeria-hosted VPS, n8n self-hosted beside it |
| D3 | Retire the Composio path for WhatsApp/Facebook | yes, once the direct Cloud API adapter exists |
| D4 | WhatsApp agent LLM scope; crisis text and emergency numbers | LLM sees public topics only; crisis path deterministic, doctor-written |
| D5 | Retention of unreviewed request identities (kept today) | redact names/phone N days after expiry (to decide) |
| D6 | Routing of requests when several practitioners exist | owner today; choose a rule if needed |
| D7 | Who approves social posts | owner only |
| D8 | Website relay residency flags (`MINDCARE_CLOUD_RELAY_APPROVED` / `…EDGE_RESIDENCY_APPROVED`) | decide before building the clinic poller |
| D9 | Binding rules in the archived Constitution not reflected in CLAUDE.md/ADRs | owner to surface, since agents may not read it |
| D10 | Approve the social schema (SOCIAL-CONTENT.md §3) | next phase |

## 5. Security issues found during the audit (not caused by this work)

**Communication webhook (owner choice: noted, not fixed):**
- **S1** the webhook updates the wrong message when two messages share the same text.
- **S2** replay deduplication is check-then-insert, so two concurrent replays can both insert.
- **S4** the communication webhook signature has no timestamp.
- **S5** the delivery idempotency key is ignored.

**Other findings:**
- **S3** the Composio egress sends real identifiers.
- **S7** communication RLS is cabinet-wide, so reception can read message bodies.
- **S8** `checkpoint-aftercare.mjs` defaults to PostgreSQL 18 binaries while the app ships 16.
- **S9** `communication-booking.test.ts` contradicts gate 117 (see §3).
- **S10** preflight control 12 does not cover the pre-existing `withEgressGate` /
  `withAftercareTransport` aliases. Only `withIntakeTransport` is confined (12b); extending it
  to the other two is a separate, tiny change.
