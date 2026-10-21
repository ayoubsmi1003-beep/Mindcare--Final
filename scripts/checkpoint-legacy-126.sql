-- ═══════════════════════════════════════════════════════════════════════════
-- checkpoint-legacy-126.sql — Migration legacy Syglab, couche BASE.
--
-- TOUT dans une transaction ANNULÉE : aucune donnée ne subsiste, les numéros
-- consommés sont rendus. Fixtures synthétiques (le conteneur jetable démarre
-- en cloud-dev : les portes posent is_synthetic via app.is_cloud_dev()).
--
-- VERDICT : la table _legacy_resultats porte chaque contrôle ; le bloc final
-- affiche VERT seulement si zéro échec. Exécution (conteneur jetable) :
--   docker exec -i <conteneur> psql -U postgres -d mindcare \
--     -v ON_ERROR_STOP=1 -f scripts/checkpoint-legacy-126.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _legacy_resultats (nom text PRIMARY KEY, ok boolean);

CREATE TEMP TABLE _lctx AS
WITH pra AS (SELECT * FROM app.profiles WHERE role='practitioner'
             ORDER BY id LIMIT 1)
SELECT (SELECT id FROM pra) AS prat,
       (SELECT id FROM app.profiles
        WHERE role='assistant' AND cabinet_id = (SELECT cabinet_id FROM pra)
        ORDER BY id LIMIT 1) AS assist,
       (SELECT cabinet_id FROM pra) AS cab;
GRANT SELECT ON _lctx TO authenticated;
GRANT SELECT, INSERT ON _legacy_resultats TO authenticated;

-- ── §A · Structure ─────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM app.schema_migrations
   WHERE version = '126_legacy_syglab_migration';
  INSERT INTO _legacy_resultats VALUES ('A1 · 126 enregistrée', n = 1);

  SELECT count(*) INTO n FROM pg_tables
   WHERE schemaname = 'app' AND tablename IN
    ('legacy_migration_batches','legacy_id_map','legacy_clinical_history',
     'legacy_orphan_prescriptions','legacy_orphan_prescription_lines',
     'legacy_review_queue');
  INSERT INTO _legacy_resultats VALUES ('A2 · six tables legacy', n = 6);

  SELECT count(*) INTO n FROM pg_class c
   JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'app' AND c.relname LIKE 'legacy\_%'
     AND c.relrowsecurity AND c.relforcerowsecurity;
  INSERT INTO _legacy_resultats VALUES ('A3 · RLS ENABLE+FORCE partout', n = 6);

  SELECT count(DISTINCT tablename) INTO n FROM pg_policies
   WHERE schemaname = 'app' AND tablename LIKE 'legacy\_%';
  INSERT INTO _legacy_resultats VALUES ('A4 · ≥1 policy par table', n = 6);

  SELECT count(*) INTO n FROM pg_trigger t
   JOIN pg_class c ON c.oid = t.tgrelid
   JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'app' AND c.relname LIKE 'legacy\_%'
     AND t.tgname = 'trg_audit' AND NOT t.tgisinternal;
  INSERT INTO _legacy_resultats VALUES ('A5 · trg_audit rattaché ×6', n = 6);

  SELECT count(*) INTO n FROM pg_trigger t
   JOIN pg_class c ON c.oid = t.tgrelid
   JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'app' AND c.relname LIKE 'legacy\_%'
     AND t.tgname = 'assert_synthetic' AND NOT t.tgisinternal;
  INSERT INTO _legacy_resultats VALUES ('A6 · assert_synthetic ×6', n = 6);

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'app' AND p.proname IN
    ('legacy_start_batch','legacy_import_patient','legacy_import_history',
     'legacy_import_prescription','legacy_quarantine_orphan','legacy_open_review',
     'legacy_resolve_review','legacy_finalize_batch','legacy_patient_history',
     'legacy_list_reviews','legacy_get_report','legacy_map_lookup')
     AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'app_gatekeeper';
  INSERT INTO _legacy_resultats VALUES ('A7 · douze portes DEFINER gatekeeper', n = 12);

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'app' AND p.proname LIKE 'legacy\_%'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  INSERT INTO _legacy_resultats VALUES ('A8 · EXECUTE aux authentifiés', n = 12);

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'app' AND table_name = 'patients'
     AND column_name = 'phone' AND is_nullable = 'YES';
  INSERT INTO _legacy_resultats VALUES ('A9 · phone nullable (D2)', n = 1);
END $$;

-- ── §B · Comportement (fixtures) ───────────────────────────────────────────
-- Médicament témoin pour la résolution exacte (superuser : hors RLS, trigger
-- actif → is_synthetic explicite).
INSERT INTO app.medications (id, inn, brand_name, form, strength)
VALUES ('11111111-0000-4000-8000-000000000001', 'sulpiride', 'Dogmatil',
        'gélule', '50 mg');

CREATE TEMP TABLE _lids (k text PRIMARY KEY, v uuid);
GRANT SELECT, INSERT ON _lids TO authenticated;

SELECT prat::text AS me FROM _lctx \gset
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claim.sub = :'me';

-- §B-auth : appels de portes sous identité praticienne (chemin RLS réel).
-- Aucune lecture directe ici (ADR-019 : SELECT révoqué) — les vérifications
-- tabulaires vivent dans §B-super, via les ids stockés dans _lids.
DO $$
DECLARE v_batch uuid;
DECLARE v_p1    uuid;
DECLARE v_p1bis uuid;
DECLARE v_fn    text;
DECLARE v_ln    text;
DECLARE v_ph    text;
DECLARE v_tot   bigint;
DECLARE v_h     uuid;
DECLARE v_txt   text;
DECLARE v_rx    uuid;
DECLARE v_or    uuid;
DECLARE v_rv    uuid;
DECLARE v_rep   jsonb;
BEGIN
  v_batch := app.legacy_start_batch('sonde-126', '{"extract":"test"}'::jsonb);
  INSERT INTO _legacy_resultats VALUES ('B1 · lot ouvert', v_batch IS NOT NULL);
  INSERT INTO _lids VALUES ('batch', v_batch);

  -- B2 : patient sans téléphone → NULL, jamais un faux numéro (via get_patient).
  v_p1 := app.legacy_import_patient(v_batch, 'SONDE-1', 'SondePrenom', 'SondeNom',
                                    NULL, NULL,
                                    (SELECT prat FROM _lctx), 'sha:sonde1');
  SELECT first_name, last_name, phone INTO v_fn, v_ln, v_ph
  FROM app.get_patient(v_p1);
  INSERT INTO _legacy_resultats VALUES ('B2 · sans téléphone = NULL',
    v_fn = 'SondePrenom' AND v_ln = 'SondeNom' AND v_ph IS NULL);
  INSERT INTO _lids VALUES ('p1', v_p1);

  -- B3 : rejouer ne duplique pas (via search_patients).
  v_p1bis := app.legacy_import_patient(v_batch, 'SONDE-1', 'SondePrenom',
                                       'SondeNom', NULL, NULL,
                                       (SELECT prat FROM _lctx), 'sha:sonde1');
  SELECT total_count INTO v_tot FROM app.search_patients('SondeNom', 25, 0);
  INSERT INTO _legacy_resultats
  VALUES ('B3 · idempotent (même id, un seul dossier)',
          v_p1bis = v_p1 AND v_tot = 1);

  -- B15 : la correspondance est relisible pour reprise/audit.
  INSERT INTO _legacy_resultats VALUES
    ('B15 · lookup retrouve l''id MindCare',
     app.legacy_map_lookup('patient', 'SONDE-1') = v_p1
     AND app.legacy_map_lookup('patient', 'SONDE-ABSENT') IS NULL);

  -- Nom vide → refus explicite (quarantaine côté script).
  BEGIN
    PERFORM app.legacy_import_patient(v_batch, 'SONDE-VIDE', '', '  ',
                                      NULL, NULL,
                                      (SELECT prat FROM _lctx), 'sha:vide');
    INSERT INTO _legacy_resultats VALUES ('B4 · nom vide refusé', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _legacy_resultats VALUES ('B4 · nom vide refusé', true);
  END;

  -- Téléphone hors format → refus explicite (revue côté script).
  BEGIN
    PERFORM app.legacy_import_patient(v_batch, 'SONDE-TEL', 'A', 'B',
                                      'ABC', NULL,
                                      (SELECT prat FROM _lctx), 'sha:telmauvais');
    INSERT INTO _legacy_resultats VALUES ('B5 · téléphone hors format refusé', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _legacy_resultats VALUES ('B5 · téléphone hors format refusé', true);
  END;

  -- B6 : historique RTF byte-exact (via la porte de lecture).
  v_h := app.legacy_import_history(v_batch, v_p1, 'patient.IDPatient=SONDE-1',
                                   'baseline_note',
                                   $rtf${\rtf1 sonde \'e9t\'e9}$rtf$,
                                   true,
                                   '4dbc94f680955ef738d630949c58c5dadab08f1166507bd8d4ae08a1b24ae520');
  SELECT original_text INTO v_txt FROM app.legacy_patient_history(v_p1);
  INSERT INTO _legacy_resultats VALUES ('B6 · RTF byte-exact',
    v_txt = $rtf${\rtf1 sonde \'e9t\'e9}$rtf$);
  INSERT INTO _lids VALUES ('h', v_h);

  -- B7 : ordonnance 2 lignes (1 exacte, 1 non résolue).
  v_rx := app.legacy_import_prescription(
    v_batch, v_p1, 'ORD-SONDE-1', '2024-05-09'::date, 'ORD-1', 'renouveler',
    '[{"legacy_line_id":"L1","legacy_med_id":"999",
       "medication_id":"11111111-0000-4000-8000-000000000001",
       "display":"Dogmatil 50 mg","posologie":"1 cp matin",
       "texte_libre":"","quantite":"30","nbr_jour":"30","nbr_fois":"1",
       "qsp":"","unresolved":false},
      {"legacy_line_id":"L2","legacy_med_id":"INCONNU-7",
       "medication_id":null,"display":"Remede Inconnu 10 mg",
       "posologie":"1 cp soir","texte_libre":"au coucher",
       "quantite":"","nbr_jour":"","nbr_fois":"",       "qsp":"01 mois",
       "unresolved":true}]'::jsonb);
  INSERT INTO _lids VALUES ('rx', v_rx);

  -- B9 : orpheline en quarantaine, sans patient.
  v_or := app.legacy_quarantine_orphan(
    v_batch, '999999', 'ORD-ORPH-1', '2024-06-01'::date, 'ORD-9', 'orpheline',
    '[{"legacy_line_id":"L1","display":"X 5 mg"}]'::jsonb, 'sha:orph1');
  INSERT INTO _lids VALUES ('orph', v_or);

  -- B10 : revue idempotente puis tranchée une fois.
  v_rv := app.legacy_open_review(v_batch, 'duplicate_group', '1|2',
                                 'possible_duplicate',
                                 '{"a":"SONDE-1"}', 'KEEP_SEPARATE');
  PERFORM app.legacy_open_review(v_batch, 'duplicate_group', '1|2',
                                 'possible_duplicate',
                                 '{"a":"SONDE-1"}', 'KEEP_SEPARATE');
  INSERT INTO _lids VALUES ('rv', v_rv);
  PERFORM app.legacy_resolve_review(v_rv, 'confirmed', 'KEEP_SEPARATE décidé.');
  BEGIN
    PERFORM app.legacy_resolve_review(v_rv, 'rejected', 'second tour');
    INSERT INTO _legacy_resultats VALUES ('B12 · re-tranchage refusé', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _legacy_resultats VALUES ('B12 · re-tranchage refusé', true);
  END;

  -- B13 : rapport vivant (comptes de l'exécution, intégrité RTF).
  v_rep := app.legacy_get_report(v_batch);
  INSERT INTO _legacy_resultats VALUES
    ('B13 · rapport cohérent',
     (v_rep->>'patients_imported')::int = 1
     AND (v_rep->>'histories_imported')::int = 1
     AND (v_rep->>'prescriptions_imported')::int = 1
     AND (v_rep->>'orphans_quarantined')::int = 1
     AND (v_rep->>'rtf_integrity_ok')::boolean IS TRUE
     AND v_rep->>'status' IN ('PASS_WITH_REVIEW','PASS'));
END $$;

RESET ROLE;

-- §B-super : vérifications tabulaires DIRECTES, superuser de TEST uniquement.
-- Le chemin RLS des portes est déjà éprouvé en §B-auth ; ici on prouve le
-- contenu écrit, sans inventer de porte de lecture pour les besoins du test.
DO $$
DECLARE n int;
DECLARE v_batch uuid;
DECLARE v_rx    uuid;
DECLARE v_or    uuid;
DECLARE v_rv    uuid;
BEGIN
  SELECT v INTO v_batch FROM _lids WHERE k = 'batch';
  SELECT v INTO v_rx    FROM _lids WHERE k = 'rx';
  SELECT v INTO v_or    FROM _lids WHERE k = 'orph';
  SELECT v INTO v_rv    FROM _lids WHERE k = 'rv';

  SELECT count(*) INTO n FROM app.prescription_lines WHERE prescription_id = v_rx;
  INSERT INTO _legacy_resultats VALUES ('B7 · deux lignes stockées', n = 2);

  SELECT count(*) INTO n FROM app.legacy_id_map
   WHERE batch_id = v_batch AND source_kind = 'ligne'
     AND (meta->>'unresolved')::boolean IS TRUE;
  INSERT INTO _legacy_resultats
  VALUES ('B8 · ligne non résolue tracée en provenance', n = 1);

  SELECT count(*) INTO n FROM app.legacy_orphan_prescriptions
   WHERE id = v_or AND source_patient_id = '999999';
  INSERT INTO _legacy_resultats VALUES ('B9 · orpheline en quarantaine', n = 1);

  SELECT count(*) INTO n FROM app.legacy_review_queue
   WHERE batch_id = v_batch AND issue_type = 'possible_duplicate';
  INSERT INTO _legacy_resultats VALUES ('B10 · revue idempotente', n = 1);

  SELECT count(*) INTO n FROM app.legacy_review_queue
   WHERE id = v_rv AND status = 'confirmed' AND reviewer IS NOT NULL;
  INSERT INTO _legacy_resultats VALUES ('B11 · résolution signée', n = 1);
END $$;

-- B14 : l'assistante n'ouvre pas de lot.
SELECT assist::text AS ax FROM _lctx \gset
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claim.sub = :'ax';
DO $$
BEGIN
  PERFORM app.legacy_start_batch('sonde-assistante', '{}'::jsonb);
  INSERT INTO _legacy_resultats VALUES ('B14 · assistante bloquée', false);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _legacy_resultats VALUES ('B14 · assistante bloquée', true);
END $$;

-- ── Verdict ────────────────────────────────────────────────────────────────
SELECT nom, CASE WHEN ok THEN 'VERT' ELSE 'ROUGE' END AS verdict
FROM _legacy_resultats ORDER BY nom;

SELECT CASE WHEN count(*) FILTER (WHERE NOT ok) = 0
  THEN 'VERDICT : VERT — 126 prouvée.'
  ELSE 'VERDICT : ROUGE — ' || count(*) FILTER (WHERE NOT ok) || ' contrôle(s) en échec.'
END AS verdict FROM _legacy_resultats;

ROLLBACK;
