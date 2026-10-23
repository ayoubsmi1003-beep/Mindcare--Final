BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
DO $$ DECLARE original text; changed text; BEGIN
 SELECT pg_get_functiondef('app.save_session_analysis(uuid,text,text,text,text,text)'::regprocedure) INTO original;
 changed:=replace(original,'AND v_existante.prompt_hash = p_prompt_hash','AND v_existante.prompt_hash = p_prompt_hash AND v_existante.model = p_model');
 IF changed=original THEN RAISE EXCEPTION 'analysis-model-contract-mismatch'; END IF;
 EXECUTE changed;
 SELECT pg_get_functiondef('app.get_alexa_clinical_context(uuid,integer,timestamptz,uuid)'::regprocedure) INTO original;
 changed:=replace(original,'''id'', a.id, ''version'', a.version, ''content'', a.content','''id'', a.id, ''version'', a.version, ''content'', a.content, ''model'', a.model, ''promptHash'', a.prompt_hash');
 IF changed=original THEN RAISE EXCEPTION 'analysis-provenance-contract-mismatch'; END IF;
 EXECUTE changed;
END $$;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES ('173_summary_model_provenance') ON CONFLICT DO NOTHING;
COMMIT;
