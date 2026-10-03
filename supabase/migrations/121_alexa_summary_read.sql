-- Alexa 2.0: read the persisted summary independently of the workspace payload.
-- Migration089 replaced that payload without its optional summary section.
-- Preserve applied migrations, private tables and their existing clinical RLS.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE FUNCTION app.get_alexa_case_summary(p_patient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_status jsonb;
  v_summary jsonb;
BEGIN
  -- This existing gate calls get_alexa_clinical_context -> get_patient, so
  -- identity reads are audited and missing/hidden clinical scopes return null.
  -- app_gatekeeper remains the existing NOBYPASSRLS member of authenticated.
  v_status := app.get_alexa_summary_status(p_patient_id);
  IF v_status IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'id', s.id,
    'version', s.version,
    'genere_le', s.generated_at,
    'genere_par', generator.full_name,
    'content', s.content,
    'aJour', coalesce((v_status->>'aJour')::boolean, false)
  ) INTO v_summary
  FROM app.patient_case_summaries s
  LEFT JOIN app.profiles generator ON generator.id = s.practitioner_id
  WHERE s.patient_id = p_patient_id
  ORDER BY s.version DESC
  LIMIT 1;

  RETURN v_summary;
END;
$$;

ALTER FUNCTION app.get_alexa_case_summary(uuid) OWNER TO app_gatekeeper;
COMMENT ON FUNCTION app.get_alexa_case_summary(uuid) IS
  'Audited clinical read of the latest saved summary; source revision freshness is checked by the existing Alexa status gate. Missing, inaccessible and unavailable summaries return null.';
REVOKE ALL ON FUNCTION app.get_alexa_case_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_alexa_case_summary(uuid) TO authenticated;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';
INSERT INTO app.schema_migrations(version) VALUES ('121_alexa_summary_read') ON CONFLICT DO NOTHING;
COMMIT;
