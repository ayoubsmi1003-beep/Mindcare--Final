-- 211_medication_workspace_reads — lectures de l'espace traitements (Phase 1).
--
-- ⚠️ AUCUNE TABLE, COLONNE, TYPE NI VALEUR D'ENUM.
-- Cette migration ne fait qu'étendre une lecture existante et ouvrir trois
-- lectures ciblées, toutes adossées aux données déjà présentes :
--   · get_patient_treatments : ajoute le prescripteur, la classe ATC et le lien
--     de séance aux lignes déjà rendues ;
--   · list_patient_medication_timeline : historique de traitement + prescriptions
--     legacy + ordonnances émises, en une seule lecture keyset ;
--   · get_patient_session_measures : les trois mesures 1–10 saisies en séance,
--     sans jamais rendre le texte de la note ;
--   · list_medication_workload : file clinique agrégée, cloisonnée par rôle.
--
-- Les trois lectures ciblées sont des questions différentes, pas des copies
-- d'écran : aucune ne duplique get_patient_workspace ni list_patient_timeline.

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 1 · get_patient_treatments — enrichissement additif de la lecture existante
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.get_patient_treatments(p_patient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_pat app.patients%ROWTYPE;
  v_clinique boolean;
  v_result jsonb;
BEGIN
  IF p_patient_id IS NULL THEN RETURN NULL; END IF;
  PERFORM audit.log_read(p_patient_id, 'fiche');
  SELECT * INTO v_pat FROM app.patients WHERE id = p_patient_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_clinique := app.can_see_clinical(v_pat.practitioner_id);
  IF NOT v_clinique THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'actifs', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.start_date DESC, t.created_at DESC)
      FROM (
        SELECT pt.id, pt.status, pt.dose, pt.dose_unit, pt.frequency, pt.timing, pt.instructions,
               pt.start_date, pt.end_date, pt.stopped_at, pt.stopped_reason, pt.current_version,
               pt.created_at, pt.updated_at, pt.medication_id, pt.consultation_id,
               pt.previous_treatment_id,
               m.source_raw_value AS medication_raw, m.brand_name, m.form, m.strength, m.inn,
               m.atc_class, pr.full_name AS practitioner_name
        FROM app.patient_treatments pt
        JOIN app.medications m ON m.id = pt.medication_id
        LEFT JOIN app.profiles pr ON pr.id = pt.practitioner_id
        WHERE pt.patient_id = p_patient_id AND pt.status = 'active'
        ORDER BY pt.start_date DESC, pt.created_at DESC
      ) t
    ), '[]'::jsonb),
    'en_pause', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.start_date DESC)
      FROM (
        SELECT pt.id, pt.status, pt.dose, pt.dose_unit, pt.frequency, pt.timing, pt.instructions,
               pt.start_date, pt.end_date, pt.stopped_at, pt.stopped_reason, pt.current_version,
               pt.created_at, pt.updated_at, pt.medication_id, pt.consultation_id,
               pt.previous_treatment_id,
               m.source_raw_value AS medication_raw, m.brand_name, m.form, m.strength, m.inn,
               m.atc_class, pr.full_name AS practitioner_name
        FROM app.patient_treatments pt
        JOIN app.medications m ON m.id = pt.medication_id
        LEFT JOIN app.profiles pr ON pr.id = pt.practitioner_id
        WHERE pt.patient_id = p_patient_id AND pt.status = 'paused'
        ORDER BY pt.updated_at DESC
      ) t
    ), '[]'::jsonb),
    'arretes_recents', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.stopped_at DESC)
      FROM (
        SELECT pt.id, pt.status, pt.dose, pt.dose_unit, pt.frequency, pt.timing, pt.instructions,
               pt.start_date, pt.end_date, pt.stopped_at, pt.stopped_reason, pt.current_version,
               pt.created_at, pt.updated_at, pt.medication_id, pt.consultation_id,
               pt.previous_treatment_id,
               m.source_raw_value AS medication_raw, m.brand_name, m.form, m.strength, m.inn,
               m.atc_class, pr.full_name AS practitioner_name
        FROM app.patient_treatments pt
        JOIN app.medications m ON m.id = pt.medication_id
        LEFT JOIN app.profiles pr ON pr.id = pt.practitioner_id
        WHERE pt.patient_id = p_patient_id AND pt.status = 'stopped'
          AND pt.stopped_at > now() - interval '90 days'
        ORDER BY pt.stopped_at DESC
        LIMIT 20
      ) t
    ), '[]'::jsonb),
    'total_actifs', (SELECT count(*) FROM app.patient_treatments WHERE patient_id = p_patient_id AND status='active'),
    'total', (SELECT count(*) FROM app.patient_treatments WHERE patient_id = p_patient_id)
  ) INTO v_result;
  RETURN v_result;
END; $$;
ALTER FUNCTION app.get_patient_treatments(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_patient_treatments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_patient_treatments(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2 · list_patient_medication_timeline — keyset, sans texte de note
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.list_patient_medication_timeline(
  p_id uuid,
  p_before_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20
) RETURNS TABLE (
  event_id uuid,
  occurred_at timestamptz,
  event_kind text,
  treatment_id uuid,
  action text,
  medication_name text,
  previous_values jsonb,
  new_values jsonb,
  reason text,
  notes text,
  actor_name text,
  consultation_id uuid,
  document_number text,
  line_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_limit integer;
  v_pat app.patients%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  PERFORM audit.log_read(p_id, 'liste');
  SELECT * INTO v_pat FROM app.patients WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT app.can_see_clinical(v_pat.practitioner_id) THEN RETURN; END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);

  RETURN QUERY
  SELECT evenement.event_id, evenement.occurred_at, evenement.event_kind,
         evenement.treatment_id, evenement.action, evenement.medication_name, evenement.previous_values,
         evenement.new_values, evenement.reason, evenement.notes,
         evenement.actor_name, evenement.consultation_id,
         evenement.document_number, evenement.line_count
  FROM (
    SELECT h.id AS event_id, h.occurred_at, 'treatment'::text AS event_kind,
           h.treatment_id,
           h.action::text AS action,
           COALESCE(m.source_raw_value, m.brand_name, m.inn) AS medication_name,
           h.previous_values, h.new_values, h.reason, h.notes,
           pr.full_name AS actor_name, h.consultation_id,
           NULL::text AS document_number, NULL::integer AS line_count
    FROM app.patient_treatment_history h
    JOIN app.patient_treatments pt ON pt.id = h.treatment_id
    JOIN app.medications m ON m.id = pt.medication_id
    LEFT JOIN app.profiles pr ON pr.id = h.actor_id
    WHERE pt.patient_id = p_id
      AND pt.cabinet_id = app.current_cabinet()
      AND app.can_see_clinical(pt.practitioner_id)

    UNION ALL

    SELECT px.id AS event_id, px.prescribed_at AS occurred_at, 'prescription'::text AS event_kind,
           NULL::uuid AS treatment_id,
           'prescription'::text AS action,
           NULL::text AS medication_name,
           NULL::jsonb AS previous_values, NULL::jsonb AS new_values,
           NULL::text AS reason, NULL::text AS notes,
           pr.full_name AS actor_name, px.consultation_id,
           NULL::text AS document_number,
           (SELECT count(*)::integer FROM app.prescription_lines pl WHERE pl.prescription_id = px.id) AS line_count
    FROM app.prescriptions px
    LEFT JOIN app.profiles pr ON pr.id = px.practitioner_id
    WHERE px.patient_id = p_id
      AND px.cabinet_id = app.current_cabinet()
      AND app.can_see_clinical(px.practitioner_id)
      -- Une prescription reliée à une ordonnance éditée est déjà rendue par
      -- l'événement document ci-dessous. La rendre deux fois ferait croire à
      -- deux actes datés alors qu'il n'y en a qu'un.
      AND NOT EXISTS (
        SELECT 1 FROM app.documents d
        WHERE d.prescription_id = px.id AND d.cabinet_id = px.cabinet_id
      )

    UNION ALL

    -- Émission : elle a TOUJOURS eu lieu, même si l'ordonnance a été annulée
    -- plus tard. On la garde donc à sa date d'émission.
    SELECT d.id AS event_id, d.issued_at AS occurred_at, 'document'::text AS event_kind,
           NULL::uuid AS treatment_id,
           'document_issued'::text AS action,
           NULL::text AS medication_name,
           NULL::jsonb AS previous_values, NULL::jsonb AS new_values,
           NULL::text AS reason, NULL::text AS notes,
           pr.full_name AS actor_name, d.consultation_id,
           d.doc_number AS document_number, NULL::integer AS line_count
    FROM app.documents d
    LEFT JOIN app.profiles pr ON pr.id = d.practitioner_id
    WHERE d.patient_id = p_id
      AND d.cabinet_id = app.current_cabinet()
      AND d.doc_type::text = 'ordonnance'
      AND app.can_see_clinical(d.practitioner_id)

    UNION ALL

    -- Annulation : un second acte, à sa propre date. La clé est dérivée de
    -- l'ordonnance pour rester stable entre deux pages de chronologie.
    SELECT public.uuid_generate_v5(
             '00000000-0000-0000-0000-000000000000'::uuid,
             d.id::text || ':voided'
           ) AS event_id,
           d.voided_at AS occurred_at, 'document'::text AS event_kind,
           NULL::uuid AS treatment_id,
           'document_voided'::text AS action,
           NULL::text AS medication_name,
           NULL::jsonb AS previous_values, NULL::jsonb AS new_values,
           d.void_reason AS reason, NULL::text AS notes,
           pr.full_name AS actor_name, d.consultation_id,
           d.doc_number AS document_number, NULL::integer AS line_count
    FROM app.documents d
    LEFT JOIN app.profiles pr ON pr.id = d.practitioner_id
    WHERE d.patient_id = p_id
      AND d.cabinet_id = app.current_cabinet()
      AND d.doc_type::text = 'ordonnance'
      AND d.status = 'voided'
      AND d.voided_at IS NOT NULL
      AND app.can_see_clinical(d.practitioner_id)
  ) AS evenement
  WHERE (
    p_before_at IS NULL
    OR (evenement.occurred_at, evenement.event_id) < (p_before_at, p_before_id)
  )
  ORDER BY evenement.occurred_at DESC, evenement.event_id DESC
  LIMIT v_limit;
END; $$;
ALTER FUNCTION app.list_patient_medication_timeline(uuid, timestamptz, uuid, integer) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_patient_medication_timeline(uuid, timestamptz, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_patient_medication_timeline(uuid, timestamptz, uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · get_patient_session_measures — les mesures de séance, jamais la note
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.get_patient_session_measures(
  p_id uuid,
  p_limit integer DEFAULT 120
) RETURNS TABLE (
  consultation_id uuid,
  measured_at timestamptz,
  anxiete integer,
  sommeil integer,
  humeur integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_limit integer;
  v_pat app.patients%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  PERFORM audit.log_read(p_id, 'liste');
  SELECT * INTO v_pat FROM app.patients WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT app.can_see_clinical(v_pat.practitioner_id) THEN RETURN; END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 120), 1), 200);

  RETURN QUERY
  SELECT c.id,
         c.started_at,
         NULLIF(n.structured->'sessionDetails'->'mesures'->>'anxiete', '')::integer,
         NULLIF(n.structured->'sessionDetails'->'mesures'->>'sommeil', '')::integer,
         NULLIF(n.structured->'sessionDetails'->'mesures'->>'humeur', '')::integer
  FROM app.consultations c
  JOIN app.clinical_notes n ON n.consultation_id = c.id
  WHERE c.patient_id = p_id
    AND c.cabinet_id = app.current_cabinet()
    AND app.can_see_clinical(c.practitioner_id)
    AND n.structured->'sessionDetails'->'mesures' IS NOT NULL
    AND (
      n.structured->'sessionDetails'->'mesures'->>'anxiete' IS NOT NULL
      OR n.structured->'sessionDetails'->'mesures'->>'sommeil' IS NOT NULL
      OR n.structured->'sessionDetails'->'mesures'->>'humeur' IS NOT NULL
    )
  ORDER BY c.started_at DESC
  LIMIT v_limit;
END; $$;
ALTER FUNCTION app.get_patient_session_measures(uuid, integer) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_patient_session_measures(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_patient_session_measures(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · list_medication_workload — file agrégée, cloisonnée par rôle
-- ---------------------------------------------------------------------------
-- La surcharge à trois arguments a existé un temps en développement. On la
-- retire explicitement : `CREATE OR REPLACE` avec une liste d'arguments
-- différente crée une SECONDE fonction, et l'ancienne resterait appelable avec
-- un filtre d'attention absent.
DROP FUNCTION IF EXISTS app.list_medication_workload(text, integer, integer);

CREATE OR REPLACE FUNCTION app.list_medication_workload(
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0,
  p_attention text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_role app.user_role;
  v_cab uuid;
  v_uid uuid;
  v_limit integer;
  v_offset integer;
  v_attention text;
  v_total integer;
  v_rows jsonb;
  v_resume jsonb;
BEGIN
  v_role := app.current_role();
  v_cab := app.current_cabinet();
  v_uid := auth.uid();
  IF v_role NOT IN ('owner', 'practitioner') OR v_cab IS NULL THEN RETURN NULL; END IF;

  PERFORM audit.log_read(NULL, 'liste');
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_attention := NULLIF(btrim(COALESCE(p_attention, '')), '');
  IF v_attention IS NOT NULL AND v_attention NOT IN ('revue', 'fin') THEN
    v_attention := NULL;
  END IF;

  WITH base AS (
    SELECT p.id AS patient_id, p.first_name, p.last_name, p.record_number,
           a.actifs, a.posologie_incomplete, a.fin_depassee, a.prochaine_fin
    FROM app.patients p
    JOIN (
      SELECT pt.patient_id, count(*)::integer AS actifs,
             bool_or(pt.dose IS NULL OR btrim(pt.dose) = '' OR pt.frequency IS NULL OR btrim(pt.frequency) = '') AS posologie_incomplete,
             bool_or(pt.end_date IS NOT NULL AND pt.end_date < (now() AT TIME ZONE 'Africa/Algiers')::date) AS fin_depassee,
             min(pt.end_date) FILTER (WHERE pt.end_date IS NOT NULL) AS prochaine_fin
      FROM app.patient_treatments pt
      WHERE pt.cabinet_id = v_cab
        AND pt.status = 'active'
        AND (v_role = 'owner' OR pt.practitioner_id = v_uid)
      GROUP BY pt.patient_id
    ) a ON a.patient_id = p.id
    WHERE p.cabinet_id = v_cab
      AND p.is_active
      AND (v_role = 'owner' OR p.practitioner_id = v_uid)
      AND (
        NULLIF(btrim(COALESCE(p_query, '')), '') IS NULL
        OR position(app.nom_recherche(p_query) IN app.nom_recherche(p.first_name || ' ' || p.last_name)) > 0
        OR app.nom_recherche(p_query) = app.nom_recherche(p.record_number)
      )
  ), filtre AS (
    SELECT * FROM base
    WHERE v_attention IS NULL
       OR (
         v_attention = 'revue'
         AND (
           fin_depassee
           OR posologie_incomplete
           OR (prochaine_fin IS NOT NULL
               AND prochaine_fin <= (now() AT TIME ZONE 'Africa/Algiers')::date + 14)
         )
       )
       OR (
         v_attention = 'fin'
         AND prochaine_fin IS NOT NULL
         AND prochaine_fin <= (now() AT TIME ZONE 'Africa/Algiers')::date + 14
       )
  ), page AS (
    SELECT * FROM filtre
    ORDER BY fin_depassee DESC, prochaine_fin ASC NULLS LAST, actifs DESC, last_name ASC, first_name ASC, patient_id ASC
    LIMIT v_limit OFFSET v_offset
  ), stats AS (
    SELECT
      (SELECT count(*) FROM filtre) AS total,
      (SELECT jsonb_build_object(
         'patients', count(*),
         'actifs', COALESCE(sum(actifs), 0),
         'revue', count(*) FILTER (
           WHERE fin_depassee
              OR posologie_incomplete
              OR (prochaine_fin IS NOT NULL
                  AND prochaine_fin <= (now() AT TIME ZONE 'Africa/Algiers')::date + 14)
         ),
         'changements', (
           SELECT count(*)
           FROM app.patient_treatment_history h
           JOIN app.patient_treatments pt ON pt.id = h.treatment_id
           JOIN app.patients p ON p.id = pt.patient_id
           WHERE pt.cabinet_id = v_cab
             AND p.cabinet_id = v_cab
             AND h.occurred_at >= now() - interval '30 days'
             AND (v_role = 'owner' OR (pt.practitioner_id = v_uid AND p.practitioner_id = v_uid))
         )
       ) FROM base) AS resume
  ), donnees AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'patient_id', page.patient_id,
      'first_name', page.first_name,
      'last_name', page.last_name,
      'record_number', page.record_number,
      'active_count', page.actifs,
      'has_missing_posology', page.posologie_incomplete,
      'has_overdue_end_date', page.fin_depassee,
      'next_end_date', page.prochaine_fin,
      'last_consultation_at', (
        SELECT max(c.started_at) FROM app.consultations c
        WHERE c.patient_id = page.patient_id
          AND c.cabinet_id = v_cab
          AND (v_role = 'owner' OR c.practitioner_id = v_uid)
      ),
      'next_appointment_at', (
        SELECT min(ap.starts_at) FROM app.appointments ap
        WHERE ap.patient_id = page.patient_id
          AND ap.cabinet_id = v_cab
          AND (v_role = 'owner' OR ap.practitioner_id = v_uid)
          AND ap.status IN ('confirmed','requested')
          AND ap.starts_at >= now()
      ),
      'meds', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'treatment_id', pt.id,
          'medication_name', COALESCE(m.source_raw_value, m.brand_name, m.inn),
          'dose', pt.dose,
          'dose_unit', pt.dose_unit,
          'frequency', pt.frequency,
          'start_date', pt.start_date,
          'end_date', pt.end_date,
          'status', pt.status,
          'updated_at', pt.updated_at
        ) ORDER BY pt.start_date DESC, pt.created_at DESC)
        FROM app.patient_treatments pt
        JOIN app.medications m ON m.id = pt.medication_id
        WHERE pt.patient_id = page.patient_id
          AND pt.cabinet_id = v_cab
          AND pt.status = 'active'
          AND (v_role = 'owner' OR pt.practitioner_id = v_uid)
      ), '[]'::jsonb)
    ) ORDER BY page.fin_depassee DESC, page.prochaine_fin ASC NULLS LAST, page.actifs DESC, page.last_name ASC, page.first_name ASC, page.patient_id ASC), '[]'::jsonb) AS rows
    FROM page
  )
  SELECT stats.total, stats.resume, donnees.rows
  INTO v_total, v_resume, v_rows
  FROM stats CROSS JOIN donnees;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows, 'resume', v_resume);
END; $$;
ALTER FUNCTION app.list_medication_workload(text, integer, integer, text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_medication_workload(text, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_medication_workload(text, integer, integer, text) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

INSERT INTO app.schema_migrations(version)
VALUES ('211_medication_workspace_reads')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
