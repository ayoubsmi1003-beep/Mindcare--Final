BEGIN;
CREATE FUNCTION app.document_compact_json(n jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE result text;BEGIN
 IF jsonb_typeof(n)='object' THEN SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||app.document_compact_json(value),',' ORDER BY key),'')||'}' INTO result FROM jsonb_each(n);
 ELSIF jsonb_typeof(n)='array' THEN SELECT '['||COALESCE(string_agg(app.document_compact_json(value),',' ORDER BY ordinality),'')||']' INTO result FROM jsonb_array_elements(n) WITH ORDINALITY;
 ELSE result:=n::text;END IF;RETURN result;
END $$;
ALTER FUNCTION app.document_compact_json(jsonb) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.document_compact_json(jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION app.validate_document_content(p_content jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE nodes integer;meds integer;BEGIN
 nodes:=app.check_document_node(p_content);
 IF nodes>500 THEN RAISE EXCEPTION 'DocumentBlocksExceeded';END IF;
 IF octet_length(app.document_compact_json(p_content))>204800 THEN RAISE EXCEPTION 'DocumentSizeExceeded';END IF;
 SELECT count(*) INTO meds FROM jsonb_path_query(p_content,'strict $.** ? (@.type == "medication")');
 IF meds>50 THEN RAISE EXCEPTION 'DocumentMedicationsExceeded';END IF;
END $$;
CREATE FUNCTION app.document_civil_date_valid(value text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN RETURN value ~ '^\d{2}/\d{2}/\d{4}$' AND to_char(to_date(value,'DD/MM/YYYY'),'DD/MM/YYYY')=value;EXCEPTION WHEN others THEN RETURN false;END $$;
ALTER FUNCTION app.document_civil_date_valid(text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.document_civil_date_valid(text) FROM PUBLIC;
DO $fix$
DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('app.document_draft_reasons(app.document_drafts)'::regprocedure);
 definition:=replace(definition,'BEGIN PERFORM to_date(d.variables->>CASE WHEN d.doc_type=''justification'' THEN ''date_consultation'' ELSE ''date_debut'' END,''DD/MM/YYYY'');EXCEPTION WHEN others THEN reasons:=reasons||''"required-field"''::jsonb;END;','IF NOT COALESCE(app.document_civil_date_valid(d.variables->>CASE WHEN d.doc_type=''justification'' THEN ''date_consultation'' ELSE ''date_debut'' END),false) THEN reasons:=reasons||''"required-field"''::jsonb;END IF;');
 EXECUTE definition;
END $fix$;
INSERT INTO app.schema_migrations(version) VALUES ('135_document_editor_bounds') ON CONFLICT DO NOTHING;
COMMIT;
