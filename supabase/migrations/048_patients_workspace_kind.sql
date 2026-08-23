-- 048_patients_workspace_kind — correctif de 047 : `kind` vit sur le
-- rendez-vous, pas sur la consultation.
--
-- ═══ CE QUI S'EST PASSÉ ═══════════════════════════════════════════════════
--
-- 047 lisait `c.kind` sur `app.consultations`. Cette colonne N'EXISTE PAS :
-- 024 n'a ajouté `kind` qu'à `app.appointments`, et une consultation en hérite
-- par son rendez-vous — c'est exactement ce que fait `get_consultation` (026)
-- en rendant `appointment_kind`.
--
-- ⚠️ POURQUOI L'ERREUR N'A PAS ÉTÉ VUE À L'APPLICATION DE 047. Postgres ne
-- résout pas les identifiants du corps d'une fonction plpgsql à sa création :
-- la migration est passée VERTE, et la porte n'a échoué qu'au premier appel,
-- au checkpoint. C'est précisément le motif « vert statique ≠ vert intégré » :
-- une migration appliquée sans porte exercée ne prouve rien.
--
-- ═══ POURQUOI 048 ET PAS UNE ÉDITION DE 047 ═══════════════════════════════
--
-- 047 est appliquée (règle 9 : une migration appliquée ne se modifie jamais).
--
-- ⚠️ `CREATE OR REPLACE`, JAMAIS `DROP` PUIS `CREATE`. Un DROP réattribuerait
-- le propriétaire de la fonction au rôle exécutant — `postgres`, qui porte
-- `rolbypassrls` — et la porte cesserait silencieusement d'être filtrée par la
-- RLS, sur une migration parfaitement verte. `CREATE OR REPLACE` conserve le
-- propriétaire ; le `ALTER … OWNER TO` en fin de section le RÉAFFIRME quand
-- même, pour que rien ne dépende d'un souvenir.
--
-- Les corps ci-dessous sont ceux de 047, à ce seul détail près.

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE OR REPLACE FUNCTION app.get_patient_workspace(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_pat      app.patients%ROWTYPE;
  v_clinique boolean;
  v_resultat jsonb;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Trace AVANT la lecture, même transaction (I4, motif `get_patient` 020) :
  -- la TENTATIVE d'ouverture est tracée, y compris quand la RLS ne rend rien.
  PERFORM audit.log_read(p_id, 'fiche');

  -- La RLS décide. Zéro ligne = inexistant OU hors périmètre, et les deux
  -- rendent la même chose : distinguer fabriquerait un oracle d'existence
  -- (ADR-003). Ne jamais « améliorer » ce comportement.
  SELECT * INTO v_pat FROM app.patients WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Représentation, pas autorisation — voir l'en-tête. La praticienne du
  -- dossier vient de la ligne DÉJÀ filtrée par la RLS, jamais de l'appelant.
  v_clinique := app.can_see_clinical(v_pat.practitioner_id);

  SELECT jsonb_build_object(
    'contrat',  1,
    'genere_a', now(),

    'identite', jsonb_build_object(
      'id',            v_pat.id,
      'record_number', v_pat.record_number,
      'first_name',    v_pat.first_name,
      'last_name',     v_pat.last_name,
      'birth_date',    v_pat.birth_date,
      'age',           CASE WHEN v_pat.birth_date IS NULL THEN NULL
                            ELSE extract(year FROM age(v_pat.birth_date))::int END,
      'sex',           v_pat.sex,
      'is_active',     v_pat.is_active
    ),

    'contact', jsonb_build_object(
      'phone',             v_pat.phone,
      'phone_alt',         v_pat.phone_alt,
      'address',           v_pat.address,
      'emergency_contact', v_pat.emergency_contact
    ),

    'identification', jsonb_build_object(
      'id_document_number', v_pat.id_document_number,
      'id_document_issuer', v_pat.id_document_issuer
    ),

    'admin', jsonb_build_object('notes_admin', v_pat.notes_admin),

    -- JSON null = domaine inaccessible. Objet aux listes vides = accessible,
    -- sans donnée. L'écran distingue les deux ; c'est tout l'enjeu.
    'clinique', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE jsonb_build_object(

      'diagnostics', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id',          d.id,
                 'code_system', d.code_system,
                 'code',        d.code,
                 'label',       d.label,
                 'is_primary',  d.is_primary,
                 'onset_date',  d.onset_date,
                 'resolved_at', d.resolved_at)
               ORDER BY d.is_primary DESC, d.onset_date DESC NULLS LAST, d.created_at DESC)
          FROM app.diagnoses d
         WHERE d.patient_id = p_id), '[]'::jsonb),

      -- Par échelle : les DEUX dernières mesures, jamais plus. `precedent` et
      -- `delta` restent nuls s'il n'y en a qu'une — une seule observation ne
      -- fait pas une tendance, et l'écran ne doit pas pouvoir en dessiner une.
      'echelles', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'scale_code', e.code,
                 'scale_name', e.name_fr,
                 'dernier', jsonb_build_object(
                   'score',          e.d_score,
                   'date',           e.d_date,
                   'interpretation', e.d_interp),
                 'precedent', CASE WHEN e.p_date IS NULL THEN 'null'::jsonb
                                   ELSE jsonb_build_object('score', e.p_score,
                                                           'date',  e.p_date) END,
                 'delta', CASE WHEN e.p_score IS NULL OR e.d_score IS NULL THEN NULL
                               ELSE e.d_score - e.p_score END)
               ORDER BY e.d_date DESC)
          FROM (
            SELECT r.code, r.name_fr,
                   max(r.total_score)     FILTER (WHERE r.rang = 1) AS d_score,
                   max(r.administered_at) FILTER (WHERE r.rang = 1) AS d_date,
                   max(r.interpretation)  FILTER (WHERE r.rang = 1) AS d_interp,
                   max(r.total_score)     FILTER (WHERE r.rang = 2) AS p_score,
                   max(r.administered_at) FILTER (WHERE r.rang = 2) AS p_date
              FROM (
                SELECT s.code, s.name_fr, sa.total_score, sa.interpretation,
                       sa.administered_at,
                       row_number() OVER (PARTITION BY sa.scale_id
                                          ORDER BY sa.administered_at DESC) AS rang
                  FROM app.scale_administrations sa
                  JOIN app.scales s ON s.id = sa.scale_id
                 WHERE sa.patient_id = p_id
              ) r
             WHERE r.rang <= 2
             GROUP BY r.code, r.name_fr
          ) e), '[]'::jsonb),

      'derniere_consultation', (
        SELECT jsonb_build_object(
                 'id',         c.id,
                 'started_at', c.started_at,
                 'ended_at',   c.ended_at,
                 'status',     c.status,
                 -- `kind` vit sur le RENDEZ-VOUS, jamais sur la consultation
                 -- (024 ne l'a ajouté qu'à `app.appointments`). Même chemin que
                 -- `appointment_kind` dans `get_consultation` (026).
                 'kind',       a.kind,
                 'practitioner_name', pr.full_name)
          FROM app.consultations c
          LEFT JOIN app.profiles pr ON pr.id = c.practitioner_id
          LEFT JOIN app.appointments a ON a.id = c.appointment_id
         WHERE c.patient_id = p_id
         ORDER BY c.started_at DESC
         LIMIT 1),

      'nombre_consultations', (
        SELECT count(*) FROM app.consultations c WHERE c.patient_id = p_id)
    ) END,

    -- Historique de prescriptions, PAS un moteur de statut médicamenteux :
    -- le schéma n'a ni `stopped_at` ni statut de ligne. « dernière
    -- prescription », jamais « traitement en cours » — l'écran ne peut pas
    -- affirmer ce que la base n'enregistre pas.
    'traitements', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE jsonb_build_object(

      'derniere_prescription', (
        SELECT jsonb_build_object(
                 'id',                px.id,
                 'prescribed_at',     px.prescribed_at,
                 'is_handwritten',    px.is_handwritten,
                 'practitioner_name', pr.full_name,
                 'lignes', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'id',                pl.id,
                            'designation',       COALESCE(m.inn, pl.free_text),
                            'brand_name',        m.brand_name,
                            'dose',              pl.dose,
                            'frequency_per_day', pl.frequency_per_day,
                            'duration_days',     pl.duration_days,
                            'instructions',      pl.instructions)
                          ORDER BY pl.position)
                     FROM app.prescription_lines pl
                     LEFT JOIN app.medications m ON m.id = pl.medication_id
                    WHERE pl.prescription_id = px.id), '[]'::jsonb))
          FROM app.prescriptions px
          LEFT JOIN app.profiles pr ON pr.id = px.practitioner_id
         WHERE px.patient_id = p_id
         ORDER BY px.prescribed_at DESC
         LIMIT 1),

      'nombre_prescriptions', (
        SELECT count(*) FROM app.prescriptions px WHERE px.patient_id = p_id)
    ) END,

    -- L'agenda reste propriétaire du rendez-vous : on en lit un résumé, on ne
    -- le duplique pas. Accessible à l'accueil, comme les policies de 006.
    'agenda', jsonb_build_object(
      'prochain_rendez_vous', (
        SELECT jsonb_build_object(
                 'id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
                 'status', a.status, 'kind', a.kind,
                 'practitioner_name', pr.full_name)
          FROM app.appointments a
          LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
         WHERE a.patient_id = p_id
           AND a.starts_at >= now()
           AND a.status NOT IN ('cancelled', 'no_show')
         ORDER BY a.starts_at ASC
         LIMIT 1),
      'dernier_rendez_vous', (
        SELECT jsonb_build_object(
                 'id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
                 'status', a.status, 'kind', a.kind,
                 'practitioner_name', pr.full_name)
          FROM app.appointments a
          LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
         WHERE a.patient_id = p_id
           AND a.starts_at < now()
         ORDER BY a.starts_at DESC
         LIMIT 1),
      'nombre_rendez_vous', (
        SELECT count(*) FROM app.appointments a WHERE a.patient_id = p_id)
    ),

    -- Comptage seulement : la LISTE reste `list_patient_documents` (030), qui
    -- écrit sa propre trace `liste` quand la praticienne la demande vraiment.
    'documents', jsonb_build_object(
      'nombre', (SELECT count(*) FROM app.documents dc WHERE dc.patient_id = p_id),
      'dernier_emis_le', (SELECT max(dc.issued_at) FROM app.documents dc
                           WHERE dc.patient_id = p_id)
    )
  )
  INTO v_resultat;

  RETURN v_resultat;
END;
$$;

ALTER FUNCTION app.get_patient_workspace(uuid) OWNER TO app_gatekeeper;

CREATE OR REPLACE FUNCTION app.list_patient_timeline(
  p_id        uuid,
  p_before_at timestamptz DEFAULT NULL,
  p_before_id uuid        DEFAULT NULL,
  p_limit     integer     DEFAULT 20
)
RETURNS TABLE (
  occurred_at       timestamptz,
  event_id          uuid,
  event_type        text,
  label_key         text,
  practitioner_name text,
  detail            jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_limit integer;
BEGIN
  IF p_id IS NULL THEN
    RETURN;
  END IF;

  -- Bornage EN BASE : une pagination que l'appelant choisit sans limite est
  -- un export (doctrine `search_patients`, 020).
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  PERFORM audit.log_read(p_id, 'liste');

  RETURN QUERY
  WITH evenements AS (

    -- 1 · Consultations
    SELECT COALESCE(c.ended_at, c.started_at) AS occurred_at,
           c.id                               AS event_id,
           'consultation'::text               AS event_type,
           CASE WHEN c.status = 'closed' THEN 'consultation_close'
                ELSE 'consultation_ouverte' END::text AS label_key,
           pr.full_name                       AS practitioner_name,
           -- `kind` vient du rendez-vous (024), pas de la consultation.
           jsonb_build_object('status', c.status, 'kind', a.kind) AS detail
      FROM app.consultations c
      LEFT JOIN app.profiles pr ON pr.id = c.practitioner_id
      LEFT JOIN app.appointments a ON a.id = c.appointment_id
     WHERE c.patient_id = p_id

    UNION ALL

    -- 2 · Notes signées — MÉTADONNÉES SEULES. Le SOAP ne sort jamais d'ici.
    SELECT n.signed_at, n.id, 'note'::text, 'note_signee'::text,
           pr.full_name,
           jsonb_build_object('consultation_id', n.consultation_id)
      FROM app.clinical_notes n
      LEFT JOIN app.profiles pr ON pr.id = n.signed_by
     WHERE n.patient_id = p_id AND n.signed_at IS NOT NULL

    UNION ALL

    -- 3 · Diagnostics posés
    SELECT d.created_at, d.id, 'diagnostic'::text, 'diagnostic_pose'::text,
           pr.full_name,
           jsonb_build_object('label', d.label, 'code', d.code,
                              'code_system', d.code_system,
                              'is_primary', d.is_primary,
                              'onset_date', d.onset_date)
      FROM app.diagnoses d
      LEFT JOIN app.profiles pr ON pr.id = d.practitioner_id
     WHERE d.patient_id = p_id

    UNION ALL

    -- 4 · Diagnostics résolus. `resolved_at` est une DATE : la convertir en
    -- instant se fait aux bornes du cabinet, pas en UTC (§4 des conventions).
    SELECT d.resolved_at::timestamp AT TIME ZONE 'Africa/Algiers',
           d.id, 'diagnostic'::text, 'diagnostic_resolu'::text,
           pr.full_name,
           jsonb_build_object('label', d.label, 'code', d.code,
                              'code_system', d.code_system)
      FROM app.diagnoses d
      LEFT JOIN app.profiles pr ON pr.id = d.practitioner_id
     WHERE d.patient_id = p_id AND d.resolved_at IS NOT NULL

    UNION ALL

    -- 5 · Prescriptions — le NOMBRE de lignes, jamais leur contenu libre.
    SELECT px.prescribed_at, px.id, 'prescription'::text, 'prescription'::text,
           pr.full_name,
           jsonb_build_object(
             'is_handwritten', px.is_handwritten,
             'nombre_lignes', (SELECT count(*) FROM app.prescription_lines pl
                                WHERE pl.prescription_id = px.id))
      FROM app.prescriptions px
      LEFT JOIN app.profiles pr ON pr.id = px.practitioner_id
     WHERE px.patient_id = p_id

    UNION ALL

    -- 6 · Échelles
    SELECT sa.administered_at, sa.id, 'echelle'::text, 'echelle'::text,
           pr.full_name,
           jsonb_build_object('scale_code', s.code, 'scale_name', s.name_fr,
                              'score', sa.total_score)
      FROM app.scale_administrations sa
      JOIN app.scales s ON s.id = sa.scale_id
      LEFT JOIN app.profiles pr ON pr.id = sa.practitioner_id
     WHERE sa.patient_id = p_id

    UNION ALL

    -- 7 · Rendez-vous. `notes_admin` est administratif, mais c'est du texte
    -- libre saisi à l'accueil : il n'entre pas dans le flux.
    SELECT a.starts_at, a.id, 'rdv'::text, 'rdv'::text,
           pr.full_name,
           jsonb_build_object('status', a.status, 'kind', a.kind,
                              'source', a.source)
      FROM app.appointments a
      LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
     WHERE a.patient_id = p_id

    UNION ALL

    -- 8 · Documents émis
    SELECT dc.issued_at, dc.id, 'document'::text, 'document'::text,
           pr.full_name,
           jsonb_build_object('doc_type', dc.doc_type,
                              'doc_number', dc.doc_number)
      FROM app.documents dc
      LEFT JOIN app.profiles pr ON pr.id = dc.practitioner_id
     WHERE dc.patient_id = p_id
  )
  SELECT e.occurred_at, e.event_id, e.event_type, e.label_key,
         e.practitioner_name, e.detail
    FROM evenements e
   WHERE e.occurred_at IS NOT NULL
     AND (p_before_at IS NULL
          OR (e.occurred_at, e.event_id) < (p_before_at, p_before_id))
   ORDER BY e.occurred_at DESC, e.event_id DESC
   LIMIT v_limit;
END;
$$;

ALTER FUNCTION app.list_patient_timeline(uuid, timestamptz, uuid, integer)
  OWNER TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- Refermer
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('048_patients_workspace_kind')
  ON CONFLICT DO NOTHING;

COMMIT;
