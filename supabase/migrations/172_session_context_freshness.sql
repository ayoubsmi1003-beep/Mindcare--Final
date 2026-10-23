BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
DO $$ DECLARE original text; changed text; BEGIN
 SELECT pg_get_functiondef('app.save_session_analysis(uuid,text,text,text,text,text)'::regprocedure) INTO original;
 changed:=replace(original,
 'AND v_existante.source_state ->> ''notes_digest'' IS NOT DISTINCT FROM v_etat ->> ''notes_digest''',
 'AND v_existante.source_state ->> ''notes_digest'' IS NOT DISTINCT FROM v_etat ->> ''notes_digest''
 AND v_existante.source_state ->> ''context_digest'' IS NOT DISTINCT FROM v_etat ->> ''context_digest''');
 IF changed=original THEN RAISE EXCEPTION 'session-idempotency-contract-mismatch'; END IF;
 EXECUTE changed;
 SELECT pg_get_functiondef('app.get_alexa_clinical_context(uuid,integer,timestamptz,uuid)'::regprocedure) INTO original;
 changed:=replace(original,
 'WHERE a.consultation_id = c.id',
 'WHERE a.consultation_id = c.id
 AND a.generated_at >= coalesce((SELECT max(t.updated_at) FROM app.patient_treatments t WHERE t.patient_id=p_patient_id),''-infinity''::timestamptz)
 AND a.generated_at >= coalesce((SELECT max(n.updated_at) FROM app.clinical_notes n WHERE n.patient_id=p_patient_id),''-infinity''::timestamptz)');
 IF changed=original THEN RAISE EXCEPTION 'clinical-analysis-freshness-contract-mismatch'; END IF;
 EXECUTE changed;
END $$;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES ('172_session_context_freshness') ON CONFLICT DO NOTHING;
COMMIT;
