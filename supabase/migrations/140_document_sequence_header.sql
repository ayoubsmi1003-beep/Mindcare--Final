BEGIN;
-- Number only during successful atomic issuance; retries reuse the same piece.
CREATE OR REPLACE FUNCTION app.document_header_html(ctx jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=app,pg_catalog AS $$
 SELECT '<header class="doc2-header"><div class="doc2-identity"><p class="doc2-doctor">'||app.html_escape(COALESCE(ctx->>'praticien_title',''))||' '||app.html_escape(COALESCE(ctx->>'praticien_full_name',''))||'</p><p>'||app.html_escape(COALESCE(ctx->>'praticien_speciality_fr',''))||'</p><hr><div dir="rtl" class="doc2-ar"><p class="doc2-doctor">'||app.html_escape(COALESCE(ctx->>'praticien_full_name_ar',''))||'</p><p>'||app.html_escape(COALESCE(ctx->>'praticien_speciality_ar',''))||'</p></div><hr><p>N° d’Ordre : '||app.html_escape(COALESCE(ctx->>'document_number','—'))||'</p><p>Tél. : '||app.html_escape(COALESCE(ctx->>'praticien_phone',''))||'</p></div><div class="doc2-mark" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M23 9C17 3 9 8 10 15C3 18 5 27 10 29C7 37 17 43 23 37V9ZM25 9C31 3 39 8 38 15C45 18 43 27 38 29C41 37 31 43 25 37V9ZM12 17C18 15 20 21 16 24M11 31C16 28 20 31 19 36M36 17C30 15 28 21 32 24M37 31C32 28 28 31 29 36"/></svg></div><div class="doc2-patient"><p><b>Date :</b> '||app.html_escape(COALESCE(ctx->>'vars_date_affichee',''))||'</p><p><b>Nom :</b> '||app.html_escape(COALESCE(ctx->>'patient_last_name',''))||'</p><p><b>Prénom :</b> '||app.html_escape(COALESCE(ctx->>'patient_first_name',''))||'</p><p><b>Âge :</b> '||app.html_escape(COALESCE(ctx->>'patient_age',''))||' ans</p></div></header>';
$$;
CREATE OR REPLACE FUNCTION app._issue_editable_document_draft_locked(p_id uuid,p_revision integer,p_content_hash text,p_identity_version text,p_manifest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog,extensions AS $$
DECLARE d app.document_drafts%ROWTYPE; piece app.documents%ROWTYPE; tpl app.document_templates%ROWTYPE; snapshot jsonb; manifest jsonb:=p_manifest::jsonb; html text; num bigint; number text; reasons jsonb; identity jsonb;
BEGIN
 SELECT * INTO d FROM app.document_drafts WHERE id=p_id AND practitioner_id=auth.uid() FOR UPDATE;
 IF d.id IS NULL THEN RETURN NULL;END IF;
 IF d.issued_document_id IS NOT NULL THEN SELECT * INTO piece FROM app.documents WHERE id=d.issued_document_id;RETURN app.document_issued_snapshot(piece);END IF;
 IF d.archived_at IS NOT NULL THEN RETURN jsonb_build_object('reason','draft-conflict');END IF;
 PERFORM 1 FROM app.patients WHERE id=d.patient_id AND practitioner_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM audit.log_read(d.patient_id,'fiche');
 IF d.revision<>p_revision OR d.preview_revision IS DISTINCT FROM p_revision THEN RETURN jsonb_build_object('reason','preview-stale');END IF;
 snapshot:=d.preview_snapshot;identity:=app.document_identity(d);
 IF snapshot->>'contentHash' IS DISTINCT FROM p_content_hash OR snapshot->>'identityVersion' IS DISTINCT FROM p_identity_version OR encode(digest(identity::text,'sha256'),'hex') IS DISTINCT FROM p_identity_version OR snapshot->'context' IS DISTINCT FROM app.document_context(d) THEN RETURN jsonb_build_object('reason','preview-stale');END IF;
 reasons:=app.document_draft_reasons(d);IF jsonb_array_length(reasons)>0 THEN RETURN jsonb_build_object('reason',reasons->>0);END IF;
 IF NOT app.validate_document_manifest(snapshot->'content',manifest,p_content_hash,d.renderer_version) THEN RETURN jsonb_build_object('reason','layout-invalid');END IF;
 SELECT * INTO tpl FROM app.document_templates WHERE id=d.template_id;
 manifest:=manifest||jsonb_build_object('revision',d.revision);
 num:=app.next_number(d.cabinet_id,'document',to_char(now() AT TIME ZONE 'Africa/Algiers','YYYY'));
 number:='DOC-'||to_char(now() AT TIME ZONE 'Africa/Algiers','YYYY')||'-'||lpad(num::text,5,'0');
 html:=app.render_document_pages(snapshot->'content',manifest,snapshot->'context'||jsonb_build_object('document_number',number),tpl.title_fr);
 INSERT INTO app.documents(cabinet_id,practitioner_id,patient_id,doc_type,doc_number,variables,rendered_html,is_synthetic,template_id,template_version,schema_version,content_hash,snapshot_header,status,content_json,renderer_version,page_manifest,source_draft_id)
 VALUES(d.cabinet_id,auth.uid(),d.patient_id,d.doc_type,number,d.variables,html,app.is_cloud_dev(),d.template_id,d.template_version,'2',encode(digest(html,'sha256'),'hex'),identity,'issued',snapshot->'content',d.renderer_version,manifest,d.id) RETURNING * INTO piece;
 UPDATE app.document_drafts SET issued_document_id=piece.id WHERE id=d.id;
 RETURN app.document_issued_snapshot(piece);
END $$;
INSERT INTO app.schema_migrations(version) VALUES ('140_document_sequence_header');
COMMIT;
