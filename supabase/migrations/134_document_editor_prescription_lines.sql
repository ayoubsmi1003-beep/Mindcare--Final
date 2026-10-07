BEGIN;
DO $fix$
DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('app.link_document_prescription()'::regprocedure);
 definition:=replace(definition,'position,is_synthetic,document_medication','position,document_medication');
 definition:=replace(definition,'position,NEW.is_synthetic,attrs','position,attrs');
 EXECUTE definition;
END $fix$;
INSERT INTO app.schema_migrations(version) VALUES ('134_document_editor_prescription_lines') ON CONFLICT DO NOTHING;
COMMIT;
