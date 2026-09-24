-- Account-bound book activation: all active OCR and headings must already be attested.
-- This migration creates the door; it does not activate a book.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

GRANT UPDATE (statut, reviewed_by, reviewed_at, approved_by, approved_at)
  ON app.knowledge_sources TO app_gatekeeper;
CREATE POLICY knowledge_sources_book_activation ON app.knowledge_sources
  FOR UPDATE TO app_gatekeeper
  USING (cabinet_id IS NULL AND classification='C4' AND statut='discovered'
    AND approved_at IS NULL AND approved_by IS NULL AND superseded_by IS NULL)
  WITH CHECK (cabinet_id IS NULL AND classification='C4' AND statut='active'
    AND approved_at IS NOT NULL AND approved_by=auth.uid()
    AND reviewed_at IS NOT NULL AND reviewed_by=auth.uid() AND superseded_by IS NULL);
GRANT INSERT ON audit.log TO app_gatekeeper;
GRANT USAGE ON SEQUENCE audit.log_id_seq TO app_gatekeeper;

CREATE FUNCTION app.activate_book_knowledge(
  p_source_id uuid, p_version text, p_visa_reference text, p_eval_sha256 text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE
  v_source app.knowledge_sources%ROWTYPE;
  v_book app.knowledge_book_editions%ROWTYPE;
  v_total bigint;
  v_unready bigint;
  v_actor uuid := auth.uid();
  v_role app.user_role := app.current_role();
BEGIN
  IF v_actor IS NULL OR v_role NOT IN ('owner','practitioner') OR NOT EXISTS (
    SELECT 1 FROM app.profiles WHERE id=v_actor AND is_active
  ) THEN RAISE EXCEPTION 'active doctor account required' USING ERRCODE='insufficient_privilege'; END IF;
  IF p_source_id IS NULL OR nullif(btrim(p_version),'') IS NULL OR
     nullif(btrim(p_visa_reference),'') IS NULL OR
     p_eval_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'book version, visa reference and eval hash required';
  END IF;

  SELECT * INTO v_source FROM app.knowledge_sources WHERE id=p_source_id FOR UPDATE;
  IF NOT FOUND OR v_source.version IS DISTINCT FROM p_version OR
     v_source.cabinet_id IS NOT NULL OR v_source.classification<>'C4' OR
     v_source.statut<>'discovered' OR v_source.approved_at IS NOT NULL OR
     v_source.approved_by IS NOT NULL OR v_source.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'book source not eligible';
  END IF;
  SELECT * INTO v_book FROM app.knowledge_book_editions WHERE source_id=p_source_id;
  IF NOT FOUND OR v_book.title_exact IS NULL OR v_book.edition_label IS NULL OR
     v_book.metadata_verified_by IS DISTINCT FROM v_actor OR
     v_book.metadata_verified_at IS NULL THEN
    RAISE EXCEPTION 'book metadata unattested';
  END IF;

  SELECT count(*),count(*) FILTER (WHERE
    k.chunk_id IS NULL OR k.mapping_status<>'verified' OR
    k.heading_status<>'verified' OR k.heading_verified_by IS DISTINCT FROM v_actor OR
    k.heading_verified_at IS NULL OR cardinality(k.heading_path)=0 OR
    k.ocr_review_status<>'accepted' OR
    k.texte_hash IS DISTINCT FROM c.texte_hash OR
    k.chunker_version IS DISTINCT FROM c.chunker_version OR
    c.embedding IS NULL OR NOT EXISTS (
      SELECT 1 FROM app.knowledge_chunk_page_spans x
      JOIN app.knowledge_ocr_pages pg
        ON pg.source_id=x.source_id AND pg.global_physical_page=x.global_physical_page
       AND pg.texte_sha1=x.page_sha1
      WHERE x.chunk_id=c.id AND x.source_id=c.source_id
    ))
    INTO v_total,v_unready
  FROM app.knowledge_chunks c
  LEFT JOIN app.knowledge_book_chunks k ON k.chunk_id=c.id AND k.source_id=c.source_id
  WHERE c.source_id=p_source_id AND c.statut='active';
  IF v_total=0 OR v_unready<>0 THEN
    RAISE EXCEPTION 'book chunks not fully attested: total %, unready %',v_total,v_unready;
  END IF;

  UPDATE app.knowledge_sources SET statut='active',
    reviewed_by=v_actor,reviewed_at=now(),approved_by=v_actor,approved_at=now()
  WHERE id=p_source_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'book activation transition failed'; END IF;
  INSERT INTO audit.log(actor_id,actor_role,operation,table_name,row_id,changed_fields,old_values,new_values)
  VALUES(v_actor,v_role,'update','knowledge_sources',p_source_id,
    ARRAY['statut','reviewed_by','reviewed_at','approved_by','approved_at'],
    jsonb_build_object('status',v_source.statut,'approved_at',v_source.approved_at),
    jsonb_build_object('status','active','book_number',v_book.book_number,
      'version',p_version,'visa_reference',p_visa_reference,'eval_sha256',p_eval_sha256,
      'active_chunks',v_total));
  RETURN p_source_id;
END $$;

REVOKE ALL ON FUNCTION app.activate_book_knowledge(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.activate_book_knowledge(uuid,text,text,text) TO authenticated;
ALTER FUNCTION app.activate_book_knowledge(uuid,text,text,text) OWNER TO app_gatekeeper;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES ('104_activation_gouvernee_livres') ON CONFLICT DO NOTHING;
COMMIT;
