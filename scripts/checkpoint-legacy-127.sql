-- ═══════════════════════════════════════════════════════════════════════════
-- checkpoint-legacy-127.sql — périmètre identité + purge du clinique.
--
-- Transaction ANNULÉE : rien ne subsiste. Exécution :
--   docker exec <conteneur> psql -U postgres -d mindcare \
--     -v ON_ERROR_STOP=0 -f scripts/checkpoint-legacy-127.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _l127 (nom text PRIMARY KEY, ok boolean);

CREATE TEMP TABLE _c127 AS
WITH pra AS (SELECT * FROM app.profiles WHERE role='practitioner'
             ORDER BY id LIMIT 1)
SELECT (SELECT id FROM app.profiles
        WHERE role='owner' AND cabinet_id = (SELECT cabinet_id FROM pra)
        ORDER BY id LIMIT 1) AS owner,
       (SELECT id FROM pra) AS prat;
GRANT SELECT ON _c127 TO authenticated;
GRANT SELECT, INSERT ON _l127 TO authenticated;

-- ── §A · Structure ─────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM app.schema_migrations
   WHERE version = '127_legacy_identity_scope';
  INSERT INTO _l127 VALUES ('A1 · 127 enregistrée', n = 1);

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'app' AND p.proname = 'legacy_import_patient'
     AND pg_get_function_identity_arguments(p.oid) LIKE '%date%';
  INSERT INTO _l127 VALUES ('A2 · import à 9 args (naissance)', n = 1);

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'app' AND p.proname = 'legacy_import_patient';
  INSERT INTO _l127 VALUES ('A3 · ancienne signature supprimée', n = 1);

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'app' AND p.proname = 'legacy_purge_batch_clinical'
     AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'app_gatekeeper'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  INSERT INTO _l127 VALUES ('A4 · purge DEFINER gatekeeper + EXECUTE', n = 1);

  SELECT count(*) INTO n FROM pg_constraint
   WHERE conname = 'legacy_review_queue_issue_type_check'
     AND pg_get_constraintdef(oid) LIKE '%implausible_date%';
  INSERT INTO _l127 VALUES ('A5 · motif implausible_date', n = 1);
END $$;

-- ── §B · Comportement ──────────────────────────────────────────────────────
SELECT owner::text AS me FROM _c127 \gset
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claim.sub = :'me';

DO $$
DECLARE v_bx   uuid;
DECLARE v_by   uuid;
DECLARE v_px   uuid;
DECLARE v_py   uuid;
DECLARE n      int;
DECLARE v_rep  jsonb;
BEGIN
  v_bx := app.legacy_start_batch('sonde-127-X', '{}'::jsonb);
  v_by := app.legacy_start_batch('sonde-127-Y', '{}'::jsonb);

  -- B1 : naissance valide stockée verbatim.
  v_px := app.legacy_import_patient(v_bx, 'S127-1', 'Sonde', 'Naissance',
                                    '0555000101', NULL,
                                    (SELECT prat FROM _c127), 'sha:s1271',
                                    '1988-06-15'::date);
  SELECT count(*) INTO n FROM app.get_patient(v_px)
   WHERE birth_date = '1988-06-15'::date;
  INSERT INTO _l127 VALUES ('B1 · naissance stockée', n = 1);

  -- B2 : NULL accepté sans revue forcée.
  v_py := app.legacy_import_patient(v_by, 'S127-2', 'Sonde', 'SansDate',
                                    NULL, NULL,
                                    (SELECT prat FROM _c127), 'sha:s1272', NULL);
  SELECT count(*) INTO n FROM app.get_patient(v_py) WHERE birth_date IS NULL;
  INSERT INTO _l127 VALUES ('B2 · naissance NULL acceptée', n = 1);

  -- B3 : invraisemblable stockée (la porte ne juge pas, la revue oui).
  -- Lecture via les portes uniquement (SELECT direct sur patients révoqué).
  PERFORM app.legacy_import_patient(v_bx, 'S127-3', 'Sonde', 'Ancienne',
                                    NULL, NULL,
                                    (SELECT prat FROM _c127), 'sha:s1273',
                                    '1850-01-01'::date);
  SELECT count(*) INTO n FROM app.get_patient(
    (SELECT mindcare_id FROM app.legacy_id_map
     WHERE source_kind = 'patient' AND source_id = 'S127-3'))
   WHERE birth_date = '1850-01-01'::date;
  INSERT INTO _l127 VALUES ('B3 · invraisemblable préservée', n = 1);

  -- B4 : clinique des deux lots, puis purge de X seul.
  PERFORM app.legacy_import_history(v_bx, v_px, 'patient.IDPatient=S127-1',
                                    'baseline_note', 'note X', false, 'sha:hx');
  PERFORM app.legacy_import_history(v_by, v_py, 'patient.IDPatient=S127-2',
                                    'baseline_note', 'note Y', false, 'sha:hy');
  PERFORM app.legacy_import_prescription(v_bx, v_px, 'ORD-X', '2024-05-01'::date,
                                         'OX', '', '[]'::jsonb);
  PERFORM app.legacy_quarantine_orphan(v_bx, '424242', 'ORD-OX',
                                       '2024-06-01'::date, 'OO', '',
                                       '[]'::jsonb, 'sha:ox');
  PERFORM app.legacy_open_review(v_bx, 'ordonnance', 'ordonnance:ORD-X',
                                 'missing_date', '{}', NULL);
  PERFORM app.legacy_open_review(v_bx, 'patient', 'patient:S127-1',
                                 'weak_identity', '{}', NULL);
  PERFORM app.legacy_open_review(v_bx, 'patient', 'patient:S127-3:naissance',
                                 'implausible_date', '{"date":"1850-01-01"}',
                                 'Vérifier la date source.');

  v_rep := app.legacy_purge_batch_clinical(v_bx);
  INSERT INTO _l127 VALUES
    ('B4 · purge comptée',
     (v_rep->>'histories')::int = 1 AND (v_rep->>'prescriptions')::int = 1
     AND (v_rep->>'orphans')::int = 1);

  SELECT count(*) INTO n FROM app.legacy_clinical_history WHERE batch_id = v_bx;
  SELECT count(*) INTO n FROM app.legacy_clinical_history WHERE batch_id = v_by;
  INSERT INTO _l127 VALUES ('B5 · Y intact, X vide',
    (SELECT count(*) FROM app.legacy_clinical_history WHERE batch_id = v_bx) = 0
    AND (SELECT count(*) FROM app.legacy_clinical_history WHERE batch_id = v_by) = 1);

  SELECT count(*) INTO n FROM app.get_patient(v_px);
  SELECT count(*) INTO n FROM app.get_patient(v_py);
  INSERT INTO _l127 VALUES ('B6 · patients intacts',
    (SELECT count(*) FROM app.get_patient(v_px)) = 1
    AND (SELECT count(*) FROM app.get_patient(v_py)) = 1);

  SELECT count(*) INTO n FROM app.legacy_id_map
   WHERE batch_id = v_bx AND source_kind = 'patient';
  INSERT INTO _l127 VALUES ('B7 · correspondances patient gardées', n = 2);

  SELECT count(*) INTO n FROM app.legacy_review_queue
   WHERE batch_id = v_bx AND issue_type = 'missing_date'
     AND status = 'resolved' AND reviewer IS NOT NULL;
  INSERT INTO _l127 VALUES ('B8 · revues purgées closes et signées', n = 1);

  SELECT count(*) INTO n FROM app.legacy_review_queue
   WHERE batch_id = v_bx AND issue_type = 'weak_identity' AND status = 'pending';
  INSERT INTO _l127 VALUES ('B9 · revues identité toujours ouvertes', n = 1);

  SELECT count(*) INTO n FROM app.legacy_review_queue
   WHERE batch_id = v_bx AND issue_type = 'implausible_date';
  INSERT INTO _l127 VALUES ('B9b · revue date invraisemblable ouverte', n = 1);
END $$;

-- B10 : praticien non-owner refoulé (hors bloc DO : psql pur).
SELECT prat::text AS pr2 FROM _c127 \gset
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claim.sub = :'pr2';
DO $$
DECLARE v_by2 uuid;
BEGIN
  SELECT id INTO v_by2 FROM app.legacy_migration_batches
   WHERE batch_label = 'sonde-127-Y';
  BEGIN
    PERFORM app.legacy_purge_batch_clinical(v_by2);
    INSERT INTO _l127 VALUES ('B10 · purge non-owner refusée', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _l127 VALUES ('B10 · purge non-owner refusée', true);
  END;
END $$;

-- ── Verdict ────────────────────────────────────────────────────────────────
SELECT nom, CASE WHEN ok THEN 'VERT' ELSE 'ROUGE' END AS verdict
FROM _l127 ORDER BY nom;

SELECT CASE WHEN count(*) FILTER (WHERE NOT ok) = 0
  THEN 'VERDICT : VERT — 127 prouvée.'
  ELSE 'VERDICT : ROUGE — ' || count(*) FILTER (WHERE NOT ok) || ' contrôle(s) en échec.'
END AS verdict FROM _l127;

ROLLBACK;
