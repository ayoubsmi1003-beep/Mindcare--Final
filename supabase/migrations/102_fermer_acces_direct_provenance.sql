-- ADR-040 follow-up: database default privileges granted authenticated and
-- service_role direct DML on 101 tables. Keep access through governed gates.
BEGIN;
REVOKE ALL ON app.knowledge_book_editions,app.knowledge_ocr_pages,
  app.knowledge_book_chunks,app.knowledge_chunk_page_spans
  FROM PUBLIC,authenticated,service_role;
GRANT SELECT ON app.knowledge_book_editions,app.knowledge_ocr_pages,
  app.knowledge_book_chunks,app.knowledge_chunk_page_spans TO app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES ('102_fermer_acces_direct_provenance') ON CONFLICT DO NOTHING;
COMMIT;
