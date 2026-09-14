-- 087_purge_fixtures_enrichment — étend 083 pour les fixtures enrichies 2026-09-05
--
-- Contexte : 086 renomme les deux patients seed (Smail KARIM, Ayoub SALMI) et
-- checkpoint-fixture-v3-cloture enrichit le jeu avec 3 patients supplémentaires
-- (Yasmine AMRANI b003, Jilali MOKRANE b004, Karima OUALI b005) + leurs
-- diagnostics, échelles, consultations, notes, RDV et résumés. 083 ne purgerait
-- que les 2 patients seed et 1 RDV/1 note — les nouvelles lignes resteraient
-- après la migration ADR-001, violant ADR-016 condition 2.
--
-- Cette migration ne crée aucune table : elle REDEFINIT app.purge_fixtures_015()
-- (CREATE OR REPLACE) pour couvrir l'ensemble des IDs fixes c1000000-… posés
-- par la clôture V3 et son enrichissement. Respecte la règle 9 (083 n'est pas
-- éditée) et l'ordre FK (résumés → notes → consultations → échelles →
-- diagnostics → RDV → patients → compteurs/charges → profils → auth.users).

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

  -- Ordre imposé par les clés étrangères : résumés/notes/consultations/
  -- échelles/diagnostics/RDV avant patients, patients avant profils/compteurs/
  -- charges. Le cabinet n'est PAS supprimé (voir 083) — seuls les comptes
  -- auth.users le sont, après les profils.

  -- Résumés du cas (dérivés, pas de is_synthetic — filtre par patient_id)
  DELETE FROM app.patient_case_summaries
    WHERE patient_id IN ('00000000-0000-0000-0000-0000000000b1',
                         '00000000-0000-0000-0000-0000000000b2',
                         'c1000000-0000-4000-8000-00000000b003',
                         'c1000000-0000-4000-8000-00000000b004',
                         'c1000000-0000-4000-8000-00000000b005');
  GET DIAGNOSTICS n = ROW_COUNT;
  table_purgee := 'app.patient_case_summaries'; lignes_supprimees := n; RETURN NEXT;

  DELETE FROM app.appointment_reasons
    WHERE appointment_id = '00000000-0000-0000-0000-0000000000d1';

  -- RDV : seed 015 (d1) + clôture V3 (a201) + enrichissement (a202-a204)
  DELETE FROM app.appointments
    WHERE id IN ('00000000-0000-0000-0000-0000000000d1',
                 'c1000000-0000-4000-8000-00000000a201',
                 'c1000000-0000-4000-8000-00000000a202',
                 'c1000000-0000-4000-8000-00000000a203',
                 'c1000000-0000-4000-8000-00000000a204')
      AND is_synthetic = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  table_purgee := 'app.appointments'; lignes_supprimees := n; RETURN NEXT;

  -- Notes cliniques : désactive la règle no_delete_notes le temps de la purge
  ALTER TABLE app.clinical_notes DISABLE RULE no_delete_notes;
  DELETE FROM app.clinical_notes
    WHERE id IN ('00000000-0000-0000-0000-0000000000c1',
                 'c1000000-0000-4000-8000-00000000e002',
                 'c1000000-0000-4000-8000-00000000e003',
                 'c1000000-0000-4000-8000-00000000e004',
                 'c1000000-0000-4000-8000-00000000e005',
                 'c1000000-0000-4000-8000-00000000e006',
                 'c1000000-0000-4000-8000-00000000e007')
      AND is_synthetic = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  ALTER TABLE app.clinical_notes ENABLE RULE no_delete_notes;
  table_purgee := 'app.clinical_notes'; lignes_supprimees := n; RETURN NEXT;

  -- Consultations enrichies (alimentent la timeline)
  DELETE FROM app.consultations
    WHERE id IN ('c1000000-0000-4000-8000-00000000c101',
                 'c1000000-0000-4000-8000-00000000c102',
                 'c1000000-0000-4000-8000-00000000c103')
      AND is_synthetic = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  table_purgee := 'app.consultations'; lignes_supprimees := n; RETURN NEXT;

  -- Échelles : seed clôture (f001-f002) + enrichissement (f003-f008)
  DELETE FROM app.scale_administrations
    WHERE id IN ('c1000000-0000-4000-8000-00000000f001',
                 'c1000000-0000-4000-8000-00000000f002',
                 'c1000000-0000-4000-8000-00000000f003',
                 'c1000000-0000-4000-8000-00000000f004',
                 'c1000000-0000-4000-8000-00000000f005',
                 'c1000000-0000-4000-8000-00000000f006',
                 'c1000000-0000-4000-8000-00000000f007',
                 'c1000000-0000-4000-8000-00000000f008')
      AND is_synthetic = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  table_purgee := 'app.scale_administrations'; lignes_supprimees := n; RETURN NEXT;

  -- Diagnostics : clôture (d001) + enrichissement (d002-d004)
  DELETE FROM app.diagnoses
    WHERE id IN ('c1000000-0000-4000-8000-00000000d001',
                 'c1000000-0000-4000-8000-00000000d002',
                 'c1000000-0000-4000-8000-00000000d003',
                 'c1000000-0000-4000-8000-00000000d004')
      AND is_synthetic = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  table_purgee := 'app.diagnoses'; lignes_supprimees := n; RETURN NEXT;

  DELETE FROM app.patients
    WHERE id IN ('00000000-0000-0000-0000-0000000000b1',
                 '00000000-0000-0000-0000-0000000000b2',
                 'c1000000-0000-4000-8000-00000000b003',
                 'c1000000-0000-4000-8000-00000000b004',
                 'c1000000-0000-4000-8000-00000000b005')
      AND is_synthetic = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  table_purgee := 'app.patients'; lignes_supprimees := n; RETURN NEXT;

  DELETE FROM app.counters
    WHERE cabinet_id = '00000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  table_purgee := 'app.counters'; lignes_supprimees := n; RETURN NEXT;

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
  'Supprime les fixtures de 015_seed_data.sql et de la clôture V3 enrichie '
  '(086 + checkpoint-fixture-v3-cloture enrichie), UNIQUEMENT quand '
  'app.deployment.environment = ''self-hosted''. Appelée une fois par '
  'l''orchestrateur Electron juste après le provisionnement (§D du plan '
  'Bureau Windows), jamais par l''application en fonctionnement normal. '
  '087 étend 083 sans la modifier (règle 9).';

REVOKE ALL ON FUNCTION app.purge_fixtures_015() FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO app.schema_migrations (version) VALUES ('087_purge_fixtures_enrichment')
  ON CONFLICT DO NOTHING;

COMMIT;
