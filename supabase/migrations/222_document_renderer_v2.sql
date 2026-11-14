-- Renderer v2: preserve all v1 snapshots and assets; only new instances use v2.
BEGIN;
ALTER TABLE app.document_drafts ALTER COLUMN renderer_version SET DEFAULT 'v2';
ALTER FUNCTION app.document_context(app.document_drafts) RENAME TO _document_context_v1;
CREATE FUNCTION app.document_context(d app.document_drafts) RETURNS jsonb LANGUAGE sql STABLE SET search_path=app,pg_catalog AS $$
 SELECT app._document_context_v1(d) || CASE WHEN d.renderer_version='v2' THEN jsonb_build_object(
 'footer_facebook_label',pr.signature_block#>>'{document_footer,facebook_label}',
 'footer_instagram_label',pr.signature_block#>>'{document_footer,instagram_label}') ELSE '{}'::jsonb END
 FROM app.profiles pr WHERE pr.id=d.practitioner_id;
$$;
ALTER FUNCTION app.document_identity(app.document_drafts) RENAME TO _document_identity_v1;
CREATE FUNCTION app.document_identity(d app.document_drafts) RETURNS jsonb LANGUAGE sql STABLE SET search_path=app,pg_catalog AS $$
 SELECT app._document_identity_v1(d) || CASE WHEN d.renderer_version='v2' THEN jsonb_build_object('document_footer',jsonb_build_object(
 'facebook_label',pr.signature_block#>>'{document_footer,facebook_label}',
 'instagram_label',pr.signature_block#>>'{document_footer,instagram_label}')) ELSE '{}'::jsonb END
 FROM app.profiles pr WHERE pr.id=d.practitioner_id;
$$;
CREATE FUNCTION app.document_header_v2(ctx jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=app,pg_catalog AS $$
 SELECT '<header class="doc2-header"><div class="doc2-identity"><p class="doc2-doctor">'||app.html_escape(COALESCE(ctx->>'praticien_title',''))||' '||app.html_escape(COALESCE(ctx->>'praticien_full_name',''))||'</p><p>'||app.html_escape(COALESCE(ctx->>'praticien_speciality_fr',''))||'</p><hr><div dir="rtl" class="doc2-ar"><p>'||app.html_escape(COALESCE(ctx->>'praticien_full_name_ar',''))||'</p><p>'||app.html_escape(COALESCE(ctx->>'praticien_speciality_ar',''))||'</p></div><hr><p>N° d’Ordre : '||app.html_escape(COALESCE(ctx->>'praticien_order_number',''))||'</p><p>Tél. : '||app.html_escape(COALESCE(ctx->>'praticien_phone',''))||'</p></div><div class="doc2-mark" aria-hidden="true"><img src="/documents/v2/header.svg" alt=""></div><div class="doc2-patient"><p>Date : '||app.html_escape(COALESCE(ctx->>'vars_date_affichee',''))||'</p><p>Nom : '||app.html_escape(COALESCE(ctx->>'patient_last_name',''))||'</p><p>Prénom : '||app.html_escape(COALESCE(ctx->>'patient_first_name',''))||'</p><p>Âge : '||app.html_escape(COALESCE(ctx->>'patient_age',''))||' ans</p></div></header>';
$$;
CREATE FUNCTION app.document_decoration_v2(ctx jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=app,pg_catalog AS $$
 SELECT '<img class="doc2-watermark" src="/documents/v2/watermark.svg" alt="" aria-hidden="true"><footer class="doc2-letter-footer"><div class="doc2-footer-address">'||app.html_escape(COALESCE(ctx->>'cabinet_address',''))||'</div>'||CASE WHEN COALESCE(ctx->>'footer_facebook_label','')<>'' OR COALESCE(ctx->>'footer_instagram_label','')<>'' THEN '<div class="doc2-social"><img src="/documents/v2/social.svg" alt="Facebook et Instagram"><div><span>'||app.html_escape(COALESCE(ctx->>'footer_facebook_label',''))||'</span><span>'||app.html_escape(COALESCE(ctx->>'footer_instagram_label',''))||'</span></div></div>' ELSE '' END||'</footer>';
$$;
ALTER FUNCTION app.preview_editable_document_draft(uuid,integer) RENAME TO _preview_editable_document_draft_v1;
REVOKE ALL ON FUNCTION app._preview_editable_document_draft_v1(uuid,integer) FROM authenticated,PUBLIC;
CREATE FUNCTION app.preview_editable_document_draft(p_id uuid,p_revision integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog,extensions AS $$
DECLARE result jsonb; d app.document_drafts%ROWTYPE; snapshot jsonb; html text; title text;
BEGIN
 result:=app._preview_editable_document_draft_v1(p_id,p_revision);
 IF result IS NULL OR result?'reason' THEN RETURN result;END IF;
 SELECT * INTO d FROM app.document_drafts WHERE id=p_id AND practitioner_id=auth.uid() FOR UPDATE;
 IF d.renderer_version<>'v2' THEN RETURN result;END IF;
 snapshot:=d.preview_snapshot;
 SELECT title_fr INTO title FROM app.document_templates WHERE id=d.template_id;
 html:=app.document_header_v2(snapshot->'context')||'<h1 class="doc2-title">'||app.html_escape(title)||'</h1>'||app.document_decoration_v2(snapshot->'context')||'<main class="doc2-body">'||app.render_document_node(snapshot->'content')||'</main>';
 snapshot:=snapshot||jsonb_build_object('html',html,'contentHash',encode(digest(html||d.renderer_version,'sha256'),'hex'));
 UPDATE app.document_drafts SET preview_snapshot=snapshot WHERE id=d.id;
 RETURN snapshot-'identity'-'context';
END $$;
ALTER FUNCTION app.render_document_pages(jsonb,jsonb,jsonb,text) RENAME TO _render_document_pages_v1;
CREATE FUNCTION app.render_document_pages(p_content jsonb,p_manifest jsonb,p_context jsonb,p_title text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE pg jsonb; slice jsonb; html text:=''; pagebody text; pageidx integer:=0; total integer:=jsonb_array_length(p_manifest->'pages');
BEGIN
 IF p_manifest->>'rendererVersion'<>'v2' THEN RETURN app._render_document_pages_v1(p_content,p_manifest,p_context,p_title);END IF;
 FOR pg IN SELECT value FROM jsonb_array_elements(p_manifest->'pages') LOOP
  pagebody:='';pageidx:=pageidx+1;
  FOR slice IN SELECT value FROM jsonb_array_elements(pg) LOOP pagebody:=pagebody||app.render_document_node(p_content->'content'->((slice#>>'{path,0}')::integer),ARRAY[(slice#>>'{path,0}')::integer],(slice->>'from')::integer,(slice->>'to')::integer);END LOOP;
  html:=html||'<article class="doc2-page" data-renderer="v2">'||CASE WHEN pageidx=1 THEN app.document_header_v2(p_context)||'<h1 class="doc2-title">'||app.html_escape(p_title)||'</h1>' ELSE '<div class="doc2-continuation">'||app.html_escape(p_title)||' · '||app.html_escape(p_context->>'patient_last_name')||' '||app.html_escape(p_context->>'patient_first_name')||'</div>' END||app.document_decoration_v2(p_context)||'<main class="doc2-body">'||pagebody||'</main>'||CASE WHEN pageidx=total THEN '<footer class="doc2-signature">Signature et cachet</footer>' ELSE '' END||'<div class="doc2-page-number">'||CASE WHEN COALESCE(p_context->>'document_number','')<>'' THEN app.html_escape(p_context->>'document_number')||' · ' ELSE '' END||pageidx||' / '||total||'</div></article>';
 END LOOP;RETURN html;
END $$;
DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('document_context','document_identity','document_header_v2','document_decoration_v2','preview_editable_document_draft','render_document_pages') LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO app_gatekeeper',f.oid::regprocedure);
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.oid::regprocedure);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.preview_editable_document_draft(uuid,integer) TO authenticated;
INSERT INTO app.schema_migrations(version) VALUES ('222_document_renderer_v2');
COMMIT;
