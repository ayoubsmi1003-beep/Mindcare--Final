-- checkpoint-scales — preuve rejouable des portes d'échelles (migration 184).
--
-- À exécuter sur une base de DÉVELOPPEMENT uniquement, avec la fixture
-- synthétique 091 (`Nadia Belkacem`, is_synthetic = true). La transaction est
-- ANNULÉE à la fin : aucune administration ne reste.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/checkpoint-scales.sql
--
-- Le script refuse si la fixture est absente, si le calcul est faux, si une
-- réponse incomplète est acceptée, si une séance close écrit, si une
-- administratrice hors périmètre écrit, ou si `authenticated` lit la table
-- directement.

BEGIN;

DO $$
DECLARE
  v_open uuid;
  v_closed uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.patients
     WHERE id = 'a1000000-0000-4000-8000-000000001016'
       AND is_synthetic
  ) THEN
    RAISE EXCEPTION 'fixture 091 absente : Nadia Belkacem (synthétique) est requise';
  END IF;

  SELECT c.id INTO v_open
    FROM app.consultations c
   WHERE c.practitioner_id = '00000000-0000-0000-0000-0000000000a1'
     AND c.status = 'open'
     AND c.patient_id = 'a1000000-0000-4000-8000-000000001016'
   LIMIT 1;
  IF v_open IS NULL THEN
    INSERT INTO app.consultations
      (cabinet_id, practitioner_id, patient_id, started_at, status, is_synthetic)
    VALUES
      ('00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-0000000000a1',
       'a1000000-0000-4000-8000-000000001016',
       now(), 'open', true)
    RETURNING id INTO v_open;
  END IF;
  PERFORM set_config('evaluation.open_consultation', v_open::text, true);

  SELECT c.id INTO v_closed
    FROM app.consultations c
   WHERE c.patient_id = 'a1000000-0000-4000-8000-000000001016'
     AND c.status = 'closed'
   ORDER BY c.started_at DESC
   LIMIT 1;
  IF v_closed IS NULL THEN
    INSERT INTO app.consultations
      (cabinet_id, practitioner_id, patient_id, started_at, ended_at, status, is_synthetic)
    VALUES
      ('00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-0000000000a1',
       'a1000000-0000-4000-8000-000000001016',
       now() - interval '1 hour', now() - interval '30 minutes', 'closed', true)
    RETURNING id INTO v_closed;
  END IF;
  PERFORM set_config('evaluation.closed_consultation', v_closed::text, true);

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_phq_max jsonb;
  v_phq_min jsonb;
  v_gad_max jsonb;
  v_record jsonb;
  v_history jsonb;
  v_id uuid;
  v_open uuid := current_setting('evaluation.open_consultation')::uuid;
  v_closed uuid := current_setting('evaluation.closed_consultation')::uuid;
  v_list jsonb;
BEGIN
  -- 1. Référentiel : deux instruments actifs, HDRS/YMRS absents.
  v_list := app.list_scales();
  IF jsonb_array_length(v_list) <> 2 THEN
    RAISE EXCEPTION 'list_scales : attendu 2 échelles actives, reçu %', jsonb_array_length(v_list);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) e WHERE e->>'code' = 'PHQ9')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) e WHERE e->>'code' = 'GAD7') THEN
    RAISE EXCEPTION 'list_scales : PHQ9/GAD7 manquants';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) e WHERE e->>'code' IN ('HDRS','YMRS')) THEN
    RAISE EXCEPTION 'list_scales : un instrument inactif est exposé';
  END IF;
  RAISE NOTICE 'VERT — référentiel actif : PHQ9 + GAD7 seulement';

  -- 2. PHQ-9 maximum : 27, sévère, alerte item 9.
  v_phq_max := app.preview_scale_score('PHQ9',
    '{"q1":3,"q2":3,"q3":3,"q4":3,"q5":3,"q6":3,"q7":3,"q8":3,"q9":3}'::jsonb);
  IF (v_phq_max->>'total')::int <> 27
     OR v_phq_max->>'interpretation' <> 'sévère'
     OR jsonb_array_length(v_phq_max->'alertes') <> 1
     OR v_phq_max->'alertes'->0->>'itemId' <> 'q9' THEN
    RAISE EXCEPTION 'PHQ-9 max : calcul/alerte faux — %', v_phq_max;
  END IF;
  RAISE NOTICE 'VERT — PHQ-9 27 = sévère, alerte item 9';

  -- 3. PHQ-9 minimum : 0, minimal, aucune alerte.
  v_phq_min := app.preview_scale_score('PHQ9',
    '{"q1":0,"q2":0,"q3":0,"q4":0,"q5":0,"q6":0,"q7":0,"q8":0,"q9":0}'::jsonb);
  IF (v_phq_min->>'total')::int <> 0
     OR v_phq_min->>'interpretation' <> 'minimal'
     OR jsonb_array_length(v_phq_min->'alertes') <> 0 THEN
    RAISE EXCEPTION 'PHQ-9 min : 0 ne doit pas être une absence — %', v_phq_min;
  END IF;
  RAISE NOTICE 'VERT — PHQ-9 0 = minimal, zéro est un score';

  -- 4. GAD-7 maximum : 21, sévère.
  v_gad_max := app.preview_scale_score('GAD7',
    '{"q1":3,"q2":3,"q3":3,"q4":3,"q5":3,"q6":3,"q7":3}'::jsonb);
  IF (v_gad_max->>'total')::int <> 21 OR v_gad_max->>'interpretation' <> 'sévère' THEN
    RAISE EXCEPTION 'GAD-7 max : calcul faux — %', v_gad_max;
  END IF;
  RAISE NOTICE 'VERT — GAD-7 21 = sévère';

  -- 5. Réponses invalides refusées.
  BEGIN
    PERFORM app.preview_scale_score('PHQ9', '{"q1":0,"q2":0,"q3":0,"q4":0,"q5":0,"q6":0,"q7":0,"q8":0}'::jsonb);
    RAISE EXCEPTION 'item manquant accepté';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM app.preview_scale_score('PHQ9', '{"q1":0,"q2":0,"q3":0,"q4":0,"q5":0,"q6":0,"q7":0,"q8":0,"q9":0,"q10":0}'::jsonb);
    RAISE EXCEPTION 'item inconnu accepté';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM app.preview_scale_score('PHQ9', '{"q1":4,"q2":0,"q3":0,"q4":0,"q5":0,"q6":0,"q7":0,"q8":0,"q9":0}'::jsonb);
    RAISE EXCEPTION 'valeur hors barème acceptée';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  RAISE NOTICE 'VERT — réponses incomplètes/inconnues/hors barème refusées';

  -- 6. Instrument inactif : aucun aperçu.
  IF app.preview_scale_score('HDRS', '{}'::jsonb) IS NOT NULL THEN
    RAISE EXCEPTION 'HDRS inactif ne doit pas rendre d''aperçu';
  END IF;
  RAISE NOTICE 'VERT — HDRS inactif';

  -- 7. Enregistrement sur séance ouverte.
  v_record := app.record_scale_administration(
    'a1000000-0000-4000-8000-000000001016',
    v_open,
    'PHQ9',
    '{"q1":2,"q2":2,"q3":2,"q4":1,"q5":1,"q6":2,"q7":1,"q8":1,"q9":1}'::jsonb
  );
  IF v_record IS NULL
     OR (v_record->>'total')::int <> 13
     OR v_record->>'interpretation' <> 'modéré' THEN
    RAISE EXCEPTION 'record : résultat faux — %', v_record;
  END IF;
  v_id := (v_record->>'id')::uuid;
  RAISE NOTICE 'VERT — enregistrement PHQ-9 13 = modéré, id %', v_id;

  -- 8. Historique relu, et pas celui d'un autre dossier.
  v_history := app.get_scale_history('a1000000-0000-4000-8000-000000001016', 'PHQ9');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_history) e WHERE e->>'id' = v_id::text) THEN
    RAISE EXCEPTION 'historique : administration absente';
  END IF;
  IF jsonb_array_length(app.get_scale_history('00000000-0000-0000-0000-0000000000ff', 'PHQ9')) <> 0 THEN
    RAISE EXCEPTION 'historique : dossier hors périmètre non vide';
  END IF;
  RAISE NOTICE 'VERT — historique relu, dossier hors périmètre vide';

  -- 9. Séance close : aucune écriture.
  IF app.record_scale_administration(
       'a1000000-0000-4000-8000-000000001016', v_closed, 'GAD7',
       '{"q1":0,"q2":0,"q3":0,"q4":0,"q5":0,"q6":0,"q7":0}'::jsonb
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'séance close : écriture acceptée';
  END IF;
  RAISE NOTICE 'VERT — séance close : aucune écriture';

  -- 10. Dossier hors périmètre : aucune écriture.
  IF app.record_scale_administration(
       '00000000-0000-0000-0000-0000000000ff', v_open, 'PHQ9',
       '{"q1":0,"q2":0,"q3":0,"q4":0,"q5":0,"q6":0,"q7":0,"q8":0,"q9":0}'::jsonb
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'dossier hors périmètre : écriture acceptée';
  END IF;
  RAISE NOTICE 'VERT — dossier hors périmètre : aucune écriture';

  -- 11. Assistante : aucune écriture.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
  IF app.record_scale_administration(
       'a1000000-0000-4000-8000-000000001016', v_open, 'PHQ9',
       '{"q1":0,"q2":0,"q3":0,"q4":0,"q5":0,"q6":0,"q7":0,"q8":0,"q9":0}'::jsonb
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'assistante : écriture acceptée';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  RAISE NOTICE 'VERT — assistante : aucune écriture';

  -- 12. La table n'est pas lisible directement par authenticated.
  BEGIN
    PERFORM 1 FROM app.scale_administrations LIMIT 1;
    RAISE EXCEPTION 'lecture directe de scale_administrations autorisée';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'VERT — scale_administrations non lisible en direct';
END $$;

ROLLBACK;
