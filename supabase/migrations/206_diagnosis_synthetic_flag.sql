-- 206_diagnosis_synthetic_flag — le drapeau ADR-016 de la porte diagnostic.
--
-- 205 a créé `app.record_diagnosis` sans renseigner `is_synthetic`. Le garde de
-- 016 refuse alors toute écriture en `cloud-dev` : « seules les données
-- synthétiques sont acceptées ». C'est le garde qui a raison, la porte qui
-- manquait un champ DÉRIVÉ.
--
-- Cette migration ne crée aucune table, colonne ni type. Elle remplace
-- uniquement le corps de la fonction pour écrire `app.is_cloud_dev()` comme
-- les portes 023/026 le font déjà : l'appelant ne choisit jamais ce drapeau.

BEGIN;

CREATE OR REPLACE FUNCTION app.record_diagnosis(
  p_patient_id  uuid,
  p_label       text,
  p_code_system text DEFAULT 'ICD-10',
  p_code        text DEFAULT NULL,
  p_is_primary  boolean DEFAULT false,
  p_onset_date  date DEFAULT NULL
) RETURNS SETOF app.diagnoses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $fn$
DECLARE
  v_cabinet  uuid;
  v_patient  uuid;
  v_label    text;
  v_system   text;
  v_code     text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT p.cabinet_id, p.id
    INTO v_cabinet, v_patient
    FROM app.patients p
   WHERE p.id = p_patient_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_label := btrim(coalesce(p_label, ''));
  IF v_label = '' OR length(v_label) > 500 THEN
    RAISE EXCEPTION 'diagnostic-libelle-invalide' USING ERRCODE = '22023';
  END IF;

  v_system := btrim(coalesce(nullif(p_code_system, ''), 'ICD-10'));
  IF length(v_system) > 64 THEN
    RAISE EXCEPTION 'diagnostic-systeme-invalide' USING ERRCODE = '22023';
  END IF;

  v_code := nullif(btrim(coalesce(p_code, '')), '');
  IF v_code IS NOT NULL AND length(v_code) > 32 THEN
    RAISE EXCEPTION 'diagnostic-code-invalide' USING ERRCODE = '22023';
  END IF;

  IF p_onset_date IS NOT NULL AND p_onset_date > current_date THEN
    RAISE EXCEPTION 'diagnostic-date-future' USING ERRCODE = '22023';
  END IF;

  IF p_is_primary THEN
    PERFORM 1
      FROM app.diagnoses d
     WHERE d.patient_id = v_patient
       AND d.resolved_at IS NULL
       AND d.is_primary
       FOR UPDATE;
    UPDATE app.diagnoses d
       SET is_primary = false
     WHERE d.patient_id = v_patient
       AND d.resolved_at IS NULL
       AND d.is_primary;
  END IF;

  RETURN QUERY
  INSERT INTO app.diagnoses (
    cabinet_id, practitioner_id, patient_id, code_system, code, label,
    is_primary, onset_date, is_synthetic
  ) VALUES (
    v_cabinet, auth.uid(), v_patient, v_system, v_code, v_label,
    coalesce(p_is_primary, false), p_onset_date, app.is_cloud_dev()
  )
  RETURNING *;
END;
$fn$;

ALTER FUNCTION app.record_diagnosis(uuid, text, text, text, boolean, date)
  OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.record_diagnosis(uuid, text, text, text, boolean, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_diagnosis(uuid, text, text, text, boolean, date) TO authenticated;

COMMENT ON FUNCTION app.record_diagnosis(uuid, text, text, text, boolean, date) IS
  'Pose un diagnostic dans le périmètre du patient. is_synthetic est DÉRIVÉ '
  'de l''environnement (ADR-016), jamais choisi par l''appelant. Un seul '
  'principal actif : le précédent est déclassé dans la même transaction.';

INSERT INTO app.schema_migrations(version)
VALUES ('206_diagnosis_synthetic_flag')
ON CONFLICT DO NOTHING;

COMMIT;
