-- Ranked lexical gate (219): rank only the 300 best approved chunks. No table, column, enum or policy change.
--
-- 219 computed the length-normalised rank of EVERY approved chunk holding any word of the question: 7.4 s for
-- "trouble anxieux generalise criteres" on the doctor's class of PC (i3 4th generation, 8 GB). The hit list is already
-- restricted to approved rows, so keeping the 300 best by weighted coverage before ranking cannot drop an approved passage
-- that would have ranked higher. Measured on the evaluation database (a campaign running on the same CPU): 0.69 s for that
-- query (the AND gate of 123: 0.22 s), 0.45 s for "pre lithium workup", under 10 ms for "kleptomanie criteres" (68 s in 218).
-- Output and security as 218.
BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = '219_knowledge_lexical_ranked_indexed') THEN
    RAISE EXCEPTION 'Ranked lexical gate (219) is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('app.search_knowledge_lexical_ranked(text,text,integer)')
      AND prosecdef AND proowner = 'app_knowledge_lexical_reader'::regrole) THEN
    RAISE EXCEPTION 'Ranked lexical gate differs from 219';
  END IF;
END;
$guard$;

GRANT USAGE, CREATE ON SCHEMA app TO app_knowledge_lexical_reader;

CREATE OR REPLACE FUNCTION app.search_knowledge_lexical_ranked(p_requete text, p_langue text, p_limite integer)
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
  -- The question's own lexemes, first occurrence kept, in the order the doctor said them; at most 12.
  SELECT coalesce(array_agg(lexeme ORDER BY first_at), ARRAY[]::text[]) INTO v_terms
    FROM (SELECT lexeme, min(at) AS first_at
            FROM unnest(regexp_split_to_array(regexp_replace(coalesce(v_and::text, ''), '[''\s]', '', 'g'), '[&|!()<>0-9-]+'))
                 WITH ORDINALITY AS split(lexeme, at)
           WHERE lexeme <> ''
           GROUP BY lexeme) AS firsts;
  IF cardinality(v_terms) = 0 THEN RETURN; END IF;
  v_terms := v_terms[1:12];
  v_any := array_to_string(ARRAY(SELECT quote_literal(term) FROM unnest(v_terms) AS term), ' | ')::tsquery;
  PERFORM set_config('app.knowledge_lexical_query', v_any::text, true);
  RETURN QUERY
  WITH term_hits AS MATERIALIZED (
    -- One index lookup per word on the base table, every filter of 123 on the same rows, before anything is counted.
    SELECT t.ord, c.id
      FROM unnest(v_terms) WITH ORDINALITY AS t(term, ord)
      JOIN app.knowledge_chunks c ON c.document_tsv @@ quote_literal(t.term)::tsquery
      JOIN app.knowledge_sources s ON s.id = c.source_id
     WHERE s.classification = 'C4'
       AND s.statut = 'active'
       AND s.approved_at IS NOT NULL AND s.approved_by IS NOT NULL
       AND (s.review_due_at IS NULL OR s.review_due_at > now())
       AND s.superseded_by IS NULL AND c.statut = 'active'
       AND (p_langue = 'toutes' OR c.langue = p_langue)
  ), reach AS (
    SELECT count(DISTINCT id)::double precision AS n FROM term_hits
  ), weights AS (
    SELECT h.ord, ln(1 + r.n / count(*)) AS w FROM term_hits h CROSS JOIN reach r GROUP BY h.ord, r.n
  ), scored AS (
    SELECT h.id, sum(w.w) / (SELECT sum(w) FROM weights) AS covered
      FROM term_hits h JOIN weights w USING (ord)
     GROUP BY h.id
     -- Rows here are approved already: keeping the 300 best by coverage loses no approved passage that could rank higher.
     ORDER BY covered DESC, h.id LIMIT 300
  )
  SELECT c.id, c.source_id, s.titre, s.version, c.section, c.chunker_version, c.langue, c.texte,
    -- Weighted coverage (0..1) of the question by an approved chunk; the length-normalised rank orders equal coverage.
    (sc.covered + least(ts_rank_cd(c.document_tsv, v_any, 1), 0.999) / 1000)::double precision,
    s.statut, s.classification, s.approved_at, s.approved_by,
    (s.review_due_at IS NULL OR s.review_due_at > now()), s.superseded_by,
    c.unit_id, c.parent_texte_hash, c.enfant_index, c.enfants_total
  FROM scored sc
  JOIN app.knowledge_chunks c ON c.id = sc.id
  JOIN app.knowledge_sources s ON s.id = c.source_id
  ORDER BY sc.covered DESC, ts_rank_cd(c.document_tsv, v_any, 1) DESC, c.id
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
    OR has_schema_privilege('app_knowledge_lexical_reader', 'app', 'CREATE')
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = 'app_knowledge_lexical_reader'::regrole)
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_knowledge_lexical_reader' AND (rolcanlogin OR rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Ranked lexical gate ownership, membership or privileges are unsafe';
  END IF;
END;
$guard$;

INSERT INTO app.schema_migrations(version) VALUES ('220_knowledge_lexical_ranked_top');
COMMIT;
