-- Keep retrieval and availability aligned with the accepted-OCR activation gate.
-- This forward migration changes read gates only; it does not approve a source.
BEGIN;
CREATE OR REPLACE FUNCTION app.search_book_knowledge_lexical(p_requete text,p_langue text,p_limite integer)
RETURNS TABLE (
  chunk_id text,source_id uuid,source_titre text,source_version text,section text,version_chunk text,langue text,texte text,score double precision,
  source_statut text,source_classification text,source_approuvee_le timestamptz,source_approuvee_par uuid,source_revue_a_jour boolean,source_remplacee_par uuid,
  book_number smallint,title_exact text,edition_label text,heading_path text[],heading_status text,ocr_review_status text,page_segments jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
 WITH candidates AS (
   SELECT c.id,c.source_id,s.titre,s.version,c.section,c.chunker_version,c.langue,c.texte,
     ts_rank(c.document_tsv,plainto_tsquery('simple',app.immutable_unaccent($1)))::double precision AS rank,
     s.statut,s.classification,s.approved_at,s.approved_by,s.review_due_at,s.superseded_by,
     b.book_number,b.title_exact,b.edition_label,k.heading_path,k.heading_status,k.ocr_review_status
   FROM app.knowledge_chunks c JOIN app.knowledge_sources s ON s.id=c.source_id
   JOIN app.knowledge_book_editions b ON b.source_id=s.id
   JOIN app.knowledge_book_chunks k ON k.chunk_id=c.id AND k.source_id=c.source_id
   WHERE s.classification='C4' AND s.statut='active' AND s.approved_at IS NOT NULL AND s.approved_by IS NOT NULL
     AND (s.review_due_at IS NULL OR s.review_due_at>now()) AND s.superseded_by IS NULL AND c.statut='active'
     AND b.metadata_verified_at IS NOT NULL AND k.heading_status='verified' AND k.mapping_status='verified'
     AND cardinality(k.heading_path)>0 AND k.ocr_review_status='accepted'
     AND k.texte_hash=c.texte_hash AND k.chunker_version=c.chunker_version
     AND NOT EXISTS (
       SELECT 1 FROM app.knowledge_chunk_page_spans bad
       LEFT JOIN app.knowledge_ocr_pages pg_bad
         ON pg_bad.source_id=bad.source_id AND pg_bad.global_physical_page=bad.global_physical_page
        AND pg_bad.texte_sha1=bad.page_sha1
       WHERE bad.chunk_id=c.id AND (bad.source_id IS DISTINCT FROM c.source_id OR pg_bad.source_id IS NULL)
     )
     AND ($2='toutes' OR c.langue=$2)
     AND c.document_tsv @@ plainto_tsquery('simple',app.immutable_unaccent($1))
   ORDER BY rank DESC,c.id LIMIT LEAST(GREATEST($3,1),20)
 )
 SELECT q.id,q.source_id,q.titre,q.version,q.section,q.chunker_version,q.langue,q.texte,q.rank,
   q.statut,q.classification,q.approved_at,q.approved_by,(q.review_due_at IS NULL OR q.review_due_at>now()),q.superseded_by,
   q.book_number,q.title_exact,q.edition_label,q.heading_path,q.heading_status,q.ocr_review_status,p.page_segments
 FROM candidates q CROSS JOIN LATERAL (
   SELECT jsonb_agg(jsonb_build_object('segment_no',x.segment_no,'split_id',pg.split_id,
     'physical_page_in_split',pg.physical_page_in_split,'global_physical_page',x.global_physical_page,
     'chunk_start_cp',x.chunk_start_cp,'chunk_end_cp',x.chunk_end_cp,'raw_start_cp',x.raw_start_cp,'raw_end_cp',x.raw_end_cp,
     'page_sha1',x.page_sha1,'printed_page_verified',pg.printed_page_verified) ORDER BY x.segment_no) AS page_segments
   FROM app.knowledge_chunk_page_spans x JOIN app.knowledge_ocr_pages pg
     ON pg.source_id=x.source_id AND pg.global_physical_page=x.global_physical_page AND pg.texte_sha1=x.page_sha1
   WHERE x.chunk_id=q.id AND x.source_id=q.source_id
 ) p WHERE p.page_segments IS NOT NULL ORDER BY q.rank DESC,q.id;
$$;

CREATE OR REPLACE FUNCTION app.search_book_knowledge_vector(p_embedding_json text,p_limite integer)
RETURNS TABLE (
  chunk_id text,source_id uuid,source_titre text,source_version text,section text,version_chunk text,langue text,texte text,score double precision,
  source_statut text,source_classification text,source_approuvee_le timestamptz,source_approuvee_par uuid,source_revue_a_jour boolean,source_remplacee_par uuid,
  book_number smallint,title_exact text,edition_label text,heading_path text[],heading_status text,ocr_review_status text,page_segments jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
 WITH candidates AS (
   SELECT c.id,c.source_id,s.titre,s.version,c.section,c.chunker_version,c.langue,c.texte,
     (1-(c.embedding OPERATOR(public.<=>) p.q))::double precision AS rank,
     s.statut,s.classification,s.approved_at,s.approved_by,s.review_due_at,s.superseded_by,
     b.book_number,b.title_exact,b.edition_label,k.heading_path,k.heading_status,k.ocr_review_status
   FROM app.knowledge_chunks c JOIN app.knowledge_sources s ON s.id=c.source_id
   JOIN app.knowledge_book_editions b ON b.source_id=s.id
   JOIN app.knowledge_book_chunks k ON k.chunk_id=c.id AND k.source_id=c.source_id
   CROSS JOIN (SELECT $1::public.vector AS q OFFSET 0) p
   WHERE s.classification='C4' AND s.statut='active' AND s.approved_at IS NOT NULL AND s.approved_by IS NOT NULL
     AND (s.review_due_at IS NULL OR s.review_due_at>now()) AND s.superseded_by IS NULL AND c.statut='active' AND c.embedding IS NOT NULL
     AND b.metadata_verified_at IS NOT NULL AND k.heading_status='verified' AND k.mapping_status='verified'
     AND cardinality(k.heading_path)>0 AND k.ocr_review_status='accepted'
     AND k.texte_hash=c.texte_hash AND k.chunker_version=c.chunker_version
     AND NOT EXISTS (
       SELECT 1 FROM app.knowledge_chunk_page_spans bad
       LEFT JOIN app.knowledge_ocr_pages pg_bad
         ON pg_bad.source_id=bad.source_id AND pg_bad.global_physical_page=bad.global_physical_page
        AND pg_bad.texte_sha1=bad.page_sha1
       WHERE bad.chunk_id=c.id AND (bad.source_id IS DISTINCT FROM c.source_id OR pg_bad.source_id IS NULL)
     )
   ORDER BY c.embedding OPERATOR(public.<=>) p.q,c.id LIMIT LEAST(GREATEST($2,1),20)
 )
 SELECT q.id,q.source_id,q.titre,q.version,q.section,q.chunker_version,q.langue,q.texte,q.rank,
   q.statut,q.classification,q.approved_at,q.approved_by,(q.review_due_at IS NULL OR q.review_due_at>now()),q.superseded_by,
   q.book_number,q.title_exact,q.edition_label,q.heading_path,q.heading_status,q.ocr_review_status,p.page_segments
 FROM candidates q CROSS JOIN LATERAL (
   SELECT jsonb_agg(jsonb_build_object('segment_no',x.segment_no,'split_id',pg.split_id,
     'physical_page_in_split',pg.physical_page_in_split,'global_physical_page',x.global_physical_page,
     'chunk_start_cp',x.chunk_start_cp,'chunk_end_cp',x.chunk_end_cp,'raw_start_cp',x.raw_start_cp,'raw_end_cp',x.raw_end_cp,
     'page_sha1',x.page_sha1,'printed_page_verified',pg.printed_page_verified) ORDER BY x.segment_no) AS page_segments
   FROM app.knowledge_chunk_page_spans x JOIN app.knowledge_ocr_pages pg
     ON pg.source_id=x.source_id AND pg.global_physical_page=x.global_physical_page AND pg.texte_sha1=x.page_sha1
   WHERE x.chunk_id=q.id AND x.source_id=q.source_id
 ) p WHERE p.page_segments IS NOT NULL ORDER BY q.rank DESC,q.id;
$$;


CREATE OR REPLACE FUNCTION app.get_book_knowledge_availability()
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
        AND cardinality(k.heading_path) > 0 AND k.ocr_review_status = 'accepted'
        AND k.texte_hash = c.texte_hash AND k.chunker_version = c.chunker_version
        AND EXISTS (
          SELECT 1 FROM app.knowledge_chunk_page_spans x
          JOIN app.knowledge_ocr_pages pg
            ON pg.source_id = x.source_id AND pg.global_physical_page = x.global_physical_page
           AND pg.texte_sha1 = x.page_sha1
          WHERE x.chunk_id = c.id AND x.source_id = c.source_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM app.knowledge_chunk_page_spans bad
          LEFT JOIN app.knowledge_ocr_pages pg_bad
            ON pg_bad.source_id = bad.source_id AND pg_bad.global_physical_page = bad.global_physical_page
           AND pg_bad.texte_sha1 = bad.page_sha1
          WHERE bad.chunk_id = c.id AND (bad.source_id IS DISTINCT FROM c.source_id OR pg_bad.source_id IS NULL)
        ));
$$;


INSERT INTO app.schema_migrations(version) VALUES ('107_livres_rappel_ocr_accepte') ON CONFLICT DO NOTHING;
COMMIT;
