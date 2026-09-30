-- Books knowledge removal (doctor-ordered rebuild): reverse migrations 100-107.
-- Guards abort (RAISE) unless the database is exactly in the expected state.
-- Leaves: base R1 knowledge (092/093), audit history, RLS base policies.
BEGIN;

-- 0. Guards: 6 book sources, all discovered; book tables at expected counts.
DO $$
DECLARE
  v_src integer; v_ed integer; v_pg integer; v_ch integer; v_sp bigint;
  v_en_base integer; v_active_book integer;
BEGIN
  SELECT count(*) INTO v_src FROM app.knowledge_sources WHERE version = 'ocr-2026-09';
  IF v_src <> 6 THEN RAISE EXCEPTION 'guard: book sources = %, want 6', v_src USING ERRCODE = 'check_violation'; END IF;
  SELECT count(*) INTO v_active_book FROM app.knowledge_sources WHERE version = 'ocr-2026-09' AND statut <> 'discovered';
  IF v_active_book <> 0 THEN RAISE EXCEPTION 'guard: % book sources not discovered', v_active_book USING ERRCODE = 'check_violation'; END IF;
  SELECT count(*) INTO v_ed FROM app.knowledge_book_editions;
  SELECT count(*) INTO v_pg FROM app.knowledge_ocr_pages;
  SELECT count(*) INTO v_ch FROM app.knowledge_book_chunks;
  SELECT count(*) INTO v_sp FROM app.knowledge_chunk_page_spans;
  IF v_ed <> 6 OR v_pg <> 5228 OR v_ch <> 17131 OR v_sp <> 853077 THEN
    RAISE EXCEPTION 'guard: book tables ed=% pg=% ch=% sp=%, want 6/5228/17131/853077', v_ed, v_pg, v_ch, v_sp USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO v_en_base FROM app.knowledge_chunks c
    JOIN app.knowledge_sources s ON s.id = c.source_id
    WHERE s.version <> 'ocr-2026-09' AND c.langue = 'en';
  IF v_en_base <> 0 THEN RAISE EXCEPTION 'guard: % non-book en chunks (narrow CHECK unsafe)', v_en_base USING ERRCODE = 'check_violation'; END IF;
END $$;

-- 1. Book data, FK order (spans -> book_chunks -> ocr_pages -> editions -> chunks -> sources).
CREATE TEMP TABLE book_src AS SELECT id FROM app.knowledge_sources WHERE version = 'ocr-2026-09';
DELETE FROM app.knowledge_chunk_page_spans WHERE source_id IN (SELECT id FROM book_src);
DELETE FROM app.knowledge_book_chunks WHERE source_id IN (SELECT id FROM book_src);
DELETE FROM app.knowledge_ocr_pages WHERE source_id IN (SELECT id FROM book_src);
DELETE FROM app.knowledge_book_editions WHERE source_id IN (SELECT id FROM book_src);
DELETE FROM app.knowledge_chunks WHERE source_id IN (SELECT id FROM book_src);
DELETE FROM app.knowledge_sources WHERE id IN (SELECT id FROM book_src);

-- 2. Book functions (exact signatures from 101/103/104).
DROP FUNCTION IF EXISTS app.search_book_knowledge_lexical(text, text, integer);
DROP FUNCTION IF EXISTS app.search_book_knowledge_vector(text, integer);
DROP FUNCTION IF EXISTS app.get_book_knowledge_availability();
DROP FUNCTION IF EXISTS app.activate_book_knowledge(uuid, text, text, text);
DROP FUNCTION IF EXISTS app.backfill_knowledge_book_provenance(uuid, smallint, jsonb, jsonb);

-- 3. 104: activation policy + column UPDATE grant + audit grants (all 104-introduced; no base migration grants these).
DROP POLICY IF EXISTS knowledge_sources_book_activation ON app.knowledge_sources;
REVOKE UPDATE (statut, reviewed_by, reviewed_at, approved_by, approved_at) ON app.knowledge_sources FROM app_gatekeeper;
REVOKE INSERT ON audit.log FROM app_gatekeeper;
REVOKE USAGE ON SEQUENCE audit.log_id_seq FROM app_gatekeeper;

-- 4. 101: book tables (policies drop with tables) + unique index on base table.
DROP TABLE IF EXISTS app.knowledge_chunk_page_spans;
DROP TABLE IF EXISTS app.knowledge_book_chunks;
DROP TABLE IF EXISTS app.knowledge_ocr_pages;
DROP TABLE IF EXISTS app.knowledge_book_editions;
DROP INDEX IF EXISTS app.knowledge_chunks_id_source;

-- 5. 100: narrow CHECKs back to fr/ar/darija (guard above proved zero non-book 'en').
ALTER TABLE app.knowledge_sources DROP CONSTRAINT knowledge_sources_langue_vocab;
ALTER TABLE app.knowledge_sources ADD CONSTRAINT knowledge_sources_langue_check CHECK (langue IN ('fr', 'ar', 'darija'));
ALTER TABLE app.knowledge_chunks DROP CONSTRAINT knowledge_chunks_langue_vocab;
ALTER TABLE app.knowledge_chunks ADD CONSTRAINT knowledge_chunks_langue_check CHECK (langue IN ('fr', 'ar', 'darija'));

-- 6. Migration journal rows.
DELETE FROM app.schema_migrations WHERE version IN (
  '100_langue_en_connaissance', '101_provenance_pages_connaissance',
  '102_fermer_acces_direct_provenance', '103_disponibilite_livres_connaissance',
  '104_activation_gouvernee_livres', '105_activation_livres_validation_entrees',
  '106_activation_livres_integrite_spans', '107_livres_rappel_ocr_accepte');

COMMIT;
