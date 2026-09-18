-- 098_live_issue — M09 · constat d'approbation sur les runs live (SUIVI de 097, jamais d'edition — regle 9).
--
-- POURQUOI UNE SECONDE MIGRATION. 097 est appliquee : on ne l'edite pas, on
-- la suit (precedent 095/096 sur 094). Le constat verifie de l'approbation
-- (`issue`) s'est revele necessaire a la surface d'inspection APRES
-- l'application : sans lui, la liaison action→run dit QUOI relier mais pas
-- CE QUI A ETE CONSTATE (accepte-verifie ? refuse ? delai ?). L'issue vit
-- deja dans `IssueExecution` (M06) et dans l'export `m09-live-v2` ; ici on
-- la rend persistante et lisible, sans toucher au reste.
--
-- CONTENU : UNE colonne nullable + la porte `get_live_history` REDEFINIE
-- pour la rendre (redefinition, doctrine 089 : on recopie la definition
-- vivante de 097, pas celle qui l'a creee). Aucune table creee, aucune
-- policy touchee, aucun grant change, retention et acces inchanges
-- (voir 097 §2 : lecture owner/practitioner, ecriture operateur seul).
--
-- Conventions : BEGIN/COMMIT + `schema_migrations`, `OWNER TO
-- app_gatekeeper`, `SET search_path` fige (motif 003), noms qualifies.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1 · La colonne (nullable : les tours n'ont pas d'issue)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE app.ai_live_runs
  ADD COLUMN issue text CHECK (issue IS NULL OR issue IN ('ok', 'echec', 'inconnue', 'bloquee', 'duplicata', 'inconnu'));

COMMENT ON COLUMN app.ai_live_runs.issue IS
  'M09 : constat verifie de l''approbation (NULL sur les tours). CHECK ferme, meme enum que live-schema-v2.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · Porte redefinie (copie de la definition vivante 097 + 'issue')
-- ───────────────────────────────────────────────────────────────────────────
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
           'issue',        r.issue,
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

ALTER FUNCTION app.get_live_history(uuid, integer) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.get_live_history(uuid, integer) IS
  'M09 : historique d''un run live du cabinet (owner/practitioner), NULL hors perimetre, borne 1..500. Rend issue (098).';

REVOKE ALL ON FUNCTION app.get_live_history(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_live_history(uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('098_live_issue')
    ON CONFLICT DO NOTHING;

COMMIT;
