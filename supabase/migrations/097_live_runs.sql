-- 097_live_runs — M09 · historique live filtre (reliquat, persistance).
--
-- OBJET : persister l'historique des tours captes par la couture live
-- (`shared/jarvis/enregistrement-live.ts`, contrat `m09-live-v2`) : en-tetes
-- de runs + appels + preuves. L'export JSON de l'anneau reste l'export
-- canonique ; ces tables en sont l'index requetable, comme 094 l'est pour
-- les rapports `eval:replay`.
--
-- CONTENU AUTORISE : empreintes (FNV-1a 8-hex + SHA-256 64-hex), enums
-- fermees (chemin, capacites, codes classes, intentions M01), comptes,
-- durees, metadonnees C4 (titre/section/version des preuves, bornes du
-- contrat fil `preuves.ts`). JAMAIS de texte libre patient, JAMAIS de
-- conversation, JAMAIS d'extraits, JAMAIS d'args/resultats d'outils, JAMAIS
-- de snapshots/ancres/mentions, JAMAIS d'identifiant brut (run, toolCall,
-- action, patient, conversation : que des empreintes). Les CHECK
-- `~ '^[0-9a-f]{64}$'` / `'^[0-9a-f]{8}$'` l'imposent au niveau de la base,
-- pas du JS. Motif 058 §5 : pas de donnee clinique structuree ; motif M09 :
-- pas de second dossier.
--
-- AUTORISATION TABLE NOUVELLE : mission M09 in-scope « run-record schema ...
-- (new tables only) » + audit §FILES TO MODIFY « run-record store (new
-- tables only) » + decision humaine verrouillee (reliquat M09, option A :
-- migration 097, ratification regle 9). Precedent direct : 094 (meme
-- doctrine, meme forme). Aucune table/porte existante n'est modifiee.
--
-- ACCES : ecriture = operateur local uniquement (ingest SQL supervise,
-- `scripts/ingerer-live.mjs`, precedent fixtures STATE 2026-09-05 et
-- `ingerer-replay.mjs` : insertion directe postgres, jamais depuis
-- l'applicatif). AUCUNE porte d'ecriture exposee (surface minimale) :
-- aucun GRANT d'ecriture applicatif. Lecture = portes `get_live_history`
-- + `get_observability_stats` (cabinet + role owner/practitioner, NULL hors
-- perimetre, anti-oracle ADR-003) ; assistante refusee (role clinique non
-- requis pour des metriques, principe du moindre privilege).
--
-- RETENTION : runs NE SONT PAS du dossier clinique — `expires_at` a
-- 12 mois par defaut (decision M09 ratifiee, meme fenetre que 094), purge
-- operateur `purger_lives()`. La doctrine de non-purge de `audit.log` (014)
-- ne s'etend explicitement PAS a ces tables.
--
-- CONTRAT : `m09-live-v2` (additif sur `m09-live-v1`, qui reste fige et
-- lisible ; l'ingest v2 refuse les exports v1 par defaut). Anneau OFF par
-- defaut : la captation reste un acte de politique, jamais un defaut.
--
-- ROLLBACK : migration de suivi (jamais d'edition — regle 9).
--
-- Conventions : BEGIN/COMMIT + `schema_migrations`, `CREATE` (neuf),
-- `OWNER TO app_gatekeeper`, RLS ENABLE+FORCE, REVOKE large, GRANT etroit,
-- `trg_audit` (013/058), `SET search_path` fige (motif 003), noms qualifies.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1 · Les tables
-- ───────────────────────────────────────────────────────────────────────────
-- Un run = un tour logique Jarvis capture (BilanTour projete). Les appels
-- (<=6, budget boucle) et les preuves (<=5, MAX_PREUVES_FIL) vivent en
-- tables filles : CHECK par element, requete bornee, meme forme que 094
-- (runs + cases). Pas de colonne jsonb libre : un tableau libre deviendrait
-- le second entrepot que toute cette architecture existe pour eviter.
CREATE TABLE app.ai_live_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id      uuid NOT NULL REFERENCES app.cabinets(id),
    gate_version    text NOT NULL CHECK (gate_version = 'm09-live-v2'),
    git_revision    text NOT NULL CHECK (char_length(btrim(git_revision)) BETWEEN 1 AND 64),
    empreinte_run   text NOT NULL CHECK (empreinte_run ~ '^[0-9a-f]{8}$'),
    empreinte       text NOT NULL CHECK (empreinte ~ '^[0-9a-f]{8}$'),
    empreinte_sha256 text NOT NULL CHECK (empreinte_sha256 ~ '^[0-9a-f]{64}$'),
    chemin          text NOT NULL CHECK (chemin IN ('connaissance', 'patient', 'refus', 'inconnu')),
    interrompu      boolean NOT NULL,
    persiste        boolean NOT NULL,
    duree_ms        integer NOT NULL CHECK (duree_ms >= 0),
    nb_appels       integer NOT NULL CHECK (nb_appels >= 0),
    nb_preuves      integer NOT NULL CHECK (nb_preuves >= 0),
    nb_snapshots    integer NOT NULL CHECK (nb_snapshots >= 0),
    proposition_inconnue text CHECK (proposition_inconnue IS NULL OR char_length(proposition_inconnue) BETWEEN 1 AND 128),
    resolution_etat text CHECK (resolution_etat IS NULL OR char_length(btrim(resolution_etat)) BETWEEN 1 AND 64),
    intention_chainee text CHECK (intention_chainee IS NULL OR char_length(btrim(intention_chainee)) BETWEEN 1 AND 64),
    intention_retenue text CHECK (intention_retenue IS NULL OR char_length(btrim(intention_retenue)) BETWEEN 1 AND 64),
    retrieval_fp    text[] CHECK (retrieval_fp IS NULL OR array_to_string(retrieval_fp, ',') ~ '^([0-9a-f]{64},){0,4}[0-9a-f]{64}$'),
    approval_fp     text CHECK (approval_fp IS NULL OR approval_fp ~ '^([0-9a-f]{8}|[0-9a-f]{64})$'),
    execution_fp    text CHECK (execution_fp IS NULL OR execution_fp ~ '^([0-9a-f]{8}|[0-9a-f]{64})$'),
    prompts_hash    text CHECK (prompts_hash IS NULL OR char_length(btrim(prompts_hash)) BETWEEN 1 AND 64),
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL DEFAULT (now() + interval '12 months')
);

CREATE TABLE app.ai_live_calls (
    run_id      uuid NOT NULL REFERENCES app.ai_live_runs(id) ON DELETE CASCADE,
    idx         integer NOT NULL CHECK (idx >= 0),
    capacite    text NOT NULL CHECK (char_length(btrim(capacite)) BETWEEN 1 AND 128),
    ms          integer NOT NULL CHECK (ms >= 0),
    ok          boolean NOT NULL,
    code        text CHECK (code IS NULL OR char_length(btrim(code)) BETWEEN 1 AND 64),
    deduplique  boolean NOT NULL,
    tool_call_fp text CHECK (tool_call_fp IS NULL OR tool_call_fp ~ '^([0-9a-f]{8}|[0-9a-f]{64})$'),
    PRIMARY KEY (run_id, idx)
);

CREATE TABLE app.ai_live_proofs (
    run_id       uuid NOT NULL REFERENCES app.ai_live_runs(id) ON DELETE CASCADE,
    idx          integer NOT NULL CHECK (idx >= 0),
    titre        text NOT NULL CHECK (char_length(titre) BETWEEN 1 AND 120),
    section      text CHECK (section IS NULL OR char_length(section) <= 120),
    version      text NOT NULL CHECK (char_length(version) BETWEEN 1 AND 32),
    retrieval_fp text NOT NULL CHECK (retrieval_fp ~ '^[0-9a-f]{64}$'),
    PRIMARY KEY (run_id, idx)
);

CREATE INDEX IF NOT EXISTS ai_live_runs_cabinet
    ON app.ai_live_runs (cabinet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_live_runs_expiration
    ON app.ai_live_runs (expires_at);
CREATE INDEX IF NOT EXISTS ai_live_calls_run
    ON app.ai_live_calls (run_id);
CREATE INDEX IF NOT EXISTS ai_live_proofs_run
    ON app.ai_live_proofs (run_id);

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · RLS — owner + practitioner en lecture via portes ; rien d'autre
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE app.ai_live_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_live_runs FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.ai_live_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_live_calls FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.ai_live_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_live_proofs FORCE  ROW LEVEL SECURITY;

-- Lecture directe reservee au cabinet, owner/practitioner. L'assistante
-- n'a aucun besoin metier de metriques d'observabilite (moindre privilege).
-- Pas de policy d'ecriture : tout INSERT/UPDATE/DELETE applicatif est
-- refuse par defaut (defense en profondeur avec le REVOKE ci-dessous).
CREATE POLICY ai_live_runs_read ON app.ai_live_runs
    FOR SELECT TO authenticated
    USING (cabinet_id = app.current_cabinet()
             AND app.current_role() IN ('owner', 'practitioner'));

CREATE POLICY ai_live_calls_read ON app.ai_live_calls
    FOR SELECT TO authenticated
    USING (EXISTS (
             SELECT 1 FROM app.ai_live_runs r
              WHERE r.id = run_id
                AND r.cabinet_id = app.current_cabinet())
             AND app.current_role() IN ('owner', 'practitioner'));

CREATE POLICY ai_live_proofs_read ON app.ai_live_proofs
    FOR SELECT TO authenticated
    USING (EXISTS (
             SELECT 1 FROM app.ai_live_runs r
              WHERE r.id = run_id
                AND r.cabinet_id = app.current_cabinet())
             AND app.current_role() IN ('owner', 'practitioner'));

-- Maintenance operateur (lecon 096 : sans policy TO app_gatekeeper, la
-- porte DEFINER ne voit aucune ligne sous RLS FORCE). Atteignable
-- uniquement via superuser SET ROLE ou les portes DEFINER qu'il possede —
-- jamais depuis l'applicatif (withCaller : SET LOCAL ROLE, jamais
-- app_gatekeeper).
CREATE POLICY ai_live_runs_maintenance ON app.ai_live_runs
    FOR ALL TO app_gatekeeper
    USING (true)
    WITH CHECK (true);

CREATE POLICY ai_live_calls_maintenance ON app.ai_live_calls
    FOR ALL TO app_gatekeeper
    USING (true)
    WITH CHECK (true);

CREATE POLICY ai_live_proofs_maintenance ON app.ai_live_proofs
    FOR ALL TO app_gatekeeper
    USING (true)
    WITH CHECK (true);

-- Zero chemin non trace : ecriture directe fermee a tous sauf
-- app_gatekeeper (lecon 095 : sans grant d'ecriture, meme `purger_lives()`
-- echoue en `permission denied`). L'applicatif tourne en
-- `authenticated`/`anon` et reste sans ecriture (pas de policy
-- d'ecriture : RLS FORCE refuse par defaut). Aucune porte d'ecriture
-- exposee : la seule ecriture possible reste `purger_lives()`.
REVOKE ALL ON app.ai_live_runs   FROM authenticated, service_role;
REVOKE ALL ON app.ai_live_calls  FROM authenticated, service_role;
REVOKE ALL ON app.ai_live_proofs FROM authenticated, service_role;
GRANT SELECT ON app.ai_live_runs   TO authenticated;
GRANT SELECT ON app.ai_live_calls  TO authenticated;
GRANT SELECT ON app.ai_live_proofs TO authenticated;
GRANT SELECT ON app.ai_live_runs   TO app_gatekeeper;
GRANT SELECT ON app.ai_live_calls  TO app_gatekeeper;
GRANT SELECT ON app.ai_live_proofs TO app_gatekeeper;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.ai_live_runs   TO app_gatekeeper;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.ai_live_calls  TO app_gatekeeper;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.ai_live_proofs TO app_gatekeeper;

-- ───────────────────────────────────────────────────────────────────────────
-- 3 · Audit — meme mecanisme que 013/058
-- ───────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit ON app.ai_live_runs;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON app.ai_live_runs
    FOR EACH ROW EXECUTE FUNCTION audit.track();

DROP TRIGGER IF EXISTS trg_audit ON app.ai_live_calls;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON app.ai_live_calls
    FOR EACH ROW EXECUTE FUNCTION audit.track();

DROP TRIGGER IF EXISTS trg_audit ON app.ai_live_proofs;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON app.ai_live_proofs
    FOR EACH ROW EXECUTE FUNCTION audit.track();

-- ───────────────────────────────────────────────────────────────────────────
-- 4 · Portes — DEFINER sous app_gatekeeper, lecture + purge operateur
-- ───────────────────────────────────────────────────────────────────────────

-- Historique d'un run live : en-tete + appels + preuves, en UN appel jsonb
-- a contrat explicite (motif workspace 047 — jamais to_jsonb d'une table
-- entiere). Hors perimetre (autre cabinet, role assistant, run inconnu) :
-- NULL, jamais d'erreur oracle (ADR-003). Borne 1..500 cas.
CREATE OR REPLACE FUNCTION app.get_live_history(p_run_id uuid, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_run jsonb;
  v_appels jsonb;
  v_preuves jsonb;
BEGIN
  SELECT jsonb_build_object(
           'contrat',      'm09-live-v2',
           'runId',        r.id,
           'gateVersion',  r.gate_version,
           'empreinteRun', r.empreinte_run,
           'empreinte',    r.empreinte,
           'chemin',       r.chemin,
           'interrompu',   r.interrompu,
           'persiste',     r.persiste,
           'dureeMs',      r.duree_ms,
           'nbAppels',     r.nb_appels,
           'nbPreuves',    r.nb_preuves,
           'nbSnapshots',  r.nb_snapshots,
           'propositionInconnue', r.proposition_inconnue,
           'resolutionEtat',      r.resolution_etat,
           'intentionChainee',    r.intention_chainee,
           'intentionRetenue',    r.intention_retenue,
           'retrievalFp',  r.retrieval_fp,
           'approvalFp',   r.approval_fp,
           'executionFp',  r.execution_fp,
           'createdAt',    r.created_at)
    INTO v_run
    FROM app.ai_live_runs r
   WHERE r.id = p_run_id
     AND r.cabinet_id = app.current_cabinet()
     AND app.current_role() IN ('owner', 'practitioner');

  IF v_run IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'capacite',   c.capacite,
             'ms',         c.ms,
             'ok',         c.ok,
             'code',       c.code,
             'deduplique', c.deduplique,
             'toolCallFp', c.tool_call_fp)
           ORDER BY c.idx ASC), '[]'::jsonb)
    INTO v_appels
    FROM (
      SELECT * FROM app.ai_live_calls
       WHERE run_id = p_run_id
       ORDER BY idx ASC
       LIMIT least(greatest(COALESCE(p_limit, 200), 1), 500)
    ) c;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'titre',       p.titre,
             'section',     p.section,
             'version',     p.version,
             'retrievalFp', p.retrieval_fp)
           ORDER BY p.idx ASC), '[]'::jsonb)
    INTO v_preuves
    FROM (
      SELECT * FROM app.ai_live_proofs
       WHERE run_id = p_run_id
       ORDER BY idx ASC
       LIMIT least(greatest(COALESCE(p_limit, 200), 1), 500)
    ) p;

  RETURN jsonb_build_object('contrat', 'm09-live-v2', 'run', v_run, 'appels', v_appels, 'preuves', v_preuves);
END;
$$;

-- Purge des runs expires. Operateur uniquement : aucun GRANT applicatif
-- (ni authenticated, ni mindcare_app). Le retour nomme ce qui part.
CREATE OR REPLACE FUNCTION app.purger_lives(p_conserver_mois integer DEFAULT 12)
RETURNS TABLE (runs_supprimes bigint, cas_supprimes bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_limite timestamptz;
  v_runs bigint;
  v_calls bigint;
  v_proofs bigint;
BEGIN
  v_limite := now() - (least(greatest(COALESCE(p_conserver_mois, 12), 1), 120) || ' months')::interval;
  DELETE FROM app.ai_live_calls c
   USING app.ai_live_runs r
   WHERE c.run_id = r.id AND r.expires_at < v_limite;
  GET DIAGNOSTICS v_calls = ROW_COUNT;
  DELETE FROM app.ai_live_proofs p
   USING app.ai_live_runs r
   WHERE p.run_id = r.id AND r.expires_at < v_limite;
  GET DIAGNOSTICS v_proofs = ROW_COUNT;
  DELETE FROM app.ai_live_runs r WHERE r.expires_at < v_limite;
  GET DIAGNOSTICS v_runs = ROW_COUNT;
  RETURN QUERY SELECT v_runs, v_calls + v_proofs;
END;
$$;

-- Agregats d'observabilite (durees et verdicts, jamais de couts) : PG
-- calcule, le service formate (precedent M04 : PG calcule, LLM formate).
-- Fenetre bornee 1..365 jours. Couts monetaires EXCLUS par doctrine :
-- `audit.boundary_crossings` n'a aucune porte de lecture (028) et son
-- `session_token` est non-correlationniste par construction — aucune
-- jointure aux runs n'est possible ni souhaitable.
CREATE OR REPLACE FUNCTION app.get_observability_stats(p_jours integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_fenetre integer := least(greatest(COALESCE(p_jours, 30), 1), 365);
  v_live jsonb;
  v_replay jsonb;
BEGIN
  IF app.current_role() NOT IN ('owner', 'practitioner') THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
           'runs', COUNT(*),
           'p50Ms', COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY duree_ms)::integer, 0),
           'p95Ms', COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duree_ms)::integer, 0),
           'parChemin', COALESCE(jsonb_object_agg(chemin, n) FILTER (WHERE chemin IS NOT NULL), '{}'::jsonb))
    INTO v_live
    FROM (
      SELECT r.chemin, r.duree_ms, COUNT(*) OVER (PARTITION BY r.chemin) AS n
        FROM app.ai_live_runs r
       WHERE r.cabinet_id = app.current_cabinet()
         AND r.created_at >= now() - (v_fenetre || ' days')::interval
    ) s;

  SELECT jsonb_build_object(
           'runs', COUNT(*),
           'pass', COALESCE(SUM(pass_count), 0),
           'fail', COALESCE(SUM(fail_count), 0),
           'notRun', COALESCE(SUM(not_run_count), 0))
    INTO v_replay
    FROM app.ai_replay_runs r
   WHERE r.cabinet_id = app.current_cabinet()
     AND r.created_at >= now() - (v_fenetre || ' days')::interval;

  RETURN jsonb_build_object(
    'contrat', 'm09-stats-v1',
    'fenetreJours', v_fenetre,
    'live', COALESCE(v_live, jsonb_build_object('runs', 0, 'p50Ms', 0, 'p95Ms', 0, 'parChemin', '{}'::jsonb)),
    'replay', COALESCE(v_replay, jsonb_build_object('runs', 0, 'pass', 0, 'fail', 0, 'notRun', 0)));
END;
$$;

ALTER FUNCTION app.get_live_history(uuid, integer) OWNER TO app_gatekeeper;
ALTER FUNCTION app.purger_lives(integer) OWNER TO app_gatekeeper;
ALTER FUNCTION app.get_observability_stats(integer) OWNER TO app_gatekeeper;

COMMENT ON TABLE app.ai_live_runs IS
  'M09 : en-tetes de runs live m09-live-v2 (empreintes/enums/comptes/durees, jamais de texte patient). Retention 12 mois, purge operateur.';
COMMENT ON TABLE app.ai_live_calls IS
  'M09 : appels par run (capacite/duree/code classe/empreinte tool_call). Ecriture operateur uniquement.';
COMMENT ON TABLE app.ai_live_proofs IS
  'M09 : preuves C4 par run (titre/section/version + empreinte retrieval). Ecriture operateur uniquement.';
COMMENT ON FUNCTION app.get_live_history(uuid, integer) IS
  'M09 : historique d''un run live du cabinet (owner/practitioner), NULL hors perimetre, borne 1..500.';
COMMENT ON FUNCTION app.purger_lives(integer) IS
  'M09 : purge operateur des runs live expires (defaut 12 mois, borne 1..120). Aucun GRANT applicatif.';
COMMENT ON FUNCTION app.get_observability_stats(integer) IS
  'M09 : agregats durees/verdicts replay+live du cabinet (owner/practitioner), fenetre 1..365 j. Sans couts.';

REVOKE ALL ON FUNCTION app.get_live_history(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.purger_lives(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_observability_stats(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.get_live_history(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION app.get_observability_stats(integer) TO authenticated;
-- purger_lives : volontairement SANS grant (operateur via psql supervise).

-- ───────────────────────────────────────────────────────────────────────────
-- 5 · Retrait du privilege de transfert — motif 020 §5
-- ───────────────────────────────────────────────────────────────────────────
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('097_live_runs')
    ON CONFLICT DO NOTHING;

COMMIT;
