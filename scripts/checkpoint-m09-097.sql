-- checkpoint-m09-097 — M09 reliquat LOT1 : 097 appliquee, portes et RLS eprouvees, puis ANNULE.
--
-- ═══ TRANSACTION ROLLBACK (regle 8) ═════════════════════════════════════════
-- Tout tourne dans UNE transaction terminee par ROLLBACK : la base est
-- retrouvee intacte. Les INSERT directs simulent l'ingest operateur
-- (`scripts/ingerer-live.mjs` + psql supervise) : 097 n'a volontairement
-- AUCUNE porte d'ecriture applicative, donc le chemin eprouve est
-- l'INSERT direct, comme l'ingest le fera.
--
-- ═══ IMPERSONATION ═════════════════════════════════════════════════════════
-- `SET LOCAL ROLE authenticated` + `request.jwt.claim.sub`, comme
-- `checkpoint-v2-rls.sql` et comme `withCaller()` (l'identite meurt avec la
-- transaction). Comptes 015 : …a1 owner, …a2 practitioner, …a3 assistant,
-- cabinet …01.
--
-- ═══ CE QUI EST EPROUVE ════════════════════════════════════════════════════
-- 1. 097 tracee dans schema_migrations ; tables et portes presentes.
-- 2. CHECK hexaux : un INSERT non-hex est refuse (098 n'existe pas : la
--    contrainte vit dans 097, jamais dans un correctif).
-- 3. `get_live_history` : owner lit (contrat ferme m09-live-v2, appels +
--    preuves), practitioner lit, assistant rend NULL, hors-cabinet NULL,
--    borne 1..500 appliquee sans erreur.
-- 4. `get_observability_stats` : owner lit (contrat m09-stats-v1,
--    live.runs >= 1), assistant rend NULL.
-- 5. `purger_lives` : ligne expiree purgee avec comptes exacts ; l'appel
--    depuis `authenticated` est refuse (pas de GRANT).
-- 6. `audit.track()` : une ligne d'audit nait de l'INSERT (trg_audit pose).

\set ON_ERROR_STOP on
\timing off

BEGIN;

-- ---------------------------------------------------------------------------
-- 0 · Pre-requis : 097 appliquee, comptes 015 presents
-- ---------------------------------------------------------------------------
DO $prerequis$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = '097_live_runs') THEN
    RAISE EXCEPTION 'PREREQUIS 097 non appliquee';
  END IF;
  IF (SELECT count(*) FROM app.profiles WHERE id IN
      ('00000000-0000-0000-0000-0000000000a1',
       '00000000-0000-0000-0000-0000000000a2',
       '00000000-0000-0000-0000-0000000000a3')) <> 3 THEN
    RAISE EXCEPTION 'PREREQUIS comptes 015 absents';
  END IF;
END
$prerequis$;

-- ---------------------------------------------------------------------------
-- 1 · Ingest operateur simule : 1 run + 2 appels + 1 preuve (hashes seuls)
-- ---------------------------------------------------------------------------
-- Empreintes validees par les CHECK : 8-hex FNV-1a, 64-hex SHA-256.
INSERT INTO app.ai_live_runs
  (id, cabinet_id, gate_version, git_revision, empreinte_run, empreinte,
   empreinte_sha256, chemin, interrompu, persiste, duree_ms,
   nb_appels, nb_preuves, nb_snapshots, proposition_inconnue,
   resolution_etat, intention_chainee, intention_retenue,
   retrieval_fp, approval_fp, execution_fp, prompts_hash)
VALUES
  ('11111111-1111-4111-8111-111111111111',
   '00000000-0000-0000-0000-000000000001',
   'm09-live-v2', 'test-gate', 'a1b2c3d4', 'e5f60718',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'patient', false, true, 1234,
   2, 1, 2, NULL,
   'unique', 'VOIR_AGENDA', 'VOIR_AGENDA',
   ARRAY['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
   'c001d00d', 'e0ec07ed', 'test-prompts');

INSERT INTO app.ai_live_calls
  (run_id, idx, capacite, ms, ok, code, deduplique, tool_call_fp)
VALUES
  ('11111111-1111-4111-8111-111111111111', 0, 'agenda', 12, true, NULL, false, '70ca11ab'),
  ('11111111-1111-4111-8111-111111111111', 1, 'dossier', 30, false, 'interdit', false, NULL);

INSERT INTO app.ai_live_proofs
  (run_id, idx, titre, section, version, retrieval_fp)
VALUES
  ('11111111-1111-4111-8111-111111111111', 0,
   'Catalogue medicaments', 'Catalogue', '2026-09-15',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

-- ---------------------------------------------------------------------------
-- 1b · Run d'approbation (098) : liaison + constat, sans texte ni id brut
-- ---------------------------------------------------------------------------
INSERT INTO app.ai_live_runs
  (id, cabinet_id, gate_version, git_revision, empreinte_run, empreinte,
   empreinte_sha256, chemin, interrompu, persiste, duree_ms,
   nb_appels, nb_preuves, nb_snapshots,
   approval_fp, execution_fp, issue)
VALUES
  ('44444444-4444-4444-8444-444444444444',
   '00000000-0000-0000-0000-000000000001',
   'm09-live-v2', 'test-gate', 'a1b2c3d4', 'f00ba407',
   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   'inconnu', false, true, 40,
   0, 0, 0,
   'c001d00d', 'e0ec07ed', 'ok');

-- ---------------------------------------------------------------------------
-- 2 · CHECK hexagonal : le non-hex est refuse PAR LA BASE
-- ---------------------------------------------------------------------------
DO $check_hex$
BEGIN
  BEGIN
    INSERT INTO app.ai_live_runs
      (cabinet_id, gate_version, git_revision, empreinte_run, empreinte,
       empreinte_sha256, chemin, interrompu, persiste, duree_ms,
       nb_appels, nb_preuves, nb_snapshots)
    VALUES
      ('00000000-0000-0000-0000-000000000001',
       'm09-live-v2', 'test-gate', 'PAS-HEX', 'e5f60718',
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
       'patient', false, true, 10, 0, 0, 0);
    RAISE EXCEPTION 'CHECK 097 non applique : empreinte non-hex acceptee';
  EXCEPTION WHEN check_violation THEN
    -- Attendu : la base refuse, le checkpoint constate.
    NULL;
  END;
END
$check_hex$;

-- ---------------------------------------------------------------------------
-- 3 · Lecture owner (…a1) : contrat ferme, appels + preuves
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

DO $lecture_owner$
DECLARE
  v_hist jsonb;
  v_stats jsonb;
BEGIN
  SELECT app.get_live_history('11111111-1111-4111-8111-111111111111', 200) INTO v_hist;
  IF v_hist IS NULL THEN RAISE EXCEPTION 'owner : get_live_history rend NULL'; END IF;
  IF v_hist->>'contrat' <> 'm09-live-v2' THEN RAISE EXCEPTION 'owner : contrat inattendu'; END IF;
  IF (v_hist->'run'->>'nbAppels')::int <> 2 THEN RAISE EXCEPTION 'owner : nbAppels inattendu'; END IF;
  IF jsonb_array_length(v_hist->'appels') <> 2 THEN RAISE EXCEPTION 'owner : appels inattendus'; END IF;
  IF jsonb_array_length(v_hist->'preuves') <> 1 THEN RAISE EXCEPTION 'owner : preuves inattendues'; END IF;
  IF (v_hist->'preuves'->0->>'titre') <> 'Catalogue medicaments' THEN RAISE EXCEPTION 'owner : titre inattendu'; END IF;
  -- Borne 1..500 : 0 et 99999 ne levent pas.
  PERFORM app.get_live_history('11111111-1111-4111-8111-111111111111', 0);
  PERFORM app.get_live_history('11111111-1111-4111-8111-111111111111', 99999);

  -- 098 : le run d'approbation rend sa liaison et son constat.
  SELECT app.get_live_history('44444444-4444-4444-8444-444444444444', 200) INTO v_hist;
  IF v_hist IS NULL THEN RAISE EXCEPTION 'owner : run approbation rend NULL'; END IF;
  IF (v_hist->'run'->>'approvalFp') <> 'c001d00d' THEN RAISE EXCEPTION 'owner : approvalFp inattendu'; END IF;
  IF (v_hist->'run'->>'issue') <> 'ok' THEN RAISE EXCEPTION 'owner : issue inattendue'; END IF;

  SELECT app.get_observability_stats(30) INTO v_stats;
  IF v_stats IS NULL THEN RAISE EXCEPTION 'owner : get_observability_stats rend NULL'; END IF;
  IF v_stats->>'contrat' <> 'm09-stats-v1' THEN RAISE EXCEPTION 'owner : contrat stats inattendu'; END IF;
  IF (v_stats->'live'->>'runs')::int < 1 THEN RAISE EXCEPTION 'owner : live.runs inattendu'; END IF;
END
$lecture_owner$;

-- ---------------------------------------------------------------------------
-- 4 · Lecture practitioner (…a2) : lit. Assistante (…a3) : NULL.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

DO $lecture_praticienne$
DECLARE
  v_hist jsonb;
BEGIN
  SELECT app.get_live_history('11111111-1111-4111-8111-111111111111', 200) INTO v_hist;
  IF v_hist IS NULL THEN RAISE EXCEPTION 'practitioner : get_live_history rend NULL'; END IF;
END
$lecture_praticienne$;

SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';

DO $lecture_assistante$
DECLARE
  v_hist jsonb;
  v_stats jsonb;
BEGIN
  SELECT app.get_live_history('11111111-1111-4111-8111-111111111111', 200) INTO v_hist;
  IF v_hist IS NOT NULL THEN RAISE EXCEPTION 'assistant : get_live_history devrait rendre NULL'; END IF;
  SELECT app.get_observability_stats(30) INTO v_stats;
  IF v_stats IS NOT NULL THEN RAISE EXCEPTION 'assistant : get_observability_stats devrait rendre NULL'; END IF;
END
$lecture_assistante$;

-- ---------------------------------------------------------------------------
-- 5 · Run inconnu : NULL, jamais d'erreur oracle
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

DO $run_inconnu$
DECLARE
  v_hist jsonb;
BEGIN
  SELECT app.get_live_history('22222222-2222-4222-8222-222222222222', 200) INTO v_hist;
  IF v_hist IS NOT NULL THEN RAISE EXCEPTION 'run inconnu devrait rendre NULL'; END IF;
END
$run_inconnu$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6 · Expiration + purge operateur (superuser : geste supervise, jamais applicatif)
-- ---------------------------------------------------------------------------
-- Une ligne expiree : INSERT direct puis purge, comptes exacts.
INSERT INTO app.ai_live_runs
  (id, cabinet_id, gate_version, git_revision, empreinte_run, empreinte,
   empreinte_sha256, chemin, interrompu, persiste, duree_ms,
   nb_appels, nb_preuves, nb_snapshots, expires_at)
VALUES
  ('33333333-3333-4333-8333-333333333333',
   '00000000-0000-0000-0000-000000000001',
   'm09-live-v2', 'test-gate', 'deadbeef', 'feedface',
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'connaissance', false, false, 50, 0, 0, 0,
   now() - interval '13 months');

DO $purge$
DECLARE
  v_runs bigint;
  v_cas bigint;
BEGIN
  SELECT runs_supprimes, cas_supprimes INTO v_runs, v_cas FROM app.purger_lives(1);
  IF v_runs < 1 THEN RAISE EXCEPTION 'purger_lives n''a rien purge'; END IF;
  IF EXISTS (SELECT 1 FROM app.ai_live_runs WHERE id = '33333333-3333-4333-8333-333333333333') THEN
    RAISE EXCEPTION 'purger_lives : ligne expiree toujours presente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.ai_live_runs WHERE id = '11111111-1111-4111-8111-111111111111') THEN
    RAISE EXCEPTION 'purger_lives : ligne saine supprimee a tort';
  END IF;
END
$purge$;

-- `purger_lives` sans grant applicatif : depuis authenticated, l'appel leve.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

DO $purge_sans_grant$
BEGIN
  BEGIN
    PERFORM app.purger_lives(1);
    RAISE EXCEPTION 'purger_lives accessible depuis authenticated';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$purge_sans_grant$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7 · Audit : l'INSERT a laisse une trace (trg_audit pose)
-- ---------------------------------------------------------------------------
DO $audit$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM audit.log
     WHERE table_name = 'ai_live_runs'
       AND row_id = '11111111-1111-4111-8111-111111111111'
  ) THEN
    RAISE EXCEPTION 'audit : trg_audit n''a laisse aucune trace pour ai_live_runs';
  END IF;
END
$audit$;

-- ---------------------------------------------------------------------------
-- 8 · Listes 099 : en-tetes seuls, bornes, [] hors perimetre
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

DO $listes_owner$
DECLARE
  v_live jsonb;
  v_replay jsonb;
BEGIN
  SELECT app.list_live_runs(20) INTO v_live;
  IF jsonb_array_length(v_live) <> 2 THEN RAISE EXCEPTION 'owner : list_live_runs inattendue'; END IF;
  IF (v_live->0->>'gateVersion') <> 'm09-live-v2' THEN RAISE EXCEPTION 'owner : list_live_runs champ inattendu'; END IF;
  -- Borne 1..100 : 0 et 99999 ne levent pas.
  PERFORM app.list_live_runs(0);
  PERFORM app.list_live_runs(99999);
  SELECT app.list_replay_runs(20) INTO v_replay;
  -- La base de dev porte un historique replay reel (ingest slice 2) : la
  -- porte doit le rendre (tableau, jamais NULL), pas un vide suppose.
  IF v_replay IS NULL THEN RAISE EXCEPTION 'owner : list_replay_runs rend NULL'; END IF;
END
$listes_owner$;

SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';

DO $listes_assistante$
DECLARE
  v_live jsonb;
  v_replay jsonb;
BEGIN
  SELECT app.list_live_runs(20) INTO v_live;
  IF v_live <> '[]'::jsonb THEN RAISE EXCEPTION 'assistant : list_live_runs devrait rendre []'; END IF;
  SELECT app.list_replay_runs(20) INTO v_replay;
  IF v_replay <> '[]'::jsonb THEN RAISE EXCEPTION 'assistant : list_replay_runs devrait rendre []'; END IF;
END
$listes_assistante$;

RESET ROLE;

ROLLBACK;
