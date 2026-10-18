-- 163: six-minute bounded native request plus one-minute persistence/replay grace.
-- Additive replacement only; applied159 stays immutable. No new storage or permissions.
-- Reuse existing messages/actions for replay and task context; no new storage.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE OR REPLACE FUNCTION app.claim_alexa_turn(p_conversation_id uuid,p_client_turn_id uuid,p_demande text,p_context text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,pg_catalog AS $$
DECLARE c uuid; h app.jarvis_messages%ROWTYPE; j app.jarvis_messages%ROWTYPE; ctx jsonb;
BEGIN
 IF length(p_demande) NOT BETWEEN 1 AND 4000 OR length(p_context)>500 OR jsonb_typeof(p_context::jsonb)<>'object' THEN RAISE EXCEPTION 'Invalid turn' USING ERRCODE='22023'; END IF;
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

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES('163_alexa_slow_turn_lease') ON CONFLICT DO NOTHING;
COMMIT;
