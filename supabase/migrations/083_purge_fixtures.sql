-- 083_purge_fixtures — la garantie « zéro donnée de test » de la phase Bureau
-- Windows (Electron), §D du plan `mindcare-os-robust-wigderson.md`.
--
-- ═══ CE QUE CE FICHIER FAIT, ET NE FAIT PAS ════════════════════════════════
--
-- Il ne SUPPRIME rien lui-même : il DÉFINIT `app.purge_fixtures_015()`, une
-- fonction que l'orchestrateur Electron appelle une seule fois, juste après
-- avoir posé `app.deployment.environment = 'self-hosted'` (installation
-- cabinet réelle). Sur une base de DÉVELOPPEMENT, où l'environnement reste
-- 'cloud-dev', cette fonction REFUSE de s'exécuter — les fixtures de
-- `015_seed_data.sql` y restent intactes, exactement comme aujourd'hui.
--
-- ═══ POURQUOI PAS DANS 015 ELLE-MÊME (règle 9 de CLAUDE.md) ════════════════
--
-- 015 est déjà appliquée sur toute base existante ; on ne la modifie pas. Et
-- même sur une base neuve, l'ordre d'application (000 → 001…082 → 016 posé
-- APRÈS 015, cf. son en-tête) fait qu'AUCUNE migration ne peut savoir, au
-- moment où elle s'exécute, si elle tourne en développement ou dans un
-- cabinet réel : `app.deployment` n'existe pas encore avant 016, et
-- `set_deployment_environment('cloud-dev', …)` — qui l'amorce — s'exécute
-- avant même le rattachement du garde-fou synthétique. La seule bascule
-- fiable vers 'self-hosted' a lieu APRÈS la chaîne complète, au provisionnement
-- (§C, §D) — donc la purge doit être un geste POSTÉRIEUR, pas une migration.
--
-- ⚠️ 015 N'EST PAS LA SEULE MIGRATION QUI SÈME. `038_charges.sql` amorce cinq
-- charges récurrentes et deux ponctuelles pour LE MÊME cabinet/praticien de
-- test, avec `is_synthetic = true` explicite (elle aussi conditionnée par
-- « aucune charge existante » — donc elle ne s'exécute que sur cette même base
-- neuve). DÉCOUVERT PAR EXÉCUTION RÉELLE contre PostgreSQL 16, pas par
-- relecture : une première version de cette fonction, qui ne purgeait que les
-- tables de 015, échouait sur `charges_practitioner_id_fkey` en tentant de
-- supprimer les profils — éprouvé contre un PostgreSQL 16 jetable, chaîne
-- complète 000→083.
--
-- ═══ PORTÉE, ET POURQUOI ELLE EST ÉTROITE À DESSEIN ═════════════════════════
--
-- Seules les lignes que 015 (et 038, pour les charges) ont écrites sont
-- visées, par DEUX filtres qui se recoupent :
--   · les tables cliniques (patients, RDV, notes) sont filtrées par
--     `is_synthetic = true` — la colonne que 016 a posée SUR CES LIGNES
--     PRÉCISÉMENT, rétroactivement, à la création du garde-fou cloud (§4 de
--     016). Une ligne saisie ensuite par la praticienne ne porte jamais
--     `is_synthetic = true` : le garde-fou de 016 le lui interdit à l'écriture ;
--   · l'identité (comptes, profils, compteurs — PAS le cabinet, voir plus
--     bas) n'a pas de colonne `is_synthetic` (ce ne sont pas des tables
--     Tier 0/1 au sens de 016) et est donc filtrée par les UUID FIXES que
--     015 écrit en dur — les mêmes dix constantes, aucune autre.
--
-- Cette fonction ne touche donc jamais une ligne créée après l'installation,
-- quelle que soit sa ressemblance avec une fixture.
--
-- ═══ LA RÈGLE 3 DE CLAUDE.md, ET POURQUOI ELLE NE S'APPLIQUE PAS ICI ═══════
--
-- « Aucun DELETE sur une donnée clinique ou financière » protège les DOSSIERS
-- RÉELS d'un cabinet, pas les fixtures qu'un garde-fou indépendant (016)
-- désigne explicitement comme synthétiques. Les supprimer avant la première
-- connexion réelle n'efface pas d'historique clinique : il n'en existe pas
-- encore. `app.clinical_notes` porte une RÈGLE `no_delete_notes` qui interdit
-- justement ce DELETE en fonctionnement normal (008) — cette fonction la
-- désactive le temps d'une transaction, UNIQUEMENT pour la ligne synthétique
-- verrouillée du seed, puis la réactive avant de rendre la main. Elle ne
-- l'assouplit pour personne d'autre.
--
-- ═══ IDEMPOTENTE ═════════════════════════════════════════════════════════
-- Rejouable sans effet : une base déjà purgée (ou qui n'a jamais vu 015)
-- rend un compte de lignes supprimées à zéro, pas une erreur.

BEGIN;

CREATE OR REPLACE FUNCTION app.purge_fixtures_015()
RETURNS TABLE(table_purgee text, lignes_supprimees bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  env text;
  n   bigint;
BEGIN
  SELECT environment INTO env FROM app.deployment WHERE singleton;

  IF env IS DISTINCT FROM 'self-hosted' THEN
    RAISE EXCEPTION
      'app.purge_fixtures_015() refuse hors installation cabinet (self-hosted). '
      'Environnement actuel : %.', COALESCE(env, 'NULL (jamais basculé)')
      USING HINT = 'Cette purge ne doit jamais s''exécuter sur une base de développement.';
  END IF;

  -- Ordre imposé par les clés étrangères : RDV/notes avant patients, patients
  -- avant profils/compteurs/charges. Le cabinet n'est PAS supprimé (voir plus
  -- bas) — seuls les comptes auth.users le sont, apres les profils.

  DELETE FROM app.appointment_reasons
    WHERE appointment_id = '00000000-0000-0000-0000-0000000000d1';
  -- (déjà couvert par ON DELETE CASCADE depuis appointments, ligne ci-dessus
  -- redondante par prudence : explicite plutôt qu'implicite pour une purge.)

  DELETE FROM app.appointments
    WHERE id = '00000000-0000-0000-0000-0000000000d1' AND is_synthetic = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  table_purgee := 'app.appointments'; lignes_supprimees := n; RETURN NEXT;

  ALTER TABLE app.clinical_notes DISABLE RULE no_delete_notes;
  DELETE FROM app.clinical_notes
    WHERE id = '00000000-0000-0000-0000-0000000000c1' AND is_synthetic = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  ALTER TABLE app.clinical_notes ENABLE RULE no_delete_notes;
  table_purgee := 'app.clinical_notes'; lignes_supprimees := n; RETURN NEXT;

  DELETE FROM app.patients
    WHERE id IN ('00000000-0000-0000-0000-0000000000b1',
                 '00000000-0000-0000-0000-0000000000b2')
      AND is_synthetic = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  table_purgee := 'app.patients'; lignes_supprimees := n; RETURN NEXT;

  DELETE FROM app.counters
    WHERE cabinet_id = '00000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  table_purgee := 'app.counters'; lignes_supprimees := n; RETURN NEXT;

  -- 038_charges.sql : cinq charges récurrentes et deux ponctuelles, amorcées
  -- pour ce même cabinet/praticien à l'application de cette migration-là.
  -- `is_synthetic = true` est écrit explicitement par 038 (pas rétroactivement
  -- par 016, `app.charges` n'a pas de `patient_id`) — le filtre reste donc le
  -- même principe : ne jamais toucher une charge saisie après coup.
  DELETE FROM app.charges
    WHERE cabinet_id = '00000000-0000-0000-0000-000000000001' AND is_synthetic = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  table_purgee := 'app.charges'; lignes_supprimees := n; RETURN NEXT;

  DELETE FROM app.profiles
    WHERE id IN ('00000000-0000-0000-0000-0000000000a1',
                 '00000000-0000-0000-0000-0000000000a2',
                 '00000000-0000-0000-0000-0000000000a3');
  GET DIAGNOSTICS n = ROW_COUNT;
  table_purgee := 'app.profiles'; lignes_supprimees := n; RETURN NEXT;

  -- ⚠️ `app.cabinets` N'EST JAMAIS SUPPRIMÉ ICI, ET C'EST DÉLIBÉRÉ.
  -- `app.document_templates` (044/045) porte le VRAI contenu des modèles de
  -- documents de la praticienne — pas une fixture — rattaché par
  -- `cabinet_id REFERENCES app.cabinets(id) NOT NULL`, à ce même cabinet-ci.
  -- Le supprimer effacerait ce contenu réel avec le cabinet de test.
  --
  -- Le premier lancement RENOMME donc ce cabinet unique en place (même id,
  -- nom/adresse/téléphone réels) au lieu d'en créer un second — ce que fait
  -- l'orchestrateur Electron AVANT d'appeler cette fonction (§D du plan). Les
  -- modèles de documents restent alors correctement rattachés, sans qu'aucune
  -- ligne « cabinet de développement » ne survive à l'installation.
  -- DÉCOUVERT PAR EXÉCUTION RÉELLE : une version antérieure supprimait le
  -- cabinet et échouait sur `document_templates_cabinet_id_fkey`.

  DELETE FROM auth.users
    WHERE id IN ('00000000-0000-0000-0000-0000000000a1',
                 '00000000-0000-0000-0000-0000000000a2',
                 '00000000-0000-0000-0000-0000000000a3')
      AND email LIKE '%@invalid.local';
  GET DIAGNOSTICS n = ROW_COUNT;
  table_purgee := 'auth.users'; lignes_supprimees := n; RETURN NEXT;

  RETURN;
END;
$$;

COMMENT ON FUNCTION app.purge_fixtures_015() IS
  'Supprime les fixtures de 015_seed_data.sql, UNIQUEMENT quand '
  'app.deployment.environment = ''self-hosted''. Appelée une fois par '
  'l''orchestrateur Electron juste après le provisionnement (§D du plan '
  'Bureau Windows), jamais par l''application en fonctionnement normal.';

-- Seul le superutilisateur qui provisionne (propriétaire de la fonction)
-- peut l'appeler — ni l'application, ni un rôle authentifié. Même schéma que
-- app.set_deployment_environment() en 016.
REVOKE ALL ON FUNCTION app.purge_fixtures_015() FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO app.schema_migrations (version) VALUES ('083_purge_fixtures')
  ON CONFLICT DO NOTHING;

COMMIT;
