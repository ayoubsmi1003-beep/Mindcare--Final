# ADR — protected Aftercare channel (approved master scope, 2026-11-16)

The approved MASTER-TRANSFORMATION and MASTER-CONTRACT in the website repository
authorize this forward schema addition before migration227. Real activation remains
closed. Existing migrations001–226 and clinical records remain immutable.

## Entities

- `app.aftercare_bindings`: id (binding UUID), cabinet_id, practitioner_id,
  patient_id (local FK), portal_patient_id (opaque portal UUID), relationship
  (`self`/`guardian`), verification_evidence (local clinician reference),
  consent_version (positive integer), verified_by, verified_at, revoked_at.
  The doctor verifies identity, relationship and consent explicitly. A guardian
  contact or checkbox alone never establishes legal authority.
- `app.aftercare_objects`: id (local row UUID), binding_id, patient_id, cabinet_id,
  practitioner_id, object_id (wire UUID), source (`mindcare`/`sanad`), kind,
  version, body (typed JSON), share_state (`shared`/`revoked`), effective_at,
  approved_by, approved_at, read_by, read_at, created_at, updated_at.
  Unique(binding_id,source,object_id). Incoming bodies are untrusted submissions;
  never instructions or official records. Revocation hides the body. Actual read
  requires the explicit read gate, independently of technical receipt.
- `app.aftercare_events`: id (wire event UUID), binding_id, patient_id,
  cabinet_id, practitioner_id, object_id, direction (`incoming`/`outgoing`),
  request_id (local idempotency UUID), digest, envelope, status
  (`pending`/`applied`/`duplicate`/`stale`), delivered_at, created_at.
  Unique(binding_id,direction,request_id). Outbox stored atomically with approval.
  Retries reuse the exact event and never create a second clinical action.

All timestamps timestamptz. RLS clinical scope is cabinet plus
`can_see_clinical(practitioner_id)`; active profile required. Reception has no
clinical access. Every mutation uses existing `audit.track()`/`trg_audit`.
Reads call the audited patient gate before Aftercare access. Browser has no table
privileges; data flows through DbPort RPCs. The separate protected channel reuses
the communication kernel's approval/idempotence/audit pattern; it deliberately
does not reuse social tables whose cabinet-wide policies allow reception.

The NOLOGIN `aftercare_transport` role owns only authenticated ingest/outbox/ack gates;
only local `mindcare_app` may execute those gates, never authenticated/anon.
It cannot read EMR tables. Verified transport clinic identity is checked against
binding cabinet; local mapping never enters the wire. No user impersonation.

Outgoing kinds: mission, carePlan, doctorNote, review, personalEvent(milestone
only). Doctor authority fields assigned by SQL. Incoming kinds: journal,
preparation, message, report, missionResponse, blueprint, personalEvent, letter,
atlas, roomSession, shared as explicit versioned submissions. Revocations retained
even when delivered out of order; newer explicit re-share is required to restore.

No acceptance into official records is provided: reviewed submissions stay
separate. A future documented clinical acceptance gate is required before any
official-note insertion. No diagnosis/prescription/note rewrite occurs here.

Transport V2 uses HMAC-SHA256(timestamp + newline + POST + newline + pathname +
newline + raw body), timestamp tolerance300s, clinic header checked server-side.
Explicit server `AFTERCARE_ENABLED=synthetic` plus loopback URL/key/clinic UUID
are required in this candidate. Missing configuration returns503. No real-patient
network path is activated; non-synthetic patients cannot bind while this candidate
is limited to synthetic qualification. HTTPS/Algeria/legal activation is a separate
approval gate. Test keys stay in memory. No remote database or model is called.
