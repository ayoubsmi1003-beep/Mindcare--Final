-- 036_finance_period_gates — V6-FINANCE (D-23). Les portes de PÉRIODE.
--
-- ADDITIF PUR. Ne modifie ni 011, ni 029, ni aucune policy, ni aucune porte
-- existante. `app.day_revenue` et `app.list_day_payments` sortent de cette
-- migration EXACTEMENT telles que 029 les a laissées — c'est le contrôle de
-- non-régression le plus fort dont on dispose : `finance_overview(d, d)` doit
-- rendre les mêmes chiffres que `day_revenue(d)`.
--
-- ═══ POURQUOI 036 ET PAS 035 ══════════════════════════════════════════════
-- `035` est réservé DEUX FOIS dans STATE.md pour le correctif d'ordre de
-- `app.search_patients`. Prendre ce numéro obligerait à renuméroter le jour où
-- ce correctif arrive — or une migration ne se renumérote pas.
--
-- ═══ 🔴 AUCUN `DROP`. LA RAISON EST UNE FAUTE DÉJÀ COMMISE TROIS FOIS ══════
-- Un `DROP FUNCTION` emporte le PROPRIÉTAIRE. À la recréation, une porte
-- SECURITY DEFINER revient à `postgres`, rôle `rolbypassrls` — et la cloison
-- ADR-005 tombe PENDANT QUE LA MIGRATION RESTE VERTE. C'est la faute de 018,
-- rejouée en 024 et 025, documentée en 026 §4 et en tête de 029.
-- Ici : `CREATE OR REPLACE` uniquement, et `ALTER FUNCTION … OWNER TO
-- app_gatekeeper` suit IMMÉDIATEMENT chaque création, dans ce fichier.
--
-- ═══ CE QUE CES PORTES NE FONT PAS ════════════════════════════════════════
-- Elles ne testent AUCUN rôle pour décider d'un DROIT : `app_gatekeeper` n'a
-- pas `BYPASSRLS` (020, 021), donc les policies de 011 s'appliquent sous elles
-- et `auth.uid()` reste celui de l'appelante. Le `v_role` lu ci-dessous sert à
-- deux choses seulement : nommer le périmètre à l'écran (`perimetre`), et
-- RESTREINDRE davantage (par-dessus la RLS, jamais à sa place) — deux
-- barrières, pas une. Motif 029 §4, mot pour mot.
--
-- ═══ CHARGES, RÉSULTAT NET, OBJECTIFS : ABSENTS, ET C'EST ÉCRIT ═══════════
-- `app.payments` est la SEULE table financière du dépôt (ADR-010 : espèces,
-- aucune facture légale). Il n'existe ni table de charges, ni remboursement, ni
-- annulation, ni objectif. Aucune de ces notions n'est calculée ni approchée
-- ici : les cinq dettes correspondantes sont datées dans DOC-AUTHORITY.md §4.
-- Un « résultat net » rendu par cette porte serait un montant BRUT sous une
-- étiquette NETTE — exactement le défaut que 029 a évité en nommant `perimetre`.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0 · Privilège nécessaire au transfert de propriété, retiré au §5
-- ---------------------------------------------------------------------------
-- Symétrie obligatoire DANS CE FICHIER (motif 026 §3, 029 §0) : `ALTER FUNCTION
-- … OWNER TO app_gatekeeper` exige que LE NOUVEAU PROPRIÉTAIRE possède CREATE
-- sur le schéma. Une migration qui l'oublie hérite d'un rôle déjà refermé par
-- 029 §6 et échoue en 42501, après une longue série de migrations vertes.
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 1 · Privilèges NOMMÉS, jamais hérités
-- ---------------------------------------------------------------------------
-- 029 §1 a déjà nommé `app.payments`, `app.consultations` et `app.profiles`.
-- Deux relations NOUVELLES entrent ici, et elles sont nommées pour la même
-- raison qu'en 026 §3 : un héritage tacite depuis `authenticated` peut être
-- retiré par une migration future sans que personne voie ce qu'elle casse.
GRANT SELECT ON app.appointments TO app_gatekeeper;   -- §3, composition par `kind`
GRANT SELECT ON audit.log        TO app_gatekeeper;   -- §3, points d'attention

-- ⚠️ CE `GRANT SELECT ON audit.log` N'OUVRE RIEN À PERSONNE, et il faut dire
-- pourquoi plutôt que de le laisser croire. `audit_read_owner` (013) filtre sur
-- `app.current_role() = 'owner'` et s'applique SOUS cette porte, puisque
-- `app_gatekeeper` n'a pas `BYPASSRLS`. Une praticienne qui appelle
-- `finance_overview` ne lit donc AUCUNE ligne d'audit — la porte le redit
-- explicitement au §3, mais c'est la RLS qui décide, ici comme partout.

-- ---------------------------------------------------------------------------
-- 1bis · L'index qui manquait — `collected_at` n'était indexé nulle part
-- ---------------------------------------------------------------------------
-- 011 pose `(practitioner_id, created_at DESC)`, 029 pose
-- `(cabinet_id, created_at DESC)`. Les deux servent l'assiette « facturé ».
-- AUCUN ne sert une fenêtre sur `collected_at` — or l'encaissé de la période
-- (comptabilité de caisse) se borne sur CETTE colonne. Sans cet index, la
-- question « combien est réellement entré en caisse ce mois-ci » devient un
-- balayage séquentiel.
--
-- PARTIEL, et ce n'est pas une micro-optimisation : une ligne non encaissée n'a
-- rien à offrir à cet index, et l'écarter garde l'index petit — donc en cache —
-- exactement sur la population qu'il sert.
CREATE INDEX IF NOT EXISTS payments_cabinet_collected
  ON app.payments (cabinet_id, collected_at DESC)
  WHERE collected_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2 · La variation d'une période à l'autre — fonction PURE, testable seule
-- ---------------------------------------------------------------------------
-- Sortie en fonction plutôt qu'en trois copies inline, parce qu'elle est
-- appelée trois fois et qu'une règle de comparaison recopiée trois fois finit
-- par diverger sur l'une des trois — le raisonnement de `formaterDzd` côté
-- TypeScript, transposé au SQL.
--
-- ⚠️ `pourcentage` EST NULL QUAND LE PRÉCÉDENT VAUT ZÉRO. Pas 0, pas 100, pas
-- l'infini. Diviser par zéro pour afficher « +∞ % » ou « +100 % » sur un
-- premier mois d'activité serait un chiffre inventé sous un signe de
-- pourcentage. `sens = 'nouveau'` dit la vérité : il y a quelque chose
-- maintenant, il n'y avait rien avant, et aucun ratio ne décrit ça.
--
-- Aucun accès à une table : ni RLS, ni propriétaire particulier à prévoir.
CREATE OR REPLACE FUNCTION app.finance_variation(
  p_courant   numeric,
  p_precedent numeric,
  p_jours     integer)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'sens',
      CASE
        WHEN p_courant IS NULL OR p_precedent IS NULL THEN 'indisponible'
        WHEN p_precedent = 0 AND p_courant = 0        THEN 'stable'
        WHEN p_precedent = 0                          THEN 'nouveau'
        WHEN p_courant = p_precedent                  THEN 'stable'
        WHEN p_courant > p_precedent                  THEN 'hausse'
        ELSE 'baisse'
      END,
    'pourcentage',
      CASE
        WHEN p_courant IS NULL OR p_precedent IS NULL THEN NULL
        WHEN p_precedent = 0                          THEN NULL
        ELSE round(100.0 * (p_courant - p_precedent) / p_precedent, 1)
      END,
    'joursCompares', p_jours);
$$;

COMMENT ON FUNCTION app.finance_variation(numeric, numeric, integer) IS
  'V6-FINANCE. La comparaison de deux périodes, en UN seul endroit. Rend '
  '`pourcentage` NULL quand le précédent vaut zéro — jamais l''infini, jamais '
  '100 % : sur un premier mois d''activité, aucun ratio ne décrit « il n''y '
  'avait rien avant ». `sens` vaut alors ''nouveau'', et l''écran affiche « — ».';

REVOKE ALL ON FUNCTION app.finance_variation(numeric, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finance_variation(numeric, numeric, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · L'aperçu financier d'une période — SECURITY DEFINER, la cloison ADR-005
-- ---------------------------------------------------------------------------
-- UN SEUL APPEL POUR TOUT L'ÉCRAN. 06-PERF-BUDGET §2 plafonne `/finances` à UN
-- appel réseau, et §3 prescrit nommément « une porte SQL par écran, qui rend
-- tout en une fois ». Depuis Alger, à ~180 ms d'aller-retour, six agrégats en
-- six appels coûteraient une seconde avant le premier chiffre.
--
-- POURQUOI `jsonb` ET PAS `RETURNS TABLE`. La réponse est hétérogène : quatre
-- scalaires, trois tableaux de formes différentes, trois objets de variation.
-- Un `RETURNS TABLE` l'aplatirait en colonnes nullables dont la moitié serait
-- vide sur chaque ligne — une forme que ni l'appelant ni le relecteur ne
-- saurait lire. Le contrat est tenu côté TypeScript par un schéma Zod, au même
-- titre qu'une entrée de formulaire.
--
-- CETTE PORTE NE NOMME PERSONNE. Aucune jointure sur `app.patients`, aucun
-- `patient_id` rendu — donc AUCUNE trace de lecture, exactement comme
-- `day_revenue` (029 §4) et `get_consultation_payment` (029 §2bis). Journaliser
-- une ouverture de dossier à chaque affichage d'un graphique noierait
-- `audit.log` sous de fausses lectures, ce qu'I4 interdit. La lecture
-- NOMINATIVE est au §4, elle est explicite, et elle trace.
--
-- L'ASSISTANTE REND `NULL`, PAS UNE ERREUR. Un écran vide, comme en 029 §4. Une
-- exception lui apprendrait qu'il y a un chiffre à ne pas voir.
CREATE OR REPLACE FUNCTION app.finance_overview(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_role        app.user_role;
  v_perimetre   text;
  v_debut       timestamptz;  v_fin       timestamptz;
  v_debut_prec  timestamptz;  v_fin_prec  timestamptz;
  v_aujourdhui  date;
  v_jours       integer;      v_jours_ecoules integer;
  v_prec_from   date;         v_prec_to   date;
  v_grain       text;         v_grain_sql text;
  -- assiette « facturé » de la période courante
  v_facture     bigint; v_encaisse_assiette bigint; v_attente bigint;
  v_attente_nb  bigint; v_seances bigint;
  -- comptabilité de caisse (fenêtre sur collected_at)
  v_encaisse_periode bigint;
  -- période de comparaison
  v_facture_p   bigint; v_encaisse_assiette_p bigint;
  v_encaisse_periode_p bigint; v_seances_p bigint;
  v_taux        numeric; v_taux_p numeric;
  v_serie       jsonb; v_par_type jsonb; v_par_prat jsonb;
  v_points      jsonb := '[]'::jsonb;
  v_corrections bigint := 0;
BEGIN
  -- Arguments absents : rien à afficher, et ce n'est pas une erreur.
  IF p_from IS NULL OR p_to IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_to < p_from THEN
    RAISE EXCEPTION 'Période invalide : la borne haute doit suivre la borne basse.';
  END IF;

  -- ⚠️ PLAGE BORNÉE EN BASE, comme les 62 jours de `list_agenda` (ADR-021) et
  -- le `p_limit <= 100` de `search_patients`. Une plage que l'appelant choisit
  -- sans limite n'est pas un écran de finances : c'est un export de la caisse
  -- par la porte de service. 366 jours couvrent « cette année » bissextile.
  IF (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'Période trop large : 366 jours au maximum.'
      USING HINT = 'Un écran de finances se lit sur une période bornée ; au-delà, c''est un export.';
  END IF;

  v_role := app.current_role();

  -- Zéro ligne AVANT tout calcul. L'assistante et le patient n'ont rien à lire
  -- ici, et le dire par NULL plutôt que par une exception est délibéré (029 §4).
  IF v_role NOT IN ('owner', 'practitioner') THEN
    RETURN NULL;
  END IF;

  v_perimetre := CASE WHEN v_role = 'owner' THEN 'cabinet' ELSE 'praticienne' END;

  -- ⚠️ LA JOURNÉE EST CELLE DU CABINET, PAS CELLE DU SERVEUR. Postgres tourne
  -- en UTC ; Alger est à UTC+1. `p_from::timestamptz` donnerait minuit UTC, soit
  -- 01:00 à Alger, et une séance tarifée entre minuit et 1 h tomberait dans la
  -- période précédente. Les DEUX bornes restent des CONSTANTES : les index
  -- `payments_cabinet_day` et `payments_cabinet_collected` restent utilisables,
  -- contrairement à un `created_at AT TIME ZONE …` qui transformerait la colonne.
  v_debut := p_from::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin   := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Algiers';

  -- ═══ LA FENÊTRE DE COMPARAISON ═══════════════════════════════════════════
  -- À DURÉE ÉGALE, jamais « le mois calendaire précédent ». Comparer 28 jours de
  -- février à 31 jours de janvier produit un −10 % qui ne décrit que le
  -- calendrier. Le nombre de jours comparés est RENDU à l'écran
  -- (`joursCompares`) pour que la comparaison soit lisible au lieu d'être devinée.
  v_jours := (p_to - p_from) + 1;
  v_aujourdhui := (now() AT TIME ZONE 'Africa/Algiers')::date;

  -- PÉRIODE EN COURS : une période incomplète comparée à une période complète
  -- est un faux négatif garanti — « le mois est en baisse » le 3 du mois. On
  -- tronque donc la fenêtre précédente à la même FRACTION ÉCOULÉE.
  v_jours_ecoules := CASE
    WHEN p_to >= v_aujourdhui AND p_from <= v_aujourdhui
      THEN GREATEST(1, (v_aujourdhui - p_from) + 1)
    ELSE v_jours
  END;

  v_prec_from := p_from - v_jours;                          -- une période complète en arrière
  v_prec_to   := v_prec_from + (v_jours_ecoules - 1);       -- puis la même fraction écoulée
  v_debut_prec := v_prec_from::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin_prec   := (v_prec_to + 1)::timestamp AT TIME ZONE 'Africa/Algiers';

  -- ═══ LE GRAIN EST DÉCIDÉ EN BASE ═════════════════════════════════════════
  -- Pour que l'écran ne puisse pas en demander un pathologique : 366 points
  -- quotidiens dans un graphique de 900 px sont un aplat, pas une courbe.
  v_grain := CASE WHEN v_jours <= 31  THEN 'jour'
                  WHEN v_jours <= 120 THEN 'semaine'
                  ELSE 'mois' END;
  v_grain_sql := CASE v_grain WHEN 'jour'    THEN 'day'
                              WHEN 'semaine' THEN 'week'
                              ELSE 'month' END;

  -- ═══ ASSIETTE « FACTURÉ » — fenêtre sur created_at ═══════════════════════
  SELECT COALESCE(SUM(p.amount_dzd), 0)::bigint,
         COALESCE(SUM(p.amount_dzd) FILTER (WHERE p.collected_at IS NOT NULL), 0)::bigint,
         COALESCE(SUM(p.amount_dzd) FILTER (WHERE p.collected_at IS NULL), 0)::bigint,
         COUNT(*) FILTER (WHERE p.collected_at IS NULL)::bigint,
         COUNT(*)::bigint
    INTO v_facture, v_encaisse_assiette, v_attente, v_attente_nb, v_seances
    FROM app.payments p
   WHERE p.cabinet_id = app.current_cabinet()
     AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
     AND p.created_at >= v_debut
     AND p.created_at <  v_fin;

  SELECT COALESCE(SUM(p.amount_dzd), 0)::bigint,
         COALESCE(SUM(p.amount_dzd) FILTER (WHERE p.collected_at IS NOT NULL), 0)::bigint,
         COUNT(*)::bigint
    INTO v_facture_p, v_encaisse_assiette_p, v_seances_p
    FROM app.payments p
   WHERE p.cabinet_id = app.current_cabinet()
     AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
     AND p.created_at >= v_debut_prec
     AND p.created_at <  v_fin_prec;

  -- ═══ COMPTABILITÉ DE CAISSE — fenêtre sur collected_at ═══════════════════
  -- ⚠️ CE N'EST PAS LA MÊME COLONNE DE FENÊTRE, ET CE N'EST PAS UNE ERREUR.
  -- Une séance tarifée le 31 janvier et encaissée le 1er février compte dans le
  -- « facturé » de janvier ET dans l'« encaissé » de février. Les deux sont
  -- vrais. C'est précisément pour ça que le TAUX d'encaissement se calcule sur
  -- `v_encaisse_assiette` (même assiette que le facturé) et JAMAIS sur
  -- `v_encaisse_periode` — un ratio entre deux fenêtres différentes peut
  -- dépasser 100 % et ne veut rien dire.
  SELECT COALESCE(SUM(p.amount_dzd), 0)::bigint
    INTO v_encaisse_periode
    FROM app.payments p
   WHERE p.cabinet_id = app.current_cabinet()
     AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
     AND p.collected_at >= v_debut
     AND p.collected_at <  v_fin;

  SELECT COALESCE(SUM(p.amount_dzd), 0)::bigint
    INTO v_encaisse_periode_p
    FROM app.payments p
   WHERE p.cabinet_id = app.current_cabinet()
     AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
     AND p.collected_at >= v_debut_prec
     AND p.collected_at <  v_fin_prec;

  -- Taux : NULL quand l'assiette est vide. Jamais 0 %, qui se lirait « elle n'a
  -- rien encaissé » là où la vérité est « elle n'a rien facturé ».
  v_taux   := CASE WHEN v_facture   = 0 THEN NULL
                   ELSE round(100.0 * v_encaisse_assiette   / v_facture,   1) END;
  v_taux_p := CASE WHEN v_facture_p = 0 THEN NULL
                   ELSE round(100.0 * v_encaisse_assiette_p / v_facture_p, 1) END;

  -- ═══ LA SÉRIE TEMPORELLE ═════════════════════════════════════════════════
  -- `generate_series` À GAUCHE, agrégat à droite : les seaux VIDES sortent avec
  -- des zéros au lieu d'être absents. Un jour sans séance est un FAIT, et la
  -- courbe doit toucher zéro ce jour-là plutôt que de sauter — un saut se lit
  -- comme une interpolation, c'est-à-dire comme une donnée qui n'existe pas.
  --
  -- ⚠️ `date_trunc` EST APPLIQUÉ ICI À L'INTÉRIEUR DE L'AGRÉGAT, sur des lignes
  -- DÉJÀ filtrées par la plage bornée. L'interdit de 029 §1bis porte sur le
  -- `WHERE` — transformer la colonne dans le prédicat écarte l'index. Le
  -- GROUP BY, lui, ne voit que les lignes que l'index a déjà rendues.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'debut',       to_char(g.seau, 'YYYY-MM-DD'),
             'factureDzd',  COALESCE(s.facture,  0),
             'encaisseDzd', COALESCE(s.encaisse, 0),
             'attenteDzd',  COALESCE(s.attente,  0),
             'seances',     COALESCE(s.seances,  0))
           ORDER BY g.seau), '[]'::jsonb)
    INTO v_serie
    FROM generate_series(
           date_trunc(v_grain_sql, p_from::timestamp),
           date_trunc(v_grain_sql, p_to::timestamp),
           ('1 ' || v_grain_sql)::interval) AS g(seau)
    LEFT JOIN (
      SELECT date_trunc(v_grain_sql, p.created_at AT TIME ZONE 'Africa/Algiers') AS seau,
             SUM(p.amount_dzd)::bigint AS facture,
             COALESCE(SUM(p.amount_dzd) FILTER (WHERE p.collected_at IS NOT NULL), 0)::bigint AS encaisse,
             COALESCE(SUM(p.amount_dzd) FILTER (WHERE p.collected_at IS NULL), 0)::bigint AS attente,
             COUNT(*)::bigint AS seances
        FROM app.payments p
       WHERE p.cabinet_id = app.current_cabinet()
         AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
         AND p.created_at >= v_debut
         AND p.created_at <  v_fin
       GROUP BY 1) s ON s.seau = g.seau;

  -- ═══ D'OÙ VIENT LE REVENU — composition par type de consultation ═════════
  -- ⚠️ TROIS SAUTS NULLABLES SÉPARENT UN PAIEMENT DE SON TYPE :
  --   payments.consultation_id     → nullable (011)
  --   consultations.appointment_id → nullable (007)
  --   appointments.kind            → nullable PAR DÉCISION (024)
  -- Le seau `__non_rattache__` n'est donc PAS un cas d'erreur : c'est ce qui
  -- fait tenir l'invariant « la somme des parts égale le facturé ». Le masquer
  -- donnerait un graphique qui ne totalise pas le chiffre affiché au-dessus.
  --
  -- ⚠️ LES DEUX `LEFT JOIN` S'EXÉCUTENT SOUS LA RLS DE L'APPELANTE, y compris
  -- dans cette fonction DEFINER — `app_gatekeeper` n'a pas `BYPASSRLS`. Une
  -- praticienne dont la RLS masque la consultation d'une consœur verra ce
  -- paiement (s'il est sien) tomber en « Non rattaché ». Le total réconcilie
  -- quand même. C'est le comportement voulu, et il est vérifié par contrôle.
  --
  -- AUCUN LIBELLÉ N'EST RENDU ICI : la traduction vit dans `src/i18n/fr.ts`
  -- (ADR-008). Une porte SQL qui rendrait « Thérapie de couple » mettrait du
  -- français dans la base et deux sources pour un même mot.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'cle',         t.cle,
             'montantDzd',  t.montant,
             'seances',     t.seances,
             'nonRattache', t.cle = '__non_rattache__')
           ORDER BY (t.cle = '__non_rattache__'), t.montant DESC, t.cle), '[]'::jsonb)
    INTO v_par_type
    FROM (
      SELECT COALESCE(a.kind::text, '__non_rattache__') AS cle,
             SUM(p.amount_dzd)::bigint AS montant,
             COUNT(*)::bigint          AS seances
        FROM app.payments p
        LEFT JOIN app.consultations c ON c.id = p.consultation_id
        LEFT JOIN app.appointments  a ON a.id = c.appointment_id
       WHERE p.cabinet_id = app.current_cabinet()
         AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
         AND p.created_at >= v_debut
         AND p.created_at <  v_fin
       GROUP BY 1) t;

  -- ═══ PAR PRATICIENNE — owner UNIQUEMENT, décidé EN BASE ══════════════════
  -- Rendu VIDE pour une praticienne, et pas filtré par l'écran : une
  -- répartition à une seule ligne est du bruit, et surtout un défaut
  -- d'affichage ne doit jamais pouvoir révéler une forme que le rôle n'a pas le
  -- droit de voir. La règle 4 dit où cette décision se prend.
  IF v_role = 'owner' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'cle',         t.cle,
               'libelle',     t.libelle,
               'montantDzd',  t.montant,
               'seances',     t.seances,
               'nonRattache', false)
             ORDER BY t.montant DESC, t.libelle), '[]'::jsonb)
      INTO v_par_prat
      FROM (
        SELECT p.practitioner_id::text          AS cle,
               COALESCE(pr.full_name, '')::text AS libelle,
               SUM(p.amount_dzd)::bigint        AS montant,
               COUNT(*)::bigint                 AS seances
          FROM app.payments p
          LEFT JOIN app.profiles pr ON pr.id = p.practitioner_id
         WHERE p.cabinet_id = app.current_cabinet()
           AND p.created_at >= v_debut
           AND p.created_at <  v_fin
         GROUP BY 1, 2) t;

    -- Corrections de montant, déjà tracées par `trg_audit` (013). AUCUN
    -- mécanisme parallèle n'est créé : une seconde table d'audit financier
    -- ferait DEUX vérités sur le même événement (029, en-tête).
    -- `audit_read_owner` rendrait de toute façon zéro ligne à une praticienne ;
    -- le test de rôle ci-dessus le redit, il ne le remplace pas.
    SELECT COUNT(*)::bigint
      INTO v_corrections
      FROM audit.log l
     WHERE l.table_name = 'payments'
       AND l.operation  = 'update'
       AND 'amount_dzd' = ANY(l.changed_fields)
       AND l.occurred_at >= v_debut
       AND l.occurred_at <  v_fin;
  ELSE
    v_par_prat := '[]'::jsonb;
  END IF;

  -- ═══ POINTS D'ATTENTION — DÉTERMINISTES, avec un plancher d'échantillon ══
  -- Trois règles, pas davantage, et chacune porte un MINIMUM au-dessous duquel
  -- elle ne se déclenche pas. La raison est mesurée : au 2026-08-20 la base
  -- porte DEUX paiements. Un seuil en pourcentage sur deux lignes décrit le
  -- hasard, et une alerte qui décrit le hasard apprend à ignorer les alertes.
  -- Aucune de ces règles n'est statistique : ni écart-type, ni saisonnalité —
  -- il n'existe aucun historique pour en calibrer une (MODULE-MAP §2).

  -- 1. Impayés significatifs : au moins 3 séances ET plus du quart du facturé.
  IF v_attente_nb >= 3 AND v_facture > 0
     AND (v_attente::numeric / v_facture) > 0.25 THEN
    v_points := v_points || jsonb_build_array(jsonb_build_object(
      'code', 'attente-elevee', 'severite', 'attention',
      'valeur', v_attente, 'nombre', v_attente_nb));
  END IF;

  -- 2. Corrections de montant sur la période (owner seul, cf. plus haut).
  IF v_corrections > 0 THEN
    v_points := v_points || jsonb_build_array(jsonb_build_object(
      'code', 'corrections', 'severite', 'info',
      'valeur', v_corrections, 'nombre', v_corrections));
  END IF;

  -- 3. Baisse marquée : au moins 5 séances dans la période DE RÉFÉRENCE, sinon
  --    on compare à du bruit.
  IF v_seances_p >= 5 AND v_facture_p > 0
     AND ((v_facture - v_facture_p)::numeric / v_facture_p) <= -0.30 THEN
    v_points := v_points || jsonb_build_array(jsonb_build_object(
      'code', 'baisse-marquee', 'severite', 'attention',
      'valeur', v_facture_p - v_facture, 'nombre', v_seances_p));
  END IF;

  -- ═══ LE CONTRAT DE SORTIE ════════════════════════════════════════════════
  RETURN jsonb_build_object(
    'perimetre',      v_perimetre,
    'grain',          v_grain,
    'du',             to_char(p_from, 'YYYY-MM-DD'),
    'au',             to_char(p_to,   'YYYY-MM-DD'),
    'joursPeriode',   v_jours,
    'joursEcoules',   v_jours_ecoules,
    'comparaisonDu',  to_char(v_prec_from, 'YYYY-MM-DD'),
    'comparaisonAu',  to_char(v_prec_to,   'YYYY-MM-DD'),
    'pulse', jsonb_build_object(
      'factureDzd',           v_facture,
      'encaissePeriodeDzd',   v_encaisse_periode,
      'encaisseAssietteDzd',  v_encaisse_assiette,
      'attenteDzd',           v_attente,
      'attenteNombre',        v_attente_nb,
      'seancesTarifees',      v_seances,
      'revenuMoyenDzd',       CASE WHEN v_seances = 0 THEN NULL
                                   ELSE round(v_facture::numeric / v_seances) END,
      'tauxEncaissement',     v_taux,
      'varFacture',  app.finance_variation(v_facture,          v_facture_p,          v_jours_ecoules),
      'varEncaisse', app.finance_variation(v_encaisse_periode, v_encaisse_periode_p, v_jours_ecoules),
      'varTaux',     app.finance_variation(v_taux,             v_taux_p,             v_jours_ecoules)),
    'serie',          v_serie,
    'parType',        v_par_type,
    'parPraticienne', v_par_prat,
    'points',         v_points);
END;
$$;

ALTER FUNCTION app.finance_overview(date, date) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.finance_overview(date, date) IS
  'V6-FINANCE (D-23). TOUT l''écran /finances en UN appel (06-PERF-BUDGET §3). '
  'Cloisonnée EN BASE (ADR-005, règle 4) : owner → le cabinet, practitioner → '
  'sa seule recette, assistant → NULL et pas une erreur. Ne nomme AUCUN patient, '
  'donc aucune trace de lecture (I4) — la lecture nominative est '
  'app.list_period_payments. Plage bornée à 366 jours. Bornes en Africa/Algiers, '
  'constantes, donc les index restent utilisables. Ne calcule NI charges, NI '
  'résultat net, NI objectif : aucune table ne les porte (DOC-AUTHORITY §4).';

REVOKE ALL ON FUNCTION app.finance_overview(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finance_overview(date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · Le journal d'une période — SECURITY DEFINER, ET CELLE-CI NOMME
-- ---------------------------------------------------------------------------
-- DEUX TEMPS, MÊME ORDRE QU'EN 026 §6, 027 §1 ET 029 §5 : on lit d'abord des
-- clés techniques, ON JOURNALISE, PUIS on joint `app.patients`. La trace précède
-- toujours la lecture du nom.
--
-- ⚠️ CE QUI CHANGE PAR RAPPORT À `list_day_payments`, ET POURQUOI ÇA COMPTE.
-- Une journée borne naturellement le volume ; une PÉRIODE, non. Une année
-- entière écrirait une ligne d'audit par patient distinct de l'année, sur un
-- seul clic. La trace serait vraie mais illisible, et I4 veut un journal qu'on
-- peut relire.
-- D'où : la boucle de trace ne parcourt QUE LES PATIENTS DE LA PAGE DEMANDÉE,
-- jamais ceux de toute la fenêtre. On trace ce qui a RÉELLEMENT été lu — ni
-- plus (une trace fausse vaut moins qu'une trace absente), ni moins.
--
-- ⚠️ `total_count` EST RÉPÉTÉ SUR CHAQUE LIGNE. C'est le prix d'un seul
-- aller-retour pour « la page + combien il y en a » ; l'appelant le lit une
-- fois. LIMITE ASSUMÉE : une page vide (offset au-delà de la fin) ne rend aucune
-- ligne, donc aucun total. L'écran ne propose jamais cette page ; si elle est
-- demandée quand même, il retombe sur « aucun résultat », ce qui est vrai.
CREATE OR REPLACE FUNCTION app.list_period_payments(
  p_from   date,
  p_to     date,
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0)
RETURNS TABLE (
  payment_id          uuid,
  receipt_number      text,
  amount_dzd          integer,
  collected_at        timestamptz,
  created_at          timestamptz,
  patient_first_name  text,
  patient_last_name   text,
  record_number       text,
  practitioner_name   text,
  total_count         bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_role   app.user_role;
  v_debut  timestamptz; v_fin timestamptz;
  v_limit  integer; v_offset integer;
  v_ids    uuid[];
  v_total  bigint;
  v_pat    uuid;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RETURN;
  END IF;

  IF p_to < p_from THEN
    RAISE EXCEPTION 'Période invalide : la borne haute doit suivre la borne basse.';
  END IF;

  IF (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'Période trop large : 366 jours au maximum.';
  END IF;

  -- Bornes de pagination imposées EN BASE. Même raisonnement que le
  -- `p_limit <= 100` de `search_patients` : une page que l'appelant dimensionne
  -- lui-même n'est pas une page.
  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  v_role := app.current_role();

  -- Zéro ligne AVANT toute trace : elle n'a rien lu, journaliser une lecture
  -- serait FAUX. Une pièce d'audit fausse vaut moins qu'une pièce absente.
  IF v_role NOT IN ('owner', 'practitioner') THEN
    RETURN;
  END IF;

  v_debut := p_from::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin   := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Algiers';

  -- Temps 1a — la PAGE, en clés techniques seules. `id` en second critère de
  -- tri : sans lui, deux paiements du même instant peuvent permuter d'une page
  -- à l'autre, et une ligne se retrouve lue deux fois, ou jamais.
  SELECT array_agg(t.id ORDER BY t.created_at DESC, t.id)
    INTO v_ids
    FROM (SELECT p.id, p.created_at
            FROM app.payments p
           WHERE p.cabinet_id = app.current_cabinet()
             AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
             AND p.created_at >= v_debut
             AND p.created_at <  v_fin
           ORDER BY p.created_at DESC, p.id
           LIMIT v_limit OFFSET v_offset) t;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN;                       -- page vide : rien lu, donc rien à tracer
  END IF;

  SELECT COUNT(*)::bigint
    INTO v_total
    FROM app.payments p
   WHERE p.cabinet_id = app.current_cabinet()
     AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
     AND p.created_at >= v_debut
     AND p.created_at <  v_fin;

  -- Temps 1b — LA TRACE, avant tout nom, et bornée à la page.
  FOR v_pat IN
    SELECT DISTINCT p.patient_id
      FROM app.payments p
     WHERE p.id = ANY(v_ids)
  LOOP
    PERFORM audit.log_read(v_pat, 'liste');
  END LOOP;

  -- Temps 2 — la lecture nominative, une fois la trace écrite.
  RETURN QUERY
  SELECT p.id, p.receipt_number, p.amount_dzd, p.collected_at, p.created_at,
         pt.first_name, pt.last_name, pt.record_number,
         pr.full_name,
         v_total
    FROM app.payments p
    LEFT JOIN app.patients pt ON pt.id = p.patient_id
    LEFT JOIN app.profiles pr ON pr.id = p.practitioner_id
   WHERE p.id = ANY(v_ids)
   ORDER BY p.created_at DESC, p.id;
END;
$$;

ALTER FUNCTION app.list_period_payments(date, date, integer, integer) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.list_period_payments(date, date, integer, integer) IS
  'V6-FINANCE (D-23). Le journal d''une PÉRIODE, avec les noms — donc trace '
  '`liste` dans audit.log AVANT toute lecture d''identité (026 §6, 029 §5). '
  'La trace ne couvre QUE les patients de la page demandée : une période, '
  'contrairement à une journée, ne borne pas le volume, et un journal d''audit '
  'illisible ne protège personne. Plage <= 366 jours, page <= 100 lignes, '
  'bornes en Africa/Algiers. Même cloison qu''app.finance_overview.';

REVOKE ALL ON FUNCTION app.list_period_payments(date, date, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_period_payments(date, date, integer, integer) TO authenticated;

-- `finance_overview` et `list_period_payments` s'exécutent sous `app_gatekeeper`,
-- qui a EXECUTE sur `audit.log_read` depuis 020 §2 — aucun GRANT à poser ici.

-- ---------------------------------------------------------------------------
-- 5 · Refermer
-- ---------------------------------------------------------------------------
-- Symétrique du §0, et pour la raison de 026 §8, 027 §3 et 029 §6 : la
-- propriété des portes est acquise, CREATE sur le schéma n'a plus lieu d'être.
-- Un rôle qui peut créer des objets dans `app` pourrait y planter une fonction
-- masquant une fonction du catalogue dans le `search_path` figé des portes.
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('036_finance_period_gates')
  ON CONFLICT DO NOTHING;

COMMIT;
