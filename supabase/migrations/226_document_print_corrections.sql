-- Correct future v2 previews/emissions only. Issued HTML, content and assets stay immutable.
BEGIN;
CREATE FUNCTION app.document_footer_reference() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT $reference${"address":"Rue frères Merzoug N° 36 Mahelma Zeralda\n( en face la FAC de Sidi Abdellah à coté de la pompe à Essence Belle Vue )","facebook_label":"Dr Larbi Psychiatre","instagram_label":"Dr Larbi Psychiatre"}$reference$::jsonb;
$fn$;

ALTER FUNCTION app.document_context(app.document_drafts) RENAME TO _document_context_v2;
CREATE FUNCTION app.document_context(d app.document_drafts) RETURNS jsonb LANGUAGE sql STABLE SET search_path=app,pg_catalog AS $$
 SELECT app._document_context_v2(d) || CASE WHEN d.renderer_version='v2' THEN jsonb_build_object(
  'cabinet_address',app.document_footer_reference()->>'address',
  'footer_facebook_label',app.document_footer_reference()->>'facebook_label',
  'footer_instagram_label',app.document_footer_reference()->>'instagram_label') ELSE '{}'::jsonb END;
$$;
ALTER FUNCTION app.document_identity(app.document_drafts) RENAME TO _document_identity_v2;
CREATE FUNCTION app.document_identity(d app.document_drafts) RETURNS jsonb LANGUAGE sql STABLE SET search_path=app,pg_catalog AS $$
 SELECT app._document_identity_v2(d) || CASE WHEN d.renderer_version='v2' THEN jsonb_build_object('document_footer',app.document_footer_reference()) ELSE '{}'::jsonb END;
$$;

CREATE FUNCTION app.document_repeats_strength(p_name text,p_strength text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN token~'^[0-9]+([.][0-9]+)?(mg|µg|mcg|g|ui|ml|%)(/[0-9]*([.][0-9]+)?(ml|g))?$'
  THEN designation~('(^|[^0-9.])'||replace(token,'.','[.]')||'(?![[:alpha:]0-9])') ELSE false END
 FROM (SELECT regexp_replace(lower(replace(coalesce(p_strength,''),',','.')),'[[:space:]]','','g') AS token,
  regexp_replace(lower(replace(coalesce(p_name,''),',','.')),'([0-9])[[:space:]]+(mg|µg|mcg|g|ui|ml|%)','\1\2','g') AS designation) normalized;
$$;
CREATE FUNCTION app.document_print_content_v2(p_content jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE n jsonb; a jsonb; name text; instructions text; result jsonb:='[]';
BEGIN
 FOR n IN SELECT value FROM jsonb_array_elements(p_content->'content') LOOP
  IF n->>'type'='medication' THEN
   a:=n->'attrs';name:=a->>'designation';
   IF app.document_repeats_strength(name,a->>'strength') THEN a:=jsonb_set(a,'{strength}','""');END IF;
   -- Only remove an exact repeated product strength, never quantities, distinct doses or complex instructions.
   IF name!~'[+/&]' THEN
    SELECT coalesce(string_agg(line,E'\n' ORDER BY position),'') INTO instructions
     FROM regexp_split_to_table(a->>'instructions',E'\n') WITH ORDINALITY AS lines(line,position)
     WHERE NOT (line~'^Dose prescrite[[:space:]]*:' AND app.document_repeats_strength(name,regexp_replace(line,'^Dose prescrite[[:space:]]*:[[:space:]]*','')));
    a:=jsonb_set(a,'{instructions}',to_jsonb(instructions));
   END IF;
   n:=jsonb_set(n,'{attrs}',a);
  END IF;
  result:=result||jsonb_build_array(n);
 END LOOP;
 RETURN jsonb_set(p_content,'{content}',result);
END $$;

CREATE OR REPLACE FUNCTION app.preview_editable_document_draft(p_id uuid,p_revision integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog,extensions AS $$
DECLARE result jsonb; d app.document_drafts%ROWTYPE; snapshot jsonb; html text; title text;
BEGIN
 result:=app._preview_editable_document_draft_v1(p_id,p_revision);
 IF result IS NULL OR result?'reason' THEN RETURN result;END IF;
 SELECT * INTO d FROM app.document_drafts WHERE id=p_id AND practitioner_id=auth.uid() FOR UPDATE;
 IF d.renderer_version<>'v2' THEN RETURN result;END IF;
 snapshot:=jsonb_set(d.preview_snapshot,'{content}',app.document_print_content_v2(d.preview_snapshot->'content'));
 SELECT title_fr INTO title FROM app.document_templates WHERE id=d.template_id;
 html:=app.document_header_v2(snapshot->'context')||'<h1 class="doc2-title">'||app.html_escape(title)||'</h1>'||app.document_decoration_v2(snapshot->'context')||'<main class="doc2-body">'||app.render_document_node(snapshot->'content')||'</main>';
 snapshot:=snapshot||jsonb_build_object('html',html,'contentHash',encode(digest(html||d.renderer_version,'sha256'),'hex'));
 UPDATE app.document_drafts SET preview_snapshot=snapshot WHERE id=d.id;
 RETURN snapshot-'identity'-'context';
END $$;

CREATE OR REPLACE FUNCTION app.render_document_pages(p_content jsonb,p_manifest jsonb,p_context jsonb,p_title text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE pg jsonb; slice jsonb; html text:=''; pagebody text; pageidx integer:=0; total integer:=jsonb_array_length(p_manifest->'pages');
BEGIN
 IF p_manifest->>'rendererVersion'<>'v2' THEN RETURN app._render_document_pages_v1(p_content,p_manifest,p_context,p_title);END IF;
 FOR pg IN SELECT value FROM jsonb_array_elements(p_manifest->'pages') LOOP
  pagebody:='';pageidx:=pageidx+1;
  FOR slice IN SELECT value FROM jsonb_array_elements(pg) LOOP pagebody:=pagebody||app.render_document_node(p_content->'content'->((slice#>>'{path,0}')::integer),ARRAY[(slice#>>'{path,0}')::integer],(slice->>'from')::integer,(slice->>'to')::integer);END LOOP;
  html:=html||'<article class="doc2-page" data-renderer="v2">'||CASE WHEN pageidx=1 THEN app.document_header_v2(p_context)||'<h1 class="doc2-title">'||app.html_escape(p_title)||'</h1>' ELSE '<div class="doc2-continuation">'||app.html_escape(p_title)||' · '||app.html_escape(p_context->>'patient_last_name')||' '||app.html_escape(p_context->>'patient_first_name')||'</div>' END||app.document_decoration_v2(p_context)||'<main class="doc2-body">'||pagebody||'</main><div class="doc2-page-number">'||CASE WHEN COALESCE(p_context->>'document_number','')<>'' THEN app.html_escape(p_context->>'document_number')||' · ' ELSE '' END||pageidx||' / '||total||'</div></article>';
 END LOOP;RETURN html;
END $$;
DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('document_footer_reference','document_context','document_identity','document_repeats_strength','document_print_content_v2','preview_editable_document_draft','render_document_pages') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO app_gatekeeper',f.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.oid::regprocedure);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.preview_editable_document_draft(uuid,integer) TO authenticated;
INSERT INTO app.schema_migrations(version) VALUES ('226_document_print_corrections');
COMMIT;
