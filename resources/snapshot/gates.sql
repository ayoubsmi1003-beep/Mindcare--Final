-- gates.sql — portes d'intégrité post-restauration (§D, §10 de la mission).
--
-- Appliqué via `psql -v ON_ERROR_STOP=1 -q -f` juste après
-- restauration intégrale, pendant le premier lancement packagé. Chaque porte
-- lève EXCEPTION avec le compteur exact : la restauration est alors refusée
-- (rollback) et le démarrage devient FAILED avec le détail — jamais de base
-- partielle servie. Zéro écriture ici : que des lectures vérifiantes.

BEGIN READ ONLY;

-- ── G1 · Aucun orphelin : tout enfant référence un patient existant ──────────
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM app.appointments a
    LEFT JOIN app.patients p ON p.id = a.patient_id
   WHERE a.patient_id IS NOT NULL AND p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G1 : % rendez-vous orphelins.', n; END IF;

  SELECT count(*) INTO n FROM app.consultations c
    LEFT JOIN app.patients p ON p.id = c.patient_id
   WHERE p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G1 : % consultations orphelines.', n; END IF;

  SELECT count(*) INTO n FROM app.clinical_notes c
    LEFT JOIN app.patients p ON p.id = c.patient_id
   WHERE p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G1 : % notes orphelines.', n; END IF;

  SELECT count(*) INTO n FROM app.diagnoses d
    LEFT JOIN app.patients p ON p.id = d.patient_id
   WHERE p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G1 : % diagnostics orphelins.', n; END IF;

  SELECT count(*) INTO n FROM app.prescriptions pr
    LEFT JOIN app.patients p ON p.id = pr.patient_id
   WHERE p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G1 : % prescriptions orphelines.', n; END IF;

  SELECT count(*) INTO n FROM app.prescription_lines l
    LEFT JOIN app.prescriptions pr ON pr.id = l.prescription_id
   WHERE pr.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G1 : % lignes de prescription orphelines.', n; END IF;

  SELECT count(*) INTO n FROM app.documents d
    LEFT JOIN app.patients p ON p.id = d.patient_id
   WHERE p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G1 : % documents orphelins.', n; END IF;

  SELECT count(*) INTO n FROM app.payments p2
    LEFT JOIN app.patients p ON p.id = p2.patient_id
   WHERE p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G1 : % paiements orphelins.', n; END IF;

  SELECT count(*) INTO n FROM app.patient_treatments t
    LEFT JOIN app.patients p ON p.id = t.patient_id
   WHERE p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G1 : % traitements orphelins.', n; END IF;

  SELECT count(*) INTO n FROM app.patient_case_summaries s
    LEFT JOIN app.patients p ON p.id = s.patient_id
   WHERE p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G1 : % résumés orphelins.', n; END IF;

  SELECT count(*) INTO n FROM app.consultation_analyses a
    LEFT JOIN app.patients p ON p.id = a.patient_id
   WHERE p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G1 : % analyses orphelines.', n; END IF;

  SELECT count(*) INTO n FROM app.scale_administrations s
    LEFT JOIN app.patients p ON p.id = s.patient_id
   WHERE p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G1 : % échelles orphelines.', n; END IF;

  RAISE NOTICE 'gates G1 : OK — aucun orphelin.';
END $$;

-- ── G2 · Unicité des numéros de dossier par cabinet ──────────────────────────
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT cabinet_id, record_number FROM app.patients
    GROUP BY cabinet_id, record_number HAVING count(*) > 1
  ) doublons;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G2 : % numéro(s) de dossier dupliqué(s).', n; END IF;
  RAISE NOTICE 'gates G2 : OK — numéros de dossier uniques.';
END $$;

-- ── G3 · Aucune référence patient legacy orpheline ──────────────────────────
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM app.legacy_id_map m
    LEFT JOIN app.patients p ON p.id = m.mindcare_id
   WHERE m.source_kind = 'patient' AND p.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G3 : % référence(s) patient legacy orpheline(s).', n; END IF;
  RAISE NOTICE 'gates G3 : OK — références legacy intactes, aucun patient exclu.';
END $$;

-- ── G4 · Identités non vides (l'import refuse les identités vides) ───────────
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM app.patients
   WHERE btrim(coalesce(first_name, '') || coalesce(last_name, '')) = '';
  IF n <> 0 THEN RAISE EXCEPTION 'gates G4 : % patient(s) sans identité.', n; END IF;
  RAISE NOTICE 'gates G4 : OK — identités présentes.';
END $$;

-- ── G5 · Horodatages de création présents ────────────────────────────────────
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM app.patients WHERE created_at IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'gates G5 : % patient(s) sans created_at.', n; END IF;
  RAISE NOTICE 'gates G5 : OK — horodatages présents.';
END $$;

COMMIT;
