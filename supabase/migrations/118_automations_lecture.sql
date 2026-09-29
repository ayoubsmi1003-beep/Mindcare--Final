-- 118_automations_lecture — conversations en attente de réponse.
--
-- L'automation « sans réponse » a besoin de savoir quelles conversations
-- dorment : dernier message ENTRANT plus vieux que le seuil, toujours en
-- `AI_HANDLING`. Ne rend que des identifiants (jamais de contenu) : le
-- contenu se lit ensuite par `comm_list_messages`, porte dédiée.
-- INVOKER comme les autres lectures : la RLS décide.

BEGIN;

CREATE OR REPLACE FUNCTION app.comm_conversations_en_attente(p_seuil_minutes integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
  WITH dernier AS (
    SELECT DISTINCT ON (m.conversation_id)
           m.conversation_id, m.direction, m.created_at
      FROM app.communication_messages m
     ORDER BY m.conversation_id, m.created_at DESC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'conversationId', c.id,
              'canal', c.canal,
              'dernierMessageA', d.created_at)
            ORDER BY d.created_at), '[]'::jsonb)
    FROM app.communication_conversations c
    JOIN dernier d ON d.conversation_id = c.id
   WHERE c.cabinet_id = app.current_cabinet()
     AND c.closed_at IS NULL
     AND c.etat_handoff = 'AI_HANDLING'
     AND d.direction = 'entrant'
     AND d.created_at < now() - make_interval(mins => greatest(COALESCE(p_seuil_minutes, 60), 5));
$$;

ALTER FUNCTION app.comm_conversations_en_attente(integer) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.comm_conversations_en_attente(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.comm_conversations_en_attente(integer) TO authenticated;

COMMENT ON FUNCTION app.comm_conversations_en_attente(integer) IS
  'Automation sans-réponse : conversations AI_HANDLING dont le dernier message '
  'entrant dépasse le seuil (5 min minimum). Identifiants seuls.';

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('118_automations_lecture')
    ON CONFLICT DO NOTHING;

COMMIT;
