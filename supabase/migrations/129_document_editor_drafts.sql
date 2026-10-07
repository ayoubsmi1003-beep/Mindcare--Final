-- Editable instances, closed JSON schema, optimistic revisions and audited SQL doors.
BEGIN;
ALTER TABLE app.document_templates ADD COLUMN content_json jsonb;
ALTER TABLE app.documents ADD COLUMN content_json jsonb;
ALTER TABLE app.documents ADD COLUMN renderer_version text;
ALTER TABLE app.documents ADD COLUMN page_manifest jsonb;
ALTER TABLE app.documents ADD COLUMN source_draft_id uuid UNIQUE;
ALTER TABLE app.documents ADD COLUMN prescription_id uuid REFERENCES app.prescriptions(id);
CREATE TABLE app.document_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cabinet_id uuid NOT NULL REFERENCES app.cabinets(id), practitioner_id uuid NOT NULL REFERENCES app.profiles(id), patient_id uuid NOT NULL REFERENCES app.patients(id),
 doc_type app.doc_type NOT NULL, template_id uuid NOT NULL REFERENCES app.document_templates(id), template_version integer NOT NULL, variables jsonb NOT NULL, content_json jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), document_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Algiers')::date, renderer_version text NOT NULL DEFAULT 'v1',
 updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz, issued_document_id uuid UNIQUE REFERENCES app.documents(id), source_document_id uuid REFERENCES app.documents(id),
 preview_snapshot jsonb, preview_revision integer
);
ALTER TABLE app.documents ADD CONSTRAINT documents_source_draft_fk FOREIGN KEY(source_draft_id) REFERENCES app.document_drafts(id);
CREATE TABLE app.document_draft_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL REFERENCES app.document_drafts(id), patient_id uuid NOT NULL REFERENCES app.patients(id), cabinet_id uuid NOT NULL REFERENCES app.cabinets(id), practitioner_id uuid NOT NULL REFERENCES app.profiles(id),
 revision integer NOT NULL, content_json jsonb NOT NULL, variables jsonb NOT NULL, document_date date NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(draft_id,revision)
);
ALTER TABLE app.document_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.document_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE app.document_draft_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.document_draft_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY document_drafts_clinical ON app.document_drafts FOR ALL TO authenticated USING(cabinet_id=app.current_cabinet() AND app.can_see_clinical(practitioner_id)) WITH CHECK(cabinet_id=app.current_cabinet() AND app.can_see_clinical(practitioner_id));
CREATE POLICY document_draft_revisions_clinical ON app.document_draft_revisions FOR ALL TO authenticated USING(cabinet_id=app.current_cabinet() AND app.can_see_clinical(practitioner_id)) WITH CHECK(cabinet_id=app.current_cabinet() AND app.can_see_clinical(practitioner_id));
GRANT SELECT,INSERT,UPDATE ON app.document_drafts TO app_gatekeeper;
GRANT SELECT,INSERT ON app.document_draft_revisions TO app_gatekeeper;
CREATE INDEX document_drafts_patient ON app.document_drafts(patient_id,updated_at DESC);
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE ON app.document_drafts FOR EACH ROW EXECUTE FUNCTION audit.track();
CREATE TRIGGER trg_audit AFTER INSERT ON app.document_draft_revisions FOR EACH ROW EXECUTE FUNCTION audit.track();
CREATE TRIGGER document_draft_no_delete BEFORE DELETE ON app.document_drafts FOR EACH ROW EXECUTE FUNCTION app.forbid_document_delete();
CREATE TRIGGER document_revision_no_delete BEFORE DELETE OR UPDATE ON app.document_draft_revisions FOR EACH ROW EXECUTE FUNCTION app.forbid_document_delete();
CREATE FUNCTION app.check_document_node(n jsonb,depth integer DEFAULT 0,parent text DEFAULT 'root') RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE t text:=n->>'type'; a jsonb:=COALESCE(n->'attrs','{}'); c jsonb; m jsonb; total integer:=0; allowed text[]; k text;
BEGIN
 IF depth>12 OR jsonb_typeof(n)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(n) key WHERE key NOT IN ('type','text','attrs','marks','content')) THEN RAISE EXCEPTION 'DocumentSchemaRejected'; END IF;
 IF t IS NULL OR (parent='root' AND t<>'doc') OR (parent='doc' AND t NOT IN ('paragraph','bulletList','orderedList','medication','pageBreak')) OR (parent='paragraph' AND t NOT IN ('text','field','hardBreak')) OR (parent IN ('bulletList','orderedList') AND t<>'listItem') OR (parent='listItem' AND t NOT IN ('paragraph','bulletList','orderedList')) OR parent NOT IN ('root','doc','paragraph','bulletList','orderedList','listItem') THEN RAISE EXCEPTION 'DocumentStructureRejected'; END IF;
 IF jsonb_typeof(a)<>'object' THEN RAISE EXCEPTION 'DocumentAttributesRejected'; END IF;
 allowed:=CASE t WHEN 'paragraph' THEN ARRAY['textAlign','dir'] WHEN 'orderedList' THEN ARRAY['start'] WHEN 'field' THEN ARRAY['name','value'] WHEN 'medication' THEN ARRAY['rowId','medicationId','source','designation','strength','posology','quantity','frequency','duration','administration','instructions'] ELSE ARRAY[]::text[] END;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(a) key WHERE NOT(key=ANY(allowed))) THEN RAISE EXCEPTION 'DocumentAttributesRejected'; END IF;
 IF t='paragraph' AND ((a?'textAlign' AND COALESCE(a->>'textAlign','') NOT IN ('left','center','right','justify')) OR (a?'dir' AND COALESCE(a->>'dir','') NOT IN ('ltr','rtl','auto'))) THEN RAISE EXCEPTION 'DocumentParagraphRejected'; END IF;
 IF t='orderedList' AND a?'start' AND (COALESCE(a->>'start','')!~'^[0-9]+$' OR (a->>'start')::numeric NOT BETWEEN 1 AND 10000) THEN RAISE EXCEPTION 'DocumentListRejected'; END IF;
 IF t='field' AND (COALESCE(a->>'name','')!~'^[a-z][a-z0-9_]{0,63}$' OR jsonb_typeof(a->'value') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'DocumentFieldRejected'; END IF;
 IF t='medication' THEN
  FOREACH k IN ARRAY allowed LOOP
   IF k='medicationId' AND a->k='null'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(a->k) IS DISTINCT FROM 'string' OR char_length(a->>k)>4000 THEN RAISE EXCEPTION 'DocumentMedicationRejected'; END IF;
  END LOOP;
  IF a->>'source' NOT IN ('catalogue','free-text') OR (a->>'source'='catalogue' AND COALESCE(a->>'medicationId','')!~'^[0-9a-fA-F-]{36}$') THEN RAISE EXCEPTION 'DocumentMedicationRejected'; END IF;
 END IF;
 IF t='text' THEN
  IF jsonb_typeof(n->'text') IS DISTINCT FROM 'string' OR n->>'text'='' OR n?'content' THEN RAISE EXCEPTION 'DocumentTextRejected'; END IF;
 ELSIF n?'text' THEN RAISE EXCEPTION 'DocumentTextRejected'; END IF;
 IF n?'marks' THEN
  IF t<>'text' OR jsonb_typeof(n->'marks')<>'array' OR jsonb_array_length(n->'marks')>3 THEN RAISE EXCEPTION 'DocumentMarksRejected'; END IF;
  FOR m IN SELECT value FROM jsonb_array_elements(n->'marks') LOOP
   IF jsonb_typeof(m)<>'object' OR COALESCE(m->>'type','') NOT IN ('bold','italic','underline') OR EXISTS(SELECT 1 FROM jsonb_object_keys(m) key WHERE key<>'type') THEN RAISE EXCEPTION 'DocumentMarkRejected'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(n->'marks'))<>(SELECT count(DISTINCT value->>'type') FROM jsonb_array_elements(n->'marks')) THEN RAISE EXCEPTION 'DocumentMarkRejected'; END IF;
 END IF;
 IF t IN ('doc','paragraph','bulletList','orderedList','listItem') THEN
  IF jsonb_typeof(COALESCE(n->'content','[]'))<>'array' OR (t IN ('doc','bulletList','orderedList','listItem') AND NOT n?'content') OR (t IN ('bulletList','orderedList','listItem') AND jsonb_array_length(n->'content')=0) THEN RAISE EXCEPTION 'DocumentChildrenRejected'; END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(COALESCE(n->'content','[]')) LOOP total:=total+app.check_document_node(c,depth+1,t); END LOOP;
 ELSIF n?'content' THEN RAISE EXCEPTION 'DocumentChildrenRejected'; END IF;
 RETURN total+CASE WHEN t IN ('paragraph','bulletList','orderedList','medication','pageBreak') THEN 1 ELSE 0 END;
END $$;
CREATE FUNCTION app.validate_document_content(p_content jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE nodes integer; meds integer;
BEGIN
 IF octet_length(p_content::text)>204800 THEN RAISE EXCEPTION 'DocumentSizeExceeded'; END IF;
 nodes:=app.check_document_node(p_content);
 IF nodes>500 THEN RAISE EXCEPTION 'DocumentBlocksExceeded'; END IF;
 SELECT count(*) INTO meds FROM jsonb_path_query(p_content,'$.** ? (@.type == "medication")');
 IF meds>50 THEN RAISE EXCEPTION 'DocumentMedicationsExceeded'; END IF;
END $$;
CREATE FUNCTION app.document_text_nodes(p_text text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE rest text:=p_text; found text[]; startpos integer; outnodes jsonb:='[]';
BEGIN
 LOOP
  found:=regexp_match(rest,'\{\{([a-zA-Z0-9_.]+)\}\}');
  IF found IS NULL THEN IF rest<>'' THEN outnodes:=outnodes||jsonb_build_array(jsonb_build_object('type','text','text',rest)); END IF; EXIT; END IF;
  startpos:=strpos(rest,'{{'||found[1]||'}}');
  IF startpos>1 THEN outnodes:=outnodes||jsonb_build_array(jsonb_build_object('type','text','text',left(rest,startpos-1))); END IF;
  outnodes:=outnodes||jsonb_build_array(jsonb_build_object('type','field','attrs',jsonb_build_object('name',replace(found[1],'.','_'),'value','')));
  rest:=substring(rest FROM startpos+char_length(found[1])+4);
 END LOOP;
 RETURN outnodes;
END $$;
-- This converter accepts only our existing plain p/ul/li templates; never user HTML.
CREATE FUNCTION app.document_template_json(p_html text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE part text[]; outnodes jsonb:='[]'; pending_list jsonb:='[]'; paragraph jsonb; textvalue text;
BEGIN
 FOR part IN SELECT regexp_matches(p_html,'<(p|li)>(.*?)</\1>','gs') LOOP
  textvalue:=part[2];
  IF textvalue~'<[^>]+>' THEN RAISE EXCEPTION 'TemplateStructureRequiresReview'; END IF;
  textvalue:=replace(replace(replace(replace(replace(textvalue,'&amp;','&'),'&lt;','<'),'&gt;','>'),'&quot;','"'),'&#39;',chr(39));
  paragraph:=jsonb_build_object('type','paragraph','content',app.document_text_nodes(textvalue));
  IF part[1]='li' THEN pending_list:=pending_list||jsonb_build_array(jsonb_build_object('type','listItem','content',jsonb_build_array(paragraph)));
  ELSE
   IF jsonb_array_length(pending_list)>0 THEN outnodes:=outnodes||jsonb_build_array(jsonb_build_object('type','bulletList','content',pending_list));pending_list:='[]'; END IF;
   outnodes:=outnodes||jsonb_build_array(paragraph);
  END IF;
 END LOOP;
 IF jsonb_array_length(pending_list)>0 THEN outnodes:=outnodes||jsonb_build_array(jsonb_build_object('type','bulletList','content',pending_list)); END IF;
 IF jsonb_array_length(outnodes)=0 THEN RAISE EXCEPTION 'TemplateStructureRequiresReview'; END IF;
 RETURN jsonb_build_object('type','doc','content',outnodes);
END $$;
INSERT INTO app.document_templates(cabinet_id,doc_type,version,title_fr,header_html,body_html,footer_html,is_active,content_json)
 SELECT t.cabinet_id,t.doc_type,t.version+1,t.title_fr,t.header_html,t.body_html,t.footer_html,true,app.document_template_json(t.body_html)
 FROM app.document_templates t WHERE t.is_active AND t.version=(SELECT max(t2.version) FROM app.document_templates t2 WHERE t2.cabinet_id=t.cabinet_id AND t2.doc_type=t.doc_type);
CREATE FUNCTION app.document_draft_row(p_draft app.document_drafts) RETURNS jsonb LANGUAGE sql STABLE SET search_path=app,pg_catalog AS $$
 SELECT jsonb_build_object('id',p_draft.id,'patientId',p_draft.patient_id,'kind',p_draft.doc_type,'templateId',p_draft.template_id,'templateVersion',p_draft.template_version,'content',p_draft.content_json,'variables',p_draft.variables,'revision',p_draft.revision,'documentDate',p_draft.document_date::text,'rendererVersion',p_draft.renderer_version,'issuedDocumentId',p_draft.issued_document_id,'archivedAt',p_draft.archived_at,'title',t.title_fr,'patientName',p.last_name||' '||p.first_name)
 FROM app.document_templates t JOIN app.patients p ON p.id=p_draft.patient_id WHERE t.id=p_draft.template_id;
$$;
CREATE FUNCTION app.assert_document_draft() RETURNS trigger LANGUAGE plpgsql SET search_path=app,pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND (OLD.issued_document_id IS NOT NULL OR NEW.cabinet_id<>OLD.cabinet_id OR NEW.practitioner_id<>OLD.practitioner_id OR NEW.patient_id<>OLD.patient_id OR NEW.template_id<>OLD.template_id OR NEW.template_version<>OLD.template_version OR NEW.doc_type<>OLD.doc_type OR NEW.renderer_version<>OLD.renderer_version OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id) THEN RAISE EXCEPTION 'DocumentDraftLocked'; END IF;
 PERFORM app.validate_document_content(NEW.content_json);
 IF jsonb_typeof(NEW.variables)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each(NEW.variables) WHERE jsonb_typeof(value)<>'string' OR char_length(value#>>'{}')>4000) THEN RAISE EXCEPTION 'DocumentVariablesRejected'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_draft_guard BEFORE INSERT OR UPDATE ON app.document_drafts FOR EACH ROW EXECUTE FUNCTION app.assert_document_draft();
CREATE FUNCTION app.track_document_draft_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=app,pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.revision<>OLD.revision THEN INSERT INTO app.document_draft_revisions(draft_id,patient_id,cabinet_id,practitioner_id,revision,content_json,variables,document_date) VALUES(NEW.id,NEW.patient_id,NEW.cabinet_id,NEW.practitioner_id,NEW.revision,NEW.content_json,NEW.variables,NEW.document_date); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_draft_revision AFTER INSERT OR UPDATE ON app.document_drafts FOR EACH ROW EXECUTE FUNCTION app.track_document_draft_revision();
CREATE FUNCTION app.create_editable_document_draft(p_patient_id uuid,p_type app.doc_type,p_variables text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE pat app.patients%ROWTYPE; tpl app.document_templates%ROWTYPE; d app.document_drafts%ROWTYPE; v jsonb:=p_variables::jsonb;
BEGIN
 SELECT * INTO pat FROM app.patients WHERE id=p_patient_id AND practitioner_id=auth.uid();
 IF pat.id IS NULL OR NOT COALESCE(app.can_see_clinical(auth.uid()),false) THEN RETURN NULL; END IF;
 PERFORM audit.log_read(p_patient_id,'fiche');
 SELECT * INTO tpl FROM app.document_templates WHERE cabinet_id=app.current_cabinet() AND doc_type=p_type AND is_active ORDER BY version DESC LIMIT 1;
 IF tpl.id IS NULL THEN RAISE EXCEPTION 'DocumentTemplateMissing'; END IF;
 INSERT INTO app.document_drafts(cabinet_id,practitioner_id,patient_id,doc_type,template_id,template_version,variables,content_json)
 VALUES(app.current_cabinet(),auth.uid(),pat.id,p_type,tpl.id,tpl.version,v,COALESCE(tpl.content_json,app.document_template_json(tpl.body_html))) RETURNING * INTO d;
 RETURN app.document_draft_row(d);
END $$;
CREATE FUNCTION app.get_editable_document_draft(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE d app.document_drafts%ROWTYPE;
BEGIN SELECT * INTO d FROM app.document_drafts WHERE id=p_id;IF d.id IS NULL THEN RETURN NULL;END IF;PERFORM audit.log_read(d.patient_id,'fiche');RETURN app.document_draft_row(d);END $$;
CREATE FUNCTION app.list_editable_document_drafts(p_patient_id uuid DEFAULT NULL,p_archived boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE outrows jsonb;
BEGIN
 PERFORM audit.log_read(p_patient_id,'liste');
 SELECT COALESCE(jsonb_agg(app.document_draft_row(d) ORDER BY updated_at DESC),'[]') INTO outrows FROM (SELECT * FROM app.document_drafts WHERE (p_patient_id IS NULL OR patient_id=p_patient_id) AND issued_document_id IS NULL AND ((archived_at IS NOT NULL)=p_archived) ORDER BY updated_at DESC LIMIT 100) d;
 RETURN outrows;
END $$;
CREATE FUNCTION app.save_editable_document_draft(p_id uuid,p_revision integer,p_content text,p_variables text,p_date date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE d app.document_drafts%ROWTYPE;
BEGIN
 SELECT * INTO d FROM app.document_drafts WHERE id=p_id AND practitioner_id=auth.uid() FOR UPDATE;
 IF d.id IS NULL THEN RETURN NULL;END IF;
 IF d.revision<>p_revision THEN RETURN jsonb_build_object('reason','draft-conflict');END IF;
 IF d.issued_document_id IS NOT NULL OR d.archived_at IS NOT NULL THEN RAISE EXCEPTION 'DocumentDraftLocked';END IF;
 PERFORM audit.log_read(d.patient_id,'fiche');
 UPDATE app.document_drafts SET content_json=p_content::jsonb,variables=p_variables::jsonb,document_date=p_date,revision=revision+1,updated_at=now(),preview_snapshot=NULL,preview_revision=NULL WHERE id=d.id RETURNING * INTO d;
 RETURN app.document_draft_row(d);
END $$;
CREATE FUNCTION app.list_document_draft_revisions(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE d app.document_drafts%ROWTYPE; outrows jsonb;
BEGIN SELECT * INTO d FROM app.document_drafts WHERE id=p_id;IF d.id IS NULL THEN RETURN NULL;END IF;PERFORM audit.log_read(d.patient_id,'fiche');
 SELECT COALESCE(jsonb_agg(jsonb_build_object('revision',revision,'content',content_json,'variables',variables,'documentDate',document_date::text,'savedAt',created_at) ORDER BY revision DESC),'[]') INTO outrows FROM app.document_draft_revisions WHERE draft_id=d.id;RETURN outrows;END $$;
CREATE FUNCTION app.archive_editable_document_draft(p_id uuid,p_archived boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE d app.document_drafts%ROWTYPE;
BEGIN SELECT * INTO d FROM app.document_drafts WHERE id=p_id AND practitioner_id=auth.uid() FOR UPDATE;IF d.id IS NULL THEN RETURN NULL;END IF;
 IF d.issued_document_id IS NOT NULL THEN RAISE EXCEPTION 'DocumentDraftLocked';END IF;
 PERFORM audit.log_read(d.patient_id,'fiche');UPDATE app.document_drafts SET archived_at=CASE WHEN p_archived THEN now() ELSE NULL END,updated_at=now() WHERE id=d.id RETURNING * INTO d;RETURN app.document_draft_row(d);END $$;
CREATE FUNCTION app.duplicate_editable_document_draft(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE d app.document_drafts%ROWTYPE; copied app.document_drafts%ROWTYPE;
BEGIN SELECT * INTO d FROM app.document_drafts WHERE id=p_id AND practitioner_id=auth.uid();IF d.id IS NULL THEN RETURN NULL;END IF;PERFORM audit.log_read(d.patient_id,'fiche');
 INSERT INTO app.document_drafts(cabinet_id,practitioner_id,patient_id,doc_type,template_id,template_version,variables,content_json,document_date,source_document_id) VALUES(d.cabinet_id,auth.uid(),d.patient_id,d.doc_type,d.template_id,d.template_version,d.variables,d.content_json,(now() AT TIME ZONE 'Africa/Algiers')::date,d.issued_document_id) RETURNING * INTO copied;RETURN app.document_draft_row(copied);END $$;
-- All newly introduced functions are closed to PUBLIC. Only the named doors are granted.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('check_document_node','validate_document_content','document_text_nodes','document_template_json','document_draft_row','assert_document_draft','track_document_draft_revision','create_editable_document_draft','get_editable_document_draft','list_editable_document_drafts','save_editable_document_draft','list_document_draft_revisions','archive_editable_document_draft','duplicate_editable_document_draft') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO app_gatekeeper',f.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.oid::regprocedure);
  IF f.proname LIKE '%editable_document_draft%' OR f.proname='list_document_draft_revisions' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.oid::regprocedure);END IF;
 END LOOP;
END $$;
CREATE FUNCTION app.assert_document_editor_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF NEW.content_json IS DISTINCT FROM OLD.content_json OR NEW.renderer_version IS DISTINCT FROM OLD.renderer_version OR NEW.page_manifest IS DISTINCT FROM OLD.page_manifest OR NEW.source_draft_id IS DISTINCT FROM OLD.source_draft_id OR NEW.prescription_id IS DISTINCT FROM OLD.prescription_id THEN RAISE EXCEPTION 'DocumentSnapshotLocked';END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION app.assert_document_editor_snapshot() FROM PUBLIC;
CREATE TRIGGER document_editor_snapshot_locked BEFORE UPDATE ON app.documents FOR EACH ROW EXECUTE FUNCTION app.assert_document_editor_snapshot();
INSERT INTO app.schema_migrations(version) VALUES ('129_document_editor_drafts') ON CONFLICT DO NOTHING;
COMMIT;
