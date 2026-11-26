# Appointment requests — website, WhatsApp, any future channel

## Approval record (règle 9)

On **2026-11-26**, in the session that produced this document, the owner approved the
foundation scope "Docs + contracts + requests", which covers these schema additions. The
same approval process was used for the Communication OS spec:
- enum value `whatsapp` in `app.appt_source` → migration **234**;
- table `app.appointment_request_details`, NOLOGIN role `integration_intake`, gates
  `app.ingest_appointment_request`, `app.accept_appointment_request`,
  `app.reject_appointment_request`, and redefinitions of 063/117/025/181/046/014 → migration **235**.

They are numbered 234/235, not the 231/232 of the plan, because 231–233 are already used on the
deployment branch (`claude/mindcare-os-deployment-165e1a`), and 231 is applied on the clinic database.

## 1. One request model, no second source of truth

A request is exactly what 025 designed:
- **Identity:** an `app.pending_patients` row. The identity is self-declared and awaits
  validation (ADR-006).
- **Appointment:** an `app.appointments` row in status `requested`, with `source` `web` or
  `whatsapp`, and `pending_patient_id` set. `patient_id` stays NULL until reception links a
  real file.
- **Details (1-1, no clinical field):**
  - the caller's `submission_id` (unique) and the digest of the normalised request;
  - the preferred day, period and optional time;
  - consent flags and the consent policy version.

## 2. Lifecycle mapping (external state ↔ MindCare)

| External (website protocol v2 / future WhatsApp) | MindCare |
|---|---|
| `QUEUED` / `RECEIVED` (delivery) | gate returned `RECEIVED` |
| `PENDING` | `appointments.status = 'requested'`, `patient_id IS NULL` |
| `CONFIRMED` | `confirmed` and later states, reached **only** through `accept_appointment_request` by staff |
| `REJECTED` | `cancelled` + `pending_patients.status = 'rejected'` with a motif |
| `CANCELLED` | `cancelled` (by reception, `cancel_appointment`) |
| `EXPIRED` | `cancelled` with motif « demande expirée » by `run_purges`, pending `rejected` |

No new lifecycle is created. The UI's "pending" is the domain's `requested`.

## 3. Guarantees (each proven by `scripts/checkpoint-appointment-requests.mjs`)

**Never confirmed by a channel.** The ingest gate only inserts `requested`. `confirm_appointment`
and `confirmer_apres_reverification` refuse any row with no patient file.

**Never holds a slot.** `check_slot_available` and 117 ignore unlinked requests. A public form
cannot block 09:00, and reception keeps booking normally.

**Idempotent:**
- A retry with the same content returns `duplicate`.
- The same id with changed content returns `CONFLICT`.
- Concurrent retries serialise on an advisory lock.

**Bounded:**
- 3 requests per phone per 24 h.
- 200 per cabinet per 24 h.
- The day must fall within today…today+60 (Africa/Algiers).

**Minimal data:**
- Name, phone, language, preferred window, consent.
- No reason, symptom, history, medication or free text.
- Unknown keys are refused, in Zod and again in SQL.
- Names are refused if they contain control, invisible or bidi characters, or start with a
  formula prefix (`=`, `+`, `@`).
- Algerian numbers are normalised to `+213` followed by 9 digits.

**Clinic scope never comes from the caller.** The gate takes the single cabinet of the install
and its owner practitioner, and fails closed if there are several (see D6).

**Practitioner wall.** A non-owner practitioner sees neither the request nor its self-declared
identity. A restrictive policy on `pending_patients` enforces this; owner and assistant keep
their 005 access.

**Reception never loses a request.** An unlinked request whose day has passed stays in
"Demandes" until it is accepted, rejected or expired.

## 4. Reception workflow (implemented)

1. **Spotting it.** The request appears under "À traiter" with its origin badge ("Demande
   WhatsApp" / "Demande web") and a **Traiter** button. Unlinked requests no longer get the
   one-click "Confirmer".
2. **The dialog shows:**
   - the declared name, labelled "not yet verified";
   - the phone;
   - the preference, labelled "not a booked slot";
   - the matching patient files, from the existing phone matcher (last 9 digits).
3. **Accept and confirm.** One database transaction:
   - re-reads the patient through the audited `get_patient`;
   - enforces the practitioner wall;
   - links the file and sets the agreed time;
   - marks the identity `validated` or `merged`;
   - copies the WhatsApp consent, **only if the phone is the file's phone**;
   - confirms under lock.

   If the slot is taken, everything rolls back.
4. **Reject.** The motif is mandatory, in two steps (a confirmation for an irreversible act,
   per UX_CONTRACT).
5. **No matching file.** The empty state says so and offers "Créer le dossier". Reception
   comes back afterwards.

The five UX states (content, empty, error, offline, loading) were triggered in the browser on a
throwaway cluster; see OPERATIONS.md §3.

## 5. Channel behaviour that future adapters must keep

- **Answer honestly.** Say "request received, the clinic will call you". Never say
  "confirmed", never promise a time.
- **Keep clinical content out of booking.** Never collect it. If a person writes something
  clinical or alarming, the booking flow stops and the deterministic crisis path takes over
  (doctor-approved text, staff notification `crisis_escalation`, no LLM decision, no promise
  of immediate human response). That path belongs to the WhatsApp agent task and is not built.
- **Reuse the caller's idempotency key.** It must be stable: the website's `submissionId`,
  or for WhatsApp a UUID derived from the conversation and the gateway's request id.

## 6. Known limits (documented, accepted for now)

- **Audit actor.** Intake writes have no user, so `audit.log.actor_id` is NULL. The channel is
  in `new_values.source`, and the details row carries `trg_audit`. A dedicated actor column
  would need its own ADR.
- **Retention.** Identities of expired, unreviewed requests are kept, because the cancelled
  appointment still references them. Retention or redaction is owner decision **D5**.
- **Routing.** Requests go to the owner practitioner (decision **D6** if another routing is
  wanted).
- **Agenda page.** "Confirmer" on an unlinked request there returns the database's readable
  refusal; only the reception station has the accept dialog.
- **QR flow.** A non-owner practitioner no longer sees unattached `pending_patients` rows (the
  QR flow, which is not built yet).
