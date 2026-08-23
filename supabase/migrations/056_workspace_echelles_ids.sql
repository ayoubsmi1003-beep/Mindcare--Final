-- ═══════════════════════════════════════════════════════════════════════════
-- 056_workspace_echelles_ids — chaque « dernier » d'échelle porte son id.
--
-- POURQUOI. Les Signaux du dossier et les preuves du Résumé citent des
-- LIGNES : la porte `save_case_summary` refuse toute citation qui ne
-- correspond pas à une ligne réelle du patient. Or le contrat ne rendait que
-- code/score/date pour les échelles — sans `scale_administrations.id`, une
-- évolution de PHQ-9 était un fait SANS référence citable.
--
-- AJOUT MINIMAL : `id` dans l'objet `dernier` de chaque échelle (l'id de la
-- dernière administration). Évolution additive — `contrat` reste 1.
-- Corps RECOPIÉ de pg_proc.prosrc (méthode 048/052/055), trois lignes ajoutées.
--
-- Retour arrière (documentation) : CREATE OR REPLACE avec le corps 053.
-- ═══════════════════════════════════════════════════════════════════════════

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

  -- Trace AVANT la lecture, mÃªme transaction (I4, motif `get_patient` 020) :
  -- la TENTATIVE d'ouverture est tracÃ©e, y compris quand la RLS ne rend rien.
  PERFORM audit.log_read(p_id, 'fiche');

  -- La RLS dÃ©cide. ZÃ©ro ligne = inexistant OU hors pÃ©rimÃ¨tre, et les deux
  -- rendent la mÃªme chose : distinguer fabriquerait un oracle d'existence
  -- (ADR-003). Ne jamais Â« amÃ©liorer Â» ce comportement.
  SELECT * INTO v_pat FROM app.patients WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- ReprÃ©sentation, pas autorisation â€” voir l'en-tÃªte. La praticienne du
  -- dossier vient de la ligne DÃ‰JÃ€ filtrÃ©e par la RLS, jamais de l'appelant.
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
    -- sans donnÃ©e. L'Ã©cran distingue les deux ; c'est tout l'enjeu.
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

      -- Par Ã©chelle : les DEUX derniÃ¨res mesures, jamais plus. `precedent` et
      -- `delta` restent nuls s'il n'y en a qu'une â€” une seule observation ne
      -- fait pas une tendance, et l'Ã©cran ne doit pas pouvoir en dessiner une.
      'echelles', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'scale_code', e.code,
                 'scale_name', e.name_fr,
                 'dernier', jsonb_build_object(
'id',            e.d_id,
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
max(r.admin_id) FILTER (WHERE r.rang = 1) AS d_id,
                   max(r.total_score)     FILTER (WHERE r.rang = 2) AS p_score,
                   max(r.administered_at) FILTER (WHERE r.rang = 2) AS p_date
              FROM (
                SELECT s.code, s.name_fr, sa.total_score, sa.interpretation,
sa.id AS admin_id,
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
                 -- (024 ne l'a ajoutÃ© qu'Ã  `app.appointments`). MÃªme chemin que
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

    -- Historique de prescriptions, PAS un moteur de statut mÃ©dicamenteux :
    -- le schÃ©ma n'a ni `stopped_at` ni statut de ligne. Â« derniÃ¨re
    -- prescription Â», jamais Â« traitement en cours Â» â€” l'Ã©cran ne peut pas
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

    -- L'agenda reste propriÃ©taire du rendez-vous : on en lit un rÃ©sumÃ©, on ne
    -- le duplique pas. Accessible Ã  l'accueil, comme les policies de 006.
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
    -- Ã©crit sa propre trace `liste` quand la praticienne la demande vraiment.
    'documents', jsonb_build_object(
      'nombre', (SELECT count(*) FROM app.documents dc WHERE dc.patient_id = p_id),
      'dernier_emis_le', (SELECT max(dc.issued_at) FROM app.documents dc
                           WHERE dc.patient_id = p_id)
    ),    -- â”€â”€ Patients V3 Â· les RDV DU JOUR â€” bornes Africa/Algiers (CLAUDE.md Â§4).
    -- Le bandeau Â« Aujourd'hui Â» rÃ©pond Ã  Â« pourquoi ce dossier maintenant Â»
    -- sans jamais fabriquer un rendez-vous : liste vide = aucun RDV aujourd'hui.
    'rendez_vous_du_jour', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
               'status', a.status, 'kind', a.kind,
               'practitioner_name', pr.full_name)
             ORDER BY a.starts_at ASC)
        FROM app.appointments a
        LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
       WHERE a.patient_id = p_id
         AND a.starts_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') AT TIME ZONE 'Africa/Algiers'
         AND a.starts_at <  (date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') + interval '1 day') AT TIME ZONE 'Africa/Algiers'
         AND a.status NOT IN ('cancelled','no_show')), '[]'::jsonb),

    -- â”€â”€ Patients V3 Â· derniÃ¨re version valide du RÃ©sumÃ© du cas.
    -- JSON null hors droit clinique du PATIENT (Amendement A : mÃªme prÃ©dicat
    -- que `clinique`, JAMAIS le gÃ©nÃ©rateur â€” l'owner peut gÃ©nÃ©rer pour la
    -- patiente d'une praticienne, c'est elle qui doit le voir).
    -- `a_jour` est calculÃ© EN BASE : comparaison de generated_at au dernier
    -- horodatage des domaines couverts par source_state. L'Ã©cran en fait un
    -- des trois libellÃ©s prÃ©vus ; il n'affiche ni hash ni technique.
    'resume', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE COALESCE((
      SELECT jsonb_build_object(
               'id',         s.id,
               'version',    s.version,
               'genere_le',  s.generated_at,
               'genere_par', gp.full_name,
               'a_jour', (
                 SELECT coalesce(max(t.dernier) IS NULL
                                  OR s.generated_at >= max(t.dernier), true)
                   FROM (
                     SELECT max(d.created_at)      AS dernier FROM app.diagnoses d            WHERE d.patient_id = p_id
                     UNION ALL
                     SELECT max(e.administered_at) FROM app.scale_administrations e WHERE e.patient_id = p_id
                     UNION ALL
                     SELECT max(c.started_at)      FROM app.consultations c        WHERE c.patient_id = p_id
                     UNION ALL
                     SELECT max(x.prescribed_at)   FROM app.prescriptions x        WHERE x.patient_id = p_id
                     UNION ALL
                     SELECT max(r.created_at)      FROM app.appointments r         WHERE r.patient_id = p_id
                     UNION ALL
                     SELECT max(dc.issued_at)      FROM app.documents dc           WHERE dc.patient_id = p_id
                   ) t),
               'contenu', s.content)
        FROM app.patient_case_summaries s
        LEFT JOIN app.profiles gp ON gp.id = s.practitioner_id
       WHERE s.patient_id = p_id
       ORDER BY s.version DESC
       LIMIT 1), 'null'::jsonb) END
  )
  INTO v_resultat;

  RETURN v_resultat;
END;




$$;

ALTER FUNCTION app.get_patient_workspace(uuid) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.get_patient_workspace(uuid) IS
  'Patients V3 (056). Ajout de dernier.id (scale_administrations.id) aux '
  'échelles du contrat — les citations de mesures deviennent vérifiables par '
  'save_case_summary. Contrat inchangé sinon (additif, contrat=1).';

REVOKE ALL ON FUNCTION app.get_patient_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_patient_workspace(uuid) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('056_workspace_echelles_ids')
  ON CONFLICT DO NOTHING;

COMMIT;
