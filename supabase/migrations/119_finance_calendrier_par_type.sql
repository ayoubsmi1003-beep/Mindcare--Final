-- 119_finance_calendrier_par_type — le calendrier devient multi-lignes.
--
-- ADDITIF PUR. 041 est APPLIQUÉE : on ne la retouche pas (règle 9).
--
-- ═══ LE BESOIN ═══════════════════════════════════════════════════════════
-- Le panneau « Calendrier » traçait UNE aire (montant encaissé par jour). Le
-- nouveau dessin (look 21st.dev) trace UNE COURBE PAR TYPE DE CONSULTATION,
-- en NOMBRES de séances par jour. Or la porte ne rendait aucun croisement
-- jour × type : `par_type` totalise par type SUR LA PÉRIODE, `calendrier`
-- totalise par jour SANS le type. Dériver le croisement en React exigerait des
-- sommes côté client — exactement ce que « aucune arithmétique en React »
-- interdit sur un écran d'argent.
--
-- La porte rend donc `calendrier_par_type` : `{ types, lignes }`, où `types`
-- liste les 3 modalités dominantes (+ `autres` qui plie le reste SANS RIEN
-- PERDRE — la somme est faite ici), et `lignes` donne `{ jour_iso, cle, nb }`
-- pour chaque couple (jour, type retenu). Treize modalités (024) ne tiennent
-- pas en légende lisible ; le top-3 couvre l'ordinaire.
--
-- Mêmes bornes `Africa/Algiers`, même cloison owner/praticien, mêmes jointures
-- `payments → consultations → appointments` que `par_type`. Agrégats anonymes
-- uniquement : aucun nom de patient ne sort (comme `v_calendrier`).
--
-- 🔴 AUCUN `DROP` — un DROP emporterait le propriétaire `app_gatekeeper` et la
-- porte reviendrait à `postgres` (rolbypassrls).

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE OR REPLACE FUNCTION app.get_finance_overview(
  p_period_start date,
  p_period_end   date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_role          app.user_role;
  v_debut         timestamptz;
  v_fin           timestamptz;
  v_aujourdhui    date;
  v_revenu_jour   bigint;
  v_revenu_sem    bigint;
  v_revenu_mois   bigint;
  v_revenu_per    bigint;
  v_seances       bigint;
  v_panier        bigint;
  v_charges       bigint;
  v_impaye_total  bigint;
  v_impaye_nb     bigint;
  v_impaye_age    integer;
  v_nb_recur      bigint;
  v_evolution     jsonb;
  v_par_type      jsonb;
  v_par_categorie jsonb;
  v_calendrier    jsonb;
  v_top_types     text[];
  v_has_autres    boolean;
  v_types         jsonb;
  v_calendrier_par_type jsonb;
  v_echeances     jsonb;
BEGIN
  IF p_period_start IS NULL OR p_period_end IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Période inversée : la fin précède le début.';
  END IF;

  IF (p_period_end - p_period_start) > 366 THEN
    RAISE EXCEPTION 'Période trop large.'
      USING HINT = 'Au plus 366 jours — au-delà, l''écran cesse d''être lisible.';
  END IF;

  v_role := app.current_role();

  IF v_role NOT IN ('owner', 'practitioner') THEN
    RETURN NULL;
  END IF;

  v_debut      := p_period_start::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin        := (p_period_end + 1)::timestamp AT TIME ZONE 'Africa/Algiers';
  v_aujourdhui := (now() AT TIME ZONE 'Africa/Algiers')::date;

  SELECT COALESCE(SUM(p.amount_dzd) FILTER (
           WHERE p.collected_at >= (v_aujourdhui::timestamp AT TIME ZONE 'Africa/Algiers')
             AND p.collected_at <  ((v_aujourdhui + 1)::timestamp AT TIME ZONE 'Africa/Algiers')), 0)::bigint,
         COALESCE(SUM(p.amount_dzd) FILTER (
           WHERE p.collected_at >= (date_trunc('week', v_aujourdhui::timestamp)  AT TIME ZONE 'Africa/Algiers')
             AND p.collected_at <  ((date_trunc('week', v_aujourdhui::timestamp)  + interval '1 week')  AT TIME ZONE 'Africa/Algiers')), 0)::bigint,
         COALESCE(SUM(p.amount_dzd) FILTER (
           WHERE p.collected_at >= (date_trunc('month', v_aujourdhui::timestamp) AT TIME ZONE 'Africa/Algiers')
             AND p.collected_at <  ((date_trunc('month', v_aujourdhui::timestamp) + interval '1 month') AT TIME ZONE 'Africa/Algiers')), 0)::bigint
    INTO v_revenu_jour, v_revenu_sem, v_revenu_mois
    FROM app.payments p
   WHERE p.cabinet_id = app.current_cabinet()
     AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
     AND p.collected_at IS NOT NULL;

  SELECT COALESCE(SUM(p.amount_dzd), 0)::bigint, COUNT(*)::bigint
    INTO v_revenu_per, v_seances
    FROM app.payments p
   WHERE p.cabinet_id = app.current_cabinet()
     AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
     AND p.collected_at >= v_debut
     AND p.collected_at <  v_fin;

  -- `panier_moyen` reste NULL sans séance — VOULU (l'écran affiche « — »).
  v_panier := CASE WHEN v_seances = 0 THEN NULL
                   ELSE round(v_revenu_per::numeric / v_seances) END;

  v_charges := round(app.charges_sur_periode(p_period_start, p_period_end));

  -- 041 · LE NOMBRE DE CHARGES RÉCURRENTES ACTIVES. Compté ICI, en SQL.
  -- L'écran le déduisait de `charges_par_categorie.length`, c'est-à-dire du
  -- nombre de CATÉGORIES : cinq charges réparties sur quatre catégories
  -- s'affichaient « 4 charges récurrentes ». L'étiquette mentait sur ce que
  -- le nombre comptait — exactement le défaut que « aucune arithmétique en
  -- React » existe pour empêcher.
  SELECT COUNT(*)::bigint INTO v_nb_recur
    FROM app.charges c
   WHERE c.cabinet_id = app.current_cabinet()
     AND c.actif
     AND c.type = 'recurrente';

  -- 040 · DÉFAUT 2 — `COALESCE(MAX(...), 0)` : sans impayé, l'âge vaut zéro
  -- jour, il ne vaut pas « inconnu ».
  SELECT COALESCE(SUM(p.amount_dzd), 0)::bigint,
         COUNT(*)::bigint,
         COALESCE(MAX((v_aujourdhui - (p.created_at AT TIME ZONE 'Africa/Algiers')::date)), 0)::integer
    INTO v_impaye_total, v_impaye_nb, v_impaye_age
    FROM app.payments p
   WHERE p.cabinet_id = app.current_cabinet()
     AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
     AND p.collected_at IS NULL;

  WITH mois AS (
    SELECT g.m::date AS debut,
           (g.m + interval '1 month' - interval '1 day')::date AS fin
      FROM generate_series(
             date_trunc('month', v_aujourdhui::timestamp) - interval '5 months',
             date_trunc('month', v_aujourdhui::timestamp),
             interval '1 month') AS g(m)
  ),
  revenus AS (
    SELECT mo.debut, mo.fin,
           COALESCE(SUM(p.amount_dzd), 0)::bigint AS revenu
      FROM mois mo
      LEFT JOIN app.payments p
        ON p.cabinet_id = app.current_cabinet()
       AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
       AND p.collected_at >= (mo.debut::timestamp AT TIME ZONE 'Africa/Algiers')
       AND p.collected_at <  ((mo.fin + 1)::timestamp AT TIME ZONE 'Africa/Algiers')
     GROUP BY mo.debut, mo.fin
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             -- 040 · DÉFAUT 1 — libellé français explicite, pas `TMMon`.
             'mois_label',   (ARRAY['janv.','févr.','mars','avr.','mai','juin',
                                    'juil.','août','sept.','oct.','nov.','déc.']
                             )[EXTRACT(MONTH FROM r.debut)::int],
             'mois_iso',     to_char(r.debut, 'YYYY-MM'),
             'revenu',       r.revenu,
             'charges',      round(app.charges_sur_periode(r.debut, r.fin))::bigint,
             'resultat_net', (r.revenu - round(app.charges_sur_periode(r.debut, r.fin)))::bigint
           ) ORDER BY r.debut), '[]'::jsonb)
    INTO v_evolution
    FROM revenus r;

  WITH par_type AS (
    SELECT COALESCE(a.kind::text, '__non_rattache__') AS cle,
           SUM(p.amount_dzd)::bigint                  AS montant,
           COUNT(*)::bigint                           AS nb
      FROM app.payments p
      LEFT JOIN app.consultations c ON c.id = p.consultation_id
      LEFT JOIN app.appointments  a ON a.id = c.appointment_id
     WHERE p.cabinet_id = app.current_cabinet()
       AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
       AND p.collected_at >= v_debut
       AND p.collected_at <  v_fin
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'cle',        t.cle,
             'libelle',    t.cle,
             'montant',    t.montant,
             'nb_seances', t.nb,
             'part_pct',   CASE WHEN v_revenu_per = 0 THEN 0
                                ELSE round(100.0 * t.montant / v_revenu_per, 1) END
           ) ORDER BY (t.cle = '__non_rattache__'), t.montant DESC, t.cle), '[]'::jsonb)
     INTO v_par_type
     FROM par_type t;

  -- 119 · LES 3 MODALITÉS DOMINANTES (par NOMBRE de séances) + « AUTRES ».
  -- Même périmètre et même cloison que `par_type` ci-dessus. `__non_rattache__`
  -- reste en dernier — c'est l'ordre que l'écran reprend dans sa légende.
  WITH par_type_nb AS (
    SELECT COALESCE(a.kind::text, '__non_rattache__') AS cle,
           COUNT(*)::bigint                           AS nb
      FROM app.payments p
      LEFT JOIN app.consultations c ON c.id = p.consultation_id
      LEFT JOIN app.appointments  a ON a.id = c.appointment_id
     WHERE p.cabinet_id = app.current_cabinet()
       AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
       AND p.collected_at >= v_debut
       AND p.collected_at <  v_fin
     GROUP BY 1
  ),
  ordonnes AS (
    SELECT cle, nb,
           ROW_NUMBER() OVER (ORDER BY (cle = '__non_rattache__'), nb DESC, cle) AS rang
      FROM par_type_nb
  )
  SELECT COALESCE(array_agg(o.cle ORDER BY o.rang) FILTER (WHERE o.rang <= 3), '{}'::text[]),
         COALESCE(bool_or(o.rang > 3), false)
    INTO v_top_types, v_has_autres
    FROM ordonnes o;

  -- La liste des courbes, dans l'ordre de tracé. `libelle` rend la clé brute —
  -- c'est l'écran qui traduit (`__non_rattache__`, `autres`), jamais la base.
  WITH legendes AS (
    SELECT t.cle, t.rang FROM unnest(v_top_types) WITH ORDINALITY AS t(cle, rang)
    UNION ALL
    SELECT 'autres', 4 WHERE v_has_autres
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('cle', l.cle, 'libelle', l.cle)
           ORDER BY l.rang), '[]'::jsonb)
    INTO v_types
    FROM legendes l;

  WITH mois AS (
    SELECT g.m::date                                                     AS debut_mois,
           (g.m + interval '1 month')::date                              AS fin_mois,
           GREATEST(g.m::date, p_period_start)                           AS debut_eff,
           LEAST((g.m + interval '1 month' - interval '1 day')::date, p_period_end) AS fin_eff
      FROM generate_series(date_trunc('month', p_period_start::timestamp),
                           date_trunc('month', p_period_end::timestamp),
                           interval '1 month') AS g(m)
  ),
  par_cat AS (
    SELECT c.categorie::text AS cle,
           SUM(c.montant_dzd)::numeric AS montant
      FROM app.charges c
     WHERE c.cabinet_id = app.current_cabinet()
       AND c.actif
       AND c.type = 'ponctuelle'
       AND c.date_charge BETWEEN p_period_start AND p_period_end
     GROUP BY 1
     UNION ALL
    SELECT c.categorie::text,
           SUM(app.charge_equivalent_mensuel(c.montant_dzd, c.type, c.frequence)
               * ((mo.fin_eff - mo.debut_eff + 1)::numeric
                  / (mo.fin_mois - mo.debut_mois)::numeric))::numeric
      FROM mois mo
      JOIN app.charges c
        ON c.cabinet_id = app.current_cabinet()
       AND c.actif
       AND c.type = 'recurrente'
       AND c.date_charge <= mo.fin_eff
     WHERE mo.fin_eff >= mo.debut_eff
     GROUP BY 1
  ),
  par_cat_total AS (
    SELECT cle, round(SUM(montant))::bigint AS montant
      FROM par_cat GROUP BY cle
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'cle',      k.cle,
             'libelle',  k.cle,
             'montant',  k.montant,
             'part_pct', CASE WHEN v_charges = 0 THEN 0
                              ELSE round(100.0 * k.montant / v_charges, 1) END
           ) ORDER BY k.montant DESC, k.cle), '[]'::jsonb)
    INTO v_par_categorie
    FROM par_cat_total k;

  WITH jours AS (
    SELECT g.j::date AS jour
      FROM generate_series(p_period_start::timestamp, p_period_end::timestamp, interval '1 day') AS g(j)
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'jour_iso',   to_char(j.jour, 'YYYY-MM-DD'),
             'montant',    COALESCE(enc.montant, 0),
             'nb_seances', COALESCE(enc.nb, 0),
             'a_impaye',   COALESCE(imp.present, false)
           ) ORDER BY j.jour), '[]'::jsonb)
    INTO v_calendrier
    FROM jours j
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(p.amount_dzd), 0)::bigint AS montant, COUNT(*)::bigint AS nb
        FROM app.payments p
       WHERE p.cabinet_id = app.current_cabinet()
         AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
         AND p.collected_at >= (j.jour::timestamp AT TIME ZONE 'Africa/Algiers')
         AND p.collected_at <  ((j.jour + 1)::timestamp AT TIME ZONE 'Africa/Algiers')
    ) enc ON true
    LEFT JOIN LATERAL (
      SELECT true AS present
        FROM app.payments p
       WHERE p.cabinet_id = app.current_cabinet()
         AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
         AND p.collected_at IS NULL
         AND p.created_at >= (j.jour::timestamp AT TIME ZONE 'Africa/Algiers')
          AND p.created_at <  ((j.jour + 1)::timestamp AT TIME ZONE 'Africa/Algiers')
        LIMIT 1
     ) imp ON true;

  -- 119 · LE CROISEMENT JOUR × TYPE, en NOMBRES de séances (entiers).
  -- Un objet par (jour, courbe retenue). Les jours sans séance pour un type
  -- portent `nb = 0` EXPLICITEMENT : l'écran n'a aucun trou à combler, donc
  -- aucune somme à refaire. `autres` = total du jour moins les tops — calculé
  -- ICI, jamais en React. Période vide → `[]`, que l'écran affiche en phrase.
  WITH jours_c AS (
    SELECT g.j::date AS jour
      FROM generate_series(p_period_start::timestamp, p_period_end::timestamp, interval '1 day') AS g(j)
  ),
  nb_jour_type AS (
    SELECT (p.collected_at AT TIME ZONE 'Africa/Algiers')::date AS jour,
           COALESCE(a.kind::text, '__non_rattache__')           AS cle,
           COUNT(*)::bigint                                     AS nb
      FROM app.payments p
      LEFT JOIN app.consultations c ON c.id = p.consultation_id
      LEFT JOIN app.appointments  a ON a.id = c.appointment_id
     WHERE p.cabinet_id = app.current_cabinet()
       AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
       AND p.collected_at >= v_debut
       AND p.collected_at <  v_fin
     GROUP BY 1, 2
  ),
  tot_jour AS (
    SELECT jour, SUM(nb)::bigint AS total FROM nb_jour_type GROUP BY jour
  ),
  somme_tops AS (
    SELECT jour, SUM(nb)::bigint AS somme
      FROM nb_jour_type
     WHERE cle = ANY (v_top_types)
     GROUP BY jour
  ),
  courbes AS (
    SELECT u.cle FROM unnest(v_top_types) AS u(cle)
    UNION ALL
    SELECT 'autres' WHERE v_has_autres
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'jour_iso', to_char(j.jour, 'YYYY-MM-DD'),
             'cle',      c.cle,
             'nb',       CASE WHEN c.cle = 'autres'
                              THEN GREATEST(COALESCE(t.total, 0) - COALESCE(s.somme, 0), 0)
                              ELSE COALESCE(b.nb, 0) END
           ) ORDER BY j.jour, c.cle), '[]'::jsonb)
    INTO v_calendrier_par_type
    FROM jours_c j
    CROSS JOIN courbes c
    LEFT JOIN nb_jour_type b ON b.jour = j.jour AND b.cle = c.cle
    LEFT JOIN tot_jour t     ON t.jour = j.jour
    LEFT JOIN somme_tops s   ON s.jour = j.jour;

  SELECT COALESCE(jsonb_agg(e ORDER BY e->>'date_echeance'), '[]'::jsonb)
    INTO v_echeances
    FROM (
      SELECT jsonb_build_object(
               'intitule',       c.intitule,
               'montant',        c.montant_dzd,
               'date_echeance',  to_char(c.date_prochaine_echeance, 'YYYY-MM-DD'),
               'jours_restants', (c.date_prochaine_echeance - v_aujourdhui)
             ) AS e
        FROM app.charges c
       WHERE c.cabinet_id = app.current_cabinet()
         AND c.actif
         AND c.type = 'recurrente'
         AND c.date_prochaine_echeance IS NOT NULL
         AND c.date_prochaine_echeance >= v_aujourdhui
       ORDER BY c.date_prochaine_echeance
       LIMIT 3
    ) s;

  RETURN jsonb_build_object(
    'du',    to_char(p_period_start, 'YYYY-MM-DD'),
    'au',    to_char(p_period_end,   'YYYY-MM-DD'),
    'jours', (p_period_end - p_period_start + 1),
    'pulse', jsonb_build_object(
      'revenu_aujourdhui',    v_revenu_jour,
      'revenu_semaine',       v_revenu_sem,
      'revenu_mois',          v_revenu_mois,
      'revenu_periode',       v_revenu_per,
      'charges_periode',      v_charges,
      'resultat_net_periode', (v_revenu_per - v_charges),
      'nb_seances_periode',   v_seances,
      'nb_charges_recurrentes', v_nb_recur,
      'panier_moyen',         v_panier,
      'impayes_total',        v_impaye_total,
      'impayes_count',        v_impaye_nb
    ),
    'evolution',   v_evolution,
    'composition', jsonb_build_object(
      'revenus_par_type',      v_par_type,
      'charges_par_categorie', v_par_categorie
    ),
    'calendrier',  v_calendrier,
    'calendrier_par_type', jsonb_build_object(
      'types',  v_types,
      'lignes', v_calendrier_par_type
    ),
    'attention',   jsonb_build_object(
      'impayes_total',            v_impaye_total,
      'impayes_count',            v_impaye_nb,
      'echeances_a_venir',        v_echeances,
      'plus_ancien_impaye_jours', v_impaye_age
    )
  );
END;
$$;

ALTER FUNCTION app.get_finance_overview(date, date) OWNER TO app_gatekeeper;

REVOKE ALL ON FUNCTION app.get_finance_overview(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_finance_overview(date, date) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('119_finance_calendrier_par_type')
  ON CONFLICT DO NOTHING;

COMMIT;
