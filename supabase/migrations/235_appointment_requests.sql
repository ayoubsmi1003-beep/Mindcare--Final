-- 235_appointment_requests — the canonical appointment REQUEST (website, WhatsApp).
--
-- Owner approval (règle 9): 2026-11-26, docs/integrations/APPOINTMENT-REQUESTS.md.
--
-- WHAT IT BUILDS. The flow 025 designed and nobody built: a request is a
-- `pending_patients` row (self-declared identity, awaiting validation, ADR-006)
-- plus an appointment in state `requested`, source `web` or `whatsapp`.
-- Reception calls the person, then ACCEPTS (link a real patient file, agree on a
-- time, confirm under lock) or REJECTS. No second appointment table, no second
-- lifecycle.
--
-- WHAT IT REFUSES, BY CONSTRUCTION.
--   · An unlinked request never holds a slot: check_slot_available (063) and
--     confirmer_apres_reverification (117) ignore it. A public channel must not be
--     able to fill the agenda.
--   · An appointment without a patient file is never confirmed (025, 117).
--   · The intake actor is a NOLOGIN role that can only INSERT a `requested`,
--     unlinked row; it cannot read any appointment, patient or note.
--   · Same submissionId + same content → same request; changed content → conflict.
--   · An expired request is CANCELLED, never deleted (règle 3).
--
-- AUDIT LIMIT (known, documented). Intake writes run without a user identity, so
-- audit.log records actor NULL; the channel is in new_values.source and the
-- details row carries trg_audit. audit.track is NOT modified here.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1 · The intake actor
-- ───────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'integration_intake') THEN
    CREATE ROLE integration_intake NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
GRANT USAGE ON SCHEMA app TO integration_intake;
-- Temporary: ALTER FUNCTION … OWNER needs CREATE on the schema. Revoked at the end (227 pattern).
GRANT CREATE ON SCHEMA app TO integration_intake, app_gatekeeper;

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · Request details (1-1 with the appointment; no clinical field, no identity)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE app.appointment_request_details (
    appointment_id          uuid PRIMARY KEY REFERENCES app.appointments(id) ON DELETE CASCADE,
    submission_id           uuid NOT NULL UNIQUE,
    request_digest          text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
    preferred_day           date NOT NULL,
    preferred_period        text NOT NULL CHECK (preferred_period IN ('morning', 'afternoon')),
    preferred_time          time,
    consent_contact         boolean NOT NULL CHECK (consent_contact),
    consent_whatsapp        boolean NOT NULL,
    consent_policy_version  integer NOT NULL CHECK (consent_policy_version BETWEEN 1 AND 10000),
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT request_time_matches_period CHECK (
      preferred_time IS NULL OR (preferred_time < time '12:00') = (preferred_period = 'morning'))
);

ALTER TABLE app.appointment_request_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.appointment_request_details FORCE  ROW LEVEL SECURITY;
-- Default privileges (001) would grant full DML to authenticated: details are immutable.
REVOKE ALL ON app.appointment_request_details FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON app.appointment_request_details TO authenticated;
GRANT SELECT (submission_id, request_digest), INSERT ON app.appointment_request_details TO integration_intake;

-- Same visibility as the appointment it describes: the appointment's RLS decides.
CREATE POLICY request_details_read ON app.appointment_request_details
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM app.appointments a WHERE a.id = appointment_id));
CREATE POLICY request_details_intake_read ON app.appointment_request_details
    FOR SELECT TO integration_intake USING (true);
-- Only the ingest gate (owned by this NOLOGIN role) inserts; the FK proves the appointment exists.
CREATE POLICY request_details_intake_insert ON app.appointment_request_details
    FOR INSERT TO integration_intake WITH CHECK (true);

CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.appointment_request_details
    FOR EACH ROW EXECUTE FUNCTION audit.track();

-- ───────────────────────────────────────────────────────────────────────────
-- 3 · What the intake actor may touch — INSERT of an unlinked request, nothing else
-- ───────────────────────────────────────────────────────────────────────────
GRANT SELECT (id) ON app.cabinets TO integration_intake;
CREATE POLICY cabinets_intake_read ON app.cabinets FOR SELECT TO integration_intake USING (true);

GRANT SELECT (id, cabinet_id, role, is_active) ON app.profiles TO integration_intake;
CREATE POLICY profiles_intake_owner ON app.profiles FOR SELECT TO integration_intake
    USING (role = 'owner' AND is_active);

-- Rate limit (ADR-006: 3 submissions / phone / 24 h) needs to count recent rows.
GRANT SELECT (cabinet_id, submitted_phone, created_at), INSERT ON app.pending_patients TO integration_intake;
CREATE POLICY pending_intake_recent ON app.pending_patients FOR SELECT TO integration_intake
    USING (created_at > now() - interval '1 day');
CREATE POLICY pending_intake_insert ON app.pending_patients FOR INSERT TO integration_intake
    WITH CHECK (status = 'awaiting' AND matched_patient_id IS NULL AND reviewed_by IS NULL);

GRANT INSERT ON app.appointments TO integration_intake;
CREATE POLICY appt_intake_insert ON app.appointments FOR INSERT TO integration_intake
    WITH CHECK (status = 'requested' AND patient_id IS NULL AND pending_patient_id IS NOT NULL
                AND source IN ('web', 'whatsapp') AND created_by IS NULL);

GRANT INSERT ON app.notifications TO integration_intake;
CREATE POLICY notifications_intake_insert ON app.notifications FOR INSERT TO integration_intake
    WITH CHECK (kind = 'appointment_request' AND recipient_role = 'owner' AND recipient_id IS NULL);

-- Practitioner wall on request identities (review finding). 005 lets every can_see_admin()
-- caller read every pending row; a request's identity now belongs to ITS practitioner.
-- RESTRICTIVE: owner and assistant keep 005's reach; a practitioner sees a pending identity
-- only through an appointment they can see (RLS of app.appointments applies in the subquery).
-- Consequence, documented: an unattached pending row (future QR flow) is no longer visible
-- to a non-owner practitioner.
CREATE POLICY pending_practitioner_wall ON app.pending_patients AS RESTRICTIVE
    FOR ALL TO authenticated
    USING (app.current_role() <> 'practitioner'
           OR EXISTS (SELECT 1 FROM app.appointments a WHERE a.pending_patient_id = pending_patients.id))
    WITH CHECK (app.current_role() <> 'practitioner'
           OR EXISTS (SELECT 1 FROM app.appointments a WHERE a.pending_patient_id = pending_patients.id));

-- is_cloud_dev() (016) is SECURITY INVOKER and reads app.deployment (policy USING (true)).
GRANT SELECT ON app.deployment TO integration_intake;

-- ───────────────────────────────────────────────────────────────────────────
-- 4 · The ingest gate — périmètre · verrou · validation · écriture · trace
-- ───────────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.ingest_appointment_request(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp   -- pg_temp LAST: a session temp object never shadows a type
AS $$
DECLARE
  v_ids        uuid[];
  v_cabinet    uuid;
  v_owner      uuid;
  v_count      integer;
  v_submission uuid;
  v_channel    app.appt_source;
  v_first      text;
  v_last       text;
  v_phone      text;
  v_locale     app.intake_lang;
  v_day        date;
  v_period     text;
  v_time       time;
  v_whatsapp   boolean;
  v_policy     integer;
  v_today      date := (now() AT TIME ZONE 'Africa/Algiers')::date;
  v_digest     text;
  v_existing   text;
  v_pending    uuid := gen_random_uuid();
  v_appt       uuid := gen_random_uuid();
  v_starts     timestamptz;
BEGIN
  -- 1 · Shape. Closed key sets; every value typed. Unknown keys fail closed, so no
  --     free text (a symptom, a story) can ride along with a request.
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
     OR NOT p_request ?& ARRAY['schemaVersion','submissionId','channel','firstName','lastName','phone','locale','preferredDay','preferredPeriod','consent']
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_request) k
                 WHERE k NOT IN ('schemaVersion','submissionId','channel','firstName','lastName','phone','locale','preferredDay','preferredPeriod','preferredTime','consent'))
     OR p_request->'schemaVersion' IS DISTINCT FROM '1'::jsonb
     OR jsonb_typeof(p_request->'consent') IS DISTINCT FROM 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(p_request->'consent') = 'object' THEN p_request->'consent' ELSE '{}'::jsonb END) k
                 WHERE k NOT IN ('contact','whatsapp','policyVersion'))
     OR p_request->'consent'->'contact' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(p_request->'consent'->'whatsapp') IS DISTINCT FROM 'boolean'
     -- NULL-safe: a missing key must FAIL here, never let the OR chain fall to NULL.
     OR jsonb_typeof(p_request->'consent'->'policyVersion') IS DISTINCT FROM 'number'
     OR NOT coalesce((p_request->'consent'->>'policyVersion') ~ '^([1-9][0-9]{0,3}|10000)$', false)
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['submissionId','channel','firstName','lastName','phone','locale','preferredDay','preferredPeriod']) k
                 WHERE jsonb_typeof(p_request->k) IS DISTINCT FROM 'string')
     OR (p_request ? 'preferredTime' AND jsonb_typeof(p_request->'preferredTime') IS DISTINCT FROM 'string')
  THEN
    RAISE EXCEPTION 'IntakeInvalid';
  END IF;

  BEGIN
    v_submission := (p_request->>'submissionId')::uuid;
    v_first      := btrim(p_request->>'firstName');
    v_last       := btrim(p_request->>'lastName');
    v_phone      := p_request->>'phone';
    v_period     := p_request->>'preferredPeriod';
    v_whatsapp   := (p_request->'consent'->>'whatsapp')::boolean;
    v_policy     := (p_request->'consent'->>'policyVersion')::integer;
    IF p_request->>'channel' NOT IN ('web', 'whatsapp')
       OR p_request->>'locale' NOT IN ('fr', 'ar', 'darija')
       OR v_period NOT IN ('morning', 'afternoon')
       OR length(v_first) NOT BETWEEN 1 AND 80 OR length(v_last) NOT BETWEEN 1 AND 80
       OR v_first ~ '[[:cntrl:]]' OR v_last ~ '[[:cntrl:]]'
       -- invisible / bidi-override characters and spreadsheet-formula prefixes (export safety)
       OR v_first ~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]' OR v_last ~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]'
       OR v_first ~ '^[=+@]' OR v_last ~ '^[=+@]'
       OR v_phone !~ '^\+[1-9][0-9]{8,14}$'
       -- an Algerian number is +213 and 9 digits, never +2130… (one person, one rate-limit key)
       OR (v_phone LIKE '+213%' AND v_phone !~ '^\+213[1-9][0-9]{8}$')
       OR (p_request->>'preferredDay') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'IntakeInvalid';
    END IF;
    v_channel := (p_request->>'channel')::app.appt_source;
    v_locale  := (p_request->>'locale')::app.intake_lang;
    v_day     := (p_request->>'preferredDay')::date;
    IF to_char(v_day, 'YYYY-MM-DD') <> p_request->>'preferredDay' THEN
      RAISE EXCEPTION 'IntakeInvalid';
    END IF;
    IF p_request ? 'preferredTime' THEN
      IF (p_request->>'preferredTime') !~ '^(0[89]|1[0-5]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'IntakeInvalid';
      END IF;
      v_time := (p_request->>'preferredTime')::time;
      IF v_time NOT BETWEEN time '08:30' AND time '15:30'
         OR (v_time < time '12:00') <> (v_period = 'morning') THEN
        RAISE EXCEPTION 'IntakeInvalid';
      END IF;
    END IF;
  EXCEPTION WHEN data_exception THEN
    RAISE EXCEPTION 'IntakeInvalid';
  END;

  -- Same window as the reception queue (046: today → +60 days, Africa/Algiers).
  IF v_day < v_today OR v_day > v_today + 60 THEN
    RAISE EXCEPTION 'IntakeInvalid';
  END IF;

  -- 2 · Scope. Never chosen by the caller: the single cabinet of this install and its
  --     owner practitioner. Anything else is a configuration the gate refuses.
  SELECT array_agg(c.id) INTO v_ids FROM app.cabinets c;
  IF coalesce(array_length(v_ids, 1), 0) <> 1 THEN
    RAISE EXCEPTION 'IntakeUnavailable';
  END IF;
  v_cabinet := v_ids[1];
  SELECT array_agg(p.id) INTO v_ids FROM app.profiles p
   WHERE p.cabinet_id = v_cabinet AND p.role = 'owner' AND p.is_active;
  IF coalesce(array_length(v_ids, 1), 0) <> 1 THEN
    RAISE EXCEPTION 'IntakeUnavailable';
  END IF;
  v_owner := v_ids[1];

  -- 3 · Idempotency. The digest covers the NORMALISED request (jsonb key order is
  --     canonical). Lock first, then look: two concurrent retries serialise here and
  --     the second one sees the first. UNIQUE(submission_id) stays the backstop.
  v_digest := encode(sha256(convert_to(jsonb_build_object(
      'channel', v_channel, 'firstName', v_first, 'lastName', v_last, 'phone', v_phone,
      'locale', v_locale, 'preferredDay', v_day, 'preferredPeriod', v_period,
      'preferredTime', v_time, 'consentWhatsapp', v_whatsapp, 'policyVersion', v_policy)::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_submission::text, 235));
  SELECT d.request_digest INTO v_existing
    FROM app.appointment_request_details d WHERE d.submission_id = v_submission;
  IF FOUND THEN
    IF v_existing <> v_digest THEN
      RAISE EXCEPTION 'IntakeConflict';
    END IF;
    RETURN jsonb_build_object('submissionId', v_submission, 'delivery', 'RECEIVED', 'duplicate', true);
  END IF;

  -- 4 · Rate limit per phone (ADR-006), serialised per phone.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_phone, 2351));
  SELECT count(*) INTO v_count FROM app.pending_patients p
   WHERE p.cabinet_id = v_cabinet AND p.submitted_phone = v_phone
     AND p.created_at > now() - interval '24 hours';
  IF v_count >= 3 THEN
    RAISE EXCEPTION 'IntakeCapacity';
  END IF;
  -- Global cap: a public channel must not be able to flood the queue (200 / 24 h).
  SELECT count(*) INTO v_count FROM app.pending_patients p
   WHERE p.cabinet_id = v_cabinet AND p.created_at > now() - interval '24 hours';
  IF v_count >= 200 THEN
    RAISE EXCEPTION 'IntakeCapacity';
  END IF;

  -- 5 · Write. starts_at is the stated PREFERENCE (time, or the start of the period);
  --     an unlinked request holds no slot (§5) and the screen labels it a preference.
  v_starts := (v_day + coalesce(v_time, CASE v_period WHEN 'morning' THEN time '08:30' ELSE time '12:00' END))
              AT TIME ZONE 'Africa/Algiers';

  INSERT INTO app.pending_patients (id, cabinet_id, submitted_phone, first_name, last_name, language, expires_at)
  VALUES (v_pending, v_cabinet, v_phone, v_first, v_last, v_locale,
          greatest(now() + interval '7 days', (v_day + 1)::timestamp AT TIME ZONE 'Africa/Algiers'));

  INSERT INTO app.appointments (id, cabinet_id, practitioner_id, pending_patient_id,
                                starts_at, ends_at, status, source, is_synthetic)
  VALUES (v_appt, v_cabinet, v_owner, v_pending,
          v_starts, v_starts + interval '30 minutes', 'requested', v_channel, app.is_cloud_dev());

  INSERT INTO app.appointment_request_details (appointment_id, submission_id, request_digest,
                preferred_day, preferred_period, preferred_time,
                consent_contact, consent_whatsapp, consent_policy_version)
  VALUES (v_appt, v_submission, v_digest, v_day, v_period, v_time, true, v_whatsapp, v_policy);

  -- References only: reception already sees the request in the `demandes` queue.
  INSERT INTO app.notifications (cabinet_id, recipient_role, kind, payload)
  VALUES (v_cabinet, 'owner', 'appointment_request',
          jsonb_build_object('appointment_id', v_appt, 'channel', v_channel));

  RETURN jsonb_build_object('submissionId', v_submission, 'delivery', 'RECEIVED', 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION app.ingest_appointment_request(jsonb) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION app.ingest_appointment_request(jsonb) OWNER TO integration_intake;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mindcare_app') THEN
    GRANT USAGE ON SCHEMA app TO mindcare_app;
    GRANT EXECUTE ON FUNCTION app.ingest_appointment_request(jsonb) TO mindcare_app;
  END IF;
END $$;

COMMENT ON FUNCTION app.ingest_appointment_request(jsonb) IS
  '235. Canonical appointment-request intake (website, WhatsApp). Creates a pending '
  'identity + a requested, unlinked appointment. Never confirms, never holds a slot. '
  'Executable by mindcare_app only (server, after channel verification).';

-- ───────────────────────────────────────────────────────────────────────────
-- 5 · An unlinked request holds no slot and cannot be confirmed
-- ───────────────────────────────────────────────────────────────────────────
-- Same bodies as 063 and 117 except the marked lines.
CREATE OR REPLACE FUNCTION app.check_slot_available(
  p_practitioner_id  uuid,
  p_starts_at        timestamptz,
  p_duration_minutes integer,
  p_exclude_id       uuid DEFAULT NULL
)
RETURNS TABLE (disponible boolean, motif text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_fin      timestamptz;
  v_conflits integer;
BEGIN
  IF p_practitioner_id IS NULL OR p_starts_at IS NULL OR p_duration_minutes IS NULL THEN
    RETURN QUERY SELECT false, 'arguments-incomplets'::text;
    RETURN;
  END IF;

  IF p_duration_minutes < 5 OR p_duration_minutes > 240 THEN
    RETURN QUERY SELECT false, 'duree-hors-bornes'::text;
    RETURN;
  END IF;

  v_fin := p_starts_at + make_interval(mins => p_duration_minutes);

  SELECT count(*) INTO v_conflits
    FROM app.appointments a
   WHERE a.practitioner_id = p_practitioner_id
     AND a.status NOT IN ('cancelled', 'no_show')
     AND NOT (a.status = 'requested' AND a.patient_id IS NULL)   -- 235: a public request holds nothing
     AND (p_exclude_id IS NULL OR a.id <> p_exclude_id)
     AND a.starts_at < v_fin
     AND a.ends_at   > p_starts_at;

  IF v_conflits > 0 THEN
    RETURN QUERY SELECT false, 'creneau-occupe'::text;
  ELSE
    RETURN QUERY SELECT true, NULL::text;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.confirmer_apres_reverification(p_appointment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_praticien uuid;
  v_debut     timestamptz;
  v_fin       timestamptz;
  v_statut    app.appt_status;
  v_patient   uuid;
  v_conflits  integer;
BEGIN
  SELECT a.practitioner_id, a.starts_at, a.ends_at, a.status, a.patient_id
    INTO v_praticien, v_debut, v_fin, v_statut, v_patient
    FROM app.appointments a
   WHERE a.id = p_appointment_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_statut = 'confirmed' THEN
    RETURN true;
  END IF;
  IF v_statut <> 'requested' THEN
    RAISE EXCEPTION 'Seule une demande en attente peut être confirmée (état actuel : %).', v_statut;
  END IF;
  -- 235: a request is confirmed only once a real patient file is linked (accept gate).
  IF v_patient IS NULL THEN
    RAISE EXCEPTION 'Une demande sans dossier patient rattaché ne se confirme pas.'
      USING HINT = 'Accepter la demande : rattacher le patient, fixer l''horaire, puis confirmer.';
  END IF;

  PERFORM 1
    FROM app.appointments a
   WHERE a.practitioner_id = v_praticien
     AND a.status NOT IN ('cancelled', 'no_show')
     AND NOT (a.status = 'requested' AND a.patient_id IS NULL)   -- 235
     AND a.id <> p_appointment_id
     AND a.starts_at < v_fin
     AND a.ends_at   > v_debut
     FOR UPDATE;

  SELECT count(*) INTO v_conflits
    FROM app.appointments a
   WHERE a.practitioner_id = v_praticien
     AND a.status NOT IN ('cancelled', 'no_show')
     AND NOT (a.status = 'requested' AND a.patient_id IS NULL)   -- 235
     AND a.id <> p_appointment_id
     AND a.starts_at < v_fin
     AND a.ends_at   > v_debut;
  IF v_conflits > 0 THEN
    RAISE EXCEPTION 'Créneau occupé : une confirmation concurrente l''a pris.';
  END IF;

  UPDATE app.appointments a SET
    status     = 'confirmed',
    updated_at = now()
   WHERE a.id = p_appointment_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION app.confirm_appointment(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_statut  app.appt_status;
  v_patient uuid;
  v_id      uuid;
BEGIN
  SELECT a.status, a.patient_id INTO v_statut, v_patient FROM app.appointments a WHERE a.id = p_id;

  IF v_statut IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_statut <> 'requested' THEN
    RAISE EXCEPTION 'Seule une demande en attente peut être confirmée (état actuel : %).', v_statut
      USING HINT = 'Un rendez-vous déjà confirmé, arrivé, terminé ou annulé ne se confirme pas.';
  END IF;
  -- 235: same rule as 117.
  IF v_patient IS NULL THEN
    RAISE EXCEPTION 'Une demande sans dossier patient rattaché ne se confirme pas.'
      USING HINT = 'Accepter la demande : rattacher le patient, fixer l''horaire, puis confirmer.';
  END IF;

  UPDATE app.appointments a SET
    status     = 'confirmed',
    updated_at = now()
  WHERE a.id = p_id
  RETURNING a.id INTO v_id;

  RETURN v_id;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6 · Reception decides — SECURITY INVOKER, the RLS of the caller decides (022/025/117)
-- ───────────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.accept_appointment_request(
  p_appointment_id uuid,
  p_patient_id     uuid,
  p_starts_at      timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_appt     record;
  v_patient  app.patients;
  v_whatsapp boolean;
  v_phone    text;
BEGIN
  IF p_appointment_id IS NULL OR p_patient_id IS NULL OR p_starts_at IS NULL THEN
    RAISE EXCEPTION 'Demande incomplète : la demande, le patient et l''horaire sont requis.';
  END IF;

  SELECT a.status, a.patient_id, a.pending_patient_id, a.practitioner_id, a.starts_at, a.ends_at
    INTO v_appt
    FROM app.appointments a
   WHERE a.id = p_appointment_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;                       -- not found = out of scope, no oracle (ADR-003)
  END IF;
  IF v_appt.status = 'confirmed' AND v_appt.patient_id = p_patient_id THEN
    RETURN true;                        -- retry of an accepted request
  END IF;
  IF v_appt.status <> 'requested' OR v_appt.pending_patient_id IS NULL OR v_appt.patient_id IS NOT NULL THEN
    RAISE EXCEPTION 'Seule une demande en attente, non encore rattachée, peut être acceptée.';
  END IF;

  -- The audited patient gate (ADR-019) — never a direct SELECT on app.patients.
  SELECT * INTO v_patient FROM app.get_patient(p_patient_id);
  IF v_patient.id IS NULL THEN
    RAISE EXCEPTION 'Patient introuvable.';
  END IF;
  -- The practitioner wall (ADR-003): the request stays with its practitioner.
  IF v_patient.practitioner_id IS DISTINCT FROM v_appt.practitioner_id THEN
    RAISE EXCEPTION 'Ce patient est suivi par un autre praticien : la demande ne peut pas lui être rattachée.';
  END IF;

  UPDATE app.appointments a SET
    patient_id = p_patient_id,
    starts_at  = p_starts_at,
    ends_at    = p_starts_at + (v_appt.ends_at - v_appt.starts_at),
    updated_at = now()
   WHERE a.id = p_appointment_id;

  UPDATE app.pending_patients pp SET
    status             = CASE WHEN v_patient.created_at < pp.created_at THEN 'merged' ELSE 'validated' END::app.pending_status,
    matched_patient_id = p_patient_id,
    reviewed_by        = auth.uid(),
    reviewed_at        = now()
   WHERE pp.id = v_appt.pending_patient_id;

  -- The consent given with the request follows the person into the communication kernel —
  -- ONLY when the request's phone is the file's phone (last 9 digits, as 116 matches). A
  -- self-declared stranger must never grant or revoke a patient's consent (review finding).
  SELECT d.consent_whatsapp, pp.submitted_phone INTO v_whatsapp, v_phone
    FROM app.appointment_request_details d
    JOIN app.pending_patients pp ON pp.id = v_appt.pending_patient_id
   WHERE d.appointment_id = p_appointment_id;
  IF FOUND AND right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 9) IN (
       right(regexp_replace(coalesce(v_patient.phone, ''), '[^0-9]', '', 'g'), 9),
       right(regexp_replace(coalesce(v_patient.phone_alt, ''), '[^0-9]', '', 'g'), 9)) THEN
    PERFORM app.comm_set_consent(p_patient_id, 'whatsapp', v_whatsapp);
  END IF;

  -- Re-checks the agreed slot under lock; a conflict rolls the whole acceptance back.
  RETURN app.confirmer_apres_reverification(p_appointment_id);
END;
$$;

CREATE FUNCTION app.reject_appointment_request(p_appointment_id uuid, p_motif text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_appt record;
BEGIN
  SELECT a.status, a.patient_id, a.pending_patient_id, pp.status AS pending_status
    INTO v_appt
    FROM app.appointments a
    LEFT JOIN app.pending_patients pp ON pp.id = a.pending_patient_id
   WHERE a.id = p_appointment_id
     FOR UPDATE OF a;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_appt.status = 'cancelled' AND v_appt.pending_status = 'rejected' THEN
    RETURN true;                        -- retry of a rejected request
  END IF;
  IF v_appt.status <> 'requested' OR v_appt.pending_patient_id IS NULL OR v_appt.patient_id IS NOT NULL THEN
    RAISE EXCEPTION 'Seule une demande en attente, non encore rattachée, peut être refusée.';
  END IF;

  PERFORM app.cancel_appointment(p_appointment_id, p_motif);   -- motif required there (022)

  UPDATE app.pending_patients pp SET
    status        = 'rejected',
    reject_reason = btrim(p_motif),
    reviewed_by   = auth.uid(),
    reviewed_at   = now()
   WHERE pp.id = v_appt.pending_patient_id;
  RETURN true;
END;
$$;

ALTER FUNCTION app.accept_appointment_request(uuid, uuid, timestamptz) OWNER TO app_gatekeeper;
ALTER FUNCTION app.reject_appointment_request(uuid, text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.accept_appointment_request(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reject_appointment_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.accept_appointment_request(uuid, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION app.reject_appointment_request(uuid, text) TO authenticated;

COMMENT ON FUNCTION app.accept_appointment_request(uuid, uuid, timestamptz) IS
  '235. Reception accepts a request: links a real patient file (audited gate, practitioner '
  'wall), sets the agreed time, records the intake consent, confirms under lock (117).';
COMMENT ON FUNCTION app.reject_appointment_request(uuid, text) IS
  '235. Reception rejects a request: cancels with a motif (022), marks the pending identity rejected.';

-- ───────────────────────────────────────────────────────────────────────────
-- 7 · Reads keep their shape; an unlinked request shows its self-declared identity
-- ───────────────────────────────────────────────────────────────────────────
-- Same bodies as 181 except the pending_patients join and the COALESCEs (181:3-6 promised it).
CREATE OR REPLACE FUNCTION app.list_agenda(
  p_from         timestamptz,
  p_to           timestamptz,
  p_practitioner uuid   DEFAULT NULL,
  p_statuts      text[] DEFAULT NULL)
RETURNS TABLE (
  id                uuid,
  starts_at         timestamptz,
  ends_at           timestamptz,
  status            app.appt_status,
  source            app.appt_source,
  kind              app.consult_kind,
  notes_admin       text,
  arrived_at        timestamptz,
  patient_id        uuid,
  record_number     text,
  first_name        text,
  last_name         text,
  phone             text,
  practitioner_id   uuid,
  practitioner_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_statuts app.appt_status[];
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'Plage d''agenda invalide : la borne haute doit suivre la borne basse.';
  END IF;

  IF p_to - p_from > interval '62 days' THEN
    RAISE EXCEPTION 'Plage d''agenda trop large : 62 jours au maximum.'
      USING HINT = 'Une plage sans limite n''est pas un agenda, c''est un export.';
  END IF;

  IF p_statuts IS NOT NULL AND array_length(p_statuts, 1) IS NOT NULL THEN
    v_statuts := p_statuts::app.appt_status[];
  END IF;

  PERFORM audit.log_read(NULL, 'liste');

  RETURN QUERY
  SELECT a.id, a.starts_at, a.ends_at, a.status, a.source, a.kind, a.notes_admin,
         a.arrived_at,
         p.id, p.record_number,
         COALESCE(p.first_name, pp.first_name), COALESCE(p.last_name, pp.last_name),
         COALESCE(p.phone, pp.submitted_phone),
         a.practitioner_id, pr.full_name
  FROM app.appointments a
  LEFT JOIN app.patients p ON p.id = a.patient_id
  LEFT JOIN app.pending_patients pp ON pp.id = a.pending_patient_id AND a.patient_id IS NULL
  LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
  WHERE a.starts_at >= p_from
    AND a.starts_at <  p_to
    AND (p_practitioner IS NULL OR a.practitioner_id = p_practitioner)
    AND (v_statuts IS NULL OR a.status = ANY (v_statuts))
  ORDER BY a.starts_at, a.id;
END;
$$;

CREATE OR REPLACE FUNCTION app.get_appointment(p_id uuid)
RETURNS TABLE (
  id                uuid,
  starts_at         timestamptz,
  ends_at           timestamptz,
  status            app.appt_status,
  source            app.appt_source,
  kind              app.consult_kind,
  notes_admin       text,
  arrived_at        timestamptz,
  patient_id        uuid,
  record_number     text,
  first_name        text,
  last_name         text,
  phone             text,
  practitioner_id   uuid,
  practitioner_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_patient uuid;
BEGIN
  SELECT a.patient_id INTO v_patient FROM app.appointments a WHERE a.id = p_id;

  PERFORM audit.log_read(v_patient, 'liste');

  RETURN QUERY
  SELECT a.id, a.starts_at, a.ends_at, a.status, a.source, a.kind, a.notes_admin,
         a.arrived_at,
         p.id, p.record_number,
         COALESCE(p.first_name, pp.first_name), COALESCE(p.last_name, pp.last_name),
         COALESCE(p.phone, pp.submitted_phone),
         a.practitioner_id, pr.full_name
  FROM app.appointments a
  LEFT JOIN app.patients p ON p.id = a.patient_id
  LEFT JOIN app.pending_patients pp ON pp.id = a.pending_patient_id AND a.patient_id IS NULL
  LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
  WHERE a.id = p_id;
END;
$$;

-- Same body as 046 except the `demandes` rows (identity, phone, preference).
CREATE OR REPLACE FUNCTION app.reception_board(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_debut timestamptz;
  v_fin   timestamptz;
  v_resultat jsonb;
BEGIN
  IF p_day IS NULL THEN
    RETURN NULL;
  END IF;

  v_debut := p_day::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin   := (p_day + 1)::timestamp AT TIME ZONE 'Africa/Algiers';

  PERFORM audit.log_read(NULL, 'liste');

  SELECT jsonb_build_object(
    'journee', COALESCE(
      (SELECT jsonb_agg(ligne ORDER BY ligne->>'starts_at')
         FROM (
           SELECT jsonb_build_object(
                    'id', a.id,
                    'starts_at', a.starts_at,
                    'ends_at', a.ends_at,
                    'status', a.status,
                    'source', a.source,
                    'kind', a.kind,
                    'notes_admin', a.notes_admin,
                    'arrived_at', a.arrived_at,
                    'patient_id', a.patient_id,
                    'record_number', pt.record_number,
                    'first_name', pt.first_name,
                    'last_name', pt.last_name,
                    'practitioner_id', a.practitioner_id,
                    'practitioner_name', pr.full_name
                  ) AS ligne
             FROM app.appointments a
             LEFT JOIN app.patients pt ON pt.id = a.patient_id
             LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
            WHERE a.starts_at >= v_debut
              AND a.starts_at <  v_fin
              AND a.status IN ('confirmed','arrived','in_session','completed','no_show')
         ) g),
      '[]'::jsonb),
    'demandes', COALESCE(
      (SELECT jsonb_agg(ligne ORDER BY ligne->>'starts_at')
         FROM (
           SELECT jsonb_build_object(
                    'id', a.id,
                    'starts_at', a.starts_at,
                    'ends_at', a.ends_at,
                    'status', a.status,
                    'source', a.source,
                    'kind', a.kind,
                    'notes_admin', a.notes_admin,
                    'arrived_at', a.arrived_at,
                    'patient_id', a.patient_id,
                    'record_number', pt.record_number,
                    'first_name', COALESCE(pt.first_name, pp.first_name),
                    'last_name', COALESCE(pt.last_name, pp.last_name),
                    'phone', COALESCE(pt.phone, pp.submitted_phone),
                    'preferred_day', d.preferred_day,
                    'preferred_period', d.preferred_period,
                    'preferred_time', to_char(d.preferred_time, 'HH24:MI'),
                    'practitioner_id', a.practitioner_id,
                    'practitioner_name', pr.full_name
                  ) AS ligne
             FROM app.appointments a
             LEFT JOIN app.patients pt ON pt.id = a.patient_id
             LEFT JOIN app.pending_patients pp ON pp.id = a.pending_patient_id AND a.patient_id IS NULL
             LEFT JOIN app.appointment_request_details d ON d.appointment_id = a.id
             LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
            WHERE a.status = 'requested'
              -- 235: an unlinked request whose preferred day has passed is still WAITING for a
              -- call; it stays in the queue until accepted, rejected or expired (run_purges).
              AND (a.starts_at >= v_debut OR a.patient_id IS NULL)
              AND a.starts_at <  v_debut + interval '60 days'
         ) g),
      '[]'::jsonb),
    'paiements', COALESCE(
      (SELECT jsonb_agg(ligne ORDER BY ligne->>'created_at' DESC)
         FROM (
           SELECT jsonb_build_object(
                    'payment_id', pm.id,
                    'receipt_number', pm.receipt_number,
                    'amount_dzd', pm.amount_dzd,
                    'method', pm.method,
                    'set_at', pm.created_at,
                    'collected_at', pm.collected_at,
                    'patient_id', pm.patient_id,
                    'record_number', pt.record_number,
                    'first_name', pt.first_name,
                    'last_name', pt.last_name,
                    'practitioner_id', pm.practitioner_id,
                    'practitioner_name', pr.full_name
                  ) AS ligne
             FROM app.payments pm
             LEFT JOIN app.patients pt ON pt.id = pm.patient_id
             LEFT JOIN app.profiles pr ON pr.id = pm.practitioner_id
            WHERE pm.created_at > now() - interval '24 hours'
         ) g),
      '[]'::jsonb),
    'genere_a', now()
  )
  INTO v_resultat;

  RETURN v_resultat;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 8 · Purge: an expired request is cancelled, never deleted; a referenced pending
--     identity is kept (its retention is owner decision D5). Same body as 014 otherwise.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.run_purges()
RETURNS TABLE (target text, removed bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_catalog AS $$
DECLARE n bigint;
BEGIN
    -- 235: an unreviewed request past its expiry leaves the queue as `cancelled`
    -- (règle 3) and its pending identity as `rejected`.
    WITH expirees AS (
      UPDATE app.appointments a SET
        status      = 'cancelled',
        notes_admin = btrim(coalesce(a.notes_admin || E'\n', '') || 'Annulé : demande expirée'),
        updated_at  = now()
      FROM app.pending_patients p
      WHERE p.id = a.pending_patient_id
        AND a.status = 'requested' AND a.patient_id IS NULL
        AND p.status = 'awaiting' AND p.expires_at < now()
      RETURNING a.pending_patient_id
    )
    UPDATE app.pending_patients p SET
      status = 'rejected', reject_reason = 'demande expirée', reviewed_at = now()
    FROM expirees e WHERE p.id = e.pending_patient_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    target := 'requests_expired'; removed := n; RETURN NEXT;

    -- soumissions QR non validées, au-delà de 7 jours — jamais une identité qu'un
    -- rendez-vous référence encore (235 : sinon la clé étrangère faisait échouer TOUTE la purge).
    DELETE FROM app.pending_patients p
    WHERE p.status = 'awaiting' AND p.expires_at < now()
      AND NOT EXISTS (SELECT 1 FROM app.appointments a WHERE a.pending_patient_id = p.id);
    GET DIAGNOSTICS n = ROW_COUNT;
    target := 'pending_patients'; removed := n; RETURN NEXT;

    DELETE FROM app.live_insights WHERE emitted_at < now() - interval '90 days';
    GET DIAGNOSTICS n = ROW_COUNT;
    target := 'live_insights'; removed := n; RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION app.run_purges() FROM PUBLIC, anon, authenticated;

REVOKE CREATE ON SCHEMA app FROM integration_intake, app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('235_appointment_requests')
    ON CONFLICT DO NOTHING;

COMMIT;
