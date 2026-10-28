BEGIN;

-- Keep scale administrations attached to their real consultation dates and
-- scale identities in the existing audited clinical-context projection.
DO $migration$
DECLARE
  v_definition text;
  v_old_projection text := $old$'consultationId', s.consultation_id, 'administeredAt', s.administered_at$old$;
  v_new_projection text := $new$'scaleId', s.scale_id, 'consultationId', s.consultation_id, 'consultationStartedAt', c.started_at, 'administeredAt', s.administered_at$new$;
  v_old_join text := $old$FROM app.scale_administrations s JOIN app.scales sc ON sc.id = s.scale_id$old$;
  v_new_join text := $new$FROM app.scale_administrations s JOIN app.scales sc ON sc.id = s.scale_id LEFT JOIN app.consultations c ON c.id = s.consultation_id AND c.patient_id = s.patient_id$new$;
BEGIN
  SELECT pg_get_functiondef('app.get_alexa_clinical_context(uuid,integer,timestamptz,uuid)'::regprocedure)
    INTO v_definition;
  IF length(v_definition) - length(replace(v_definition, v_old_projection, '')) <> length(v_old_projection)
     OR length(v_definition) - length(replace(v_definition, v_old_join, '')) <> length(v_old_join) THEN
    RAISE EXCEPTION 'alexa-clinical-context-scale-consultation-anchor' USING ERRCODE = '55000';
  END IF;
  v_definition := replace(v_definition, v_old_projection, v_new_projection);
  v_definition := replace(v_definition, v_old_join, v_new_join);
  EXECUTE v_definition;
END;
$migration$;

ALTER FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) TO authenticated;

INSERT INTO app.schema_migrations(version)
VALUES ('193_alexa_scale_consultation_date')
ON CONFLICT DO NOTHING;

COMMIT;
