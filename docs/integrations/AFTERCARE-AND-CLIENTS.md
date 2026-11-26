# Aftercare, website, desktop and mobile — integration contracts

## 1. Aftercare (exists, synthetic only — described as built, not changed)

The Aftercare app ("Sanad") lives in the sibling repository `mindcare-website` (Vercel). The clinic
side is migrations **227–230**, `src/server/aftercare/*`, `src/app/api/aftercare/*`,
`src/services/aftercare*.ts`, ADR `docs/aftercare/ADR-aftercare-master.md`.

| Topic | Contract |
|---|---|
| Identity | `app.aftercare_bindings`: local `patient_id` ↔ opaque `portal_patient_id`. The local patient UUID never leaves. The doctor verifies identity, relationship (self/guardian) and consent version explicitly |
| Consent | `consent_version` on the binding; support recipients only by an explicit, append-only doctor decision (229) |
| Ownership | MindCare owns the clinical record and doctor publications (mission, carePlan, doctorNote, review, milestone). Sanad owns patient submissions (journal, preparation, message, report, …). Submissions are untrusted and never written into the official record |
| References | `objectId` / `version` per object; appointment and treatment snapshots carry `sourceVersion` (228) |
| Events | `app.aftercare_events` outbox, unique per (binding, direction, request id); digest-checked; retries reuse the exact event |
| Transport | HMAC-SHA256 V2 (`ts\nPOST\npath\nbody`, 300 s), loopback-only and `AFTERCARE_ENABLED=synthetic` in this candidate |
| Failure | a failed POST leaves the event `pending`, and dispatch retries it. A read receipt is re-sent from the SQL-recorded read (230), never fabricated |
| Activation | real patients need HTTPS, a hosting and residency decision, and a legal gate. **Not active** |

The new integration work does not touch Aftercare. Future convergence: Aftercare appointment
snapshots could link to `appointment_request_details` by appointment id. No duplicate patient
data is ever created.

## 2. Website (exists in `mindcare-website`; clinic consumer not built)

- **Public side:** the chatbot sends only locally-normalised public topics to Gemini. Booking
  protocol v2 is preference-based (`submissionId`, day, period, optional time, name, phone,
  consent, `whatsappConsent`, locale).
- **Relay:** durable and encrypted (Upstash Redis, 72 h payload, 30-day receipt metadata),
  gated by `MINDCARE_CLOUD_RELAY_APPROVED` / `MINDCARE_EDGE_RESIDENCY_APPROVED`.
- **Clinic bridge:** `POST /api/clinic-bridge` with `op: poll | result`, HMAC + nonce + 15 s.

**Clinic consumer to build (next phase, CONTRACT READY):**
1. A server loop (Electron main or the Next server) polls `MINDCARE_BOOKING_EDGE_ORIGIN` +
   `/api/clinic-bridge` every `MINDCARE_BOOKING_IDLE_POLL_MS`, only when
   `MINDCARE_BOOKING_ENABLED=1`. These env names are already whitelisted
   (`electron/main/serveur-cabinet.ts:32`).
2. For each leased job, it maps protocol v2 to `AppointmentRequestV1`:
   - `channel: "web"`;
   - `locale: en → fr`;
   - `consent.whatsapp` ← `whatsappConsent`;
   - `consent.policyVersion` ← the website's published policy version.

   Then it calls `submitAppointmentRequest`.
3. It replies `op: result` with the receipt (`RECEIVED`, no internal id), or with the error
   code. `UNAVAILABLE`/`CAPACITY` leave the job for a retry, as the relay expects.
4. Status queries (`op: status`) are answered from `appointments.status` + `pending_patients.status`
   using the mapping in APPOINTMENT-REQUESTS.md §2.

## 3. Desktop and mobile

| Rule | Desktop (exists) | Mobile (future, `mobile/` is a placeholder) |
|---|---|---|
| Contract | same-origin `/api/*`, `DbPort`, the same gates | the same `/api/*` routes and gates, reached over the planned Tailscale link (never a public port) |
| Auth | local auth session cookie (httpOnly); LAN device token at the proxy | same session model; device enrolment like the LAN pairing |
| Roles | RLS decides (owner / practitioner / assistant) | identical: no mobile-specific permission |
| Sync | none: every read and write goes to the clinic API | none: no local database copy of clinical data |
| Offline | writes blocked with the reason (`BandeauHorsLigne`, `refuserHorsLigne`) | same. Drafts may be kept locally, but **approvals, confirmations, accept/reject never queue offline**: an action is valid only once the gate answered |
| Conflicts | gates lock and re-check (`FOR UPDATE`, 117); a stale screen gets a readable refusal | same; no last-write-wins |
| Shared code | `src/shared/integrations/contracts.ts`, `src/shared/jarvis/` (I/O-free) | import the same modules |
| Notifications | `app.notifications` by role (RLS) | the same rows; push delivery would be a gateway concern (refs only) |
