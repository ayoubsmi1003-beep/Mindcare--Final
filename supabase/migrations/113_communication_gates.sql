-- ═══════════════════════════════════════════════════════════════════════════
-- 113_communication_gates — templates, connexions, actions, lectures.
-- Complète 112 (tables déjà créées, jamais retouchées ici sauf index/NTFY).
--
-- Rappel : aucune donnée patient fictive (règle 8) — les templates sont des
-- gabarits vides à renseigner en exploitation et à faire approuver par Meta.
-- Les charges JSON transitent en `text` (motif `update_appointment` : les
-- arguments RPC ne portent que des scalaires, cf. `frontiere.ts`).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Crée ou met à jour un gabarit. Un corps modifié repasse en `brouillon` :
-- un template approuvé par Meta ne change jamais silencieusement.
CREATE OR REPLACE FUNCTION app.comm_upsert_template(
    p_canal text,
    p_nom text,
    p_langue text,
    p_corps text)
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
  IF p_langue NOT IN ('fr', 'ar', 'darija', 'mixte') THEN
    RAISE EXCEPTION 'Langue inconnue.';
  END IF;
  IF p_nom IS NULL OR btrim(p_nom) = '' THEN
    RAISE EXCEPTION 'Nom de gabarit vide.';
  END IF;
  IF p_corps IS NULL OR char_length(btrim(p_corps)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Corps de gabarit invalide.';
  END IF;
  INSERT INTO app.message_templates (cabinet_id, canal, nom, langue, corps, statut)
  VALUES (app.current_cabinet(), p_canal, btrim(p_nom), p_langue, btrim(p_corps), 'brouillon')
  ON CONFLICT (cabinet_id, canal, nom)
  DO UPDATE SET langue = EXCLUDED.langue,
                corps = EXCLUDED.corps,
                statut = 'brouillon',
                is_active = true
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Déclare le statut d'une connexion externe (statut + capacités, JAMAIS de
-- secret : le token vit dans l'environnement serveur, règle 2).
CREATE OR REPLACE FUNCTION app.comm_set_connection(
    p_canal text,
    p_statut text,
    p_capacites text DEFAULT '{}')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_caps jsonb;
BEGIN
  IF p_canal NOT IN ('whatsapp', 'instagram', 'facebook') THEN
    RAISE EXCEPTION 'Canal inconnu.';
  END IF;
  IF p_statut NOT IN ('connecte', 'non_connecte', 'erreur') THEN
    RAISE EXCEPTION 'Statut de connexion inconnu.';
  END IF;
  BEGIN
    v_caps := p_capacites::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Capacités illisibles.';
  END;
  IF jsonb_typeof(v_caps) <> 'object' THEN
    RAISE EXCEPTION 'Capacités illisibles.';
  END IF;
  INSERT INTO app.external_connections (cabinet_id, canal, statut, capacites, updated_at)
  VALUES (app.current_cabinet(), p_canal, p_statut, v_caps, now())
  ON CONFLICT (cabinet_id, canal)
  DO UPDATE SET statut = EXCLUDED.statut,
                capacites = EXCLUDED.capacites,
                updated_at = now();
  RETURN true;
END;
$$;

-- Lit le statut d'une connexion (en-tête seul, aucun secret — il n'y en a pas).
CREATE OR REPLACE FUNCTION app.comm_connection_status(p_canal text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'canal',     c.canal,
              'statut',    c.statut,
              'capacites', c.capacites)
            ORDER BY c.canal), '[]'::jsonb)
    FROM (
      SELECT * FROM app.external_connections
       WHERE cabinet_id = app.current_cabinet()
         AND (p_canal IS NULL OR canal = p_canal)
    ) c;
$$;

-- Enregistre une action à effet externe à l'état `propose` (jamais exécutée
-- ici). La charge voyage sérialisée ; elle ne porte jamais de PII — garde
-- applicative + `classerCharge` à l'envoi, la base ne fait que la stocker.
CREATE OR REPLACE FUNCTION app.comm_log_action(
    p_type text,
    p_charge text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_charge jsonb;
  v_id uuid;
BEGIN
  IF p_type NOT IN ('envoi_masse', 'publication', 'envoi_individuel') THEN
    RAISE EXCEPTION 'Type d''action inconnu.';
  END IF;
  BEGIN
    v_charge := p_charge::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Charge illisible.';
  END;
  IF jsonb_typeof(v_charge) <> 'object' THEN
    RAISE EXCEPTION 'Charge illisible.';
  END IF;
  INSERT INTO app.communication_actions (cabinet_id, type, charge)
  VALUES (app.current_cabinet(), p_type, v_charge)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Confirme une action proposée : pose `confirmed_at` AVANT toute exécution
-- (règle 7). Seul `propose` → `confirme` ; le reste est refusé nommément.
CREATE OR REPLACE FUNCTION app.comm_confirm_action(p_action_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_statut text;
BEGIN
  SELECT a.statut INTO v_statut
    FROM app.communication_actions a
   WHERE a.id = p_action_id
     AND a.cabinet_id = app.current_cabinet()
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_statut <> 'propose' THEN
    RAISE EXCEPTION 'Action non proposée.';
  END IF;
  UPDATE app.communication_actions
     SET statut = 'confirme', confirmed_at = now(), confirmed_by = auth.uid()
   WHERE id = p_action_id;
  RETURN true;
END;
$$;

-- Liste les conversations du cabinet (en-têtes + prospect, jamais de contenu
-- clinique au-delà du dernier message déjà visible à l'écran d'accueil).
CREATE OR REPLACE FUNCTION app.comm_list_conversations(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id',          c.id,
              'canal',       c.canal,
              'etatHandoff', c.etat_handoff,
              'patientId',   c.patient_id,
              'dernierMessageA', c.last_message_at,
              'clotureA',    c.closed_at)
            ORDER BY c.last_message_at DESC), '[]'::jsonb)
    FROM (
      SELECT * FROM app.communication_conversations
       WHERE cabinet_id = app.current_cabinet()
       ORDER BY last_message_at DESC
       LIMIT least(greatest(COALESCE(p_limit, 50), 1), 200)
    ) c;
$$;

-- Historique d'une conversation (le périmètre cabinet est revérifié : pas
-- d'oracle entre « introuvable » et « hors périmètre », tableau vide).
CREATE OR REPLACE FUNCTION app.comm_list_messages(
    p_conversation_id uuid,
    p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id',        m.id,
              'direction', m.direction,
              'etat',      m.etat,
              'contenu',   m.contenu,
              'langue',    m.langue,
              'creeA',     m.created_at)
            ORDER BY m.created_at), '[]'::jsonb)
    FROM (
      SELECT * FROM app.communication_messages
       WHERE conversation_id = p_conversation_id
         AND EXISTS (SELECT 1 FROM app.communication_conversations c
                      WHERE c.id = p_conversation_id
                        AND c.cabinet_id = app.current_cabinet())
       ORDER BY created_at DESC
       LIMIT least(greatest(COALESCE(p_limit, 100), 1), 500)
    ) m;
$$;

-- Lit le consentement d'un patient pour un canal (false par défaut : pas de
-- consentement = pas d'envoi, fail-closed).
CREATE OR REPLACE FUNCTION app.comm_get_consent(
    p_patient_id uuid,
    p_canal text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
  SELECT COALESCE((
      SELECT s.consentement FROM app.communication_consents s
       WHERE s.cabinet_id = app.current_cabinet()
         AND s.patient_id = p_patient_id
         AND s.canal = p_canal), false);
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Droits des portes
-- ───────────────────────────────────────────────────────────────────────────
ALTER FUNCTION app.comm_upsert_template(text, text, text, text) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_set_connection(text, text, text) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_connection_status(text) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_log_action(text, text) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_confirm_action(uuid) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_list_conversations(integer) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_list_messages(uuid, integer) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_get_consent(uuid, text) OWNER TO app_gatekeeper;

REVOKE ALL ON FUNCTION app.comm_upsert_template(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_set_connection(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_connection_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_log_action(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_confirm_action(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_list_conversations(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_list_messages(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_get_consent(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.comm_upsert_template(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_set_connection(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_connection_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_log_action(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_confirm_action(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_list_conversations(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_list_messages(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_get_consent(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('113_communication_gates')
    ON CONFLICT DO NOTHING;

COMMIT;
