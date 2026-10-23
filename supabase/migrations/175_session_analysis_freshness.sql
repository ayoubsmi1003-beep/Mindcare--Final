-- Read current derived session artifacts only; preserve every historical version.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE OR REPLACE FUNCTION app.get_consultation_analysis(p_consultation_id uuid)
RETURNS SETOF app.consultation_analyses LANGUAGE sql SECURITY DEFINER
SET search_path=app,pg_catalog AS $$
 SELECT a.* FROM app.consultation_analyses a
 JOIN app.consultations c ON c.id=a.consultation_id
 WHERE a.consultation_id=p_consultation_id
 AND a.source_state ? 'context_digest'
 AND a.source_state ? 'previous_consultation_id'
 AND a.source_state->>'notes_hash'=encode(sha256(convert_to(coalesce(c.raw_notes,''),'UTF8')),'hex')
 AND (a.source_state->>'previous_consultation_id' IS NULL OR EXISTS(
  SELECT 1 FROM app.consultations previous
  WHERE previous.patient_id=a.patient_id AND previous.id::text=a.source_state->>'previous_consultation_id'
  AND encode(sha256(convert_to(coalesce(previous.raw_notes,''),'UTF8')),'hex')=a.source_state->>'previous_raw_notes_hash'
 ))
 AND a.generated_at>=coalesce(greatest(
  (SELECT max(n.updated_at) FROM app.clinical_notes n WHERE n.patient_id=a.patient_id),
  (SELECT max(t.updated_at) FROM app.patient_treatments t WHERE t.patient_id=a.patient_id),
  (SELECT max(h.occurred_at) FROM app.patient_treatment_history h JOIN app.patient_treatments t ON t.id=h.treatment_id WHERE t.patient_id=a.patient_id),
  (SELECT max(am.created_at) FROM app.clinical_note_amendments am JOIN app.clinical_notes n ON n.id=am.note_id WHERE n.patient_id=a.patient_id),
  (SELECT max(v.created_at) FROM app.consultations v WHERE v.patient_id=a.patient_id),
  (SELECT max(v.ended_at) FROM app.consultations v WHERE v.patient_id=a.patient_id)
 ),'-infinity'::timestamptz)
 ORDER BY a.version DESC LIMIT 1;
$$;
ALTER FUNCTION app.get_consultation_analysis(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_consultation_analysis(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_consultation_analysis(uuid) TO authenticated;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES('175_session_analysis_freshness') ON CONFLICT DO NOTHING;
COMMIT;
