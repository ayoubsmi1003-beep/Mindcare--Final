-- 213_medication_phase2_gates — lectures et écritures de la Phase 2.
--
-- Lectures : SECURITY DEFINER, propriétaire app_gatekeeper, trace audit.log_read,
-- cloison clinique et cabinet. Écritures : SECURITY DEFINER app_gatekeeper,
-- la RLS décide ; aucune mise à jour, aucune suppression (tables append-only).
--
-- Toutes les écritures sont des FAITS saisis par la praticienne. Aucune ne
-- calcule une interaction, une observance ou une posologie.

BEGIN;

-- Les portes d'écriture sont SECURITY DEFINER app_gatekeeper (ADR-019) : elles
-- lisent app.patients sans exposer de SELECT direct au navigateur.
GRANT SELECT, INSERT ON app.patient_allergy_events TO app_gatekeeper;
GRANT SELECT, INSERT ON app.patient_adverse_events TO app_gatekeeper;
GRANT SELECT, INSERT ON app.patient_measurements TO app_gatekeeper;
GRANT SELECT, INSERT ON app.treatment_adherence_reports TO app_gatekeeper;
GRANT SELECT, INSERT ON app.treatment_interaction_reviews TO app_gatekeeper;
GRANT SELECT, INSERT ON app.interaction_review_treatments TO app_gatekeeper;
GRANT SELECT, INSERT ON app.prescription_renewal_links TO app_gatekeeper;

-- ===========================================================================
-- LECTURES
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.list_patient_allergies(p_id uuid)
RETURNS SETOF app.patient_allergy_events
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_pat app.patients%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  PERFORM audit.log_read(p_id, 'liste');
  SELECT * INTO v_pat FROM app.patients WHERE id = p_id;
  IF NOT FOUND OR v_pat.cabinet_id IS DISTINCT FROM app.current_cabinet() THEN RETURN; END IF;
  IF NOT app.can_see_clinical(v_pat.practitioner_id) THEN RETURN; END IF;

  RETURN QUERY
  SELECT e.*
  FROM app.patient_allergy_events e
  WHERE e.patient_id = p_id AND e.cabinet_id = v_pat.cabinet_id
  ORDER BY e.recorded_at DESC, e.id DESC;
END; $$;

ALTER FUNCTION app.list_patient_allergies(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_patient_allergies(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_patient_allergies(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.list_patient_adverse_events(p_id uuid, p_limit integer DEFAULT 100)
RETURNS SETOF app.patient_adverse_events
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_pat app.patients%ROWTYPE;
  v_limit integer;
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  PERFORM audit.log_read(p_id, 'liste');
  SELECT * INTO v_pat FROM app.patients WHERE id = p_id;
  IF NOT FOUND OR v_pat.cabinet_id IS DISTINCT FROM app.current_cabinet() THEN RETURN; END IF;
  IF NOT app.can_see_clinical(v_pat.practitioner_id) THEN RETURN; END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);

  RETURN QUERY
  SELECT e.*
  FROM app.patient_adverse_events e
  WHERE e.patient_id = p_id AND e.cabinet_id = v_pat.cabinet_id
  ORDER BY e.recorded_at DESC, e.id DESC
  LIMIT v_limit;
END; $$;

ALTER FUNCTION app.list_patient_adverse_events(uuid, integer) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_patient_adverse_events(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_patient_adverse_events(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION app.list_patient_measurements(
  p_id uuid,
  p_kind text DEFAULT NULL,
  p_limit integer DEFAULT 500
) RETURNS SETOF app.patient_measurements
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_pat app.patients%ROWTYPE;
  v_limit integer;
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  PERFORM audit.log_read(p_id, 'liste');
  SELECT * INTO v_pat FROM app.patients WHERE id = p_id;
  IF NOT FOUND OR v_pat.cabinet_id IS DISTINCT FROM app.current_cabinet() THEN RETURN; END IF;
  IF NOT app.can_see_clinical(v_pat.practitioner_id) THEN RETURN; END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);

  RETURN QUERY
  SELECT m.*
  FROM app.patient_measurements m
  WHERE m.patient_id = p_id
    AND m.cabinet_id = v_pat.cabinet_id
    AND (p_kind IS NULL OR btrim(p_kind) = '' OR m.kind = btrim(p_kind))
  ORDER BY m.measured_at DESC, m.id DESC
  LIMIT v_limit;
END; $$;

ALTER FUNCTION app.list_patient_measurements(uuid, text, integer) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_patient_measurements(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_patient_measurements(uuid, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION app.list_patient_adherence(p_id uuid)
RETURNS SETOF app.treatment_adherence_reports
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_pat app.patients%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  PERFORM audit.log_read(p_id, 'liste');
  SELECT * INTO v_pat FROM app.patients WHERE id = p_id;
  IF NOT FOUND OR v_pat.cabinet_id IS DISTINCT FROM app.current_cabinet() THEN RETURN; END IF;
  IF NOT app.can_see_clinical(v_pat.practitioner_id) THEN RETURN; END IF;

  RETURN QUERY
  SELECT r.*
  FROM app.treatment_adherence_reports r
  WHERE r.patient_id = p_id AND r.cabinet_id = v_pat.cabinet_id
  ORDER BY r.period_end DESC, r.recorded_at DESC, r.id DESC;
END; $$;

ALTER FUNCTION app.list_patient_adherence(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_patient_adherence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_patient_adherence(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.list_patient_interaction_reviews(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_pat app.patients%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  PERFORM audit.log_read(p_id, 'liste');
  SELECT * INTO v_pat FROM app.patients WHERE id = p_id;
  IF NOT FOUND OR v_pat.cabinet_id IS DISTINCT FROM app.current_cabinet() THEN RETURN NULL; END IF;
  IF NOT app.can_see_clinical(v_pat.practitioner_id) THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'source', r.source,
    'conclusion', r.conclusion,
    'notes', r.notes,
    'recorded_at', r.recorded_at,
    'practitioner_name', pr.full_name,
    'treatments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'treatment_id', t.id,
        'medication_name', COALESCE(m.source_raw_value, m.brand_name, m.inn),
        'dose', t.dose,
        'dose_unit', t.dose_unit,
        'status', t.status
      ) ORDER BY t.start_date DESC)
      FROM app.interaction_review_treatments i
      JOIN app.patient_treatments t ON t.id = i.treatment_id
      JOIN app.medications m ON m.id = t.medication_id
      WHERE i.review_id = r.id
    ), '[]'::jsonb)
  ) ORDER BY r.recorded_at DESC, r.id DESC), '[]'::jsonb)
  INTO v_result
  FROM app.treatment_interaction_reviews r
  LEFT JOIN app.profiles pr ON pr.id = r.practitioner_id
  WHERE r.patient_id = p_id AND r.cabinet_id = v_pat.cabinet_id;

  RETURN v_result;
END; $$;

ALTER FUNCTION app.list_patient_interaction_reviews(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_patient_interaction_reviews(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_patient_interaction_reviews(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.list_patient_renewal_links(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_pat app.patients%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  PERFORM audit.log_read(p_id, 'liste');
  SELECT * INTO v_pat FROM app.patients WHERE id = p_id;
  IF NOT FOUND OR v_pat.cabinet_id IS DISTINCT FROM app.current_cabinet() THEN RETURN NULL; END IF;
  IF NOT app.can_see_clinical(v_pat.practitioner_id) THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'new_document_id', l.new_document_id,
    'new_document_number', nd.doc_number,
    'new_issued_at', nd.issued_at,
    'previous_document_id', l.previous_document_id,
    'previous_document_number', pd.doc_number,
    'previous_issued_at', pd.issued_at,
    'linked_at', l.linked_at,
    'notes', l.notes
  ) ORDER BY l.linked_at DESC, l.id DESC), '[]'::jsonb)
  INTO v_result
  FROM app.prescription_renewal_links l
  JOIN app.documents nd ON nd.id = l.new_document_id
  JOIN app.documents pd ON pd.id = l.previous_document_id
  WHERE l.patient_id = p_id AND l.cabinet_id = v_pat.cabinet_id;

  RETURN v_result;
END; $$;

ALTER FUNCTION app.list_patient_renewal_links(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_patient_renewal_links(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_patient_renewal_links(uuid) TO authenticated;

-- ===========================================================================
-- ÉCRITURES — faits saisis, jamais déduits
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.record_patient_allergy(
  p_patient_id uuid,
  p_substance text,
  p_reaction text,
  p_severity app.allergy_severity,
  p_event_kind app.allergy_event_kind,
  p_notes text DEFAULT NULL,
  p_consultation_id uuid DEFAULT NULL
) RETURNS SETOF app.patient_allergy_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_cab uuid := app.current_cabinet();
  v_key text;
  v_row app.patient_allergy_events%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_cab IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501'; END IF;
  IF app.current_role() NOT IN ('owner','practitioner') THEN
    RAISE EXCEPTION 'Rôle non clinique' USING ERRCODE = '42501';
  END IF;
  IF p_patient_id IS NULL OR btrim(COALESCE(p_substance, '')) = '' THEN
    RAISE EXCEPTION 'Patient et substance requis' USING ERRCODE = '23502';
  END IF;
  IF btrim(p_substance) <> p_substance OR length(p_substance) > 200 THEN
    RAISE EXCEPTION 'Substance invalide' USING ERRCODE = '22023';
  END IF;
  IF p_event_kind = 'noted' AND p_severity IS NULL THEN
    RAISE EXCEPTION 'Sévérité requise pour une allergie déclarée' USING ERRCODE = '23502';
  END IF;

  PERFORM 1 FROM app.patients
  WHERE id = p_patient_id AND cabinet_id = v_cab;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient introuvable ou hors périmètre' USING ERRCODE = '42501'; END IF;

  IF p_consultation_id IS NOT NULL THEN
    PERFORM 1 FROM app.consultations
    WHERE id = p_consultation_id AND patient_id = p_patient_id AND cabinet_id = v_cab;
    IF NOT FOUND THEN RAISE EXCEPTION 'Séance hors périmètre' USING ERRCODE = '42501'; END IF;
  END IF;

  v_key := app.nom_recherche(btrim(p_substance));
  IF v_key IS NULL OR v_key = '' THEN v_key := lower(btrim(p_substance)); END IF;

  INSERT INTO app.patient_allergy_events (
    cabinet_id, patient_id, practitioner_id, consultation_id,
    substance, substance_key, reaction, severity, event_kind, notes, is_synthetic
  ) VALUES (
    v_cab, p_patient_id, v_actor, p_consultation_id,
    btrim(p_substance), v_key, NULLIF(btrim(COALESCE(p_reaction, '')), ''),
    CASE WHEN p_event_kind = 'noted' THEN p_severity ELSE NULL END,
    p_event_kind, NULLIF(btrim(COALESCE(p_notes, '')), ''), app.is_cloud_dev()
  ) RETURNING * INTO v_row;

  RETURN NEXT v_row;
END; $$;

ALTER FUNCTION app.record_patient_allergy(uuid, text, text, app.allergy_severity, app.allergy_event_kind, text, uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.record_patient_allergy(uuid, text, text, app.allergy_severity, app.allergy_event_kind, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_patient_allergy(uuid, text, text, app.allergy_severity, app.allergy_event_kind, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.record_adverse_event(
  p_patient_id uuid,
  p_symptom text,
  p_severity app.adverse_severity,
  p_treatment_id uuid DEFAULT NULL,
  p_onset_date date DEFAULT NULL,
  p_resolved_date date DEFAULT NULL,
  p_action_taken text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_consultation_id uuid DEFAULT NULL
) RETURNS SETOF app.patient_adverse_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_cab uuid := app.current_cabinet();
  v_medication uuid;
  v_row app.patient_adverse_events%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_cab IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501'; END IF;
  IF app.current_role() NOT IN ('owner','practitioner') THEN
    RAISE EXCEPTION 'Rôle non clinique' USING ERRCODE = '42501';
  END IF;
  IF p_patient_id IS NULL OR btrim(COALESCE(p_symptom, '')) = '' THEN
    RAISE EXCEPTION 'Patient et symptôme requis' USING ERRCODE = '23502';
  END IF;
  IF p_resolved_date IS NOT NULL AND p_onset_date IS NOT NULL AND p_resolved_date < p_onset_date THEN
    RAISE EXCEPTION 'Date de résolution antérieure à l''apparition' USING ERRCODE = '22007';
  END IF;

  PERFORM 1 FROM app.patients
  WHERE id = p_patient_id AND cabinet_id = v_cab;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient introuvable ou hors périmètre' USING ERRCODE = '42501'; END IF;

  IF p_treatment_id IS NOT NULL THEN
    SELECT t.medication_id INTO v_medication
    FROM app.patient_treatments t
    WHERE t.id = p_treatment_id AND t.patient_id = p_patient_id AND t.cabinet_id = v_cab;
    IF NOT FOUND THEN RAISE EXCEPTION 'Traitement hors périmètre' USING ERRCODE = '42501'; END IF;
  END IF;

  IF p_consultation_id IS NOT NULL THEN
    PERFORM 1 FROM app.consultations
    WHERE id = p_consultation_id AND patient_id = p_patient_id AND cabinet_id = v_cab;
    IF NOT FOUND THEN RAISE EXCEPTION 'Séance hors périmètre' USING ERRCODE = '42501'; END IF;
  END IF;

  INSERT INTO app.patient_adverse_events (
    cabinet_id, patient_id, practitioner_id, consultation_id,
    treatment_id, medication_id, symptom, severity, onset_date, resolved_date,
    action_taken, description, is_synthetic
  ) VALUES (
    v_cab, p_patient_id, v_actor, p_consultation_id,
    p_treatment_id, v_medication, btrim(p_symptom), p_severity, p_onset_date, p_resolved_date,
    NULLIF(btrim(COALESCE(p_action_taken, '')), ''), NULLIF(btrim(COALESCE(p_description, '')), ''), app.is_cloud_dev()
  ) RETURNING * INTO v_row;

  RETURN NEXT v_row;
END; $$;

ALTER FUNCTION app.record_adverse_event(uuid, text, app.adverse_severity, uuid, date, date, text, text, uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.record_adverse_event(uuid, text, app.adverse_severity, uuid, date, date, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_adverse_event(uuid, text, app.adverse_severity, uuid, date, date, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.record_measurement(
  p_patient_id uuid,
  p_kind text,
  p_value numeric,
  p_unit text,
  p_measured_at timestamptz,
  p_source app.measurement_source,
  p_reference_low numeric DEFAULT NULL,
  p_reference_high numeric DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_consultation_id uuid DEFAULT NULL
) RETURNS SETOF app.patient_measurements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_cab uuid := app.current_cabinet();
  v_row app.patient_measurements%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_cab IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501'; END IF;
  IF app.current_role() NOT IN ('owner','practitioner') THEN
    RAISE EXCEPTION 'Rôle non clinique' USING ERRCODE = '42501';
  END IF;
  IF p_patient_id IS NULL OR p_value IS NULL OR p_measured_at IS NULL THEN
    RAISE EXCEPTION 'Patient, valeur et date requis' USING ERRCODE = '23502';
  END IF;
  IF p_kind !~ '^[a-z0-9_]{2,40}$' OR btrim(COALESCE(p_unit, '')) = '' THEN
    RAISE EXCEPTION 'Mesure ou unité invalide' USING ERRCODE = '22023';
  END IF;
  IF p_reference_low IS NOT NULL AND p_reference_high IS NOT NULL AND p_reference_low > p_reference_high THEN
    RAISE EXCEPTION 'Bornes de référence inversées' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM app.patients
  WHERE id = p_patient_id AND cabinet_id = v_cab;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient introuvable ou hors périmètre' USING ERRCODE = '42501'; END IF;

  IF p_consultation_id IS NOT NULL THEN
    PERFORM 1 FROM app.consultations
    WHERE id = p_consultation_id AND patient_id = p_patient_id AND cabinet_id = v_cab;
    IF NOT FOUND THEN RAISE EXCEPTION 'Séance hors périmètre' USING ERRCODE = '42501'; END IF;
  END IF;

  INSERT INTO app.patient_measurements (
    cabinet_id, patient_id, practitioner_id, consultation_id,
    kind, value, unit, measured_at, source, reference_low, reference_high, notes, is_synthetic
  ) VALUES (
    v_cab, p_patient_id, v_actor, p_consultation_id,
    p_kind, p_value, btrim(p_unit), p_measured_at, p_source,
    p_reference_low, p_reference_high, NULLIF(btrim(COALESCE(p_notes, '')), ''), app.is_cloud_dev()
  ) RETURNING * INTO v_row;

  RETURN NEXT v_row;
END; $$;

ALTER FUNCTION app.record_measurement(uuid, text, numeric, text, timestamptz, app.measurement_source, numeric, numeric, text, uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.record_measurement(uuid, text, numeric, text, timestamptz, app.measurement_source, numeric, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_measurement(uuid, text, numeric, text, timestamptz, app.measurement_source, numeric, numeric, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.record_adherence(
  p_patient_id uuid,
  p_treatment_id uuid,
  p_period_start date,
  p_period_end date,
  p_status app.adherence_status,
  p_source app.adherence_source,
  p_notes text DEFAULT NULL,
  p_consultation_id uuid DEFAULT NULL
) RETURNS SETOF app.treatment_adherence_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_cab uuid := app.current_cabinet();
  v_row app.treatment_adherence_reports%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_cab IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501'; END IF;
  IF app.current_role() NOT IN ('owner','practitioner') THEN
    RAISE EXCEPTION 'Rôle non clinique' USING ERRCODE = '42501';
  END IF;
  IF p_patient_id IS NULL OR p_treatment_id IS NULL OR p_period_start IS NULL OR p_period_end IS NULL THEN
    RAISE EXCEPTION 'Patient, traitement et période requis' USING ERRCODE = '23502';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Fin de période antérieure au début' USING ERRCODE = '22007';
  END IF;

  PERFORM 1 FROM app.patients
  WHERE id = p_patient_id AND cabinet_id = v_cab;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient introuvable ou hors périmètre' USING ERRCODE = '42501'; END IF;

  PERFORM 1 FROM app.patient_treatments
  WHERE id = p_treatment_id AND patient_id = p_patient_id AND cabinet_id = v_cab;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traitement hors périmètre' USING ERRCODE = '42501'; END IF;

  IF p_consultation_id IS NOT NULL THEN
    PERFORM 1 FROM app.consultations
    WHERE id = p_consultation_id AND patient_id = p_patient_id AND cabinet_id = v_cab;
    IF NOT FOUND THEN RAISE EXCEPTION 'Séance hors périmètre' USING ERRCODE = '42501'; END IF;
  END IF;

  INSERT INTO app.treatment_adherence_reports (
    cabinet_id, patient_id, practitioner_id, consultation_id,
    treatment_id, period_start, period_end, status, source, notes, is_synthetic
  ) VALUES (
    v_cab, p_patient_id, v_actor, p_consultation_id,
    p_treatment_id, p_period_start, p_period_end, p_status, p_source,
    NULLIF(btrim(COALESCE(p_notes, '')), ''), app.is_cloud_dev()
  ) RETURNING * INTO v_row;

  RETURN NEXT v_row;
END; $$;

ALTER FUNCTION app.record_adherence(uuid, uuid, date, date, app.adherence_status, app.adherence_source, text, uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.record_adherence(uuid, uuid, date, date, app.adherence_status, app.adherence_source, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_adherence(uuid, uuid, date, date, app.adherence_status, app.adherence_source, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.record_interaction_review(
  p_patient_id uuid,
  p_treatment_ids text,
  p_source text,
  p_conclusion app.interaction_conclusion,
  p_notes text DEFAULT NULL,
  p_consultation_id uuid DEFAULT NULL
) RETURNS SETOF app.treatment_interaction_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_cab uuid := app.current_cabinet();
  v_review app.treatment_interaction_reviews%ROWTYPE;
  v_ids uuid[];
  v_count integer;
BEGIN
  IF v_actor IS NULL OR v_cab IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501'; END IF;
  IF app.current_role() NOT IN ('owner','practitioner') THEN
    RAISE EXCEPTION 'Rôle non clinique' USING ERRCODE = '42501';
  END IF;
  IF p_patient_id IS NULL OR p_conclusion IS NULL OR btrim(COALESCE(p_source, '')) = '' THEN
    RAISE EXCEPTION 'Patient, source et conclusion requis' USING ERRCODE = '23502';
  END IF;
  IF p_treatment_ids IS NULL OR btrim(p_treatment_ids) = '' THEN
    RAISE EXCEPTION 'Au moins un traitement doit être revu' USING ERRCODE = '23502';
  END IF;
  BEGIN
    v_ids := ARRAY(SELECT jsonb_array_elements_text(p_treatment_ids::jsonb))::uuid[];
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Liste de traitements invalide' USING ERRCODE = '22023';
  END;
  IF cardinality(v_ids) = 0 OR array_position(v_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Liste de traitements invalide' USING ERRCODE = '23502';
  END IF;

  PERFORM 1 FROM app.patients
  WHERE id = p_patient_id AND cabinet_id = v_cab;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient introuvable ou hors périmètre' USING ERRCODE = '42501'; END IF;

  SELECT count(DISTINCT t.id) INTO v_count
  FROM app.patient_treatments t
  WHERE t.id = ANY (v_ids)
    AND t.patient_id = p_patient_id
    AND t.cabinet_id = v_cab;
  IF v_count <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Traitement hors périmètre' USING ERRCODE = '42501';
  END IF;

  IF p_consultation_id IS NOT NULL THEN
    PERFORM 1 FROM app.consultations
    WHERE id = p_consultation_id AND patient_id = p_patient_id AND cabinet_id = v_cab;
    IF NOT FOUND THEN RAISE EXCEPTION 'Séance hors périmètre' USING ERRCODE = '42501'; END IF;
  END IF;

  INSERT INTO app.treatment_interaction_reviews (
    cabinet_id, patient_id, practitioner_id, consultation_id, source, conclusion, notes, is_synthetic
  ) VALUES (
    v_cab, p_patient_id, v_actor, p_consultation_id, btrim(p_source), p_conclusion,
    NULLIF(btrim(COALESCE(p_notes, '')), ''), app.is_cloud_dev()
  ) RETURNING * INTO v_review;

  INSERT INTO app.interaction_review_treatments (review_id, treatment_id)
  SELECT v_review.id, x FROM unnest(v_ids) AS x;

  RETURN NEXT v_review;
END; $$;

ALTER FUNCTION app.record_interaction_review(uuid, text, text, app.interaction_conclusion, text, uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.record_interaction_review(uuid, text, text, app.interaction_conclusion, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_interaction_review(uuid, text, text, app.interaction_conclusion, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.link_prescription_renewal(
  p_patient_id uuid,
  p_new_document_id uuid,
  p_previous_document_id uuid,
  p_notes text DEFAULT NULL
) RETURNS SETOF app.prescription_renewal_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_cab uuid := app.current_cabinet();
  v_new app.documents%ROWTYPE;
  v_old app.documents%ROWTYPE;
  v_row app.prescription_renewal_links%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_cab IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501'; END IF;
  IF app.current_role() NOT IN ('owner','practitioner') THEN
    RAISE EXCEPTION 'Rôle non clinique' USING ERRCODE = '42501';
  END IF;
  IF p_patient_id IS NULL OR p_new_document_id IS NULL OR p_previous_document_id IS NULL THEN
    RAISE EXCEPTION 'Patient et ordonnances requis' USING ERRCODE = '23502';
  END IF;
  IF p_new_document_id = p_previous_document_id THEN
    RAISE EXCEPTION 'Une ordonnance ne se renouvelle pas elle-même' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM app.patients
  WHERE id = p_patient_id AND cabinet_id = v_cab;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient introuvable ou hors périmètre' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_new FROM app.documents
  WHERE id = p_new_document_id AND patient_id = p_patient_id AND cabinet_id = v_cab;
  IF NOT FOUND OR v_new.doc_type::text <> 'ordonnance' OR v_new.status <> 'issued' THEN
    RAISE EXCEPTION 'Nouvelle ordonnance invalide' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM app.documents
  WHERE id = p_previous_document_id AND patient_id = p_patient_id AND cabinet_id = v_cab;
  IF NOT FOUND OR v_old.doc_type::text <> 'ordonnance' OR v_old.status <> 'issued' THEN
    RAISE EXCEPTION 'Ordonnance précédente invalide' USING ERRCODE = '22023';
  END IF;

  IF v_new.issued_at <= v_old.issued_at THEN
    RAISE EXCEPTION 'Le renouvellement doit suivre l''ordonnance précédente' USING ERRCODE = '22007';
  END IF;

  INSERT INTO app.prescription_renewal_links (
    cabinet_id, patient_id, practitioner_id, new_document_id, previous_document_id, notes, is_synthetic
  ) VALUES (
    v_cab, p_patient_id, v_actor, p_new_document_id, p_previous_document_id,
    NULLIF(btrim(COALESCE(p_notes, '')), ''), app.is_cloud_dev()
  ) RETURNING * INTO v_row;

  RETURN NEXT v_row;
END; $$;

ALTER FUNCTION app.link_prescription_renewal(uuid, uuid, uuid, text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.link_prescription_renewal(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.link_prescription_renewal(uuid, uuid, uuid, text) TO authenticated;

INSERT INTO app.schema_migrations (version)
VALUES ('213_medication_phase2_gates')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
