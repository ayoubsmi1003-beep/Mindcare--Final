-- Patient-specific next appointment; never substitute the dashboard's next patient.
BEGIN;
CREATE FUNCTION app.get_alexa_reminder_context(p_patient_id uuid,p_as_of timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE v_patient uuid; v_appointment jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(app.can_see_admin(),false) THEN
  RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501';
 END IF;
 IF p_patient_id IS NULL OR p_as_of IS NULL OR NOT isfinite(p_as_of) THEN
  RAISE EXCEPTION 'Invalid reminder query' USING ERRCODE='22023';
 END IF;
 -- The existing patient gate audits access and applies its existing RLS.
 SELECT id INTO v_patient FROM app.get_patient(p_patient_id);
 IF v_patient IS NULL THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('id',a.id,'patientId',a.patient_id,'startsAt',a.starts_at,'status',a.status::text)
 INTO v_appointment FROM app.appointments a
 WHERE a.patient_id=v_patient AND a.starts_at>=p_as_of AND a.status IN ('requested','confirmed')
 ORDER BY a.starts_at,a.id LIMIT 1;
 RETURN jsonb_build_object('patientId',v_patient,'appointment',v_appointment);
END;
$$;
REVOKE ALL ON FUNCTION app.get_alexa_reminder_context(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app.get_alexa_reminder_context(uuid,timestamptz) TO authenticated;
INSERT INTO app.schema_migrations(version) VALUES ('170_alexa_reminder_context') ON CONFLICT DO NOTHING;
COMMIT;
