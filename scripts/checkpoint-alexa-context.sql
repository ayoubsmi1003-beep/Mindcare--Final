-- Run only against an approved synthetic local database with migrations120/121/122.
-- All synthetic fixtures, audit reads and results are rolled back.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE _alexa_scope (patient uuid, foreign_patient uuid, practitioner uuid, owner uuid, assistant uuid, expected uuid[]);
CREATE TEMP TABLE _alexa_verdict (name text, passed boolean);
GRANT SELECT ON _alexa_scope TO authenticated;
GRANT SELECT, INSERT ON _alexa_verdict TO authenticated;

DO $$
DECLARE v_cab uuid; v_practitioner uuid; v_owner uuid; v_assistant uuid;
  v_patient uuid; v_foreign uuid; v_consult uuid; v_expected uuid[]; v_i integer; v_start timestamptz;
  v_med uuid; v_treatment uuid; v_state app.treatment_status;
BEGIN
  IF to_regprocedure('app.get_alexa_clinical_context(uuid,integer,timestamptz,uuid)') IS NULL THEN
    RAISE EXCEPTION 'migration120-required';
  END IF;
  IF to_regprocedure('app.get_alexa_case_summary(uuid)') IS NULL THEN
    RAISE EXCEPTION 'migration121-required';
  END IF;
  SELECT p.id, p.cabinet_id INTO v_practitioner, v_cab FROM app.profiles p WHERE p.role = 'practitioner' ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_owner FROM app.profiles p WHERE p.role = 'owner' AND p.cabinet_id = v_cab ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_assistant FROM app.profiles p WHERE p.role = 'assistant' AND p.cabinet_id = v_cab ORDER BY p.id LIMIT 1;
  IF v_practitioner IS NULL OR v_owner IS NULL OR v_assistant IS NULL THEN RAISE EXCEPTION 'three-role-fixture-required'; END IF;
  INSERT INTO app.patients(cabinet_id, practitioner_id, record_number, first_name, last_name, phone, is_synthetic)
    VALUES(v_cab, v_practitioner, 'ALEXA-CHECK-' || gen_random_uuid()::text, 'Fixture', 'Contexte', '0000000000', true) RETURNING id INTO v_patient;
  INSERT INTO app.patients(cabinet_id, practitioner_id, record_number, first_name, last_name, phone, is_synthetic)
    VALUES(v_cab, v_owner, 'ALEXA-CHECK-' || gen_random_uuid()::text, 'Fixture', 'Autre périmètre', '0000000000', true) RETURNING id INTO v_foreign;
  FOR v_i IN 1..100 LOOP
    v_start := timestamptz '2025-01-01T10:00:00Z' + (v_i / 2) * interval '1 day';
    INSERT INTO app.consultations(cabinet_id, practitioner_id, patient_id, started_at, ended_at, status, raw_notes, is_synthetic)
      VALUES(v_cab, v_practitioner, v_patient, v_start, v_start + ((101 - v_i) * interval '1 day'), 'closed', 'Observation fictive', true)
      RETURNING id INTO v_consult;
    INSERT INTO app.clinical_notes(cabinet_id, practitioner_id, patient_id, consultation_id, status, subjective, signed_at, lock_after, is_synthetic)
      VALUES(v_cab, v_practitioner, v_patient, v_consult, 'signed', 'Note fictive', now(), now() + interval '15 minutes', true);
  END LOOP;
  SELECT array_agg(x.id ORDER BY x.started_at DESC, x.id DESC) INTO v_expected
    FROM (SELECT c.id, c.started_at FROM app.consultations c WHERE c.patient_id = v_patient
      ORDER BY c.started_at DESC, c.id DESC LIMIT 5) x;
  INSERT INTO _alexa_scope VALUES(v_patient, v_foreign, v_practitioner, v_owner, v_assistant, v_expected);
  INSERT INTO app.medications(cabinet_id, inn, brand_name, source)
    VALUES(v_cab, 'sertraline', 'sertraline', 'manual') RETURNING id INTO v_med;
  FOREACH v_state IN ARRAY ARRAY['active','paused','stopped']::app.treatment_status[] LOOP
    INSERT INTO app.patient_treatments(cabinet_id, practitioner_id, patient_id, medication_id, status,
      dose, dose_unit, frequency, start_date, stopped_at, current_version, is_synthetic)
      VALUES(v_cab, v_practitioner, v_patient, v_med, v_state,
        CASE v_state WHEN 'active' THEN '100' WHEN 'paused' THEN '50' ELSE '25' END,
        'mg', 'daily', date '2026-01-01', CASE WHEN v_state = 'stopped' THEN now() ELSE NULL END, 2, true)
      RETURNING id INTO v_treatment;
    INSERT INTO app.patient_treatment_history(treatment_id, version, action, previous_values, new_values, actor_id, is_synthetic)
      VALUES(v_treatment, 1, 'dose_changed', '{"dose":"25","dose_unit":"mg","status":"active"}',
        '{"dose":"50","dose_unit":"mg","status":"paused"}', v_practitioner, true);
  END LOOP;
  INSERT INTO _alexa_verdict SELECT 'gatekeeper-has-no-bypass', NOT r.rolsuper AND NOT r.rolbypassrls
    FROM pg_roles r WHERE r.rolname = 'app_gatekeeper';
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE s record; v_context jsonb; v_revision text; v_before_at timestamptz; v_before_id uuid; v_ids uuid[]; v_count integer := 0; v_next jsonb;
BEGIN
  SELECT * INTO s FROM _alexa_scope;
  PERFORM set_config('request.jwt.claim.sub', s.practitioner::text, true);
  IF auth.uid() <> s.practitioner THEN RAISE EXCEPTION 'caller-not-effective'; END IF;
  v_context := app.get_alexa_clinical_context(s.patient, 5);
  SELECT array_agg((x.value ->> 'id')::uuid ORDER BY x.ordinality) INTO v_ids
    FROM jsonb_array_elements(v_context -> 'consultations') WITH ORDINALITY x;
  INSERT INTO _alexa_verdict VALUES('last-five-started-at-uuid-order', v_ids = s.expected);
  INSERT INTO _alexa_verdict VALUES('practitioner-own-visible', v_context IS NOT NULL);
  INSERT INTO _alexa_verdict VALUES('practitioner-other-hidden', app.get_alexa_clinical_context(s.foreign_patient, 1) IS NULL);
  INSERT INTO _alexa_verdict VALUES('missing-same-hidden-result', app.get_alexa_clinical_context(gen_random_uuid(), 1) IS NULL);
  v_revision := v_context ->> 'sourceRevision';
  LOOP
    v_context := app.get_alexa_clinical_context(s.patient, 20, v_before_at, v_before_id);
    IF (v_context ->> 'sourceRevision') IS DISTINCT FROM v_revision THEN RAISE EXCEPTION 'unstable-page-revision'; END IF;
    v_count := v_count + jsonb_array_length(v_context -> 'consultations');
    EXIT WHEN NOT (v_context -> 'coverage' ->> 'hasMore')::boolean;
    v_next := v_context -> 'coverage' -> 'next';
    v_before_at := (v_next ->> 'startedAt')::timestamptz; v_before_id := (v_next ->> 'id')::uuid;
    IF v_count >= 100 THEN RAISE EXCEPTION 'cursor-did-not-terminate'; END IF;
  END LOOP;
  INSERT INTO _alexa_verdict VALUES('one-hundred-paged-with-stable-revision', v_count = 100);
  PERFORM set_config('request.jwt.claim.sub', s.owner::text, true);
  INSERT INTO _alexa_verdict VALUES('owner-clinical-visible', app.get_alexa_clinical_context(s.patient, 1) IS NOT NULL);
  PERFORM set_config('request.jwt.claim.sub', s.assistant::text, true);
  INSERT INTO _alexa_verdict VALUES('assistant-clinical-hidden', app.get_alexa_clinical_context(s.patient, 1) IS NULL);
END $$;

RESET ROLE;
DO $$
DECLARE s record; v_before text; v_after text;
BEGIN
  SELECT * INTO s FROM _alexa_scope;
  PERFORM set_config('request.jwt.claim.sub', s.practitioner::text, true);
  v_before := app.get_alexa_clinical_context(s.patient, 1) ->> 'sourceRevision';
  -- A note outside the requested last page must invalidate its revision.
  INSERT INTO app.clinical_note_amendments(note_id, author_id, reason, body)
    SELECT n.id, s.practitioner, 'Correction fictive', 'Fait fictif corrigé'
      FROM app.clinical_notes n JOIN app.consultations c ON c.id = n.consultation_id
      WHERE c.patient_id = s.patient ORDER BY c.started_at, c.id LIMIT 1;
  v_after := app.get_alexa_clinical_context(s.patient, 1) ->> 'sourceRevision';
  INSERT INTO _alexa_verdict VALUES('older-note-amendment-invalidates-last-page', v_before IS DISTINCT FROM v_after);
  IF EXISTS (SELECT 1 FROM _alexa_verdict WHERE passed IS DISTINCT FROM true) THEN RAISE EXCEPTION 'alexa-checkpoint-failed'; END IF;
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE s record; v_context jsonb; v_summary jsonb; v_revision text; v_treatment uuid; v_read jsonb; v_first_version integer;
  v_saved app.patient_case_summaries%ROWTYPE; v_rejected boolean := false;
BEGIN
  SELECT * INTO s FROM _alexa_scope;
  PERFORM set_config('request.jwt.claim.sub', s.practitioner::text, true);
  v_context := app.get_alexa_clinical_context(s.patient, 1);
  INSERT INTO _alexa_verdict VALUES('treatment-states-kept-separate',
    jsonb_array_length(v_context->'treatments'->'current') = 3 AND
    (SELECT count(DISTINCT x->>'status') = 3 FROM jsonb_array_elements(v_context->'treatments'->'current') x));
  INSERT INTO _alexa_verdict VALUES('current-dose-and-history-differ-without-substitution',
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_context->'treatments'->'current') x WHERE x->>'status' = 'active' AND x->>'dose' = '100')
    AND v_context->'treatments'->'history'->0->'next'->>'dose' = '50');
  SELECT (x->>'id')::uuid INTO v_treatment FROM jsonb_array_elements(v_context->'treatments'->'current') x WHERE x->>'status' = 'active';
  v_revision := v_context->>'sourceRevision';
  v_summary := jsonb_build_object('schema',2,'apercu', jsonb_build_object('nom','Dossier fictif',
    'traitements', jsonb_build_array(jsonb_build_object('texte','Fait médicamenteux fictif',
      'sources',jsonb_build_array(jsonb_build_object('t','treatment','id',v_treatment))))),
    'chronologie','[]'::jsonb,'anterieur','[]'::jsonb,'etat_actuel','[]'::jsonb);
  SELECT * INTO v_saved FROM app.save_alexa_case_summary(s.patient,v_summary::text,
    jsonb_build_object('alexaSourceRevision',v_revision,'alexaNoteAreas',5)::text,'local-structured','checkpoint','checkpoint');
  INSERT INTO _alexa_verdict VALUES('summary-saves-treatment-source', v_saved.id IS NOT NULL);
  INSERT INTO _alexa_verdict VALUES('new-summary-is-current', (app.get_alexa_summary_status(s.patient)->>'aJour')::boolean);
  v_read := app.get_alexa_case_summary(s.patient);
  INSERT INTO _alexa_verdict VALUES('persisted-summary-readable-with-content-and-metadata',
    (v_read->>'id')::uuid = v_saved.id AND (v_read->>'version')::integer = v_saved.version
    AND (v_read->>'genere_le')::timestamptz = v_saved.generated_at
    AND v_read ? 'genere_par' AND v_read->'content' = v_summary AND (v_read->>'aJour')::boolean);
  v_first_version := v_saved.version;
  v_summary := jsonb_set(v_summary,'{apercu,traitements,0,texte}',to_jsonb('Fait médicamenteux fictif, version suivante'::text));
  SELECT * INTO v_saved FROM app.save_alexa_case_summary(s.patient,v_summary::text,
    jsonb_build_object('alexaSourceRevision',v_revision,'alexaNoteAreas',5)::text,'local-structured','checkpoint','checkpoint');
  v_read := app.get_alexa_case_summary(s.patient);
  INSERT INTO _alexa_verdict VALUES('latest-summary-version-and-real-source-content-read',
    (v_read->>'id')::uuid = v_saved.id AND (v_read->>'version')::integer = v_first_version + 1
    AND v_read->'content' = v_summary
    AND (v_read->'content'->'apercu'->'traitements'->0->'sources'->0->>'id')::uuid = v_treatment);
  -- The foreign-scope negative must hide an actual persisted summary, not an
  -- empty record that would also return null from an incorrectly open gate.
  PERFORM set_config('request.jwt.claim.sub', s.owner::text, true);
  PERFORM app.save_alexa_case_summary(s.foreign_patient,
    jsonb_set(v_summary,'{apercu,traitements}','[]'::jsonb)::text,
    jsonb_build_object('alexaSourceRevision',app.get_alexa_clinical_context(s.foreign_patient,1)->>'sourceRevision')::text,
    'local-structured','checkpoint','checkpoint');
  IF app.get_alexa_case_summary(s.foreign_patient) IS NULL THEN RAISE EXCEPTION 'foreign-summary-fixture-unavailable'; END IF;
  PERFORM set_config('request.jwt.claim.sub', s.practitioner::text, true);
  INSERT INTO _alexa_verdict VALUES('summary-read-foreign-and-missing-hidden',
    app.get_alexa_case_summary(s.foreign_patient) IS NULL AND app.get_alexa_case_summary(gen_random_uuid()) IS NULL);
  PERFORM set_config('request.jwt.claim.sub', s.assistant::text, true);
  INSERT INTO _alexa_verdict VALUES('summary-read-assistant-hidden', app.get_alexa_case_summary(s.patient) IS NULL);
  -- The internal validator is deliberately not executable by authenticated.
  -- Exercise its patient binding through the authorized public save gate.
  PERFORM set_config('request.jwt.claim.sub', s.owner::text, true);
  BEGIN
    PERFORM app.save_alexa_case_summary(s.foreign_patient,v_summary::text,
      jsonb_build_object('alexaSourceRevision',
        app.get_alexa_clinical_context(s.foreign_patient,1)->>'sourceRevision')::text,
      'local-structured','checkpoint','checkpoint');
  EXCEPTION WHEN raise_exception THEN v_rejected := true; END;
  INSERT INTO _alexa_verdict VALUES('summary-cross-patient-source-rejected',v_rejected);
END $$;
RESET ROLE;
DO $$
DECLARE s record; v_old_revision text; v_content text; v_rejected boolean := false;
BEGIN
  SELECT * INTO s FROM _alexa_scope;
  PERFORM set_config('request.jwt.claim.sub',s.practitioner::text,true);
  SELECT source_state->>'alexaSourceRevision',content::text INTO v_old_revision,v_content
    FROM app.patient_case_summaries WHERE patient_id=s.patient ORDER BY version DESC LIMIT 1;
  UPDATE app.patient_treatments SET dose='125' WHERE patient_id=s.patient AND status='active';
  INSERT INTO _alexa_verdict VALUES('treatment-change-makes-summary-stale', NOT (app.get_alexa_summary_status(s.patient)->>'aJour')::boolean);
  INSERT INTO _alexa_verdict VALUES('stale-summary-read-keeps-content-and-reports-outdated',
    NOT (app.get_alexa_case_summary(s.patient)->>'aJour')::boolean
    AND app.get_alexa_case_summary(s.patient)->'content' = v_content::jsonb);
  BEGIN
    PERFORM app.save_alexa_case_summary(s.patient,v_content,jsonb_build_object('alexaSourceRevision',v_old_revision)::text,
      'local-structured','checkpoint','checkpoint');
  EXCEPTION WHEN raise_exception THEN v_rejected := true; END;
  INSERT INTO _alexa_verdict VALUES('stale-summary-save-rejected',v_rejected);
  IF EXISTS (SELECT 1 FROM _alexa_verdict WHERE passed IS DISTINCT FROM true) THEN RAISE EXCEPTION 'alexa-checkpoint-failed'; END IF;
END $$;
DO $$
DECLARE s record; v_visit uuid; v_context jsonb; v_note jsonb; v_before text; v_summary jsonb; v_saved app.patient_case_summaries%ROWTYPE;
BEGIN
  SELECT * INTO s FROM _alexa_scope;
  INSERT INTO app.consultations(cabinet_id, practitioner_id, patient_id, started_at, ended_at, status, raw_notes, is_synthetic)
    SELECT p.cabinet_id, s.practitioner, s.patient, '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z', 'closed', 'Première note fictive, contexte familial.', true
      FROM app.profiles p WHERE p.id = s.practitioner RETURNING id INTO v_visit;
  INSERT INTO app.clinical_notes(cabinet_id, practitioner_id, patient_id, consultation_id, status, subjective, objective, assessment, plan, is_synthetic)
    SELECT p.cabinet_id, s.practitioner, s.patient, v_visit, 'draft', 'Subjectif fictif', 'Objectif fictif', 'Évaluation fictive', 'Plan fictif', true
      FROM app.profiles p WHERE p.id = s.practitioner;
  PERFORM set_config('request.jwt.claim.sub', s.practitioner::text, true);
  v_context := app.get_alexa_clinical_context(s.patient, 1);
  v_note := v_context->'consultations'->0->'notes'->0;
  INSERT INTO _alexa_verdict VALUES('five-areas-working-note-and-four-saved-soap-fields',
    v_context->'consultations'->0->>'rawNotes' = 'Première note fictive, contexte familial.'
    AND v_note->>'subjective' = 'Subjectif fictif' AND v_note->>'objective' = 'Objectif fictif'
    AND v_note->>'assessment' = 'Évaluation fictive' AND v_note->>'plan' = 'Plan fictif');
  INSERT INTO _alexa_verdict VALUES('saved-unsigned-soap-is-labelled-draft', v_note->>'status' = 'draft');
  INSERT INTO _alexa_verdict VALUES('raw-note-version-is-whole-source-revision',
    v_context->'consultations'->0->>'rawNotesVersion' = v_context->>'sourceRevision');
  v_before := v_context->>'sourceRevision';
  v_summary := jsonb_build_object('schema',2,'apercu',jsonb_build_object('nom','Dossier fictif'),
    'chronologie','[]'::jsonb,'anterieur','[]'::jsonb,'etat_actuel',jsonb_build_array(
      jsonb_build_object('texte','Première note fictive, contexte familial.',
        'sources',jsonb_build_array(jsonb_build_object('t','consultation','id',v_visit)))));
  SELECT * INTO v_saved FROM app.save_alexa_case_summary(s.patient,v_summary::text,
    jsonb_build_object('alexaSourceRevision',v_before)::text,'local-structured','checkpoint-old','checkpoint');
  INSERT INTO _alexa_verdict VALUES('old-summary-format-remains-readable-but-outdated',
    app.get_alexa_case_summary(s.patient)->'content' = v_summary
    AND NOT (app.get_alexa_case_summary(s.patient)->>'aJour')::boolean);
  SELECT * INTO v_saved FROM app.save_alexa_case_summary(s.patient,v_summary::text,
    jsonb_build_object('alexaSourceRevision',v_before,'alexaNoteAreas',5)::text,'local-structured','checkpoint-v4','checkpoint');
  INSERT INTO _alexa_verdict VALUES('five-note-summary-content-source-and-freshness-persist',
    app.get_alexa_case_summary(s.patient)->'content' = v_summary
    AND (app.get_alexa_case_summary(s.patient)->>'aJour')::boolean);
  UPDATE app.consultations SET raw_notes = 'Première note fictive modifiée' WHERE id = v_visit;
  INSERT INTO _alexa_verdict VALUES('working-note-edit-invalidates-context-and-summary',
    app.get_alexa_clinical_context(s.patient,1)->>'sourceRevision' <> v_before
    AND NOT (app.get_alexa_summary_status(s.patient)->>'aJour')::boolean);
  IF EXISTS (SELECT 1 FROM _alexa_verdict WHERE passed IS DISTINCT FROM true) THEN RAISE EXCEPTION 'alexa-checkpoint-failed'; END IF;
END $$;
SELECT name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result FROM _alexa_verdict ORDER BY name;
ROLLBACK;
