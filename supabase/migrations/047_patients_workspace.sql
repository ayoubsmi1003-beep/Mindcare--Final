-- 047_patients_workspace — l'espace de travail clinique du dossier patient.
--
-- ═══ CE QUE CE FICHIER EST ════════════════════════════════════════════════
--
-- Deux portes de LECTURE, patient par patient, là où il n'en existait qu'une
-- (`list_patient_documents`, 030) :
--
--   1. `get_patient_workspace(patient)` — TOUT l'écran d'ouverture en UN
--      appel (PERF §3, « un écran = un appel ») : identité, coordonnées,
--      contexte clinique, dernière prescription, prochain rendez-vous,
--      comptages. Une trace `fiche`, écrite AVANT la lecture.
--
--   2. `list_patient_timeline(patient, curseur…)` — la chronologie
--      longitudinale, huit sources fusionnées, paginée en KEYSET. Une trace
--      `liste` par appel.
--
-- ═══ CE QUE CE FICHIER NE FAIT PAS ════════════════════════════════════════
--
-- Il ne crée ni table, ni colonne, ni valeur d'enum (règle 9). Il ne touche
-- AUCUNE fonction existante : `get_patient`, `search_patients`,
-- `update_patient`, `list_patient_documents` sont inchangées, et rien n'est
-- `DROP`é — un DROP réattribue le propriétaire et rouvre la cloison sur une
-- migration verte. Il n'ajoute aucun second chemin d'ÉCRITURE : la seule voie
-- reste `app.update_patient` (020).
--
-- ═══ POURQUOI SIX `GRANT SELECT` NEUFS ════════════════════════════════════
--
-- ⚠️ LE POINT LE PLUS IMPORTANT DE CE FICHIER.
--
-- `app_gatekeeper` avait SELECT sur patients, appointments, profiles,
-- consultations, clinical_notes, payments, documents, charges. Il n'en avait
-- AUCUN sur diagnoses, prescriptions, prescription_lines,
-- scale_administrations, scales, medications — jamais accordé depuis 001.
-- Sans les grants ci-dessous les deux portes ne rendraient pas « zéro ligne » :
-- elles échoueraient en `42501 permission denied`, à l'exécution.
-- On les nomme donc, au lieu de les supposer (motif 022 §1).
--
-- CES GRANTS N'OUVRENT RIEN. Quatre dispositifs indépendants, tous vérifiés
-- par le checkpoint de ce lot, font que la RLS s'applique intégralement sous
-- `app_gatekeeper` :
--   · il ne POSSÈDE aucune table — aucun `ALTER TABLE … OWNER TO` n'existe
--     dans les 45 migrations ; les tables sont à `postgres`. Un propriétaire
--     contournerait la RLS ; lui non ;
--   · il n'a pas BYPASSRLS, et 020 §2 LÈVE au déploiement s'il l'obtenait ;
--   · les six tables sont en FORCE ROW LEVEL SECURITY (009) ;
--   · il hérite de `authenticated` (020/021), donc les policies `TO
--     authenticated` de 009 s'appliquent — et AUCUNE n'a de clause assistante.
-- Une assistante lit donc zéro ligne clinique sous ces portes, par la base.
--
-- ═══ « PAS LE DROIT » N'EST PAS « RIEN À MONTRER » ════════════════════════
--
-- La RLS seule ne distingue pas les deux : dans les deux cas la sous-requête
-- rend zéro ligne. Une assistante et une praticienne dont la patiente n'a
-- aucun diagnostic produiraient le même `[]`, et l'écran ne saurait pas
-- choisir entre « onglet absent » et « Aucun diagnostic enregistré ».
-- `clinique` et `traitements` valent donc JSON `null` quand
-- `app.can_see_clinical()` — le helper CANONIQUE de 003, celui-là même
-- qu'appellent les policies, déjà utilisé en seconde barrière par
-- `get_document` (030) — rend faux.
-- Ce n'est PAS un test de rôle applicatif (règle 4) : il ne décide pas de
-- l'accès, il décide de la FORME. S'il se trompait en rendant vrai, la RLS
-- filtrerait quand même les sous-requêtes et l'écran afficherait une section
-- vide. Le pire cas est un onglet inutile, jamais une divulgation.
--
-- ═══ FUSEAU ═══════════════════════════════════════════════════════════════
--
-- `genere_a` est un `timestamptz` rendu tel quel : sérialisé en ISO 8601 AVEC
-- offset. `AT TIME ZONE 'Africa/Algiers'` y détruirait l'information de
-- fuseau, et le client ne saurait plus si 14:32 est local ou UTC. La
-- convention Africa/Algiers s'impose au calcul des BORNES DE JOURNÉE, pas à
-- la représentation d'un instant — c'est pourquoi elle sert plus bas à
-- convertir une `date` (resolved_at) en instant, et là seulement.
--
-- ⚠️ AUCUNE DES DEUX PORTES N'EST `STABLE` : elles écrivent une trace d'audit
-- avant de lire. Déclarer STABLE une fonction qui écrit serait un mensonge au
-- planificateur — et l'autoriserait à élider des appels, donc à PERDRE des
-- lignes d'audit (même raison qu'en 046 pour `reception_board`).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Privilèges du porteur — ON NOMME AU LIEU D'HÉRITER (motif 022 §1)
-- ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

GRANT SELECT ON app.patients       TO app_gatekeeper;   -- 020, idempotent
GRANT SELECT ON app.profiles       TO app_gatekeeper;   -- 022, idempotent
GRANT SELECT ON app.appointments   TO app_gatekeeper;   -- 022, idempotent
GRANT SELECT ON app.consultations  TO app_gatekeeper;   -- 026, idempotent
GRANT SELECT ON app.clinical_notes TO app_gatekeeper;   -- 026, idempotent
GRANT SELECT ON app.documents      TO app_gatekeeper;   -- 030, idempotent

-- Les six neufs — voir l'en-tête.
GRANT SELECT ON app.diagnoses             TO app_gatekeeper;
GRANT SELECT ON app.prescriptions         TO app_gatekeeper;
GRANT SELECT ON app.prescription_lines    TO app_gatekeeper;
GRANT SELECT ON app.scale_administrations TO app_gatekeeper;
GRANT SELECT ON app.scales                TO app_gatekeeper;
GRANT SELECT ON app.medications           TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 2 · L'index manquant
-- ---------------------------------------------------------------------------
-- Seule table clinique par patient sans index adéquat : 009 en a posé un sur
-- diagnoses et scale_administrations, 007 et 008 sur consultations et
-- clinical_notes, jamais sur prescriptions. La porte agrégée et la
-- chronologie la lisent toutes deux.
CREATE INDEX IF NOT EXISTS prescriptions_patient
    ON app.prescriptions (patient_id, prescribed_at DESC);

-- ---------------------------------------------------------------------------
-- 3 · L'espace de travail — un écran, un appel
-- ---------------------------------------------------------------------------
-- Contrat de sortie EXPLICITE, colonne par colonne. Jamais `to_jsonb(p.*)` :
-- `cabinet_id`, `practitioner_id`, `created_by`, `created_at`, `updated_at`
-- ne sortent pas d'ici. Une sérialisation en bloc exposerait demain toute
-- colonne ajoutée à la table, sans que personne ne l'ait décidé.
--
-- `contrat` porte la version de forme : cette porte est la FAÇADE DE LECTURE
-- de Patients V2, un précurseur du Digital Twin canonique — pas le Digital
-- Twin. Pas de projection d'événements, pas de vue matérialisée, pas de
-- cache : une agrégation à la lecture, bornée, sur les tables sources.
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
                 'kind',       c.kind,
                 'practitioner_name', pr.full_name)
          FROM app.consultations c
          LEFT JOIN app.profiles pr ON pr.id = c.practitioner_id
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

COMMENT ON FUNCTION app.get_patient_workspace(uuid) IS
  'Patients V2, PERF §3 : tout l''écran d''ouverture en UN appel. Contrat de '
  'sortie explicite (jamais to_jsonb), versionné par `contrat`. Façade de '
  'lecture, précurseur du Digital Twin canonique — pas le Digital Twin. '
  '`clinique`/`traitements` valent JSON null quand can_see_clinical() est '
  'faux, pour distinguer « pas le droit » de « rien à montrer » ; la RLS '
  'reste seule frontière de sécurité. Une trace `fiche` avant lecture, y '
  'compris hors périmètre. VOLATILE : elle écrit.';

REVOKE ALL     ON FUNCTION app.get_patient_workspace(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app.get_patient_workspace(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · La chronologie — huit sources, pagination KEYSET
-- ---------------------------------------------------------------------------
-- ⚠️ KEYSET, PAS `OFFSET`. Un OFFSET saute ou répète une ligne dès qu'un
-- événement s'insère entre deux pages — et pendant une consultation, il s'en
-- insère. Le curseur porte les DEUX composantes de l'ordre :
-- `(occurred_at, event_id) < (p_before_at, p_before_id)`, comparaison de
-- tuples. `occurred_at` seul ne suffirait pas : deux événements peuvent
-- partager l'horodatage à la microseconde près, et la page en perdrait un.
--
-- ⚠️ `detail` NE PORTE AUCUN TEXTE CLINIQUE LIBRE. Ni subjective, objective,
-- assessment, plan (008), ni raw_notes (007), ni prescriptions.notes, ni
-- prescription_lines.free_text, ni appointments.notes_admin. Uniquement des
-- identifiants, des codes, des dates, des scores et des libellés de
-- RÉFÉRENCE. Un flux d'événements est précisément l'endroit où le contenu
-- d'une note fuit par inadvertance, dans un libellé « générique » que
-- personne ne relit — le checkpoint le vérifie ligne à ligne.
--
-- `label_key` est une clé FERMÉE, résolue en français par i18n/fr.ts. La base
-- ne fabrique pas de phrase : elle nomme un type d'événement.
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
           jsonb_build_object('status', c.status, 'kind', c.kind) AS detail
      FROM app.consultations c
      LEFT JOIN app.profiles pr ON pr.id = c.practitioner_id
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

COMMENT ON FUNCTION app.list_patient_timeline(uuid, timestamptz, uuid, integer) IS
  'Patients V2 : chronologie longitudinale, huit sources fusionnées. '
  'Pagination KEYSET sur (occurred_at, event_id) — stable pendant '
  'l''insertion, contrairement à OFFSET. `detail` ne porte aucun texte '
  'clinique libre (ni SOAP, ni raw_notes, ni free_text) et `label_key` est '
  'une clé fermée résolue par i18n. Bornée à 50 en base. Une trace `liste` '
  'par appel. VOLATILE : elle écrit.';

REVOKE ALL ON FUNCTION app.list_patient_timeline(uuid, timestamptz, uuid, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_patient_timeline(uuid, timestamptz, uuid, integer)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 5 · Refermer
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('047_patients_workspace')
  ON CONFLICT DO NOTHING;

COMMIT;
