-- Share the authoritative freshness gate with whole-case clinical reads.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
DO $$ DECLARE original text; changed text; BEGIN
 SELECT pg_get_functiondef('app.get_alexa_clinical_context(uuid,integer,timestamptz,uuid)'::regprocedure) INTO original;
 changed:=replace(original,
  'FROM app.consultation_analyses a WHERE a.consultation_id = c.id',
  'FROM app.get_consultation_analysis(c.id) a WHERE a.consultation_id = c.id');
 IF changed=original THEN RAISE EXCEPTION 'clinical-analysis-projection-contract-mismatch'; END IF;
 EXECUTE changed;
END $$;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES('177_clinical_analysis_freshness') ON CONFLICT DO NOTHING;
COMMIT;
