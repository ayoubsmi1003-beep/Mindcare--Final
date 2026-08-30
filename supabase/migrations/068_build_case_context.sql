-- ═══════════════════════════════════════════════════════════════════════════
-- 068_build_case_context — LE CONTEXTE LONGITUDINAL, ASSEMBLÉ EN BASE.
--
-- ═══ LE PROBLÈME QUE CETTE PORTE RÉSOUT ═══
-- Une patiente suivie trois ans a 36 séances. Les envoyer toutes au modèle,
-- c'est faire exploser le contexte, payer cher, et noyer l'essentiel dans le
-- détail. Les tronquer aux dernières, c'est perdre le diagnostic posé en 2024
-- et le traitement arrêté en 2025 — précisément ce qu'un résumé de cas doit
-- porter.
--
-- La sortie de cette porte est donc STRATIFIÉE, et son volume est BORNÉ quel
-- que soit l'âge du dossier :
--
--   socle        ce qui est vrai aujourd'hui — identité, âge, résidence,
--                diagnostics, traitement documenté, trajectoires d'échelles.
--                DÉTERMINISTE : aucun modèle ne l'écrit, donc rien ne s'y
--                invente. C'est l'aperçu qu'on lit en premier.
--   recentes     les 6 dernières séances, avec un EXTRAIT de note et l'analyse
--                déjà persistée (067) quand elle existe.
--   anterieures  tout le reste, AGRÉGÉ PAR ANNÉE : combien de séances, quels
--                diagnostics posés, combien de prescriptions, l'amplitude des
--                échelles, et les identifiants pour y revenir.
--
-- Un dossier de dix ans coûte donc le même contexte qu'un dossier d'un an :
-- seule la liste `anterieures` s'allonge, d'une ligne par année.
--
-- ═══ CE QUI EST DÉLIBÉRÉMENT ABSENT ═══
-- · Aucune note brute intégrale : `notes_extrait` est TRONQUÉ EN BASE. Le
--   client ne peut pas demander plus — une troncature côté appelant serait un
--   export déguisé.
-- · Aucun jugement : la porte compte, date et cite. Elle ne qualifie pas une
--   évolution ; c'est au modèle de décrire, et à la praticienne de juger.
--
-- ═══ SÉCURITÉ ═══
-- Même modèle que 047 : SECURITY DEFINER, trace `fiche` écrite AVANT lecture,
-- RLS de l'appelant sur `app.patients`, et `app.can_see_clinical` décide de
-- tout le contenu clinique. Hors droit clinique, `socle`, `recentes` et
-- `anterieures` valent `null` — et l'appelant distingue « pas le droit » de
-- « rien à montrer », comme partout ailleurs.
--
-- `ids_autorises` accompagne la charge pour que la validation des citations
-- soit vérifiable des DEUX côtés : la passerelle filtre, la base revalide.
--
-- ⚠️ RÈGLE 9 : aucune migration appliquée n'est retouchée.
--
-- Retour arrière : DROP FUNCTION app.build_case_context(uuid);
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE OR REPLACE FUNCTION app.build_case_context(
    p_id            uuid,
    p_recentes      integer DEFAULT 6,
    p_extrait_max   integer DEFAULT 600)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_pat        app.patients%ROWTYPE;
  v_clinique   boolean;
  v_recentes   integer := least(greatest(coalesce(p_recentes, 6), 1), 12);
  v_extrait    integer := least(greatest(coalesce(p_extrait_max, 600), 100), 2000);
  v_resultat   jsonb;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Trace AVANT la lecture, même transaction (I4, motif 020/047).
  PERFORM audit.log_read(p_id, 'fiche');

  SELECT * INTO v_pat FROM app.patients WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_clinique := app.can_see_clinical(v_pat.practitioner_id);

  SELECT jsonb_build_object(
    'contrat',  1,
    'genere_a', now(),

    -- ─────────────────────────────────────────────────────────────────────
    -- SOCLE — l'aperçu, déterministe, jamais écrit par un modèle
    -- ─────────────────────────────────────────────────────────────────────
    'socle', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE jsonb_build_object(

      'identite', jsonb_build_object(
        'first_name',    v_pat.first_name,
        'last_name',     v_pat.last_name,
        'record_number', v_pat.record_number,
        'sex',           v_pat.sex,
        'birth_date',    v_pat.birth_date,
        -- Calculé sur l'horloge du SERVEUR, jamais celle du poste (motif 066).
        'age',           CASE WHEN v_pat.birth_date IS NULL THEN NULL
                              ELSE extract(year FROM age(v_pat.birth_date))::int END),

      -- La résidence fait partie de l'aperçu clinique demandé. Elle vit dans
      -- `contact` du workspace ; ici elle est remontée au socle parce que
      -- c'est un élément de contexte stable, pas une coordonnée d'appel.
      'residence', v_pat.address,

      -- Actifs d'abord : un diagnostic résolu appartient à l'histoire, pas à
      -- l'état présent. Les deux sont rendus, l'ordre les distingue.
      'diagnostics', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id',          d.id,
                 'code',        d.code,
                 'label',       d.label,
                 'is_primary',  d.is_primary,
                 'onset_date',  d.onset_date,
                 'resolved_at', d.resolved_at)
               ORDER BY (d.resolved_at IS NOT NULL), d.is_primary DESC,
                        d.onset_date DESC NULLS LAST)
          FROM app.diagnoses d WHERE d.patient_id = p_id), '[]'::jsonb),

      -- LE TRAITEMENT DOCUMENTÉ = la dernière ordonnance, lignes comprises.
      -- « Documenté » et non « en cours » : la base sait ce qui a été
      -- prescrit, elle ne sait pas ce qui est pris. Le mot compte.
      'traitement_documente', (
        SELECT jsonb_build_object(
                 'prescription_id', x.id,
                 'prescribed_at',   x.prescribed_at,
                 'lignes', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'medicament', COALESCE(m.inn, l.free_text),
                            'dose',       l.dose,
                            'frequence',  l.frequency_per_day,
                            'duree_jours', l.duration_days)
                          ORDER BY l.position)
                     FROM app.prescription_lines l
                     LEFT JOIN app.medications m ON m.id = l.medication_id
                    WHERE l.prescription_id = x.id), '[]'::jsonb))
          FROM app.prescriptions x
         WHERE x.patient_id = p_id
         ORDER BY x.prescribed_at DESC LIMIT 1),

      -- TRAJECTOIRE, pas dernière valeur : trois points datés par échelle.
      -- Une mesure isolée ne dit rien d'une évolution ; trois la dessinent.
      'echelles', COALESCE((
        SELECT jsonb_agg(t.bloc ORDER BY t.scale_name)
          FROM (
            SELECT s.name_fr AS scale_name,
                   jsonb_build_object(
                     'scale_name', s.name_fr,
                     'points', COALESCE((
                       SELECT jsonb_agg(jsonb_build_object(
                                'id',    a2.id,
                                'date',  a2.administered_at,
                                'score', a2.total_score)
                              ORDER BY a2.administered_at DESC)
                         FROM (SELECT a3.* FROM app.scale_administrations a3
                                WHERE a3.patient_id = p_id AND a3.scale_id = s.id
                                ORDER BY a3.administered_at DESC LIMIT 3) a2), '[]'::jsonb)
                   ) AS bloc
              FROM app.scales s
             WHERE EXISTS (SELECT 1 FROM app.scale_administrations a
                            WHERE a.patient_id = p_id AND a.scale_id = s.id)
          ) t), '[]'::jsonb)
    ) END,

    -- ─────────────────────────────────────────────────────────────────────
    -- RÉCENTES — détaillées, avec l'analyse déjà persistée quand elle existe
    -- ─────────────────────────────────────────────────────────────────────
    'recentes', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'consultation_id', c.id,
               'started_at',      c.started_at,
               'statut',          c.status,
               -- Extrait TRONQUÉ EN BASE. `…` dit la coupure : un extrait qui
               -- se présente comme entier ferait conclure sur ce qui manque.
               'notes_extrait',
                 CASE WHEN c.raw_notes IS NULL THEN NULL
                      WHEN length(c.raw_notes) <= v_extrait THEN c.raw_notes
                      ELSE left(c.raw_notes, v_extrait) || '…' END,
               'analyse', (
                 SELECT jsonb_build_object(
                          'evaluation', a.content -> 'noteStructuree' ->> 'assessment',
                          'plan',       a.content -> 'noteStructuree' ->> 'plan',
                          'evolution',  COALESCE(a.content -> 'evolution', '[]'::jsonb))
                   FROM app.consultation_analyses a
                  WHERE a.consultation_id = c.id
                  ORDER BY a.version DESC LIMIT 1))
             ORDER BY c.started_at DESC)
        FROM (SELECT c2.* FROM app.consultations c2
               WHERE c2.patient_id = p_id
               ORDER BY c2.started_at DESC LIMIT v_recentes) c), '[]'::jsonb) END,

    -- ─────────────────────────────────────────────────────────────────────
    -- ANTÉRIEURES — une ligne PAR ANNÉE, pour que le volume reste borné
    -- ─────────────────────────────────────────────────────────────────────
    -- Les bornes d'année se calculent en `Africa/Algiers` : en UTC, une séance
    -- du 1er janvier au matin bascule sur l'année précédente une heure par nuit.
    'anterieures', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'annee',            g.annee,
               'seances',          g.seances,
               'consultation_ids', g.ids,
               'debut',            g.debut,
               'fin',              g.fin,
               'diagnostics_poses', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label)
                        ORDER BY d.onset_date)
                   FROM app.diagnoses d
                  WHERE d.patient_id = p_id
                    AND extract(year FROM (d.onset_date))::int = g.annee), '[]'::jsonb),
               'prescriptions', (
                 SELECT count(*) FROM app.prescriptions x
                  WHERE x.patient_id = p_id
                    AND extract(year FROM (x.prescribed_at AT TIME ZONE 'Africa/Algiers'))::int = g.annee),
               'echelles_amplitude', (
                 SELECT jsonb_build_object('min', min(a.total_score), 'max', max(a.total_score))
                   FROM app.scale_administrations a
                  WHERE a.patient_id = p_id
                    AND extract(year FROM (a.administered_at AT TIME ZONE 'Africa/Algiers'))::int = g.annee))
             ORDER BY g.annee DESC)
        FROM (
          SELECT extract(year FROM (c.started_at AT TIME ZONE 'Africa/Algiers'))::int AS annee,
                 count(*)                                   AS seances,
                 jsonb_agg(c.id ORDER BY c.started_at DESC)  AS ids,
                 min(c.started_at)                           AS debut,
                 max(c.started_at)                           AS fin
            FROM app.consultations c
           WHERE c.patient_id = p_id
             AND c.id NOT IN (SELECT c2.id FROM app.consultations c2
                               WHERE c2.patient_id = p_id
                               ORDER BY c2.started_at DESC LIMIT v_recentes)
           GROUP BY 1
        ) g), '[]'::jsonb) END,

    -- ─────────────────────────────────────────────────────────────────────
    -- IDS AUTORISÉS — la liste exhaustive des références citables
    -- ─────────────────────────────────────────────────────────────────────
    'ids_autorises', CASE WHEN NOT v_clinique THEN '[]'::jsonb ELSE (
      SELECT COALESCE(jsonb_agg(DISTINCT x.id), '[]'::jsonb) FROM (
        SELECT d.id FROM app.diagnoses d WHERE d.patient_id = p_id
        UNION ALL SELECT a.id FROM app.scale_administrations a WHERE a.patient_id = p_id
        UNION ALL SELECT x2.id FROM app.prescriptions x2 WHERE x2.patient_id = p_id
        UNION ALL SELECT c.id FROM app.consultations c WHERE c.patient_id = p_id
        UNION ALL SELECT r.id FROM app.appointments r WHERE r.patient_id = p_id
      ) x) END
  ) INTO v_resultat;

  RETURN v_resultat;
END;
$$;

ALTER FUNCTION app.build_case_context(uuid, integer, integer) OWNER TO app_gatekeeper;
REVOKE ALL     ON FUNCTION app.build_case_context(uuid, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app.build_case_context(uuid, integer, integer) TO authenticated;

COMMENT ON FUNCTION app.build_case_context(uuid, integer, integer) IS
  'Contexte longitudinal stratifié pour le résumé du cas : socle déterministe, '
  'séances récentes détaillées, années antérieures agrégées. Volume borné quel '
  'que soit l''âge du dossier. Extraits de notes tronqués EN BASE.';

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('068_build_case_context')
  ON CONFLICT DO NOTHING;

COMMIT;
