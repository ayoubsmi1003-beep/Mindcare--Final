-- Persist the existing cockpit controls in the existing note JSONB.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE FUNCTION app.get_session_details(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE v_patient uuid; v_result jsonb;
BEGIN
 SELECT c.patient_id INTO v_patient FROM app.consultations c WHERE c.id=p_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM 1 FROM app.get_patient(v_patient);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT n.structured->'sessionDetails' INTO v_result FROM app.clinical_notes n WHERE n.consultation_id=p_id;
 RETURN v_result;
END $$;
ALTER FUNCTION app.get_session_details(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_session_details(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_session_details(uuid) TO authenticated;

CREATE FUNCTION app.save_session_details(p_id uuid,p_details text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE v jsonb:=p_details::jsonb; k text; n uuid;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR v->>'scoreConvention' IS DISTINCT FROM 'difficulty-v1'
 OR jsonb_typeof(v->'focus') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'focus')>20
 OR jsonb_typeof(v->'focusLibre') IS DISTINCT FROM 'string' OR length(v->>'focusLibre')>2000
 OR jsonb_typeof(v->'mesures') IS DISTINCT FROM 'object'
 OR (v-ARRAY['focus','focusLibre','mesures','scoreConvention'])<>'{}'::jsonb
 OR ((v->'mesures')-ARRAY['anxiete','sommeil','humeur'])<>'{}'::jsonb THEN
 RAISE EXCEPTION 'invalid-session-details' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'focus') e WHERE jsonb_typeof(e)<>'string' OR length(e#>>'{}') NOT BETWEEN 1 AND 200) THEN
 RAISE EXCEPTION 'invalid-session-focus' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['anxiete','sommeil','humeur'] LOOP
 IF NOT (v->'mesures' ? k) OR ((v->'mesures'->k)<>'null'::jsonb AND
 (jsonb_typeof(v->'mesures'->k)<>'number' OR (v->'mesures'->>k)::numeric NOT BETWEEN 1 AND 10 OR (v->'mesures'->>k)::numeric<>trunc((v->'mesures'->>k)::numeric))) THEN
 RAISE EXCEPTION 'invalid-session-score' USING ERRCODE='22023'; END IF;
 END LOOP;
 PERFORM 1 FROM app.consultations c WHERE c.id=p_id AND c.status='open' FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 n:=app.save_note(p_id,'{}');
 UPDATE app.clinical_notes SET structured=jsonb_set(coalesce(structured,'{}'::jsonb),'{sessionDetails}',v,true)
 WHERE id=n AND status='draft';
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN v;
END $$;
ALTER FUNCTION app.save_session_details(uuid,text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.save_session_details(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.save_session_details(uuid,text) TO authenticated;

-- Keep the existing audited projections and authority checks, adding one field.
DO $$ DECLARE def text; changed text; BEGIN
 SELECT pg_get_functiondef('app.get_alexa_clinical_context(uuid,integer,timestamptz,uuid)'::regprocedure) INTO def;
 changed:=replace(def,'''rawNotes'', c.raw_notes, ''rawNotesVersion'', v_revision,','''rawNotes'', c.raw_notes, ''rawNotesVersion'', v_revision, ''sessionDetails'', (SELECT n.structured->''sessionDetails'' FROM app.clinical_notes n WHERE n.consultation_id=c.id),');
 IF changed=def THEN RAISE EXCEPTION 'clinical-context-projection-mismatch'; END IF;
 EXECUTE changed;
 SELECT pg_get_functiondef('app.save_session_analysis(uuid,text,text,text,text,text)'::regprocedure) INTO def;
 changed:=replace(def,'IF v_snapshot IS DISTINCT FROM v_etat->''notes_snapshot'' THEN RETURN; END IF;',
 'IF v_etat->''notes_snapshot'' ? ''sessionDetails'' THEN
 v_snapshot:=v_snapshot || jsonb_build_object(''sessionDetails'',(SELECT n.structured->''sessionDetails'' FROM app.clinical_notes n WHERE n.consultation_id=p_consultation_id)); END IF;
 IF v_snapshot IS DISTINCT FROM v_etat->''notes_snapshot'' THEN RETURN; END IF;');
 IF changed=def THEN RAISE EXCEPTION 'session-source-guard-mismatch'; END IF;
 changed:=replace(changed,'-- The source comparison and derived write share this transaction and locks.',
 'IF v_etat ? ''source_revision'' AND (app.get_alexa_clinical_context(v_patient,1,NULL,NULL)->>''sourceRevision'') IS DISTINCT FROM v_etat->>''source_revision'' THEN RETURN; END IF;
 -- The source comparison and derived write share this transaction and locks.');
 EXECUTE changed;
END $$;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES ('171_session_details') ON CONFLICT DO NOTHING;
COMMIT;
