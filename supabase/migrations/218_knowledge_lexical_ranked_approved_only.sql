-- Ranked lexical gate (215–217): only APPROVED passages are counted, weighed or ranked. No table, column, enum or policy change.
--
-- Adversarial review of 217 (2026-11-11), reproduced on a disposable database:
--  1. 217 kept the 200 best chunks BEFORE the approval filters: 250 superseded chunks holding the words made the gate return
--     nothing although an approved book held the passage. Filters now apply to every row before any count, weight or limit.
--  2. 216 and 217 counted N and df over every active chunk visible to the cabinet, approved or not: the score revealed whether a
--     word (a name) occurs in a non-approved source the caller cannot read. Counts now see approved rows only, as 123 does.
--  3. Above 12 words, 215–217 kept the first 12 in ALPHABETICAL order; they now keep the first 12 in the question's own order.
--  The header of 217 ("same output, same security as 215") was wrong on these points; 217 stays unchanged as applied history.
-- Security otherwise as 123: SECURITY DEFINER owned by the NOLOGIN reader role, restrictive policy on the function's own tsquery
-- (restored on exit by the SET clause), cabinet policies, EXECUTE for authenticated only, CREATE revoked, no member of the role.
BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = '217_knowledge_lexical_ranked_fast') THEN
    RAISE EXCEPTION 'Ranked lexical gate (217) is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('app.search_knowledge_lexical_ranked(text,text,integer)')
      AND prosecdef AND proowner = 'app_knowledge_lexical_reader'::regrole) THEN
    RAISE EXCEPTION 'Ranked lexical gate differs from 217';
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
  WITH approved AS MATERIALIZED (
    -- Every filter of 123, applied to each row BEFORE anything is counted, weighed or limited.
    SELECT c.id, c.document_tsv
      FROM app.knowledge_chunks c
      JOIN app.knowledge_sources s ON s.id = c.source_id
     WHERE s.classification = 'C4'
       AND s.statut = 'active'
       AND s.approved_at IS NOT NULL AND s.approved_by IS NOT NULL
       AND (s.review_due_at IS NULL OR s.review_due_at > now())
       AND s.superseded_by IS NULL AND c.statut = 'active'
       AND (p_langue = 'toutes' OR c.langue = p_langue)
       AND c.document_tsv @@ v_any
  ), term_hits AS MATERIALIZED (
    SELECT t.ord, a.id
      FROM unnest(v_terms) WITH ORDINALITY AS t(term, ord)
      JOIN approved a ON a.document_tsv @@ quote_literal(t.term)::tsquery
  ), reach AS (
    SELECT count(DISTINCT id)::double precision AS n FROM term_hits
  ), weights AS (
    SELECT h.ord, ln(1 + r.n / count(*)) AS w FROM term_hits h CROSS JOIN reach r GROUP BY h.ord, r.n
  ), scored AS (
    SELECT h.id, sum(w.w) / (SELECT sum(w) FROM weights) AS covered
      FROM term_hits h JOIN weights w USING (ord)
     GROUP BY h.id
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

INSERT INTO app.schema_migrations(version) VALUES ('218_knowledge_lexical_ranked_approved_only');
COMMIT;
