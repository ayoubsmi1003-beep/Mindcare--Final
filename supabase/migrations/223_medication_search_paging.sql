BEGIN;
ALTER FUNCTION app.search_medications_page(text,integer,integer) RENAME TO _search_medications_page_v199;
-- Private implementation retains its original invoker/RLS behavior.
CREATE OR REPLACE FUNCTION app.search_medications_page(
  p_query text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid,
  raw_name text,
  inn text,
  brand_name text,
  form text,
  strength text,
  normalized_name text,
  source text,
  rank real,
  total_count bigint)
LANGUAGE plpgsql STABLE SET search_path=app,public,pg_catalog AS $$
DECLARE n bigint; BEGIN
 SELECT x.total_count INTO n FROM app._search_medications_page_v199(p_query,1,0) x LIMIT 1;
 -- Select the matching family before applying OFFSET: exhaustion must not activate fuzzy results.
 IF coalesce(n,0)<=greatest(coalesce(p_offset,0),0) THEN RETURN;END IF;
 RETURN QUERY SELECT * FROM app._search_medications_page_v199(p_query,p_limit,p_offset);
END $$;
REVOKE ALL ON FUNCTION app.search_medications_page(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_medications_page(text,integer,integer) TO authenticated;
CREATE FUNCTION app.get_medication_catalog_status() RETURNS TABLE(available_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=app,pg_catalog AS $$
 SELECT count(*) FROM app.medications WHERE is_active IS NOT FALSE AND (cabinet_id IS NULL OR cabinet_id=app.current_cabinet());
$$;
REVOKE ALL ON FUNCTION app.get_medication_catalog_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_medication_catalog_status() TO authenticated;
INSERT INTO app.schema_migrations(version) VALUES ('223_medication_search_paging') ON CONFLICT DO NOTHING;
COMMIT;
