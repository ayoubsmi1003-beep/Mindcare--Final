-- One deterministic renderer and idempotent, doctor-confirmed issue of saved instances.
BEGIN;
CREATE FUNCTION app.document_node_text(n jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE t text:=n->>'type'; outtext text:=''; c jsonb; k text;
BEGIN
 IF t='text' THEN RETURN n->>'text';ELSIF t='field' THEN RETURN COALESCE(n#>>'{attrs,value}','');ELSIF t='hardBreak' THEN RETURN E'\n';ELSIF t='medication' THEN
  FOREACH k IN ARRAY ARRAY['designation','strength','posology','quantity','frequency','duration','administration','instructions'] LOOP IF COALESCE(n#>>ARRAY['attrs',k],'')<>'' THEN outtext:=outtext||CASE WHEN outtext<>'' THEN E'\n' ELSE '' END||(n#>>ARRAY['attrs',k]);END IF;END LOOP;RETURN outtext;
 END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(COALESCE(n->'content','[]')) LOOP outtext:=outtext||app.document_node_text(c);END LOOP;RETURN outtext;
END $$;
CREATE FUNCTION app.document_context(d app.document_drafts) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=app,pg_catalog AS $$
DECLARE p app.patients%ROWTYPE; pr app.profiles%ROWTYPE; cb app.cabinets%ROWTYPE; ctx jsonb; k text; v jsonb;
BEGIN
 SELECT * INTO p FROM app.patients WHERE id=d.patient_id;SELECT * INTO pr FROM app.profiles WHERE id=d.practitioner_id;SELECT * INTO cb FROM app.cabinets WHERE id=d.cabinet_id;
 ctx:=jsonb_build_object('patient_first_name',p.first_name,'patient_last_name',p.last_name,'patient_record_number',p.record_number,'patient_birth_date',p.birth_date::text,'patient_birth_date_fr',to_char(p.birth_date,'DD/MM/YYYY'),'patient_age',extract(year FROM age(d.document_date,p.birth_date))::integer::text,'patient_civilite',app.civilite(p.sex,p.marital_status),'patient_id_document_number',p.id_document_number,'praticien_full_name',pr.full_name,'praticien_title',pr.title,'praticien_speciality_fr',pr.speciality_fr,'praticien_speciality_ar',pr.speciality_ar,'praticien_order_number',pr.order_number,'praticien_phone',pr.phone,'praticien_full_name_ar',pr.signature_block->>'full_name_ar','cabinet_name',cb.name,'cabinet_address',cb.address,'cabinet_phone',cb.phone);
 FOR k,v IN SELECT key,value FROM jsonb_each(d.variables) LOOP ctx:=ctx||jsonb_build_object('vars_'||k,v);END LOOP;
 ctx:=ctx||jsonb_build_object('vars_date_affichee',CASE WHEN d.doc_type='justification' THEN d.variables->>'date_consultation' ELSE to_char(d.document_date,'DD/MM/YYYY') END);
 IF d.doc_type='suivi_medical' AND COALESCE(d.variables->>'jours','')~'^[0-9]{1,3}$' AND (d.variables->>'jours')::integer BETWEEN 1 AND 365 THEN ctx:=ctx||jsonb_build_object('vars_jours_lettres',app.nombre_en_lettres((d.variables->>'jours')::integer));END IF;
 RETURN ctx;
END $$;
CREATE FUNCTION app.resolve_document_fields(n jsonb,ctx jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE children jsonb:='[]'; c jsonb;
BEGIN
 IF n->>'type'='field' THEN RETURN jsonb_set(n,'{attrs,value}',to_jsonb(COALESCE(ctx->>(n#>>'{attrs,name}'),'')));END IF;
 IF n?'content' THEN FOR c IN SELECT value FROM jsonb_array_elements(n->'content') LOOP children:=children||jsonb_build_array(app.resolve_document_fields(c,ctx));END LOOP;RETURN jsonb_set(n,'{content}',children);END IF;
 RETURN n;
END $$;
CREATE FUNCTION app.document_identity(d app.document_drafts) RETURNS jsonb LANGUAGE sql STABLE SET search_path=app,pg_catalog AS $$
 SELECT jsonb_build_object('cabinet',jsonb_build_object('name',c.name,'address',c.address,'phone',c.phone),'praticien',jsonb_build_object('full_name',pr.full_name,'title',pr.title,'speciality_fr',pr.speciality_fr,'speciality_ar',pr.speciality_ar,'order_number',pr.order_number,'phone',pr.phone,'full_name_ar',pr.signature_block->>'full_name_ar'),'patient',jsonb_build_object('first_name',p.first_name,'last_name',p.last_name,'record_number',p.record_number,'birth_date',p.birth_date::text,'sex',p.sex,'marital_status',p.marital_status)) FROM app.patients p JOIN app.profiles pr ON pr.id=d.practitioner_id JOIN app.cabinets c ON c.id=d.cabinet_id WHERE p.id=d.patient_id;
$$;
CREATE FUNCTION app.document_header_html(ctx jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=app,pg_catalog AS $$
 SELECT '<header class="doc2-header"><div class="doc2-identity"><p class="doc2-doctor">'||app.html_escape(COALESCE(ctx->>'praticien_title',''))||' '||app.html_escape(COALESCE(ctx->>'praticien_full_name',''))||'</p><p>'||app.html_escape(COALESCE(ctx->>'praticien_speciality_fr',''))||'</p><hr><div dir="rtl" class="doc2-ar"><p class="doc2-doctor">'||app.html_escape(COALESCE(ctx->>'praticien_full_name_ar',''))||'</p><p>'||app.html_escape(COALESCE(ctx->>'praticien_speciality_ar',''))||'</p></div><hr><p>N° d’Ordre : '||app.html_escape(COALESCE(ctx->>'praticien_order_number',''))||'</p><p>Tél. : '||app.html_escape(COALESCE(ctx->>'praticien_phone',''))||'</p></div><div class="doc2-mark" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M23 9C17 3 9 8 10 15C3 18 5 27 10 29C7 37 17 43 23 37V9ZM25 9C31 3 39 8 38 15C45 18 43 27 38 29C41 37 31 43 25 37V9ZM12 17C18 15 20 21 16 24M11 31C16 28 20 31 19 36M36 17C30 15 28 21 32 24M37 31C32 28 28 31 29 36"/></svg></div><div class="doc2-patient"><p><b>Date :</b> '||app.html_escape(COALESCE(ctx->>'vars_date_affichee',''))||'</p><p><b>Nom :</b> '||app.html_escape(COALESCE(ctx->>'patient_last_name',''))||'</p><p><b>Prénom :</b> '||app.html_escape(COALESCE(ctx->>'patient_first_name',''))||'</p><p><b>Âge :</b> '||app.html_escape(COALESCE(ctx->>'patient_age',''))||' ans</p></div></header>';
$$;
CREATE FUNCTION app.render_document_node(n jsonb,p_path integer[] DEFAULT '{}',p_from integer DEFAULT 0,p_to integer DEFAULT 2147483647) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE t text:=n->>'type'; out_html text:=''; child jsonb; child_html text; pos integer:=0; len integer; ix integer:=0; contenttext text; mark jsonb; wrapper text; k text; attr text:=''; startvalue integer:=1;
BEGIN
 len:=char_length(app.document_node_text(n));
 IF len>0 AND (p_from>=len OR p_to<=0) THEN RETURN '';END IF;
 IF t IN ('text','field') THEN
  contenttext:=substring(app.document_node_text(n) FROM greatest(p_from,0)+1 FOR greatest(least(p_to,len)-greatest(p_from,0),0));out_html:=app.html_escape(contenttext);
  IF t='text' THEN FOR mark IN SELECT value FROM jsonb_array_elements(COALESCE(n->'marks','[]')) LOOP wrapper:=CASE mark->>'type' WHEN 'bold' THEN 'strong' WHEN 'italic' THEN 'em' ELSE 'u' END;out_html:='<'||wrapper||'>'||out_html||'</'||wrapper||'>';END LOOP;
  ELSE out_html:='<span data-field="'||app.html_escape(n#>>'{attrs,name}')||'">'||out_html||'</span>';END IF;RETURN out_html;
 ELSIF t='hardBreak' THEN RETURN '<br>';ELSIF t='pageBreak' THEN RETURN '';
 ELSIF t='medication' THEN
  -- Split a medication's printed text with the same codepoint offsets as its source attributes.
  contenttext:=substring(app.document_node_text(n) FROM greatest(p_from,0)+1 FOR greatest(least(p_to,len)-greatest(p_from,0),0));
  RETURN '<div class="doc2-medication" data-path="'||array_to_string(p_path,'.')||'" data-length="'||len||'">'||replace(app.html_escape(contenttext),E'\n','<br>')||'</div>';
 END IF;
 FOR child IN SELECT value FROM jsonb_array_elements(COALESCE(n->'content','[]')) LOOP
  len:=char_length(app.document_node_text(child));
  child_html:=app.render_document_node(child,p_path||ix,greatest(p_from-pos,0),least(p_to-pos,len));
  IF len=0 AND (pos<p_from OR pos>p_to) THEN child_html:='';END IF;
  IF t='orderedList' AND child_html='' THEN startvalue:=startvalue+1;END IF;
  out_html:=out_html||child_html;pos:=pos+len;ix:=ix+1;
 END LOOP;
 IF t='doc' THEN RETURN out_html;ELSIF t='paragraph' THEN
  attr:=' data-path="'||array_to_string(p_path,'.')||'" data-length="'||char_length(app.document_node_text(n))||'" dir="'||COALESCE(n#>>'{attrs,dir}','auto')||'" style="text-align:'||COALESCE(n#>>'{attrs,textAlign}','justify')||'"';
  RETURN '<p'||attr||'>'||CASE WHEN out_html='' THEN '<br>' ELSE out_html END||'</p>';
 ELSIF t='listItem' THEN IF btrim(regexp_replace(out_html,'<[^>]+>','','g'))='' THEN RETURN '';END IF;RETURN '<li>'||out_html||'</li>';
 ELSIF t='bulletList' THEN RETURN '<ul data-path="'||array_to_string(p_path,'.')||'" data-length="'||char_length(app.document_node_text(n))||'">'||out_html||'</ul>';
 ELSIF t='orderedList' THEN RETURN '<ol start="'||(COALESCE((n#>>'{attrs,start}')::integer,1)+startvalue-1)||'" data-path="'||array_to_string(p_path,'.')||'" data-length="'||char_length(app.document_node_text(n))||'">'||out_html||'</ol>';
 END IF;RETURN '';
END $$;
CREATE FUNCTION app.render_document_content(p_content jsonb,p_variables jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
BEGIN PERFORM app.validate_document_content(p_content);RETURN app.render_document_node(app.resolve_document_fields(p_content,p_variables));END $$;
CREATE FUNCTION app.document_draft_reasons(d app.document_drafts) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=app,pg_catalog AS $$
DECLARE p app.patients%ROWTYPE; reasons jsonb:='[]'; expected text[]; k text; meds jsonb;
BEGIN
 SELECT * INTO p FROM app.patients WHERE id=d.patient_id;
 IF p.sex IS NULL THEN reasons:=reasons||'"patient-sex-missing"'::jsonb;END IF;
 IF p.birth_date IS NULL THEN reasons:=reasons||'"patient-birth-missing"'::jsonb;END IF;
 IF cardinality(app._document_header_missing(d.cabinet_id,d.practitioner_id))>0 THEN reasons:=reasons||'"header-incomplete"'::jsonb;END IF;
 expected:=CASE d.doc_type WHEN 'bonne_sante_mentale' THEN ARRAY['id_document_number','mairie'] WHEN 'suivi_medical' THEN ARRAY['jours','date_debut'] WHEN 'certificat_medical' THEN ARRAY['date_naissance','traitement_1'] WHEN 'justification' THEN ARRAY['date_consultation'] ELSE ARRAY[]::text[] END;
 FOREACH k IN ARRAY expected LOOP IF btrim(COALESCE(d.variables->>k,''))='' THEN reasons:=reasons||'"required-field"'::jsonb;EXIT;END IF;END LOOP;
 IF d.doc_type='suivi_medical' AND (COALESCE(d.variables->>'jours','')!~'^[0-9]{1,3}$' OR (d.variables->>'jours')::integer NOT BETWEEN 1 AND 365) THEN reasons:=reasons||'"required-field"'::jsonb;END IF;
 IF d.doc_type IN ('justification','suivi_medical') THEN
  BEGIN PERFORM to_date(d.variables->>CASE WHEN d.doc_type='justification' THEN 'date_consultation' ELSE 'date_debut' END,'DD/MM/YYYY');EXCEPTION WHEN others THEN reasons:=reasons||'"required-field"'::jsonb;END;
 END IF;
 IF jsonb_array_length(d.content_json->'content')=0 THEN reasons:=reasons||'"required-field"'::jsonb;END IF;
 IF d.doc_type='ordonnance' THEN
  SELECT COALESCE(jsonb_agg(value),'[]') INTO meds FROM jsonb_path_query(d.content_json,'strict $.** ? (@.type == "medication")');
  IF jsonb_array_length(meds)=0 THEN reasons:=reasons||'"medication-invalid"'::jsonb;
  ELSE
   FOR meds IN SELECT value FROM jsonb_array_elements(meds) LOOP
    IF btrim(COALESCE(meds#>>'{attrs,designation}',''))='' OR btrim(COALESCE(meds#>>'{attrs,posology}',''))='' OR (meds#>>'{attrs,source}'='catalogue' AND NOT EXISTS(SELECT 1 FROM app.medications m WHERE m.id=(meds#>>'{attrs,medicationId}')::uuid AND m.is_active)) THEN reasons:=reasons||'"medication-invalid"'::jsonb;EXIT;END IF;
   END LOOP;
  END IF;
 END IF;
 RETURN (SELECT COALESCE(jsonb_agg(DISTINCT value),'[]') FROM jsonb_array_elements(reasons));
END $$;
CREATE FUNCTION app.preview_editable_document_draft(p_id uuid,p_revision integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog,extensions AS $$
DECLARE d app.document_drafts%ROWTYPE; tpl app.document_templates%ROWTYPE; ctx jsonb; content jsonb; html text; identity jsonb; snapshot jsonb; reasons jsonb;
BEGIN
 SELECT * INTO d FROM app.document_drafts WHERE id=p_id AND practitioner_id=auth.uid() FOR UPDATE;
 IF d.id IS NULL THEN RETURN NULL;END IF;
 IF d.revision<>p_revision THEN RETURN jsonb_build_object('reason','draft-conflict');END IF;
 IF d.issued_document_id IS NOT NULL OR d.archived_at IS NOT NULL THEN RAISE EXCEPTION 'DocumentDraftLocked';END IF;
 PERFORM audit.log_read(d.patient_id,'fiche');SELECT * INTO tpl FROM app.document_templates WHERE id=d.template_id;
 ctx:=app.document_context(d);content:=app.resolve_document_fields(d.content_json,ctx);identity:=app.document_identity(d);reasons:=app.document_draft_reasons(d);
 html:=app.document_header_html(ctx)||'<h1 class="doc2-title">'||app.html_escape(tpl.title_fr)||'</h1><main class="doc2-body">'||app.render_document_node(content)||'</main>';
 snapshot:=jsonb_build_object('draftId',d.id,'revision',d.revision,'contentHash',encode(digest(html||d.renderer_version,'sha256'),'hex'),'rendererVersion',d.renderer_version,'html',html,'content',content,'identityVersion',encode(digest(identity::text,'sha256'),'hex'),'identity',identity,'context',ctx,'readiness',jsonb_build_object('canIssue',jsonb_array_length(reasons)=0,'reasons',reasons));
 UPDATE app.document_drafts SET preview_snapshot=snapshot,preview_revision=d.revision WHERE id=d.id;
 RETURN snapshot-'identity'-'context';
END $$;
CREATE FUNCTION app.validate_document_manifest(p_content jsonb,p_manifest jsonb,p_hash text,p_version text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE pg jsonb; slice jsonb; blockidx integer:=0; offsetpos integer:=0; frompos integer; topos integer; len integer;
BEGIN
 IF p_manifest->>'contentHash' IS DISTINCT FROM p_hash OR p_manifest->>'rendererVersion' IS DISTINCT FROM p_version OR jsonb_typeof(p_manifest->'pages')<>'array' OR jsonb_array_length(p_manifest->'pages') NOT BETWEEN 1 AND 100 THEN RETURN false;END IF;
 FOR pg IN SELECT value FROM jsonb_array_elements(p_manifest->'pages') LOOP
  IF jsonb_typeof(pg)<>'array' OR jsonb_array_length(pg)=0 THEN RETURN false;END IF;
  FOR slice IN SELECT value FROM jsonb_array_elements(pg) LOOP
   IF jsonb_typeof(slice->'path')<>'array' OR jsonb_array_length(slice->'path')<>1 OR (slice#>>'{path,0}')::integer<>blockidx THEN RETURN false;END IF;
   frompos:=(slice->>'from')::integer;topos:=(slice->>'to')::integer;len:=char_length(app.document_node_text(p_content->'content'->blockidx));
   IF len IS NULL OR frompos<>offsetpos OR topos<frompos OR topos>len OR (topos=frompos AND len>0) THEN RETURN false;END IF;
   IF topos=len THEN blockidx:=blockidx+1;offsetpos:=0;ELSE offsetpos:=topos;END IF;
  END LOOP;
 END LOOP;
 RETURN blockidx=jsonb_array_length(p_content->'content') AND offsetpos=0;
EXCEPTION WHEN others THEN RETURN false;
END $$;
CREATE FUNCTION app.render_document_pages(p_content jsonb,p_manifest jsonb,p_context jsonb,p_title text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE pg jsonb; slice jsonb; html text:=''; pagebody text; pageidx integer:=0; total integer:=jsonb_array_length(p_manifest->'pages');
BEGIN
 FOR pg IN SELECT value FROM jsonb_array_elements(p_manifest->'pages') LOOP
  pagebody:='';pageidx:=pageidx+1;
  FOR slice IN SELECT value FROM jsonb_array_elements(pg) LOOP pagebody:=pagebody||app.render_document_node(p_content->'content'->((slice#>>'{path,0}')::integer),ARRAY[(slice#>>'{path,0}')::integer],(slice->>'from')::integer,(slice->>'to')::integer);END LOOP;
  html:=html||'<article class="doc2-page">'||CASE WHEN pageidx=1 THEN app.document_header_html(p_context)||'<h1 class="doc2-title">'||app.html_escape(p_title)||'</h1>' ELSE '<div class="doc2-continuation">'||app.html_escape(p_title)||' · '||app.html_escape(p_context->>'patient_last_name')||' '||app.html_escape(p_context->>'patient_first_name')||'</div>' END||'<main class="doc2-body">'||pagebody||'</main>'||CASE WHEN pageidx=total THEN '<footer class="doc2-signature">Signature et cachet</footer>' ELSE '' END||'<div class="doc2-page-number">'||pageidx||' / '||total||'</div></article>';
 END LOOP;RETURN html;
END $$;
CREATE FUNCTION app.document_issued_snapshot(d app.documents) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('documentId',d.id,'draftId',d.source_draft_id,'revision',d.page_manifest->>'revision','contentHash',d.content_hash,'rendererVersion',d.renderer_version,'html',d.rendered_html,'manifest',d.page_manifest,'docNumber',d.doc_number); $$;
CREATE FUNCTION app.get_editable_document_snapshot(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE d app.documents%ROWTYPE;BEGIN SELECT * INTO d FROM app.documents WHERE id=p_id AND content_json IS NOT NULL;IF d.id IS NULL THEN RETURN NULL;END IF;PERFORM audit.log_read(d.patient_id,'fiche');RETURN app.document_issued_snapshot(d);END $$;
CREATE FUNCTION app.issue_editable_document_draft(p_id uuid,p_revision integer,p_content_hash text,p_identity_version text,p_manifest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog,extensions AS $$
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
 html:=app.render_document_pages(snapshot->'content',manifest,snapshot->'context',tpl.title_fr);
 num:=app.next_number(d.cabinet_id,'document',to_char(now() AT TIME ZONE 'Africa/Algiers','YYYY'));
 number:='DOC-'||to_char(now() AT TIME ZONE 'Africa/Algiers','YYYY')||'-'||lpad(num::text,5,'0');
 INSERT INTO app.documents(cabinet_id,practitioner_id,patient_id,doc_type,doc_number,variables,rendered_html,is_synthetic,template_id,template_version,schema_version,content_hash,snapshot_header,status,content_json,renderer_version,page_manifest,source_draft_id)
 VALUES(d.cabinet_id,auth.uid(),d.patient_id,d.doc_type,number,d.variables,html,app.is_cloud_dev(),d.template_id,d.template_version,'2',encode(digest(html,'sha256'),'hex'),identity,'issued',snapshot->'content',d.renderer_version,manifest,d.id) RETURNING * INTO piece;
 UPDATE app.document_drafts SET issued_document_id=piece.id WHERE id=d.id;
 RETURN app.document_issued_snapshot(piece);
END $$;
-- Resolve the bound fields for editor display without altering the saved free text.
CREATE OR REPLACE FUNCTION app.get_editable_document_draft(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE d app.document_drafts%ROWTYPE; outrow jsonb;
BEGIN SELECT * INTO d FROM app.document_drafts WHERE id=p_id;IF d.id IS NULL THEN RETURN NULL;END IF;PERFORM audit.log_read(d.patient_id,'fiche');outrow:=app.document_draft_row(d);RETURN jsonb_set(outrow,'{content}',app.resolve_document_fields(d.content_json,app.document_context(d)));END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('document_node_text','document_context','resolve_document_fields','document_identity','document_header_html','render_document_node','render_document_content','document_draft_reasons','preview_editable_document_draft','validate_document_manifest','render_document_pages','document_issued_snapshot','get_editable_document_snapshot','issue_editable_document_draft','get_editable_document_draft') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO app_gatekeeper',f.oid::regprocedure);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.oid::regprocedure);
  IF f.proname IN ('preview_editable_document_draft','get_editable_document_snapshot','issue_editable_document_draft','get_editable_document_draft') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.oid::regprocedure);END IF;
 END LOOP;
END $$;
INSERT INTO app.schema_migrations(version) VALUES ('130_document_editor_issue') ON CONFLICT DO NOTHING;
COMMIT;
