-- 075_treatment_gates — ADR-028 portes métier (7 writes). INVOKER, RLS décide, FOR UPDATE + versioning.

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: parse timing text -> jsonb array
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app._parse_timing(p_timing text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v jsonb;
BEGIN
  IF p_timing IS NULL OR btrim(p_timing) = '' THEN RETURN '[]'::jsonb; END IF;
  BEGIN
    v := p_timing::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'timing JSON invalide' USING ERRCODE='22P02';
  END;
  IF jsonb_typeof(v) <> 'array' THEN
    RAISE EXCEPTION 'timing doit être un tableau JSON' USING ERRCODE='22023';
  END IF;
  RETURN v;
END; $$;

-- ---------------------------------------------------------------------------
-- 1 · start_treatment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.start_treatment(
  p_patient_id uuid,
  p_medication_id uuid,
  p_dose text,
  p_dose_unit text,
  p_frequency text,
  p_timing text,
  p_instructions text,
  p_start_date date,
  p_end_date date,
  p_consultation_id uuid
) RETURNS SETOF app.patient_treatments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_cab uuid;
  v_actor uuid;
  v_is_synth boolean;
  v_timing jsonb;
  v_t app.patient_treatments%ROWTYPE;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE='42501'; END IF;
  v_cab := app.current_cabinet();
  IF v_cab IS NULL THEN RAISE EXCEPTION 'Cabinet introuvable' USING ERRCODE='42501'; END IF;
  IF p_patient_id IS NULL OR p_medication_id IS NULL THEN
    RAISE EXCEPTION 'Patient et médicament requis' USING ERRCODE='23502';
  END IF;
  PERFORM 1 FROM app.patients WHERE id = p_patient_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient introuvable ou hors périmètre' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM app.medications WHERE id = p_medication_id AND (cabinet_id IS NULL OR cabinet_id = v_cab) AND is_active IS DISTINCT FROM false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Médicament introuvable' USING ERRCODE='42501'; END IF;
  IF p_consultation_id IS NOT NULL THEN
    PERFORM 1 FROM app.consultations WHERE id = p_consultation_id AND patient_id = p_patient_id AND cabinet_id = v_cab;
    IF NOT FOUND THEN RAISE EXCEPTION 'Consultation invalide' USING ERRCODE='23503'; END IF;
  END IF;
  IF p_end_date IS NOT NULL AND p_start_date IS NOT NULL AND p_end_date < p_start_date THEN
    RAISE EXCEPTION 'La date de fin précède le début' USING ERRCODE='22000';
  END IF;
  v_timing := app._parse_timing(p_timing);
  v_is_synth := app.is_cloud_dev();

  INSERT INTO app.patient_treatments (
    cabinet_id, practitioner_id, patient_id, medication_id, consultation_id,
    status, dose, dose_unit, frequency, timing, instructions,
    start_date, end_date, current_version, is_synthetic
  ) VALUES (
    v_cab, v_actor, p_patient_id, p_medication_id, p_consultation_id,
    'active',
    nullif(btrim(coalesce(p_dose,'')), ''),
    nullif(btrim(coalesce(p_dose_unit,'')), ''),
    nullif(btrim(coalesce(p_frequency,'')), ''),
    v_timing,
    nullif(btrim(coalesce(p_instructions,'')), ''),
    COALESCE(p_start_date, (now() AT TIME ZONE 'Africa/Algiers')::date),
    p_end_date, 1, v_is_synth
  ) RETURNING * INTO v_t;

  INSERT INTO app.patient_treatment_history (treatment_id, version, action, previous_values, new_values, actor_id, consultation_id, is_synthetic)
  VALUES (v_t.id, 1, 'started', NULL, to_jsonb(v_t), v_actor, p_consultation_id, v_is_synth);

  RETURN QUERY SELECT * FROM app.patient_treatments WHERE id = v_t.id;
END; $$;
REVOKE ALL ON FUNCTION app.start_treatment(uuid, uuid, text, text, text, text, text, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.start_treatment(uuid, uuid, text, text, text, text, text, date, date, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2 · update_treatment  (dose / schedule) — p_changes JSON text, p_expected_version optimistic lock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.update_treatment(
  p_treatment_id uuid,
  p_expected_version integer,
  p_changes text,
  p_consultation_id uuid
) RETURNS SETOF app.patient_treatments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_t app.patient_treatments%ROWTYPE;
  v_new app.patient_treatments%ROWTYPE;
  v_cab uuid;
  v_actor uuid;
  v_is_synth boolean;
  v_j jsonb;
  v_dose text; v_dose_unit text; v_freq text; v_instr text; v_timing jsonb;
  v_has_changes boolean := false;
  v_action app.treatment_action := 'dose_changed';
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE='42501'; END IF;
  v_cab := app.current_cabinet();
  SELECT * INTO v_t FROM app.patient_treatments WHERE id = p_treatment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement introuvable' USING ERRCODE='42501'; END IF;
  IF v_t.cabinet_id <> v_cab OR NOT app.can_see_clinical(v_t.practitioner_id) AND app.current_role() <> 'owner' THEN
    -- RLS already filtered but explicit for clarity
    RAISE EXCEPTION 'Traitement hors périmètre' USING ERRCODE='42501';
  END IF;
  IF v_t.status = 'stopped' THEN
    RAISE EXCEPTION 'Traitement arrêté : utilisez restart' USING ERRCODE='23514';
  END IF;
  IF p_expected_version IS NOT NULL AND v_t.current_version <> p_expected_version THEN
    RAISE EXCEPTION 'Conflit de version : rechargez le traitement' USING ERRCODE='40001';
  END IF;
  IF p_consultation_id IS NOT NULL THEN
    PERFORM 1 FROM app.consultations WHERE id = p_consultation_id AND patient_id = v_t.patient_id AND cabinet_id = v_cab;
    IF NOT FOUND THEN RAISE EXCEPTION 'Consultation invalide' USING ERRCODE='23503'; END IF;
  END IF;
  BEGIN
    v_j := COALESCE(p_changes::jsonb, '{}'::jsonb);
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'p_changes JSON invalide' USING ERRCODE='22P02';
  END;
  -- whitelist keys
  IF v_j ? 'status' OR v_j ? 'stopped_reason' OR v_j ? 'stopped_at' OR v_j ? 'patient_id' OR v_j ? 'medication_id' THEN
    RAISE EXCEPTION 'Champ non modifiable via update' USING ERRCODE='23514';
  END IF;
  v_dose := COALESCE(nullif(btrim(v_j->>'dose'), ''), v_t.dose);
  -- allow explicit null to clear
  IF v_j ? 'dose' AND (v_j->>'dose' IS NULL OR btrim(v_j->>'dose')='') THEN v_dose := NULL; END IF;
  v_dose_unit := COALESCE(nullif(btrim(v_j->>'dose_unit'), ''), v_t.dose_unit);
  IF v_j ? 'dose_unit' AND (v_j->>'dose_unit' IS NULL OR btrim(v_j->>'dose_unit')='') THEN v_dose_unit := NULL; END IF;
  v_freq := COALESCE(nullif(btrim(v_j->>'frequency'), ''), v_t.frequency);
  IF v_j ? 'frequency' AND (v_j->>'frequency' IS NULL OR btrim(v_j->>'frequency')='') THEN v_freq := NULL; END IF;
  v_instr := COALESCE(nullif(btrim(v_j->>'instructions'), ''), v_t.instructions);
  IF v_j ? 'instructions' AND (v_j->>'instructions' IS NULL OR btrim(v_j->>'instructions')='') THEN v_instr := NULL; END IF;
  IF v_j ? 'timing' THEN
    IF v_j->>'timing' IS NULL OR btrim(v_j->>'timing')='' THEN
      v_timing := '[]'::jsonb;
    ELSIF jsonb_typeof(v_j->'timing') = 'array' THEN
      v_timing := v_j->'timing';
    ELSE
      -- timing may arrive as JSON string
      v_timing := app._parse_timing(v_j->>'timing');
    END IF;
  ELSE
    v_timing := v_t.timing;
  END IF;

  -- detect changes
  IF v_dose IS DISTINCT FROM v_t.dose OR v_dose_unit IS DISTINCT FROM v_t.dose_unit THEN v_has_changes := true; v_action := 'dose_changed';
  ELSIF v_freq IS DISTINCT FROM v_t.frequency OR v_timing IS DISTINCT FROM v_t.timing OR v_instr IS DISTINCT FROM v_t.instructions THEN v_has_changes := true; v_action := 'schedule_changed';
  END IF;
  -- also handle start/end dates if provided
  DECLARE v_start date := COALESCE((v_j->>'start_date')::date, v_t.start_date);
          v_end date := v_t.end_date;
  BEGIN
    IF v_j ? 'end_date' THEN
      IF v_j->>'end_date' IS NULL OR btrim(v_j->>'end_date')='' THEN v_end := NULL; ELSE v_end := (v_j->>'end_date')::date; END IF;
    END IF;
    IF v_j ? 'start_date' AND v_j->>'start_date' IS NOT NULL THEN v_start := (v_j->>'start_date')::date; END IF;
    IF v_end IS NOT NULL AND v_end < v_start THEN RAISE EXCEPTION 'Date de fin invalide' USING ERRCODE='22000'; END IF;
    IF v_start IS DISTINCT FROM v_t.start_date OR v_end IS DISTINCT FROM v_t.end_date THEN v_has_changes := true; IF v_action='dose_changed' THEN NULL; ELSE v_action:='schedule_changed'; END IF; END IF;
    -- apply update only if changes
    IF NOT v_has_changes THEN
      RETURN QUERY SELECT * FROM app.patient_treatments WHERE id = v_t.id;
      RETURN;
    END IF;

    v_is_synth := app.is_cloud_dev();
    UPDATE app.patient_treatments
      SET dose = v_dose, dose_unit = v_dose_unit, frequency = v_freq, timing = v_timing, instructions = v_instr,
          start_date = v_start, end_date = v_end,
          current_version = v_t.current_version + 1,
          updated_at = now(),
          is_synthetic = v_is_synth
      WHERE id = v_t.id
      RETURNING * INTO v_new;

    INSERT INTO app.patient_treatment_history (treatment_id, version, action, previous_values, new_values, actor_id, consultation_id, is_synthetic)
    VALUES (v_new.id, v_new.current_version, v_action, to_jsonb(v_t), to_jsonb(v_new), v_actor, p_consultation_id, v_is_synth);

    RETURN QUERY SELECT * FROM app.patient_treatments WHERE id = v_new.id;
  END;
END; $$;
REVOKE ALL ON FUNCTION app.update_treatment(uuid, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_treatment(uuid, integer, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · pause_treatment  active -> paused
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.pause_treatment(
  p_treatment_id uuid,
  p_expected_version integer,
  p_consultation_id uuid
) RETURNS SETOF app.patient_treatments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE v_t app.patient_treatments%ROWTYPE; v_new app.patient_treatments%ROWTYPE; v_actor uuid; v_is_synth boolean;
BEGIN
  v_actor := auth.uid(); IF v_actor IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_t FROM app.patient_treatments WHERE id = p_treatment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement introuvable' USING ERRCODE='42501'; END IF;
  IF p_expected_version IS NOT NULL AND v_t.current_version <> p_expected_version THEN
    RAISE EXCEPTION 'Conflit de version' USING ERRCODE='40001';
  END IF;
  IF v_t.status <> 'active' THEN RAISE EXCEPTION 'Seul un traitement actif peut être mis en pause' USING ERRCODE='23514'; END IF;
  IF p_consultation_id IS NOT NULL THEN PERFORM 1 FROM app.consultations WHERE id=p_consultation_id AND patient_id=v_t.patient_id; IF NOT FOUND THEN RAISE EXCEPTION 'Consultation invalide' USING ERRCODE='23503'; END IF; END IF;
  v_is_synth := app.is_cloud_dev();
  UPDATE app.patient_treatments SET status='paused', current_version=v_t.current_version+1, updated_at=now(), is_synthetic=v_is_synth WHERE id=v_t.id RETURNING * INTO v_new;
  INSERT INTO app.patient_treatment_history (treatment_id, version, action, previous_values, new_values, actor_id, consultation_id, is_synthetic)
  VALUES (v_new.id, v_new.current_version, 'paused', to_jsonb(v_t), to_jsonb(v_new), v_actor, p_consultation_id, v_is_synth);
  RETURN QUERY SELECT * FROM app.patient_treatments WHERE id=v_new.id;
END; $$;
REVOKE ALL ON FUNCTION app.pause_treatment(uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.pause_treatment(uuid, integer, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · resume_treatment  paused -> active
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.resume_treatment(
  p_treatment_id uuid,
  p_expected_version integer,
  p_consultation_id uuid
) RETURNS SETOF app.patient_treatments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE v_t app.patient_treatments%ROWTYPE; v_new app.patient_treatments%ROWTYPE; v_actor uuid; v_is_synth boolean;
BEGIN
  v_actor := auth.uid(); IF v_actor IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_t FROM app.patient_treatments WHERE id=p_treatment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement introuvable' USING ERRCODE='42501'; END IF;
  IF p_expected_version IS NOT NULL AND v_t.current_version <> p_expected_version THEN RAISE EXCEPTION 'Conflit de version' USING ERRCODE='40001'; END IF;
  IF v_t.status <> 'paused' THEN RAISE EXCEPTION 'Seul un traitement en pause peut être repris' USING ERRCODE='23514'; END IF;
  IF p_consultation_id IS NOT NULL THEN PERFORM 1 FROM app.consultations WHERE id=p_consultation_id AND patient_id=v_t.patient_id; IF NOT FOUND THEN RAISE EXCEPTION 'Consultation invalide' USING ERRCODE='23503'; END IF; END IF;
  v_is_synth := app.is_cloud_dev();
  UPDATE app.patient_treatments SET status='active', current_version=v_t.current_version+1, updated_at=now(), is_synthetic=v_is_synth WHERE id=v_t.id RETURNING * INTO v_new;
  INSERT INTO app.patient_treatment_history (treatment_id, version, action, previous_values, new_values, actor_id, consultation_id, is_synthetic)
  VALUES (v_new.id, v_new.current_version, 'resumed', to_jsonb(v_t), to_jsonb(v_new), v_actor, p_consultation_id, v_is_synth);
  RETURN QUERY SELECT * FROM app.patient_treatments WHERE id=v_new.id;
END; $$;
REVOKE ALL ON FUNCTION app.resume_treatment(uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resume_treatment(uuid, integer, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5 · stop_treatment  active|paused -> stopped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.stop_treatment(
  p_treatment_id uuid,
  p_expected_version integer,
  p_reason text,
  p_consultation_id uuid,
  p_notes text
) RETURNS SETOF app.patient_treatments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE v_t app.patient_treatments%ROWTYPE; v_new app.patient_treatments%ROWTYPE; v_actor uuid; v_is_synth boolean; v_reason app.stopped_reason;
BEGIN
  v_actor := auth.uid(); IF v_actor IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_t FROM app.patient_treatments WHERE id=p_treatment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement introuvable' USING ERRCODE='42501'; END IF;
  IF p_expected_version IS NOT NULL AND v_t.current_version <> p_expected_version THEN RAISE EXCEPTION 'Conflit de version' USING ERRCODE='40001'; END IF;
  IF v_t.status = 'stopped' THEN RAISE EXCEPTION 'Traitement déjà arrêté' USING ERRCODE='23514'; END IF;
  IF p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN
    BEGIN v_reason := p_reason::app.stopped_reason; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Motif d arrêt invalide' USING ERRCODE='22023'; END;
  ELSE v_reason := NULL; END IF;
  IF p_consultation_id IS NOT NULL THEN PERFORM 1 FROM app.consultations WHERE id=p_consultation_id AND patient_id=v_t.patient_id; IF NOT FOUND THEN RAISE EXCEPTION 'Consultation invalide' USING ERRCODE='23503'; END IF; END IF;
  v_is_synth := app.is_cloud_dev();
  UPDATE app.patient_treatments
    SET status='stopped', stopped_at=now(), stopped_reason=v_reason, current_version=v_t.current_version+1, updated_at=now(), is_synthetic=v_is_synth
    WHERE id=v_t.id RETURNING * INTO v_new;
  INSERT INTO app.patient_treatment_history (treatment_id, version, action, previous_values, new_values, actor_id, consultation_id, reason, notes, is_synthetic)
  VALUES (v_new.id, v_new.current_version, 'stopped', to_jsonb(v_t), to_jsonb(v_new), v_actor, p_consultation_id, p_reason, nullif(btrim(p_notes),''), v_is_synth);
  RETURN QUERY SELECT * FROM app.patient_treatments WHERE id=v_new.id;
END; $$;
REVOKE ALL ON FUNCTION app.stop_treatment(uuid, integer, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.stop_treatment(uuid, integer, text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6 · restart_treatment  stopped -> NEW active episode (previous_treatment_id link)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.restart_treatment(
  p_old_treatment_id uuid,
  p_dose text,
  p_dose_unit text,
  p_frequency text,
  p_timing text,
  p_instructions text,
  p_start_date date,
  p_consultation_id uuid
) RETURNS SETOF app.patient_treatments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE v_old app.patient_treatments%ROWTYPE; v_new app.patient_treatments%ROWTYPE; v_cab uuid; v_actor uuid; v_is_synth boolean; v_timing jsonb;
BEGIN
  v_actor := auth.uid(); IF v_actor IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE='42501'; END IF;
  v_cab := app.current_cabinet(); IF v_cab IS NULL THEN RAISE EXCEPTION 'Cabinet introuvable' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_old FROM app.patient_treatments WHERE id=p_old_treatment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement source introuvable' USING ERRCODE='42501'; END IF;
  IF v_old.status <> 'stopped' THEN RAISE EXCEPTION 'Seul un traitement arrêté peut être redémarré' USING ERRCODE='23514'; END IF;
  IF p_consultation_id IS NOT NULL THEN PERFORM 1 FROM app.consultations WHERE id=p_consultation_id AND patient_id=v_old.patient_id AND cabinet_id=v_cab; IF NOT FOUND THEN RAISE EXCEPTION 'Consultation invalide' USING ERRCODE='23503'; END IF; END IF;
  v_timing := app._parse_timing(COALESCE(p_timing, v_old.timing::text));
  v_is_synth := app.is_cloud_dev();
  INSERT INTO app.patient_treatments (
    cabinet_id, practitioner_id, patient_id, medication_id, consultation_id, previous_treatment_id,
    status, dose, dose_unit, frequency, timing, instructions, start_date, end_date, current_version, is_synthetic
  ) VALUES (
    v_old.cabinet_id, v_actor, v_old.patient_id, v_old.medication_id, p_consultation_id, v_old.id,
    'active',
    COALESCE(nullif(btrim(p_dose),''), v_old.dose),
    COALESCE(nullif(btrim(p_dose_unit),''), v_old.dose_unit),
    COALESCE(nullif(btrim(p_frequency),''), v_old.frequency),
    v_timing,
    COALESCE(nullif(btrim(p_instructions),''), v_old.instructions),
    COALESCE(p_start_date, (now() AT TIME ZONE 'Africa/Algiers')::date),
    NULL, 1, v_is_synth
  ) RETURNING * INTO v_new;
  INSERT INTO app.patient_treatment_history (treatment_id, version, action, previous_values, new_values, actor_id, consultation_id, is_synthetic)
  VALUES (v_new.id, 1, 'started', NULL, to_jsonb(v_new), v_actor, p_consultation_id, v_is_synth);
  RETURN QUERY SELECT * FROM app.patient_treatments WHERE id=v_new.id;
END; $$;
REVOKE ALL ON FUNCTION app.restart_treatment(uuid, text, text, text, text, text, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.restart_treatment(uuid, text, text, text, text, text, date, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7 · renew_treatment  active/paused prolonge end_date
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.renew_treatment(
  p_treatment_id uuid,
  p_expected_version integer,
  p_end_date date,
  p_consultation_id uuid
) RETURNS SETOF app.patient_treatments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE v_t app.patient_treatments%ROWTYPE; v_new app.patient_treatments%ROWTYPE; v_actor uuid; v_is_synth boolean;
BEGIN
  v_actor := auth.uid(); IF v_actor IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_t FROM app.patient_treatments WHERE id=p_treatment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement introuvable' USING ERRCODE='42501'; END IF;
  IF p_expected_version IS NOT NULL AND v_t.current_version <> p_expected_version THEN RAISE EXCEPTION 'Conflit de version' USING ERRCODE='40001'; END IF;
  IF v_t.status = 'stopped' THEN RAISE EXCEPTION 'Traitement arrêté : utilisez restart' USING ERRCODE='23514'; END IF;
  IF p_end_date IS NULL THEN RAISE EXCEPTION 'Date de fin requise pour renouveler' USING ERRCODE='23502'; END IF;
  IF p_end_date < v_t.start_date THEN RAISE EXCEPTION 'Date de fin invalide' USING ERRCODE='22000'; END IF;
  IF p_consultation_id IS NOT NULL THEN PERFORM 1 FROM app.consultations WHERE id=p_consultation_id AND patient_id=v_t.patient_id; IF NOT FOUND THEN RAISE EXCEPTION 'Consultation invalide' USING ERRCODE='23503'; END IF; END IF;
  v_is_synth := app.is_cloud_dev();
  UPDATE app.patient_treatments SET end_date=p_end_date, current_version=v_t.current_version+1, updated_at=now(), is_synthetic=v_is_synth WHERE id=v_t.id RETURNING * INTO v_new;
  INSERT INTO app.patient_treatment_history (treatment_id, version, action, previous_values, new_values, actor_id, consultation_id, is_synthetic)
  VALUES (v_new.id, v_new.current_version, 'renewed', to_jsonb(v_t), to_jsonb(v_new), v_actor, p_consultation_id, v_is_synth);
  RETURN QUERY SELECT * FROM app.patient_treatments WHERE id=v_new.id;
END; $$;
REVOKE ALL ON FUNCTION app.renew_treatment(uuid, integer, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.renew_treatment(uuid, integer, date, uuid) TO authenticated;

INSERT INTO app.schema_migrations (version) VALUES ('075_treatment_gates')
  ON CONFLICT DO NOTHING;

COMMIT;
