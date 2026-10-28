BEGIN;

-- A stable whole-timeline fingerprint lets Alexa resume a page only while the
-- event set is unchanged. The existing audited timeline gate remains the sole
-- source of event data; this helper returns only a digest and total.
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE OR REPLACE FUNCTION app.get_patient_timeline_revision(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_before_at timestamptz := NULL;
  v_before_id uuid := NULL;
  v_page jsonb;
  v_page_count integer;
  v_last jsonb;
  v_total integer := 0;
  v_digest text := '';
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;

  LOOP
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'occurred_at', event.occurred_at AT TIME ZONE 'UTC',
      'event_id', event.event_id,
      'event_type', event.event_type,
      'label_key', event.label_key,
      'practitioner_name', event.practitioner_name,
      'detail', event.detail
    ) ORDER BY event.occurred_at DESC, event.event_id DESC), '[]'::jsonb), count(*)::integer
      INTO v_page, v_page_count
      FROM app.list_patient_timeline(p_id, v_before_at, v_before_id, 50) AS event;

    EXIT WHEN v_page_count = 0;
    v_total := v_total + v_page_count;
    IF v_total > 50000 THEN
      RAISE EXCEPTION 'Timeline revision bound exceeded' USING ERRCODE = '54000';
    END IF;
    v_digest := md5(v_digest || v_page::text);
    v_last := v_page -> (v_page_count - 1);
    v_before_at := (v_last ->> 'occurred_at')::timestamp AT TIME ZONE 'UTC';
    v_before_id := (v_last ->> 'event_id')::uuid;
  END LOOP;

  RETURN jsonb_build_object('revision', md5(v_total::text || ':' || v_digest), 'total', v_total);
END;
$$;

ALTER FUNCTION app.get_patient_timeline_revision(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_patient_timeline_revision(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_patient_timeline_revision(uuid) TO authenticated;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
NOTIFY pgrst, 'reload schema';
INSERT INTO app.schema_migrations(version) VALUES ('191_alexa_timeline_revision') ON CONFLICT DO NOTHING;

COMMIT;
