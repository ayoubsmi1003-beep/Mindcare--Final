-- Ranked lexical reading of the approved books. No table, column, enum, policy or corpus change.
--
-- Why: app.search_knowledge_lexical (123) requires EVERY word of the query (plainto_tsquery, AND). One word the passage
-- does not use ("permettent", "retenir", a French word against an English book) returns nothing, which is how relevant
-- passages were missed in C202 (docs/alexa/18). This gate matches ANY word of the same query and ranks rows by how many
-- of the query's words they hold first, then by ts_rank_cd normalised by length. The AND gate stays unchanged for its callers.
--
-- Security: identical to 123. SECURITY DEFINER owned by app_knowledge_lexical_reader (NOLOGIN, no BYPASSRLS); the
-- restrictive policy knowledge_chunks_lexical_query admits only rows matching the tsquery this function sets for its own
-- duration; the cabinet policies still apply; same approval filters (C4, active, approved, review not overdue, not superseded,
-- chunk active); EXECUTE for authenticated only.
BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = '123_knowledge_lexical_reader') THEN
    RAISE EXCEPTION 'Knowledge lexical reader (123) is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_knowledge_lexical_reader'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'Knowledge lexical role differs from the verified contract';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'knowledge_chunks'
      AND policyname = 'knowledge_chunks_lexical_query' AND permissive = 'RESTRICTIVE'
      AND roles = ARRAY['app_knowledge_lexical_reader']::name[] AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'Knowledge lexical restrictive policy is missing';
  END IF;
  IF to_regprocedure('app.search_knowledge_lexical_ranked(text,text,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Ranked lexical gate already exists';
  END IF;
END;
$guard$;

GRANT USAGE, CREATE ON SCHEMA app TO app_knowledge_lexical_reader;

CREATE FUNCTION app.search_knowledge_lexical_ranked(p_requete text, p_langue text, p_limite integer)
RETURNS TABLE (
  chunk_id text, source_id uuid, source_titre text, source_version text,
  section text, version_chunk text, langue text, texte text, score double precision,
  source_statut text, source_classification text,
  source_approuvee_le timestamptz, source_approuvee_par uuid,
  source_revue_a_jour boolean, source_remplacee_par uuid,
  unit_id text, parent_texte_hash text, enfant_index integer, enfants_total integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = app, audit, pg_catalog
SET app.knowledge_lexical_query = ''
AS $$
DECLARE
  v_and tsquery := plainto_tsquery('simple', app.immutable_unaccent(coalesce(p_requete, '')));
  v_terms text[];
  v_any tsquery;
BEGIN
  -- The query's own lexemes (plainto_tsquery already dropped punctuation): each one alone, then OR-ed together.
  SELECT coalesce(array_agg(DISTINCT lexeme), ARRAY[]::text[]) INTO v_terms
    FROM unnest(regexp_split_to_array(regexp_replace(coalesce(v_and::text, ''), '[''\s]', '', 'g'), '[&|!()]+')) AS lexeme
   WHERE lexeme <> '';
  IF cardinality(v_terms) = 0 THEN RETURN; END IF;
  -- At most 12 words: a long question is first reduced by the caller; this bounds the per-row coverage count.
  v_terms := v_terms[1:12];
  v_any := array_to_string(ARRAY(SELECT quote_literal(term) FROM unnest(v_terms) AS term), ' | ')::tsquery;
  PERFORM set_config('app.knowledge_lexical_query', v_any::text, true);
  RETURN QUERY
  WITH hits AS (
    SELECT c.*, s.titre AS s_titre, s.version AS s_version, s.statut AS s_statut, s.classification AS s_classification,
      s.approved_at AS s_approved_at, s.approved_by AS s_approved_by, s.review_due_at AS s_review_due_at, s.superseded_by AS s_superseded_by,
      (SELECT count(*) FROM unnest(v_terms) AS term WHERE c.document_tsv @@ quote_literal(term)::tsquery)::double precision AS covered
    FROM app.knowledge_chunks c
    JOIN app.knowledge_sources s ON s.id = c.source_id
    WHERE s.classification = 'C4'
      AND s.statut = 'active'
      AND s.approved_at IS NOT NULL AND s.approved_by IS NOT NULL
      AND (s.review_due_at IS NULL OR s.review_due_at > now())
      AND s.superseded_by IS NULL AND c.statut = 'active'
      AND (p_langue = 'toutes' OR c.langue = p_langue)
      AND c.document_tsv @@ v_any
  )
  SELECT h.id, h.source_id, h.s_titre, h.s_version, h.section, h.chunker_version, h.langue, h.texte,
    -- Coverage first (0..1), the length-normalised rank only orders rows of equal coverage.
    (h.covered / cardinality(v_terms) + least(ts_rank_cd(h.document_tsv, v_any, 1), 0.999) / 1000)::double precision,
    h.s_statut, h.s_classification, h.s_approved_at, h.s_approved_by,
    (h.s_review_due_at IS NULL OR h.s_review_due_at > now()), h.s_superseded_by,
    h.unit_id, h.parent_texte_hash, h.enfant_index, h.enfants_total
  FROM hits h
  ORDER BY h.covered DESC, ts_rank_cd(h.document_tsv, v_any, 1) DESC, h.id
  LIMIT LEAST(GREATEST(p_limite, 1), 20);
END;
$$;

ALTER FUNCTION app.search_knowledge_lexical_ranked(text, text, integer) OWNER TO app_knowledge_lexical_reader;
REVOKE CREATE ON SCHEMA app FROM app_knowledge_lexical_reader;
REVOKE ALL ON FUNCTION app.search_knowledge_lexical_ranked(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_knowledge_lexical_ranked(text, text, integer) TO authenticated;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'app.search_knowledge_lexical_ranked(text,text,integer)'::regprocedure
      AND prosecdef AND provolatile = 's' AND proowner = 'app_knowledge_lexical_reader'::regrole)
    OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
      WHERE p.oid = 'app.search_knowledge_lexical_ranked(text,text,integer)'::regprocedure AND a.grantee = 0)
    OR NOT has_function_privilege('authenticated', 'app.search_knowledge_lexical_ranked(text,text,integer)', 'EXECUTE')
    OR has_schema_privilege('app_knowledge_lexical_reader', 'app', 'CREATE') THEN
    RAISE EXCEPTION 'Ranked lexical gate ownership or privileges are unsafe';
  END IF;
END;
$guard$;

INSERT INTO app.schema_migrations(version) VALUES ('215_knowledge_lexical_ranked');
COMMIT;
