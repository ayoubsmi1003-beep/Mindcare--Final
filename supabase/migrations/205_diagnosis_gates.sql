-- 205_diagnosis_gates — consigner et résoudre un diagnostic.
--
-- La table `app.diagnoses` existe depuis 009, mais aucune porte ne permettait
-- de l'écrire : le dossier ne pouvait afficher que les diagnostics venus d'un
-- import ou d'un semis. Cette migration ajoute les deux gestes manquants, sans
-- créer aucune table, colonne ni type.
--
-- Une écriture métier = une porte Postgres : périmètre (RLS + patient lu sous
-- l'appelant), verrou (FOR UPDATE sur la ligne à résoudre), transition
-- (principal unique actif), écriture et trace (trg_audit de 013).

BEGIN;

-- Le propriétaire des portes doit pouvoir écrire ; `authenticated` n'obtient
-- aucun droit direct sur la table.
GRANT SELECT, INSERT, UPDATE ON app.diagnoses TO app_gatekeeper;

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

  -- Le SELECT est filtré par la RLS sous l'appelant : zéro ligne signifie
  -- inexistant OU hors périmètre, indistinctement (ADR-003).
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

  -- Un seul diagnostic principal ACTIF par patient. Le verrou porte sur les
  -- lignes actives ; deux poseurs concurrents ne peuvent pas en laisser deux.
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
    is_primary, onset_date
  ) VALUES (
    v_cabinet, auth.uid(), v_patient, v_system, v_code, v_label,
    coalesce(p_is_primary, false), p_onset_date
  )
  RETURNING *;
END;
$fn$;

ALTER FUNCTION app.record_diagnosis(uuid, text, text, text, boolean, date)
  OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.record_diagnosis(uuid, text, text, text, boolean, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_diagnosis(uuid, text, text, text, boolean, date) TO authenticated;

COMMENT ON FUNCTION app.record_diagnosis(uuid, text, text, text, boolean, date) IS
  'Pose un diagnostic dans le périmètre du patient. Un seul principal actif : '
  'le précédent est déclassé dans la même transaction. Trace par trg_audit.';

CREATE OR REPLACE FUNCTION app.resolve_diagnosis(
  p_id          uuid,
  p_resolved_at date DEFAULT current_date
) RETURNS SETOF app.diagnoses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $fn$
DECLARE
  v_row app.diagnoses;
  v_date date := coalesce(p_resolved_at, current_date);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT d.* INTO v_row
    FROM app.diagnoses d
   WHERE d.id = p_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Résoudre deux fois est idempotent : on rend la ligne déjà résolue.
  IF v_row.resolved_at IS NOT NULL THEN
    RETURN QUERY SELECT * FROM app.diagnoses d WHERE d.id = p_id;
    RETURN;
  END IF;

  IF v_row.onset_date IS NOT NULL AND v_date < v_row.onset_date THEN
    RAISE EXCEPTION 'diagnostic-resolution-avant-debut' USING ERRCODE = '22023';
  END IF;
  IF v_date > current_date THEN
    RAISE EXCEPTION 'diagnostic-date-future' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE app.diagnoses d
     SET resolved_at = v_date
   WHERE d.id = p_id
  RETURNING *;
END;
$fn$;

ALTER FUNCTION app.resolve_diagnosis(uuid, date)
  OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.resolve_diagnosis(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_diagnosis(uuid, date) TO authenticated;

COMMENT ON FUNCTION app.resolve_diagnosis(uuid, date) IS
  'Marque un diagnostic comme résolu. Idempotent, borné au périmètre RLS, '
  'date de résolution jamais antérieure au début ni future. Trace par trg_audit.';

INSERT INTO app.schema_migrations(version)
VALUES ('205_diagnosis_gates')
ON CONFLICT DO NOTHING;

COMMIT;
