BEGIN;

-- Read every scale administration attached to one consultation. The patient
-- history RPC is intentionally capped for workspace lists and can omit scales
-- from an older consultation after 100 newer administrations.
CREATE OR REPLACE FUNCTION app.get_alexa_consultation_scales(
  p_patient_id uuid,
  p_consultation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $fn$
DECLARE
  v_patient app.patients%ROWTYPE;
BEGIN
  SELECT * INTO v_patient FROM app.get_patient(p_patient_id);
  IF NOT FOUND OR NOT app.can_see_clinical(v_patient.practitioner_id) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app.consultations c
    WHERE c.id = p_consultation_id AND c.patient_id = p_patient_id
  ) THEN
    RETURN NULL;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', sa.id,
      'scale_code', sc.code,
      'scale_name', sc.name_fr,
      'consultation_id', sa.consultation_id,
      'total', sa.total_score,
      'interpretation', sa.interpretation,
      'administered_at', sa.administered_at,
      'responses', sa.responses,
      'definition', jsonb_build_object(
        'code', sc.code,
        'name_fr', sc.name_fr,
        'items', sc.items,
        'scoring', sc.scoring
      )
    ) ORDER BY sa.administered_at, sa.id)
    FROM app.scale_administrations sa
    JOIN app.scales sc ON sc.id = sa.scale_id
    WHERE sa.patient_id = p_patient_id
      AND sa.consultation_id = p_consultation_id
  ), '[]'::jsonb);
END;
$fn$;

ALTER FUNCTION app.get_alexa_consultation_scales(uuid, uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_alexa_consultation_scales(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_alexa_consultation_scales(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION app.get_alexa_consultation_scales(uuid, uuid) TO authenticated;

INSERT INTO app.schema_migrations(version)
VALUES ('194_alexa_consultation_scale_read')
ON CONFLICT DO NOTHING;

COMMIT;
