-- 127_legacy_identity_scope — périmètre identité + purge du clinique importé.
--
-- Décision humaine (2026-10-06) : l'import legacy se limite à l'identité
-- (nom, téléphone, N° carte, naissance). Les historiques et ordonnances
-- déjà importés par le lot 126 sont purgés de façon auditée ; les patients
-- sont conservés ; les fichiers source restent intacts (réimport possible).
--
-- Règles : purge bornée au lot + cabinet, réservée au owner, journalisée par
-- trg_audit (les DELETE sont tracés, jamais silencieux). Aucune naissance
-- n'est jugée ici : la porte stocke verbatim, le script signale en revue.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Naissance dans la porte d'import (remplace la signature à 8 args).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS
  app.legacy_import_patient(uuid, text, text, text, text, text, uuid, text);

CREATE OR REPLACE FUNCTION app.legacy_import_patient(
  p_batch uuid, p_source_id text, p_first text, p_last text,
  p_phone text, p_cdi text, p_practitioner uuid, p_sha text,
  p_naissance date DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_found    uuid;
  v_patient  uuid;
  v_numero   bigint;
  v_first    text := btrim(coalesce(p_first, ''));
  v_last     text := btrim(coalesce(p_last, ''));
  v_phone    text := nullif(btrim(coalesce(p_phone, '')), '');
  v_cdi      text := nullif(btrim(coalesce(p_cdi, '')), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.legacy_migration_batches b
                 WHERE b.id = p_batch AND b.cabinet_id = app.current_cabinet()
                   AND b.status = 'running') THEN
    RAISE EXCEPTION 'Lot de migration introuvable ou clôturé.';
  END IF;
  IF v_first = '' AND v_last = '' THEN
    RAISE EXCEPTION 'Identité vide : ce dossier relève de la quarantaine.';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^[0-9+ ]{8,20}$' THEN
    RAISE EXCEPTION 'Téléphone hors format : ce dossier relève de la revue.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.profiles pr
                 WHERE pr.id = p_practitioner
                   AND pr.cabinet_id = app.current_cabinet()
                   AND pr.role IN ('owner','practitioner')) THEN
    RAISE EXCEPTION 'Praticien responsable introuvable dans ce cabinet.';
  END IF;

  -- Idempotence : rejouer ne duplique jamais.
  SELECT mindcare_id INTO v_found FROM app.legacy_id_map
  WHERE source_system = 'syglab' AND source_kind = 'patient'
    AND source_id = p_source_id;
  IF FOUND THEN RETURN v_found; END IF;

  v_numero := app.next_number(app.current_cabinet(), 'patient_record', 'ALL');

  INSERT INTO app.patients (
    cabinet_id, practitioner_id, record_number,
    first_name, last_name, birth_date, phone, id_document_number,
    is_synthetic, created_by
  ) VALUES (
    app.current_cabinet(), p_practitioner,
    'P-' || lpad(v_numero::text, 4, '0'),
    v_first, v_last, p_naissance, v_phone, v_cdi,
    app.is_cloud_dev(), auth.uid()
  ) RETURNING id INTO v_patient;

  INSERT INTO app.legacy_id_map
    (cabinet_id, batch_id, source_kind, source_id, mindcare_id,
     content_sha256, is_synthetic)
  VALUES (app.current_cabinet(), p_batch, 'patient', p_source_id,
          v_patient, p_sha, app.is_cloud_dev());

  RETURN v_patient;
END;
$$;

ALTER FUNCTION app.legacy_import_patient(uuid, text, text, text, text, text, uuid, text, date)
  OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.legacy_import_patient(uuid, text, text, text, text, text, uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_import_patient(uuid, text, text, text, text, text, uuid, text, date) TO authenticated;

COMMENT ON FUNCTION app.legacy_import_patient(uuid, text, text, text, text, text, uuid, text, date) IS
  'Import identité legacy (127) : prénom, nom, naissance (verbatim, NULL si '
  'absente), téléphone NULL accepté, N° carte. Idempotent par ID legacy.';

-- ---------------------------------------------------------------------------
-- 2 · Motif de revue : date invraisemblable (stockée verbatim, à revoir).
-- ---------------------------------------------------------------------------
ALTER TABLE app.legacy_review_queue
  DROP CONSTRAINT IF EXISTS legacy_review_queue_issue_type_check;

ALTER TABLE app.legacy_review_queue
  ADD CONSTRAINT legacy_review_queue_issue_type_check
  CHECK (issue_type IN ('weak_identity','unmatched_medication','orphan',
                        'possible_duplicate','missing_date','implausible_date'));

-- La porte 126 porte sa propre liste : l'aligner (même signature, même droit).
CREATE OR REPLACE FUNCTION app.legacy_open_review(
  p_batch uuid, p_entity text, p_source_ref text, p_issue text,
  p_evidence jsonb, p_action text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.legacy_migration_batches b
                 WHERE b.id = p_batch AND b.cabinet_id = app.current_cabinet()
                   AND b.status = 'running') THEN
    RAISE EXCEPTION 'Lot de migration introuvable ou clôturé.';
  END IF;
  IF NOT (p_entity IN ('patient','ordonnance','ligne','duplicate_group')) THEN
    RAISE EXCEPTION 'Entité de revue inconnue.';
  END IF;
  IF NOT (p_issue IN ('weak_identity','unmatched_medication','orphan',
                      'possible_duplicate','missing_date','implausible_date')) THEN
    RAISE EXCEPTION 'Motif de revue inconnu.';
  END IF;
  INSERT INTO app.legacy_review_queue AS q
    (cabinet_id, batch_id, entity_type, source_ref, issue_type,
     evidence, proposed_action, is_synthetic)
  VALUES (app.current_cabinet(), p_batch, p_entity, p_source_ref, p_issue,
          coalesce(p_evidence, '{}'::jsonb), p_action, app.is_cloud_dev())
  ON CONFLICT (batch_id, entity_type, source_ref, issue_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM app.legacy_review_queue
    WHERE batch_id = p_batch AND entity_type = p_entity
      AND source_ref = p_source_ref AND issue_type = p_issue;
  END IF;
  RETURN v_id;
END;
$$;

ALTER FUNCTION app.legacy_open_review(uuid, text, text, text, jsonb, text)
  OWNER TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 3 · Purge du clinique d'un lot — owner uniquement, bornée, comptée.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.legacy_purge_batch_clinical(p_batch uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_cab      uuid;
  v_n_lines  int;
  v_n_rx     int;
  v_n_hist   int;
  v_n_olines int;
  v_n_orph   int;
  v_n_map    int;
  v_n_rev    int;
BEGIN
  SELECT cabinet_id INTO v_cab FROM app.legacy_migration_batches
  WHERE id = p_batch;
  IF v_cab IS NULL OR v_cab <> app.current_cabinet() THEN
    RAISE EXCEPTION 'Lot de migration introuvable.';
  END IF;
  IF app.current_role() <> 'owner' THEN
    RAISE EXCEPTION 'Purge réservée au responsable du cabinet.';
  END IF;

  -- Lignes puis ordonnances du lot (hors orphelines : table dédiée).
  DELETE FROM app.prescription_lines pl
  USING app.prescriptions pr
  JOIN app.legacy_id_map m ON m.mindcare_id = pr.id
  WHERE pl.prescription_id = pr.id
    AND m.batch_id = p_batch AND m.source_kind = 'ordonnance'
    AND m.source_id NOT LIKE 'orphan:%'
    AND pr.cabinet_id = v_cab;
  GET DIAGNOSTICS v_n_lines = ROW_COUNT;

  DELETE FROM app.prescriptions pr
  USING app.legacy_id_map m
  WHERE pr.id = m.mindcare_id
    AND m.batch_id = p_batch AND m.source_kind = 'ordonnance'
    AND m.source_id NOT LIKE 'orphan:%'
    AND pr.cabinet_id = v_cab;
  GET DIAGNOSTICS v_n_rx = ROW_COUNT;

  -- Historiques du lot.
  DELETE FROM app.legacy_clinical_history
  WHERE batch_id = p_batch AND cabinet_id = v_cab;
  GET DIAGNOSTICS v_n_hist = ROW_COUNT;

  -- Quarantaine du lot (lignes puis orphelines).
  DELETE FROM app.legacy_orphan_prescription_lines l
  USING app.legacy_orphan_prescriptions o
  WHERE l.orphan_prescription_id = o.id
    AND o.batch_id = p_batch AND o.cabinet_id = v_cab;
  GET DIAGNOSTICS v_n_olines = ROW_COUNT;

  DELETE FROM app.legacy_orphan_prescriptions
  WHERE batch_id = p_batch AND cabinet_id = v_cab;
  GET DIAGNOSTICS v_n_orph = ROW_COUNT;

  -- Correspondances non-patient du lot (les patients restent mappés).
  DELETE FROM app.legacy_id_map
  WHERE batch_id = p_batch AND cabinet_id = v_cab
    AND source_kind IN ('note','ordonnance','ligne');
  GET DIAGNOSTICS v_n_map = ROW_COUNT;

  -- Les revues liées au contenu purgé sont closes, signées, motivées.
  -- Restent ouvertes : weak_identity, possible_duplicate (patients conservés).
  UPDATE app.legacy_review_queue q
  SET status = 'resolved', reviewer = auth.uid(), reviewed_at = now(),
      resolution = 'Contenu purgé : périmètre identité décidé le 2026-10-06.'
  WHERE q.batch_id = p_batch AND q.cabinet_id = v_cab
    AND q.status IN ('pending','deferred')
    AND q.issue_type IN ('unmatched_medication','orphan','missing_date');
  GET DIAGNOSTICS v_n_rev = ROW_COUNT;

  RETURN jsonb_build_object(
    'prescription_lines', v_n_lines,
    'prescriptions', v_n_rx,
    'histories', v_n_hist,
    'orphan_lines', v_n_olines,
    'orphans', v_n_orph,
    'map_rows', v_n_map,
    'reviews_resolved', v_n_rev);
END;
$$;

ALTER FUNCTION app.legacy_purge_batch_clinical(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.legacy_purge_batch_clinical(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_purge_batch_clinical(uuid) TO authenticated;

COMMENT ON FUNCTION app.legacy_purge_batch_clinical(uuid) IS
  'Correction de périmètre (127) : retire le clinique importé d''un lot '
  '(ordonnances, historiques, quarantaine) en conservant patients, '
  'correspondances patient et revues d''identité. DELETE journalisés.';

-- ---------------------------------------------------------------------------
-- 4 · Retrait du privilège de transfert — même motif que 020 §5 / 030 §7.
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('127_legacy_identity_scope')
  ON CONFLICT DO NOTHING;

COMMIT;
