-- 099_listes_observabilite — M09 · listes d'historiques (SUIVI, jamais d'edition — regle 9).
--
-- POURQUOI DES PORTES DE LISTE. `get_live_history` / `get_replay_history`
-- lisent UN run : sans liste, l'ecran d'inspection ne peut nommer aucun
-- run (l'ingest operateur vit hors navigateur). Ces deux portes rendent
-- les en-tetes seuls — chaque champ rendu est deja rendu par la porte
-- d'historique correspondante, aucun champ nouveau, aucune donnee
-- nouvelle. Bornees 1..100, plus recents d'abord.
--
-- ACCES : lecture seule, meme RLS que 094/097 (owner/practitioner via
-- `app.current_cabinet()` + `app.current_role()`). Hors perimetre
-- (assistante, autre cabinet) : tableau vide — une liste vide est la
-- reponse honnete dans tous les cas, jamais d'oracle (ADR-003). Aucun
-- GRANT nouveau au-dela de l'EXECUTE aux authentifies (les SELECT directs
-- restent reserves aux policies existantes).
--
-- Conventions : BEGIN/COMMIT + `schema_migrations`, `OWNER TO
-- app_gatekeeper`, `SET search_path` fige (motif 003), noms qualifies.

BEGIN;

-- Historique live recent : en-tetes seuls (champs deja exposes par
-- `get_live_history`, 097/098). Jamais to_jsonb d'une table entiere.
CREATE OR REPLACE FUNCTION app.list_live_runs(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'runId',        r.id,
             'gateVersion',  r.gate_version,
             'chemin',       r.chemin,
             'interrompu',   r.interrompu,
             'persiste',     r.persiste,
             'dureeMs',      r.duree_ms,
             'nbAppels',     r.nb_appels,
             'nbPreuves',    r.nb_preuves,
             'nbSnapshots',  r.nb_snapshots,
             'issue',        r.issue,
             'createdAt',    r.created_at)
           ORDER BY r.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT * FROM app.ai_live_runs
       WHERE cabinet_id = app.current_cabinet()
         AND app.current_role() IN ('owner', 'practitioner')
       ORDER BY created_at DESC
       LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100)
    ) r;
$$;

-- Historique replay recent : en-tetes seuls (champs deja exposes par
-- `get_replay_history`, 094).
CREATE OR REPLACE FUNCTION app.list_replay_runs(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'runId',       r.id,
             'kind',        r.kind,
             'verdict',     r.verdict,
             'passCount',   r.pass_count,
             'failCount',   r.fail_count,
             'notRunCount', r.not_run_count,
             'casCount',    r.cas_count,
             'createdAt',   r.created_at)
           ORDER BY r.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT * FROM app.ai_replay_runs
       WHERE cabinet_id = app.current_cabinet()
         AND app.current_role() IN ('owner', 'practitioner')
       ORDER BY created_at DESC
       LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100)
    ) r;
$$;

ALTER FUNCTION app.list_live_runs(integer) OWNER TO app_gatekeeper;
ALTER FUNCTION app.list_replay_runs(integer) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.list_live_runs(integer) IS
  'M09 : en-tetes des runs live recents du cabinet (owner/practitioner), [] hors perimetre, borne 1..100.';
COMMENT ON FUNCTION app.list_replay_runs(integer) IS
  'M09 : en-tetes des runs replay recents du cabinet (owner/practitioner), [] hors perimetre, borne 1..100.';

REVOKE ALL ON FUNCTION app.list_live_runs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_replay_runs(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.list_live_runs(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION app.list_replay_runs(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('099_listes_observabilite')
    ON CONFLICT DO NOTHING;

COMMIT;
