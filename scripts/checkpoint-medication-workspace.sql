-- checkpoint-medication-workspace.sql — ADR-028 / migration 211.
--
-- Exécution : psql -v ON_ERROR_STOP=1 -f scripts/checkpoint-medication-workspace.sql
-- La transaction est TOUJOURS annulée : ce fichier ne laisse aucune ligne.
-- Il exige une base contenant au moins un profil owner, un profil assistant et
-- un traitement. Les fixtures vivent dans la transaction, jamais dans un seed.
--
-- Ce fichier est un TEST, pas une migration : il éprouve la visibilité, la
-- déduplication des événements, les dates d'annulation, la pagination keyset
-- et le filtrage de la file de charge sur la base où il est lancé.

BEGIN;

-- 1 · Résolution des identités, AVANT de baisser les droits. La lecture des
-- profils est faite par le rôle d'administration de la session de test, puis
-- les identifiants sont passés au bloc authentifié par des GUC locales.
DO $$
DECLARE
  v_owner uuid;
  v_assistant uuid;
  v_practitioner uuid;
  v_patient uuid;
BEGIN
  SELECT id INTO v_owner FROM app.profiles WHERE role = 'owner' ORDER BY id LIMIT 1;
  SELECT id INTO v_assistant FROM app.profiles WHERE role = 'assistant' ORDER BY id LIMIT 1;
  SELECT pt.patient_id INTO v_patient FROM app.patient_treatments pt ORDER BY pt.created_at LIMIT 1;
  -- La praticienne de contrôle doit être HORS du périmètre du dossier choisi,
  -- sinon le test échouerait alors que la cloison fonctionne.
  SELECT pr.id INTO v_practitioner
  FROM app.profiles pr
  WHERE pr.role = 'practitioner'
    AND pr.id <> (SELECT p.practitioner_id FROM app.patients p WHERE p.id = v_patient)
  ORDER BY pr.id
  LIMIT 1;

  IF v_owner IS NULL OR v_assistant IS NULL OR v_patient IS NULL THEN
    RAISE EXCEPTION 'checkpoint medication : profils ou traitement absents';
  END IF;

  PERFORM set_config('checkpoint.owner', v_owner::text, true);
  PERFORM set_config('checkpoint.assistant', v_assistant::text, true);
  PERFORM set_config('checkpoint.practitioner', COALESCE(v_practitioner::text, ''), true);
  PERFORM set_config('checkpoint.patient', v_patient::text, true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_owner uuid := current_setting('checkpoint.owner')::uuid;
  v_assistant uuid := current_setting('checkpoint.assistant')::uuid;
  v_practitioner text := current_setting('checkpoint.practitioner');
  v_patient uuid := current_setting('checkpoint.patient')::uuid;
  v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
  v_tout integer;
  v_revue integer;
  v_fin integer;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_ids uuid[] := '{}';
  v_ids7 uuid[] := '{}';
  v_n integer;
  v_vus integer := 0;
  v_vus7 integer := 0;
  v_ligne record;
BEGIN
  -- ── Owner : lecture autorisée ────────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  IF app.current_role() <> 'owner' THEN
    RAISE EXCEPTION 'checkpoint medication : owner non résolu';
  END IF;
  IF app.get_patient_treatments(v_patient) IS NULL THEN
    RAISE EXCEPTION 'checkpoint medication : owner sans lecture des traitements';
  END IF;
  IF app.list_medication_workload('', 30, 0) IS NULL THEN
    RAISE EXCEPTION 'checkpoint medication : owner sans file de charge';
  END IF;

  -- ── Fixture transactionnelle : une annulation réelle, puis ROLLBACK ──────
  -- On annule l'ordonnance la plus récente pour éprouver les DEUX dates
  -- (émission et annulation) sur un vrai document. Rien ne survit : le
  -- ROLLBACK final annule aussi cet acte et ses traces.
  IF EXISTS (
    SELECT 1 FROM app.documents
    WHERE patient_id = v_patient AND doc_type = 'ordonnance' AND status = 'issued'
  ) THEN
    PERFORM app.void_document(
      (
        SELECT d.id FROM app.documents d
        WHERE d.patient_id = v_patient
          AND d.doc_type = 'ordonnance'
          AND d.status = 'issued'
        ORDER BY d.issued_at DESC
        LIMIT 1
      ),
      'checkpoint transactionnel'
    );
  ELSE
    RAISE NOTICE 'checkpoint medication : aucune ordonnance à annuler, dates d''annulation non éprouvées';
  END IF;

  -- ── Vue complète, sans borne de 50 ──────────────────────────────────────
  -- Les assertions de dates et de déduplication doivent voir TOUT l'historique,
  -- pas seulement la première page. On matérialise donc l'historique complet
  -- dans une table temporaire, page par page, avant de l'interroger.
  CREATE TEMP TABLE checkpoint_timeline ON COMMIT DROP AS
  SELECT * FROM app.list_patient_medication_timeline(v_patient, NULL, NULL, 50) WITH NO DATA;

  v_cursor_at := NULL;
  v_cursor_id := NULL;
  LOOP
    INSERT INTO checkpoint_timeline
    SELECT * FROM app.list_patient_medication_timeline(v_patient, v_cursor_at, v_cursor_id, 50);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXIT WHEN v_n = 0;

    -- Le curseur suivant est la DERNIÈRE ligne de la page qu'on vient
    -- d'insérer (la plus ancienne), pas la plus récente de la table.
    SELECT e.occurred_at, e.event_id INTO v_cursor_at, v_cursor_id
    FROM app.list_patient_medication_timeline(v_patient, v_cursor_at, v_cursor_id, 50) e
    ORDER BY e.occurred_at ASC, e.event_id ASC
    LIMIT 1;

    IF (SELECT count(*) FROM checkpoint_timeline) > 2000 THEN
      RAISE EXCEPTION 'checkpoint medication : budget de pagination dépassé (2000)';
    END IF;
  END LOOP;

  -- ── Déduplication : aucune ligne ne doit apparaître deux fois ────────────
  IF EXISTS (
    SELECT 1
    FROM checkpoint_timeline e
    GROUP BY e.event_kind, e.event_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'checkpoint medication : événement dupliqué dans la chronologie';
  END IF;

  -- Une prescription reliée à une ordonnance ne doit pas produire DEUX actes.
  IF EXISTS (
    SELECT 1
    FROM app.documents d
    JOIN app.prescriptions px ON px.id = d.prescription_id
    WHERE d.patient_id = v_patient
      AND d.doc_type = 'ordonnance'
    GROUP BY px.id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'checkpoint medication : ordonnance reliée à plusieurs documents';
  END IF;

  -- ── Dates d'annulation : l'émission garde sa date, l'annulation la sienne ─
  IF EXISTS (
    SELECT 1
    FROM app.documents d
    WHERE d.patient_id = v_patient
      AND d.doc_type = 'ordonnance'
      AND d.status = 'voided'
      AND d.voided_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM checkpoint_timeline e
        WHERE e.event_kind = 'document'
          AND e.action = 'document_voided'
          AND e.event_id = public.uuid_generate_v5(
            '00000000-0000-0000-0000-000000000000'::uuid,
            d.id::text || ':voided'
          )
          AND e.occurred_at = d.voided_at
      )
  ) THEN
    RAISE EXCEPTION 'checkpoint medication : annulation sans date propre';
  END IF;

  -- L'émission d'une ordonnance annulée reste datée à issued_at.
  IF EXISTS (
    SELECT 1
    FROM app.documents d
    WHERE d.patient_id = v_patient
      AND d.doc_type = 'ordonnance'
      AND d.status = 'voided'
      AND NOT EXISTS (
        SELECT 1
        FROM checkpoint_timeline e
        WHERE e.event_kind = 'document'
          AND e.action = 'document_issued'
          AND e.event_id = d.id
          AND e.occurred_at = d.issued_at
      )
  ) THEN
    RAISE EXCEPTION 'checkpoint medication : émission annulée sans date d''émission';
  END IF;

  -- ── Pagination keyset : deux tailles de page, aucun doublon, aucun saut ──
  -- On parcourt d'abord par pages de 2, puis indépendamment par pages de 7.
  -- Deux découpages différents doivent rendre EXACTEMENT le même ensemble :
  -- c'est ce qui détecte un curseur qui saute ou répète une ligne, sans
  -- supposer une borne de 50 événements.
  v_cursor_at := NULL;
  v_cursor_id := NULL;
  LOOP
    SELECT count(*) INTO v_n
    FROM app.list_patient_medication_timeline(v_patient, v_cursor_at, v_cursor_id, 2);

    EXIT WHEN v_n = 0;

    FOR v_ligne IN
      SELECT * FROM app.list_patient_medication_timeline(v_patient, v_cursor_at, v_cursor_id, 2)
    LOOP
      IF v_ligne.event_id = ANY (v_ids) THEN
        RAISE EXCEPTION 'checkpoint medication : doublon entre deux pages de chronologie';
      END IF;
      v_ids := array_append(v_ids, v_ligne.event_id);
      v_cursor_at := v_ligne.occurred_at;
      v_cursor_id := v_ligne.event_id;
      v_vus := v_vus + 1;
    END LOOP;

    EXIT WHEN v_n < 2;
    IF v_vus > 2000 THEN
      RAISE EXCEPTION 'checkpoint medication : budget de pagination dépassé (2000)';
    END IF;
  END LOOP;

  v_cursor_at := NULL;
  v_cursor_id := NULL;
  LOOP
    SELECT count(*) INTO v_n
    FROM app.list_patient_medication_timeline(v_patient, v_cursor_at, v_cursor_id, 7);

    EXIT WHEN v_n = 0;

    FOR v_ligne IN
      SELECT * FROM app.list_patient_medication_timeline(v_patient, v_cursor_at, v_cursor_id, 7)
    LOOP
      v_ids7 := array_append(v_ids7, v_ligne.event_id);
      v_cursor_at := v_ligne.occurred_at;
      v_cursor_id := v_ligne.event_id;
      v_vus7 := v_vus7 + 1;
    END LOOP;

    EXIT WHEN v_n < 7;
    IF v_vus7 > 2000 THEN
      RAISE EXCEPTION 'checkpoint medication : budget de pagination dépassé (2000)';
    END IF;
  END LOOP;

  IF v_vus <> v_vus7
     OR v_vus <> (SELECT count(*) FROM checkpoint_timeline)
     OR (
       SELECT array_agg(x ORDER BY x) FROM unnest(v_ids) AS x
     ) IS DISTINCT FROM (
       SELECT array_agg(x ORDER BY x) FROM unnest(v_ids7) AS x
     )
  THEN
    RAISE EXCEPTION 'checkpoint medication : pagination incomplète (% vs %, % matérialisés)', v_vus, v_vus7, (SELECT count(*) FROM checkpoint_timeline);
  END IF;

  -- ── File de charge : filtres cohérents et bornés au périmètre ────────────
  v_tout := (app.list_medication_workload('', 100, 0, NULL)->>'total')::integer;
  v_revue := (app.list_medication_workload('', 100, 0, 'revue')->>'total')::integer;
  v_fin := (app.list_medication_workload('', 100, 0, 'fin')->>'total')::integer;

  IF v_revue > v_tout OR v_fin > v_tout OR v_fin > v_revue THEN
    RAISE EXCEPTION 'checkpoint medication : filtres de charge incohérents';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(app.list_medication_workload('', 100, 0, 'fin')->'rows') r
    WHERE (r->>'next_end_date')::date > v_today + 14
  ) THEN
    RAISE EXCEPTION 'checkpoint medication : une fin lointaine est dans le filtre fin';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(app.list_medication_workload('', 100, 0, 'revue')->'rows') r
    WHERE NOT (r->>'has_overdue_end_date')::boolean
      AND NOT (r->>'has_missing_posology')::boolean
      AND (
        r->>'next_end_date' IS NULL
        OR (r->>'next_end_date')::date > v_today + 14
      )
  ) THEN
    RAISE EXCEPTION 'checkpoint medication : un dossier sans attention est dans la revue';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(app.list_medication_workload('', 100, 0, NULL)->'rows') r
    WHERE NOT EXISTS (
      SELECT 1 FROM app.get_patient((r->>'patient_id')::uuid)
    )
  ) THEN
    RAISE EXCEPTION 'checkpoint medication : la charge contient un dossier hors périmètre';
  END IF;

  -- ── Assistante : aucune ligne, même par appel direct ─────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_assistant::text, true);
  IF app.current_role() <> 'assistant' THEN
    RAISE EXCEPTION 'checkpoint medication : assistante non résolue';
  END IF;
  IF app.get_patient_treatments(v_patient) IS NOT NULL THEN
    RAISE EXCEPTION 'checkpoint medication : assistante lit les traitements';
  END IF;
  IF app.list_medication_workload('', 30, 0) IS NOT NULL THEN
    RAISE EXCEPTION 'checkpoint medication : assistante lit la file de charge';
  END IF;
  IF EXISTS (SELECT 1 FROM app.list_patient_medication_timeline(v_patient, NULL, NULL, 10)) THEN
    RAISE EXCEPTION 'checkpoint medication : assistante lit la chronologie';
  END IF;
  IF EXISTS (SELECT 1 FROM app.get_patient_session_measures(v_patient, 10)) THEN
    RAISE EXCEPTION 'checkpoint medication : assistante lit les mesures de séance';
  END IF;

  -- ── Praticienne non propriétaire : aucune ligne sur ce dossier ────────────
  IF v_practitioner <> '' THEN
    PERFORM set_config('request.jwt.claim.sub', v_practitioner, true);
    IF app.get_patient_treatments(v_patient) IS NOT NULL THEN
      RAISE EXCEPTION 'checkpoint medication : praticienne hors périmètre lit le dossier';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(app.list_medication_workload('', 100, 0, NULL)->'rows') r
      WHERE (r->>'patient_id')::uuid = v_patient
    ) THEN
      RAISE EXCEPTION 'checkpoint medication : la charge hors périmètre contient le dossier';
    END IF;
  END IF;

  RAISE NOTICE 'checkpoint medication : PASS (% événements paginés)', v_vus;
END $$;

ROLLBACK;
