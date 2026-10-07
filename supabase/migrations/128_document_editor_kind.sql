-- Add the document kind in its own transaction before use by subsequent migrations.
BEGIN;
ALTER TYPE app.doc_type ADD VALUE IF NOT EXISTS 'ordonnance';
INSERT INTO app.schema_migrations(version) VALUES ('128_document_editor_kind') ON CONFLICT DO NOTHING;
COMMIT;
