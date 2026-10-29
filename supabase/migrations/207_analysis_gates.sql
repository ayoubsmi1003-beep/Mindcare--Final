-- 207_analysis_gates — les portes de l'écran Statistiques.
--
-- DEUX portes, toutes deux en LECTURE SEULE :
--   · `app.get_analysis_overview(from, to)`  — un seul appel pour tout l'écran
--     (06-PERF-BUDGET §3 : un écran = un appel serveur) ;
--   · `app.get_analysis_drilldown(kind, clé, from, to, offset, limit)` — le
--     détail nominatif, appelé UNIQUEMENT sur un clic.
--
-- ⚠️ AUCUNE TABLE, AUCUNE COLONNE, AUCUN TYPE, AUCUNE VALEUR D'ENUM N'EST CRÉÉ.
-- Règle 9 de CLAUDE.md : le schéma ne bouge pas pour nourrir un graphique.
--
-- ⚠️ AUCUNE ARITHMÉTIQUE MÉTIER CÔTÉ NAVIGATEUR. Tous les comptes, toutes les
-- parts et toutes les fenêtres de comparaison sont calculés ici. Le service
-- TypeScript VALIDE et RENOMME, il ne divise pas (même contrat que
-- `finance-cash.ts`).
--
-- ⚠️ PÉRIMÈTRE. La RLS décide (règle 4) ; le filtre explicite ci-dessous redit
-- la même règle en clair, pour qu'elle soit LISIBLE là où elle est appliquée —
-- exactement comme 039 §2 le fait pour l'argent. `owner` voit le cabinet,
-- `practitioner` voit ses lignes, tout autre rôle reçoit `NULL` (pas une erreur :
-- une erreur apprendrait qu'il y a un chiffre à ne pas voir, ADR-003).
--
-- ⚠️ BORNES. `Africa/Algiers`, converties en CONSTANTES avant les `WHERE` :
-- `created_at::date = p_day` transformerait la colonne et écarterait les index.
--
-- ⚠️ TROUS ET ZÉROS NE SONT PAS LA MÊME CHOSE. Un seau AVANT la première
-- activité connue rend `couvert = false` : l'écran n'y dessine rien. Un seau
-- dans la couverture rend `0`, qui est une mesure. Confondre les deux ferait
-- dessiner une chute à zéro là où l'on n'a simplement pas de données.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0 · Le socle commun : les comptes de flux des DEUX fenêtres
-- ---------------------------------------------------------------------------
-- ⚠️ UNE SEULE LECTURE PAR TABLE POUR LES DEUX FENÊTRES, ET CE N'EST PAS DE
-- L'ÉLÉGANCE. `app.current_cabinet()` lit `app.profiles`, et il est appelé PAR
-- LIGNE par la policy RLS : mesuré à ~90 ms pour une seule fenêtre de 30 jours
-- sur 7 500 séances. Dix sous-requêtes par fenêtre, deux fenêtres = vingt
-- balayages = ~4 s, au-delà du `statement_timeout` de 15 s sur une période
-- annuelle. Les agrégats `FILTER` ci-dessous ramènent l'ensemble à six
-- balayages, pour les deux fenêtres à la fois.
CREATE OR REPLACE FUNCTION app.analysis_flow(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $fn$
DECLARE
  v_role  app.user_role := app.current_role();
  v_cab   uuid;
  v_uid   uuid;
  v_jours integer;
  v_debut timestamptz;
  v_fin   timestamptz;
  v_pdeb  timestamptz;
  v_c     jsonb := '{}'::jsonb;
  v_p     jsonb := '{}'::jsonb;
  v_morceau_c jsonb;
  v_morceau_p jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RETURN NULL;
  END IF;

  v_cab := app.current_cabinet();
  v_uid := auth.uid();
  v_jours := (p_to - p_from) + 1;
  v_debut := p_from::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin   := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Algiers';
  v_pdeb  := (p_from - v_jours)::timestamp AT TIME ZONE 'Africa/Algiers';

  -- 1 · Séances, dossiers vus, retours, notes manquantes — deux fenêtres.
  WITH cons AS MATERIALIZED (
    SELECT c.id, c.patient_id, c.started_at, c.status,
           p.created_at AS cree,
           (c.started_at >= v_debut) AS courant
      FROM app.consultations c
      LEFT JOIN app.patients p ON p.id = c.patient_id
     WHERE c.cabinet_id = v_cab
       AND (v_role = 'owner' OR c.practitioner_id = v_uid)
       AND c.started_at >= v_pdeb AND c.started_at < v_fin
  ),
  manquantes AS MATERIALIZED (
    SELECT c.id FROM cons c
     WHERE c.status = 'closed'
       AND NOT EXISTS (SELECT 1 FROM app.clinical_notes n
                        WHERE n.consultation_id = c.id AND n.status = 'signed')
  )
  SELECT
    jsonb_build_object(
      'seances',         count(*) FILTER (WHERE courant AND status = 'closed'),
      'patientes_vues',  count(DISTINCT patient_id) FILTER (WHERE courant AND status = 'closed'),
      'retours',         count(DISTINCT patient_id) FILTER (WHERE courant AND status = 'closed' AND cree < v_debut),
      'notes_manquantes', count(*) FILTER (WHERE courant AND status = 'closed' AND id IN (SELECT id FROM manquantes))),
    jsonb_build_object(
      'seances',         count(*) FILTER (WHERE NOT courant AND status = 'closed'),
      'patientes_vues',  count(DISTINCT patient_id) FILTER (WHERE NOT courant AND status = 'closed'),
      'retours',         count(DISTINCT patient_id) FILTER (WHERE NOT courant AND status = 'closed' AND cree < v_pdeb),
      'notes_manquantes', count(*) FILTER (WHERE NOT courant AND status = 'closed' AND id IN (SELECT id FROM manquantes)))
    INTO v_morceau_c, v_morceau_p
    FROM cons;
  v_c := v_c || v_morceau_c;
  v_p := v_p || v_morceau_p;

  -- 2 · Absences et annulations.
  WITH rdv AS MATERIALIZED (
    SELECT a.status, (a.starts_at >= v_debut) AS courant
      FROM app.appointments a
     WHERE a.cabinet_id = v_cab
       AND (v_role = 'owner' OR a.practitioner_id = v_uid)
       AND a.starts_at >= v_pdeb AND a.starts_at < v_fin
  )
  SELECT
    jsonb_build_object(
      'absences',    count(*) FILTER (WHERE courant AND status = 'no_show'),
      'annulations', count(*) FILTER (WHERE courant AND status = 'cancelled')),
    jsonb_build_object(
      'absences',    count(*) FILTER (WHERE NOT courant AND status = 'no_show'),
      'annulations', count(*) FILTER (WHERE NOT courant AND status = 'cancelled'))
    INTO v_morceau_c, v_morceau_p
    FROM rdv;
  v_c := v_c || v_morceau_c;
  v_p := v_p || v_morceau_p;

  -- 3 · Notes signées.
  WITH notes AS MATERIALIZED (
    SELECT n.signed_at, (n.signed_at >= v_debut) AS courant
      FROM app.clinical_notes n
     WHERE n.cabinet_id = v_cab
       AND (v_role = 'owner' OR n.practitioner_id = v_uid)
       AND n.status = 'signed'
       AND n.signed_at >= v_pdeb AND n.signed_at < v_fin
  )
  SELECT
    jsonb_build_object('notes_signees', count(*) FILTER (WHERE courant)),
    jsonb_build_object('notes_signees', count(*) FILTER (WHERE NOT courant))
    INTO v_morceau_c, v_morceau_p
    FROM notes;
  v_c := v_c || v_morceau_c;
  v_p := v_p || v_morceau_p;

  -- 4 · Nouveaux dossiers.
  WITH pats AS MATERIALIZED (
    SELECT p.created_at, (p.created_at >= v_debut) AS courant
      FROM app.patients p
     WHERE p.cabinet_id = v_cab
       AND (v_role = 'owner' OR p.practitioner_id = v_uid)
       AND p.created_at >= v_pdeb AND p.created_at < v_fin
  )
  SELECT
    jsonb_build_object('nouveaux', count(*) FILTER (WHERE courant)),
    jsonb_build_object('nouveaux', count(*) FILTER (WHERE NOT courant))
    INTO v_morceau_c, v_morceau_p
    FROM pats;
  v_c := v_c || v_morceau_c;
  v_p := v_p || v_morceau_p;

  -- 5 · Échelles administrées.
  WITH ech AS MATERIALIZED (
    SELECT s.administered_at, (s.administered_at >= v_debut) AS courant
      FROM app.scale_administrations s
     WHERE s.cabinet_id = v_cab
       AND (v_role = 'owner' OR s.practitioner_id = v_uid)
       AND s.administered_at >= v_pdeb AND s.administered_at < v_fin
  )
  SELECT
    jsonb_build_object('echelles', count(*) FILTER (WHERE courant)),
    jsonb_build_object('echelles', count(*) FILTER (WHERE NOT courant))
    INTO v_morceau_c, v_morceau_p
    FROM ech;
  v_c := v_c || v_morceau_c;
  v_p := v_p || v_morceau_p;

  -- 6 · Changements de traitement.
  WITH hist AS MATERIALIZED (
    SELECT h.occurred_at, (h.occurred_at >= v_debut) AS courant
      FROM app.patient_treatment_history h
      JOIN app.patient_treatments t ON t.id = h.treatment_id
     WHERE t.cabinet_id = v_cab
       AND (v_role = 'owner' OR t.practitioner_id = v_uid)
       AND h.occurred_at >= v_pdeb AND h.occurred_at < v_fin
  )
  SELECT
    jsonb_build_object('changements_traitement', count(*) FILTER (WHERE courant)),
    jsonb_build_object('changements_traitement', count(*) FILTER (WHERE NOT courant))
    INTO v_morceau_c, v_morceau_p
    FROM hist;
  v_c := v_c || v_morceau_c;
  v_p := v_p || v_morceau_p;

  RETURN jsonb_build_object('courant', v_c, 'precedent', v_p);
END
$fn$;

ALTER FUNCTION app.analysis_flow(date, date) OWNER TO app_gatekeeper;
COMMENT ON FUNCTION app.analysis_flow(date, date) IS
  'Comptes de flux de la période ET de la fenêtre précédente de même durée, '
  'en six balayages. Aucune donnée nominative. Interne : REVOKE ci-dessous.';

REVOKE ALL ON FUNCTION app.analysis_flow(date, date) FROM PUBLIC;


-- ---------------------------------------------------------------------------
-- 1 · L'aperçu — UN SEUL APPEL POUR TOUT L'ÉCRAN
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.get_analysis_overview(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $fn$
DECLARE
  v_role      app.user_role;
  v_jours     integer;
  v_debut     timestamptz;
  v_fin       timestamptz;
  v_prev_from date;
  v_pas       interval;
  v_grain     text;
  v_unite     text;
  v_cab       uuid;
  v_uid       uuid;
  v_premiere  timestamptz;
  v_derniere  timestamptz;
  v_courant   jsonb;
  v_flux      jsonb;
  v_precedent jsonb;
  v_serie     jsonb;
  v_statuts   jsonb;
  v_types     jsonb;
  v_jours_sem jsonb;
  v_heures    jsonb;
  v_delais    jsonb;
  v_diag      jsonb;
  v_echelles  jsonb;
  v_encaisse  jsonb;
  v_rdv_futur bigint;
  v_non_clos  bigint;
  v_notes_mq  bigint;
  v_total_pat bigint;
  v_suivis    bigint;
  v_ttt       bigint;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'Période inversée : la fin précède le début.'
      USING ERRCODE = '22023';
  END IF;
  IF (p_to - p_from) > 365 THEN
    RAISE EXCEPTION 'Période trop large.'
      USING ERRCODE = '22023',
            HINT = 'Au plus 366 jours — au-delà, l''écran cesse d''être lisible.';
  END IF;

  v_role := app.current_role();
  IF v_role NOT IN ('owner', 'practitioner') THEN
    RETURN NULL;
  END IF;

  -- ⚠️ FIGÉ UNE FOIS. `app.current_cabinet()` lit `app.profiles` ; appelée dans
  -- un `WHERE`, elle est évaluée PAR LIGNE (84 ms mesurés pour une semaine sur
  -- 7 500 séances, contre 2 ms ici).
  v_cab := app.current_cabinet();
  v_uid := auth.uid();

  v_jours   := (p_to - p_from) + 1;
  v_debut   := p_from::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin     := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Algiers';
  v_prev_from := p_from - v_jours;

  -- La couverture réelle du dossier, en UNE lecture : elle sert au drapeau
  -- `couvert` de la série ET au panneau de méthode.
  SELECT min(c.started_at), max(c.started_at)
    INTO v_premiere, v_derniere
    FROM app.consultations c
   WHERE c.cabinet_id = v_cab
     AND (v_role = 'owner' OR c.practitioner_id = v_uid);

  -- Granularité des seaux. Décidée ici pour que deux écrans ne découpent pas
  -- la même période de deux façons.
  IF v_jours <= 62 THEN
    v_grain := 'jour';
    v_unite := 'day';
    v_pas   := interval '1 day';
  ELSIF v_jours <= 740 THEN
    v_grain := 'semaine';
    v_unite := 'week';
    v_pas   := interval '1 week';
  ELSE
    v_grain := 'mois';
    v_unite := 'month';
    v_pas   := interval '1 month';
  END IF;

  v_flux      := app.analysis_flow(p_from, p_to);
  v_courant   := v_flux->'courant';
  v_precedent := v_flux->'precedent';

  -- ── La série temporelle ────────────────────────────────────────────────
  -- Seaux vides CONSERVÉS : une semaine sans séance est une mesure, pas un
  -- trou. `couvert` distingue « zéro » de « avant les premières données ».
  --
  -- ⚠️ UN SEUL PASSAGE PAR TABLE, PUIS UNE JOINTURE. La première version
  -- comptait chaque seau par trois sous-requêtes corrélées : 52 seaux × 84 ms
  -- = 4,4 s pour la seule courbe, et l'écran dépassait le `statement_timeout`
  -- de 15 s. Les agrégats ci-dessous lisent la fenêtre une fois.
  WITH bornes AS (
    SELECT gs::date AS cle,
           gs::timestamp AT TIME ZONE 'Africa/Algiers' AS debut
      FROM generate_series(
             CASE v_grain
               WHEN 'mois'    THEN date_trunc('month', p_from::timestamp)
               WHEN 'semaine' THEN date_trunc('week',  p_from::timestamp)
               ELSE p_from::timestamp
             END,
             p_to::timestamp,
             v_pas) AS gs
  ),
  seances AS (
    SELECT date_trunc(v_unite, c.started_at AT TIME ZONE 'Africa/Algiers')::date AS cle,
           count(*) AS n
      FROM app.consultations c
     WHERE c.cabinet_id = v_cab
       AND (v_role = 'owner' OR c.practitioner_id = v_uid)
       AND c.status = 'closed'
       AND c.started_at >= v_debut AND c.started_at < v_fin
     GROUP BY 1
  ),
  nouveaux AS (
    SELECT date_trunc(v_unite, p.created_at AT TIME ZONE 'Africa/Algiers')::date AS cle,
           count(*) AS n
      FROM app.patients p
     WHERE p.cabinet_id = v_cab
       AND (v_role = 'owner' OR p.practitioner_id = v_uid)
       AND p.created_at >= v_debut AND p.created_at < v_fin
     GROUP BY 1
  ),
  absences AS (
    SELECT date_trunc(v_unite, a.starts_at AT TIME ZONE 'Africa/Algiers')::date AS cle,
           count(*) AS n
      FROM app.appointments a
     WHERE a.cabinet_id = v_cab
       AND (v_role = 'owner' OR a.practitioner_id = v_uid)
       AND a.status = 'no_show'
       AND a.starts_at >= v_debut AND a.starts_at < v_fin
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'cle',     to_char(b.cle, 'YYYY-MM-DD'),
           'seances', COALESCE(s.n, 0),
           'nouveaux', COALESCE(n.n, 0),
           'absences', COALESCE(a.n, 0),
           'couvert', b.debut >= COALESCE(v_premiere, v_debut)
         ) ORDER BY b.cle), '[]'::jsonb)
    INTO v_serie
    FROM bornes b
    LEFT JOIN seances s  ON s.cle = b.cle
    LEFT JOIN nouveaux n ON n.cle = b.cle
    LEFT JOIN absences a ON a.cle = b.cle;

  -- ── Statuts, types, rythme ─────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object('cle', s.statut, 'n', s.n) ORDER BY s.n DESC), '[]'::jsonb)
    INTO v_statuts
    FROM (SELECT a.status::text AS statut, count(*) AS n
            FROM app.appointments a
           WHERE a.cabinet_id = v_cab
             AND (v_role = 'owner' OR a.practitioner_id = v_uid)
             AND a.starts_at >= v_debut AND a.starts_at < v_fin
           GROUP BY a.status) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('cle', s.kind, 'n', s.n) ORDER BY s.n DESC), '[]'::jsonb)
    INTO v_types
    FROM (SELECT COALESCE(a.kind::text, 'non_renseigne') AS kind, count(*) AS n
            FROM app.appointments a
           WHERE a.cabinet_id = v_cab
             AND (v_role = 'owner' OR a.practitioner_id = v_uid)
             AND a.starts_at >= v_debut AND a.starts_at < v_fin
           GROUP BY 1) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('cle', s.jour::text, 'n', s.n) ORDER BY s.jour), '[]'::jsonb)
    INTO v_jours_sem
    FROM (SELECT EXTRACT(ISODOW FROM a.starts_at AT TIME ZONE 'Africa/Algiers')::int AS jour,
                 count(*) AS n
            FROM app.appointments a
           WHERE a.cabinet_id = v_cab
             AND (v_role = 'owner' OR a.practitioner_id = v_uid)
             AND a.starts_at >= v_debut AND a.starts_at < v_fin
           GROUP BY 1) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('cle', s.heure::text, 'n', s.n) ORDER BY s.heure), '[]'::jsonb)
    INTO v_heures
    FROM (SELECT EXTRACT(HOUR FROM a.starts_at AT TIME ZONE 'Africa/Algiers')::int AS heure,
                 count(*) AS n
            FROM app.appointments a
           WHERE a.cabinet_id = v_cab
             AND (v_role = 'owner' OR a.practitioner_id = v_uid)
             AND a.starts_at >= v_debut AND a.starts_at < v_fin
           GROUP BY 1) s;

  -- Délai entre deux séances consécutives D'UN MÊME DOSSIER. `lag` sur les
  -- séances closes : une annulation ne crée pas un intervalle de suivi.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('cle', s.cle, 'n', s.n) ORDER BY s.ordre), '[]'::jsonb)
    INTO v_delais
    FROM (
      SELECT b.cle, b.ordre, count(*) AS n
        FROM (
          SELECT CASE
                   WHEN d <= 7   THEN '0-7'
                   WHEN d <= 30  THEN '8-30'
                   WHEN d <= 90  THEN '31-90'
                   WHEN d <= 180 THEN '91-180'
                   ELSE '181+'
                 END AS cle,
                 CASE
                   WHEN d <= 7   THEN 1
                   WHEN d <= 30  THEN 2
                   WHEN d <= 90  THEN 3
                   WHEN d <= 180 THEN 4
                   ELSE 5
                 END AS ordre
            FROM (
              SELECT (c.started_at AT TIME ZONE 'Africa/Algiers')::date
                     - (lag(c.started_at) OVER (PARTITION BY c.patient_id ORDER BY c.started_at)
                        AT TIME ZONE 'Africa/Algiers')::date AS d
                FROM app.consultations c
               WHERE c.cabinet_id = v_cab
                 AND (v_role = 'owner' OR c.practitioner_id = v_uid)
                 AND c.status = 'closed'
                 AND c.started_at >= v_debut AND c.started_at < v_fin
            ) ecarts
           WHERE d IS NOT NULL
        ) b
       GROUP BY b.cle, b.ordre
    ) s;

  -- ── Diagnostics documentés ─────────────────────────────────────────────
  -- Le LIBELLÉ STOCKÉ, jamais normalisé ni traduit (exigence clinique).
  SELECT COALESCE(jsonb_agg(row_json ORDER BY actifs DESC, total DESC, libelle), '[]'::jsonb)
    INTO v_diag
    FROM (
      SELECT jsonb_build_object(
               'label', d.label,
               'code', d.code,
               'total', count(*),
               'actifs', count(*) FILTER (WHERE d.resolved_at IS NULL)) AS row_json,
             d.label AS libelle,
             count(*) FILTER (WHERE d.resolved_at IS NULL) AS actifs,
             count(*) AS total
        FROM app.diagnoses d
       WHERE d.cabinet_id = v_cab
         AND (v_role = 'owner' OR d.practitioner_id = v_uid)
       GROUP BY d.label, d.code
       ORDER BY actifs DESC, total DESC
       LIMIT 12
    ) q;

  -- ── Échelles : distribution de TOUTES les mesures, et des DERNIÈRES ────
  -- Deux questions différentes. « Toutes » décrit la charge ; « dernières »
  -- décrit l'état le plus récent par dossier. Aucune moyenne n'est publiée :
  -- une moyenne de scores n'a pas de sens clinique ici.
  WITH mesures AS (
    SELECT s.id, s.patient_id, sc.code, s.total_score, s.interpretation, s.administered_at
      FROM app.scale_administrations s
      JOIN app.scales sc ON sc.id = s.scale_id
     WHERE s.cabinet_id = v_cab
       AND (v_role = 'owner' OR s.practitioner_id = v_uid)
       AND s.administered_at >= v_debut AND s.administered_at < v_fin
  ),
  dernieres AS (
    SELECT DISTINCT ON (m.patient_id, m.code) m.*
      FROM mesures m
     ORDER BY m.patient_id, m.code, m.administered_at DESC
  )
  SELECT COALESCE(jsonb_agg(e.row_json ORDER BY e.code), '[]'::jsonb)
    INTO v_echelles
    FROM (
      SELECT sc.code,
             jsonb_build_object(
               'code', sc.code,
               'nom', sc.name_fr,
               'n', (SELECT count(*) FROM mesures m WHERE m.code = sc.code),
               'patientes', (SELECT count(DISTINCT m.patient_id) FROM mesures m WHERE m.code = sc.code),
               'bandes', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('cle', b.interpretation, 'n', b.n) ORDER BY b.n DESC)
                   FROM (SELECT m.interpretation, count(*) AS n
                           FROM mesures m WHERE m.code = sc.code
                          GROUP BY 1) b), '[]'::jsonb),
               'derniers', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('cle', d.interpretation, 'n', d.n) ORDER BY d.n DESC)
                   FROM (SELECT dl.interpretation, count(*) AS n
                           FROM dernieres dl WHERE dl.code = sc.code
                          GROUP BY 1) d), '[]'::jsonb),
               'repetes', (
                 SELECT count(*) FROM (
                   SELECT m.patient_id FROM mesures m
                    WHERE m.code = sc.code
                    GROUP BY m.patient_id HAVING count(*) > 1) r)
             ) AS row_json
        FROM (SELECT DISTINCT code, name_fr FROM app.scales WHERE code IN ('PHQ9','GAD7')) sc
    ) e;

  -- ── Les stocks et les états d'attention ────────────────────────────────
  SELECT count(*) INTO v_total_pat FROM app.patients p
   WHERE p.cabinet_id = v_cab
     AND (v_role = 'owner' OR p.practitioner_id = v_uid);

  SELECT count(DISTINCT c.patient_id) INTO v_suivis
    FROM app.consultations c
   WHERE c.cabinet_id = v_cab
     AND (v_role = 'owner' OR c.practitioner_id = v_uid)
     AND c.status = 'closed'
     AND c.started_at >= (v_fin - interval '365 days') AND c.started_at < v_fin;

  SELECT count(*) INTO v_rdv_futur FROM app.appointments a
   WHERE a.cabinet_id = v_cab
     AND (v_role = 'owner' OR a.practitioner_id = v_uid)
     AND a.status IN ('confirmed','requested')
     AND a.starts_at >= now();

  -- Un rendez-vous passé encore `confirmed`/`arrived` n'a jamais reçu sa
  -- transition. C'est un fait mesurable, pas un retard inventé.
  SELECT count(*) INTO v_non_clos FROM app.appointments a
   WHERE a.cabinet_id = v_cab
     AND (v_role = 'owner' OR a.practitioner_id = v_uid)
     AND a.status IN ('confirmed','arrived')
     AND a.starts_at < now();

  v_notes_mq := COALESCE((v_courant->>'notes_manquantes')::bigint, 0);

  SELECT count(*) INTO v_ttt FROM app.patient_treatments t
   WHERE t.cabinet_id = v_cab
     AND (v_role = 'owner' OR t.practitioner_id = v_uid)
     AND t.status = 'active';

  -- ── L'argent : UNE ligne, isolée, même règle que 039 ───────────────────
  -- Jamais mélangée aux indicateurs cliniques, jamais présentée comme une
  -- mesure de qualité. `null` = hors périmètre, jamais 0.
  IF v_role = 'owner' THEN
    SELECT jsonb_build_object(
             'montant', COALESCE(SUM(p.amount_dzd), 0)::bigint,
             'perimetre', 'cabinet')
      INTO v_encaisse
      FROM app.payments p
     WHERE p.cabinet_id = v_cab
       AND p.collected_at >= v_debut AND p.collected_at < v_fin;
  ELSE
    SELECT jsonb_build_object(
             'montant', COALESCE(SUM(p.amount_dzd), 0)::bigint,
             'perimetre', 'praticienne')
      INTO v_encaisse
      FROM app.payments p
     WHERE p.cabinet_id = v_cab
       AND p.practitioner_id = v_uid
       AND p.collected_at >= v_debut AND p.collected_at < v_fin;
  END IF;

  RETURN jsonb_build_object(
    'periode', jsonb_build_object(
      'du', p_from, 'au', p_to, 'jours', v_jours,
      'precedente_du', v_prev_from,
      'precedente_au', p_from - 1,
      'granularite', v_grain),
    'couverture', jsonb_build_object(
      'premiere_activite', v_premiere,
      'derniere_activite', v_derniere),
    'pulse', v_courant || jsonb_build_object(
      'patients_total', v_total_pat,
      'patients_suivis', v_suivis,
      'rdv_a_venir', v_rdv_futur,
      'rdv_non_clotures', v_non_clos,
      'traitements_actifs', v_ttt),
    'comparaison', v_precedent,
    'serie', v_serie,
    'statuts', v_statuts,
    'types', v_types,
    'jours_semaine', v_jours_sem,
    'heures', v_heures,
    'delais', v_delais,
    'diagnostics', v_diag,
    'echelles', v_echelles,
    'encaisse', v_encaisse
  );
END
$fn$;

ALTER FUNCTION app.get_analysis_overview(date, date) OWNER TO app_gatekeeper;
COMMENT ON FUNCTION app.get_analysis_overview(date, date) IS
  'Aperçu complet de l''écran Statistiques en un appel. Lecture seule, '
  'périmètre en base, bornes Africa/Algiers, NULL pour les rôles non cliniques.';

REVOKE ALL ON FUNCTION app.get_analysis_overview(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_analysis_overview(date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2 · Le détail nominatif — appelé SEULEMENT sur un clic
-- ---------------------------------------------------------------------------
-- ⚠️ C'EST ICI QUE LA LOI 18-07 S'APPLIQUE. Cette porte NOMME des patientes :
-- elle écrit donc `audit.log_read(NULL, 'liste')` AVANT de lire la première
-- ligne. Le contexte `liste` est celui du registre fermé de 017 — en inventer
-- un quatrième demanderait une migration dédiée, et n'apporterait rien.
CREATE OR REPLACE FUNCTION app.get_analysis_drilldown(
  p_kind   text,
  p_cle    text,
  p_from   date,
  p_to     date,
  p_offset integer DEFAULT 0,
  p_limit  integer DEFAULT 50,
  p_grain  text DEFAULT 'jour')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $fn$
DECLARE
  v_role  app.user_role := app.current_role();
  v_debut timestamptz;
  v_fin   timestamptz;
  v_cab   uuid;
  v_uid   uuid;
  v_total bigint := 0;
  v_json  jsonb;
BEGIN
  IF v_role NOT IN ('owner', 'practitioner') THEN
    RETURN NULL;
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RETURN NULL;
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RETURN NULL;
  END IF;
  -- Aucune clé libre n'atteint un `::date` : une entrée mal formée rend `NULL`,
  -- elle ne lève pas une erreur qui ressemblerait à une panne serveur.
  IF p_cle IS NOT NULL AND length(p_cle) > 120 THEN
    RETURN NULL;
  END IF;
  IF p_kind = 'serie' AND (p_cle IS NULL OR p_cle !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
    RETURN NULL;
  END IF;

  v_cab := app.current_cabinet();
  v_uid := auth.uid();

  v_debut := p_from::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin   := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Algiers';

  -- Trace AVANT toute lecture d'identité (ADR-019).
  PERFORM audit.log_read(NULL, 'liste');

  -- ── Séances closes ─────────────────────────────────────────────────────
  IF p_kind = 'seances' THEN
    SELECT count(*) INTO v_total FROM app.consultations c
     WHERE c.cabinet_id = v_cab
       AND (v_role = 'owner' OR c.practitioner_id = v_uid)
       AND c.status = 'closed'
       AND c.started_at >= v_debut AND c.started_at < v_fin;
    SELECT jsonb_build_object('total', v_total, 'lignes', COALESCE(jsonb_agg(l ORDER BY l->>'evenement_le' DESC), '[]'::jsonb))
      INTO v_json FROM (
        SELECT jsonb_build_object(
                 'patient_id', c.patient_id, 'nom', p.first_name || ' ' || p.last_name,
                 'numero', p.record_number, 'evenement_le', c.started_at,
                 'consultation_id', c.id, 'rendez_vous_id', c.appointment_id, 'valeur', NULL) AS l
          FROM app.consultations c JOIN app.patients p ON p.id = c.patient_id
         WHERE c.cabinet_id = v_cab
           AND (v_role = 'owner' OR c.practitioner_id = v_uid)
           AND c.status = 'closed'
           AND c.started_at >= v_debut AND c.started_at < v_fin
         ORDER BY c.started_at DESC OFFSET p_offset LIMIT p_limit) q;
    RETURN v_json;
  END IF;

  -- ── Patientes vues / retours ───────────────────────────────────────────
  IF p_kind IN ('patientes_vues', 'retours') THEN
    SELECT count(*) INTO v_total FROM (
      SELECT DISTINCT c.patient_id
        FROM app.consultations c JOIN app.patients p ON p.id = c.patient_id
       WHERE c.cabinet_id = v_cab
         AND (v_role = 'owner' OR c.practitioner_id = v_uid)
         AND c.status = 'closed'
         AND c.started_at >= v_debut AND c.started_at < v_fin
         AND (p_kind = 'patientes_vues' OR p.created_at < v_debut)) s;
    SELECT jsonb_build_object('total', v_total, 'lignes', COALESCE(jsonb_agg(l ORDER BY l->>'evenement_le' DESC), '[]'::jsonb))
      INTO v_json FROM (
        SELECT jsonb_build_object(
                 'patient_id', s.patient_id, 'nom', p.first_name || ' ' || p.last_name,
                 'numero', p.record_number, 'evenement_le', s.derniere,
                 'consultation_id', s.derniere_id, 'rendez_vous_id', NULL, 'valeur', s.n::text) AS l
          FROM (SELECT c.patient_id, max(c.started_at) AS derniere,
                       (array_agg(c.id ORDER BY c.started_at DESC))[1] AS derniere_id,
                       count(*) AS n
                  FROM app.consultations c
                 WHERE c.cabinet_id = v_cab
                   AND (v_role = 'owner' OR c.practitioner_id = v_uid)
                   AND c.status = 'closed'
                   AND c.started_at >= v_debut AND c.started_at < v_fin
                 GROUP BY c.patient_id) s
          JOIN app.patients p ON p.id = s.patient_id
         WHERE (p_kind = 'patientes_vues' OR p.created_at < v_debut)
         ORDER BY s.derniere DESC OFFSET p_offset LIMIT p_limit) q;
    RETURN v_json;
  END IF;

  -- ── Nouveaux dossiers ──────────────────────────────────────────────────
  IF p_kind = 'nouveaux' THEN
    SELECT count(*) INTO v_total FROM app.patients p
     WHERE p.cabinet_id = v_cab
       AND (v_role = 'owner' OR p.practitioner_id = v_uid)
       AND p.created_at >= v_debut AND p.created_at < v_fin;
    SELECT jsonb_build_object('total', v_total, 'lignes', COALESCE(jsonb_agg(l ORDER BY l->>'evenement_le' DESC), '[]'::jsonb))
      INTO v_json FROM (
        SELECT jsonb_build_object(
                 'patient_id', p.id, 'nom', p.first_name || ' ' || p.last_name,
                 'numero', p.record_number, 'evenement_le', p.created_at,
                 'consultation_id', NULL, 'rendez_vous_id', NULL, 'valeur', NULL) AS l
          FROM app.patients p
         WHERE p.cabinet_id = v_cab
           AND (v_role = 'owner' OR p.practitioner_id = v_uid)
           AND p.created_at >= v_debut AND p.created_at < v_fin
         ORDER BY p.created_at DESC OFFSET p_offset LIMIT p_limit) q;
    RETURN v_json;
  END IF;

  -- ── Rendez-vous : absences, annulations, à venir, non clôturés, statuts ─
  IF p_kind IN ('absences','annulations','rdv_a_venir','rdv_non_clotures','statuts','types',
                'jours_semaine','heures','serie_absences') THEN
    SELECT count(*) INTO v_total FROM app.appointments a
     WHERE a.cabinet_id = v_cab
       AND (v_role = 'owner' OR a.practitioner_id = v_uid)
       AND CASE p_kind
             WHEN 'absences'        THEN a.status = 'no_show' AND a.starts_at >= v_debut AND a.starts_at < v_fin
             WHEN 'annulations'     THEN a.status = 'cancelled' AND a.starts_at >= v_debut AND a.starts_at < v_fin
             WHEN 'rdv_a_venir'     THEN a.status IN ('confirmed','requested') AND a.starts_at >= now()
             WHEN 'rdv_non_clotures' THEN a.status IN ('confirmed','arrived') AND a.starts_at < now()
             WHEN 'statuts'         THEN a.status::text = p_cle AND a.starts_at >= v_debut AND a.starts_at < v_fin
             WHEN 'types'           THEN COALESCE(a.kind::text,'non_renseigne') = p_cle AND a.starts_at >= v_debut AND a.starts_at < v_fin
             WHEN 'jours_semaine'   THEN EXTRACT(ISODOW FROM a.starts_at AT TIME ZONE 'Africa/Algiers')::text = p_cle AND a.starts_at >= v_debut AND a.starts_at < v_fin
             WHEN 'heures'          THEN EXTRACT(HOUR FROM a.starts_at AT TIME ZONE 'Africa/Algiers')::text = p_cle AND a.starts_at >= v_debut AND a.starts_at < v_fin
             WHEN 'serie_absences'  THEN a.status = 'no_show' AND a.starts_at >= v_debut AND a.starts_at < v_fin
             ELSE false
           END;
    SELECT jsonb_build_object('total', v_total, 'lignes', COALESCE(jsonb_agg(l ORDER BY l->>'evenement_le' DESC), '[]'::jsonb))
      INTO v_json FROM (
        SELECT jsonb_build_object(
                 'patient_id', a.patient_id, 'nom', COALESCE(p.first_name || ' ' || p.last_name, '—'),
                 'numero', p.record_number, 'evenement_le', a.starts_at,
                 'consultation_id', NULL, 'rendez_vous_id', a.id,
                 'valeur', a.status::text) AS l
          FROM app.appointments a LEFT JOIN app.patients p ON p.id = a.patient_id
         WHERE a.cabinet_id = v_cab
           AND (v_role = 'owner' OR a.practitioner_id = v_uid)
           AND CASE p_kind
                 WHEN 'absences'        THEN a.status = 'no_show' AND a.starts_at >= v_debut AND a.starts_at < v_fin
                 WHEN 'annulations'     THEN a.status = 'cancelled' AND a.starts_at >= v_debut AND a.starts_at < v_fin
                 WHEN 'rdv_a_venir'     THEN a.status IN ('confirmed','requested') AND a.starts_at >= now()
                 WHEN 'rdv_non_clotures' THEN a.status IN ('confirmed','arrived') AND a.starts_at < now()
                 WHEN 'statuts'         THEN a.status::text = p_cle AND a.starts_at >= v_debut AND a.starts_at < v_fin
                 WHEN 'types'           THEN COALESCE(a.kind::text,'non_renseigne') = p_cle AND a.starts_at >= v_debut AND a.starts_at < v_fin
                 WHEN 'jours_semaine'   THEN EXTRACT(ISODOW FROM a.starts_at AT TIME ZONE 'Africa/Algiers')::text = p_cle AND a.starts_at >= v_debut AND a.starts_at < v_fin
                 WHEN 'heures'          THEN EXTRACT(HOUR FROM a.starts_at AT TIME ZONE 'Africa/Algiers')::text = p_cle AND a.starts_at >= v_debut AND a.starts_at < v_fin
                 WHEN 'serie_absences'  THEN a.status = 'no_show' AND a.starts_at >= v_debut AND a.starts_at < v_fin
                 ELSE false
               END
         ORDER BY a.starts_at DESC OFFSET p_offset LIMIT p_limit) q;
    RETURN v_json;
  END IF;

  -- ── Notes signées ──────────────────────────────────────────────────────
  IF p_kind = 'notes_signees' THEN
    SELECT count(*) INTO v_total FROM app.clinical_notes n
     WHERE n.cabinet_id = v_cab
       AND (v_role = 'owner' OR n.practitioner_id = v_uid)
       AND n.status = 'signed'
       AND n.signed_at >= v_debut AND n.signed_at < v_fin;
    SELECT jsonb_build_object('total', v_total, 'lignes', COALESCE(jsonb_agg(l ORDER BY l->>'evenement_le' DESC), '[]'::jsonb))
      INTO v_json FROM (
        SELECT jsonb_build_object(
                 'patient_id', n.patient_id, 'nom', p.first_name || ' ' || p.last_name,
                 'numero', p.record_number, 'evenement_le', n.signed_at,
                 'consultation_id', n.consultation_id, 'rendez_vous_id', NULL, 'valeur', NULL) AS l
          FROM app.clinical_notes n JOIN app.patients p ON p.id = n.patient_id
         WHERE n.cabinet_id = v_cab
           AND (v_role = 'owner' OR n.practitioner_id = v_uid)
           AND n.status = 'signed'
           AND n.signed_at >= v_debut AND n.signed_at < v_fin
         ORDER BY n.signed_at DESC OFFSET p_offset LIMIT p_limit) q;
    RETURN v_json;
  END IF;

  -- ── Séances closes sans note signée ────────────────────────────────────
  IF p_kind = 'notes_manquantes' THEN
    SELECT count(*) INTO v_total FROM app.consultations c
     WHERE c.cabinet_id = v_cab
       AND (v_role = 'owner' OR c.practitioner_id = v_uid)
       AND c.status = 'closed'
       AND c.started_at >= v_debut AND c.started_at < v_fin
       AND NOT EXISTS (SELECT 1 FROM app.clinical_notes n
                        WHERE n.consultation_id = c.id AND n.status = 'signed');
    SELECT jsonb_build_object('total', v_total, 'lignes', COALESCE(jsonb_agg(l ORDER BY l->>'evenement_le' DESC), '[]'::jsonb))
      INTO v_json FROM (
        SELECT jsonb_build_object(
                 'patient_id', c.patient_id, 'nom', p.first_name || ' ' || p.last_name,
                 'numero', p.record_number, 'evenement_le', c.started_at,
                 'consultation_id', c.id, 'rendez_vous_id', c.appointment_id, 'valeur', NULL) AS l
          FROM app.consultations c JOIN app.patients p ON p.id = c.patient_id
         WHERE c.cabinet_id = v_cab
           AND (v_role = 'owner' OR c.practitioner_id = v_uid)
           AND c.status = 'closed'
           AND c.started_at >= v_debut AND c.started_at < v_fin
           AND NOT EXISTS (SELECT 1 FROM app.clinical_notes n
                            WHERE n.consultation_id = c.id AND n.status = 'signed')
         ORDER BY c.started_at DESC OFFSET p_offset LIMIT p_limit) q;
    RETURN v_json;
  END IF;

  -- ── Diagnostics par libellé ────────────────────────────────────────────
  IF p_kind = 'diagnostics' THEN
    SELECT count(*) INTO v_total FROM app.diagnoses d
     WHERE d.cabinet_id = v_cab
       AND (v_role = 'owner' OR d.practitioner_id = v_uid)
       AND d.label = p_cle;
    SELECT jsonb_build_object('total', v_total, 'lignes', COALESCE(jsonb_agg(l ORDER BY l->>'evenement_le' DESC), '[]'::jsonb))
      INTO v_json FROM (
        SELECT jsonb_build_object(
                 'patient_id', d.patient_id, 'nom', p.first_name || ' ' || p.last_name,
                 'numero', p.record_number, 'evenement_le', d.created_at,
                 'consultation_id', NULL, 'rendez_vous_id', NULL,
                 'valeur', CASE WHEN d.resolved_at IS NULL THEN 'actif' ELSE 'résolu' END) AS l
          FROM app.diagnoses d JOIN app.patients p ON p.id = d.patient_id
         WHERE d.cabinet_id = v_cab
           AND (v_role = 'owner' OR d.practitioner_id = v_uid)
           AND d.label = p_cle
         ORDER BY d.created_at DESC OFFSET p_offset LIMIT p_limit) q;
    RETURN v_json;
  END IF;

  -- ── Échelles par instrument et par bande ───────────────────────────────
  IF p_kind IN ('echelles','echelles_derniers') THEN
    SELECT count(*) INTO v_total FROM (
      SELECT DISTINCT ON (s.patient_id, sc.code) s.id
        FROM app.scale_administrations s JOIN app.scales sc ON sc.id = s.scale_id
       WHERE s.cabinet_id = v_cab
         AND (v_role = 'owner' OR s.practitioner_id = v_uid)
         AND s.administered_at >= v_debut AND s.administered_at < v_fin
         AND split_part(p_cle, '|', 1) = sc.code
         AND (split_part(p_cle, '|', 2) = '' OR s.interpretation = split_part(p_cle, '|', 2))) q;
    SELECT jsonb_build_object('total', v_total, 'lignes', COALESCE(jsonb_agg(l ORDER BY l->>'evenement_le' DESC), '[]'::jsonb))
      INTO v_json FROM (
        SELECT jsonb_build_object(
                 'patient_id', s.patient_id, 'nom', p.first_name || ' ' || p.last_name,
                 'numero', p.record_number, 'evenement_le', s.administered_at,
                 'consultation_id', s.consultation_id, 'rendez_vous_id', NULL,
                 'valeur', sc.code || ' · ' || COALESCE(s.total_score::text, '—')
                          || COALESCE(' (' || s.interpretation || ')', '')) AS l
          FROM app.scale_administrations s
          JOIN app.patients p ON p.id = s.patient_id
          JOIN app.scales sc ON sc.id = s.scale_id
         WHERE s.cabinet_id = v_cab
           AND (v_role = 'owner' OR s.practitioner_id = v_uid)
           AND s.administered_at >= v_debut AND s.administered_at < v_fin
           AND split_part(p_cle, '|', 1) = sc.code
           AND (split_part(p_cle, '|', 2) = '' OR s.interpretation = split_part(p_cle, '|', 2))
         ORDER BY s.administered_at DESC OFFSET p_offset LIMIT p_limit) q;
    RETURN v_json;
  END IF;

  -- ── Traitements actifs / changements ───────────────────────────────────
  IF p_kind = 'traitements_actifs' THEN
    SELECT count(*) INTO v_total FROM app.patient_treatments t
     WHERE t.cabinet_id = v_cab
       AND (v_role = 'owner' OR t.practitioner_id = v_uid)
       AND t.status = 'active';
    SELECT jsonb_build_object('total', v_total, 'lignes', COALESCE(jsonb_agg(l ORDER BY l->>'evenement_le' DESC), '[]'::jsonb))
      INTO v_json FROM (
        SELECT jsonb_build_object(
                 'patient_id', t.patient_id, 'nom', p.first_name || ' ' || p.last_name,
                 'numero', p.record_number, 'evenement_le', t.created_at,
                 'consultation_id', t.consultation_id, 'rendez_vous_id', NULL,
                 'valeur', m.inn || COALESCE(' ' || t.dose || ' ' || t.dose_unit, '')) AS l
          FROM app.patient_treatments t
          JOIN app.patients p ON p.id = t.patient_id
          JOIN app.medications m ON m.id = t.medication_id
         WHERE t.cabinet_id = v_cab
           AND (v_role = 'owner' OR t.practitioner_id = v_uid)
           AND t.status = 'active'
         ORDER BY t.created_at DESC OFFSET p_offset LIMIT p_limit) q;
    RETURN v_json;
  END IF;

  IF p_kind = 'changements_traitement' THEN
    SELECT count(*) INTO v_total
      FROM app.patient_treatment_history h
      JOIN app.patient_treatments t ON t.id = h.treatment_id
     WHERE t.cabinet_id = v_cab
       AND (v_role = 'owner' OR t.practitioner_id = v_uid)
       AND h.occurred_at >= v_debut AND h.occurred_at < v_fin;
    SELECT jsonb_build_object('total', v_total, 'lignes', COALESCE(jsonb_agg(l ORDER BY l->>'evenement_le' DESC), '[]'::jsonb))
      INTO v_json FROM (
        SELECT jsonb_build_object(
                 'patient_id', t.patient_id, 'nom', p.first_name || ' ' || p.last_name,
                 'numero', p.record_number, 'evenement_le', h.occurred_at,
                 'consultation_id', h.consultation_id, 'rendez_vous_id', NULL,
                 'valeur', h.action::text) AS l
          FROM app.patient_treatment_history h
          JOIN app.patient_treatments t ON t.id = h.treatment_id
          JOIN app.patients p ON p.id = t.patient_id
         WHERE t.cabinet_id = v_cab
           AND (v_role = 'owner' OR t.practitioner_id = v_uid)
           AND h.occurred_at >= v_debut AND h.occurred_at < v_fin
         ORDER BY h.occurred_at DESC OFFSET p_offset LIMIT p_limit) q;
    RETURN v_json;
  END IF;

  -- ── Encaissements (une ligne d'argent, jamais mêlée au clinique) ───────
  IF p_kind = 'encaisse' THEN
    SELECT count(*) INTO v_total FROM app.payments pm
     WHERE pm.cabinet_id = v_cab
       AND (v_role = 'owner' OR pm.practitioner_id = v_uid)
       AND pm.collected_at >= v_debut AND pm.collected_at < v_fin;
    SELECT jsonb_build_object('total', v_total, 'lignes', COALESCE(jsonb_agg(l ORDER BY l->>'evenement_le' DESC), '[]'::jsonb))
      INTO v_json FROM (
        SELECT jsonb_build_object(
                 'patient_id', pm.patient_id, 'nom', p.first_name || ' ' || p.last_name,
                 'numero', p.record_number, 'evenement_le', pm.collected_at,
                 'consultation_id', pm.consultation_id, 'rendez_vous_id', NULL,
                 'valeur', pm.amount_dzd::text || ' DZD') AS l
          FROM app.payments pm JOIN app.patients p ON p.id = pm.patient_id
         WHERE pm.cabinet_id = v_cab
           AND (v_role = 'owner' OR pm.practitioner_id = v_uid)
           AND pm.collected_at >= v_debut AND pm.collected_at < v_fin
         ORDER BY pm.collected_at DESC OFFSET p_offset LIMIT p_limit) q;
    RETURN v_json;
  END IF;

  -- ── Délai de suivi par tranche ─────────────────────────────────────────
  IF p_kind = 'delais' THEN
    SELECT count(*) INTO v_total FROM (
      SELECT c.patient_id
        FROM (SELECT c.patient_id, c.started_at,
                     lag(c.started_at) OVER (PARTITION BY c.patient_id ORDER BY c.started_at) AS precedent
                FROM app.consultations c
               WHERE c.cabinet_id = v_cab
                 AND (v_role = 'owner' OR c.practitioner_id = v_uid)
                 AND c.status = 'closed'
                 AND c.started_at >= v_debut AND c.started_at < v_fin) c
       WHERE c.precedent IS NOT NULL
         AND (c.started_at AT TIME ZONE 'Africa/Algiers')::date
             - (c.precedent AT TIME ZONE 'Africa/Algiers')::date
             BETWEEN (CASE p_cle
                        WHEN '0-7' THEN 0 WHEN '8-30' THEN 8 WHEN '31-90' THEN 31
                        WHEN '91-180' THEN 91 ELSE 181 END)
                 AND (CASE p_cle
                        WHEN '0-7' THEN 7 WHEN '8-30' THEN 30 WHEN '31-90' THEN 90
                        WHEN '91-180' THEN 180 ELSE 100000 END)) q;
    SELECT jsonb_build_object('total', v_total, 'lignes', COALESCE(jsonb_agg(l ORDER BY l->>'evenement_le' DESC), '[]'::jsonb))
      INTO v_json FROM (
        SELECT jsonb_build_object(
                 'patient_id', s.patient_id, 'nom', p.first_name || ' ' || p.last_name,
                 'numero', p.record_number, 'evenement_le', s.started_at,
                 'consultation_id', s.id, 'rendez_vous_id', NULL,
                 'valeur', s.ecart::text || ' j') AS l
          FROM (
            SELECT c.id, c.patient_id, c.started_at,
                   (c.started_at AT TIME ZONE 'Africa/Algiers')::date
                   - (lag(c.started_at) OVER (PARTITION BY c.patient_id ORDER BY c.started_at)
                      AT TIME ZONE 'Africa/Algiers')::date AS ecart
              FROM app.consultations c
             WHERE c.cabinet_id = v_cab
               AND (v_role = 'owner' OR c.practitioner_id = v_uid)
               AND c.status = 'closed'
               AND c.started_at >= v_debut AND c.started_at < v_fin) s
          JOIN app.patients p ON p.id = s.patient_id
         WHERE s.ecart BETWEEN (CASE p_cle
                        WHEN '0-7' THEN 0 WHEN '8-30' THEN 8 WHEN '31-90' THEN 31
                        WHEN '91-180' THEN 91 ELSE 181 END)
                 AND (CASE p_cle
                        WHEN '0-7' THEN 7 WHEN '8-30' THEN 30 WHEN '31-90' THEN 90
                        WHEN '91-180' THEN 180 ELSE 100000 END)
         ORDER BY s.started_at DESC OFFSET p_offset LIMIT p_limit) q;
    RETURN v_json;
  END IF;

  -- ── Séances par seau temporel (point d'une courbe) ─────────────────────
  -- Le seau peut être un jour, une semaine ISO ou un mois : la clé porte le
  -- DÉBUT du seau, la granularité dit combien de temps il couvre. Sans elle,
  -- un clic sur une semaine ne rendrait que le lundi.
  IF p_kind = 'serie' THEN
    IF p_grain NOT IN ('jour','semaine','mois') THEN
      RETURN NULL;
    END IF;
    SELECT count(*) INTO v_total FROM app.consultations c
     WHERE c.cabinet_id = v_cab
       AND (v_role = 'owner' OR c.practitioner_id = v_uid)
       AND c.status = 'closed'
       AND c.started_at >= (p_cle::date)::timestamp AT TIME ZONE 'Africa/Algiers'
       AND c.started_at < (CASE p_grain
                             WHEN 'jour'    THEN p_cle::date + 1
                             WHEN 'semaine' THEN p_cle::date + 7
                             ELSE (date_trunc('month', p_cle::date) + interval '1 month')::date
                           END)::timestamp AT TIME ZONE 'Africa/Algiers';
    SELECT jsonb_build_object('total', v_total, 'lignes', COALESCE(jsonb_agg(l ORDER BY l->>'evenement_le' DESC), '[]'::jsonb))
      INTO v_json FROM (
        SELECT jsonb_build_object(
                 'patient_id', c.patient_id, 'nom', p.first_name || ' ' || p.last_name,
                 'numero', p.record_number, 'evenement_le', c.started_at,
                 'consultation_id', c.id, 'rendez_vous_id', c.appointment_id, 'valeur', NULL) AS l
          FROM app.consultations c JOIN app.patients p ON p.id = c.patient_id
         WHERE c.cabinet_id = v_cab
           AND (v_role = 'owner' OR c.practitioner_id = v_uid)
           AND c.status = 'closed'
           AND c.started_at >= (p_cle::date)::timestamp AT TIME ZONE 'Africa/Algiers'
           AND c.started_at < (CASE p_grain
                                 WHEN 'jour'    THEN p_cle::date + 1
                                 WHEN 'semaine' THEN p_cle::date + 7
                                 ELSE (date_trunc('month', p_cle::date) + interval '1 month')::date
                               END)::timestamp AT TIME ZONE 'Africa/Algiers'
         ORDER BY c.started_at DESC OFFSET p_offset LIMIT p_limit) q;
    RETURN v_json;
  END IF;

  -- Type inconnu : même réponse qu'une porte absente, jamais un oracle.
  RETURN NULL;
END
$fn$;

ALTER FUNCTION app.get_analysis_drilldown(text, text, date, date, integer, integer, text)
  OWNER TO app_gatekeeper;
COMMENT ON FUNCTION app.get_analysis_drilldown(text, text, date, date, integer, integer, text) IS
  'Détail nominatif d''un indicateur, paginé. Trace `liste` AVANT toute lecture '
  'de nom (ADR-019). Rend NULL pour un rôle non clinique ou un type inconnu.';

REVOKE ALL ON FUNCTION app.get_analysis_drilldown(text, text, date, date, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_analysis_drilldown(text, text, date, date, integer, integer, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Les index qui manquaient pour ces deux portes
-- ---------------------------------------------------------------------------
-- `consultations` n'avait qu'un index `(patient_id, started_at)`. Les portes
-- ci-dessus filtrent par CABINET et par fenêtre : sans un index qui commence
-- par `cabinet_id`, chaque appel balaie la table entière — et la RLS évalue
-- deux fonctions PAR LIGNE (mesuré : 90 ms pour 7 500 séances). Avec l'index,
-- seules les lignes de la fenêtre sont évaluées.
CREATE INDEX IF NOT EXISTS consultations_cabinet_started
  ON app.consultations (cabinet_id, started_at DESC);
CREATE INDEX IF NOT EXISTS consultations_practitioner_started
  ON app.consultations (practitioner_id, started_at DESC);
CREATE INDEX IF NOT EXISTS appointments_cabinet_starts
  ON app.appointments (cabinet_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS notes_cabinet_signed
  ON app.clinical_notes (cabinet_id, signed_at DESC)
  WHERE status = 'signed';
CREATE INDEX IF NOT EXISTS notes_practitioner_signed
  ON app.clinical_notes (practitioner_id, signed_at DESC)
  WHERE status = 'signed';
CREATE INDEX IF NOT EXISTS patients_cabinet_created
  ON app.patients (cabinet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scale_admin_cabinet_date
  ON app.scale_administrations (cabinet_id, administered_at DESC);
CREATE INDEX IF NOT EXISTS treatment_history_occurred
  ON app.patient_treatment_history (occurred_at DESC);
CREATE INDEX IF NOT EXISTS appointments_a_suivre
  ON app.appointments (starts_at)
  WHERE status IN ('confirmed','arrived','requested');
CREATE INDEX IF NOT EXISTS treatments_actifs
  ON app.patient_treatments (cabinet_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS diagnoses_label
  ON app.diagnoses (cabinet_id, label);

INSERT INTO app.schema_migrations (version) VALUES ('207_analysis_gates')
    ON CONFLICT DO NOTHING;

COMMIT;
