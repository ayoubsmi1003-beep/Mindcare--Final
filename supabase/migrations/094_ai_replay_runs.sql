-- 094_ai_replay_runs — M09 · historique des replays (slice 2, stockage seul).
--
-- OBJET : persister l'historique des runs `pnpm eval:replay` (kind simulate /
-- observe / compare) : en-tetes de runs + verdicts par cas. Le rapport JSON
-- reste l'export canonique ; ces tables en sont l'index requetable.
--
-- CONTENU AUTORISE : hashes (sha256), ids stables de cas, verdicts,
-- compteurs, metriques de latence. JAMAIS de texte libre patient, JAMAIS
-- de contextes/resultats d'outils, JAMAIS de tool_args (motif 058 §5 :
-- pas de donnee clinique structuree ; motif M09 : pas de second dossier).
-- Les CHECK `~ '^[0-9a-f]{64}$'` l'imposent au niveau de la base, pas du JS.
--
-- AUTORISATION TABLE NOUVELLE : plan M09 in-scope « run-record schema ...
-- (new tables only) » + audit §FILES TO MODIFY « run-record store (new
-- tables only) ». Aucune table/porte existante n'est modifiee.
--
-- ACCES : ecriture = operateur local uniquement (ingest SQL supervise,
-- precedent fixtures STATE 2026-09-05 : insertion directe postgres, jamais
-- depuis l'applicatif). AUCUNE porte d'ecriture exposée (surface minimale) :
-- aucun GRANT d'ecriture, meme pas a app_gatekeeper. Lecture = porte
-- `get_replay_history` (cabinet + role owner/practitioner, NULL hors
-- perimetre, anti-oracle ADR-003) ; assistante refusee (role clinique non
-- requis pour des metriques, principe du moindre privilege).
--
-- RETENTION : runs NE SONT PAS du dossier clinique — `expires_at` a
-- 12 mois par defaut (decision M09 a ratifier), purge operateur
-- `purger_replays()`. La doctrine de non-purge de `audit.log` (014) ne
-- s'etend explicitement PAS a ces tables.
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
CREATE TABLE app.ai_replay_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id      uuid NOT NULL REFERENCES app.cabinets(id),
    kind            text NOT NULL CHECK (kind IN ('simulate', 'observe', 'compare')),
    gate_version    text NOT NULL CHECK (gate_version = 'm09-replay-v1'),
    git_revision    text NOT NULL CHECK (char_length(btrim(git_revision)) BETWEEN 1 AND 64),
    verdict         text NOT NULL CHECK (verdict IN ('PASS', 'FAIL', 'NOT RUN')),
    pass_count      integer NOT NULL CHECK (pass_count >= 0),
    fail_count      integer NOT NULL CHECK (fail_count >= 0),
    not_run_count   integer NOT NULL CHECK (not_run_count >= 0),
    cas_count       integer NOT NULL CHECK (cas_count >= 0),
    goldens_hash    text NOT NULL CHECK (goldens_hash ~ '^[0-9a-f]{64}$'),
    schema_version  text NOT NULL CHECK (char_length(btrim(schema_version)) BETWEEN 1 AND 32),
    prompts_hash    text NOT NULL CHECK (char_length(btrim(prompts_hash)) BETWEEN 1 AND 64),
    duree_s         integer NOT NULL CHECK (duree_s >= 0),
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL DEFAULT (now() + interval '12 months')
);

CREATE TABLE app.ai_replay_cases (
    run_id      uuid NOT NULL REFERENCES app.ai_replay_runs(id) ON DELETE CASCADE,
    famille     text NOT NULL CHECK (famille IN ('intentions', 'conversation', 'connaissance')),
    case_id     text NOT NULL CHECK (char_length(btrim(case_id)) BETWEEN 1 AND 128),
    empreinte   text NOT NULL CHECK (empreinte ~ '^[0-9a-f]{64}$'),
    verdict     text NOT NULL CHECK (verdict IN ('PASS', 'FAIL', 'non-mappe')),
    PRIMARY KEY (run_id, famille, case_id)
);

CREATE INDEX IF NOT EXISTS ai_replay_runs_cabinet
    ON app.ai_replay_runs (cabinet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_replay_runs_expiration
    ON app.ai_replay_runs (expires_at);
CREATE INDEX IF NOT EXISTS ai_replay_cases_run
    ON app.ai_replay_cases (run_id);

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · RLS — owner + practitioner en lecture via porte ; rien d'autre
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE app.ai_replay_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_replay_runs FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.ai_replay_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_replay_cases FORCE  ROW LEVEL SECURITY;

-- Lecture directe reservee au cabinet, owner/practitioner. L'assistante
-- n'a aucun besoin metier de metriques de replay (moindre privilege).
-- Pas de policy d'ecriture : tout INSERT/UPDATE/DELETE applicatif est
-- refuse par defaut (defense en profondeur avec le REVOKE ci-dessous).
CREATE POLICY ai_replay_runs_read ON app.ai_replay_runs
    FOR SELECT TO authenticated
    USING (cabinet_id = app.current_cabinet()
             AND app.current_role() IN ('owner', 'practitioner'));

CREATE POLICY ai_replay_cases_read ON app.ai_replay_cases
    FOR SELECT TO authenticated
    USING (EXISTS (
             SELECT 1 FROM app.ai_replay_runs r
              WHERE r.id = run_id
                AND r.cabinet_id = app.current_cabinet())
             AND app.current_role() IN ('owner', 'practitioner'));

-- Zero chemin non trace : ecriture directe fermee a tous, y compris
-- app_gatekeeper (l'ingest est un geste operateur supervise, jamais un
-- appel applicatif). Lecture directe : authenticated filtre par policy.
REVOKE ALL ON app.ai_replay_runs  FROM authenticated, service_role;
REVOKE ALL ON app.ai_replay_cases FROM authenticated, service_role;
GRANT SELECT ON app.ai_replay_runs  TO authenticated;
GRANT SELECT ON app.ai_replay_cases TO authenticated;
GRANT SELECT ON app.ai_replay_runs  TO app_gatekeeper;
GRANT SELECT ON app.ai_replay_cases TO app_gatekeeper;

-- ───────────────────────────────────────────────────────────────────────────
-- 3 · Audit — meme mecanisme que 013/058
-- ───────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit ON app.ai_replay_runs;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON app.ai_replay_runs
    FOR EACH ROW EXECUTE FUNCTION audit.track();

DROP TRIGGER IF EXISTS trg_audit ON app.ai_replay_cases;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON app.ai_replay_cases
    FOR EACH ROW EXECUTE FUNCTION audit.track();

-- ───────────────────────────────────────────────────────────────────────────
-- 4 · Portes — DEFINER sous app_gatekeeper, lecture + purge operateur
-- ───────────────────────────────────────────────────────────────────────────

-- Historique d'un run : en-tete + cas, en UN appel jsonb a contrat
-- explicite (motif workspace 047 — jamais to_jsonb d'une table entiere).
-- Hors perimetre (autre cabinet, role assistant, run inconnu) : NULL,
-- jamais d'erreur oracle (ADR-003). Borne 1..500 cas.
CREATE OR REPLACE FUNCTION app.get_replay_history(p_run_id uuid, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_run jsonb;
  v_cas jsonb;
BEGIN
  SELECT jsonb_build_object(
           'contrat',      'm09-replay-v1',
           'runId',        r.id,
           'kind',         r.kind,
           'verdict',      r.verdict,
           'passCount',    r.pass_count,
           'failCount',    r.fail_count,
           'notRunCount',  r.not_run_count,
           'casCount',     r.cas_count,
           'goldensHash',  r.goldens_hash,
           'createdAt',    r.created_at)
    INTO v_run
    FROM app.ai_replay_runs r
   WHERE r.id = p_run_id
     AND r.cabinet_id = app.current_cabinet()
     AND app.current_role() IN ('owner', 'practitioner');

  IF v_run IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'famille',   c.famille,
             'id',        c.case_id,
             'empreinte', c.empreinte,
             'verdict',   c.verdict)
           ORDER BY c.famille ASC, c.case_id ASC), '[]'::jsonb)
    INTO v_cas
    FROM (
      SELECT * FROM app.ai_replay_cases
       WHERE run_id = p_run_id
       ORDER BY famille ASC, case_id ASC
       LIMIT least(greatest(COALESCE(p_limit, 200), 1), 500)
    ) c;

  RETURN jsonb_build_object('contrat', 'm09-replay-v1', 'run', v_run, 'cas', v_cas);
END;
$$;

-- Purge des runs expires. Operateur uniquement : aucun GRANT applicatif
-- (ni authenticated, ni mindcare_app). Le retour nomme ce qui part.
CREATE OR REPLACE FUNCTION app.purger_replays(p_conserver_mois integer DEFAULT 12)
RETURNS TABLE (runs_supprimes bigint, cas_supprimes bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_limite timestamptz;
  v_runs bigint;
  v_cas bigint;
BEGIN
  v_limite := now() - (least(greatest(COALESCE(p_conserver_mois, 12), 1), 120) || ' months')::interval;
  DELETE FROM app.ai_replay_cases c
   USING app.ai_replay_runs r
   WHERE c.run_id = r.id AND r.expires_at < v_limite;
  GET DIAGNOSTICS v_cas = ROW_COUNT;
  DELETE FROM app.ai_replay_runs r WHERE r.expires_at < v_limite;
  GET DIAGNOSTICS v_runs = ROW_COUNT;
  RETURN QUERY SELECT v_runs, v_cas;
END;
$$;

ALTER FUNCTION app.get_replay_history(uuid, integer) OWNER TO app_gatekeeper;
ALTER FUNCTION app.purger_replays(integer) OWNER TO app_gatekeeper;

COMMENT ON TABLE app.ai_replay_runs IS
  'M09 : en-tetes de runs eval:replay (hashes/verdicts/metriques, jamais de texte patient). Retention 12 mois, purge operateur.';
COMMENT ON TABLE app.ai_replay_cases IS
  'M09 : verdicts par cas (famille/id/empreinte sha256). Ecriture operateur uniquement.';
COMMENT ON FUNCTION app.get_replay_history(uuid, integer) IS
  'M09 : historique d''un run du cabinet (owner/practitioner), NULL hors perimetre, borne 1..500 cas.';
COMMENT ON FUNCTION app.purger_replays(integer) IS
  'M09 : purge operateur des runs expires (defaut 12 mois, borne 1..120). Aucun GRANT applicatif.';

REVOKE ALL ON FUNCTION app.get_replay_history(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.purger_replays(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.get_replay_history(uuid, integer) TO authenticated;
-- purger_replays : volontairement SANS grant (operateur via psql supervise).

-- ───────────────────────────────────────────────────────────────────────────
-- 5 · Retrait du privilege de transfert — motif 020 §5
-- ───────────────────────────────────────────────────────────────────────────
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('094_ai_replay_runs')
    ON CONFLICT DO NOTHING;

COMMIT;
