-- 071_egress_gatekeeper — la porte d'écriture du journal de franchissement.
--
-- ═══ CE QUE CETTE MIGRATION REMPLACE ════════════════════════════════════════
--
-- `028_boundary_crossings.sql` écrit noir sur blanc : « Seul `service_role`, qui
-- contourne la RLS par conception et qui vit exclusivement dans
-- `external-call.ts`, y insère. »
--
-- En auto-hébergé, `service_role` n'a plus de connexion : la clé de service
-- disparaît avec Supabase (phase 6), et l'application se connecte uniquement en
-- `mindcare_app`, qui n'a par conception AUCUN droit hors `SET LOCAL ROLE`.
-- Sans cette migration, le journal de franchissement cesserait donc simplement
-- d'être écrit — en silence, puisque `journaliser()` avale ses échecs. Un
-- journal d'audit qui ne consigne plus rien SANS LE DIRE est pire que pas de
-- journal : on continue de lui faire confiance.
--
-- ═══ POURQUOI C'EST PLUS ÉTROIT QUE CE QUI EXISTAIT ════════════════════════
--
-- `service_role` portait `rolbypassrls` : il pouvait lire et écrire N'IMPORTE
-- QUELLE table du cabinet, y compris `app.patients`. On lui faisait confiance
-- parce qu'il « vivait exclusivement dans external-call.ts » — une garantie de
-- DISCIPLINE, pas de moteur.
--
-- `egress_gatekeeper` ne peut faire qu'une chose : INSÉRER une ligne dans
-- `audit.boundary_crossings`. Pas de SELECT (on ne relit pas le journal depuis
-- l'application), pas d'UPDATE, pas de DELETE — le journal reste en ajout seul —
-- et rien du tout ailleurs. La garantie devient structurelle.
--
-- ═══ POURQUOI PAS `authenticated` ══════════════════════════════════════════
--
-- Parce que ce journal ne doit pas être FORGEABLE. S'il était exécutable par
-- `authenticated`, un appelant du réseau pourrait fabriquer des lignes — donc
-- noyer un franchissement réel sous du bruit, ou fabriquer la preuve d'un appel
-- qui n'a pas eu lieu. L'`EXECUTE` va donc à `mindcare_app` SEUL, qui est le
-- rôle de CONNEXION du serveur : un `SET LOCAL ROLE authenticated` le lui fait
-- perdre (NOINHERIT, bootstrap 010). Aucune requête servie pour le compte d'une
-- utilisatrice ne peut donc écrire ici.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Le rôle porteur
-- ---------------------------------------------------------------------------
DO $bloc$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'egress_gatekeeper') THEN
    CREATE ROLE egress_gatekeeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
                                  INHERIT NOREPLICATION;
  END IF;
END $bloc$;

DO $bloc$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolbypassrls, rolcanlogin INTO r
    FROM pg_roles WHERE rolname = 'egress_gatekeeper';
  IF r.rolsuper OR r.rolbypassrls THEN
    RAISE EXCEPTION
      'egress_gatekeeper porte SUPERUSER ou BYPASSRLS : on aurait recree service_role.'
      USING HINT = 'Tout l''interet de 071 est de NE PAS avoir ce pouvoir.';
  END IF;
  IF r.rolcanlogin THEN
    RAISE EXCEPTION 'egress_gatekeeper peut ouvrir une session : il ne doit jamais le pouvoir.';
  END IF;
END $bloc$;

COMMENT ON ROLE egress_gatekeeper IS
  'Proprietaire de la porte d''ecriture du journal de franchissement (071). '
  'Ne peut QUE inserer dans audit.boundary_crossings. Remplace service_role, '
  'qui pouvait tout lire.';

-- ---------------------------------------------------------------------------
-- 2 · Les privilèges — INSERT seulement, sur une seule table
-- ---------------------------------------------------------------------------
GRANT USAGE  ON SCHEMA audit                            TO egress_gatekeeper;
GRANT INSERT ON audit.boundary_crossings                TO egress_gatekeeper;
GRANT USAGE  ON SEQUENCE audit.boundary_crossings_id_seq TO egress_gatekeeper;

-- 028 pose FORCE RLS sans aucune policy. On en ajoute UNE, en INSERT seul, qui
-- ne nomme que ce rôle : la table reste inaccessible à tous les autres, y
-- compris en lecture, exactement comme 028 le voulait.
DROP POLICY IF EXISTS boundary_crossings_egress_insert ON audit.boundary_crossings;
CREATE POLICY boundary_crossings_egress_insert ON audit.boundary_crossings
  FOR INSERT TO egress_gatekeeper WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3 · La porte
-- ---------------------------------------------------------------------------
-- Elle ne décide rien et ne lit rien : elle écrit une ligne. Les contraintes de
-- 028 (et l'élargissement de `purpose` par 034/054) restent seules juges de ce
-- qui est acceptable — cette fonction ne les redouble pas, pour qu'il n'y ait
-- qu'un endroit à corriger le jour où un nouveau `purpose` apparaît.
GRANT CREATE ON SCHEMA audit TO egress_gatekeeper;

CREATE OR REPLACE FUNCTION audit.log_boundary_crossing(
  p_purpose            text,
  p_provider           text,
  p_model              text,
  p_prompt_version     text,
  p_prompt_hash        text,
  p_session_token      uuid,
  p_chars_out          integer,
  p_tokens_in          integer,
  p_tokens_out         integer,
  p_estimated_cost_usd numeric,
  p_outcome            text,
  p_latency_ms         integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = audit, pg_catalog
AS $corps$
  INSERT INTO audit.boundary_crossings
    (purpose, provider, model, prompt_version, prompt_hash, session_token,
     chars_out, tokens_in, tokens_out, estimated_cost_usd, outcome, latency_ms)
  VALUES
    (p_purpose, p_provider, p_model, p_prompt_version, p_prompt_hash, p_session_token,
     p_chars_out, p_tokens_in, p_tokens_out, p_estimated_cost_usd, p_outcome, p_latency_ms);
$corps$;

ALTER FUNCTION audit.log_boundary_crossing(text, text, text, text, text, uuid,
                                           integer, integer, integer, numeric,
                                           text, integer)
  OWNER TO egress_gatekeeper;

REVOKE CREATE ON SCHEMA audit FROM egress_gatekeeper;

-- ---------------------------------------------------------------------------
-- 4 · Qui peut franchir cette porte
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION audit.log_boundary_crossing(text, text, text, text, text, uuid,
                                                   integer, integer, integer, numeric,
                                                   text, integer) FROM PUBLIC;

DO $bloc$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mindcare_app') THEN
    GRANT USAGE ON SCHEMA audit TO mindcare_app;
    GRANT EXECUTE ON FUNCTION audit.log_boundary_crossing(text, text, text, text, text, uuid,
                                                          integer, integer, integer, numeric,
                                                          text, integer) TO mindcare_app;
  END IF;
END $bloc$;

-- ---------------------------------------------------------------------------
-- 5 · Les assertions
-- ---------------------------------------------------------------------------
DO $bloc$
BEGIN
  -- Le journal reste INFORGEABLE depuis une requête servie pour une utilisatrice.
  IF has_function_privilege('authenticated', 'audit.log_boundary_crossing(text, text, text, text, text, uuid, integer, integer, integer, numeric, text, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'audit.log_boundary_crossing(text, text, text, text, text, uuid, integer, integer, integer, numeric, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'anon ou authenticated peut ecrire dans le journal de franchissement.'
      USING HINT = 'Le journal deviendrait forgeable depuis le reseau.';
  END IF;

  -- Et il reste ILLISIBLE, comme 028 l'a voulu.
  --
  -- ⚠️ `mindcare_app` EST TESTÉ SÉPARÉMENT, ET C'EST OBLIGATOIRE.
  -- `has_table_privilege()` LÈVE si le rôle n'existe pas, et sur une
  -- installation NEUVE il n'existe pas encore : le bootstrap 010 est joué
  -- APRÈS la chaîne de migrations. Cette assertion faisait donc échouer 071
  -- sur toute base fraîche, alors qu'elle passait sur une base déjà
  -- provisionnée — le même piège qu'en phase 3, et il n'a été vu que par une
  -- reconstruction depuis zéro. « Vert incrémental n'est pas vert intégré. »
  IF has_table_privilege('authenticated', 'audit.boundary_crossings', 'SELECT') THEN
    RAISE EXCEPTION 'audit.boundary_crossings est devenue lisible par l''application.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mindcare_app')
     AND has_table_privilege('mindcare_app', 'audit.boundary_crossings', 'SELECT') THEN
    RAISE EXCEPTION 'audit.boundary_crossings est lisible par le role de connexion.';
  END IF;

  -- Le porteur ne doit pas avoir gagne autre chose au passage.
  IF has_table_privilege('egress_gatekeeper', 'app.patients', 'SELECT')
     OR has_table_privilege('egress_gatekeeper', 'audit.boundary_crossings', 'DELETE')
     OR has_table_privilege('egress_gatekeeper', 'audit.boundary_crossings', 'UPDATE') THEN
    RAISE EXCEPTION
      'egress_gatekeeper depasse l''ajout seul dans son unique table.'
      USING HINT = 'Le journal doit rester en ajout seul (I4).';
  END IF;
END $bloc$;

INSERT INTO app.schema_migrations (version) VALUES ('071_egress_gatekeeper')
  ON CONFLICT DO NOTHING;

COMMIT;
