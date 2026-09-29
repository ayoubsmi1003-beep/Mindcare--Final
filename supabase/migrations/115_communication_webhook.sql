-- 115_communication_webhook — routage entrant et déduplication provider.
--
-- L'ingestion webhook doit retrouver LA conversation ouverte du même contact
-- (même canal + même identifiant externe) au lieu d'en ouvrir une par
-- message, et ignorer les rejeux provider. Deux portes + une lecture de
-- routage pour l'envoi (destinataire + patient, sans contenu clinique).
-- Même discipline que 112/113 : DEFINER, périmètre cabinet, trg_audit.

BEGIN;

-- Retrouve la conversation ouverte (même canal + identifiant, non clôturée)
-- ou l'ouvre (prospect, patient NULL). Verrou : sérialise les doubles
-- événements concurrents du même contact.
CREATE OR REPLACE FUNCTION app.comm_trouver_ou_creer_conversation(
    p_canal text,
    p_identifiant_externe text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_canal NOT IN ('whatsapp', 'instagram', 'facebook') THEN
    RAISE EXCEPTION 'Canal inconnu.';
  END IF;
  IF p_identifiant_externe IS NULL OR btrim(p_identifiant_externe) = '' THEN
    RAISE EXCEPTION 'Identifiant externe vide.';
  END IF;
  SELECT c.id INTO v_id
    FROM app.communication_conversations c
   WHERE c.cabinet_id = app.current_cabinet()
     AND c.canal = p_canal
     AND c.identifiant_externe = btrim(p_identifiant_externe)
     AND c.closed_at IS NULL
   ORDER BY c.last_message_at DESC
   LIMIT 1
     FOR UPDATE;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  INSERT INTO app.communication_conversations (cabinet_id, canal, identifiant_externe)
  VALUES (app.current_cabinet(), p_canal, btrim(p_identifiant_externe))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Le provider a-t-il déjà été vu ? (rejeu webhook → ignorer, pas d'oracle :
-- false couvre aussi le hors-périmètre, la table ne porte que des métadonnées).
CREATE OR REPLACE FUNCTION app.comm_ref_existe(p_provider_message_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
  SELECT EXISTS (SELECT 1 FROM app.external_message_refs r
                 WHERE r.provider_message_id = p_provider_message_id);
$$;

-- Attache la référence provider au message local. Déjà vue → false.
CREATE OR REPLACE FUNCTION app.comm_ajouter_ref_externe(
    p_message_id uuid,
    p_provider text,
    p_provider_message_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_row uuid;
BEGIN
  IF p_provider NOT IN ('composio', 'meta_direct') THEN
    RAISE EXCEPTION 'Fournisseur inconnu.';
  END IF;
  IF p_provider_message_id IS NULL OR btrim(p_provider_message_id) = '' THEN
    RAISE EXCEPTION 'Référence externe vide.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.communication_messages m
                  JOIN app.communication_conversations c ON c.id = m.conversation_id
                 WHERE m.id = p_message_id
                   AND c.cabinet_id = app.current_cabinet()) THEN
    RETURN false;
  END IF;
  INSERT INTO app.external_message_refs (message_id, provider, provider_message_id)
  VALUES (p_message_id, p_provider, btrim(p_provider_message_id))
  ON CONFLICT (provider_message_id) DO NOTHING
  RETURNING id INTO v_row;
  RETURN v_row IS NOT NULL;
END;
$$;

-- Routage d'envoi : canal + destinataire + patient lié (en-têtes seuls, le
-- contenu voyage par `comm_list_messages`). Introuvable/hors périmètre : NULL.
CREATE OR REPLACE FUNCTION app.comm_conversation_routage(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
  SELECT jsonb_build_object(
              'canal', c.canal,
              'destinataire', c.identifiant_externe,
              'patientId', c.patient_id,
              'etatHandoff', c.etat_handoff)
    FROM app.communication_conversations c
   WHERE c.id = p_conversation_id
     AND c.cabinet_id = app.current_cabinet();
$$;

ALTER FUNCTION app.comm_trouver_ou_creer_conversation(text, text) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_ref_existe(text) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_ajouter_ref_externe(uuid, text, text) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_conversation_routage(uuid) OWNER TO app_gatekeeper;

REVOKE ALL ON FUNCTION app.comm_trouver_ou_creer_conversation(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_ref_existe(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_ajouter_ref_externe(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_conversation_routage(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.comm_trouver_ou_creer_conversation(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_ref_existe(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_ajouter_ref_externe(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_conversation_routage(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('115_communication_webhook')
    ON CONFLICT DO NOTHING;

COMMIT;
