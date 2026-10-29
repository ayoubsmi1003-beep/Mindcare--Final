-- 208_analysis_charts — les cinq graphiques supplémentaires de /statistiques.
--
-- ⚠️ 207 N'EST PAS MODIFIÉE. Une migration appliquée ne se réécrit pas ; la
-- porte d'aperçu est donc REMPLACÉE ici (corps identique, deux lignes ajoutées)
-- et une porte interne rend les cinq jeux supplémentaires en un seul passage.
--
-- ⚠️ AUCUNE TABLE, COLONNE, TYPE NI VALEUR D'ENUM. Rien que des lectures.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Les cinq jeux supplémentaires — âges, durées, continuité, diagnostics
-- ---------------------------------------------------------------------------
-- ⚠️ MÊME CONTRAT QUE 207 : SECURITY DEFINER, périmètre explicite, bornes
-- Africa/Algiers, aucune donnée nominative, aucun total recalculé côté écran.
-- Cette porte est INTERNE : seuls les deux appels publics la composent.
CREATE OR REPLACE FUNCTION app.analysis_extra(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $fn$
DECLARE
  v_role     app.user_role := app.current_role();
  v_cab      uuid;
  v_uid      uuid;
  v_debut    timestamptz;
  v_fin      timestamptz;
  v_unite    text;
  v_jours    integer;
  v_ages     jsonb;
  v_durees   jsonb;
  v_mediane  numeric;
  v_cont     jsonb;
  v_diag     jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RETURN NULL;
  END IF;
  IF v_role NOT IN ('owner', 'practitioner') THEN
    RETURN NULL;
  END IF;

  v_cab   := app.current_cabinet();
  v_uid   := auth.uid();
  v_jours := (p_to - p_from) + 1;
  v_debut := p_from::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin   := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Algiers';
  v_unite := CASE WHEN v_jours <= 62 THEN 'day'
                  WHEN v_jours <= 740 THEN 'week'
                  ELSE 'month' END;

  -- ── 1 · Pyramide des âges — les DOSSIERS VUS sur la période ────────────
  -- La question est « qui soigne-t-on en ce moment », pas « qui a un dossier ».
  -- Un dossier dormant depuis trois ans ne dit rien de la charge actuelle.
  WITH vues AS (
    SELECT DISTINCT c.patient_id
      FROM app.consultations c
     WHERE c.cabinet_id = v_cab
       AND (v_role = 'owner' OR c.practitioner_id = v_uid)
       AND c.status = 'closed'
       AND c.started_at >= v_debut AND c.started_at < v_fin
  ),
  bandes AS (
    SELECT CASE
             WHEN p.birth_date IS NULL THEN 'non renseigné'
             WHEN date_part('year', age(p_to, p.birth_date)) < 15 THEN '0-14'
             WHEN date_part('year', age(p_to, p.birth_date)) < 25 THEN '15-24'
             WHEN date_part('year', age(p_to, p.birth_date)) < 35 THEN '25-34'
             WHEN date_part('year', age(p_to, p.birth_date)) < 45 THEN '35-44'
             WHEN date_part('year', age(p_to, p.birth_date)) < 55 THEN '45-54'
             WHEN date_part('year', age(p_to, p.birth_date)) < 65 THEN '55-64'
             WHEN date_part('year', age(p_to, p.birth_date)) < 75 THEN '65-74'
             ELSE '75+'
           END AS bande,
           CASE
             WHEN p.birth_date IS NULL THEN 9
             WHEN date_part('year', age(p_to, p.birth_date)) < 15 THEN 1
             WHEN date_part('year', age(p_to, p.birth_date)) < 25 THEN 2
             WHEN date_part('year', age(p_to, p.birth_date)) < 35 THEN 3
             WHEN date_part('year', age(p_to, p.birth_date)) < 45 THEN 4
             WHEN date_part('year', age(p_to, p.birth_date)) < 55 THEN 5
             WHEN date_part('year', age(p_to, p.birth_date)) < 65 THEN 6
             WHEN date_part('year', age(p_to, p.birth_date)) < 75 THEN 7
             ELSE 8
           END AS ordre,
           p.sex
      FROM vues v
      JOIN app.patients p ON p.id = v.patient_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bande', x.bande,
           'f', x.f,
           'm', x.m,
           'nr', x.nr
         ) ORDER BY x.ordre), '[]'::jsonb)
    INTO v_ages
    FROM (
      SELECT b.bande, b.ordre,
             count(*) FILTER (WHERE b.sex = 'F') AS f,
             count(*) FILTER (WHERE b.sex = 'M') AS m,
             count(*) FILTER (WHERE b.sex IS NULL) AS nr
        FROM bandes b
       GROUP BY b.bande, b.ordre
    ) x;

  -- ── 2 · Durée des séances — histogramme + médiane ──────────────────────
  WITH d AS MATERIALIZED (
    SELECT c.duration_seconds
      FROM app.consultations c
     WHERE c.cabinet_id = v_cab
       AND (v_role = 'owner' OR c.practitioner_id = v_uid)
       AND c.status = 'closed'
       AND c.started_at >= v_debut AND c.started_at < v_fin
       AND c.duration_seconds IS NOT NULL
       AND c.duration_seconds > 0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('cle', s.cle, 'n', s.n) ORDER BY s.ordre), '[]'::jsonb),
         (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY d.duration_seconds) / 60.0)
            FROM d)
    INTO v_durees, v_mediane
    FROM (
      SELECT CASE
               WHEN d.duration_seconds <= 15 * 60 THEN '0-15'
               WHEN d.duration_seconds <= 30 * 60 THEN '16-30'
               WHEN d.duration_seconds <= 45 * 60 THEN '31-45'
               WHEN d.duration_seconds <= 60 * 60 THEN '46-60'
               WHEN d.duration_seconds <= 90 * 60 THEN '61-90'
               ELSE '90+'
             END AS cle,
             CASE
               WHEN d.duration_seconds <= 15 * 60 THEN 1
               WHEN d.duration_seconds <= 30 * 60 THEN 2
               WHEN d.duration_seconds <= 45 * 60 THEN 3
               WHEN d.duration_seconds <= 60 * 60 THEN 4
               WHEN d.duration_seconds <= 90 * 60 THEN 5
               ELSE 6
             END AS ordre,
             count(*) AS n
        FROM d
       GROUP BY 1, 2
    ) s;

  -- ── 3 · Continuité — la cohorte des dossiers OUVERTS sur la période ────
  -- ⚠️ LE DÉNOMINATEUR EST BORNÉ PAR LE RECUL DISPONIBLE. Un dossier ouvert
  -- il y a dix jours ne peut pas prouver un retour à 180 jours : le compter au
  -- dénominateur ferait baisser le taux par construction, et l'écran lirait une
  -- baisse de fidélisation qui n'a pas eu lieu.
  WITH cohorte AS MATERIALIZED (
    SELECT p.id, p.created_at
      FROM app.patients p
     WHERE p.cabinet_id = v_cab
       AND (v_role = 'owner' OR p.practitioner_id = v_uid)
       AND p.created_at >= v_debut AND p.created_at < v_fin
  ),
  prems AS MATERIALIZED (
    SELECT c.patient_id, min(c.started_at) AS t0
      FROM app.consultations c
      JOIN cohorte k ON k.id = c.patient_id
     WHERE c.cabinet_id = v_cab
       AND c.status = 'closed'
     GROUP BY c.patient_id
  ),
  retours AS MATERIALIZED (
    SELECT p.patient_id, p.t0,
           (SELECT min(c2.started_at)
              FROM app.consultations c2
             WHERE c2.patient_id = p.patient_id
               AND c2.status = 'closed'
               AND c2.started_at > p.t0) AS t1
      FROM prems p
  ),
  horizons(h) AS (VALUES (30), (60), (90), (180))
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'horizon', h.h,
           'cohorte', agg.denom,
           'revenus', agg.num,
           'pct', CASE WHEN agg.denom = 0 THEN NULL
                       ELSE round(agg.num * 100.0 / agg.denom) END
         ) ORDER BY h.h), '[]'::jsonb)
    INTO v_cont
    FROM horizons h
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE r.t0 + (h.h || ' days')::interval <= v_fin) AS denom,
             count(*) FILTER (WHERE r.t0 + (h.h || ' days')::interval <= v_fin
                                AND r.t1 IS NOT NULL
                                AND r.t1 <= r.t0 + (h.h || ' days')::interval) AS num
        FROM retours r
    ) agg;

  -- ── 4 · Diagnostics actifs — un stock, mois après mois ─────────────────
  -- Le stock est recalculé à la fin de chaque seau : un diagnostic « actif »
  -- est un diagnostic écrit avant la fin du seau et non résolu à cette date.
  -- Les deux flux (nouveaux, résolus) sont rendus séparément pour que la
  -- courbe ne mélange jamais un niveau et une variation.
  WITH d AS MATERIALIZED (
    SELECT x.created_at, x.resolved_at
      FROM app.diagnoses x
     WHERE x.cabinet_id = v_cab
       AND (v_role = 'owner' OR x.practitioner_id = v_uid)
  ),
  bornes AS (
    SELECT gs::date AS cle,
           (gs + interval '1 month')::date AS fin
      FROM generate_series(
             date_trunc('month', p_from::timestamp),
             p_to::timestamp,
             interval '1 month') AS gs
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'cle', to_char(b.cle, 'YYYY-MM-DD'),
           'actifs', (SELECT count(*) FROM d
                       WHERE d.created_at < (b.fin::timestamp AT TIME ZONE 'Africa/Algiers')
                         AND (d.resolved_at IS NULL OR d.resolved_at >= b.fin)),
           'nouveaux', (SELECT count(*) FROM d
                         WHERE d.created_at >= (b.cle::timestamp AT TIME ZONE 'Africa/Algiers')
                           AND d.created_at <  (b.fin::timestamp AT TIME ZONE 'Africa/Algiers')),
           'resolus', (SELECT count(*) FROM d
                        WHERE d.resolved_at >= b.cle AND d.resolved_at < b.fin)
         ) ORDER BY b.cle), '[]'::jsonb)
    INTO v_diag
    FROM bornes b;

  RETURN jsonb_build_object(
    'ages', v_ages,
    'durees', v_durees,
    'duree_mediane', v_mediane,
    'continuite', v_cont,
    'diag_stock', v_diag
  );
END
$fn$;

ALTER FUNCTION app.analysis_extra(date, date) OWNER TO app_gatekeeper;
COMMENT ON FUNCTION app.analysis_extra(date, date) IS
  'Cinq jeux supplémentaires de l''écran Statistiques : pyramide des âges, '
  'durées de séance, continuité de la cohorte, stock de diagnostics. Interne.';

REVOKE ALL ON FUNCTION app.analysis_extra(date, date) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2 · La porte publique, inchangée sauf la clé 'charts'
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
  v_charts    jsonb;
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
    'charts',   app.analysis_extra(p_from, p_to),
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

INSERT INTO app.schema_migrations (version) VALUES ('208_analysis_charts')
    ON CONFLICT DO NOTHING;

COMMIT;
