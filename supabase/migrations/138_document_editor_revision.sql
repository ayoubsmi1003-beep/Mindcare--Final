BEGIN;
-- Legacy pieces remain immutable. Their explicit new version starts from the
-- current reviewed template and saved fields; no historical HTML is overwritten.
CREATE FUNCTION app.revise_issued_document(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE original app.documents%ROWTYPE; tpl app.document_templates%ROWTYPE; copied app.document_drafts%ROWTYPE;
BEGIN
 SELECT * INTO original FROM app.documents WHERE id=p_id AND practitioner_id=auth.uid();
 IF original.id IS NULL OR NOT COALESCE(app.can_see_clinical(auth.uid()),false) THEN RETURN NULL; END IF;
 PERFORM audit.log_read(original.patient_id,'fiche');
 IF original.source_draft_id IS NOT NULL THEN RETURN app.duplicate_editable_document_draft(original.source_draft_id); END IF;
 SELECT * INTO tpl FROM app.document_templates WHERE cabinet_id=original.cabinet_id AND doc_type=original.doc_type AND is_active ORDER BY version DESC LIMIT 1;
 IF tpl.id IS NULL THEN RAISE EXCEPTION 'DocumentTemplateMissing'; END IF;
 INSERT INTO app.document_drafts(cabinet_id,practitioner_id,patient_id,doc_type,template_id,template_version,variables,content_json,document_date,source_document_id)
 VALUES(original.cabinet_id,auth.uid(),original.patient_id,original.doc_type,tpl.id,tpl.version,original.variables,COALESCE(tpl.content_json,app.document_template_json(tpl.body_html)),(now() AT TIME ZONE 'Africa/Algiers')::date,original.id) RETURNING * INTO copied;
 RETURN app.document_draft_row(copied);
END $$;
ALTER FUNCTION app.revise_issued_document(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.revise_issued_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.revise_issued_document(uuid) TO authenticated;
INSERT INTO app.schema_migrations(version) VALUES ('138_document_editor_revision') ON CONFLICT DO NOTHING;
COMMIT;
