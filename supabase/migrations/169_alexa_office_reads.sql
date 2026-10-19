-- Exact office aggregates under the caller's existing RLS. No notification payload.
BEGIN;
CREATE FUNCTION app.get_alexa_office_status(
 p_view text, p_offset integer DEFAULT 0, p_revision text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
 v_groups jsonb; v_revision text; v_total bigint; v_unread bigint;
 v_environment text; v_count integer; v_page jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(app.can_see_admin(),false) THEN
  RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501';
 END IF;
 IF p_view IS NULL OR p_view NOT IN ('notifications','system') OR p_offset IS NULL
    OR p_offset < 0 OR p_offset > 10000
    OR (p_revision IS NOT NULL AND p_revision !~ '^[a-f0-9]{32}$')
    OR (p_view='system' AND (p_offset<>0 OR p_revision IS NOT NULL)) THEN
  RAISE EXCEPTION 'Invalid office query' USING ERRCODE='22023';
 END IF;
 IF p_view='system' THEN
  SELECT environment INTO v_environment FROM app.deployment WHERE singleton;
  IF v_environment IS NULL THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('view','system','environment',v_environment);
 END IF;
 -- One statement observes every RLS-visible notification; never count a UI page.
 WITH grouped AS (
  SELECT kind,count(*) AS total,count(*) FILTER(WHERE read_at IS NULL) AS unread
  FROM app.notifications GROUP BY kind
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'total',total,'unread',unread) ORDER BY kind),'[]'::jsonb),
          coalesce(sum(total),0),coalesce(sum(unread),0)
 INTO v_groups,v_total,v_unread FROM grouped;
 v_revision := md5(v_groups::text);
 IF p_revision IS NOT NULL AND p_revision<>v_revision THEN
  RAISE EXCEPTION 'Office query changed' USING ERRCODE='40001';
 END IF;
 v_count := jsonb_array_length(v_groups);
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) INTO v_page
 FROM jsonb_array_elements(v_groups) WITH ORDINALITY
 WHERE ordinality>p_offset AND ordinality<=p_offset+20;
 RETURN jsonb_build_object('view','notifications','total',v_total,'unread',v_unread,
  'kinds',v_page,'totalKinds',v_count,'offset',p_offset,
  'hasMore',p_offset+jsonb_array_length(v_page)<v_count,'revision',v_revision);
END;
$$;
REVOKE ALL ON FUNCTION app.get_alexa_office_status(text,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app.get_alexa_office_status(text,integer,text) TO authenticated;
INSERT INTO app.schema_migrations(version) VALUES ('169_alexa_office_reads') ON CONFLICT DO NOTHING;
COMMIT;
