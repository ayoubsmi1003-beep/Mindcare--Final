-- ═══════════════════════════════════════════════════════════════════════════
-- 112_communication_kernel — domaine Communication : tables + RLS + portes.
--
-- Décision humaine : demande initiale + approbation du plan 2026-09-29
-- (règle 9 : schéma demandé et accordé avant écriture, tracé dans
-- `docs/superpowers/specs/2026-09-29-communication-os-design.md`).
--
-- ═══ CE QUE CE NOYAU EST ═══
-- Le modèle canonique local des conversations externes (WhatsApp Business,
-- Page Facebook, Instagram à venir). Chaque écriture métier passe par une
-- porte SECURITY DEFINER (périmètre · verrou · transition · écriture ·
-- trace via trg_audit 013, règle 5). La RLS décide du périmètre (cabinet),
-- jamais le JS (règle 4).
--
-- ═══ CE QU'IL N'EST PAS ═══
-- · Pas de seconde base patients : `patient_id` FK NULLABLE vers
--   `app.patients`, jamais dupliqué. Une conversation peut exister sans
--   patient (prospect non identifié) — elle ne crée pas de dossier.
-- · Pas de second système de RDV : l'Agenda (022/025) reste l'autorité.
-- · Pas de tokens : `external_connections` porte statut + capacités, JAMAIS
--   de secret. Les secrets vivent dans l'environnement serveur (règle 2).
-- · États texte + CHECK, pas d'enum : étendre sans ALTER TYPE.
--
-- Conventions : BEGIN/COMMIT + `schema_migrations`, `OWNER TO
-- app_gatekeeper`, `SET search_path` figé (motif 003/058), noms qualifiés.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ───────────────────────────────────────────────────────────────────────────
-- 1 · Les tables
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app.communication_conversations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id      uuid NOT NULL REFERENCES app.cabinets(id),
    -- Référence au dossier maître, JAMAIS une copie. NULL = prospect.
    patient_id      uuid REFERENCES app.patients(id),
    canal           text NOT NULL CHECK (canal IN ('whatsapp', 'instagram', 'facebook')),
    etat_handoff    text NOT NULL DEFAULT 'AI_HANDLING'
                        CHECK (etat_handoff IN ('AI_HANDLING', 'HUMAN_REQUIRED', 'HUMAN_HANDLING', 'RESOLVED')),
    -- Identifiant du contact côté provider (téléphone, PSID, IGID) : donnée
    -- de routage, pas un dossier. Jamais affiché comme identité vérifiée.
    identifiant_externe text,
    last_message_at timestamptz NOT NULL DEFAULT now(),
    closed_at       timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.communication_participants (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES app.communication_conversations(id),
    role            text NOT NULL CHECK (role IN ('patient', 'praticienne', 'accueil', 'systeme')),
    nom_affiche     text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.communication_messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES app.communication_conversations(id),
    -- Idempotence d'ingestion : le client/ webhook génère AVANT l'envoi.
    -- UNIQUE(conversation_id, client_msg_id) : un rejeu fidèle = DO NOTHING.
    client_msg_id   uuid NOT NULL,
    direction       text NOT NULL CHECK (direction IN ('entrant', 'sortant')),
    etat            text NOT NULL DEFAULT 'received'
                        CHECK (etat IN ('received', 'classified', 'awaiting_action', 'draft',
                                        'approval_required', 'approved', 'queued',
                                        'sending', 'sent', 'delivered', 'read',
                                        'failed', 'blocked', 'expired', 'rejected')),
    contenu         text NOT NULL CHECK (char_length(btrim(contenu)) BETWEEN 1 AND 4000),
    langue          text CHECK (langue IS NULL OR langue IN ('fr', 'ar', 'darija', 'mixte')),
    template_id     uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, client_msg_id)
);

CREATE TABLE IF NOT EXISTS app.message_deliveries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      uuid NOT NULL REFERENCES app.communication_messages(id),
    -- Clé d'idempotence externe stable : `comm:<conversation>:<hash>`.
    -- UNIQUE : un retry après timeout côté Meta ne duplique jamais l'envoi.
    cle_idempotence text NOT NULL UNIQUE,
    statut          text NOT NULL DEFAULT 'pending'
                        CHECK (statut IN ('pending', 'sent', 'delivered', 'read', 'failed')),
    reference_externe text,
    tentatives      integer NOT NULL DEFAULT 0 CHECK (tentatives >= 0),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.message_templates (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id  uuid NOT NULL REFERENCES app.cabinets(id),
    canal       text NOT NULL CHECK (canal IN ('whatsapp', 'instagram', 'facebook')),
    nom         text NOT NULL,
    langue      text NOT NULL DEFAULT 'fr' CHECK (langue IN ('fr', 'ar', 'darija', 'mixte')),
    corps       text NOT NULL CHECK (char_length(btrim(corps)) BETWEEN 1 AND 2000),
    statut      text NOT NULL DEFAULT 'brouillon'
                    CHECK (statut IN ('brouillon', 'approuve_meta', 'refuse')),
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cabinet_id, canal, nom)
);

CREATE TABLE IF NOT EXISTS app.communication_consents (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id  uuid NOT NULL REFERENCES app.cabinets(id),
    patient_id  uuid NOT NULL REFERENCES app.patients(id),
    canal       text NOT NULL CHECK (canal IN ('whatsapp', 'instagram', 'facebook')),
    consentement boolean NOT NULL DEFAULT false,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cabinet_id, patient_id, canal)
);

-- Statut/capacités des connexions externes. SANS token, SANS secret :
-- le statut vient du backend d'intégration, jamais du navigateur.
CREATE TABLE IF NOT EXISTS app.external_connections (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id  uuid NOT NULL REFERENCES app.cabinets(id),
    canal       text NOT NULL CHECK (canal IN ('whatsapp', 'instagram', 'facebook')),
    statut      text NOT NULL DEFAULT 'non_connecte'
                    CHECK (statut IN ('connecte', 'non_connecte', 'erreur')),
    capacites   jsonb NOT NULL DEFAULT '{}'::jsonb
                    CHECK (jsonb_typeof(capacites) = 'object'),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cabinet_id, canal)
);

CREATE TABLE IF NOT EXISTS app.external_message_refs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id          uuid NOT NULL REFERENCES app.communication_messages(id),
    provider            text NOT NULL CHECK (provider IN ('composio', 'meta_direct')),
    provider_message_id text NOT NULL UNIQUE,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- Actions à effet externe (envoi de masse, publication) : traçabilité de
-- l'approbation. `confirmed_at` AVANT exécution (règle 7) ; la charge ne
-- porte jamais de PII (garde applicative + classerCharge à l'envoi).
CREATE TABLE IF NOT EXISTS app.communication_actions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id   uuid NOT NULL REFERENCES app.cabinets(id),
    type         text NOT NULL CHECK (type IN ('envoi_masse', 'publication', 'envoi_individuel')),
    charge       jsonb NOT NULL CHECK (jsonb_typeof(charge) = 'object'),
    statut       text NOT NULL DEFAULT 'propose'
                     CHECK (statut IN ('propose', 'confirme', 'execute', 'verifie', 'rejete')),
    confirmed_at timestamptz,
    confirmed_by uuid REFERENCES app.profiles(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT communication_action_confirme_exige_quand
        CHECK (statut IN ('propose', 'rejete') OR confirmed_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS app.human_handoffs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES app.communication_conversations(id),
    de_etat         text NOT NULL,
    vers_etat       text NOT NULL
                        CHECK (vers_etat IN ('AI_HANDLING', 'HUMAN_REQUIRED', 'HUMAN_HANDLING', 'RESOLVED')),
    motif           text NOT NULL CHECK (char_length(btrim(motif)) BETWEEN 1 AND 500),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.communication_automations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id  uuid NOT NULL REFERENCES app.cabinets(id),
    nom         text NOT NULL,
    declencheur text NOT NULL CHECK (declencheur IN ('message_entrant', 'rdv_approchant', 'conversation_sans_reponse', 'contenu_clinique', 'confirmation_due')),
    conditions  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(conditions) = 'object'),
    action      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(action) = 'object'),
    actif       boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cabinet_id, nom)
);

-- FK différée : template référencé par les messages (posée après CREATE).
ALTER TABLE app.communication_messages
    ADD CONSTRAINT communication_messages_template_fk
    FOREIGN KEY (template_id) REFERENCES app.message_templates(id);

CREATE INDEX IF NOT EXISTS communication_conversations_cabinet
    ON app.communication_conversations (cabinet_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS communication_messages_conversation
    ON app.communication_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS communication_consents_lookup
    ON app.communication_consents (cabinet_id, patient_id, canal);

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · RLS — périmètre cabinet, et rien d'autre (règle 4)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE app.communication_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.communication_conversations FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.communication_participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.communication_participants  FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.communication_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.communication_messages     FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.message_deliveries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.message_deliveries         FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.message_templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.message_templates          FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.communication_consents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.communication_consents     FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.external_connections       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.external_connections       FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.external_message_refs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.external_message_refs      FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.communication_actions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.communication_actions      FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.human_handoffs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.human_handoffs             FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.communication_automations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.communication_automations  FORCE  ROW LEVEL SECURITY;

-- Périmètre direct (tables portant cabinet_id).
CREATE POLICY communication_cabinet_scope ON app.communication_conversations
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet())
    WITH CHECK (cabinet_id = app.current_cabinet());

CREATE POLICY communication_templates_scope ON app.message_templates
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet())
    WITH CHECK (cabinet_id = app.current_cabinet());

CREATE POLICY communication_consents_scope ON app.communication_consents
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet())
    WITH CHECK (cabinet_id = app.current_cabinet());

CREATE POLICY communication_connections_scope ON app.external_connections
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet())
    WITH CHECK (cabinet_id = app.current_cabinet());

CREATE POLICY communication_actions_scope ON app.communication_actions
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet())
    WITH CHECK (cabinet_id = app.current_cabinet());

CREATE POLICY communication_automations_scope ON app.communication_automations
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet())
    WITH CHECK (cabinet_id = app.current_cabinet());

-- Périmètre indirect (via la conversation du même cabinet).
CREATE POLICY communication_participants_scope ON app.communication_participants
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM app.communication_conversations c
                         WHERE c.id = conversation_id
                           AND c.cabinet_id = app.current_cabinet()))
    WITH CHECK (EXISTS (SELECT 1 FROM app.communication_conversations c
                         WHERE c.id = conversation_id
                           AND c.cabinet_id = app.current_cabinet()));

CREATE POLICY communication_messages_scope ON app.communication_messages
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM app.communication_conversations c
                         WHERE c.id = conversation_id
                           AND c.cabinet_id = app.current_cabinet()))
    WITH CHECK (EXISTS (SELECT 1 FROM app.communication_conversations c
                         WHERE c.id = conversation_id
                           AND c.cabinet_id = app.current_cabinet()));

CREATE POLICY communication_deliveries_scope ON app.message_deliveries
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM app.communication_messages m
                        JOIN app.communication_conversations c ON c.id = m.conversation_id
                        WHERE m.id = message_id
                          AND c.cabinet_id = app.current_cabinet()))
    WITH CHECK (EXISTS (SELECT 1 FROM app.communication_messages m
                        JOIN app.communication_conversations c ON c.id = m.conversation_id
                        WHERE m.id = message_id
                          AND c.cabinet_id = app.current_cabinet()));

CREATE POLICY communication_refs_scope ON app.external_message_refs
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM app.communication_messages m
                        JOIN app.communication_conversations c ON c.id = m.conversation_id
                        WHERE m.id = message_id
                          AND c.cabinet_id = app.current_cabinet()))
    WITH CHECK (EXISTS (SELECT 1 FROM app.communication_messages m
                        JOIN app.communication_conversations c ON c.id = m.conversation_id
                        WHERE m.id = message_id
                          AND c.cabinet_id = app.current_cabinet()));

CREATE POLICY communication_handoffs_scope ON app.human_handoffs
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM app.communication_conversations c
                         WHERE c.id = conversation_id
                           AND c.cabinet_id = app.current_cabinet()))
    WITH CHECK (EXISTS (SELECT 1 FROM app.communication_conversations c
                         WHERE c.id = conversation_id
                           AND c.cabinet_id = app.current_cabinet()));

-- Zéro chemin non tracé : lecture/écriture directes fermées, portes uniquement.
REVOKE ALL ON app.communication_conversations FROM authenticated, service_role;
REVOKE ALL ON app.communication_participants  FROM authenticated, service_role;
REVOKE ALL ON app.communication_messages      FROM authenticated, service_role;
REVOKE ALL ON app.message_deliveries          FROM authenticated, service_role;
REVOKE ALL ON app.message_templates           FROM authenticated, service_role;
REVOKE ALL ON app.communication_consents      FROM authenticated, service_role;
REVOKE ALL ON app.external_connections        FROM authenticated, service_role;
REVOKE ALL ON app.external_message_refs       FROM authenticated, service_role;
REVOKE ALL ON app.communication_actions       FROM authenticated, service_role;
REVOKE ALL ON app.human_handoffs              FROM authenticated, service_role;
REVOKE ALL ON app.communication_automations   FROM authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON app.communication_conversations TO app_gatekeeper;
GRANT SELECT, INSERT          ON app.communication_participants  TO app_gatekeeper;
GRANT SELECT, INSERT, UPDATE (etat) ON app.communication_messages TO app_gatekeeper;
GRANT SELECT, INSERT, UPDATE ON app.message_deliveries          TO app_gatekeeper;
GRANT SELECT, INSERT, UPDATE ON app.message_templates           TO app_gatekeeper;
GRANT SELECT, INSERT, UPDATE ON app.communication_consents      TO app_gatekeeper;
GRANT SELECT, INSERT, UPDATE ON app.external_connections        TO app_gatekeeper;
GRANT SELECT, INSERT          ON app.external_message_refs      TO app_gatekeeper;
GRANT SELECT, INSERT, UPDATE ON app.communication_actions       TO app_gatekeeper;
GRANT SELECT, INSERT          ON app.human_handoffs              TO app_gatekeeper;
GRANT SELECT, INSERT, UPDATE ON app.communication_automations   TO app_gatekeeper;

-- ───────────────────────────────────────────────────────────────────────────
-- 3 · Audit — trg_audit (013) sur chaque table
-- ───────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit ON app.communication_conversations;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.communication_conversations
    FOR EACH ROW EXECUTE FUNCTION audit.track();
DROP TRIGGER IF EXISTS trg_audit ON app.communication_participants;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.communication_participants
    FOR EACH ROW EXECUTE FUNCTION audit.track();
DROP TRIGGER IF EXISTS trg_audit ON app.communication_messages;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.communication_messages
    FOR EACH ROW EXECUTE FUNCTION audit.track();
DROP TRIGGER IF EXISTS trg_audit ON app.message_deliveries;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.message_deliveries
    FOR EACH ROW EXECUTE FUNCTION audit.track();
DROP TRIGGER IF EXISTS trg_audit ON app.message_templates;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.message_templates
    FOR EACH ROW EXECUTE FUNCTION audit.track();
DROP TRIGGER IF EXISTS trg_audit ON app.communication_consents;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.communication_consents
    FOR EACH ROW EXECUTE FUNCTION audit.track();
DROP TRIGGER IF EXISTS trg_audit ON app.external_connections;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.external_connections
    FOR EACH ROW EXECUTE FUNCTION audit.track();
DROP TRIGGER IF EXISTS trg_audit ON app.external_message_refs;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.external_message_refs
    FOR EACH ROW EXECUTE FUNCTION audit.track();
DROP TRIGGER IF EXISTS trg_audit ON app.communication_actions;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.communication_actions
    FOR EACH ROW EXECUTE FUNCTION audit.track();
DROP TRIGGER IF EXISTS trg_audit ON app.human_handoffs;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.human_handoffs
    FOR EACH ROW EXECUTE FUNCTION audit.track();
DROP TRIGGER IF EXISTS trg_audit ON app.communication_automations;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.communication_automations
    FOR EACH ROW EXECUTE FUNCTION audit.track();

-- ───────────────────────────────────────────────────────────────────────────
-- 4 · Portes — DEFINER sous app_gatekeeper
-- ───────────────────────────────────────────────────────────────────────────

-- Ouvre une conversation. patient_id NULL = prospect (aucun dossier créé).
CREATE OR REPLACE FUNCTION app.comm_create_conversation(
    p_canal text,
    p_patient_id uuid DEFAULT NULL,
    p_identifiant_externe text DEFAULT NULL)
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
  -- Périmètre : le patient éventuel appartient au cabinet, sinon refus
  -- silencieux (même réponse qu'introuvable — ADR-003, pas d'oracle).
  IF p_patient_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM app.patients p
       WHERE p.id = p_patient_id AND p.cabinet_id = app.current_cabinet()) THEN
    RAISE EXCEPTION 'Conversation impossible.';
  END IF;
  INSERT INTO app.communication_conversations (cabinet_id, patient_id, canal, identifiant_externe)
  VALUES (app.current_cabinet(), p_patient_id, p_canal, p_identifiant_externe)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Ajoute un message. Rejeu fidèle (même client_msg_id) → false, sans doublon.
CREATE OR REPLACE FUNCTION app.comm_append_message(
    p_conversation_id uuid,
    p_client_msg_id uuid,
    p_direction text,
    p_contenu text,
    p_langue text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_row uuid;
BEGIN
  IF p_direction NOT IN ('entrant', 'sortant') THEN
    RAISE EXCEPTION 'Direction inconnue.';
  END IF;
  IF p_contenu IS NULL OR btrim(p_contenu) = '' THEN
    RAISE EXCEPTION 'Message vide.';
  END IF;
  IF p_langue IS NOT NULL AND p_langue NOT IN ('fr', 'ar', 'darija', 'mixte') THEN
    RAISE EXCEPTION 'Langue inconnue.';
  END IF;
  -- Verrou : sérialise les ajouts concurrents sur la conversation.
  PERFORM 1 FROM app.communication_conversations c
   WHERE c.id = p_conversation_id
     AND c.cabinet_id = app.current_cabinet()
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO app.communication_messages
      (conversation_id, client_msg_id, direction, contenu, langue)
  VALUES
      (p_conversation_id, p_client_msg_id, p_direction, left(btrim(p_contenu), 4000), p_langue)
  ON CONFLICT (conversation_id, client_msg_id) DO NOTHING
  RETURNING id INTO v_row;
  IF v_row IS NULL THEN
    RETURN false;
  END IF;
  UPDATE app.communication_conversations SET last_message_at = now()
   WHERE id = p_conversation_id;
  RETURN true;
END;
$$;

-- Fait avancer l'état d'un message. Transition illégale = exception nommée.
CREATE OR REPLACE FUNCTION app.comm_transition_message(
    p_message_id uuid,
    p_vers text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_etat text;
  v_ok boolean := false;
BEGIN
  SELECT m.etat INTO v_etat
    FROM app.communication_messages m
    JOIN app.communication_conversations c ON c.id = m.conversation_id
   WHERE m.id = p_message_id
     AND c.cabinet_id = app.current_cabinet()
     FOR UPDATE OF m;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- Graphe autorisé (échecs atteignables depuis tout état non terminal).
  v_ok :=
    (v_etat = 'received'          AND p_vers IN ('classified', 'blocked')) OR
    (v_etat = 'classified'        AND p_vers IN ('awaiting_action', 'draft', 'blocked')) OR
    (v_etat = 'awaiting_action'   AND p_vers IN ('draft', 'blocked')) OR
    (v_etat = 'draft'             AND p_vers IN ('approval_required', 'approved', 'queued', 'blocked')) OR
    (v_etat = 'approval_required' AND p_vers IN ('approved', 'rejected')) OR
    (v_etat = 'approved'          AND p_vers IN ('queued', 'sending', 'blocked')) OR
    (v_etat = 'queued'            AND p_vers IN ('sending', 'expired')) OR
    (v_etat = 'sending'           AND p_vers IN ('sent', 'failed')) OR
    (v_etat = 'sent'              AND p_vers IN ('delivered', 'failed')) OR
    (v_etat = 'delivered'         AND p_vers IN ('read', 'failed')) OR
    (p_vers IN ('failed', 'expired') AND v_etat NOT IN ('read', 'failed', 'blocked', 'expired', 'rejected'));
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Transition de message interdite.';
  END IF;
  UPDATE app.communication_messages SET etat = p_vers WHERE id = p_message_id;
  RETURN true;
END;
$$;

-- Pose le consentement d'un patient pour un canal (opt-in/opt-out).
CREATE OR REPLACE FUNCTION app.comm_set_consent(
    p_patient_id uuid,
    p_canal text,
    p_consentement boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
BEGIN
  IF p_canal NOT IN ('whatsapp', 'instagram', 'facebook') THEN
    RAISE EXCEPTION 'Canal inconnu.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.patients p
                  WHERE p.id = p_patient_id
                    AND p.cabinet_id = app.current_cabinet()) THEN
    RETURN false;
  END IF;
  INSERT INTO app.communication_consents (cabinet_id, patient_id, canal, consentement, updated_at)
  VALUES (app.current_cabinet(), p_patient_id, p_canal, p_consentement, now())
  ON CONFLICT (cabinet_id, patient_id, canal)
  DO UPDATE SET consentement = EXCLUDED.consentement, updated_at = now();
  RETURN true;
END;
$$;

-- Enregistre une tentative d'envoi. Clé déjà vue → false (retry sans doublon).
CREATE OR REPLACE FUNCTION app.comm_register_delivery(
    p_message_id uuid,
    p_cle text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_row uuid;
BEGIN
  IF p_cle IS NULL OR btrim(p_cle) = '' THEN
    RAISE EXCEPTION 'Clé d''idempotence vide.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.communication_messages m
                  JOIN app.communication_conversations c ON c.id = m.conversation_id
                 WHERE m.id = p_message_id
                   AND c.cabinet_id = app.current_cabinet()) THEN
    RETURN false;
  END IF;
  INSERT INTO app.message_deliveries (message_id, cle_idempotence)
  VALUES (p_message_id, p_cle)
  ON CONFLICT (cle_idempotence) DO NOTHING
  RETURNING id INTO v_row;
  RETURN v_row IS NOT NULL;
END;
$$;

-- Trace un changement de propriétaire de conversation (handoff).
CREATE OR REPLACE FUNCTION app.comm_request_handoff(
    p_conversation_id uuid,
    p_vers text,
    p_motif text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_etat text;
BEGIN
  IF p_vers NOT IN ('AI_HANDLING', 'HUMAN_REQUIRED', 'HUMAN_HANDLING', 'RESOLVED') THEN
    RAISE EXCEPTION 'État de prise en charge inconnu.';
  END IF;
  IF p_motif IS NULL OR btrim(p_motif) = '' THEN
    RAISE EXCEPTION 'Motif de transfert vide.';
  END IF;
  SELECT c.etat_handoff INTO v_etat
    FROM app.communication_conversations c
   WHERE c.id = p_conversation_id
     AND c.cabinet_id = app.current_cabinet()
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO app.human_handoffs (conversation_id, de_etat, vers_etat, motif)
  VALUES (p_conversation_id, v_etat, p_vers, left(btrim(p_motif), 500));
  UPDATE app.communication_conversations SET etat_handoff = p_vers
   WHERE id = p_conversation_id;
  RETURN true;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5 · Droits des portes
-- ───────────────────────────────────────────────────────────────────────────
ALTER FUNCTION app.comm_create_conversation(text, uuid, text) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_append_message(uuid, uuid, text, text, text) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_transition_message(uuid, text) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_set_consent(uuid, text, boolean) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_register_delivery(uuid, text) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_request_handoff(uuid, text, text) OWNER TO app_gatekeeper;

REVOKE ALL ON FUNCTION app.comm_create_conversation(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_append_message(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_transition_message(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_set_consent(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_register_delivery(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_request_handoff(uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.comm_create_conversation(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_append_message(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_transition_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_set_consent(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_register_delivery(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_request_handoff(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('112_communication_kernel')
    ON CONFLICT DO NOTHING;

COMMIT;
