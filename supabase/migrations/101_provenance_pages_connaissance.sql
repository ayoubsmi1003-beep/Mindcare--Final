-- ADR-040: additive OCR page provenance. No source approval or activation.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE TABLE app.knowledge_book_editions (
  source_id uuid PRIMARY KEY REFERENCES app.knowledge_sources(id) ON DELETE RESTRICT,
  book_number smallint NOT NULL CHECK (book_number BETWEEN 1 AND 6),
  title_exact text, edition_label text,
  metadata_verified_by uuid REFERENCES app.profiles(id), metadata_verified_at timestamptz,
  CONSTRAINT book_metadata_attested CHECK (
    (title_exact IS NULL AND edition_label IS NULL AND metadata_verified_by IS NULL AND metadata_verified_at IS NULL)
    OR (nullif(btrim(title_exact),'') IS NOT NULL AND nullif(btrim(edition_label),'') IS NOT NULL
        AND metadata_verified_by IS NOT NULL AND metadata_verified_at IS NOT NULL))
);
CREATE TABLE app.knowledge_ocr_pages (
  source_id uuid NOT NULL REFERENCES app.knowledge_book_editions(source_id) ON DELETE RESTRICT,
  global_physical_page integer NOT NULL CHECK (global_physical_page > 0),
  split_id text NOT NULL CHECK (split_id <> ''),
  physical_page_in_split integer NOT NULL CHECK (physical_page_in_split > 0),
  texte_sha1 text NOT NULL CHECK (texte_sha1 ~ '^[0-9a-f]{40}$'),
  printed_page_verified text, printed_verified_by uuid REFERENCES app.profiles(id), printed_verified_at timestamptz,
  PRIMARY KEY (source_id, global_physical_page),
  UNIQUE (source_id, split_id, physical_page_in_split),
  CONSTRAINT printed_page_attested CHECK (
    (printed_page_verified IS NULL AND printed_verified_by IS NULL AND printed_verified_at IS NULL)
    OR (nullif(btrim(printed_page_verified),'') IS NOT NULL AND printed_verified_by IS NOT NULL AND printed_verified_at IS NOT NULL))
);
CREATE UNIQUE INDEX knowledge_chunks_id_source ON app.knowledge_chunks(id, source_id);
CREATE TABLE app.knowledge_book_chunks (
  chunk_id text PRIMARY KEY, source_id uuid NOT NULL,
  texte_hash text NOT NULL, chunker_version text NOT NULL,
  heading_path text[] NOT NULL DEFAULT '{}',
  heading_status text NOT NULL CHECK (heading_status IN ('detected','verified','unknown')),
  heading_verified_by uuid REFERENCES app.profiles(id), heading_verified_at timestamptz,
  mapping_status text NOT NULL CHECK (mapping_status IN ('verified','ambiguous','unknown')),
  ocr_review_status text NOT NULL CHECK (ocr_review_status IN ('unreviewed','accepted','suspect')),
  mapping_version text NOT NULL,
  FOREIGN KEY (chunk_id,source_id) REFERENCES app.knowledge_chunks(id,source_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_id) REFERENCES app.knowledge_book_editions(source_id) ON DELETE RESTRICT,
  UNIQUE (chunk_id,source_id),
  CONSTRAINT heading_attested CHECK (
    (heading_status = 'verified' AND heading_verified_by IS NOT NULL AND heading_verified_at IS NOT NULL)
    OR (heading_status <> 'verified' AND heading_verified_by IS NULL AND heading_verified_at IS NULL))
);
CREATE TABLE app.knowledge_chunk_page_spans (
  chunk_id text NOT NULL, source_id uuid NOT NULL, segment_no integer NOT NULL CHECK (segment_no >= 0),
  global_physical_page integer NOT NULL,
  chunk_start_cp integer NOT NULL CHECK (chunk_start_cp >= 0),
  chunk_end_cp integer NOT NULL CHECK (chunk_end_cp > chunk_start_cp),
  raw_start_cp integer NOT NULL CHECK (raw_start_cp >= 0),
  raw_end_cp integer NOT NULL CHECK (raw_end_cp > raw_start_cp),
  page_sha1 text NOT NULL CHECK (page_sha1 ~ '^[0-9a-f]{40}$'),
  PRIMARY KEY (chunk_id,segment_no),
  FOREIGN KEY (chunk_id,source_id) REFERENCES app.knowledge_book_chunks(chunk_id,source_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_id,global_physical_page) REFERENCES app.knowledge_ocr_pages(source_id,global_physical_page) ON DELETE RESTRICT,
  CHECK (chunk_end_cp-chunk_start_cp = raw_end_cp-raw_start_cp)
);
CREATE INDEX knowledge_book_chunks_source ON app.knowledge_book_chunks(source_id);
CREATE INDEX knowledge_chunk_page_spans_source_page ON app.knowledge_chunk_page_spans(source_id,global_physical_page);

ALTER TABLE app.knowledge_book_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_book_editions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_ocr_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_ocr_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_book_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_book_chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_chunk_page_spans ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_chunk_page_spans FORCE ROW LEVEL SECURITY;
-- No direct authenticated grants or policies: read only through governed gates.
CREATE POLICY book_editions_gate ON app.knowledge_book_editions FOR SELECT TO app_gatekeeper USING (true);
CREATE POLICY ocr_pages_gate ON app.knowledge_ocr_pages FOR SELECT TO app_gatekeeper USING (true);
CREATE POLICY book_chunks_gate ON app.knowledge_book_chunks FOR SELECT TO app_gatekeeper USING (true);
CREATE POLICY page_spans_gate ON app.knowledge_chunk_page_spans FOR SELECT TO app_gatekeeper USING (true);
GRANT SELECT ON app.knowledge_book_editions,app.knowledge_ocr_pages,app.knowledge_book_chunks,app.knowledge_chunk_page_spans TO app_gatekeeper;

CREATE FUNCTION app.search_book_knowledge_lexical(p_requete text,p_langue text,p_limite integer)
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
     AND k.texte_hash=c.texte_hash AND k.chunker_version=c.chunker_version
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

CREATE FUNCTION app.search_book_knowledge_vector(p_embedding_json text,p_limite integer)
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
     AND k.texte_hash=c.texte_hash AND k.chunker_version=c.chunker_version
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

REVOKE ALL ON FUNCTION app.search_book_knowledge_lexical(text,text,integer),app.search_book_knowledge_vector(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_book_knowledge_lexical(text,text,integer),app.search_book_knowledge_vector(text,integer) TO authenticated;
ALTER FUNCTION app.search_book_knowledge_lexical(text,text,integer) OWNER TO app_gatekeeper;
ALTER FUNCTION app.search_book_knowledge_vector(text,integer) OWNER TO app_gatekeeper;

-- Offline-only write gate. The local DBA supplies Task-1 proofs as one atomic
-- book batch. Existing rows must match byte for byte; no clinical table update.
CREATE FUNCTION app.backfill_knowledge_book_provenance(p_source_id uuid,p_book_number smallint,p_pages jsonb,p_chunks jsonb)
RETURNS TABLE(pages_inserted integer,chunks_inserted integer,spans_inserted integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE
  v_source app.knowledge_sources%ROWTYPE;
  v_page record; v_chunk record; v_span record; v_existing record;
  v_count integer; v_last_end integer; v_no integer;
BEGIN
  pages_inserted:=0; chunks_inserted:=0; spans_inserted:=0;
  IF p_book_number NOT BETWEEN 1 AND 6 OR jsonb_typeof(p_pages)<>'array' OR jsonb_typeof(p_chunks)<>'array' THEN
    RAISE EXCEPTION 'invalid provenance batch';
  END IF;
  SELECT * INTO v_source FROM app.knowledge_sources WHERE id=p_source_id FOR UPDATE;
  IF NOT FOUND OR v_source.statut<>'discovered' OR v_source.approved_at IS NOT NULL OR v_source.approved_by IS NOT NULL
    OR v_source.superseded_by IS NOT NULL OR v_source.classification<>'C4' THEN
    RAISE EXCEPTION 'book source is not quarantined';
  END IF;
  SELECT * INTO v_existing FROM app.knowledge_book_editions WHERE source_id=p_source_id;
  IF FOUND AND v_existing.book_number<>p_book_number THEN RAISE EXCEPTION 'book number drift'; END IF;
  INSERT INTO app.knowledge_book_editions(source_id,book_number) VALUES(p_source_id,p_book_number) ON CONFLICT DO NOTHING;
  FOR v_page IN SELECT * FROM jsonb_to_recordset(p_pages) AS x(
    global_physical_page integer,split_id text,physical_page_in_split integer,texte_sha1 text)
  LOOP
    SELECT * INTO v_existing FROM app.knowledge_ocr_pages
      WHERE source_id=p_source_id AND global_physical_page=v_page.global_physical_page;
    IF FOUND AND (v_existing.split_id,v_existing.physical_page_in_split,v_existing.texte_sha1)
      IS DISTINCT FROM (v_page.split_id,v_page.physical_page_in_split,v_page.texte_sha1) THEN
      RAISE EXCEPTION 'page drift at %',v_page.global_physical_page;
    END IF;
    INSERT INTO app.knowledge_ocr_pages(source_id,global_physical_page,split_id,physical_page_in_split,texte_sha1)
      VALUES(p_source_id,v_page.global_physical_page,v_page.split_id,v_page.physical_page_in_split,v_page.texte_sha1) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count=ROW_COUNT; pages_inserted:=pages_inserted+v_count;
  END LOOP;
  FOR v_chunk IN SELECT * FROM jsonb_to_recordset(p_chunks) AS x(
    chunk_id text,texte_hash text,chunker_version text,statut text,section text,proof_status text,segments jsonb)
  LOOP
    PERFORM 1 FROM app.knowledge_chunks c WHERE c.id=v_chunk.chunk_id AND c.source_id=p_source_id
      AND c.texte_hash=v_chunk.texte_hash AND c.chunker_version=v_chunk.chunker_version
      AND c.statut=v_chunk.statut AND c.section IS NOT DISTINCT FROM v_chunk.section;
    IF NOT FOUND THEN RAISE EXCEPTION 'chunk identity drift at %',v_chunk.chunk_id; END IF;
    IF v_chunk.proof_status<>'verified' OR jsonb_typeof(v_chunk.segments)<>'array' OR jsonb_array_length(v_chunk.segments)=0 THEN
      RAISE EXCEPTION 'unverified chunk %',v_chunk.chunk_id;
    END IF;
    SELECT * INTO v_existing FROM app.knowledge_book_chunks WHERE chunk_id=v_chunk.chunk_id;
    IF FOUND AND (v_existing.source_id,v_existing.texte_hash,v_existing.chunker_version,v_existing.heading_path,
      v_existing.heading_status,v_existing.mapping_status,v_existing.ocr_review_status,v_existing.mapping_version)
      IS DISTINCT FROM (p_source_id,v_chunk.texte_hash,v_chunk.chunker_version,ARRAY[v_chunk.section],
        'detected','verified','unreviewed','ocr-pages-v1') THEN
      RAISE EXCEPTION 'book chunk drift at %',v_chunk.chunk_id;
    END IF;
    INSERT INTO app.knowledge_book_chunks(chunk_id,source_id,texte_hash,chunker_version,heading_path,heading_status,mapping_status,ocr_review_status,mapping_version)
      VALUES(v_chunk.chunk_id,p_source_id,v_chunk.texte_hash,v_chunk.chunker_version,ARRAY[v_chunk.section],
        'detected','verified','unreviewed','ocr-pages-v1') ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count=ROW_COUNT; chunks_inserted:=chunks_inserted+v_count;
    v_last_end:=0;v_no:=0;
    FOR v_span IN SELECT * FROM jsonb_to_recordset(v_chunk.segments) AS x(
      global_physical_page integer,page_sha1 text,chunk_start_cp integer,chunk_end_cp integer,raw_start integer,raw_end integer)
    LOOP
      IF v_span.chunk_start_cp<v_last_end OR v_span.chunk_end_cp<=v_span.chunk_start_cp THEN
        RAISE EXCEPTION 'span order drift at %',v_chunk.chunk_id;
      END IF;
      PERFORM 1 FROM app.knowledge_ocr_pages pg WHERE pg.source_id=p_source_id
        AND pg.global_physical_page=v_span.global_physical_page AND pg.texte_sha1=v_span.page_sha1;
      IF NOT FOUND THEN RAISE EXCEPTION 'span page drift at %',v_chunk.chunk_id; END IF;
      SELECT * INTO v_existing FROM app.knowledge_chunk_page_spans
        WHERE chunk_id=v_chunk.chunk_id AND segment_no=v_no;
      IF FOUND AND (v_existing.source_id,v_existing.global_physical_page,v_existing.chunk_start_cp,v_existing.chunk_end_cp,
        v_existing.raw_start_cp,v_existing.raw_end_cp,v_existing.page_sha1)
        IS DISTINCT FROM (p_source_id,v_span.global_physical_page,v_span.chunk_start_cp,v_span.chunk_end_cp,
          v_span.raw_start,v_span.raw_end,v_span.page_sha1) THEN
        RAISE EXCEPTION 'span drift at %/%',v_chunk.chunk_id,v_no;
      END IF;
      INSERT INTO app.knowledge_chunk_page_spans(chunk_id,source_id,segment_no,global_physical_page,
        chunk_start_cp,chunk_end_cp,raw_start_cp,raw_end_cp,page_sha1)
        VALUES(v_chunk.chunk_id,p_source_id,v_no,v_span.global_physical_page,v_span.chunk_start_cp,v_span.chunk_end_cp,
          v_span.raw_start,v_span.raw_end,v_span.page_sha1) ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_count=ROW_COUNT; spans_inserted:=spans_inserted+v_count;
      v_last_end:=v_span.chunk_end_cp;v_no:=v_no+1;
    END LOOP;
    SELECT count(*) INTO v_count FROM app.knowledge_chunk_page_spans WHERE chunk_id=v_chunk.chunk_id;
    IF v_count<>v_no THEN RAISE EXCEPTION 'span cardinality drift at %',v_chunk.chunk_id; END IF;
  END LOOP;
  IF pages_inserted+chunks_inserted+spans_inserted>0 THEN
    INSERT INTO audit.log(operation,table_name,row_id,new_values)
      VALUES('insert','knowledge_book_provenance',p_source_id,
        jsonb_build_object('book_number',p_book_number,'pages',pages_inserted,'chunks',chunks_inserted,'spans',spans_inserted));
  END IF;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION app.backfill_knowledge_book_provenance(uuid,smallint,jsonb,jsonb) FROM PUBLIC;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
NOTIFY pgrst,'reload schema';
INSERT INTO app.schema_migrations(version) VALUES ('101_provenance_pages_connaissance') ON CONFLICT DO NOTHING;
COMMIT;
