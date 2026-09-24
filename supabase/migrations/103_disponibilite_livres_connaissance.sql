-- Read-only availability of governed book passages. No activation or attestation.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE FUNCTION app.get_book_knowledge_availability()
RETURNS TABLE(total_books integer, eligible_chunks bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, pg_catalog AS $$
  SELECT
    (SELECT count(*)::integer
       FROM app.knowledge_book_editions b
       JOIN app.knowledge_sources s ON s.id = b.source_id
      WHERE s.classification = 'C4' AND s.superseded_by IS NULL),
    (SELECT count(*)
       FROM app.knowledge_chunks c
       JOIN app.knowledge_sources s ON s.id = c.source_id
       JOIN app.knowledge_book_editions b ON b.source_id = s.id
       JOIN app.knowledge_book_chunks k ON k.chunk_id = c.id AND k.source_id = c.source_id
      WHERE s.classification = 'C4' AND s.statut = 'active'
        AND s.approved_at IS NOT NULL AND s.approved_by IS NOT NULL
        AND (s.review_due_at IS NULL OR s.review_due_at > now())
        AND s.superseded_by IS NULL AND c.statut = 'active'
        AND b.metadata_verified_at IS NOT NULL
        AND k.heading_status = 'verified' AND k.mapping_status = 'verified'
        AND k.texte_hash = c.texte_hash AND k.chunker_version = c.chunker_version
        AND EXISTS (
          SELECT 1 FROM app.knowledge_chunk_page_spans x
          JOIN app.knowledge_ocr_pages pg
            ON pg.source_id = x.source_id AND pg.global_physical_page = x.global_physical_page
           AND pg.texte_sha1 = x.page_sha1
          WHERE x.chunk_id = c.id AND x.source_id = c.source_id
        ));
$$;

REVOKE ALL ON FUNCTION app.get_book_knowledge_availability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_book_knowledge_availability() TO authenticated;
ALTER FUNCTION app.get_book_knowledge_availability() OWNER TO app_gatekeeper;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES ('103_disponibilite_livres_connaissance') ON CONFLICT DO NOTHING;
COMMIT;
