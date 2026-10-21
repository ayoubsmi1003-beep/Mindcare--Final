-- Approved Alexa repair: overload only; historical three-argument door stays immutable.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE FUNCTION app.search_patients(p_query text, p_limit integer, p_offset integer, p_missing_field text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, audit, pg_catalog AS $$
DECLARE v_result jsonb; v_limit integer := least(greatest(coalesce(p_limit,20),0),20);
BEGIN
  IF p_missing_field IS NOT NULL AND p_missing_field NOT IN ('phone','identity_card') THEN
    RAISE EXCEPTION 'Recherche indisponible.' USING ERRCODE='22023';
  END IF;
  IF coalesce(p_offset,0) < 0 OR coalesce(p_offset,0) > 10000 OR length(coalesce(p_query,'')) > 160 THEN
    RAISE EXCEPTION 'Recherche indisponible.' USING ERRCODE='22023';
  END IF;
  PERFORM audit.log_read(NULL,'recherche');
  WITH visible AS MATERIALIZED (
    SELECT p.id,p.first_name,p.last_name FROM app.patients p
    WHERE p.is_active
      AND (nullif(btrim(p_query),'') IS NULL OR app.nom_recherche(p.first_name || ' ' || p.last_name)
        LIKE '%' || app.nom_recherche(p_query) || '%')
      AND (p_missing_field IS NULL
        OR (p_missing_field='phone' AND nullif(btrim(p.phone),'') IS NULL)
        OR (p_missing_field='identity_card' AND nullif(btrim(p.id_document_number),'') IS NULL))
  ), page AS (
    SELECT id,first_name,last_name FROM visible ORDER BY last_name,first_name,id LIMIT v_limit OFFSET coalesce(p_offset,0)
  ) SELECT jsonb_build_object('total_count',(SELECT count(*) FROM visible),
    'patients',coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY last_name,first_name,id) FROM page),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END;
$$;
ALTER FUNCTION app.search_patients(text,integer,integer,text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.search_patients(text,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_patients(text,integer,integer,text) TO authenticated;
COMMENT ON FUNCTION app.search_patients(text,integer,integer,text) IS 'ADR-019: audited filtered page and atomic exact count; identities only on requested pages, never phone/ID values. Caller RLS remains authoritative.';
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES ('124_alexa_filtered_patient_search');
NOTIFY pgrst, 'reload schema';
COMMIT;
