-- 126_legacy_syglab_migration — import conservateur des dossiers Syglab.
--
-- Décisions humaines D1–D4 (contexte `migration-legacy-syglab.md`) :
--   D1 : 5 tables legacy_* + portes dédiées, RLS, audit — plutôt que de
--        tordre les tables cliniques (notes SOAP, snapshot documents).
--   D2 : `app.patients.phone` devient NULLABLE (les 204 sans téléphone
--        s'importent SANS téléphone, jamais avec un faux numéro).
--   D3 : cabinet/praticien cibles fournis à l'exécution (données Dr Larbi).
--   D4 : exécution complète jusqu'au rapport, via `scripts/migrate-legacy-syglab.mjs`.
--
-- Règles inviolables : aucune inférence clinique, aucun merge auto, aucun
-- DELETE, idempotence par IDs legacy (jamais par le nom), RTF byte-exact +
-- sha256, provenance sur chaque ligne, audit par trg_audit.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0 · Téléphone nullable (D2) — le CHECK subsiste, NULL le traverse.
-- ---------------------------------------------------------------------------
ALTER TABLE app.patients ALTER COLUMN phone DROP NOT NULL;

COMMENT ON COLUMN app.patients.phone IS
  'Nullable depuis 126 (D2) : les dossiers legacy sans téléphone s''importent '
  'SANS téléphone. create_patient (050) exige toujours un téléphone pour une '
  'création native.';

-- ---------------------------------------------------------------------------
-- 1 · Lots de migration — traçabilité du run, jamais de données patient.
-- ---------------------------------------------------------------------------
CREATE TABLE app.legacy_migration_batches (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id        uuid NOT NULL REFERENCES app.cabinets(id),
    batch_label       text NOT NULL,
    migration_version text NOT NULL DEFAULT '126_legacy_syglab_migration',
    source_system     text NOT NULL DEFAULT 'syglab',
    source_hashes     jsonb NOT NULL DEFAULT '{}'::jsonb,
    status            text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','imported','failed')),
    counts            jsonb NOT NULL DEFAULT '{}'::jsonb,
    started_by        uuid REFERENCES app.profiles(id),
    started_at        timestamptz NOT NULL DEFAULT now(),
    finished_at       timestamptz,
    is_synthetic      boolean NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------
-- 2 · Correspondance legacy ↔ MindCare — la clé de l'idempotence.
-- ---------------------------------------------------------------------------
CREATE TABLE app.legacy_id_map (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id      uuid NOT NULL REFERENCES app.cabinets(id),
    batch_id        uuid NOT NULL REFERENCES app.legacy_migration_batches(id),
    source_system   text NOT NULL DEFAULT 'syglab',
    source_kind     text NOT NULL
                    CHECK (source_kind IN ('patient','ordonnance','ligne','note')),
    source_id       text NOT NULL,
    mindcare_id     uuid NOT NULL,
    content_sha256  text,
    meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    is_synthetic    boolean NOT NULL DEFAULT false,

    CONSTRAINT legacy_id_map_unique
      UNIQUE (source_system, source_kind, source_id)
);

CREATE INDEX ON app.legacy_id_map (batch_id);
CREATE INDEX ON app.legacy_id_map (mindcare_id);

-- ---------------------------------------------------------------------------
-- 3 · Historique clinique legacy — RTF byte-exact, jamais réinterprété.
-- ---------------------------------------------------------------------------
CREATE TABLE app.legacy_clinical_history (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id         uuid NOT NULL REFERENCES app.cabinets(id),
    batch_id           uuid NOT NULL REFERENCES app.legacy_migration_batches(id),
    patient_id         uuid NOT NULL REFERENCES app.patients(id) ON DELETE RESTRICT,
    source_record_ref  text NOT NULL,
    history_kind       text NOT NULL
                       CHECK (history_kind IN ('baseline_note','antecedents')),
    original_text      text NOT NULL,
    is_rtf             boolean NOT NULL DEFAULT false,
    content_sha256     text NOT NULL,
    render_status      text NOT NULL DEFAULT 'pending'
                       CHECK (render_status IN ('pending','ok','failed')),
    rendered_text      text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    is_synthetic       boolean NOT NULL DEFAULT false
);

CREATE INDEX ON app.legacy_clinical_history (patient_id, created_at DESC);
CREATE INDEX ON app.legacy_clinical_history (batch_id);

-- ---------------------------------------------------------------------------
-- 4 · Quarantaine des orphelines — jamais rattachées par devinette.
-- ---------------------------------------------------------------------------
CREATE TABLE app.legacy_orphan_prescriptions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id        uuid NOT NULL REFERENCES app.cabinets(id),
    batch_id          uuid NOT NULL REFERENCES app.legacy_migration_batches(id),
    source_patient_id text NOT NULL,
    source_ord_id     text NOT NULL,
    presc_date        date,
    numero            text,
    observation       text,
    content_sha256    text,
    status            text NOT NULL DEFAULT 'quarantined'
                      CHECK (status IN ('quarantined','resolved')),
    created_at        timestamptz NOT NULL DEFAULT now(),
    is_synthetic      boolean NOT NULL DEFAULT false,

    CONSTRAINT legacy_orphan_unique UNIQUE (batch_id, source_patient_id, source_ord_id)
);

CREATE TABLE app.legacy_orphan_prescription_lines (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id             uuid NOT NULL REFERENCES app.cabinets(id),
    orphan_prescription_id uuid NOT NULL REFERENCES app.legacy_orphan_prescriptions(id)
                           ON DELETE CASCADE,
    legacy_medicament_id   text,
    medication_display     text,
    posologie              text,
    texte_libre            text,
    quantite               text,
    nbr_jour               text,
    nbr_fois               text,
    qsp                    text,
    position               integer NOT NULL DEFAULT 1,
    is_synthetic           boolean NOT NULL DEFAULT false
);

CREATE INDEX ON app.legacy_orphan_prescription_lines (orphan_prescription_id);

-- ---------------------------------------------------------------------------
-- 5 · File de revue — PENDING tant qu'un humain n'a pas tranché.
-- ---------------------------------------------------------------------------
CREATE TABLE app.legacy_review_queue (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id   uuid NOT NULL REFERENCES app.cabinets(id),
    batch_id     uuid NOT NULL REFERENCES app.legacy_migration_batches(id),
    entity_type  text NOT NULL
                 CHECK (entity_type IN ('patient','ordonnance','ligne','duplicate_group')),
    source_ref   text NOT NULL,
    issue_type   text NOT NULL
                 CHECK (issue_type IN ('weak_identity','unmatched_medication',
                                       'orphan','possible_duplicate','missing_date')),
    status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','confirmed','rejected','resolved','deferred')),
    evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
    proposed_action text,
    reviewer     uuid REFERENCES app.profiles(id),
    reviewed_at  timestamptz,
    resolution   text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    is_synthetic boolean NOT NULL DEFAULT false,

    CONSTRAINT legacy_review_unique UNIQUE (batch_id, entity_type, source_ref, issue_type)
);

CREATE INDEX ON app.legacy_review_queue (batch_id, status);

-- ---------------------------------------------------------------------------
-- 6 · RLS — clinique stricte : owner/praticien du cabinet, jamais l'assistante.
-- ---------------------------------------------------------------------------
ALTER TABLE app.legacy_migration_batches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.legacy_migration_batches   FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.legacy_id_map               ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.legacy_id_map               FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.legacy_clinical_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.legacy_clinical_history     FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.legacy_orphan_prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.legacy_orphan_prescriptions FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.legacy_orphan_prescription_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.legacy_orphan_prescription_lines FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.legacy_review_queue         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.legacy_review_queue         FORCE  ROW LEVEL SECURITY;

-- Une seule policy par table (FOR ALL) : les portes DEFINER écrivent sous
-- cette policy, les lectures directes restent bornées au cabinet et au rôle.
CREATE POLICY legacy_batches_clinical ON app.legacy_migration_batches
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet()
                AND app.current_role() IN ('owner','practitioner'))
    WITH CHECK (cabinet_id = app.current_cabinet()
                AND app.current_role() IN ('owner','practitioner'));

CREATE POLICY legacy_id_map_clinical ON app.legacy_id_map
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet()
                AND app.current_role() IN ('owner','practitioner'))
    WITH CHECK (cabinet_id = app.current_cabinet()
                AND app.current_role() IN ('owner','practitioner'));

CREATE POLICY legacy_history_clinical ON app.legacy_clinical_history
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet()
                AND app.current_role() IN ('owner','practitioner'))
    WITH CHECK (cabinet_id = app.current_cabinet()
                AND app.current_role() IN ('owner','practitioner'));

CREATE POLICY legacy_orphans_clinical ON app.legacy_orphan_prescriptions
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet()
                AND app.current_role() IN ('owner','practitioner'))
    WITH CHECK (cabinet_id = app.current_cabinet()
                AND app.current_role() IN ('owner','practitioner'));

CREATE POLICY legacy_orphan_lines_clinical ON app.legacy_orphan_prescription_lines
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet()
                AND app.current_role() IN ('owner','practitioner'))
    WITH CHECK (cabinet_id = app.current_cabinet()
                AND app.current_role() IN ('owner','practitioner'));

CREATE POLICY legacy_review_clinical ON app.legacy_review_queue
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet()
                AND app.current_role() IN ('owner','practitioner'))
    WITH CHECK (cabinet_id = app.current_cabinet()
                AND app.current_role() IN ('owner','practitioner'));

-- ---------------------------------------------------------------------------
-- 7 · Garde-fou synthétique (016 §4 : la découverte ne couvre pas les tables
--     créées après elle — attachement explicite ici, même motif, même trigger).
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'legacy_migration_batches','legacy_id_map','legacy_clinical_history',
    'legacy_orphan_prescriptions','legacy_orphan_prescription_lines',
    'legacy_review_queue'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS assert_synthetic ON app.%I', t);
    EXECUTE format(
      'CREATE TRIGGER assert_synthetic BEFORE INSERT OR UPDATE ON app.%I '
      'FOR EACH ROW EXECUTE FUNCTION app.assert_synthetic_when_cloud()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8 · Audit — rattachement explicite (013 §12 : l'oubli est testé par T9).
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'legacy_migration_batches','legacy_id_map','legacy_clinical_history',
    'legacy_orphan_prescriptions','legacy_orphan_prescription_lines',
    'legacy_review_queue'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.%I '
      'FOR EACH ROW EXECUTE FUNCTION audit.track()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 9 · Portes — une écriture métier = une porte, idempotente par IDs legacy.
-- ---------------------------------------------------------------------------

-- 9.1 Ouverture d'un lot (owner/praticien uniquement).
CREATE OR REPLACE FUNCTION app.legacy_start_batch(p_label text, p_hashes jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (app.current_role() IN ('owner','practitioner')) THEN
    RAISE EXCEPTION 'Ouverture de lot réservée au cabinet.';
  END IF;
  IF p_label IS NULL OR btrim(p_label) = '' THEN
    RAISE EXCEPTION 'Libellé de lot manquant.';
  END IF;
  INSERT INTO app.legacy_migration_batches
    (cabinet_id, batch_label, source_hashes, started_by, is_synthetic)
  VALUES (app.current_cabinet(), btrim(p_label),
          COALESCE(p_hashes, '{}'::jsonb), auth.uid(), app.is_cloud_dev())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

ALTER FUNCTION app.legacy_start_batch(text, jsonb) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.legacy_start_batch(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_start_batch(text, jsonb) TO authenticated;

-- 9.2 Import d'un patient — téléphone NULL accepté (D2), jamais inventé.
CREATE OR REPLACE FUNCTION app.legacy_import_patient(
  p_batch uuid, p_source_id text, p_first text, p_last text,
  p_phone text, p_cdi text, p_practitioner uuid, p_sha text)
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
    first_name, last_name, phone, id_document_number,
    is_synthetic, created_by
  ) VALUES (
    app.current_cabinet(), p_practitioner,
    'P-' || lpad(v_numero::text, 4, '0'),
    v_first, v_last, v_phone, v_cdi,
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

ALTER FUNCTION app.legacy_import_patient(uuid, text, text, text, text, text, uuid, text)
  OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.legacy_import_patient(uuid, text, text, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_import_patient(uuid, text, text, text, text, text, uuid, text) TO authenticated;

-- 9.3 Import d'un historique — texte verbatim, hash vérifié à la lecture.
CREATE OR REPLACE FUNCTION app.legacy_import_history(
  p_batch uuid, p_patient uuid, p_source_ref text, p_kind text,
  p_text text, p_is_rtf boolean, p_sha text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE v_found uuid;
DECLARE v_hist  uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.legacy_migration_batches b
                 WHERE b.id = p_batch AND b.cabinet_id = app.current_cabinet()
                   AND b.status = 'running') THEN
    RAISE EXCEPTION 'Lot de migration introuvable ou clôturé.';
  END IF;
  IF NOT (p_kind IN ('baseline_note','antecedents')) THEN
    RAISE EXCEPTION 'Nature d''historique inconnue.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.patients p
                 WHERE p.id = p_patient
                   AND p.cabinet_id = app.current_cabinet()) THEN
    RAISE EXCEPTION 'Dossier patient introuvable.';
  END IF;
  IF p_text IS NULL OR p_text = '' THEN
    RAISE EXCEPTION 'Contenu historique vide : rien à préserver.';
  END IF;

  SELECT mindcare_id INTO v_found FROM app.legacy_id_map
  WHERE source_system = 'syglab' AND source_kind = 'note'
    AND source_id = p_source_ref;
  IF FOUND THEN RETURN v_found; END IF;

  INSERT INTO app.legacy_clinical_history (
    cabinet_id, batch_id, patient_id, source_record_ref, history_kind,
    original_text, is_rtf, content_sha256, is_synthetic
  ) VALUES (
    app.current_cabinet(), p_batch, p_patient, p_source_ref, p_kind,
    p_text, coalesce(p_is_rtf, false), p_sha, app.is_cloud_dev()
  ) RETURNING id INTO v_hist;

  INSERT INTO app.legacy_id_map
    (cabinet_id, batch_id, source_kind, source_id, mindcare_id,
     content_sha256, is_synthetic)
  VALUES (app.current_cabinet(), p_batch, 'note', p_source_ref,
          v_hist, p_sha, app.is_cloud_dev());

  RETURN v_hist;
END;
$$;

ALTER FUNCTION app.legacy_import_history(uuid, uuid, text, text, text, boolean, text)
  OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.legacy_import_history(uuid, uuid, text, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_import_history(uuid, uuid, text, text, text, boolean, text) TO authenticated;

-- 9.4 Import d'une ordonnance historique — jamais un nouveau numéro d'émission.
-- `p_lines` : [{legacy_line_id, medication_id|null, display, posologie,
--               texte_libre, quantite, nbr_jour, nbr_fois, qsp, unresolved}].
-- Le texte legacy reste dans `free_text` même si `medication_id` est renseigné
-- (référence exacte uniquement) : la reconstructibilité prime sur l'élégance.
CREATE OR REPLACE FUNCTION app.legacy_import_prescription(
  p_batch uuid, p_patient uuid, p_source_ord_id text, p_date date,
  p_numero text, p_observation text, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_found uuid;
  v_presc uuid;
  v_line  jsonb;
  v_pos   int := 0;
  v_mid   uuid;
  v_notes text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.legacy_migration_batches b
                 WHERE b.id = p_batch AND b.cabinet_id = app.current_cabinet()
                   AND b.status = 'running') THEN
    RAISE EXCEPTION 'Lot de migration introuvable ou clôturé.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.patients p
                 WHERE p.id = p_patient
                   AND p.cabinet_id = app.current_cabinet()) THEN
    RAISE EXCEPTION 'Dossier patient introuvable.';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Date clinique inconnue : cette ordonnance relève de la revue.';
  END IF;
  IF jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Lignes d''ordonnance invalides : un tableau JSON est attendu.';
  END IF;

  SELECT mindcare_id INTO v_found FROM app.legacy_id_map
  WHERE source_system = 'syglab' AND source_kind = 'ordonnance'
    AND source_id = p_source_ord_id;
  IF FOUND THEN RETURN v_found; END IF;

  v_notes := 'Syglab N°' || coalesce(nullif(btrim(coalesce(p_numero,'')),''), '?');
  IF p_observation IS NOT NULL AND btrim(p_observation) <> '' THEN
    v_notes := v_notes || ' — ' || p_observation;
  END IF;

  INSERT INTO app.prescriptions (
    cabinet_id, practitioner_id, patient_id, consultation_id,
    prescribed_at, is_handwritten, notes, is_synthetic
  )
  SELECT app.current_cabinet(), p.practitioner_id, p.id, NULL,
         (p_date::timestamp AT TIME ZONE 'Africa/Algiers'),
         true, v_notes, app.is_cloud_dev()
  FROM app.patients p WHERE p.id = p_patient
  RETURNING id INTO v_presc;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_pos := v_pos + 1;
    IF jsonb_typeof(v_line) <> 'object' THEN
      RAISE EXCEPTION 'Ligne d''ordonnance invalide à la position %.', v_pos;
    END IF;
    v_mid := NULL;
    IF v_line ? 'medication_id'
       AND v_line->>'medication_id' IS NOT NULL
       AND btrim(v_line->>'medication_id') <> '' THEN
      SELECT m.id INTO v_mid FROM app.medications m
      WHERE m.id = (v_line->>'medication_id')::uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Médicament référencé introuvable : résolution exacte exigée.';
      END IF;
    END IF;
    INSERT INTO app.prescription_lines (
      prescription_id, medication_id,
      free_text, dose, frequency_per_day, timing, duration_days,
      instructions, position
    ) VALUES (
      v_presc, v_mid,
      nullif(btrim(coalesce(v_line->>'display','')), ''),
      nullif(btrim(coalesce(v_line->>'posologie','')), ''),
      CASE WHEN v_line->>'nbr_fois' ~ '^[0-9]{1,3}$'
           THEN (v_line->>'nbr_fois')::int END,
      NULL,
      CASE WHEN v_line->>'nbr_jour' ~ '^[0-9]{1,4}$'
           THEN (v_line->>'nbr_jour')::int END,
      nullif(btrim(
        coalesce(v_line->>'texte_libre','')
        || CASE WHEN btrim(coalesce(v_line->>'qsp','')) <> ''
                THEN ' [qsp: ' || btrim(v_line->>'qsp') || ']' ELSE '' END
      ), ''),
      v_pos
    );
    INSERT INTO app.legacy_id_map
      (cabinet_id, batch_id, source_kind, source_id, mindcare_id, meta,
       is_synthetic)
    VALUES (app.current_cabinet(), p_batch, 'ligne',
            p_source_ord_id || ':' || coalesce(v_line->>'legacy_line_id', v_pos::text),
            (SELECT id FROM app.prescription_lines
             WHERE prescription_id = v_presc AND position = v_pos),
            jsonb_build_object(
              'legacy_med_id', v_line->>'legacy_med_id',
              'unresolved', coalesce((v_line->>'unresolved')::boolean, false),
              'quantite', v_line->>'quantite'),
            app.is_cloud_dev());
  END LOOP;

  INSERT INTO app.legacy_id_map
    (cabinet_id, batch_id, source_kind, source_id, mindcare_id, is_synthetic)
  VALUES (app.current_cabinet(), p_batch, 'ordonnance', p_source_ord_id,
          v_presc, app.is_cloud_dev());

  RETURN v_presc;
END;
$$;

ALTER FUNCTION app.legacy_import_prescription(uuid, uuid, text, date, text, text, jsonb)
  OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.legacy_import_prescription(uuid, uuid, text, date, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_import_prescription(uuid, uuid, text, date, text, text, jsonb) TO authenticated;

-- 9.5 Quarantaine d'une orpheline — aucune devinette d'appariement.
CREATE OR REPLACE FUNCTION app.legacy_quarantine_orphan(
  p_batch uuid, p_source_patient_id text, p_source_ord_id text,
  p_date date, p_numero text, p_observation text, p_lines jsonb, p_sha text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_found uuid;
  v_orph  uuid;
  v_line  jsonb;
  v_pos   int := 0;
  v_sid   text := 'orphan:' || p_source_patient_id || ':' || p_source_ord_id;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.legacy_migration_batches b
                 WHERE b.id = p_batch AND b.cabinet_id = app.current_cabinet()
                   AND b.status = 'running') THEN
    RAISE EXCEPTION 'Lot de migration introuvable ou clôturé.';
  END IF;
  IF jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Lignes d''ordonnance invalides : un tableau JSON est attendu.';
  END IF;

  SELECT mindcare_id INTO v_found FROM app.legacy_id_map
  WHERE source_system = 'syglab' AND source_kind = 'ordonnance'
    AND source_id = v_sid;
  IF FOUND THEN RETURN v_found; END IF;

  INSERT INTO app.legacy_orphan_prescriptions (
    cabinet_id, batch_id, source_patient_id, source_ord_id,
    presc_date, numero, observation, content_sha256, is_synthetic
  ) VALUES (
    app.current_cabinet(), p_batch, p_source_patient_id, p_source_ord_id,
    p_date, nullif(btrim(coalesce(p_numero,'')), ''),
    nullif(btrim(coalesce(p_observation,'')), ''), p_sha, app.is_cloud_dev()
  ) RETURNING id INTO v_orph;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_pos := v_pos + 1;
    INSERT INTO app.legacy_orphan_prescription_lines (
      cabinet_id, orphan_prescription_id, legacy_medicament_id,
      medication_display, posologie, texte_libre,
      quantite, nbr_jour, nbr_fois, qsp, position, is_synthetic
    ) VALUES (
      app.current_cabinet(), v_orph, v_line->>'legacy_med_id',
      nullif(btrim(coalesce(v_line->>'display','')), ''),
      nullif(btrim(coalesce(v_line->>'posologie','')), ''),
      nullif(btrim(coalesce(v_line->>'texte_libre','')), ''),
      nullif(btrim(coalesce(v_line->>'quantite','')), ''),
      nullif(btrim(coalesce(v_line->>'nbr_jour','')), ''),
      nullif(btrim(coalesce(v_line->>'nbr_fois','')), ''),
      nullif(btrim(coalesce(v_line->>'qsp','')), ''),
      v_pos, app.is_cloud_dev()
    );
  END LOOP;

  INSERT INTO app.legacy_id_map
    (cabinet_id, batch_id, source_kind, source_id, mindcare_id,
     content_sha256, is_synthetic)
  VALUES (app.current_cabinet(), p_batch, 'ordonnance', v_sid, v_orph, p_sha,
          app.is_cloud_dev());

  RETURN v_orph;
END;
$$;

ALTER FUNCTION app.legacy_quarantine_orphan(uuid, text, text, date, text, text, jsonb, text)
  OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.legacy_quarantine_orphan(uuid, text, text, date, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_quarantine_orphan(uuid, text, text, date, text, text, jsonb, text) TO authenticated;

-- 9.6 Ouverture d'un cas de revue — idempotent, PENDING jusqu'à décision humaine.
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
                      'possible_duplicate','missing_date')) THEN
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
REVOKE ALL ON FUNCTION app.legacy_open_review(uuid, text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_open_review(uuid, text, text, text, jsonb, text) TO authenticated;

-- 9.7 Résolution d'un cas — seul un humain tranche, et il signe.
CREATE OR REPLACE FUNCTION app.legacy_resolve_review(
  p_review uuid, p_status text, p_resolution text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
BEGIN
  IF NOT (p_status IN ('confirmed','rejected','resolved','deferred')) THEN
    RAISE EXCEPTION 'Statut de résolution inconnu.';
  END IF;
  UPDATE app.legacy_review_queue q
  SET status = p_status, reviewer = auth.uid(),
      reviewed_at = now(), resolution = p_resolution
  WHERE q.id = p_review
    AND q.cabinet_id = app.current_cabinet()
    AND q.status IN ('pending','deferred');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cas de revue introuvable ou déjà tranché.';
  END IF;
END;
$$;

ALTER FUNCTION app.legacy_resolve_review(uuid, text, text)
  OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.legacy_resolve_review(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_resolve_review(uuid, text, text) TO authenticated;

-- 9.8 Clôture d'un lot — fige les comptes, jamais de réécriture ensuite.
CREATE OR REPLACE FUNCTION app.legacy_finalize_batch(p_batch uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
BEGIN
  IF NOT (p_status IN ('imported','failed')) THEN
    RAISE EXCEPTION 'Statut de clôture inconnu.';
  END IF;
  UPDATE app.legacy_migration_batches b
  SET status = p_status, finished_at = now(),
      counts = (SELECT jsonb_build_object(
        'patients_mapped', (SELECT count(*) FROM app.legacy_id_map m
                            WHERE m.batch_id = b.id AND m.source_kind = 'patient'),
        'histories',       (SELECT count(*) FROM app.legacy_clinical_history h
                            WHERE h.batch_id = b.id),
        'prescriptions',   (SELECT count(*) FROM app.legacy_id_map m
                            WHERE m.batch_id = b.id AND m.source_kind = 'ordonnance'
                              AND m.source_id NOT LIKE 'orphan:%'),
        'orphans',         (SELECT count(*) FROM app.legacy_orphan_prescriptions o
                            WHERE o.batch_id = b.id),
        'reviews_open',    (SELECT count(*) FROM app.legacy_review_queue q
                            WHERE q.batch_id = b.id AND q.status = 'pending')))
  WHERE b.id = p_batch
    AND b.cabinet_id = app.current_cabinet()
    AND b.status = 'running';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lot introuvable ou déjà clôturé.';
  END IF;
END;
$$;

ALTER FUNCTION app.legacy_finalize_batch(uuid, text)
  OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.legacy_finalize_batch(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_finalize_batch(uuid, text) TO authenticated;

-- 9.9 Historique d'un patient — provenance incluse, lecture tracée.
CREATE OR REPLACE FUNCTION app.legacy_patient_history(p_patient uuid)
RETURNS TABLE (
  history_id uuid, history_kind text, history_date timestamptz,
  is_rtf boolean, content_sha256 text, source_record_ref text,
  original_text text, rendered_text text, render_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
BEGIN
  PERFORM audit.log_read(p_patient, 'fiche');
  RETURN QUERY
  SELECT h.id, h.history_kind, h.created_at, h.is_rtf, h.content_sha256,
         h.source_record_ref, h.original_text, h.rendered_text, h.render_status
  FROM app.legacy_clinical_history h
  JOIN app.patients p ON p.id = h.patient_id
  WHERE h.patient_id = p_patient
    AND h.cabinet_id = app.current_cabinet()
  ORDER BY h.created_at ASC;
END;
$$;

ALTER FUNCTION app.legacy_patient_history(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.legacy_patient_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_patient_history(uuid) TO authenticated;

-- 9.10 File de revue — lecture paginée, jamais de texte clinique libre inutile.
CREATE OR REPLACE FUNCTION app.legacy_list_reviews(
  p_batch uuid, p_status text, p_limit int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS TABLE (
  review_id uuid, entity_type text, source_ref text, issue_type text,
  status text, proposed_action text, reviewer uuid, reviewed_at timestamptz,
  resolution text, created_at timestamptz, total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
BEGIN
  PERFORM audit.log_read(NULL, 'liste');
  RETURN QUERY
  SELECT q.id, q.entity_type, q.source_ref, q.issue_type, q.status,
         q.proposed_action, q.reviewer, q.reviewed_at, q.resolution,
         q.created_at, count(*) OVER () AS total_count
  FROM app.legacy_review_queue q
  WHERE q.batch_id = p_batch
    AND q.cabinet_id = app.current_cabinet()
    AND (p_status IS NULL OR q.status = p_status)
  ORDER BY q.created_at ASC
  LIMIT least(greatest(coalesce(p_limit, 25), 1), 100)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;

ALTER FUNCTION app.legacy_list_reviews(uuid, text, int, int) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.legacy_list_reviews(uuid, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_list_reviews(uuid, text, int, int) TO authenticated;

-- 9.11 Rapport — comptes calculés à l'exécution, intégrité RTF revérifiée.
-- Le statut dérive des faits constatés ici (aucun total source codé en dur :
-- la réconciliation source ↔ importé vit dans le script d'exécution).
CREATE OR REPLACE FUNCTION app.legacy_get_report(p_batch uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_rtf_ok      boolean;
  v_open        int;
  v_bstatus     text;
  v_status      text;
  v             jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.legacy_migration_batches b
                 WHERE b.id = p_batch
                   AND b.cabinet_id = app.current_cabinet()) THEN
    RAISE EXCEPTION 'Lot de migration introuvable.';
  END IF;
  PERFORM audit.log_read(NULL, 'liste');
  SELECT bool_and(encode(extensions.digest(h.original_text, 'sha256'), 'hex')
                  = h.content_sha256)
  INTO v_rtf_ok
  FROM app.legacy_clinical_history h
  WHERE h.batch_id = p_batch;
  SELECT count(*) INTO v_open FROM app.legacy_review_queue q
  WHERE q.batch_id = p_batch AND q.status = 'pending';
  SELECT status INTO v_bstatus FROM app.legacy_migration_batches
  WHERE id = p_batch;
  v_status := CASE
    WHEN coalesce(v_rtf_ok, true) = false OR v_bstatus = 'failed' THEN 'BLOCKED'
    WHEN v_open > 0 THEN 'PASS_WITH_REVIEW'
    ELSE 'PASS'
  END;
  SELECT jsonb_build_object(
    'batch_id', p_batch,
    'batch_status', v_bstatus,
    'patients_imported', (SELECT count(*) FROM app.legacy_id_map m
                          WHERE m.batch_id = p_batch AND m.source_kind = 'patient'),
    'histories_imported', (SELECT count(*) FROM app.legacy_clinical_history h
                           WHERE h.batch_id = p_batch),
    'prescriptions_imported', (SELECT count(*) FROM app.legacy_id_map m
                               WHERE m.batch_id = p_batch
                                 AND m.source_kind = 'ordonnance'
                                 AND m.source_id NOT LIKE 'orphan:%'),
    'orphans_quarantined', (SELECT count(*) FROM app.legacy_orphan_prescriptions o
                            WHERE o.batch_id = p_batch),
    'reviews_open', v_open,
    'reviews_total', (SELECT count(*) FROM app.legacy_review_queue q
                      WHERE q.batch_id = p_batch),
    'duplicates_pending', (SELECT count(*) FROM app.legacy_review_queue q
                           WHERE q.batch_id = p_batch
                             AND q.issue_type = 'possible_duplicate'
                             AND q.status = 'pending'),
    'rtf_integrity_ok', coalesce(v_rtf_ok, true),
    'status', v_status
  ) INTO v;
  RETURN v;
END;
$$;

ALTER FUNCTION app.legacy_get_report(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.legacy_get_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_get_report(uuid) TO authenticated;

-- 9.12 Correspondance existante — reprise et audit « d'où vient cette valeur ? ».
CREATE OR REPLACE FUNCTION app.legacy_map_lookup(p_kind text, p_source_id text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE v uuid;
BEGIN
  PERFORM audit.log_read(NULL, 'liste');
  SELECT mindcare_id INTO v FROM app.legacy_id_map
  WHERE source_system = 'syglab' AND source_kind = p_kind
    AND source_id = p_source_id AND cabinet_id = app.current_cabinet();
  RETURN v;
END;
$$;

ALTER FUNCTION app.legacy_map_lookup(text, text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.legacy_map_lookup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.legacy_map_lookup(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10 · Retrait du privilège de transfert — même motif que 020 §5 / 030 §7.
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('126_legacy_syglab_migration')
  ON CONFLICT DO NOTHING;

COMMIT;
