-- Resume the caller's most recently used conversation after reload.
-- Same actor filter, security-definer boundary, bounded messages and existing grants.
-- No table, column or enum change.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE OR REPLACE FUNCTION app.get_jarvis_history(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_conv uuid;
  v_msgs jsonb;
BEGIN
  SELECT c.id INTO v_conv
    FROM app.jarvis_conversations c
   WHERE c.utilisateur_id = auth.uid()
   ORDER BY c.last_message_at DESC, c.started_at DESC, c.id DESC
   LIMIT 1;

  IF v_conv IS NULL THEN
    RETURN jsonb_build_object(
      'contrat', '1',
      'conversationId', NULL,
      'messages', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'rang',         m.rang,
               'clientTurnId', m.client_turn_id,
               'role',         m.role,
               'chemin',       m.chemin,
               'registre',     m.registre,
               'contenu',      m.contenu,
               'outil',        m.outil,
               'statut',       m.statut,
               'createdAt',    m.created_at)
             ORDER BY m.rang ASC), '[]'::jsonb)
    INTO v_msgs
    FROM (
      SELECT * FROM app.jarvis_messages
       WHERE conversation_id = v_conv
       ORDER BY rang DESC
       LIMIT least(greatest(COALESCE(p_limit, 200), 1), 500)
    ) m;

  RETURN jsonb_build_object(
    'contrat', '1',
    'conversationId', v_conv,
    'messages', v_msgs);
END;
$$;
ALTER FUNCTION app.get_jarvis_history(integer) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_jarvis_history(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_jarvis_history(integer) TO authenticated;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES('166_alexa_history_activity') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
