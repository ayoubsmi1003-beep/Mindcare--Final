-- checkpoint-medication-phase2.sql — Phase 2 (migrations 212/213).
--
-- Exécution : psql -v ON_ERROR_STOP=1 -f scripts/checkpoint-medication-phase2.sql
-- La transaction est TOUJOURS annulée : aucune fixture ne survit.
-- Il exige un owner, une assistante, un dossier avec un traitement actif.

BEGIN;

DO $$
DECLARE
  v_owner uuid;
  v_assistant uuid;
  v_practitioner uuid;
  v_patient uuid;
  v_treatment uuid;
BEGIN
  SELECT id INTO v_owner FROM app.profiles WHERE role = 'owner' ORDER BY id LIMIT 1;
  SELECT id INTO v_assistant FROM app.profiles WHERE role = 'assistant' ORDER BY id LIMIT 1;
  SELECT pt.patient_id, pt.id INTO v_patient, v_treatment
  FROM app.patient_treatments pt
  ORDER BY pt.created_at
  LIMIT 1;
  SELECT pr.id INTO v_practitioner
  FROM app.profiles pr
  WHERE pr.role = 'practitioner'
    AND pr.id <> (SELECT p.practitioner_id FROM app.patients p WHERE p.id = v_patient)
  ORDER BY pr.id
  LIMIT 1;

  IF v_owner IS NULL OR v_assistant IS NULL OR v_patient IS NULL OR v_treatment IS NULL THEN
    RAISE EXCEPTION 'checkpoint phase 2 : owner, assistante, dossier ou traitement absent';
  END IF;

  PERFORM set_config('checkpoint.owner', v_owner::text, true);
  PERFORM set_config('checkpoint.assistant', v_assistant::text, true);
  PERFORM set_config('checkpoint.practitioner', COALESCE(v_practitioner::text, ''), true);
  PERFORM set_config('checkpoint.patient', v_patient::text, true);
  PERFORM set_config('checkpoint.treatment', v_treatment::text, true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_owner uuid := current_setting('checkpoint.owner')::uuid;
  v_assistant uuid := current_setting('checkpoint.assistant')::uuid;
  v_practitioner text := current_setting('checkpoint.practitioner');
  v_patient uuid := current_setting('checkpoint.patient')::uuid;
  v_treatment uuid := current_setting('checkpoint.treatment')::uuid;
  v_allergy uuid;
  v_new_doc uuid;
  v_old_doc uuid;
  v_issued integer;
  v_dispo integer;
  v_lies uuid[];
BEGIN
  -- ── Owner : les six faits s'écrivent et se relisent ─────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  SELECT id INTO v_allergy FROM app.record_patient_allergy(
    v_patient, 'Pénicilline', 'Éruption', 'moderee', 'noted', 'checkpoint', NULL
  );
  IF v_allergy IS NULL THEN RAISE EXCEPTION 'checkpoint phase 2 : allergie non écrite'; END IF;

  PERFORM app.record_adverse_event(
    v_patient, 'Nausées', 'leger', v_treatment, CURRENT_DATE, NULL, 'Surveillance', 'checkpoint', NULL
  );
  PERFORM app.record_measurement(
    v_patient, 'weight_kg', 72.5, 'kg', now(), 'consultation', NULL, NULL, 'checkpoint', NULL
  );
  PERFORM app.record_adherence(
    v_patient, v_treatment, CURRENT_DATE - 30, CURRENT_DATE, 'partiel', 'patient', 'checkpoint', NULL
  );
  PERFORM app.record_interaction_review(
    v_patient, jsonb_build_array(v_treatment)::text, 'Vidal', 'non_conclu', 'checkpoint', NULL
  );

  IF (SELECT count(*) FROM app.list_patient_allergies(v_patient)) < 1 THEN
    RAISE EXCEPTION 'checkpoint phase 2 : allergie non relue';
  END IF;
  IF (SELECT count(*) FROM app.list_patient_adverse_events(v_patient)) < 1 THEN
    RAISE EXCEPTION 'checkpoint phase 2 : effet non relu';
  END IF;
  IF (SELECT count(*) FROM app.list_patient_measurements(v_patient)) < 1 THEN
    RAISE EXCEPTION 'checkpoint phase 2 : mesure non relue';
  END IF;
  IF (SELECT count(*) FROM app.list_patient_adherence(v_patient)) < 1 THEN
    RAISE EXCEPTION 'checkpoint phase 2 : observance non relue';
  END IF;
  IF jsonb_array_length(app.list_patient_interaction_reviews(v_patient)) < 1 THEN
    RAISE EXCEPTION 'checkpoint phase 2 : revue non relue';
  END IF;

  -- ── Renouvellement : seulement si deux ordonnances existent ─────────────
  SELECT count(*) INTO v_issued
  FROM app.documents
  WHERE patient_id = v_patient AND doc_type = 'ordonnance' AND status = 'issued';

  SELECT COALESCE(array_agg((l->>'new_document_id')::uuid), '{}') INTO v_lies
  FROM jsonb_array_elements(app.list_patient_renewal_links(v_patient)) l;

  SELECT count(*) INTO v_dispo
  FROM app.documents d
  WHERE d.patient_id = v_patient AND d.doc_type = 'ordonnance' AND d.status = 'issued'
    AND NOT (d.id = ANY (v_lies));

  IF v_issued >= 2 AND v_dispo >= 1 THEN
    SELECT d.id INTO v_new_doc FROM app.documents d
    WHERE d.patient_id = v_patient AND d.doc_type = 'ordonnance' AND d.status = 'issued'
      AND NOT (d.id = ANY (v_lies))
    ORDER BY d.issued_at DESC LIMIT 1;
    SELECT d.id INTO v_old_doc FROM app.documents d
    WHERE d.patient_id = v_patient AND d.doc_type = 'ordonnance' AND d.status = 'issued'
      AND d.id <> v_new_doc
      AND d.issued_at < (SELECT nd.issued_at FROM app.documents nd WHERE nd.id = v_new_doc)
    ORDER BY d.issued_at DESC LIMIT 1;
    IF v_old_doc IS NOT NULL THEN
      PERFORM app.link_prescription_renewal(v_patient, v_new_doc, v_old_doc, 'checkpoint');
      IF jsonb_array_length(app.list_patient_renewal_links(v_patient)) < 1 THEN
        RAISE EXCEPTION 'checkpoint phase 2 : renouvellement non relu';
      END IF;
    ELSE
      RAISE NOTICE 'checkpoint phase 2 : aucune ordonnance antérieure, lien non éprouvé';
    END IF;
  ELSE
    RAISE NOTICE 'checkpoint phase 2 : moins de deux ordonnances, lien non éprouvé';
  END IF;

  -- ── Append-only : une mutation est refusée par le trigger ───────────────
  BEGIN
    UPDATE app.patient_allergy_events SET notes = 'mutation' WHERE id = v_allergy;
    RAISE EXCEPTION 'checkpoint phase 2 : mutation acceptée';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN
    NULL;
  END;

  -- ── Assistante : aucune lecture, aucune écriture ────────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_assistant::text, true);
  IF app.current_role() <> 'assistant' THEN
    RAISE EXCEPTION 'checkpoint phase 2 : assistante non résolue';
  END IF;
  IF EXISTS (SELECT 1 FROM app.list_patient_allergies(v_patient)) THEN
    RAISE EXCEPTION 'checkpoint phase 2 : assistante lit les allergies';
  END IF;
  IF EXISTS (SELECT 1 FROM app.list_patient_measurements(v_patient)) THEN
    RAISE EXCEPTION 'checkpoint phase 2 : assistante lit les mesures';
  END IF;
  IF app.list_patient_interaction_reviews(v_patient) IS NOT NULL THEN
    RAISE EXCEPTION 'checkpoint phase 2 : assistante lit les revues';
  END IF;

  BEGIN
    PERFORM app.record_patient_allergy(v_patient, 'Test', 'Test', 'legere', 'noted', NULL, NULL);
    RAISE EXCEPTION 'checkpoint phase 2 : assistante a écrit';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;

  -- ── Praticienne hors périmètre : aucune lecture, aucune écriture ────────
  IF v_practitioner <> '' THEN
    PERFORM set_config('request.jwt.claim.sub', v_practitioner, true);
    IF EXISTS (SELECT 1 FROM app.list_patient_allergies(v_patient)) THEN
      RAISE EXCEPTION 'checkpoint phase 2 : praticienne hors périmètre lit les allergies';
    END IF;
    BEGIN
      PERFORM app.record_measurement(
        v_patient, 'weight_kg', 70, 'kg', now(), 'consultation', NULL, NULL, NULL, NULL
      );
      RAISE EXCEPTION 'checkpoint phase 2 : praticienne hors périmètre a écrit';
    EXCEPTION WHEN SQLSTATE '42501' THEN
      NULL;
    END;
  END IF;

  RAISE NOTICE 'checkpoint phase 2 : PASS';
END $$;

ROLLBACK;
