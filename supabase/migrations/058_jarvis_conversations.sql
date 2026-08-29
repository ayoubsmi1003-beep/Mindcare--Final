-- ═══════════════════════════════════════════════════════════════════════════
-- 058_jarvis_conversations — la persistance des conversations Jarvis.
-- Session V-JARVIS-CORE. Autorisée explicitement par la praticienne
-- (règle 9 : décision de schéma demandée et accordée avant écriture).
--
-- ═══ CE QUE CES TABLES NE SONT PAS ═══
-- Elles ne portent AUCUNE donnée clinique structurée : ni patient_id, ni
-- référence de dossier, ni lien vers diagnoses/prescriptions/consultations.
-- Le texte qu'elles stockent est celui que l'utilisatrice tape et lit déjà à
-- l'écran — même classe que `demande_utilisateur` dans jarvis_actions (012),
-- qui est le précédent assumé. Le contexte patient actif reste un état
-- d'INTERFACE éphémère (patient-actif.ts) : il n'entre pas ici.
--
-- ═══ IDEMPOTENCE — LA GARANTIE CENTRALE ═══
-- Chaque tour logique porte un `client_turn_id` généré par le client AVANT
-- l'envoi. La contrainte UNIQUE(client_turn_id, role) rend impossible le
-- doublon par rejeu : double-clic, relance réseau, rechargement pendant une
-- génération, réessai après coupure. Les portes insèrent en
-- ON CONFLICT DO NOTHING et rendent false quand le tour existait déjà — un
-- rejeu fidèle ne produit ni erreur ni seconde ligne.
--
-- ═══ AJOUT-SEUL ═══
-- Les messages ne reçoivent ni UPDATE ni DELETE, de personne : corriger ou
-- effacer une phrase passée d'une conversation n'est pas une opération du
-- produit. La clôture d'une conversation est représentée par closed_at
-- (contrat verrouillé V-JARVIS-CORE) ; aucune porte ne la pose encore —
-- la colonne existe pour que ce jour-là n'exige pas de nouvelle migration.
-- La mise à jour de last_message_at est faite PAR LES PORTES, jamais par un
-- chemin applicatif.
--
-- ═══ SÉCURITÉ — LE MÊME DISCIPLINE QUE 053 ═══
-- · RLS ENABLE + FORCE sur les deux tables ; policy unique :
--   le PROPRIÉTAIRE de la conversation, et lui seul. Une conversation est un
--   carnet personnel : aucun partage entre praticiennes, aucune visibilité
--   owner-sur-autrui, aucune policy assistante distincte (l'assistante qui
--   parle à Jarvis possède SA conversation, exactement comme sa boîte de
--   notifications).
-- · SELECT/INSERT/UPDATE directs révoqués à authenticated ET service_role :
--   tout passe par les quatre portes, qui tracent via trg_audit (013) dans la
--   même transaction (règle 5).
-- · ⚠️ audit.track() (013) caste `id` en uuid : les messages portent donc un
--   `id uuid` ET une colonne `rang bigint` séparée, qui sert seule au
--   keyset (ordre fiable au sein d'une conversation).
--
-- Retour arrière (documentation, jamais exécuté automatiquement) :
--   DROP FUNCTION start_jarvis_conversation/append_jarvis_turn/
--                 complete_jarvis_turn/get_jarvis_history(integer) ;
--   DROP TABLE jarvis_messages, jarvis_conversations ;
--   retrait des triggers trg_audit. Opération humaine seulement.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ───────────────────────────────────────────────────────────────────────────
-- 1 · Les tables
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.jarvis_conversations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id      uuid NOT NULL REFERENCES app.cabinets(id),
    utilisateur_id  uuid NOT NULL REFERENCES app.profiles(id),
    started_at      timestamptz NOT NULL DEFAULT now(),
    last_message_at timestamptz NOT NULL DEFAULT now(),
    closed_at       timestamptz
);

CREATE TABLE IF NOT EXISTS app.jarvis_messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Ordre fiable au sein d'une conversation (keyset). Séparé de `id`
    -- volontairement : audit.track() lit `->>'id'::uuid`.
    rang            bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
    conversation_id uuid NOT NULL REFERENCES app.jarvis_conversations(id),
    client_turn_id  uuid NOT NULL,
    role            text NOT NULL CHECK (role IN ('humain','jarvis')),
    -- Chemin d'ADR-023, renseigné sur les seules réponses Jarvis.
    chemin          text CHECK (chemin IS NULL OR chemin IN ('connaissance','patient','refus')),
    registre        text,
    -- Demande ≤ 2000 caractères côté passerelle ; réponse plafonnée large
    -- (MAX_OUTPUT_TOKENS). Les bornes DURES restent côté passerelle : la base
    -- ne fait qu'empêcher l'absurde.
    contenu         text NOT NULL CHECK (char_length(btrim(contenu)) BETWEEN 1 AND 12000),
    -- Proposition d'outil telle que validée puis affichée (jamais exécutée
    -- ici). Objet ou null, jamais autre chose.
    outil           jsonb CHECK (outil IS NULL OR jsonb_typeof(outil) = 'object'),
    statut          text NOT NULL DEFAULT 'complet'
                        CHECK (statut IN ('complet','interrompu')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (client_turn_id, role)
);

CREATE INDEX IF NOT EXISTS jarvis_conversations_utilisateur
    ON app.jarvis_conversations (utilisateur_id, started_at DESC);
CREATE INDEX IF NOT EXISTS jarvis_messages_conversation
    ON app.jarvis_messages (conversation_id, rang);

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · RLS — le propriétaire, et personne d'autre
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE app.jarvis_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.jarvis_conversations FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.jarvis_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.jarvis_messages      FORCE  ROW LEVEL SECURITY;

CREATE POLICY jarvis_conversations_owner ON app.jarvis_conversations
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet()
                  AND utilisateur_id = auth.uid())
    WITH CHECK (cabinet_id = app.current_cabinet()
                  AND utilisateur_id = auth.uid());

CREATE POLICY jarvis_messages_owner ON app.jarvis_messages
    FOR ALL TO authenticated
    USING      (EXISTS (
                  SELECT 1 FROM app.jarvis_conversations c
                   WHERE c.id = conversation_id
                     AND c.utilisateur_id = auth.uid()))
    WITH CHECK (EXISTS (
                  SELECT 1 FROM app.jarvis_conversations c
                   WHERE c.id = conversation_id
                     AND c.utilisateur_id = auth.uid()));

-- Zéro chemin non tracé : lecture et écriture directes fermées à tous,
-- portes uniquement (motif 053 — plus strict que la dette diagnoses).
REVOKE ALL ON app.jarvis_conversations FROM authenticated, service_role;
REVOKE ALL ON app.jarvis_messages      FROM authenticated, service_role;

GRANT SELECT, INSERT, UPDATE (last_message_at) ON app.jarvis_conversations TO app_gatekeeper;
GRANT SELECT, INSERT                           ON app.jarvis_messages      TO app_gatekeeper;

-- ───────────────────────────────────────────────────────────────────────────
-- 3 · Audit — même mécanisme que 013, attaché aux deux tables
-- ───────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit ON app.jarvis_conversations;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON app.jarvis_conversations
    FOR EACH ROW EXECUTE FUNCTION audit.track();

DROP TRIGGER IF EXISTS trg_audit ON app.jarvis_messages;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON app.jarvis_messages
    FOR EACH ROW EXECUTE FUNCTION audit.track();

-- ───────────────────────────────────────────────────────────────────────────
-- 4 · Portes — DEFINER sous app_gatekeeper, identité de l'appelante via JWT
-- ───────────────────────────────────────────────────────────────────────────

-- Ouvre une conversation neuve pour l'appelante. Jamais de paramètre
-- utilisateur/cabinet : ils viennent du jeton (règle 5 du patron d'écriture).
CREATE OR REPLACE FUNCTION app.start_jarvis_conversation()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO app.jarvis_conversations (cabinet_id, utilisateur_id)
  VALUES (app.current_cabinet(), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Enregistre le tour HUMAIN avant l'appel au modèle (persist-first). Un
-- rechargement pendant la génération laisse donc la question visible, sans
-- réponse — honnête, jamais simulée. Rejeu → false, aucune seconde ligne.
CREATE OR REPLACE FUNCTION app.append_jarvis_turn(
    p_conversation_id uuid,
    p_client_turn_id  uuid,
    p_demande         text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_conv uuid;
  v_row  uuid;
BEGIN
  IF p_demande IS NULL OR btrim(p_demande) = '' THEN
    RAISE EXCEPTION 'Message vide.';
  END IF;

  -- Périmètre par la RLS ET la clause explicite. Introuvable = hors
  -- périmètre, même réponse (ADR-003) : false, sans oracle d'existence.
  SELECT c.id INTO v_conv
    FROM app.jarvis_conversations c
   WHERE c.id = p_conversation_id
     AND c.utilisateur_id = auth.uid();
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO app.jarvis_messages
      (conversation_id, client_turn_id, role, contenu)
  VALUES
      (p_conversation_id, p_client_turn_id, 'humain', left(btrim(p_demande), 4000))
  ON CONFLICT (client_turn_id, role) DO NOTHING
  RETURNING id INTO v_row;

  IF v_row IS NULL THEN
    RETURN false;  -- déjà enregistré : rejeu fidèle, pas une erreur
  END IF;

  UPDATE app.jarvis_conversations SET last_message_at = now()
   WHERE id = p_conversation_id;
  RETURN true;
END;
$$;

-- Enregistre la réponse JARVIS canonique — appelée par la passerelle SOUS le
-- JWT de l'appelante, AVANT l'émission de l'événement final. Idempotent sur
-- (client_turn_id,'jarvis') : l'interruption peut être notée deux fois
-- (gestionnaire d'annulation serveur + repli client), une seule ligne gagne.
CREATE OR REPLACE FUNCTION app.complete_jarvis_turn(
    p_conversation_id uuid,
    p_client_turn_id  uuid,
    p_chemin          text,
    p_contenu         text,
    p_registre        text DEFAULT NULL,
    p_statut          text DEFAULT 'complet',
    p_outil           jsonb DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_conv uuid;
  v_row  uuid;
BEGIN
  IF p_chemin NOT IN ('connaissance','patient','refus') THEN
    RAISE EXCEPTION 'Chemin de routage inconnu.';
  END IF;
  IF p_statut NOT IN ('complet','interrompu') THEN
    RAISE EXCEPTION 'Statut de tour inconnu.';
  END IF;
  IF p_contenu IS NULL OR btrim(p_contenu) = '' THEN
    RAISE EXCEPTION 'Réponse vide.';
  END IF;
  IF p_outil IS NOT NULL AND jsonb_typeof(p_outil) <> 'object' THEN
    RAISE EXCEPTION 'Proposition d''outil invalide.';
  END IF;

  SELECT c.id INTO v_conv
    FROM app.jarvis_conversations c
   WHERE c.id = p_conversation_id
     AND c.utilisateur_id = auth.uid();
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO app.jarvis_messages
      (conversation_id, client_turn_id, role, chemin, registre,
       contenu, outil, statut)
  VALUES
      (p_conversation_id, p_client_turn_id, 'jarvis', p_chemin,
       nullif(btrim(coalesce(p_registre, '')), ''),
       left(btrim(p_contenu), 12000), p_outil, p_statut)
  ON CONFLICT (client_turn_id, role) DO NOTHING
  RETURNING id INTO v_row;

  IF v_row IS NULL THEN
    RETURN false;
  END IF;

  UPDATE app.jarvis_conversations SET last_message_at = now()
   WHERE id = p_conversation_id;
  RETURN true;
END;
$$;

-- Historique : la conversation LA PLUS RÉCENTE de l'appelante, jusqu'à
-- p_limit messages (borné 1..500), en UN appel jsonb à contrat explicite
-- (motif workspace 047 — jamais to_jsonb d'une table entière).
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
   ORDER BY c.started_at DESC
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

ALTER FUNCTION app.start_jarvis_conversation()             OWNER TO app_gatekeeper;
ALTER FUNCTION app.append_jarvis_turn(uuid,uuid,text)      OWNER TO app_gatekeeper;
ALTER FUNCTION app.complete_jarvis_turn(uuid,uuid,text,text,text,text,jsonb) OWNER TO app_gatekeeper;
ALTER FUNCTION app.get_jarvis_history(integer)             OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.start_jarvis_conversation() IS
  'V-JARVIS-CORE. Ouvre une conversation pour l''appelante (identité du jeton).';
COMMENT ON FUNCTION app.append_jarvis_turn(uuid,uuid,text) IS
  'V-JARVIS-CORE. Persist-first du tour humain. Idempotent sur client_turn_id.';
COMMENT ON FUNCTION app.complete_jarvis_turn(uuid,uuid,text,text,text,text,jsonb) IS
  'V-JARVIS-CORE. Réponse canonique Jarvis, écrite par la passerelle avant '
  'l''événement fin. Idempotent sur (client_turn_id,''jarvis'').';
COMMENT ON FUNCTION app.get_jarvis_history(integer) IS
  'V-JARVIS-CORE. Dernière conversation de l''appelante, jsonb à contrat '
  '''contrat''=''1'', borné 1..500 messages.';

REVOKE ALL ON FUNCTION app.start_jarvis_conversation() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.append_jarvis_turn(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.complete_jarvis_turn(uuid,uuid,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_jarvis_history(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.start_jarvis_conversation() TO authenticated;
GRANT EXECUTE ON FUNCTION app.append_jarvis_turn(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.complete_jarvis_turn(uuid,uuid,text,text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION app.get_jarvis_history(integer) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5 · Retrait du privilège de transfert — motif 020 §5
-- ───────────────────────────────────────────────────────────────────────────
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('058_jarvis_conversations')
    ON CONFLICT DO NOTHING;

COMMIT;
