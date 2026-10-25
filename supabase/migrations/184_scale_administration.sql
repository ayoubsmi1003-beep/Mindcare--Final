-- 184_scale_administration — les portes d'écriture et de lecture des échelles.
--
-- Le référentiel `app.scales` et la table `app.scale_administrations` existent
-- depuis 009, mais AUCUNE porte ne permettait de les utiliser : l'écran ne
-- pouvait afficher que les deux derniers résultats lus par le workspace, et
-- aucune administration ne pouvait être enregistrée. Cette migration ajoute
-- les quatre portes, le calcul du score EN BASE et la trace d'audit manquante.
--
-- ⚠️ AUCUNE TABLE, AUCUNE COLONNE, AUCUN TYPE N'EST CRÉÉ. Le contrat de
-- `items` et `scoring` vit dans le JSONB existant ; il est documenté dans
-- `docs/contracts/scales.md` et testé par `scripts/checkpoint-scales.sql`.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · La trace d'audit manquante
-- ---------------------------------------------------------------------------
-- 009 a créé la table et son trigger `assert_synthetic`, mais pas `trg_audit`.
-- Une administration d'échelle est une donnée clinique : elle doit laisser une
-- trace comme les notes, les diagnostics et les prescriptions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'app.scale_administrations'::regclass
       AND tgname = 'trg_audit'
  ) THEN
    CREATE TRIGGER trg_audit
      AFTER INSERT OR UPDATE OR DELETE ON app.scale_administrations
      FOR EACH ROW EXECUTE FUNCTION audit.track();
  END IF;
END $$;

-- Le propriétaire des portes doit pouvoir lire le référentiel et écrire la
-- table ; `authenticated` n'a pas — et ne doit pas avoir — ces droits.
GRANT SELECT ON app.scales TO app_gatekeeper;
GRANT SELECT, INSERT ON app.scale_administrations TO app_gatekeeper;

-- ⚠️ DÉFAUT TROUVÉ PAR `checkpoint-scales.sql` : `authenticated` pouvait lire
-- `scale_administrations` en direct. La RLS filtrait par cabinet, mais la
-- lecture ne passait pas par la porte qui journalise. Une donnée clinique lue
-- sans trace est exactement ce qu'ADR-019 interdit. Les portes DEFINER
-- continuent de lire avec le grant direct d'app_gatekeeper.
REVOKE ALL ON app.scale_administrations FROM PUBLIC;
REVOKE ALL ON app.scale_administrations FROM authenticated;
REVOKE ALL ON app.scale_administrations FROM anon;

-- ---------------------------------------------------------------------------
-- 2 · Le calcul — une fonction pure, sans accès aux tables
-- ---------------------------------------------------------------------------
-- Le score n'est JAMAIS calculé en JavaScript. Cette fonction reçoit le
-- référentiel et les réponses, valide chaque item et chaque option, puis rend
-- un total et une bande d'interprétation. Elle ne pose aucun diagnostic.
CREATE OR REPLACE FUNCTION app.score_scale(
  p_items jsonb,
  p_scoring jsonb,
  p_responses jsonb
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = app, pg_catalog
AS $fn$
DECLARE
  v_item jsonb;
  v_option jsonb;
  v_key text;
  v_num numeric;
  v_total integer := 0;
  v_band jsonb;
  v_interp text;
  v_alertes jsonb := '[]'::jsonb;
  v_ids text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'bareme-invalide' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_scoring) IS DISTINCT FROM 'object'
     OR p_scoring->>'methode' IS DISTINCT FROM 'somme'
     OR jsonb_typeof(p_scoring->'bandes') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'bareme-invalide' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_responses) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'reponses-invalides' USING ERRCODE = '22023';
  END IF;

  -- Aucune clé inconnue : une réponse sur un item qui n'existe pas est refusée.
  FOR v_key IN SELECT jsonb_object_keys(p_responses) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) e WHERE e->>'id' = v_key
    ) THEN
      RAISE EXCEPTION 'reponse-inconnue' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF v_item->>'id' IS NULL
       OR jsonb_typeof(v_item->'options') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'bareme-invalide' USING ERRCODE = '22023';
    END IF;
    IF v_item->>'id' = ANY(v_ids) THEN
      RAISE EXCEPTION 'bareme-invalide' USING ERRCODE = '22023';
    END IF;
    v_ids := array_append(v_ids, v_item->>'id');

    IF NOT (p_responses ? (v_item->>'id')) THEN
      RAISE EXCEPTION 'reponse-manquante' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_responses->(v_item->>'id')) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'reponse-invalide' USING ERRCODE = '22023';
    END IF;
    v_num := (p_responses->>(v_item->>'id'))::numeric;
    IF v_num <> trunc(v_num) THEN
      RAISE EXCEPTION 'reponse-invalide' USING ERRCODE = '22023';
    END IF;

    SELECT e INTO v_option
      FROM jsonb_array_elements(v_item->'options') e
     WHERE (e->>'valeur')::numeric = v_num
     LIMIT 1;
    IF v_option IS NULL THEN
      RAISE EXCEPTION 'reponse-hors-barème' USING ERRCODE = '22023';
    END IF;

    v_total := v_total + v_num::integer;

    IF COALESCE((v_item->'risque')::text, 'false') = 'true' AND v_num > 0 THEN
      v_alertes := v_alertes || jsonb_build_object(
        'itemId', v_item->>'id',
        'valeur', v_num::integer,
        'message', COALESCE(v_item->>'alerte', 'Réponse positive à un item de risque.')
      );
    END IF;
  END LOOP;

  SELECT e INTO v_band
    FROM jsonb_array_elements(p_scoring->'bandes') e
   WHERE v_total BETWEEN (e->>'min')::numeric AND (e->>'max')::numeric
   LIMIT 1;
  IF v_band IS NULL THEN
    RAISE EXCEPTION 'bareme-incomplet' USING ERRCODE = '22023';
  END IF;
  v_interp := v_band->>'interpretation';

  RETURN jsonb_build_object(
    'total', v_total,
    'interpretation', v_interp,
    'alertes', v_alertes,
    'consigne', p_scoring->>'consigne',
    'note', p_scoring->>'note'
  );
END;
$fn$;

ALTER FUNCTION app.score_scale(jsonb, jsonb, jsonb) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.score_scale(jsonb, jsonb, jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3 · Le référentiel actif
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.list_scales()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $fn$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'code', s.code,
        'name_fr', s.name_fr,
        'items', s.items,
        'scoring', s.scoring
      )
      ORDER BY s.name_fr
    ),
    '[]'::jsonb
  )
  FROM app.scales s
  WHERE s.is_active;
$fn$;

ALTER FUNCTION app.list_scales() OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_scales() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_scales() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · L'aperçu — même calcul, aucune écriture
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.preview_scale_score(
  p_code text,
  p_responses jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $fn$
DECLARE
  v_scale app.scales%ROWTYPE;
BEGIN
  SELECT * INTO v_scale
    FROM app.scales
   WHERE code = p_code AND is_active;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN app.score_scale(v_scale.items, v_scale.scoring, p_responses);
END;
$fn$;

ALTER FUNCTION app.preview_scale_score(text, jsonb) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.preview_scale_score(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.preview_scale_score(text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5 · L'enregistrement — une écriture, une porte, une trace
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.record_scale_administration(
  p_patient_id uuid,
  p_consultation_id uuid,
  p_scale_code text,
  p_responses jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $fn$
DECLARE
  v_scale app.scales%ROWTYPE;
  v_score jsonb;
  v_id uuid;
  v_at timestamptz := now();
BEGIN
  -- La lecture du dossier passe par la porte qui journalise. Un dossier hors
  -- périmètre rend NULL, jamais une erreur distincte (ADR-003).
  PERFORM 1 FROM app.get_patient(p_patient_id);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_scale
    FROM app.scales
   WHERE code = p_scale_code AND is_active;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Une administration appartient à une séance OUVERTE de CE patient. Le
  -- verrou sérialise deux enregistrements concurrents sur la même séance.
  PERFORM 1
    FROM app.consultations c
   WHERE c.id = p_consultation_id
     AND c.patient_id = p_patient_id
     AND c.status = 'open'
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_score := app.score_scale(v_scale.items, v_scale.scoring, p_responses);

  INSERT INTO app.scale_administrations (
    cabinet_id, practitioner_id, patient_id, consultation_id, scale_id,
    responses, total_score, interpretation, administered_at, is_synthetic
  ) VALUES (
    app.current_cabinet(), auth.uid(), p_patient_id, p_consultation_id, v_scale.id,
    p_responses, (v_score->>'total')::numeric, v_score->>'interpretation',
    v_at, app.is_cloud_dev()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'scale_code', v_scale.code,
    'scale_name', v_scale.name_fr,
    'consultation_id', p_consultation_id,
    'total', (v_score->>'total')::numeric,
    'interpretation', v_score->>'interpretation',
    'alertes', v_score->'alertes',
    'administered_at', v_at,
    'responses', p_responses
  );
END;
$fn$;

ALTER FUNCTION app.record_scale_administration(uuid, uuid, text, jsonb) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.record_scale_administration(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_scale_administration(uuid, uuid, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6 · L'historique — lecture auditée, jamais un oracle
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.get_scale_history(
  p_patient_id uuid,
  p_scale_code text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $fn$
BEGIN
  PERFORM 1 FROM app.get_patient(p_patient_id);
  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', sa.id,
        'scale_code', s.code,
        'scale_name', s.name_fr,
        'consultation_id', sa.consultation_id,
        'total', sa.total_score,
        'interpretation', sa.interpretation,
        'administered_at', sa.administered_at,
        'responses', sa.responses
      )
      ORDER BY sa.administered_at DESC
    )
    FROM (
      SELECT * FROM app.scale_administrations sa0
       WHERE sa0.patient_id = p_patient_id
         AND (p_scale_code IS NULL OR EXISTS (
           SELECT 1 FROM app.scales s0
            WHERE s0.id = sa0.scale_id AND s0.code = p_scale_code
         ))
       ORDER BY sa0.administered_at DESC
       LIMIT 100
    ) sa
    JOIN app.scales s ON s.id = sa.scale_id
  ), '[]'::jsonb);
END;
$fn$;

ALTER FUNCTION app.get_scale_history(uuid, text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_scale_history(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_scale_history(uuid, text) TO authenticated;

COMMENT ON FUNCTION app.record_scale_administration(uuid, uuid, text, jsonb) IS
  'Enregistre une administration d''échelle dans une séance ouverte, calcule le score en base, trace l''écriture. Rend NULL si le dossier ou la séance est hors périmètre.';

INSERT INTO app.schema_migrations(version)
VALUES ('184_scale_administration')
ON CONFLICT DO NOTHING;

COMMIT;
