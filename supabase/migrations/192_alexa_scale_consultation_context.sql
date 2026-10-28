BEGIN;

-- Keep Alexa's existing audited clinical-context gate and add the consultation
-- reference already stored on each administration. Fail closed if the live
-- function no longer matches the reviewed projection.
DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$'administeredAt', s.administered_at, 'score', s.total_score, 'interpretation', s.interpretation$old$;
  v_new text := $new$'consultationId', s.consultation_id, 'administeredAt', s.administered_at, 'score', s.total_score, 'interpretation', s.interpretation$new$;
BEGIN
  SELECT pg_get_functiondef('app.get_alexa_clinical_context(uuid,integer,timestamptz,uuid)'::regprocedure)
    INTO v_definition;
  IF length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'alexa-clinical-context-scale-projection-anchor' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END;
$migration$;

ALTER FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) TO authenticated;

INSERT INTO app.schema_migrations(version)
VALUES ('192_alexa_scale_consultation_context')
ON CONFLICT DO NOTHING;

COMMIT;
