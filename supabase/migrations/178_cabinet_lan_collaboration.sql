-- 178_cabinet_lan_collaboration — le cabinet à deux postes (médecin + accueil).
--
-- ═══ CE QUE CE FICHIER AJOUTE, ET POURQUOI CHAQUE OBJET EXISTE ═══════════════
--
-- Décision humaine du 2026-10-22 : le PC du médecin est l'hôte autoritaire
-- (PostgreSQL 16 en boucle locale, backend Next.js en boucle locale, proxy
-- HTTPS sur le LAN), le PC de l'accueil est un client appairé. Le partage
-- existe déjà — agenda, arrivées, tarif, encaissement, notifications — mais
-- il est lu par INTERVALLE (30–120 s) et rien ne relie les deux postes en
-- temps réel. Ce fichier pose les quatre manques mesurés :
--
--   1. `app.cabinet_events` — un fil d'événements MONOTONE et TRANSACTIONNEL
--      (`pg_notify` est délivré au COMMIT et jamais sur un ROLLBACK), pour que
--      le flux SSE puisse reprendre exactement où il s'est arrêté après une
--      coupure, un redémarrage ou un crash du processus Node. Un `pg_notify`
--      seul perdrait l'événement si le processus meurt entre le COMMIT et
--      l'écriture du flux ; la table, elle, le garde.
--
--   2. `app.assistant_calls` — l'alerte « Appeler la secrétaire ». Un appel
--      n'est PAS un message : il a un état de remise, une expiration courte,
--      une limite de débit et un accusé de réception. Le confondre avec une
--      notification le rendrait « réussi » alors que personne n'a rien vu.
--
--   3. `app.internal_messages` — la messagerie INTERNE médecin ↔ accueil,
--      texte seul. Elle est volontairement séparée de `app.communication_*`
--      (112), qui est le canal EXTERNE (WhatsApp / Facebook / Instagram) et
--      n'a rien à voir : ni consentement patient, ni provider, ni egress.
--
--   4. `app.manage_assistant_account` — la mesure la plus concrète : sur une
--      installation `self-hosted`, `083_purge_fixtures_015()` supprime le
--      compte d'appairage `…a3`, et `084_provision_owner_account()` ne crée
--      que le compte `owner`, en refusant un second appel. Sans cette porte,
--      l'accueil n'a AUCUN moyen d'obtenir un compte sur une vraie base.
--
-- ═══ CE QUE CE FICHIER NE FAIT PAS ══════════════════════════════════════════
--
-- · Il ne modifie AUCUNE table existante : ni colonne, ni policy, ni porte,
--   ni déclencheur. `029`, `037` et `046` restent exactement ce qu'ils sont —
--   la décision du 2026-10-22 conserve le flux en place : le médecin fixe le
--   tarif et clôt la séance, la notification `payment_due` part, l'accueil
--   encaisse un tarif qu'il ne peut pas modifier (`trg_pay_guard`), et le
--   montant n'est « encaissé » qu'après le COMMIT sur le poste médecin.
-- · Il n'ajoute aucune valeur d'énumération : les états de l'appel sont du
--   `text` + CHECK, comme `112_communication_kernel.sql`, pour s'étendre sans
--   `ALTER TYPE`.
-- · Il n'ouvre AUCUN accès direct : les trois tables sont révoquées à
--   `authenticated`, et ne sont lisibles que par leurs portes.
--
-- ═══ LA SÉPARATION DES PORTEURS ═════════════════════════════════════════════
--
-- `staff_gatekeeper` est un TROISIÈME porteur, et ce n'est pas un caprice.
-- `auth_gatekeeper` (070) porte la vérification des mots de passe : lui donner
-- INSERT sur `auth.users` élargirait la surface du chemin d'authentification
-- au moment précis où il décide qui peut ouvrir une session. `app_gatekeeper`
-- (020) ne connaît pas le schéma `auth`. Un porteur dédié, créé ici, sans
-- LOGIN ni BYPASSRLS, dont les seuls privilèges sont ceux qu'écrivent les
-- fonctions ci-dessous — et des assertions qui refusent la migration si l'un
-- de ces attributs est faux (motif 020/070).

BEGIN;

-- ---------------------------------------------------------------------------
-- 0 · Le porteur des portes de gestion du personnel
-- ---------------------------------------------------------------------------
DO $bloc$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'staff_gatekeeper') THEN
    CREATE ROLE staff_gatekeeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
                                  INHERIT NOREPLICATION;
  END IF;
END $bloc$;

-- ASSERTION, PAS AFFECTATION — même raison qu'en 020 §1 : selon l'installation,
-- le rôle qui applique les migrations n'a pas le droit de POSER ces attributs.
-- On vérifie donc, ce qui refuse bruyamment si quelqu'un l'a pré-créé autrement.
DO $bloc$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolbypassrls, rolcanlogin INTO r
    FROM pg_roles WHERE rolname = 'staff_gatekeeper';

  IF r.rolsuper OR r.rolbypassrls THEN
    RAISE EXCEPTION
      'staff_gatekeeper porte SUPERUSER ou BYPASSRLS : il pourrait lire tout le cabinet.'
      USING HINT = 'Retirer l''attribut avec un rôle superutilisateur, puis rejouer.';
  END IF;

  IF r.rolcanlogin THEN
    RAISE EXCEPTION 'staff_gatekeeper peut ouvrir une session : il ne doit jamais le pouvoir.';
  END IF;
END $bloc$;

COMMENT ON ROLE staff_gatekeeper IS
  'Propriétaire des portes de gestion du personnel (178). Sans LOGIN ni '
  'BYPASSRLS : ne voit que auth.users, auth.sessions et app.profiles, par '
  'policies nommées. Distinct de auth_gatekeeper (mots de passe) et de '
  'app_gatekeeper (données du cabinet).';

GRANT USAGE ON SCHEMA app  TO staff_gatekeeper;
GRANT USAGE ON SCHEMA auth TO staff_gatekeeper;

-- ⚠️ LE TRANSFERT DE PROPRIÉTÉ EXIGE QUE LE NOUVEAU PROPRIÉTAIRE PUISSE CRÉER
-- DANS LE SCHÉMA. Sur une installation locale, `postgres` est superutilisateur
-- et PostgreSQL saute ce contrôle : la migration passerait sans ces deux
-- lignes. Ailleurs (rôle de migration non superutilisateur), elle échouerait en
-- 42501 après une longue série verte — c'est exactement le défaut que 029 §0
-- documente. On nomme donc le privilège, puis on le retire en §8.
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
GRANT CREATE ON SCHEMA app TO staff_gatekeeper;

-- Privilèges NOMMÉS, un par un. Pas de DELETE sur auth.users ni app.profiles :
-- une suppression de compte n'est pas un geste de cette version (la
-- désactivation passe par `is_active`, et l'historique clinique reste dû).
GRANT SELECT, INSERT, UPDATE ON auth.users    TO staff_gatekeeper;
GRANT SELECT, INSERT, DELETE ON auth.sessions TO staff_gatekeeper;
GRANT SELECT, INSERT, UPDATE ON app.profiles  TO staff_gatekeeper;

-- `auth.users`, `auth.sessions` et `app.profiles` portent FORCE RLS : le
-- privilège de table ne suffit pas, il faut une policy. Elles ne nomment que
-- ce porteur.
DROP POLICY IF EXISTS staff_users_gate ON auth.users;
CREATE POLICY staff_users_gate ON auth.users
  FOR ALL TO staff_gatekeeper USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS staff_sessions_gate ON auth.sessions;
CREATE POLICY staff_sessions_gate ON auth.sessions
  FOR ALL TO staff_gatekeeper USING (true) WITH CHECK (true);

-- ⚠️ CETTE POLICY EST PLUS ÉTROITE QUE CELLE DE 070, ET C'EST DÉLIBÉRÉ.
-- `staff_gatekeeper` ne doit pouvoir créer ou modifier qu'un profil
-- `assistant` de SON cabinet. La porte redit la même condition ; la policy la
-- rend vraie même si la porte était un jour contournée par un défaut futur.
DROP POLICY IF EXISTS profiles_staff_gate ON app.profiles;
CREATE POLICY profiles_staff_gate ON app.profiles
  FOR ALL TO staff_gatekeeper
  USING      (role = 'assistant' AND cabinet_id = app.current_cabinet())
  WITH CHECK (role = 'assistant' AND cabinet_id = app.current_cabinet());

-- ---------------------------------------------------------------------------
-- 1 · Le fil d'événements du cabinet
-- ---------------------------------------------------------------------------
-- `seq` est un `bigserial` : monotone, sans trou visible côté client (un trou
-- signifie « événement non visible par ce rôle », pas « événement perdu »).
-- Aucune donnée patient n'y figure : un kind, un rôle cible, un identifiant
-- technique d'entité et un horodatage. Un client qui lirait la table entière
-- n'apprendrait ni un nom, ni un montant, ni un contenu.
CREATE TABLE IF NOT EXISTS app.cabinet_events (
    seq         bigserial PRIMARY KEY,
    cabinet_id  uuid NOT NULL REFERENCES app.cabinets(id),
    kind        text NOT NULL CHECK (kind IN (
                    'agenda_updated',
                    'payment_updated',
                    'notification_created',
                    'message_updated',
                    'assistant_call')),
    target_role app.user_role,
    entity_id   uuid,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cabinet_events_cabinet_seq
    ON app.cabinet_events (cabinet_id, seq);
CREATE INDEX IF NOT EXISTS cabinet_events_occurred_at
    ON app.cabinet_events (occurred_at);

ALTER TABLE app.cabinet_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.cabinet_events FORCE  ROW LEVEL SECURITY;

-- Les privilèges par défaut de 001 accordent ces tables à `authenticated`
-- (ligne 37). On les RETIRE ici : ces trois tables ne sont atteignables que
-- par leurs portes, jamais par `/api/db/select`.
REVOKE ALL ON app.cabinet_events FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, DELETE ON app.cabinet_events TO app_gatekeeper;
GRANT USAGE, SELECT ON SEQUENCE app.cabinet_events_seq_seq TO app_gatekeeper;

-- Aucune policy pour `authenticated` : la table n'est atteignable que par les
-- portes. Le déclencheur écrit sous `app_gatekeeper`, d'où cette policy.
CREATE POLICY cabinet_events_gate ON app.cabinet_events
  FOR ALL TO app_gatekeeper
  USING      (cabinet_id = app.current_cabinet() OR app.current_cabinet() IS NULL)
  WITH CHECK (cabinet_id = app.current_cabinet() OR app.current_cabinet() IS NULL);

COMMENT ON TABLE app.cabinet_events IS
  '178. Fil monotone des changements partagés du cabinet. Écrit dans la MÊME '
  'transaction que la mutation, donc jamais visible avant son COMMIT. Sert au '
  'rattrapage du flux SSE après coupure ou redémarrage. Aucune donnée patient.';

-- ---------------------------------------------------------------------------
-- 2 · Le déclencheur d'émission — un seul, générique
-- ---------------------------------------------------------------------------
-- Il s'attache aux tables qui portent déjà `cabinet_id`. Conséquence
-- volontaire : les portes EXISTANTES (022, 025, 029, 037, 046) n'ont pas à
-- être modifiées pour émettre — leur écriture déclenche l'événement, et le
-- COMMIT décide de sa publication. Une porte future hérite du même comportement
-- sans qu'on y pense, ce qui est exactement ce qu'on veut.
CREATE OR REPLACE FUNCTION app.emit_cabinet_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_kind   text;
  v_target app.user_role;
  v_seq    bigint;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'appointments'       THEN v_kind := 'agenda_updated';
    WHEN 'payments'           THEN v_kind := 'payment_updated';
    WHEN 'notifications'      THEN v_kind := 'notification_created';
    WHEN 'internal_messages'  THEN v_kind := 'message_updated';
    WHEN 'assistant_calls'    THEN v_kind := 'assistant_call';
    ELSE RETURN NULL;
  END CASE;

  -- La notification porte déjà son destinataire ; ailleurs, tout le personnel
  -- du cabinet est concerné (target_role NULL).
  IF TG_TABLE_NAME = 'notifications' THEN
    v_target := NEW.recipient_role;
  END IF;

  INSERT INTO app.cabinet_events (cabinet_id, kind, target_role, entity_id)
  VALUES (NEW.cabinet_id, v_kind, v_target, NEW.id)
  RETURNING seq INTO v_seq;

  -- `pg_notify` est TRANSACTIONNEL : PostgreSQL le retient jusqu'au COMMIT et
  -- le jette sur ROLLBACK. Aucun client ne peut donc voir un événement d'une
  -- écriture annulée. La charge reste minuscule (loin de la limite de 8 000
  -- octets) et ne contient aucune donnée de ligne.
  PERFORM pg_notify('mindcare_cabinet_events', jsonb_build_object(
    'seq',         v_seq,
    'cabinet_id',  NEW.cabinet_id,
    'kind',        v_kind,
    'target_role', v_target,
    'entity_id',   NEW.id)::text);

  RETURN NULL;
END;
$$;

ALTER FUNCTION app.emit_cabinet_event() OWNER TO app_gatekeeper;

-- ⚠️ L'ATTACHEMENT EST EN §7, PAS ICI, ET C'EST UNE CONTRAINTE RÉELLE :
-- `app.internal_messages` et `app.assistant_calls` sont créées en §3 et §4.
-- Un `CREATE TRIGGER` sur une table inexistante échoue — trouvé par exécution
-- réelle sur un PostgreSQL 16 jetable, pas par relecture.

-- ---------------------------------------------------------------------------
-- 3 · L'alerte « Appeler la secrétaire »
-- ---------------------------------------------------------------------------
-- États, et ce que chacun PROUVE :
--   sent          le serveur a accepté et commité l'appel ;
--   delivered     un poste d'accueil a reçu l'événement et l'a affiché ;
--   acknowledged  une personne a cliqué « J'arrive » ;
--   expired       la fenêtre de 60 s est passée sans accusé.
-- « sent » ne prouve JAMAIS qu'un son a été entendu : seul `acknowledged`
-- engage une personne. La distinction est la raison d'être de cette table.
CREATE TABLE IF NOT EXISTS app.assistant_calls (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id      uuid NOT NULL REFERENCES app.cabinets(id),
    -- Idempotence du bouton : un double clic ou un rejeu réseau porte le même
    -- identifiant et ne produit pas un second appel.
    client_call_id  uuid NOT NULL,
    caller_id       uuid NOT NULL REFERENCES app.profiles(id),
    caller_name     text NOT NULL,
    status          text NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('sent','delivered','acknowledged','expired')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    delivered_at    timestamptz,
    acknowledged_at timestamptz,
    acknowledged_by uuid REFERENCES app.profiles(id),
    expires_at      timestamptz NOT NULL DEFAULT (now() + interval '60 seconds'),
    CONSTRAINT assistant_calls_unique_client UNIQUE (cabinet_id, client_call_id)
);

CREATE INDEX IF NOT EXISTS assistant_calls_cabinet_created
    ON app.assistant_calls (cabinet_id, created_at DESC);

ALTER TABLE app.assistant_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_calls FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON app.assistant_calls FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON app.assistant_calls TO app_gatekeeper;

CREATE POLICY assistant_calls_gate ON app.assistant_calls
  FOR ALL TO app_gatekeeper
  USING      (cabinet_id = app.current_cabinet() OR app.current_cabinet() IS NULL)
  WITH CHECK (cabinet_id = app.current_cabinet() OR app.current_cabinet() IS NULL);

COMMENT ON TABLE app.assistant_calls IS
  '178. Alerte « Appeler la secrétaire ». Un état de remise distinct de '
  'l''accusé humain : sent ≠ entendu. Expiration 60 s, déduplication par '
  'client_call_id et limite de débit de 10 s dans app.call_assistant().';

-- Déclenche l'alerte. `owner`/`practitioner` seulement ; l'accueil ne s'appelle
-- pas elle-même. Déduplication par `client_call_id` (rejeu réseau) ET par
-- fenêtre de 10 s (double clic) — les deux sont nécessaires : la première
-- couvre un rejeu du même geste, la seconde deux clics distincts du même doigt.
CREATE OR REPLACE FUNCTION app.call_assistant(p_client_call_id uuid)
RETURNS TABLE (
  call_id     uuid,
  etat        text,
  cree_le     timestamptz,
  expire_le   timestamptz,
  dedupliquee boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_role     app.user_role;
  v_cabinet  uuid;
  v_row      app.assistant_calls;
BEGIN
  v_role    := app.current_role();
  v_cabinet := app.current_cabinet();

  IF v_role IS NULL OR v_role NOT IN ('owner','practitioner') THEN
    RAISE EXCEPTION 'Seul le médecin peut appeler l''accueil.';
  END IF;
  IF v_cabinet IS NULL THEN
    RAISE EXCEPTION 'Cabinet introuvable.';
  END IF;
  IF p_client_call_id IS NULL THEN
    RAISE EXCEPTION 'Identifiant d''appel absent.';
  END IF;

  -- 1. Rejeu du MÊME geste : on rend la ligne existante, sans second appel.
  SELECT * INTO v_row FROM app.assistant_calls c
   WHERE c.cabinet_id = v_cabinet AND c.client_call_id = p_client_call_id;
  IF FOUND THEN
    RETURN QUERY SELECT v_row.id, v_row.status, v_row.created_at,
                        v_row.expires_at, true;
    RETURN;
  END IF;

  -- 2. Double clic : un appel non acquitté du même médecin, dans les 10 s.
  SELECT * INTO v_row FROM app.assistant_calls c
   WHERE c.cabinet_id = v_cabinet
     AND c.caller_id = auth.uid()
     AND c.created_at > now() - interval '10 seconds'
     AND c.status IN ('sent','delivered')
   ORDER BY c.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT v_row.id, v_row.status, v_row.created_at,
                        v_row.expires_at, true;
    RETURN;
  END IF;

  -- 3. Nouvel appel. `caller_name` est recopié pour que l'accueil puisse
  -- l'afficher sans joindre `app.profiles` — et pour que le message reste
  -- lisible si le profil est renommé plus tard.
  INSERT INTO app.assistant_calls (cabinet_id, client_call_id, caller_id, caller_name)
  SELECT v_cabinet, p_client_call_id, auth.uid(), pr.full_name
    FROM app.profiles pr
   WHERE pr.id = auth.uid()
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Profil du médecin introuvable.';
  END IF;

  RETURN QUERY SELECT v_row.id, v_row.status, v_row.created_at,
                      v_row.expires_at, false;
END;
$$;

ALTER FUNCTION app.call_assistant(uuid) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.call_assistant(uuid) IS
  '178. Émet l''alerte d''appel. Déduplique par client_call_id puis par fenêtre '
  'de 10 s. Rend l''appel existant avec dedupliquee = true plutôt que d''en '
  'créer un second. Aucune écriture avant COMMIT n''est visible de l''accueil.';

REVOKE ALL ON FUNCTION app.call_assistant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.call_assistant(uuid) TO authenticated;

-- Statut d'un appel, pour le poste médecin (le SSE le pousse ; ceci couvre la
-- reprise après reconnexion et le sondage de secours).
CREATE OR REPLACE FUNCTION app.get_assistant_call_status(p_call_id uuid)
RETURNS TABLE (
  call_id     uuid,
  etat        text,
  cree_le     timestamptz,
  expire_le   timestamptz,
  remis_le    timestamptz,
  acquitte_le timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE v_cabinet uuid;
BEGIN
  v_cabinet := app.current_cabinet();
  IF v_cabinet IS NULL OR p_call_id IS NULL THEN RETURN; END IF;

  -- Expiration paresseuse : aucune tâche de fond n'existe dans ce dépôt
  -- (pas de pg_cron), et un balayage périodique serait une dépendance de plus.
  UPDATE app.assistant_calls c
     SET status = 'expired'
   WHERE c.cabinet_id = v_cabinet
     AND c.status IN ('sent','delivered')
     AND c.expires_at <= now();

  RETURN QUERY
  SELECT c.id, c.status, c.created_at, c.expires_at, c.delivered_at, c.acknowledged_at
    FROM app.assistant_calls c
   WHERE c.cabinet_id = v_cabinet AND c.id = p_call_id;
END;
$$;

ALTER FUNCTION app.get_assistant_call_status(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_assistant_call_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_assistant_call_status(uuid) TO authenticated;

COMMENT ON FUNCTION app.get_assistant_call_status(uuid) IS
  '178. Statut d''un appel. Expire paresseusement les appels échus (fenêtre '
  '60 s) avant de rendre la ligne. Lisible par les trois rôles du cabinet.';

-- Accusé de REMISE (affichage sur le poste d'accueil). Ne vaut pas accusé
-- humain : c'est `acknowledge_assistant_call` qui engage quelqu'un.
CREATE OR REPLACE FUNCTION app.mark_assistant_call_delivered(p_call_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_role    app.user_role;
  v_cabinet uuid;
  v_id      uuid;
BEGIN
  v_role    := app.current_role();
  v_cabinet := app.current_cabinet();

  IF v_role IS DISTINCT FROM 'assistant' THEN
    RETURN false;
  END IF;

  UPDATE app.assistant_calls c
     SET delivered_at = coalesce(c.delivered_at, now()),
         status = CASE WHEN c.status = 'sent' THEN 'delivered' ELSE c.status END
   WHERE c.cabinet_id = v_cabinet
     AND c.id = p_call_id
     AND c.status IN ('sent','delivered')
  RETURNING c.id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$$;

ALTER FUNCTION app.mark_assistant_call_delivered(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.mark_assistant_call_delivered(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mark_assistant_call_delivered(uuid) TO authenticated;

-- Accusé HUMAIN. Rejouable : le premier acquittement est le seul qui compte.
CREATE OR REPLACE FUNCTION app.acknowledge_assistant_call(p_call_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_role    app.user_role;
  v_cabinet uuid;
  v_id      uuid;
BEGIN
  v_role    := app.current_role();
  v_cabinet := app.current_cabinet();

  IF v_role IS DISTINCT FROM 'assistant' THEN
    RETURN false;
  END IF;

  UPDATE app.assistant_calls c
     SET acknowledged_at = coalesce(c.acknowledged_at, now()),
         acknowledged_by = coalesce(c.acknowledged_by, auth.uid()),
         status = 'acknowledged'
   WHERE c.cabinet_id = v_cabinet
     AND c.id = p_call_id
  RETURNING c.id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$$;

ALTER FUNCTION app.acknowledge_assistant_call(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.acknowledge_assistant_call(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.acknowledge_assistant_call(uuid) TO authenticated;

COMMENT ON FUNCTION app.acknowledge_assistant_call(uuid) IS
  '178. Seul geste qui prouve qu''une personne a vu l''alerte. Rejouable.';

-- Appel encore actif, pour que l'accueil le retrouve après une reconnexion ou
-- un redémarrage sans dépendre d'un événement déjà consommé.
CREATE OR REPLACE FUNCTION app.get_active_assistant_call()
RETURNS TABLE (
  call_id     uuid,
  caller_name text,
  etat        text,
  cree_le     timestamptz,
  expire_le   timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE v_cabinet uuid;
BEGIN
  v_cabinet := app.current_cabinet();
  IF v_cabinet IS NULL THEN RETURN; END IF;

  UPDATE app.assistant_calls c
     SET status = 'expired'
   WHERE c.cabinet_id = v_cabinet
     AND c.status IN ('sent','delivered')
     AND c.expires_at <= now();

  RETURN QUERY
  SELECT c.id, c.caller_name, c.status, c.created_at, c.expires_at
    FROM app.assistant_calls c
   WHERE c.cabinet_id = v_cabinet
     AND c.status IN ('sent','delivered')
     AND c.created_at > now() - interval '5 minutes'
   ORDER BY c.created_at DESC
   LIMIT 1;
END;
$$;

ALTER FUNCTION app.get_active_assistant_call() OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_active_assistant_call() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_active_assistant_call() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · La messagerie interne du cabinet
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.internal_messages (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id    uuid NOT NULL REFERENCES app.cabinets(id),
    -- Idempotence d'envoi : généré par le poste AVANT l'appel. Un rejeu après
    -- coupure réseau rend la même ligne, jamais un doublon.
    client_msg_id uuid NOT NULL,
    sender_id     uuid NOT NULL REFERENCES app.profiles(id),
    sender_role   app.user_role NOT NULL,
    sender_name   text NOT NULL,
    body          text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
    created_at    timestamptz NOT NULL DEFAULT now(),
    delivered_at  timestamptz,
    read_at       timestamptz,
    read_by       uuid REFERENCES app.profiles(id)
);

CREATE INDEX IF NOT EXISTS internal_messages_cabinet_created
    ON app.internal_messages (cabinet_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS internal_messages_client_unique
    ON app.internal_messages (cabinet_id, client_msg_id);

ALTER TABLE app.internal_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.internal_messages FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON app.internal_messages FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON app.internal_messages TO app_gatekeeper;

CREATE POLICY internal_messages_gate ON app.internal_messages
  FOR ALL TO app_gatekeeper
  USING      (cabinet_id = app.current_cabinet() OR app.current_cabinet() IS NULL)
  WITH CHECK (cabinet_id = app.current_cabinet() OR app.current_cabinet() IS NULL);

COMMENT ON TABLE app.internal_messages IS
  '178. Messagerie texte INTERNE médecin ↔ accueil. Distincte de '
  'app.communication_* (canal patient externe, 112). N''accepte aucune pièce '
  'jointe, aucun audio. Aucun DELETE (règle 3) : la rétention passe par les '
  'sauvegardes, pas par une suppression.';

-- Envoi. Idempotent sur (cabinet_id, client_msg_id) : un rejeu rend la ligne
-- existante et `deja_present = true`, sans second message ni seconde
-- notification.
CREATE OR REPLACE FUNCTION app.send_internal_message(
  p_client_msg_id uuid,
  p_body          text)
RETURNS TABLE (
  id          uuid,
  cree_le     timestamptz,
  deja_present boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_role    app.user_role;
  v_cabinet uuid;
  v_name    text;
  v_body    text;
  v_id      uuid;
  v_created timestamptz;
BEGIN
  v_role    := app.current_role();
  v_cabinet := app.current_cabinet();
  v_body    := btrim(coalesce(p_body, ''));

  IF v_role IS NULL OR v_role NOT IN ('owner','practitioner','assistant') THEN
    RAISE EXCEPTION 'Messagerie réservée au personnel du cabinet.';
  END IF;
  IF v_cabinet IS NULL THEN
    RAISE EXCEPTION 'Cabinet introuvable.';
  END IF;
  IF p_client_msg_id IS NULL THEN
    RAISE EXCEPTION 'Identifiant de message absent.';
  END IF;
  IF char_length(v_body) < 1 THEN
    RAISE EXCEPTION 'Message vide.';
  END IF;
  IF char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'Message trop long (1 000 caractères maximum).';
  END IF;

  -- Rejeu fidèle : même identifiant, même cabinet → même ligne.
  SELECT m.id, m.created_at INTO v_id, v_created
    FROM app.internal_messages m
   WHERE m.cabinet_id = v_cabinet AND m.client_msg_id = p_client_msg_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, v_created, true;
    RETURN;
  END IF;

  SELECT pr.full_name INTO v_name FROM app.profiles pr WHERE pr.id = auth.uid();
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Profil expéditeur introuvable.';
  END IF;

  INSERT INTO app.internal_messages AS m
      (cabinet_id, client_msg_id, sender_id, sender_role, sender_name, body)
  VALUES (v_cabinet, p_client_msg_id, auth.uid(), v_role, v_name, v_body)
  RETURNING m.id, m.created_at INTO v_id, v_created;

  RETURN QUERY SELECT v_id, v_created, false;
END;
$$;

ALTER FUNCTION app.send_internal_message(uuid, text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.send_internal_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.send_internal_message(uuid, text) TO authenticated;

COMMENT ON FUNCTION app.send_internal_message(uuid, text) IS
  '178. Envoi idempotent d''un message interne. `client_msg_id` est le contrat '
  'de rejeu : le même identifiant ne produit jamais un second message.';

-- Lecture. Marque `delivered_at` sur les messages REÇUS (pas les siens), et
-- rend les N derniers dans l'ordre chronologique. Le plafond est en base, comme
-- `search_patients` : une liste que l'appelant choisit sans borne est un export.
CREATE OR REPLACE FUNCTION app.list_internal_messages(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id          uuid,
  sender_id   uuid,
  sender_role app.user_role,
  sender_name text,
  corps       text,
  cree_le     timestamptz,
  remis_le    timestamptz,
  lu_le       timestamptz,
  non_lu      boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_role    app.user_role;
  v_cabinet uuid;
  v_limit   integer := least(greatest(coalesce(p_limit, 100), 1), 200);
BEGIN
  v_role    := app.current_role();
  v_cabinet := app.current_cabinet();

  IF v_role IS NULL OR v_role NOT IN ('owner','practitioner','assistant') THEN RETURN; END IF;
  IF v_cabinet IS NULL THEN RETURN; END IF;

  -- Remise : un message lu par l'autre camp est « remis » par définition.
  UPDATE app.internal_messages m
     SET delivered_at = now()
   WHERE m.cabinet_id = v_cabinet
     AND m.sender_id <> auth.uid()
     AND m.delivered_at IS NULL;

  -- `non_lu` est calculé ICI, pas dans le navigateur : le client ne connaît pas
  -- forcément son propre `auth.uid()`, et un badge qui compterait ses propres
  -- messages comme « non lus » serait faux dès le premier envoi.
  RETURN QUERY
  SELECT s.id, s.sender_id, s.sender_role, s.sender_name, s.body,
         s.created_at, s.delivered_at, s.read_at,
         (s.sender_id <> auth.uid() AND s.read_at IS NULL)
    FROM (
      SELECT m.*
        FROM app.internal_messages m
       WHERE m.cabinet_id = v_cabinet
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT v_limit
    ) s
   ORDER BY s.created_at ASC, s.id ASC;
END;
$$;

ALTER FUNCTION app.list_internal_messages(integer) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_internal_messages(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_internal_messages(integer) TO authenticated;

-- Marquage « lu ». L'accueil marque les messages du médecin ; le médecin marque
-- ceux de l'accueil. Un message qu'on s'est envoyé à soi-même n'est jamais
-- « non lu ».
CREATE OR REPLACE FUNCTION app.mark_internal_messages_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_role    app.user_role;
  v_cabinet uuid;
  v_n       integer;
BEGIN
  v_role    := app.current_role();
  v_cabinet := app.current_cabinet();

  IF v_role IS NULL OR v_role NOT IN ('owner','practitioner','assistant') THEN RETURN 0; END IF;
  IF v_cabinet IS NULL THEN RETURN 0; END IF;

  UPDATE app.internal_messages m
     SET read_at = now(), read_by = auth.uid()
   WHERE m.cabinet_id = v_cabinet
     AND m.read_at IS NULL
     AND m.sender_id <> auth.uid()
     AND CASE
           WHEN v_role = 'assistant' THEN m.sender_role IN ('owner','practitioner')
           ELSE m.sender_role = 'assistant'
         END;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

ALTER FUNCTION app.mark_internal_messages_read() OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.mark_internal_messages_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mark_internal_messages_read() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5 · Le compte de l'accueil, sur une vraie base
-- ---------------------------------------------------------------------------
-- Constat mesuré : après `app.purge_fixtures_015()`, `…a3` n'existe plus, et
-- `app.provision_owner_account()` refuse un second appel. Sans ces deux portes,
-- une installation cabinet n'a aucun chemin pour créer le compte de l'accueil.
--
-- Le compte porte un `username` dans `raw_user_meta_data`, comme `158` le lit,
-- et un courriel interne `<login>@mindcare.local` qui n'est JAMAIS envoyé : il
-- n'y a pas de serveur de courriel dans le cabinet, et `auth.verify_login`
-- accepte l'un ou l'autre.
CREATE OR REPLACE FUNCTION app.get_assistant_account_status()
RETURNS TABLE (
  user_id     uuid,
  identifiant text,
  nom_complet text,
  actif       boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, auth, pg_catalog
AS $$
DECLARE
  v_cabinet uuid;
  v_role    app.user_role;
BEGIN
  v_role    := app.current_role();
  v_cabinet := app.current_cabinet();

  IF v_role IS DISTINCT FROM 'owner' OR v_cabinet IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT u.id,
         coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
         p.full_name,
         (u.is_active AND p.is_active)
    FROM app.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE p.cabinet_id = v_cabinet
     AND p.role = 'assistant'
   ORDER BY p.created_at
   LIMIT 1;
END;
$$;

ALTER FUNCTION app.get_assistant_account_status() OWNER TO staff_gatekeeper;
REVOKE ALL ON FUNCTION app.get_assistant_account_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_assistant_account_status() TO authenticated;

COMMENT ON FUNCTION app.get_assistant_account_status() IS
  '178. Rend le compte d''accueil du cabinet, ou zéro ligne. `owner` seulement. '
  'Rend `actif` = profil ET compte ensemble : les deux doivent être vrais pour '
  'que verify_password ouvre une session (070 §4a).';

CREATE OR REPLACE FUNCTION app.manage_assistant_account(
  p_full_name text,
  p_login     text,
  p_password  text DEFAULT NULL,
  p_is_active boolean DEFAULT true)
RETURNS TABLE (
  user_id     uuid,
  identifiant text,
  nom_complet text,
  actif       boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, auth, pg_catalog
AS $$
DECLARE
  v_role      app.user_role;
  v_cabinet   uuid;
  v_login     text := lower(btrim(coalesce(p_login, '')));
  v_name      text := btrim(coalesce(p_full_name, ''));
  v_email     text;
  v_existing  uuid;
  v_user      uuid;
BEGIN
  v_role    := app.current_role();
  v_cabinet := app.current_cabinet();

  -- Décision d'AUTORISATION, assumée ici : la RLS ne peut pas exprimer « seul
  -- l'owner gère les comptes » (auth.users n'a pas de policy par identité), et
  -- c'est exactement le motif des portes financières de 029/036 (ADR-005).
  IF v_role IS DISTINCT FROM 'owner' OR v_cabinet IS NULL THEN
    RAISE EXCEPTION 'Seul le médecin titulaire gère les comptes du personnel.';
  END IF;

  IF v_name = '' OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'Le nom complet est obligatoire (120 caractères maximum).';
  END IF;
  IF v_login !~ '^[a-z0-9][a-z0-9._-]{2,31}$' THEN
    RAISE EXCEPTION
      'Identifiant invalide : 3 à 32 caractères, lettres minuscules, chiffres, point, tiret ou souligné.'
      USING HINT = 'Exemple : accueil, secretaire.cabinet';
  END IF;
  IF p_password IS NOT NULL
     AND (octet_length(p_password) < 10 OR octet_length(p_password) > 72) THEN
    RAISE EXCEPTION 'Le mot de passe doit compter entre 10 et 72 caractères.';
  END IF;

  v_email := v_login || '@mindcare.local';

  -- Cette version gère UN compte d'accueil par cabinet : deux comptes actifs
  -- sur le même poste rendraient l'alerte ambiguë (« qui a vu ? »).
  SELECT p.id INTO v_existing
    FROM app.profiles p
   WHERE p.cabinet_id = v_cabinet AND p.role = 'assistant'
   ORDER BY p.created_at
   LIMIT 1;

  IF v_existing IS NULL THEN
    IF p_password IS NULL THEN
      RAISE EXCEPTION 'Un mot de passe est obligatoire à la création du compte.';
    END IF;
    IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email) THEN
      RAISE EXCEPTION 'Cet identifiant est déjà utilisé par un autre compte.';
    END IF;

    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_user_meta_data, is_active, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', v_email,
      public.crypt(p_password, public.gen_salt('bf')),
      now(),
      jsonb_build_object('username', v_login),
      p_is_active, now(), now())
    RETURNING id INTO v_user;

    INSERT INTO app.profiles (id, cabinet_id, role, full_name, is_active)
    VALUES (v_user, v_cabinet, 'assistant', v_name, p_is_active);
  ELSE
    v_user := v_existing;

    UPDATE app.profiles p
       SET full_name = v_name, is_active = p_is_active, updated_at = now()
     WHERE p.id = v_user AND p.cabinet_id = v_cabinet;

    UPDATE auth.users u
       SET email = v_email,
           raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
                                || jsonb_build_object('username', v_login),
           is_active = p_is_active,
           updated_at = now(),
           encrypted_password = CASE
             WHEN p_password IS NULL THEN u.encrypted_password
             ELSE public.crypt(p_password, public.gen_salt('bf'))
           END
     WHERE u.id = v_user;

    -- Désactiver un compte doit fermer la porte TOUT DE SUITE, pas à
    -- l'expiration de la session : `070` réduit déjà la fenêtre à 24 h, ce qui
    -- reste trop long pour un poste qu'on retire.
    IF NOT p_is_active THEN
      DELETE FROM auth.sessions s WHERE s.user_id = v_user;
    END IF;
  END IF;

  RETURN QUERY
  SELECT u.id,
         coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
         p.full_name,
         (u.is_active AND p.is_active)
    FROM app.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE p.id = v_user;
END;
$$;

ALTER FUNCTION app.manage_assistant_account(text, text, text, boolean)
  OWNER TO staff_gatekeeper;
REVOKE ALL ON FUNCTION app.manage_assistant_account(text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.manage_assistant_account(text, text, text, boolean)
  TO authenticated;

COMMENT ON FUNCTION app.manage_assistant_account(text, text, text, boolean) IS
  '178. Crée, met à jour, réinitialise ou désactive le compte d''accueil. '
  '`owner` seulement. Le courriel interne `<login>@mindcare.local` n''est jamais '
  'envoyé : il ne sert qu''à la contrainte UNIQUE de auth.users et à '
  'auth.verify_login (158). Une désactivation supprime les sessions ouvertes.';

-- ---------------------------------------------------------------------------
-- 5bis · La porte qui autorise la gestion des postes
-- ---------------------------------------------------------------------------
-- Les invitations et le registre des appareils vivent dans le dossier privé
-- (SYSTEM + Administrateurs), donc hors de portée de la RLS. La décision
-- « qui peut générer un code ou révoquer un poste » doit néanmoins rester en
-- base : les routes `/api/cabinet/*` appellent cette porte AVANT d'écrire, et
-- refusent si elle rend faux. Une porte booléenne se contourne comme toute
-- porte ; ce qu'on refuse, c'est de laisser la règle vivre uniquement dans un
-- `if` de route.
CREATE OR REPLACE FUNCTION app.autoriser_gestion_postes()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  SELECT app.current_role() = 'owner';
$$;

ALTER FUNCTION app.autoriser_gestion_postes() OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.autoriser_gestion_postes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.autoriser_gestion_postes() TO authenticated;

COMMENT ON FUNCTION app.autoriser_gestion_postes() IS
  '178. Vrai pour le seul `owner`. Appelée par les routes de gestion des '
  'postes avant toute écriture dans %ProgramData%\MindCare\private.';

-- ---------------------------------------------------------------------------
-- 6 · Le rattrapage du flux et la lecture des événements
-- ---------------------------------------------------------------------------
-- Une seule porte pour le flux SSE : elle rend le maximum courant ET les
-- événements postérieurs au curseur du client. Le client n'a donc jamais à
-- deviner s'il a manqué quelque chose — il demande, il reçoit, il avance.
--
-- Le balayage de rétention (7 jours) vit ici et non dans le déclencheur : une
-- suppression par écriture ajouterait un coût et un risque de verrou à chaque
-- geste métier. Un appel par connexion SSE suffit.
CREATE OR REPLACE FUNCTION app.list_cabinet_events_since(
  p_since_seq bigint DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_role    app.user_role;
  v_cabinet uuid;
  v_max     bigint;
  v_events  jsonb;
BEGIN
  v_role    := app.current_role();
  v_cabinet := app.current_cabinet();

  IF v_role IS NULL OR v_role NOT IN ('owner','practitioner','assistant')
     OR v_cabinet IS NULL THEN
    RETURN NULL;
  END IF;

  DELETE FROM app.cabinet_events c
   WHERE c.cabinet_id = v_cabinet
     AND c.occurred_at < now() - interval '7 days';

  SELECT coalesce(max(c.seq), 0) INTO v_max
    FROM app.cabinet_events c
   WHERE c.cabinet_id = v_cabinet;

  SELECT coalesce(jsonb_agg(obj ORDER BY seq), '[]'::jsonb) INTO v_events
    FROM (
      SELECT c.seq,
             jsonb_build_object(
               'seq',         c.seq,
               'kind',        c.kind,
               'target_role', c.target_role,
               'entity_id',   c.entity_id,
               'occurred_at', c.occurred_at) AS obj
        FROM app.cabinet_events c
       WHERE c.cabinet_id = v_cabinet
         AND c.seq > coalesce(p_since_seq, 0)
         AND (c.target_role IS NULL OR c.target_role = v_role)
       ORDER BY c.seq
       LIMIT 200
    ) s;

  RETURN jsonb_build_object('max_seq', v_max, 'events', v_events);
END;
$$;

ALTER FUNCTION app.list_cabinet_events_since(bigint) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_cabinet_events_since(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_cabinet_events_since(bigint) TO authenticated;

COMMENT ON FUNCTION app.list_cabinet_events_since(bigint) IS
  '178. Rattrapage du flux temps réel : maximum courant + événements visibles '
  'par le rôle appelant au-delà du curseur. Plafond 200 par appel ; le client '
  'rappelle si max_seq n''est pas atteint. Rétention 7 jours.';

-- ---------------------------------------------------------------------------
-- 7 · Les déclencheurs — événements, puis audit
-- ---------------------------------------------------------------------------
-- Attachement idempotent. `DROP TRIGGER IF EXISTS` puis `CREATE` : rejouable
-- sans effet de bord, et le nom reste stable pour la revue. Les cinq tables
-- existent maintenant : §1 pour les trois du cabinet, §3 et §4 pour les deux
-- nouvelles.
DO $bloc$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['appointments','payments','notifications',
                           'internal_messages','assistant_calls'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_cabinet_event ON app.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_cabinet_event AFTER INSERT OR UPDATE ON app.%I '
      'FOR EACH ROW EXECUTE FUNCTION app.emit_cabinet_event()', t);
  END LOOP;
END $bloc$;

-- Les deux tables porteuses de contenu portent `trg_audit`, comme toute
-- écriture du cabinet (règle 5). `cabinet_events` en est volontairement EXCLUE :
-- c'est de la télémétrie dérivée d'écritures déjà auditées ; l'auditer
-- doublerait le journal sans ajouter une seule preuve.
DO $bloc$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assistant_calls','internal_messages'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit ON app.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.%I '
      'FOR EACH ROW EXECUTE FUNCTION audit.track()', t);
  END LOOP;
END $bloc$;

-- ---------------------------------------------------------------------------
-- 8 · Refermer les privilèges de transfert
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
REVOKE CREATE ON SCHEMA app FROM staff_gatekeeper;
REVOKE CREATE ON SCHEMA auth FROM staff_gatekeeper;

-- Un porteur qui peut créer dans `app` ou `auth` pourrait y planter une
-- fonction masquant une fonction du `search_path` figé des portes. Le
-- privilège n'est nécessaire qu'à l'instant du transfert de propriété.
DO $bloc$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles
              WHERE rolname = 'staff_gatekeeper'
                AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'staff_gatekeeper a acquis SUPERUSER, BYPASSRLS ou LOGIN.';
  END IF;

  IF has_schema_privilege('staff_gatekeeper', 'app', 'CREATE')
     OR has_schema_privilege('staff_gatekeeper', 'auth', 'CREATE') THEN
    RAISE EXCEPTION 'staff_gatekeeper peut créer un objet dans app ou auth.';
  END IF;

  -- La porte de gestion du personnel ne doit jamais pouvoir lire un dossier.
  IF has_table_privilege('staff_gatekeeper', 'app.patients', 'SELECT') THEN
    RAISE EXCEPTION 'staff_gatekeeper peut lire app.patients.';
  END IF;
END $bloc$;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('178_cabinet_lan_collaboration')
  ON CONFLICT DO NOTHING;

COMMIT;
