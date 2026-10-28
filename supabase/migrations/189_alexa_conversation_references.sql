-- Keep verified Alexa follow-up scope in the existing authenticated turn metadata.
-- Exact app context equality invalidates references after patient/document/revision changes.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE OR REPLACE FUNCTION app.claim_alexa_turn(p_conversation_id uuid,p_client_turn_id uuid,p_demande text,p_context text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,pg_catalog AS $$
DECLARE c uuid; h app.jarvis_messages%ROWTYPE; j app.jarvis_messages%ROWTYPE; ctx jsonb;
BEGIN
 IF length(p_demande) NOT BETWEEN 1 AND 4000 OR length(p_context)>1000 OR jsonb_typeof(p_context::jsonb)<>'object' THEN RAISE EXCEPTION 'Invalid turn' USING ERRCODE='22023'; END IF;
 ctx:=p_context::jsonb;
 SELECT id INTO c FROM app.jarvis_conversations WHERE id=p_conversation_id AND utilisateur_id=auth.uid() FOR UPDATE;
 IF c IS NULL THEN RETURN jsonb_build_object('state','unavailable'); END IF;
 SELECT * INTO h FROM app.jarvis_messages WHERE client_turn_id=p_client_turn_id AND role='humain';
 IF h.id IS NOT NULL THEN
  IF h.conversation_id<>c OR h.contenu<>p_demande OR h.outil IS DISTINCT FROM ctx THEN RETURN jsonb_build_object('state','conflict'); END IF;
  SELECT * INTO j FROM app.jarvis_messages WHERE conversation_id=c AND client_turn_id=p_client_turn_id AND role='jarvis';
  IF j.id IS NULL THEN RETURN jsonb_build_object('state',CASE WHEN h.created_at<now()-interval '7 minutes' THEN 'interrupted' ELSE 'pending' END); END IF;
  RETURN jsonb_build_object('state','replay','answer',j.contenu,'metadata',j.outil);
 END IF;
 INSERT INTO app.jarvis_messages(conversation_id,client_turn_id,role,contenu,outil) VALUES(c,p_client_turn_id,'humain',p_demande,ctx);
 UPDATE app.jarvis_conversations SET last_message_at=now() WHERE id=c;
 RETURN jsonb_build_object('state','claimed');
END $$;

ALTER FUNCTION app.claim_alexa_turn(uuid,uuid,text,text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.claim_alexa_turn(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_alexa_turn(uuid,uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION app.get_alexa_task_context(p_conversation_id uuid,p_context text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,pg_catalog AS $$
DECLARE v jsonb;
BEGIN
 IF length(p_context)>1000 OR jsonb_typeof(p_context::jsonb)<>'object' THEN
  RAISE EXCEPTION 'Invalid context' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM app.jarvis_conversations WHERE id=p_conversation_id AND utilisateur_id=auth.uid()) THEN RETURN NULL; END IF;
 SELECT j.outil INTO v
 FROM app.jarvis_messages j
 JOIN app.jarvis_messages h ON h.client_turn_id=j.client_turn_id AND h.role='humain'
 WHERE j.conversation_id=p_conversation_id AND j.role='jarvis'
  AND j.created_at>now()-interval '15 minutes'
  AND (
   h.outil=p_context::jsonb
   OR (
    (
     h.outil->>'page' IS NOT DISTINCT FROM p_context::jsonb->>'page'
     OR h.outil->>'documentId' IS NOT NULL
     OR h.outil->>'draftId' IS NOT NULL
     OR h.outil->>'consultationId' IS NOT NULL
     OR (p_context::jsonb->>'patientId' IS NOT NULL AND j.outil->'reference'->>'selectedPatientId'=p_context::jsonb->>'patientId')
    )
    AND
    h.outil->>'consultationId' IS NOT DISTINCT FROM p_context::jsonb->>'consultationId'
    AND h.outil->>'documentId' IS NOT DISTINCT FROM p_context::jsonb->>'documentId'
    AND h.outil->>'draftId' IS NOT DISTINCT FROM p_context::jsonb->>'draftId'
    AND h.outil->>'documentRevision' IS NOT DISTINCT FROM p_context::jsonb->>'documentRevision'
    AND (
     h.outil->>'patientId' IS NOT DISTINCT FROM p_context::jsonb->>'patientId'
     OR j.outil->'reference'->>'selectedPatientId' IS NOT DISTINCT FROM p_context::jsonb->>'patientId'
    )
   )
  )
 ORDER BY j.rang DESC LIMIT 1;
 RETURN v;
END $$;

ALTER FUNCTION app.get_alexa_task_context(uuid,text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_alexa_task_context(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_alexa_task_context(uuid,text) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES('189_alexa_conversation_references') ON CONFLICT DO NOTHING;
COMMIT;
