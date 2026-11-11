-- Ranked lexical gate (215): weigh each word by its rarity in the approved corpus. No table, column, enum or policy change.
--
-- Measured on the evaluation database after 215: for "critères permettent retenir kleptomanie" the first rows were
-- neurocognitive chunks holding the three common words, ahead of the kleptomania criteria holding "critères" and
-- "kleptomanie". A rare word says what the question is about; a frequent one ("permettent") says little. Each word now
-- counts ln(1 + N / df), N the active chunks, df the active chunks holding it (both read through the same restrictive policy),
-- and a row scores the share of the question's weight it holds. Security, filters, owner and grants are those of 215.
BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = '215_knowledge_lexical_ranked') THEN
    RAISE EXCEPTION 'Ranked lexical gate (215) is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('app.search_knowledge_lexical_ranked(text,text,integer)')
      AND prosecdef AND proowner = 'app_knowledge_lexical_reader'::regrole) THEN
    RAISE EXCEPTION 'Ranked lexical gate differs from 215';
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
  v_weights double precision[];
  v_total double precision;
  v_any tsquery;
  v_n double precision;
BEGIN
  SELECT coalesce(array_agg(DISTINCT lexeme), ARRAY[]::text[]) INTO v_terms
    FROM unnest(regexp_split_to_array(regexp_replace(coalesce(v_and::text, ''), '[''\s]', '', 'g'), '[&|!()]+')) AS lexeme
   WHERE lexeme <> '';
  IF cardinality(v_terms) = 0 THEN RETURN; END IF;
  v_terms := v_terms[1:12];
  v_any := array_to_string(ARRAY(SELECT quote_literal(term) FROM unnest(v_terms) AS term), ' | ')::tsquery;
  PERFORM set_config('app.knowledge_lexical_query', v_any::text, true);
  SELECT count(*)::double precision INTO v_n FROM app.knowledge_chunks c
   WHERE c.statut = 'active' AND (p_langue = 'toutes' OR c.langue = p_langue) AND c.document_tsv @@ v_any;
  IF v_n = 0 THEN RETURN; END IF;
  -- Rarity of each word among the chunks the question can reach at all (the restrictive policy admits only those).
  SELECT array_agg(ln(1 + v_n / greatest(df, 1)) ORDER BY ord) INTO v_weights
    FROM (SELECT t.ord, (SELECT count(*) FROM app.knowledge_chunks c
            WHERE c.statut = 'active' AND (p_langue = 'toutes' OR c.langue = p_langue) AND c.document_tsv @@ quote_literal(t.term)::tsquery)::double precision AS df
          FROM unnest(v_terms) WITH ORDINALITY AS t(term, ord)) AS counted;
  SELECT sum(w) INTO v_total FROM unnest(v_weights) AS w;
  RETURN QUERY
  WITH hits AS (
    SELECT c.*, s.titre AS s_titre, s.version AS s_version, s.statut AS s_statut, s.classification AS s_classification,
      s.approved_at AS s_approved_at, s.approved_by AS s_approved_by, s.review_due_at AS s_review_due_at, s.superseded_by AS s_superseded_by,
      (SELECT coalesce(sum(v_weights[t.ord]), 0) FROM unnest(v_terms) WITH ORDINALITY AS t(term, ord)
        WHERE c.document_tsv @@ quote_literal(t.term)::tsquery) / v_total AS covered
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
    -- Weighted coverage (0..1); the length-normalised rank only orders rows of equal coverage.
    (h.covered + least(ts_rank_cd(h.document_tsv, v_any, 1), 0.999) / 1000)::double precision,
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

INSERT INTO app.schema_migrations(version) VALUES ('216_knowledge_lexical_ranked_idf');
COMMIT;
