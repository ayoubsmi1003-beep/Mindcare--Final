-- test-chemin-ecriture-finance — LE CHEMIN D'ÉCRITURE, PROUVÉ.
--
-- Régression du défaut corrigé par 037 : une séance close SANS tarif ne
-- produisait aucune ligne dans `app.payments`, donc n'atteignait JAMAIS les
-- Finances, définitivement et sans signal.
--
-- Tout le fichier tient dans UNE transaction terminée par ROLLBACK : les
-- fixtures n'existent qu'à l'intérieur. Même harnais que
-- `checkpoint-v6-finance.sql` (rôle simulé par `SET LOCAL ROLE authenticated`
-- + claim JWT), et même instrument à trois verdicts — un contrôle dont la
-- condition rend NULL est BLOQUÉ, jamais vert.

\set ON_ERROR_STOP on
\pset pager off
\set QUIET on

\set CAB  '00000000-0000-0000-0000-000000000001'
\set A2   '00000000-0000-0000-0000-0000000000a2'
\set B2   '00000000-0000-0000-0000-0000000000b2'
\set C1   '00000000-0000-0000-0000-00000000e001'
\set C2   '00000000-0000-0000-0000-00000000e002'

BEGIN;

CREATE FUNCTION pg_temp.controle(p_label text, p_cond boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NULL THEN
    RAISE INFO 'BLOQUÉ | % | % (condition NULL — rien n''a été comparé)', rpad(p_label, 54), p_detail;
  ELSIF p_cond THEN
    RAISE INFO 'vert   | % | %', rpad(p_label, 54), p_detail;
  ELSE
    RAISE INFO 'ROUGE  | % | %', rpad(p_label, 54), p_detail;
  END IF;
END $$;

\echo ''
\echo '═══ CHEMIN D''ÉCRITURE FINANCE — 037 ═══'
\echo ''

-- Deux séances ouvertes de la praticienne …a2. `one_open_consult` est un index
-- UNIQUE partiel sur (practitioner_id) WHERE status='open' : on ne peut donc
-- pas en avoir deux ouvertes en même temps. C1 est créée, testée, close ; C2
-- prend sa place ensuite.
INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, status, started_at, is_synthetic)
VALUES (:'C1', :'CAB', :'A2', :'B2', 'open', now(), true);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

-- ---------------------------------------------------------------------------
-- T1 · Clore SANS tarif est refusé  (le défaut lui-même)
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_refus boolean := false;
BEGIN
  BEGIN
    PERFORM app.close_consultation('00000000-0000-0000-0000-00000000e001');
  EXCEPTION WHEN others THEN
    v_refus := (SQLERRM LIKE '%pas de tarif%');
  END;
  PERFORM pg_temp.controle('T1 clore sans tarif → refus', v_refus,
    'sinon la séance serait invisible aux Finances à jamais');
END $t$;

-- T2 · et la séance est TOUJOURS ouverte (le refus n'a rien écrit à moitié)
DO $t$
DECLARE v_statut app.consult_status;
BEGIN
  SELECT status INTO v_statut FROM app.consultations WHERE id = '00000000-0000-0000-0000-00000000e001';
  PERFORM pg_temp.controle('T2 refus atomique → séance encore ouverte', v_statut = 'open', 'statut=' || COALESCE(v_statut::text,'∅'));
END $t$;

-- ---------------------------------------------------------------------------
-- T3 · Tarif puis clôture : le chemin nominal passe
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_pay uuid; v_id uuid;
BEGIN
  v_pay := app.set_consultation_price('00000000-0000-0000-0000-00000000e001', 4200);
  v_id  := app.close_consultation('00000000-0000-0000-0000-00000000e001');
  PERFORM pg_temp.controle('T3 tarif puis clôture → close', v_id IS NOT NULL AND v_pay IS NOT NULL,
    'paiement=' || COALESCE(v_pay::text,'∅'));
END $t$;

-- ---------------------------------------------------------------------------
-- T4 · LES CONTRÔLES QUI COMPTENT : la séance atteint les Finances
-- ---------------------------------------------------------------------------
-- ⚠️ EN COMPTABILITÉ DE CAISSE, TARIFER N'EST PAS ENCAISSER. Une séance
-- fraîchement tarifée n'a pas encore de `collected_at` : elle est donc un
-- IMPAYÉ, visible dans l'onglet Séances & paiements et dans le panneau
-- Attention — mais elle ne compte PAS encore en recette. Une fois encaissée,
-- elle bascule dans `revenu_periode`.
--
-- Les deux moitiés sont vérifiées ci-dessous. N'en tester qu'une laisserait
-- passer soit une recette fantôme, soit une séance qui n'apparaît nulle part.
-- Les bornes de journée se calculent en Africa/Algiers (CLAUDE.md §4).
DO $t$
DECLARE
  v_ap      jsonb;
  v_jour    date;
  v_imp_av  bigint;
  v_rev_av  bigint;
  v_rev_ap  bigint;
  v_pay     uuid;
  v_dans    boolean;
BEGIN
  v_jour := (now() AT TIME ZONE 'Africa/Algiers')::date;

  -- (a) Tarifée, pas encore encaissée → elle est un IMPAYÉ, pas une recette.
  v_ap     := app.get_finance_overview(v_jour, v_jour);
  v_rev_av := (v_ap -> 'pulse' ->> 'revenu_periode')::bigint;
  v_imp_av := (v_ap -> 'pulse' ->> 'impayes_total')::bigint;
  PERFORM pg_temp.controle('T4a tarifée non encaissée → impayé, pas recette',
    v_imp_av >= 4200 AND v_rev_av = 0,
    'impayés=' || v_imp_av || ' recette=' || v_rev_av);

  -- (b) Elle figure dans la liste des séances de la période.
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      app.get_sessions_payments_list(v_jour, v_jour, 50, 0) -> 'lignes') l
     WHERE (l ->> 'montant')::bigint = 4200)
    INTO v_dans;
  PERFORM pg_temp.controle('T4b la séance figure dans Séances & paiements', v_dans,
    'la seule liste où un impayé est visible');

  -- (c) Encaissée → elle devient une recette du jour.
  SELECT p.id INTO v_pay FROM app.payments p
   WHERE p.consultation_id = '00000000-0000-0000-0000-00000000e001';
  PERFORM app.record_payment_collected(v_pay);

  v_rev_ap := (app.get_finance_overview(v_jour, v_jour) -> 'pulse' ->> 'revenu_periode')::bigint;
  PERFORM pg_temp.controle('T4c encaissée → recette du jour', v_rev_ap >= 4200,
    'recette du ' || v_jour || ' = ' || v_rev_ap || ' (>= 4200)');
END $t$;

-- ---------------------------------------------------------------------------
-- T5 · Une séance offerte (0 DZD) reste clôturable — le geste, pas l'oubli
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_id uuid;
BEGIN
  INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, status, started_at, is_synthetic)
  VALUES ('00000000-0000-0000-0000-00000000e002',
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a2',
          '00000000-0000-0000-0000-0000000000b2', 'open', now(), true);
  PERFORM app.set_consultation_price('00000000-0000-0000-0000-00000000e002', 0);
  v_id := app.close_consultation('00000000-0000-0000-0000-00000000e002');
  PERFORM pg_temp.controle('T5 séance offerte (0 DZD) → clôturable', v_id IS NOT NULL,
    'ADR-018 : un tarif offert se saisit à 0');
END $t$;

-- ---------------------------------------------------------------------------
-- T6 · Séance hors périmètre : NULL, pas une erreur (ADR-003, règle 5)
-- ---------------------------------------------------------------------------
-- Le comportement anti-oracle de 029 doit SURVIVRE à 037 : une séance
-- inexistante et une séance masquée rendent la même chose.
DO $t$
DECLARE v_r uuid; v_leve boolean := false;
BEGIN
  BEGIN
    v_r := app.close_consultation('00000000-0000-0000-0000-0000dead0001');
  EXCEPTION WHEN others THEN v_leve := true;
  END;
  PERFORM pg_temp.controle('T6 séance inconnue → NULL, jamais une erreur',
    (NOT v_leve) AND v_r IS NULL, 'pas d''oracle d''existence');
END $t$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- T7 · Aucune fixture ne survit
-- ---------------------------------------------------------------------------
ROLLBACK;

DO $t$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM app.consultations
   WHERE id IN ('00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-00000000e002');
  IF v_n = 0 THEN
    RAISE INFO 'vert   | % | les fixtures n''ont pas survécu au ROLLBACK', rpad('T7 aucune fixture rémanente', 54);
  ELSE
    RAISE INFO 'ROUGE  | % | % ligne(s) survivante(s)', rpad('T7 aucune fixture rémanente', 54), v_n;
  END IF;
END $t$;
