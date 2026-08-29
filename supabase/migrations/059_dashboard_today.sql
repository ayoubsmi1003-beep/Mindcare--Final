-- 059_dashboard_today — l'écran du matin de la praticienne (V4).
--
-- ═══ CE QUE CE FICHIER EST ════════════════════════════════════════════════
--
-- UNE porte, `app.dashboard_today`, qui rend TOUT le tableau de bord de la
-- praticienne en UNE réponse jsonb. C'est la porte nommée par SPRINT-V1 §V4 et
-- exigée par PERF §3 (« un écran = un appel ») : budget tableau de bord
-- 1 appel · 100 ms · 400 ms. Quatre allers-retours depuis Alger (~180 ms
-- chacun) seraient ROUGE au checkpoint avant même d'avoir peint un pixel.
--
-- Elle est modelée LIGNE POUR LIGNE sur `app.reception_board` (046), qui fait
-- déjà exactement cela pour l'accueil, et elle emprunte sa cloison financière à
-- `app.day_revenue` (029 §4). Deux portes du même genre, une seule convention.
--
-- ═══ CE QUE CE FICHIER NE FAIT PAS ════════════════════════════════════════
--
-- Il ne crée NI table, NI colonne, NI type, NI valeur d'enum (règle 9).
-- Il ne modifie AUCUN objet existant : ni policy, ni déclencheur, ni porte.
-- Il n'écrit RIEN, sauf la ligne d'audit de lecture. Aucune transition d'état
-- ne passe par ici : `start_consultation` (026), `confirm_jarvis_action` (033)
-- et `record_payment_collected` (029) restent les seules portes d'écriture de
-- ce qu'il affiche.
--
-- ⚠️ AUCUN RÔLE N'EST TESTÉ POUR AUTRE CHOSE QUE LE PÉRIMÈTRE FINANCIER.
-- `app_gatekeeper` N'A PAS BYPASSRLS et hérite de `authenticated` (020, 021) :
-- les policies de 004, 006, 007, 011 et 012 décident des lignes SOUS cette
-- fonction, et `auth.uid()` reste celui de l'appelante. Un écran vide signifie
-- « rien de VISIBLE par vous », jamais « rien » (règle 4).
--
-- ═══ LA CLOISON FINANCIÈRE, ET LE PIÈGE DU MOT « RECETTE » ════════════════
--
-- `day_revenue.total_dzd` est la somme des montants FACTURÉS du jour, pas de ce
-- qui est entré en caisse — `attente_dzd` en retranche la part non encaissée.
-- Afficher `total_dzd` sous le mot « encaissé » serait un mensonge comptable un
-- jour sur deux. Cette porte calcule donc explicitement
-- `SUM(amount_dzd) FILTER (WHERE collected_at IS NOT NULL)`, et le libellé de
-- l'écran dit ce que la colonne dit. Cloison identique à 029 : owner → le
-- cabinet entier, practitioner → sa seule caisse, assistant → la clé `encaisse`
-- vaut NULL, et PAS une erreur. Une exception lui apprendrait qu'il y a quelque
-- chose à ne pas voir (ADR-005).
--
-- `perimetre` est rendu par la BASE pour que le sous-titre de l'écran nomme ce
-- qui a RÉELLEMENT été filtré, et non ce qu'il aurait deviné de son côté.
--
-- ═══ L'AUDIT ══════════════════════════════════════════════════════════════
--
-- UNE ligne `liste`, `patient_id` NULL, écrite AVANT toute lecture d'identité —
-- patron `list_agenda` (022 §2) et `reception_board` (046). L'écran se
-- rafraîchit seul toutes les 120 s : une trace par patient nommé noierait
-- `audit.log` sous le bruit du matin. Un coup d'œil à sa propre journée n'est
-- pas douze ouvertures de dossier.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Privilèges du porteur — ON NOMME AU LIEU D'HÉRITER (motif 022 §1, 046 §1)
-- ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

GRANT SELECT ON app.appointments   TO app_gatekeeper;   -- posé en 022, idempotent
GRANT SELECT ON app.patients       TO app_gatekeeper;   -- posé en 020, idempotent
GRANT SELECT ON app.consultations  TO app_gatekeeper;   -- posé en 026, idempotent
GRANT SELECT ON app.payments       TO app_gatekeeper;   -- posé en 029, idempotent

-- ⚠️ CELUI-CI EST NEUF. Les quatre au-dessus ne font que redire un privilège
-- déjà accordé ; celui-ci ÉLARGIT la surface de `app_gatekeeper` à une table
-- qu'il ne lisait pas — 033 ne lui a rien accordé, ses quatre portes Jarvis
-- étant `SECURITY INVOKER` précisément pour n'avoir besoin d'aucun privilège
-- de porteur.
--
-- POURQUOI C'EST SÛR MALGRÉ TOUT. `app_gatekeeper` n'a PAS BYPASSRLS et hérite
-- de `authenticated` (020, 021) : sous cette fonction, `auth.uid()` reste celui
-- de l'appelante et la policy `jarvis_own` (012) filtre toujours sur
-- `cabinet_id = app.current_cabinet() AND actor_id = auth.uid()`. Le privilège
-- ouvre la TABLE au porteur, pas les LIGNES d'autrui.
--
-- POURQUOI SELECT SEULEMENT. Aucune écriture ne passe par ici : les transitions
-- restent dans `confirm_jarvis_action` / `reject_jarvis_action` /
-- `execute_jarvis_action` (033), qui gardent leur `SECURITY INVOKER`. Accorder
-- INSERT ou UPDATE ici ouvrirait un second chemin d'écriture vers la boucle
-- proposer → confirmer → exécuter, et la contrainte `jarvis_must_confirm` (012)
-- serait le seul rempart restant.
GRANT SELECT ON app.jarvis_actions TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 2 · Le tableau de bord du matin — SECURITY DEFINER, UN SEUL APPEL
-- ---------------------------------------------------------------------------
-- DEFINER pour la même raison qu'en 029 et 046 : `app_gatekeeper` est le seul
-- rôle à qui 020 §2 accorde EXECUTE sur `audit.log_read`.
CREATE OR REPLACE FUNCTION app.dashboard_today(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $fn$
DECLARE
  v_role       app.user_role;
  v_debut      timestamptz;
  v_fin        timestamptz;
  v_mois_debut timestamptz;
  v_mois_fin   timestamptz;
  v_encaisse   jsonb;
  v_resultat   jsonb;
BEGIN
  IF p_day IS NULL THEN
    RETURN NULL;
  END IF;

  v_role := app.current_role();

  -- ⚠️ LA JOURNÉE EST CELLE DU CABINET, PAS CELLE DU SERVEUR. Postgres tourne
  -- en UTC ; `p_day::timestamptz` donnerait minuit UTC, soit 01:00 à Alger, et
  -- une séance encaissée entre minuit et 1 h tomberait dans la veille. Les deux
  -- bornes restent des CONSTANTES : les index sur `starts_at` et `created_at`
  -- restent utilisables, contrairement à un `created_at::date = p_day` qui
  -- transformerait la colonne et les écarterait.
  v_debut      := p_day::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin        := (p_day + 1)::timestamp AT TIME ZONE 'Africa/Algiers';
  v_mois_debut := date_trunc('month', p_day)::timestamp AT TIME ZONE 'Africa/Algiers';
  v_mois_fin   := (date_trunc('month', p_day)::date + interval '1 month')::timestamp
                    AT TIME ZONE 'Africa/Algiers';

  -- Trace AVANT toute lecture d'identité. Une seule, contexte `liste`.
  PERFORM audit.log_read(NULL, 'liste');

  -- ── La caisse du jour, cloisonnée EN BASE (ADR-005, D-14) ────────────────
  -- Le filtrage explicite redit en SQL ce que la RLS de 011 impose déjà, pour
  -- que la règle soit LISIBLE là où elle est décidée. Deux barrières, pas une.
  IF v_role = 'owner' THEN
    SELECT jsonb_build_object(
             'montant_dzd', COALESCE(SUM(p.amount_dzd)
                              FILTER (WHERE p.collected_at IS NOT NULL), 0)::bigint,
             'seances',     COUNT(*) FILTER (WHERE p.collected_at IS NOT NULL)::bigint,
             'perimetre',   'cabinet')
      INTO v_encaisse
      FROM app.payments p
     WHERE p.cabinet_id = app.current_cabinet()
       AND p.created_at >= v_debut
       AND p.created_at <  v_fin;

  ELSIF v_role = 'practitioner' THEN
    SELECT jsonb_build_object(
             'montant_dzd', COALESCE(SUM(p.amount_dzd)
                              FILTER (WHERE p.collected_at IS NOT NULL), 0)::bigint,
             'seances',     COUNT(*) FILTER (WHERE p.collected_at IS NOT NULL)::bigint,
             'perimetre',   'praticienne')
      INTO v_encaisse
      FROM app.payments p
     WHERE p.cabinet_id      = app.current_cabinet()
       AND p.practitioner_id = auth.uid()
       AND p.created_at >= v_debut
       AND p.created_at <  v_fin;

  ELSE
    -- assistant, patient, rôle absent → la clé vaut NULL. L'écran ne rend pas
    -- le bloc ; il n'invente surtout pas un zéro, qui se lirait « rien encaissé
    -- aujourd'hui » au lieu de « ce chiffre ne vous regarde pas ».
    v_encaisse := NULL;
  END IF;

  SELECT jsonb_build_object(

    -- ── La séance en cours ────────────────────────────────────────────────
    -- Même vérité que `app.get_open_consultation` (026) : la séance ouverte de
    -- L'APPELANTE, jamais celle d'une consœur. `one_open_consult` (007)
    -- garantit qu'il n'y en a qu'une.
    'consultation_ouverte',
      (SELECT jsonb_build_object(
                'id',            c.id,
                'started_at',    c.started_at,
                'patient_id',    c.patient_id,
                'record_number', pt.record_number,
                'first_name',    pt.first_name,
                'last_name',     pt.last_name)
         FROM app.consultations c
         JOIN app.patients pt ON pt.id = c.patient_id
        WHERE c.practitioner_id = auth.uid()
          AND c.status = 'open'
        LIMIT 1),

    -- ── Le fil de la journée ──────────────────────────────────────────────
    -- SA journée : `practitioner_id = auth.uid()`. Ce n'est pas une décision
    -- d'autorisation (la RLS de 006 l'a déjà prise) mais un PÉRIMÈTRE d'écran :
    -- le tableau de bord répond « ma journée », l'agenda répond « le cabinet ».
    -- `cancelled` et `requested` sont hors du fil : le premier n'aura pas lieu,
    -- le second appartient au poste d'accueil.
    'journee', COALESCE(
      (SELECT jsonb_agg(ligne ORDER BY ligne->>'starts_at')
         FROM (
           SELECT jsonb_build_object(
                    'id',            a.id,
                    'starts_at',     a.starts_at,
                    'ends_at',       a.ends_at,
                    'status',        a.status,
                    'kind',          a.kind,
                    'arrived_at',    a.arrived_at,
                    'patient_id',    a.patient_id,
                    'record_number', pt.record_number,
                    'first_name',    pt.first_name,
                    'last_name',     pt.last_name
                  ) AS ligne
             FROM app.appointments a
             LEFT JOIN app.patients pt ON pt.id = a.patient_id
            WHERE a.practitioner_id = auth.uid()
              AND a.starts_at >= v_debut
              AND a.starts_at <  v_fin
              AND a.status IN ('confirmed','arrived','in_session','completed','no_show')
         ) g),
      '[]'::jsonb),

    -- ── Le patient suivant ────────────────────────────────────────────────
    -- Le plus proche qui n'a pas encore commencé : `confirmed` (attendu) ou
    -- `arrived` (déjà là). `in_session` est exclu — c'est la séance en cours,
    -- elle a sa propre carte ; `completed` et `no_show` sont derrière nous.
    'suivant',
      (SELECT jsonb_build_object(
                'id',            a.id,
                'starts_at',     a.starts_at,
                'ends_at',       a.ends_at,
                'status',        a.status,
                'kind',          a.kind,
                'arrived_at',    a.arrived_at,
                'patient_id',    a.patient_id,
                'record_number', pt.record_number,
                'first_name',    pt.first_name,
                'last_name',     pt.last_name)
         FROM app.appointments a
         LEFT JOIN app.patients pt ON pt.id = a.patient_id
        WHERE a.practitioner_id = auth.uid()
          AND a.starts_at >= v_debut
          AND a.starts_at <  v_fin
          AND a.status IN ('confirmed','arrived')
        ORDER BY a.starts_at
        LIMIT 1),

    -- ── La salle d'attente ────────────────────────────────────────────────
    -- Ceux qui sont arrivés et que la séance n'a pas encore pris.
    'attente_nombre',
      (SELECT COUNT(*)::bigint
         FROM app.appointments a
        WHERE a.practitioner_id = auth.uid()
          AND a.starts_at >= v_debut
          AND a.starts_at <  v_fin
          AND a.status = 'arrived'),

    'encaisse', v_encaisse,

    -- ── Les nouveaux patients du mois ─────────────────────────────────────
    -- Mois civil du cabinet, pas mois UTC : même raisonnement que la journée.
    'nouveaux_patients_mois',
      (SELECT COUNT(*)::bigint
         FROM app.patients pt
        WHERE pt.practitioner_id = auth.uid()
          AND pt.created_at >= v_mois_debut
          AND pt.created_at <  v_mois_fin),

    -- ── Ce que Jarvis a proposé et que personne n'a tranché ───────────────
    -- ⚠️ CE BLOC NE FABRIQUE AUCUNE PROPOSITION. Il rend les lignes que la
    -- praticienne a RÉELLEMENT fait naître en parlant à Jarvis et qu'elle n'a
    -- ni confirmée ni refusée. Aucun agent de fond n'en écrit : le jour où il
    -- n'y en a pas, l'écran affiche son état vide — il n'invente pas une
    -- suggestion pour remplir la carte (règle 8).
    -- La policy `jarvis_own` (012) filtre déjà sur `actor_id = auth.uid()` ; le
    -- WHERE la redit, comme partout ailleurs dans ce fichier.
    -- Plafond 3 : SPRINT-V1 §V4 dit « 1 à 3 propositions ». Une liste sans fin
    -- au réveil n'est pas une aide, c'est un arriéré.
    'propositions', COALESCE(
      (SELECT jsonb_agg(ligne ORDER BY ligne->>'proposed_at' DESC)
         FROM (
           SELECT jsonb_build_object(
                    'id',             j.id,
                    'tool_name',      j.tool_name,
                    'tool_args',      j.tool_args,
                    'user_utterance', j.user_utterance,
                    'proposed_at',    j.proposed_at
                  ) AS ligne
             FROM app.jarvis_actions j
            WHERE j.cabinet_id = app.current_cabinet()
              AND j.actor_id   = auth.uid()
              AND j.state      = 'proposed'
            ORDER BY j.proposed_at DESC
            LIMIT 3
         ) g),
      '[]'::jsonb),

    'genere_a', now()
  )
  INTO v_resultat;

  RETURN v_resultat;
END;
$fn$;

ALTER FUNCTION app.dashboard_today(date) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.dashboard_today(date) IS
  'V4, PERF §3 : TOUT le tableau de bord de la praticienne en UN appel — séance '
  'en cours, fil de SA journée, patient suivant, salle d''attente, caisse '
  'encaissée, nouveaux patients du mois, propositions Jarvis non tranchées. La '
  'caisse est cloisonnée comme app.day_revenue (ADR-005) : owner → le cabinet, '
  'practitioner → sa caisse, assistant → clé NULL et pas une erreur ; et elle '
  'compte les paiements ENCAISSÉS, jamais les montants facturés. Aucune '
  'écriture. Une trace `liste` par appel, patient_id NULL (patron list_agenda) '
  '— le rafraîchissement de 120 s ne noie pas audit.log.';

REVOKE ALL ON FUNCTION app.dashboard_today(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.dashboard_today(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Refermer
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('059_dashboard_today')
  ON CONFLICT DO NOTHING;

COMMIT;
