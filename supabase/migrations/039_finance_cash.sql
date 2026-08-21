-- 039_finance_cash — LA COMPTABILITÉ DE CAISSE. Un seul chiffre de recette.
--
-- ADDITIF PUR. Ne modifie ni 011, ni 029, ni 036, ni aucune policy. Les portes
-- de 036 (`app.finance_overview`, `app.list_period_payments`) restent EN PLACE,
-- intactes : l'écran cesse simplement de les appeler. Les retirer sera un
-- ménage ultérieur, pas un effet de bord de cette migration.
--
-- ═══ POURQUOI UNE SECONDE FAMILLE DE PORTES ═══════════════════════════════
-- 036 a construit `facturé / encaissé / en attente / taux d'encaissement` sur
-- DEUX fenêtres de dates (`created_at` pour l'assiette, `collected_at` pour la
-- caisse). Ce modèle décrit un cabinet qui FACTURE puis se fait payer plus tard.
--
-- Ce cabinet-ci est au COMPTANT : la patiente règle à la séance. Il n'y a donc
-- pas deux axes comptables, il y en a UN — l'argent réellement entré en caisse.
-- Maintenir « facturé » à côté d'« encaissé » n'était pas une nuance, c'était
-- une distinction inventée, et elle occupait la moitié de l'écran.
--
-- LA RECETTE, ICI, EST : `app.payments` fenêtrée sur `collected_at`. Point.
-- Les impayés existent — un virement promis, une patiente partie sans régler —
-- mais ce sont des EXCEPTIONS : ils vivent dans le panneau Attention et dans
-- l'onglet Séances & paiements, jamais en tête d'écran comme un second total.
--
-- ═══ RÈGLE : AUCUNE ARITHMÉTIQUE EN REACT ═════════════════════════════════
-- Tout ce qui s'affiche sort d'ici DÉJÀ CALCULÉ — y compris les pourcentages
-- de répartition (`part_pct`) et les largeurs de barre. Un chiffre recalculé
-- dans le navigateur est un chiffre qui peut diverger de la base.
--
-- ═══ 🔴 AUCUN `DROP` ══════════════════════════════════════════════════════
-- Un `DROP FUNCTION` emporte le PROPRIÉTAIRE et une porte DEFINER revient à
-- `postgres`, rôle `rolbypassrls` : la cloison ADR-005 tomberait pendant que la
-- migration resterait verte (faute de 018, rejouée en 024 et 025).
-- `CREATE OR REPLACE` uniquement, `ALTER FUNCTION … OWNER TO app_gatekeeper`
-- IMMÉDIATEMENT après chaque création.

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;
GRANT SELECT ON app.charges TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 1 · L'ÉQUIVALENT MENSUEL D'UNE CHARGE — la règle d'imputation, en SQL
-- ---------------------------------------------------------------------------
-- ⚠️ RÈGLE D'IMPUTATION DES CHARGES, écrite ici et nulle part ailleurs :
--
--   · Une charge PONCTUELLE compte dans la période qui contient sa
--     `date_charge`. Rien avant, rien après, jamais de fraction.
--
--   · Une charge RÉCURRENTE verse sa part MENSUELLE NORMALISÉE à chaque mois
--     qu'elle recouvre :
--         mensuelle     → montant
--         trimestrielle → montant / 3
--         annuelle      → montant / 12
--     Une charge trimestrielle de 30 000 pèse donc 10 000 sur chacun des trois
--     mois, et non 30 000 sur celui où elle tombe : sinon le résultat net d'un
--     mois sur trois serait faux de 20 000 et la courbe d'évolution ferait un
--     accident qui n'existe pas dans la trésorerie du cabinet.
--
--   · Sur une période qui n'est pas un mois entier, la part récurrente est
--     PRORATISÉE au nombre de jours recouverts dans chaque mois traversé.
--
-- Une charge n'est comptée qu'à partir de sa `date_charge` (son début) et
-- seulement si elle est `actif`.
CREATE OR REPLACE FUNCTION app.charge_equivalent_mensuel(
  p_montant   integer,
  p_type      app.charge_type,
  p_frequence app.charge_frequence)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           WHEN p_type = 'ponctuelle' THEN 0::numeric
           WHEN p_frequence = 'mensuelle'     THEN p_montant::numeric
           WHEN p_frequence = 'trimestrielle' THEN p_montant::numeric / 3
           WHEN p_frequence = 'annuelle'      THEN p_montant::numeric / 12
           ELSE 0::numeric
         END;
$$;

COMMENT ON FUNCTION app.charge_equivalent_mensuel(integer, app.charge_type, app.charge_frequence) IS
  '039. Part mensuelle normalisée d''une charge récurrente : mensuelle ×1, '
  'trimestrielle ÷3, annuelle ÷12. Une ponctuelle rend 0 — elle s''impute en '
  'entier sur la période de sa `date_charge`, pas en fractions mensuelles.';

REVOKE ALL ON FUNCTION app.charge_equivalent_mensuel(integer, app.charge_type, app.charge_frequence) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.charge_equivalent_mensuel(integer, app.charge_type, app.charge_frequence) TO authenticated;

-- Charges imputées sur un intervalle de dates quelconque.
-- Récurrentes : somme, mois par mois, de la part mensuelle proratisée aux jours
-- recouverts. Ponctuelles : montant entier si `date_charge` tombe dedans.
CREATE OR REPLACE FUNCTION app.charges_sur_periode(p_from date, p_to date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  WITH ponctuelles AS (
    SELECT COALESCE(SUM(c.montant_dzd), 0)::numeric AS total
      FROM app.charges c
     WHERE c.cabinet_id = app.current_cabinet()
       AND c.actif
       AND c.type = 'ponctuelle'
       AND c.date_charge BETWEEN p_from AND p_to
  ),
  -- Chaque mois traversé par la période, et la fraction de ce mois recouverte.
  mois AS (
    SELECT m::date                                                   AS debut_mois,
           (m + interval '1 month')::date                            AS fin_mois,
           GREATEST(m::date, p_from)                                 AS debut_eff,
           LEAST((m + interval '1 month' - interval '1 day')::date, p_to) AS fin_eff
      FROM generate_series(date_trunc('month', p_from::timestamp),
                           date_trunc('month', p_to::timestamp),
                           interval '1 month') AS g(m)
  ),
  recurrentes AS (
    SELECT COALESCE(SUM(
             app.charge_equivalent_mensuel(c.montant_dzd, c.type, c.frequence)
             * ((mo.fin_eff - mo.debut_eff + 1)::numeric
                / (mo.fin_mois - mo.debut_mois)::numeric)
           ), 0)::numeric AS total
      FROM mois mo
      JOIN app.charges c
        ON c.cabinet_id = app.current_cabinet()
       AND c.actif
       AND c.type = 'recurrente'
       AND c.date_charge <= mo.fin_eff
     WHERE mo.fin_eff >= mo.debut_eff
  )
  SELECT (SELECT total FROM ponctuelles) + (SELECT total FROM recurrentes);
$$;

ALTER FUNCTION app.charges_sur_periode(date, date) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.charges_sur_periode(date, date) IS
  '039. Charges imputées sur un intervalle, selon la règle documentée en tête '
  'de `app.charge_equivalent_mensuel` : ponctuelle entière sur sa période, '
  'récurrente proratisée au jour sur chaque mois traversé.';

REVOKE ALL ON FUNCTION app.charges_sur_periode(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.charges_sur_periode(date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2 · LA PORTE DE L'ONGLET « VUE D'ENSEMBLE » — une seule, pour tout l'écran
-- ---------------------------------------------------------------------------
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
  v_evolution     jsonb;
  v_par_type      jsonb;
  v_par_categorie jsonb;
  v_calendrier    jsonb;
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

  -- L'ASSISTANTE REND `NULL`, PAS UNE ERREUR (même raisonnement qu'en 036) :
  -- un écran vide ne lui apprend rien ; une exception lui apprendrait qu'il y a
  -- un chiffre à ne pas voir.
  IF v_role NOT IN ('owner', 'practitioner') THEN
    RETURN NULL;
  END IF;

  -- Bornes converties en CONSTANTES, pour que les index restent utilisables.
  -- Jamais `collected_at AT TIME ZONE …` dans un WHERE (029 §1bis).
  v_debut      := p_period_start::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin        := (p_period_end + 1)::timestamp AT TIME ZONE 'Africa/Algiers';
  v_aujourdhui := (now() AT TIME ZONE 'Africa/Algiers')::date;

  -- ═══ PULSE ═══════════════════════════════════════════════════════════════
  -- UNE SEULE définition de la recette : `collected_at` dans la fenêtre.
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

  -- Jamais de division par zéro : sans séance, le panier moyen est NULL et
  -- l'écran affiche « — ». Jamais NaN, jamais 0 (0 serait un chiffre faux).
  v_panier := CASE WHEN v_seances = 0 THEN NULL
                   ELSE round(v_revenu_per::numeric / v_seances) END;

  v_charges := round(app.charges_sur_periode(p_period_start, p_period_end));

  -- Les impayés ne sont PAS bornés à la période : une somme due reste due, et
  -- la question posée par l'écran est « qu'est-ce qui reste impayé », pas
  -- « qu'est-ce qui est resté impayé entre deux dates ».
  SELECT COALESCE(SUM(p.amount_dzd), 0)::bigint,
         COUNT(*)::bigint,
         MAX((v_aujourdhui - (p.created_at AT TIME ZONE 'Africa/Algiers')::date))::integer
    INTO v_impaye_total, v_impaye_nb, v_impaye_age
    FROM app.payments p
   WHERE p.cabinet_id = app.current_cabinet()
     AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
     AND p.collected_at IS NULL;

  -- ═══ ÉVOLUTION — SIX SEAUX MENSUELS, jamais journaliers ══════════════════
  -- Le grain mensuel est IMPOSÉ : à ~5 séances par jour, un graphe journalier
  -- sur un mois affiche deux barres et vingt-neuf trous, ce qui se lit comme
  -- une panne d'affichage. Six mois, c'est une tendance.
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
             'mois_label',   to_char(r.debut, 'TMMon'),
             'mois_iso',     to_char(r.debut, 'YYYY-MM'),
             'revenu',       r.revenu,
             'charges',      round(app.charges_sur_periode(r.debut, r.fin))::bigint,
             'resultat_net', (r.revenu - round(app.charges_sur_periode(r.debut, r.fin)))::bigint
           ) ORDER BY r.debut), '[]'::jsonb)
    INTO v_evolution
    FROM revenus r;

  -- ═══ COMPOSITION — d'où vient l'argent, où il part ═══════════════════════
  -- `part_pct` est calculé ICI. React ne divise rien.
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

  -- Même règle d'imputation qu'au §1, appliquée catégorie par catégorie :
  -- ponctuelle en entier sur sa période, récurrente proratisée au jour sur
  -- chaque mois traversé. L'expansion en mois est reprise à l'identique de
  -- `app.charges_sur_periode` pour que les parts somment bien au total.
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

  -- ═══ CALENDRIER — une cellule par jour de la période ═════════════════════
  -- `montant` = argent ENTRÉ ce jour-là (`collected_at`).
  -- `a_impaye` = une séance tarifée ce jour-là est restée impayée
  --              (`created_at` + `collected_at IS NULL`) — c'est le seul
  --              endroit où les deux fenêtres coexistent, et c'est assumé :
  --              un impayé n'a par définition pas de date d'encaissement.
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

  -- ═══ ATTENTION — les trois prochaines échéances ══════════════════════════
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

  -- Zéro ligne rend des zéros et des tableaux vides — JAMAIS `null`. L'écran
  -- affiche alors un état vide propre, et non un état cassé.
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
    'attention',   jsonb_build_object(
      'impayes_total',           v_impaye_total,
      'impayes_count',           v_impaye_nb,
      'echeances_a_venir',       v_echeances,
      'plus_ancien_impaye_jours', v_impaye_age
    )
  );
END;
$$;

ALTER FUNCTION app.get_finance_overview(date, date) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.get_finance_overview(date, date) IS
  '039. LA porte de l''onglet Vue d''ensemble — une seule, pour tout l''écran. '
  'Comptabilité de CAISSE : la recette est `app.payments` fenêtrée sur '
  '`collected_at`, il n''y a pas de « facturé ». Tout arrive déjà calculé, '
  'pourcentages compris. L''assistante rend NULL, pas une erreur. Bornes en '
  'Africa/Algiers, plage <= 366 jours.';

REVOKE ALL ON FUNCTION app.get_finance_overview(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_finance_overview(date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · ONGLET « CHARGES » — une porte
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.get_charges_list(p_period_start date, p_period_end date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_role       app.user_role;
  v_lignes     jsonb;
  v_tot_recur  bigint;
  v_tot_ponct  bigint;
BEGIN
  IF p_period_start IS NULL OR p_period_end IS NULL THEN RETURN NULL; END IF;

  v_role := app.current_role();
  IF v_role NOT IN ('owner', 'practitioner') THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id',                      c.id,
             'intitule',                c.intitule,
             'categorie',               c.categorie::text,
             'montant',                 c.montant_dzd,
             'type',                    c.type::text,
             'frequence',               c.frequence::text,
             'date_charge',             to_char(c.date_charge, 'YYYY-MM-DD'),
             'date_prochaine_echeance', to_char(c.date_prochaine_echeance, 'YYYY-MM-DD')
           ) ORDER BY c.type, c.montant_dzd DESC, c.intitule), '[]'::jsonb)
    INTO v_lignes
    FROM app.charges c
   WHERE c.cabinet_id = app.current_cabinet()
     AND c.actif;

  -- ⚠️ DEUX TOTAUX SÉPARÉS, JAMAIS ADDITIONNÉS. Un total mensuel récurrent et
  -- un total de dépenses ponctuelles de la période ne sont pas la même unité :
  -- l'un est un rythme, l'autre un événement. Les sommer produirait un nombre
  -- qui ne veut rien dire et sur lequel la médecin déciderait quand même.
  SELECT COALESCE(SUM(app.charge_equivalent_mensuel(c.montant_dzd, c.type, c.frequence)), 0)::bigint
    INTO v_tot_recur
    FROM app.charges c
   WHERE c.cabinet_id = app.current_cabinet() AND c.actif AND c.type = 'recurrente';

  SELECT COALESCE(SUM(c.montant_dzd), 0)::bigint
    INTO v_tot_ponct
    FROM app.charges c
   WHERE c.cabinet_id = app.current_cabinet() AND c.actif AND c.type = 'ponctuelle'
     AND c.date_charge BETWEEN p_period_start AND p_period_end;

  RETURN jsonb_build_object(
    'lignes',                 v_lignes,
    'total_recurrent_mensuel', v_tot_recur,
    'total_ponctuel_periode',  v_tot_ponct
  );
END;
$$;

ALTER FUNCTION app.get_charges_list(date, date) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.get_charges_list(date, date) IS
  '039. Onglet Charges. Rend DEUX totaux distincts — le rythme mensuel '
  'récurrent et les dépenses ponctuelles de la période — jamais leur somme, '
  'qui n''aurait pas d''unité.';

REVOKE ALL ON FUNCTION app.get_charges_list(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_charges_list(date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · ONGLET « SÉANCES & PAIEMENTS » — une porte, qui TRACE
-- ---------------------------------------------------------------------------
-- Même patron en trois temps que `app.list_period_payments` (036) : les
-- identités ne sont lues QU'APRÈS que la trace `liste` a été écrite (règle 6,
-- 026 §6, 029 §5). La trace ne couvre que les patientes de la page demandée.
CREATE OR REPLACE FUNCTION app.get_sessions_payments_list(
  p_period_start date,
  p_period_end   date,
  p_limit        integer DEFAULT 50,
  p_offset       integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_role     app.user_role;
  v_debut    timestamptz;
  v_fin      timestamptz;
  v_limit    integer;
  v_offset   integer;
  v_ids      uuid[];
  v_total    bigint;
  v_imp_tot  bigint;
  v_imp_nb   bigint;
  v_pat      uuid;
  v_lignes   jsonb;
BEGIN
  IF p_period_start IS NULL OR p_period_end IS NULL THEN RETURN NULL; END IF;

  v_role := app.current_role();
  IF v_role NOT IN ('owner', 'practitioner') THEN RETURN NULL; END IF;

  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_debut  := p_period_start::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin    := (p_period_end + 1)::timestamp AT TIME ZONE 'Africa/Algiers';

  -- (1) La page, par identifiants seulement — aucune identité lue ici.
  -- Fenêtre sur `created_at` : cet onglet liste les SÉANCES TARIFÉES de la
  -- période, payées ou non. Un impayé n'a pas de `collected_at` — le fenêtrer
  -- sur l'encaissement le ferait disparaître de la seule liste qui le montre.
  SELECT array_agg(s.id ORDER BY s.created_at DESC, s.id), MAX(s.total)
    INTO v_ids, v_total
    FROM (
      SELECT p.id, p.created_at, COUNT(*) OVER () AS total
        FROM app.payments p
       WHERE p.cabinet_id = app.current_cabinet()
         AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
         AND p.created_at >= v_debut
         AND p.created_at <  v_fin
       ORDER BY p.created_at DESC, p.id
       LIMIT v_limit OFFSET v_offset
    ) s;

  SELECT COALESCE(SUM(p.amount_dzd), 0)::bigint, COUNT(*)::bigint
    INTO v_imp_tot, v_imp_nb
    FROM app.payments p
   WHERE p.cabinet_id = app.current_cabinet()
     AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
     AND p.created_at >= v_debut
     AND p.created_at <  v_fin
     AND p.collected_at IS NULL;

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('lignes', '[]'::jsonb, 'total', 0,
                              'impayes_total', v_imp_tot, 'impayes_count', v_imp_nb);
  END IF;

  -- (2) LA TRACE, AVANT toute lecture d'identité.
  FOR v_pat IN SELECT DISTINCT p.patient_id FROM app.payments p WHERE p.id = ANY(v_ids)
  LOOP
    PERFORM audit.log_read(v_pat, 'liste');
  END LOOP;

  -- (3) Seulement maintenant, les noms.
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id',             p.id,
             'date',           to_char(p.created_at AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD"T"HH24:MI'),
             'patient',        btrim(COALESCE(pt.first_name, '') || ' ' || COALESCE(pt.last_name, '')),
             'type',           COALESCE(a.kind::text, ''),
             'montant',        p.amount_dzd,
             'mode',           p.method::text,
             'receipt_number', p.receipt_number,
             'paye',           (p.collected_at IS NOT NULL)
           ) ORDER BY p.created_at DESC, p.id), '[]'::jsonb)
    INTO v_lignes
    FROM app.payments p
    LEFT JOIN app.patients     pt ON pt.id = p.patient_id
    LEFT JOIN app.consultations c ON c.id = p.consultation_id
    LEFT JOIN app.appointments  a ON a.id = c.appointment_id
   WHERE p.id = ANY(v_ids);

  RETURN jsonb_build_object(
    'lignes',        v_lignes,
    'total',         COALESCE(v_total, 0),
    'impayes_total', v_imp_tot,
    'impayes_count', v_imp_nb
  );
END;
$$;

ALTER FUNCTION app.get_sessions_payments_list(date, date, integer, integer) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.get_sessions_payments_list(date, date, integer, integer) IS
  '039. Onglet Séances & paiements. Fenêtrée sur `created_at` — c''est la seule '
  'liste où un impayé doit apparaître, et un impayé n''a pas de date '
  'd''encaissement. Trace `liste` dans audit.log AVANT toute lecture de nom.';

REVOKE ALL ON FUNCTION app.get_sessions_payments_list(date, date, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_sessions_payments_list(date, date, integer, integer) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('039_finance_cash')
  ON CONFLICT DO NOTHING;

COMMIT;
