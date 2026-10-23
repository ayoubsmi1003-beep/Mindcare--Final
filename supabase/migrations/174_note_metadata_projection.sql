-- Evaluation provenance remains stored internally, outside clinical note text.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
DO $$ DECLARE original text; changed text; BEGIN
 SELECT pg_get_functiondef('app.query_alexa_note_sections(text,timestamptz)'::regprocedure) INTO original;
 changed:=replace(original,'n.structured::text','(n.structured - ''evaluation'')::text');
 IF changed=original THEN RAISE EXCEPTION 'structured-note-projection-contract-mismatch'; END IF;
 EXECUTE changed;
END $$;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES ('174_note_metadata_projection') ON CONFLICT DO NOTHING;
COMMIT;
