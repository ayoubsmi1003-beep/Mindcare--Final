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
  IF j.id IS NULL THEN RETURN jsonb_build_object('state',CASE WHEN h.created_at<now()-interval '2 minutes' THEN 'interrupted' ELSE 'pending' END); END IF;
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
 IF NOT EXISTS(SELECT 1 FROM app.jarvis_conversations WHERE id=p_conversation_id AND utilisateur_id=auth.uid()) THEN RETURN NULL; END IF;
 SELECT j.outil->'task' INTO v FROM app.jarvis_messages j JOIN app.jarvis_messages h ON h.client_turn_id=j.client_turn_id AND h.role='humain'
 WHERE j.conversation_id=p_conversation_id AND j.role='jarvis' AND j.created_at>now()-interval '15 minutes' AND (h.outil=p_context::jsonb OR ((j.outil->'task'->>'patientId') IS NOT DISTINCT FROM (p_context::jsonb->>'patientId') AND j.outil->'task'->>'page'=p_context::jsonb->>'page'))
 ORDER BY j.rang DESC LIMIT 1;
 RETURN v;
END $$;
ALTER FUNCTION app.get_alexa_task_context(uuid,text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_alexa_task_context(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_alexa_task_context(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION app.propose_jarvis_action(p_conversation_id uuid,p_user_utterance text,p_tool_name text,p_tool_args jsonb,p_action_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=app,pg_catalog AS $$
DECLARE a app.jarvis_actions%ROWTYPE;
BEGIN
 IF p_action_id IS NULL OR p_tool_name NOT IN ('create_appointment','reschedule_appointment','cancel_appointment','mark_patient_arrived','set_consultation_price','record_payment_collected','create_document_draft','create_editable_document_draft')
 OR length(p_user_utterance) NOT BETWEEN 1 AND 4000 OR jsonb_typeof(p_tool_args)<>'object' THEN RAISE EXCEPTION 'Invalid proposal' USING ERRCODE='22023'; END IF;
 -- Conversation access is checked by the existing authenticated history door.
 IF app.alexa_owns_conversation(p_conversation_id) IS NOT TRUE THEN RETURN NULL; END IF;
 INSERT INTO app.jarvis_actions(id,cabinet_id,actor_id,conversation_id,user_utterance,tool_name,tool_args)
 VALUES(p_action_id,app.current_cabinet(),auth.uid(),p_conversation_id,p_user_utterance,p_tool_name,p_tool_args) ON CONFLICT(id) DO NOTHING;
 SELECT * INTO a FROM app.jarvis_actions WHERE id=p_action_id;
 IF a.actor_id IS DISTINCT FROM auth.uid() OR a.conversation_id IS DISTINCT FROM p_conversation_id OR a.tool_name IS DISTINCT FROM p_tool_name OR a.tool_args IS DISTINCT FROM p_tool_args THEN RAISE EXCEPTION 'Proposal conflict' USING ERRCODE='22023'; END IF;
 RETURN a.id;
END $$;
ALTER FUNCTION app.propose_jarvis_action(uuid,text,text,jsonb,uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.propose_jarvis_action(uuid,text,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.propose_jarvis_action(uuid,text,text,jsonb,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION app.alexa_owns_conversation(p_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=app,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.jarvis_conversations WHERE id=p_id AND utilisateur_id=auth.uid() AND cabinet_id=app.current_cabinet());
$$;
ALTER FUNCTION app.alexa_owns_conversation(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.alexa_owns_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.alexa_owns_conversation(uuid) TO authenticated;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE OR REPLACE FUNCTION app.get_alexa_speech_admission(p_text text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=app,pg_catalog AS $$
 SELECT length(p_text) BETWEEN 1 AND 2000 AND EXISTS(SELECT 1 FROM app.jarvis_messages j JOIN app.jarvis_conversations c ON c.id=j.conversation_id
 WHERE c.utilisateur_id=auth.uid() AND c.cabinet_id=app.current_cabinet() AND j.role='jarvis' AND j.created_at>now()-interval '15 minutes'
 AND position(p_text IN j.contenu)>0 AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(j.outil->'events','[]')) e WHERE e->>'type'='done' AND e->>'speechAllowed'='true'));
$$;
ALTER FUNCTION app.get_alexa_speech_admission(text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_alexa_speech_admission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_alexa_speech_admission(text) TO authenticated;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE OR REPLACE FUNCTION app.get_alexa_action_outcome(p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=app,pg_catalog AS $$
 SELECT jsonb_build_object('state',a.state,'tool',a.tool_name,'affectedId',a.affected_id)
 FROM app.jarvis_actions a WHERE a.id=p_id AND a.actor_id=auth.uid() AND a.cabinet_id=app.current_cabinet()
 AND app.alexa_owns_conversation(a.conversation_id);
$$;
ALTER FUNCTION app.get_alexa_action_outcome(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_alexa_action_outcome(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_alexa_action_outcome(uuid) TO authenticated;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES('159_alexa_turn_lifecycle') ON CONFLICT DO NOTHING;
COMMIT;
