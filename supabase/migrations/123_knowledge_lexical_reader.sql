-- RLS-preserving lexical performance repair. No table, column, enum or corpus changes.
-- The role cannot log in or bypass RLS. Existing cabinet policies still apply;
-- its additional restrictive policy admits only the gate's current query.
BEGIN;

-- Fail closed on an installation whose deployed security contract has drifted.
DO $guard$
BEGIN
  IF current_setting('server_version_num')::integer < 160000
    OR NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = '092_knowledge_rag')
    OR NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = '111_provenance_lignee_connaissance') THEN
    RAISE EXCEPTION 'Knowledge lexical prerequisites are missing';
  END IF;
  IF (SELECT count(*) FROM pg_class WHERE oid IN
      ('app.knowledge_sources'::regclass, 'app.knowledge_chunks'::regclass)
      AND relrowsecurity AND relforcerowsecurity) <> 2 THEN
    RAISE EXCEPTION 'Knowledge RLS must be enabled and forced';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'app'
      AND tablename IN ('knowledge_sources', 'knowledge_chunks')) <> 2
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app'
      AND tablename = 'knowledge_sources' AND policyname = 'knowledge_sources_read'
      AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[] AND cmd = 'SELECT'
      AND regexp_replace(qual, '\s', '', 'g') =
        '((cabinet_idISNULL)OR(cabinet_id=app.current_cabinet()))')
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app'
      AND tablename = 'knowledge_chunks' AND policyname = 'knowledge_chunks_read'
      AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[] AND cmd = 'SELECT'
      AND regexp_replace(qual, '\s', '', 'g') =
        '(EXISTS(SELECT1FROMapp.knowledge_sourcessWHERE((s.id=knowledge_chunks.source_id)AND((s.cabinet_idISNULL)OR(s.cabinet_id=app.current_cabinet())))))') THEN
    RAISE EXCEPTION 'Knowledge cabinet policies differ from the verified contract';
  END IF;
  IF to_regprocedure('app.search_knowledge_lexical(text,text,integer)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('app.search_knowledge_lexical(text,text,integer)')
      AND prosecdef AND provolatile = 's' AND proowner = 'app_gatekeeper'::regrole)
    OR pg_get_function_result(to_regprocedure('app.search_knowledge_lexical(text,text,integer)')) IS DISTINCT FROM
      'TABLE(chunk_id text, source_id uuid, source_titre text, source_version text, section text, version_chunk text, langue text, texte text, score double precision, source_statut text, source_classification text, source_approuvee_le timestamp with time zone, source_approuvee_par uuid, source_revue_a_jour boolean, source_remplacee_par uuid, unit_id text, parent_texte_hash text, enfant_index integer, enfants_total integer)' THEN
    RAISE EXCEPTION 'Knowledge lexical gate differs from the verified contract';
  END IF;
END;
$guard$;

CREATE ROLE app_knowledge_lexical_reader
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT;
GRANT authenticated TO app_knowledge_lexical_reader WITH INHERIT TRUE, SET FALSE;
GRANT USAGE, CREATE ON SCHEMA app TO app_knowledge_lexical_reader;
GRANT SELECT ON app.knowledge_sources, app.knowledge_chunks TO app_knowledge_lexical_reader;

CREATE POLICY knowledge_chunks_lexical_query ON app.knowledge_chunks
  AS RESTRICTIVE FOR SELECT TO app_knowledge_lexical_reader
  USING (document_tsv @@ current_setting('app.knowledge_lexical_query', true)::tsquery);

CREATE OR REPLACE FUNCTION app.search_knowledge_lexical(p_requete text, p_langue text, p_limite integer)
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
-- PostgreSQL restores this function-local setting on return and on error.
SET app.knowledge_lexical_query = ''
AS $$
BEGIN
  PERFORM set_config('app.knowledge_lexical_query',
    COALESCE(plainto_tsquery('simple', app.immutable_unaccent(p_requete))::text, ''), true);
  RETURN QUERY
  SELECT c.id, c.source_id, s.titre, s.version, c.section, c.chunker_version,
    c.langue, c.texte,
    ts_rank(c.document_tsv, plainto_tsquery('simple', app.immutable_unaccent(p_requete)))::double precision,
    s.statut, s.classification, s.approved_at, s.approved_by,
    (s.review_due_at IS NULL OR s.review_due_at > now()), s.superseded_by,
    c.unit_id, c.parent_texte_hash, c.enfant_index, c.enfants_total
  FROM app.knowledge_chunks c
  JOIN app.knowledge_sources s ON s.id = c.source_id
  WHERE s.classification = 'C4'
    AND s.statut = 'active'
    AND s.approved_at IS NOT NULL AND s.approved_by IS NOT NULL
    AND (s.review_due_at IS NULL OR s.review_due_at > now())
    AND s.superseded_by IS NULL AND c.statut = 'active'
    AND (p_langue = 'toutes' OR c.langue = p_langue)
    AND c.document_tsv @@ plainto_tsquery('simple', app.immutable_unaccent(p_requete))
  ORDER BY ts_rank(c.document_tsv, plainto_tsquery('simple', app.immutable_unaccent(p_requete))) DESC
  LIMIT LEAST(GREATEST(p_limite, 1), 20);
END;
$$;

ALTER FUNCTION app.search_knowledge_lexical(text, text, integer) OWNER TO app_knowledge_lexical_reader;
REVOKE CREATE ON SCHEMA app FROM app_knowledge_lexical_reader;
REVOKE ALL ON FUNCTION app.search_knowledge_lexical(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_knowledge_lexical(text, text, integer) TO authenticated;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_knowledge_lexical_reader'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb)
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = 'app_knowledge_lexical_reader'::regrole)
    OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
      WHERE p.oid = 'app.search_knowledge_lexical(text,text,integer)'::regprocedure AND a.grantee = 0)
    OR NOT has_function_privilege('authenticated', 'app.search_knowledge_lexical(text,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Knowledge lexical role or execution privileges are unsafe';
  END IF;
END;
$guard$;

INSERT INTO app.schema_migrations(version) VALUES ('123_knowledge_lexical_reader');
COMMIT;
