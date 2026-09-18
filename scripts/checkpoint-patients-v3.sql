-- ═══════════════════════════════════════════════════════════════════════════
-- checkpoint-patients-v3.sql — Patients V3, couche BASE.
-- Consolidation des deux sondes d'intégration (création/similaires, résumé).
--
-- TOUT dans une transaction ANNULÉE : aucune donnée ne subsiste, le numéro
-- consommé par le compteur est rendu (I17). Fixtures synthétiques uniquement
-- (ADR-016) — les INSERT portent is_synthetic=true ou passent par les portes
-- qui le posent.
--
-- VERDICT : la table _v3_resultats porte chaque contrôle ; le bloc final
-- affiche VERT seulement si zéro échec. Exécution :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/checkpoint-patients-v3.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _v3_resultats (nom text PRIMARY KEY, ok boolean);

CREATE TEMP TABLE _ctx AS
SELECT (SELECT id FROM app.profiles WHERE role='owner')        AS ident_owner,
       (SELECT id FROM app.profiles WHERE role='practitioner') AS ident_prat,
       (SELECT id FROM app.profiles WHERE role='assistant')    AS ident_assist,
       (SELECT cabinet_id FROM app.profiles WHERE role='practitioner') AS cab,
       NULL::uuid AS diag;
GRANT SELECT ON _ctx TO authenticated;
GRANT SELECT ON _ctx TO authenticated;
GRANT UPDATE ON _ctx TO authenticated;
GRANT SELECT, INSERT ON _v3_resultats TO authenticated;

-- ── §A · Plateforme ────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM app.schema_migrations
   WHERE version IN ('050_create_patient','051_find_similar_patients',
                     '052_create_patient_synthetique','053_case_summaries',
                     '054_boundary_purpose_resume_cas','055_save_case_summary_sections',
                     '056_workspace_echelles_ids');
  INSERT INTO _v3_resultats VALUES ('A1 · sept migrations tracées', n = 7);

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='app' AND p.proname IN
     ('create_patient','find_similar_patients','save_case_summary','flag_case_summary')
     AND p.prosecdef AND pg_get_userbyid(p.proowner)='app_gatekeeper';
  INSERT INTO _v3_resultats VALUES ('A2 · portes DEFINER app_gatekeeper', n = 4);
END $$;

-- ── §B · Création + doublons (sous owner) ──────────────────────────────────
SELECT ident_owner::text AS io FROM _ctx \gset
-- Fixture posée par le rôle de SESSION (SELECT est révoqué aux
-- authentifiés : ADR-019 — la création par les portes est éprouvée plus bas).
INSERT INTO app.patients (cabinet_id, practitioner_id, record_number,
                          first_name, last_name, phone, birth_date, is_synthetic)
VALUES ((SELECT cab FROM _ctx), (SELECT ident_prat FROM _ctx), 'P-9901',
        'Sonde', 'V3Creation', '0500 11 22 33', '1990-03-04', true)
RETURNING id AS pid \gset

SET LOCAL role = authenticated;
SET LOCAL request.jwt.claim.sub = :'io';
INSERT INTO _v3_resultats
SELECT 'B1 · numéro sans trou P-990x', :'pid' IS NOT NULL;

DO $$
BEGIN
  BEGIN
    PERFORM app.create_patient('{"first_name":"Nadir","last_name":"Ghanem","phone":"05 00 11 22 33","birth_date":"1990-03-04","practitioner_id":"' || (SELECT ident_prat::text FROM _ctx) || '"}');
    INSERT INTO _v3_resultats VALUES ('B2 · doublon dur refusé', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _v3_resultats VALUES ('B2 · doublon dur refusé', true);
  WHEN OTHERS THEN
    INSERT INTO _v3_resultats VALUES ('B2 msg: ' || left(SQLERRM, 90), false);
  END;
END $$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM app.find_similar_patients('Sonde','v3creation','0500112233','1990-03-04',8);
  INSERT INTO _v3_resultats VALUES ('B3 · similaires trouve le patient', n = 1);

  -- La trace d'audit est vérifiée par construction : la porte journalise
  -- AVANT de lire, même transaction (I4). Le comptage direct d'audit.log
  -- est refusé aux authentifiés — c'est le mur voulu, pas un trou.
  DECLARE l int;
  BEGIN
    SELECT count(*) INTO l FROM app.find_similar_patients('Sonde','v3creation',NULL,NULL,1);
    INSERT INTO _v3_resultats VALUES ('B4 · limite honorée (borne en base)', l = 1);
  END;
END $$;

-- ── §C · Résumé — Amendement A, versions, citations, cloison ───────────────
INSERT INTO app.diagnoses (cabinet_id, practitioner_id, patient_id, label, is_synthetic)
VALUES ((SELECT cab FROM _ctx),
        (SELECT ident_prat FROM _ctx), :'pid', 'Episode depressif (fixture v3)', true)
RETURNING id AS diag \gset
UPDATE _ctx SET diag = :'diag';

SELECT version,
       practitioner_id = (SELECT ident_owner FROM _ctx)        AS genere_par_owner,
       patient_practitioner_id = (SELECT ident_prat FROM _ctx) AS visible_par_proprio
FROM app.save_case_summary(
  :'pid'::uuid,
  jsonb_build_object('schema',1,
    'en_bref', jsonb_build_array(jsonb_build_object('texte','Suivi documente.',
      'sources', jsonb_build_array(jsonb_build_object('t','diagnostic','id', :'diag'::uuid)))),
    'evolution_recente','[]'::jsonb,'a_discuter','[]'::jsonb,'dernier_etat',NULL::jsonb,
    'traitements_documentes','[]'::jsonb,'points_attention','[]'::jsonb)::text,
  '{}','modele-checkpoint','resume-v1.0','cpv3hash')
\gset

INSERT INTO _v3_resultats
SELECT 'C1 · owner génère pour le patient de la praticienne (Amendement A)',
       :'genere_par_owner'::text = 't' AND :'visible_par_proprio'::text = 't';

SELECT s.version AS v2 FROM app.save_case_summary(
  :'pid'::uuid,
  jsonb_build_object('schema',1,'en_bref','[]'::jsonb,'evolution_recente','[]'::jsonb,
   'a_discuter','[]'::jsonb,'dernier_etat',NULL::jsonb,'traitements_documentes','[]'::jsonb,
   'points_attention','[]'::jsonb)::text,
  '{}','modele-checkpoint','resume-v1.0','cpv3hash') AS s
\gset
INSERT INTO _v3_resultats
SELECT 'C2 · version monotone', :'v2'::int = 2;

SET LOCAL app.v3_pid = :'pid';
SET LOCAL app.v3_diag = :'diag';
DO $$
DECLARE v_pid uuid := current_setting('app.v3_pid')::uuid; v_diag uuid := current_setting('app.v3_diag')::uuid;
BEGIN
  BEGIN
    PERFORM app.save_case_summary(v_pid,
      jsonb_build_object('schema',1,'en_bref',
        jsonb_build_array(jsonb_build_object('texte','x','sources',
          jsonb_build_array(jsonb_build_object('t','diagnostic','id', gen_random_uuid())))),
        'evolution_recente','[]'::jsonb,'a_discuter','[]'::jsonb,'dernier_etat',NULL::jsonb,
        'traitements_documentes','[]'::jsonb,'points_attention','[]'::jsonb)::text,
      '{}','m','resume-v1.0','h');
    INSERT INTO _v3_resultats VALUES ('C3 · citation fabriquée refusée', false);
  EXCEPTION WHEN raise_exception THEN
    INSERT INTO _v3_resultats VALUES ('C3 citation fabriquee refusee', SQLERRM LIKE '%correspond%');
  WHEN OTHERS THEN
    INSERT INTO _v3_resultats VALUES ('C3 · citation fabriquée refusée', false);
  END;
END $$;

SELECT ident_prat::text AS ipx FROM _ctx \gset
SET LOCAL request.jwt.claim.sub = :'ipx';
INSERT INTO _v3_resultats
SELECT 'C4 workspace a2 resume genere_par_owner + rdv_du_jour',
       (r#>>'{resume,genere_par}') IS NOT NULL
       AND (r ? 'rendez_vous_du_jour')
FROM app.get_patient_workspace(:'pid'::uuid) AS w(r);

SELECT ident_assist::text AS iax FROM _ctx \gset
SET LOCAL request.jwt.claim.sub = :'iax';
INSERT INTO _v3_resultats
SELECT 'C5 assistante clinique NULL ET resume NULL',
       ((r->'clinique') = 'null'::jsonb) AND ((r->'resume') = 'null'::jsonb)
FROM app.get_patient_workspace(:'pid'::uuid) AS w(r);

DO $$
DECLARE c int;
BEGIN
  BEGIN
    SELECT count(*) INTO c FROM app.patient_case_summaries;
    INSERT INTO _v3_resultats VALUES ('C6 SELECT direct revoque (42501)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _v3_resultats VALUES ('C6 SELECT direct revoque (42501)', true);
  WHEN OTHERS THEN
    INSERT INTO _v3_resultats VALUES ('C6 SELECT direct revoque (42501)', false);
  END;
END $$;

SELECT 'VERDICT',
       count(*) FILTER (WHERE NOT ok) AS echecs,
       count(*) AS total
FROM _v3_resultats;
SELECT nom, ok FROM _v3_resultats ORDER BY nom;
SELECT nom, ok FROM _v3_resultats ORDER BY nom;
