BEGIN;
-- Forward repair found by the first real ordonnance checkpoint: set-returning JSON needs a named value.
DO $fix$
DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('app.document_draft_reasons(app.document_drafts)'::regprocedure);
 definition:=replace(definition,'FROM jsonb_path_query(d.content_json,''strict $.** ? (@.type == "medication")'');','FROM jsonb_path_query(d.content_json,''strict $.** ? (@.type == "medication")'') AS item(value);');
 EXECUTE definition;
END $fix$;
CREATE FUNCTION app.create_ordonnance_template() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,pg_catalog AS $$
BEGIN INSERT INTO app.document_templates(cabinet_id,doc_type,version,title_fr,header_html,body_html,content_json,is_active)
 VALUES(NEW.id,'ordonnance',1,'Ordonnance','','','{"type":"doc","content":[{"type":"paragraph","content":[]}]}',true);RETURN NEW;END $$;
ALTER FUNCTION app.create_ordonnance_template() OWNER TO app_gatekeeper;
GRANT INSERT ON app.document_templates TO app_gatekeeper;
CREATE POLICY document_editor_templates_insert ON app.document_templates FOR INSERT TO app_gatekeeper WITH CHECK(cabinet_id=app.current_cabinet() OR auth.uid() IS NULL);
REVOKE ALL ON FUNCTION app.create_ordonnance_template() FROM PUBLIC;
CREATE TRIGGER document_ordonnance_template AFTER INSERT ON app.cabinets FOR EACH ROW EXECUTE FUNCTION app.create_ordonnance_template();
INSERT INTO app.schema_migrations(version) VALUES ('133_document_editor_validation') ON CONFLICT DO NOTHING;
COMMIT;
