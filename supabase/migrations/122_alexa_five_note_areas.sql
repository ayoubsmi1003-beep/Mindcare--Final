-- Alexa: include the five existing note areas. No table, column, enum, RLS or write-gate changes.
-- Definitions copied from migration120; only the local read projection and summary format freshness change.
BEGIN;
CREATE OR REPLACE FUNCTION app.get_alexa_clinical_context(
  p_patient_id uuid,
  p_limit integer DEFAULT 5,
  p_before_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_patient app.patients%ROWTYPE;
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 20);
  v_consultations jsonb;
  v_current jsonb;
  v_treatments jsonb;
  v_history jsonb;
  v_history_complete boolean;
  v_diagnoses jsonb;
  v_scales jsonb;
  v_revision text;
  v_more boolean;
  v_count integer;
  v_last jsonb;
BEGIN
  -- Same audited access door for missing and inaccessible patient references.
  SELECT * INTO v_patient FROM app.get_patient(p_patient_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Clinical RLS remains authoritative. In particular an assistant who can
  -- open demographic data must not receive a clinical dossier or its revision.
  IF NOT app.can_see_clinical(v_patient.practitioner_id) THEN RETURN NULL; END IF;
  IF (p_before_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'invalid-cursor' USING ERRCODE = '22023';
  END IF;

  -- Revision covers the entire visible record, independently of the cursor.
  -- No clock or generated response is hashed; identical facts stay identical.
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'patient', to_jsonb(v_patient),
    'consultations', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id), '[]'::jsonb)
      FROM app.consultations c WHERE c.patient_id = p_patient_id),
    'notes', (SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id), '[]'::jsonb)
      FROM app.clinical_notes n WHERE n.patient_id = p_patient_id),
    'amendments', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::jsonb)
      FROM app.clinical_note_amendments a JOIN app.clinical_notes n ON n.id = a.note_id
      WHERE n.patient_id = p_patient_id),
    'treatments', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
      FROM app.patient_treatments t WHERE t.patient_id = p_patient_id),
    'medications', (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb)
      FROM app.medications m WHERE EXISTS (SELECT 1 FROM app.patient_treatments t
        WHERE t.patient_id = p_patient_id AND t.medication_id = m.id)),
    'history', (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id), '[]'::jsonb)
      FROM app.patient_treatment_history h JOIN app.patient_treatments t ON t.id = h.treatment_id
      WHERE t.patient_id = p_patient_id),
    'analyses', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::jsonb)
      FROM app.consultation_analyses a WHERE a.patient_id = p_patient_id),
    'diagnoses', (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id), '[]'::jsonb)
      FROM app.diagnoses d WHERE d.patient_id = p_patient_id),
    'scales', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]'::jsonb)
      FROM app.scale_administrations s WHERE s.patient_id = p_patient_id)
  )::text, 'UTF8')), 'hex') INTO v_revision;

  WITH selected AS (
    SELECT c.id, c.started_at, c.ended_at, c.raw_notes
    FROM app.consultations c
    WHERE c.patient_id = p_patient_id AND c.status = 'closed'
      AND (p_before_at IS NULL OR (c.started_at, c.id) < (p_before_at, p_before_id))
    ORDER BY c.started_at DESC, c.id DESC LIMIT v_limit
  ), projected AS (
    SELECT c.id, c.started_at,
      jsonb_build_object('id', c.id, 'startedAt', c.started_at, 'endedAt', c.ended_at, 'rawNotes', c.raw_notes, 'rawNotesVersion', v_revision,
        'notes', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', n.id, 'version', n.updated_at::text, 'status', n.status,
          'subjective', n.subjective, 'objective', n.objective, 'assessment', n.assessment, 'plan', n.plan,
          'amendments', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'body', a.body,
            'reason', a.reason, 'createdAt', a.created_at) ORDER BY a.created_at, a.id)
            FROM app.clinical_note_amendments a WHERE a.note_id = n.id), '[]'::jsonb)
          ) ORDER BY n.created_at, n.id) FROM app.clinical_notes n
          WHERE n.consultation_id = c.id), '[]'::jsonb)
      ) || coalesce((SELECT jsonb_build_object('analysis', jsonb_build_object(
          'id', a.id, 'version', a.version, 'content', a.content))
        FROM app.consultation_analyses a WHERE a.consultation_id = c.id
          AND c.raw_notes IS NOT NULL
          AND a.source_state ->> 'notes_hash' = encode(sha256(convert_to(c.raw_notes, 'UTF8')), 'hex')
          AND a.generated_at >= coalesce((SELECT max(n.updated_at) FROM app.clinical_notes n
            WHERE n.consultation_id = c.id), '-infinity'::timestamptz)
          AND a.generated_at >= coalesce((SELECT max(am.created_at) FROM app.clinical_note_amendments am
            JOIN app.clinical_notes n ON n.id = am.note_id WHERE n.consultation_id = c.id), '-infinity'::timestamptz)
        ORDER BY a.version DESC LIMIT 1), '{}'::jsonb) AS value
    FROM selected c
  ) SELECT coalesce(jsonb_agg(value ORDER BY started_at DESC, id DESC), '[]'::jsonb)
    INTO v_consultations FROM projected;
  v_count := jsonb_array_length(v_consultations);
  v_last := v_consultations -> (v_count - 1);
  SELECT EXISTS (SELECT 1 FROM app.consultations c
    WHERE c.patient_id = p_patient_id AND c.status = 'closed' AND v_last IS NOT NULL
      AND (c.started_at, c.id) < ((v_last ->> 'startedAt')::timestamptz, (v_last ->> 'id')::uuid)) INTO v_more;

  -- Current open consultation is separate; recorded working/SOAP notes carry their unsigned status.
  SELECT jsonb_build_object('id', c.id, 'startedAt', c.started_at, 'endedAt', c.ended_at, 'rawNotes', c.raw_notes, 'rawNotesVersion', v_revision,
    'notes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'version', n.updated_at::text, 'status', n.status,
      'subjective', n.subjective, 'objective', n.objective, 'assessment', n.assessment, 'plan', n.plan,
      'amendments', coalesce((SELECT jsonb_agg(jsonb_build_object('id', am.id, 'body', am.body,
        'reason', am.reason, 'createdAt', am.created_at) ORDER BY am.created_at, am.id)
        FROM app.clinical_note_amendments am WHERE am.note_id = n.id), '[]'::jsonb)) ORDER BY n.created_at, n.id)
      FROM app.clinical_notes n WHERE n.consultation_id = c.id), '[]'::jsonb))
    INTO v_current FROM app.consultations c WHERE c.patient_id = p_patient_id AND c.status = 'open'
    ORDER BY c.started_at DESC, c.id DESC LIMIT 1;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'medication', coalesce(nullif(m.source_raw_value, ''), m.brand_name, m.inn),
    'status', t.status, 'dose', t.dose, 'doseUnit', t.dose_unit, 'frequency', t.frequency,
    'timing', t.timing, 'instructions', t.instructions, 'startDate', t.start_date, 'endDate', t.end_date,
    'version', t.current_version) ORDER BY t.start_date DESC, t.id DESC), '[]'::jsonb)
    INTO v_treatments FROM app.patient_treatments t JOIN app.medications m ON m.id = t.medication_id
    WHERE t.patient_id = p_patient_id;

  -- The newest 200 changes are sufficient for the normal read. Truncation is
  -- explicit; a caller must never claim complete treatment evolution here.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'treatmentId', h.treatment_id,
    'version', h.version, 'action', h.action, 'occurredAt', h.occurred_at,
    'previous', CASE WHEN h.previous_values IS NULL THEN NULL ELSE jsonb_build_object(
      'status', h.previous_values -> 'status', 'dose', h.previous_values -> 'dose',
      'doseUnit', h.previous_values -> 'dose_unit', 'frequency', h.previous_values -> 'frequency',
      'timing', coalesce(h.previous_values -> 'timing', '[]'::jsonb), 'instructions', h.previous_values -> 'instructions',
      'startDate', h.previous_values -> 'start_date', 'endDate', h.previous_values -> 'end_date') END,
    'next', CASE WHEN h.new_values IS NULL THEN NULL ELSE jsonb_build_object(
      'status', h.new_values -> 'status', 'dose', h.new_values -> 'dose',
      'doseUnit', h.new_values -> 'dose_unit', 'frequency', h.new_values -> 'frequency',
      'timing', coalesce(h.new_values -> 'timing', '[]'::jsonb), 'instructions', h.new_values -> 'instructions',
      'startDate', h.new_values -> 'start_date', 'endDate', h.new_values -> 'end_date') END,
    'reason', h.reason, 'notes', h.notes) ORDER BY h.occurred_at DESC, h.id DESC), '[]'::jsonb)
    INTO v_history FROM (SELECT h.* FROM app.patient_treatment_history h
      JOIN app.patient_treatments t ON t.id = h.treatment_id WHERE t.patient_id = p_patient_id
      ORDER BY h.occurred_at DESC, h.id DESC LIMIT 200) h;
  SELECT count(*) <= 200 INTO v_history_complete FROM app.patient_treatment_history h
    JOIN app.patient_treatments t ON t.id = h.treatment_id WHERE t.patient_id = p_patient_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'code', d.code,
    'primary', d.is_primary, 'onsetDate', d.onset_date, 'resolvedAt', d.resolved_at)
    ORDER BY (d.resolved_at IS NOT NULL), d.is_primary DESC, d.id), '[]'::jsonb)
    INTO v_diagnoses FROM app.diagnoses d WHERE d.patient_id = p_patient_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', sc.name_fr,
    'administeredAt', s.administered_at, 'score', s.total_score, 'interpretation', s.interpretation)
    ORDER BY s.administered_at DESC, s.id DESC), '[]'::jsonb)
    INTO v_scales FROM app.scale_administrations s JOIN app.scales sc ON sc.id = s.scale_id
    WHERE s.patient_id = p_patient_id;

  RETURN jsonb_build_object('patientId', p_patient_id, 'consultations', v_consultations,
    'treatments', jsonb_build_object('current', v_treatments, 'history', v_history, 'historyComplete', v_history_complete),
    'diagnoses', v_diagnoses, 'scales', v_scales, 'sourceRevision', v_revision,
    'coverage', jsonb_build_object('requested', v_limit, 'returned', v_count,
      'complete', v_count = v_limit AND v_history_complete AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_consultations) x WHERE jsonb_array_length(x -> 'notes') = 0 AND nullif(btrim(x ->> 'rawNotes'), '') IS NULL),
      'hasMore', v_more) || CASE WHEN v_more THEN jsonb_build_object('next',
        jsonb_build_object('startedAt', v_last -> 'startedAt', 'id', v_last -> 'id')) ELSE '{}'::jsonb END)
    || CASE WHEN v_current IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('currentConsultation', v_current) END;
END; $$;

ALTER FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.get_alexa_summary_status(p_patient_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = app, audit, pg_catalog AS $$
DECLARE v_context jsonb; v_source jsonb;
BEGIN
  v_context := app.get_alexa_clinical_context(p_patient_id,1);
  IF v_context IS NULL THEN RETURN NULL; END IF;
  SELECT s.source_state INTO v_source FROM app.patient_case_summaries s
    WHERE s.patient_id = p_patient_id ORDER BY s.version DESC LIMIT 1;
  RETURN jsonb_build_object('aJour', coalesce(v_source->>'alexaSourceRevision' = v_context->>'sourceRevision'
    AND v_source->>'alexaNoteAreas' = '5', false));
END; $$;
ALTER FUNCTION app.get_alexa_summary_status(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_alexa_summary_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_alexa_summary_status(uuid) TO authenticated;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
NOTIFY pgrst, 'reload schema';
INSERT INTO app.schema_migrations(version) VALUES ('122_alexa_five_note_areas') ON CONFLICT DO NOTHING;
COMMIT;
