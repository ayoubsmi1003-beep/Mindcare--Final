-- checkpoint-v6-finance.sql — V6-FINANCE (D-23). La vérité financière, la cloison,
-- et la non-régression de 029.
--
--   docker run --rm -i -e PGURL="$DATABASE_URL" postgres:15 \
--     sh -c 'psql "$PGURL" -f -' < scripts/checkpoint-v6-finance.sql
--
-- ═══ TOUT SE PASSE DANS UNE TRANSACTION ANNULÉE ═══════════════════════════
-- Les fixtures posées ici n'existent QUE le temps de ce fichier : `ROLLBACK` en
-- dernière ligne. C'est la voie que la règle 8 de CLAUDE.md autorise
-- explicitement — « une fixture de test vit DANS LA TRANSACTION du checkpoint,
-- jamais dans un seed livré ». Aucun paiement de démonstration n'entre dans
-- `015`, et l'écran livré n'affiche jamais un chiffre inventé.
--
-- POURQUOI DES FIXTURES SONT NÉCESSAIRES, ET CE N'EST PAS UN CONFORT.
-- La base porte DEUX paiements réels (mesuré le 2026-08-20). On ne peut y
-- prouver ni une frontière de fuseau, ni une réconciliation sur trois grains,
-- ni un taux d'encaissement partiel : il n'y a pas assez de matière. Un
-- checkpoint qui se contenterait des deux lignes existantes serait vert sans
-- avoir rien éprouvé — le « vert statique » que ce dépôt a déjà payé.
--
-- ⚠️ FENÊTRE DE TEST ISOLÉE : mars 2025. Les paiements réels sont d'août 2026.
-- Aucun recouvrement, donc aucun test ne dépend de l'état réel de la caisse.
--
-- ═══ IMPERSONATION ════════════════════════════════════════════════════════
-- `SET ROLE authenticated` + `SET request.jwt.claim.sub` — la voie de
-- `checkpoint-v2-rls.sql`, qui ne demande aucun mot de passe. Les fixtures sont
-- posées AVANT, sous le rôle de connexion, parce qu'`app.payments` n'accepte
-- pas d'INSERT direct d'une praticienne hors de la porte 029.

\set ON_ERROR_STOP on
\pset pager off
\set QUIET on

\set CAB  '00000000-0000-0000-0000-000000000001'
\set A1   '00000000-0000-0000-0000-0000000000a1'
\set A2   '00000000-0000-0000-0000-0000000000a2'
\set A3   '00000000-0000-0000-0000-0000000000a3'
\set B2   '00000000-0000-0000-0000-0000000000b2'

BEGIN;

-- ---------------------------------------------------------------------------
-- L'instrument — trois verdicts, et le troisième existe pour une raison
-- ---------------------------------------------------------------------------
-- `vert` mesuré conforme · `ROUGE` mesuré non conforme · `BLOQUÉ` NON MESURÉ.
-- Un contrôle dont la condition est NULL n'est PAS vert : une comparaison qui
-- rend NULL n'a rien comparé. Sans cette branche, un `NULL = NULL` silencieux
-- passerait pour une réussite — le faux vert exact que V3 a documenté.
CREATE FUNCTION pg_temp.controle(p_label text, p_cond boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NULL THEN
    RAISE INFO 'BLOQUÉ | % | % (condition NULL — rien n''a été comparé)', rpad(p_label, 58), p_detail;
  ELSIF p_cond THEN
    RAISE INFO 'vert   | % | %', rpad(p_label, 58), p_detail;
  ELSE
    RAISE INFO 'ROUGE  | % | %', rpad(p_label, 58), p_detail;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- COMPTER LES TRACES SANS ÊTRE OWNER — et pourquoi il a fallu ça
-- ---------------------------------------------------------------------------
-- ⚠️ FAUX ROUGE MESURÉ LE 2026-08-20, ET IL FAUT LE GARDER ÉCRIT.
-- La première version comptait `SELECT count(*) FROM audit.log` DEPUIS LE RÔLE
-- TESTÉ. Or `audit_read_owner` (013) n'accorde le SELECT sur `audit.log` qu'à
-- l'owner : sous …a2 (praticienne), le compte rendait 0 — non pas parce que la
-- trace n'avait pas été écrite, mais parce que la praticienne NE PEUT PAS LA
-- LIRE. Le contrôle a annoncé « 0 trace écrite » sur une porte qui traçait
-- correctement.
--
-- C'est le symétrique exact du faux vert : un ROUGE fabriqué par l'instrument,
-- et il inspire plus confiance qu'un vert, donc il se débusque plus mal.
--
-- Ce compteur est SECURITY DEFINER et appartient au rôle de connexion
-- (superutilisateur) : il voit `audit.log` en entier, quel que soit le rôle qui
-- l'appelle. Il ne sert QU'À MESURER — il n'entre dans aucun chemin produit.
CREATE FUNCTION pg_temp.traces_liste() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = audit, pg_catalog AS $ctl$
  SELECT count(*) FROM audit.log
   WHERE table_name = 'patients' AND operation = 'select'
     AND 'liste' = ANY(changed_fields);
$ctl$;

CREATE FUNCTION pg_temp.traces_total() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = audit, pg_catalog AS $ctl$
  SELECT count(*) FROM audit.log;
$ctl$;

\echo ''
\echo '═══ CHECKPOINT V6-FINANCE — vérité, cloison, non-régression ═══'
\echo ''

-- ---------------------------------------------------------------------------
-- Fixtures — mars 2025, praticienne …a2, patiente …b2
-- ---------------------------------------------------------------------------
-- `is_synthetic = true` OBLIGATOIRE : `assert_synthetic_when_cloud` (016) refuse
-- toute autre valeur en cloud-dev, et le défaut de la colonne est `false` depuis
-- que 016 a rattrapé l'existant. Une fixture marquée « réelle » ferait échouer
-- la migration du garde-fou, pas seulement ce test.
--
-- P1 et P2 encadrent MINUIT À ALGER, à une heure d'intervalle : c'est le couple
-- qui prouve que la frontière de journée est locale et non UTC. En UTC, les deux
-- tomberaient le même jour (22:30 et 23:30 UTC le 10 mars).
INSERT INTO app.payments
  (id, cabinet_id, practitioner_id, patient_id, consultation_id, receipt_number,
   amount_dzd, set_by, collected_by, collected_at, created_at, is_synthetic)
VALUES
  -- P1 · 2025-03-10 23:30 Alger — encaissé le jour même
  ('00000000-0000-0000-0000-00000000f001', :'CAB', :'A2', :'B2', NULL, 'FIXT-2025-00001',
   1000, :'A2', :'A2', '2025-03-10 23:45:00+01', '2025-03-10 23:30:00+01', true),
  -- P2 · 2025-03-11 00:30 Alger — JAMAIS encaissé
  ('00000000-0000-0000-0000-00000000f002', :'CAB', :'A2', :'B2', NULL, 'FIXT-2025-00002',
   2000, :'A2', NULL, NULL, '2025-03-11 00:30:00+01', true),
  -- P3 · 2025-03-15 — facturé en mars, ENCAISSÉ LE 20 : c'est lui qui distingue
  --      l'assiette « facturé » de la comptabilité de caisse
  ('00000000-0000-0000-0000-00000000f003', :'CAB', :'A2', :'B2', NULL, 'FIXT-2025-00003',
   3000, :'A2', :'A2', '2025-03-20 10:00:00+01', '2025-03-15 12:00:00+01', true),
  -- P4 · 2025-03-15 — non encaissé
  ('00000000-0000-0000-0000-00000000f004', :'CAB', :'A2', :'B2', NULL, 'FIXT-2025-00004',
   4000, :'A2', NULL, NULL, '2025-03-15 12:00:00+01', true),
  -- P5 · appartient à …a1 (owner) : sert à prouver que …a2 ne le voit PAS
  ('00000000-0000-0000-0000-00000000f005', :'CAB', :'A1',
   '00000000-0000-0000-0000-0000000000b1', NULL, 'FIXT-2025-00005',
   5000, :'A1', NULL, NULL, '2025-03-15 12:00:00+01', true);

-- ---------------------------------------------------------------------------
-- Sous l'identité de la PRATICIENNE …a2
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

DO $$
DECLARE
  o        jsonb;   -- aperçu du mois de mars
  o10      jsonb;   -- 10 mars seul
  o11      jsonb;   -- 11 mars seul
  o15      jsonb;   -- 15 mars seul
  dr       record;  -- day_revenue du 15 mars
  v_serie  bigint;
  v_type   bigint;
  v_prat   bigint;
BEGIN
  o   := app.finance_overview('2025-03-01', '2025-03-31');
  o10 := app.finance_overview('2025-03-10', '2025-03-10');
  o11 := app.finance_overview('2025-03-11', '2025-03-11');
  o15 := app.finance_overview('2025-03-15', '2025-03-15');

  -- ══ C1 · la porte répond, et le périmètre vient de la BASE ═══════════════
  PERFORM pg_temp.controle('C1 · périmètre rendu par la base',
    o->>'perimetre' = 'praticienne',
    'perimetre=' || coalesce(o->>'perimetre', 'NULL'));

  -- ══ C2 · I-1 · facturé = encaissé(assiette) + en attente ═════════════════
  -- L'invariant central. Entiers, égalité EXACTE, aucune tolérance : ce sont
  -- des dinars, pas des flottants (ADR-018).
  PERFORM pg_temp.controle('C2 · I-1 facturé = encaissé(assiette) + attente',
    (o->'pulse'->>'factureDzd')::bigint
      = (o->'pulse'->>'encaisseAssietteDzd')::bigint
      + (o->'pulse'->>'attenteDzd')::bigint,
    (o->'pulse'->>'factureDzd') || ' = ' || (o->'pulse'->>'encaisseAssietteDzd')
      || ' + ' || (o->'pulse'->>'attenteDzd'));

  -- Les montants attendus, en dur : 1000+2000+3000+4000 = 10000 pour …a2.
  -- P5 (5000, …a1) NE DOIT PAS y être — c'est la cloison, mesurée.
  PERFORM pg_temp.controle('C2b · montants exacts attendus pour …a2',
    (o->'pulse'->>'factureDzd')::bigint = 10000
      AND (o->'pulse'->>'encaisseAssietteDzd')::bigint = 4000
      AND (o->'pulse'->>'attenteDzd')::bigint = 6000
      AND (o->'pulse'->>'seancesTarifees')::bigint = 4,
    'facturé=' || (o->'pulse'->>'factureDzd')
      || ' encaissé=' || (o->'pulse'->>'encaisseAssietteDzd')
      || ' attente=' || (o->'pulse'->>'attenteDzd')
      || ' séances=' || (o->'pulse'->>'seancesTarifees'));

  -- ══ C3 · CLOISON · le paiement de l'owner est INVISIBLE à …a2 ════════════
  PERFORM pg_temp.controle('C3 · cloison ADR-005 — P5 (…a1) absent du total …a2',
    (o->'pulse'->>'factureDzd')::bigint = 10000,
    'si 15000, la cloison est tombée');

  -- ══ C4 · FUSEAU · la frontière de journée est celle d''ALGER ═════════════
  -- P1 = 23:30 Alger le 10 (22:30 UTC), P2 = 00:30 Alger le 11 (23:30 UTC le 10).
  -- En UTC les deux tomberaient le 10. Ce contrôle échoue si `AT TIME ZONE`
  -- disparaît un jour de la porte.
  PERFORM pg_temp.controle('C4 · frontière de journée en Africa/Algiers (23:30)',
    (o10->'pulse'->>'factureDzd')::bigint = 1000,
    '10 mars = ' || (o10->'pulse'->>'factureDzd') || ' (attendu 1000)');
  PERFORM pg_temp.controle('C4b · frontière de journée en Africa/Algiers (00:30)',
    (o11->'pulse'->>'factureDzd')::bigint = 2000,
    '11 mars = ' || (o11->'pulse'->>'factureDzd') || ' (attendu 2000)');

  -- ══ C5 · NON-RÉGRESSION DE 029 · finance_overview(d,d) == day_revenue(d) ═
  -- Le contrôle le plus fort du fichier : la nouvelle porte doit rendre
  -- EXACTEMENT ce que rend l'ancienne sur une journée. Si les deux divergent,
  -- l'une des deux ment, et l'écran a déjà menti une fois (« Recette du jour »
  -- sur un montant facturé).
  SELECT * INTO dr FROM app.day_revenue('2025-03-15');
  PERFORM pg_temp.controle('C5 · finance_overview(d,d) == day_revenue(d)',
    (o15->'pulse'->>'factureDzd')::bigint      = dr.total_dzd
      AND (o15->'pulse'->>'attenteDzd')::bigint    = dr.attente_dzd
      AND (o15->'pulse'->>'attenteNombre')::bigint = dr.attente_nombre
      AND (o15->'pulse'->>'seancesTarifees')::bigint = dr.seances
      AND (o15->>'perimetre')                      = dr.perimetre,
    'overview=' || (o15->'pulse'->>'factureDzd') || '/' || (o15->'pulse'->>'attenteDzd')
      || '  day_revenue=' || dr.total_dzd || '/' || dr.attente_dzd);

  -- ══ C6 · COMPTABILITÉ DE CAISSE ≠ ASSIETTE FACTURÉ ══════════════════════
  -- P3 est facturé le 15 mars et encaissé le 20 : les deux dans la fenêtre de
  -- mars, donc encaissé(période) = 1000 (P1) + 3000 (P3) = 4000. Le distinguer
  -- de l''assiette est tout l''enjeu du taux d''encaissement.
  PERFORM pg_temp.controle('C6 · encaissé(période, caisse) mesuré sur collected_at',
    (o->'pulse'->>'encaissePeriodeDzd')::bigint = 4000,
    'encaissé(période)=' || (o->'pulse'->>'encaissePeriodeDzd') || ' (attendu 4000)');

  -- Et sur une fenêtre où P3 est encaissé mais NON facturé : du 16 au 31 mars,
  -- rien n''est facturé, mais 3000 sont entrés en caisse le 20.
  PERFORM pg_temp.controle('C6b · caisse sans facturation — 16→31 mars',
    (app.finance_overview('2025-03-16','2025-03-31')->'pulse'->>'encaissePeriodeDzd')::bigint = 3000
      AND (app.finance_overview('2025-03-16','2025-03-31')->'pulse'->>'factureDzd')::bigint = 0,
    'la caisse peut recevoir sans que la période facture — les deux sont vrais');

  -- ══ C7 · I-5 / I-6 · le taux, et le zéro qui n''est pas un taux ══════════
  PERFORM pg_temp.controle('C7 · I-5 taux dans [0,100]',
    (o->'pulse'->>'tauxEncaissement')::numeric BETWEEN 0 AND 100,
    'taux=' || coalesce(o->'pulse'->>'tauxEncaissement', 'NULL') || ' (attendu 40.0)');

  PERFORM pg_temp.controle('C7b · taux exact = encaissé/facturé',
    (o->'pulse'->>'tauxEncaissement')::numeric = 40.0,
    '4000/10000 = 40.0 %');

  -- I-6 : sur une fenêtre SANS facturation, le taux est NULL — jamais 0 %, qui
  -- se lirait « elle n''a rien encaissé » là où la vérité est « elle n''a rien
  -- facturé ». Deux phrases différentes, deux états différents.
  PERFORM pg_temp.controle('C7c · I-6 facturé=0 ⇒ taux NULL, jamais 0 %',
    (app.finance_overview('2025-02-01','2025-02-28')->'pulse'->'tauxEncaissement') = 'null'::jsonb,
    'février 2025 est vide : taux=' ||
      coalesce(app.finance_overview('2025-02-01','2025-02-28')->'pulse'->>'tauxEncaissement', 'NULL'));

  PERFORM pg_temp.controle('C7d · I-6 facturé=0 ⇒ revenu moyen NULL',
    (app.finance_overview('2025-02-01','2025-02-28')->'pulse'->'revenuMoyenDzd') = 'null'::jsonb,
    'aucune séance : pas de moyenne, pas de 0');

  -- ══ C8 · I-4 · la série réconcilie avec le facturé ═══════════════════════
  SELECT SUM((e->>'factureDzd')::bigint) INTO v_serie
    FROM jsonb_array_elements(o->'serie') e;
  PERFORM pg_temp.controle('C8 · I-4 somme(série) = facturé',
    v_serie = (o->'pulse'->>'factureDzd')::bigint,
    'série=' || coalesce(v_serie::text,'NULL') || ' facturé=' || (o->'pulse'->>'factureDzd'));

  -- Les seaux VIDES sortent avec des zéros : mars a 31 jours, la série doit en
  -- avoir 31 au grain « jour ». Une courbe qui saute les jours creux se lit
  -- comme une interpolation, c''est-à-dire comme une donnée qui n''existe pas.
  PERFORM pg_temp.controle('C8b · seaux vides émis à zéro (31 jours en mars)',
    jsonb_array_length(o->'serie') = 31 AND o->>'grain' = 'jour',
    'grain=' || (o->>'grain') || ' seaux=' || jsonb_array_length(o->'serie'));

  -- ══ C9 · I-2 · la composition réconcilie avec le facturé ════════════════
  SELECT SUM((e->>'montantDzd')::bigint) INTO v_type
    FROM jsonb_array_elements(o->'parType') e;
  PERFORM pg_temp.controle('C9 · I-2 somme(parType) = facturé',
    v_type = (o->'pulse'->>'factureDzd')::bigint,
    'parType=' || coalesce(v_type::text,'NULL') || ' facturé=' || (o->'pulse'->>'factureDzd'));

  -- Les 4 fixtures n''ont pas de consultation : elles doivent TOUTES tomber
  -- dans « Non rattaché ». C''est ce seau qui fait tenir I-2 — le masquer
  -- donnerait un graphique qui ne totalise pas le chiffre affiché au-dessus.
  PERFORM pg_temp.controle('C9b · seau « Non rattaché » présent et étiqueté',
    EXISTS (SELECT 1 FROM jsonb_array_elements(o->'parType') e
             WHERE (e->>'nonRattache')::boolean AND (e->>'montantDzd')::bigint = 10000),
    'les 4 fixtures sont sans consultation : 10000 en « Non rattaché »');

  -- ══ C10 · parPraticienne VIDE pour une praticienne, décidé EN BASE ══════
  PERFORM pg_temp.controle('C10 · parPraticienne vide pour une praticienne',
    jsonb_array_length(o->'parPraticienne') = 0,
    'décidé dans la porte, pas filtré par l''écran (règle 4)');

  -- ══ C11 · les points d''attention ne se déclenchent pas sur du bruit ════
  -- 2 impayés seulement : sous le plancher de 3. Une alerte qui décrit le
  -- hasard apprend à ignorer les alertes.
  PERFORM pg_temp.controle('C11 · plancher d''échantillon des points d''attention',
    jsonb_array_length(o->'points') = 0,
    '2 impayés < plancher de 3 — aucune alerte, et c''est voulu');

  -- ══ C12 · la comparaison, et le zéro qui n''est pas un pourcentage ══════
  -- Février 2025 est vide, donc la comparaison de mars part de zéro.
  PERFORM pg_temp.controle('C12 · précédent=0 ⇒ sens=nouveau, pourcentage NULL',
    o->'pulse'->'varFacture'->>'sens' = 'nouveau'
      AND (o->'pulse'->'varFacture'->'pourcentage') = 'null'::jsonb,
    'sens=' || (o->'pulse'->'varFacture'->>'sens')
      || ' pct=' || coalesce(o->'pulse'->'varFacture'->>'pourcentage','NULL')
      || ' — jamais ∞ %, jamais +100 %');

  PERFORM pg_temp.controle('C12b · joursCompares rendu à l''écran',
    (o->'pulse'->'varFacture'->>'joursCompares')::int = 31,
    'la comparaison est à durée égale, et le dit');

  -- ══ C13 · GRAIN décidé en base ═══════════════════════════════════════════
  PERFORM pg_temp.controle('C13 · grain jour ≤ 31 j',
    app.finance_overview('2025-03-01','2025-03-31')->>'grain' = 'jour', '31 jours');
  PERFORM pg_temp.controle('C13b · grain semaine ≤ 120 j',
    app.finance_overview('2025-01-01','2025-03-31')->>'grain' = 'semaine', '90 jours');
  PERFORM pg_temp.controle('C13c · grain mois > 120 j',
    app.finance_overview('2024-06-01','2025-03-31')->>'grain' = 'mois', '304 jours');
END $$;

-- ══ C14 · BORNES · une plage sans limite est un export ═════════════════════
DO $$
DECLARE v_leve boolean := false;
BEGIN
  BEGIN
    PERFORM app.finance_overview('2024-01-01', '2025-12-31');   -- 730 jours
  EXCEPTION WHEN others THEN v_leve := true;
  END;
  PERFORM pg_temp.controle('C14 · plage > 366 jours refusée EN BASE', v_leve,
    'une plage que l''appelant choisit sans limite n''est pas un écran');
END $$;

DO $$
DECLARE v_leve boolean := false;
BEGIN
  BEGIN
    PERFORM app.finance_overview('2025-03-31', '2025-03-01');   -- bornes inversées
  EXCEPTION WHEN others THEN v_leve := true;
  END;
  PERFORM pg_temp.controle('C14b · bornes inversées refusées', v_leve, '');
END $$;

-- ══ C15 · LE JOURNAL — pagination bornée et trace d''audit ═════════════════
DO $$
DECLARE
  v_lignes  bigint;
  v_total   bigint;
  v_avant   bigint;
  v_apres   bigint;
  v_pat_nb  bigint;
BEGIN
  SELECT pg_temp.traces_liste() INTO v_avant;

  SELECT count(*), max(total_count) INTO v_lignes, v_total
    FROM app.list_period_payments('2025-03-01','2025-03-31', 50, 0);

  SELECT pg_temp.traces_liste() INTO v_apres;

  PERFORM pg_temp.controle('C15 · journal — 4 lignes pour …a2, P5 exclu',
    v_lignes = 4 AND v_total = 4,
    'lignes=' || v_lignes || ' total=' || coalesce(v_total::text,'NULL'));

  -- Les 4 fixtures portent LA MÊME patiente …b2 : la trace doit valoir 1, pas 4.
  -- On trace les DOSSIERS approchés, pas les lignes affichées.
  PERFORM pg_temp.controle('C15b · une trace `liste` par PATIENT distinct de la page',
    (v_apres - v_avant) = 1,
    'traces écrites=' || (v_apres - v_avant) || ' pour 4 lignes / 1 patiente distincte');

  -- Pagination bornée EN BASE : on demande 500, on obtient au plus 100.
  SELECT count(*) INTO v_lignes
    FROM app.list_period_payments('2025-03-01','2025-03-31', 500, 0);
  PERFORM pg_temp.controle('C15c · p_limit plafonné à 100 en base',
    v_lignes <= 100, 'demandé 500, rendu ' || v_lignes);

  -- Page au-delà de la fin : zéro ligne, et AUCUNE trace — elle n''a rien lu.
  SELECT pg_temp.traces_liste() INTO v_avant;
  SELECT count(*) INTO v_lignes
    FROM app.list_period_payments('2025-03-01','2025-03-31', 50, 999);
  SELECT pg_temp.traces_liste() INTO v_apres;
  PERFORM pg_temp.controle('C15d · page vide ⇒ 0 ligne ET 0 trace',
    v_lignes = 0 AND (v_apres - v_avant) = 0,
    'journaliser une lecture qui n''a pas eu lieu serait une trace FAUSSE');
END $$;

-- ══ C16 · finance_overview NE TRACE RIEN — elle ne nomme personne ══════════
DO $$
DECLARE v_avant bigint; v_apres bigint;
BEGIN
  SELECT pg_temp.traces_total() INTO v_avant;
  PERFORM app.finance_overview('2025-03-01','2025-03-31');
  SELECT pg_temp.traces_total() INTO v_apres;
  PERFORM pg_temp.controle('C16 · finance_overview écrit 0 ligne d''audit',
    (v_apres - v_avant) = 0,
    'elle ne joint pas app.patients — journaliser serait une fausse lecture (I4)');
END $$;

-- ---------------------------------------------------------------------------
-- Sous l'identité de l'OWNER …a1
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

DO $$
DECLARE o jsonb; v_prat bigint;
BEGIN
  o := app.finance_overview('2025-03-01','2025-03-31');

  PERFORM pg_temp.controle('C17 · owner — périmètre « cabinet »',
    o->>'perimetre' = 'cabinet', 'perimetre=' || coalesce(o->>'perimetre','NULL'));

  -- L'owner voit les 5 fixtures : 10000 (…a2) + 5000 (…a1) = 15000.
  -- C'est le pendant exact de C3 : la même donnée, deux périmètres, deux totaux.
  PERFORM pg_temp.controle('C17b · owner voit tout le cabinet — 15000',
    (o->'pulse'->>'factureDzd')::bigint = 15000,
    'facturé=' || (o->'pulse'->>'factureDzd') || ' (…a2 10000 + …a1 5000)');

  -- I-3 · la répartition par praticienne réconcilie, et n'existe que pour lui.
  SELECT SUM((e->>'montantDzd')::bigint) INTO v_prat
    FROM jsonb_array_elements(o->'parPraticienne') e;
  PERFORM pg_temp.controle('C18 · I-3 somme(parPraticienne) = facturé',
    v_prat = (o->'pulse'->>'factureDzd')::bigint,
    'parPraticienne=' || coalesce(v_prat::text,'NULL'));

  PERFORM pg_temp.controle('C18b · parPraticienne non vide pour l''owner',
    jsonb_array_length(o->'parPraticienne') = 2, 'deux praticiennes');

  -- I-1 tient aussi au périmètre cabinet.
  PERFORM pg_temp.controle('C18c · I-1 tient au périmètre cabinet',
    (o->'pulse'->>'factureDzd')::bigint
      = (o->'pulse'->>'encaisseAssietteDzd')::bigint
      + (o->'pulse'->>'attenteDzd')::bigint, '');
END $$;

-- ---------------------------------------------------------------------------
-- Sous l'identité de l'ASSISTANTE …a3 — l'écran vide, jamais un refus
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';

DO $$
DECLARE
  o jsonb; v_lignes bigint; v_avant bigint; v_apres bigint; v_erreur boolean := false;
BEGIN
  BEGIN
    o := app.finance_overview('2025-03-01','2025-03-31');
  EXCEPTION WHEN others THEN v_erreur := true;
  END;

  -- NULL, et surtout PAS une exception. Un « accès refusé » lui apprendrait
  -- qu'il y a un chiffre à ne pas voir (029 §4).
  PERFORM pg_temp.controle('C19 · assistante — NULL, et AUCUNE exception',
    NOT v_erreur AND o IS NULL,
    'exception=' || v_erreur::text || ' résultat=' || coalesce(o::text,'NULL'));

  SELECT pg_temp.traces_liste() INTO v_avant;
  SELECT count(*) INTO v_lignes FROM app.list_period_payments('2025-03-01','2025-03-31',50,0);
  SELECT pg_temp.traces_liste() INTO v_apres;

  PERFORM pg_temp.controle('C19b · assistante — 0 ligne au journal',
    v_lignes = 0, 'lignes=' || v_lignes);
  PERFORM pg_temp.controle('C19c · assistante — 0 trace (elle n''a rien lu)',
    (v_apres - v_avant) = 0, 'traces=' || (v_apres - v_avant));
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Propriété et privilèges — la cloison ne tient QUE si le propriétaire est bon
-- ---------------------------------------------------------------------------
-- C'est le contrôle qui aurait arrêté 018. Une porte DEFINER possédée par
-- `postgres` (rolbypassrls) ne voit AUCUNE policy : elle rendrait tout le
-- cabinet à n'importe qui, et la migration serait restée verte.
DO $$
BEGIN
  PERFORM pg_temp.controle('C20 · finance_overview appartient à app_gatekeeper',
    (SELECT proowner::regrole::text = 'app_gatekeeper'
       FROM pg_proc WHERE proname = 'finance_overview'), '');
  PERFORM pg_temp.controle('C20b · list_period_payments appartient à app_gatekeeper',
    (SELECT proowner::regrole::text = 'app_gatekeeper'
       FROM pg_proc WHERE proname = 'list_period_payments'), '');
  PERFORM pg_temp.controle('C21 · app_gatekeeper n''a PAS BYPASSRLS',
    (SELECT NOT rolbypassrls FROM pg_roles WHERE rolname = 'app_gatekeeper'),
    'sans ça, les policies de 011 ne s''appliquent plus sous les portes');

  -- Les portes de 029 sont-elles TOUJOURS intactes ? Un DROP les aurait rendues
  -- à `postgres` sans que rien ne le signale.
  PERFORM pg_temp.controle('C22 · 029 intacte — day_revenue toujours à app_gatekeeper',
    (SELECT proowner::regrole::text = 'app_gatekeeper'
       FROM pg_proc WHERE proname = 'day_revenue'), '');
  PERFORM pg_temp.controle('C22b · 029 intacte — list_day_payments idem',
    (SELECT proowner::regrole::text = 'app_gatekeeper'
       FROM pg_proc WHERE proname = 'list_day_payments'), '');

  -- `PUBLIC` reçoit EXECUTE par défaut sur toute fonction neuve : sans REVOKE,
  -- `service_role` (rolbypassrls) appellerait ces portes sans cloison.
  PERFORM pg_temp.controle('C23 · EXECUTE révoqué à PUBLIC sur finance_overview',
    NOT has_function_privilege('public', 'app.finance_overview(date,date)', 'EXECUTE'), '');
  PERFORM pg_temp.controle('C23b · EXECUTE accordé à authenticated',
    has_function_privilege('authenticated', 'app.finance_overview(date,date)', 'EXECUTE'), '');

  -- L'index de la comptabilité de caisse existe-t-il ?
  PERFORM pg_temp.controle('C24 · index payments_cabinet_collected posé',
    (SELECT count(*) = 1 FROM pg_indexes
      WHERE schemaname='app' AND indexname='payments_cabinet_collected'), '');
END $$;

-- ---------------------------------------------------------------------------
-- La fonction de variation, éprouvée seule
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.controle('C25 · variation 0→0 = stable, sans pourcentage',
    app.finance_variation(0,0,7)->>'sens' = 'stable'
      AND app.finance_variation(0,0,7)->'pourcentage' = 'null'::jsonb, '');
  PERFORM pg_temp.controle('C25b · variation 0→5000 = nouveau, JAMAIS +∞ %',
    app.finance_variation(5000,0,7)->>'sens' = 'nouveau'
      AND app.finance_variation(5000,0,7)->'pourcentage' = 'null'::jsonb, '');
  PERFORM pg_temp.controle('C25c · variation 1000→1000 = stable, 0.0 %',
    app.finance_variation(1000,1000,7)->>'sens' = 'stable'
      AND (app.finance_variation(1000,1000,7)->>'pourcentage')::numeric = 0.0, '');
  PERFORM pg_temp.controle('C25d · variation 1000→1250 = hausse, +25.0 %',
    app.finance_variation(1250,1000,7)->>'sens' = 'hausse'
      AND (app.finance_variation(1250,1000,7)->>'pourcentage')::numeric = 25.0, '');
  PERFORM pg_temp.controle('C25e · variation 1000→800 = baisse, −20.0 %',
    app.finance_variation(800,1000,7)->>'sens' = 'baisse'
      AND (app.finance_variation(800,1000,7)->>'pourcentage')::numeric = -20.0, '');
  PERFORM pg_temp.controle('C25f · variation NULL = indisponible',
    app.finance_variation(NULL,1000,7)->>'sens' = 'indisponible'
      AND app.finance_variation(NULL,1000,7)->'pourcentage' = 'null'::jsonb,
    'un taux absent ne se compare pas — il ne vaut pas zéro');
END $$;

\echo ''
\echo '⚠️  Les fixtures de mars 2025 sont ANNULÉES ci-dessous. Rien ne persiste.'

ROLLBACK;

-- Preuve que le ROLLBACK a bien eu lieu : les fixtures ne doivent plus exister.
\echo ''
SELECT CASE WHEN count(*) = 0
            THEN 'vert   | ROLLBACK vérifié — 0 fixture survivante'
            ELSE 'ROUGE  | ' || count(*) || ' FIXTURE(S) SURVIVANTE(S) — la base est polluée'
       END AS "verdict final"
FROM app.payments WHERE receipt_number LIKE 'FIXT-%';
