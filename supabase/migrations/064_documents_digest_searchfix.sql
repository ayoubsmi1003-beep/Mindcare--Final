-- 063_documents_digest_searchfix — assure que digest est trouvé via extensions
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- Le corps de issue_document est identique à 061, mais le search_path inclut extensions
-- pour que extensions.digest soit trouvé. On refait CREATE OR REPLACE avec le même corps,
-- seule la clause SET search_path change.

-- On récupère d'abord la définition actuelle et on la remplace avec search_path corrigé.
-- Pour éviter de dupliquer 200 lignes, on redéfinit uniquement le search_path via ALTER.

-- Vérifier que la fonction existe et corriger son search_path
-- PostgreSQL permet ALTER FUNCTION ... SET search_path = ...
ALTER FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) SET search_path = app, audit, pg_catalog, extensions;
ALTER FUNCTION app.verify_document_hash(uuid) SET search_path = app, pg_catalog, extensions;

-- Le backfill déjà fait, rien d'autre.

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
NOTIFY pgrst, 'reload schema';
INSERT INTO app.schema_migrations (version) VALUES ('064_documents_digest_searchfix') ON CONFLICT DO NOTHING;
COMMIT;
