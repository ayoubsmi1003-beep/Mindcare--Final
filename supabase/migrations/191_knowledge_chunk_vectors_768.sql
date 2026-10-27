-- 191_knowledge_chunk_vectors_768 — index vectoriel SECONDAIRE en 768 dimensions.
--
-- ═══ POURQUOI CETTE MIGRATION ═══
-- 188 a créé un index secondaire 384d (e5-small / Horizon-small). Le modèle
-- approuvé pour l'essai suivant est `intfloat/multilingual-e5-base` : 278 M
-- paramètres, 768 dimensions. pgvector exige UNE dimension fixe par index HNSW :
-- on ne peut pas ranger 768 nombres dans `vector(384)`. Cet index vit donc dans
-- une table SÉPARÉE, à côté de celui de 188.
--
-- ═══ CE QUE CETTE MIGRATION NE FAIT PAS ═══
--   · Aucun backfill : la table naît vide.
--   · Aucune activation : rien ne l'appelle tant que l'évaluation sur le golden
--     réel n'a pas tranché (`KNOWLEDGE_VECTOR` reste absent par défaut).
--   · Aucune modification de 092/093/111/123/188. L'index 1024d de production,
--     ses vecteurs, ses textes, ses pages et ses approbations restent INTACTS.
--
-- ═══ STATUT ═══
-- ESPACE D'ÉVALUATION. Si e5-base gagne sur le golden, la promotion (renommage
-- vers les noms canoniques) fera l'objet d'une migration dédiée et d'une
-- décision humaine. Si e5-base perd, cette table reste vide et inutilisée.
--
-- RETOUR ARRIÈRE : `DROP FUNCTION app.search_knowledge_vector_v2_768(...)` puis
-- `DROP TABLE app.knowledge_chunk_vectors_768`. Les vecteurs sont régénérables
-- depuis les chunks + la recette (aucune donnée unique n'est perdue).

BEGIN;

-- ── 0 · Préconditions ──────────────────────────────────────────────────────
DO $garde$
BEGIN
  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION '191 : PostgreSQL 16+ requis';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = '092_knowledge_rag')
    OR NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = '111_provenance_lignee_connaissance') THEN
    RAISE EXCEPTION '191 : socle connaissance absent (092/111)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION '191 : extension vector absente';
  END IF;
END;
$garde$;

-- ── 1 · La table des vecteurs secondaires 768d ─────────────────────────────
CREATE TABLE IF NOT EXISTS app.knowledge_chunk_vectors_768 (
    chunk_id      text NOT NULL REFERENCES app.knowledge_chunks(id) ON DELETE RESTRICT,
    modele        text NOT NULL CHECK (btrim(modele) <> ''),
    version       text NOT NULL CHECK (btrim(version) <> ''),
    dimensions    integer NOT NULL CHECK (dimensions = 768),
    normalisation text NOT NULL CHECK (btrim(normalisation) <> ''),
    distance      text NOT NULL DEFAULT 'cosine' CHECK (distance = 'cosine'),
    embedding     public.vector(768) NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT knowledge_chunk_vectors_768_pkey PRIMARY KEY (chunk_id, modele, version),
    CONSTRAINT knowledge_chunk_vectors_768_coherentes
        CHECK (public.vector_dims(embedding) = dimensions)
);

CREATE INDEX IF NOT EXISTS knowledge_chunk_vectors_768_hnsw
    ON app.knowledge_chunk_vectors_768 USING hnsw (embedding public.vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS knowledge_chunk_vectors_768_modele
    ON app.knowledge_chunk_vectors_768 (modele, version);

COMMENT ON TABLE app.knowledge_chunk_vectors_768 IS
    '191 : espace vectoriel d''évaluation en 768 dimensions (multilingual-e5-base). '
    'Aucune donnée patient. Aucune activation tant que le golden réel n''a pas tranché.';

-- ── 2 · Droits : la porte seule ────────────────────────────────────────────
GRANT SELECT ON app.knowledge_chunk_vectors_768 TO app_gatekeeper;
REVOKE ALL ON app.knowledge_chunk_vectors_768 FROM PUBLIC;

-- ── 3 · La porte de lecture (mêmes garanties que 188) ──────────────────────
CREATE OR REPLACE FUNCTION app.search_knowledge_vector_v2_768(
    p_embedding_json text,
    p_modele text,
    p_version text,
    p_limite integer)
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
AS $porte$
DECLARE
    v_limite integer := LEAST(GREATEST(p_limite, 1), 40);
BEGIN
    IF btrim(p_modele) = '' OR btrim(p_version) = '' THEN
        RAISE EXCEPTION '191 : modele/version requis (aucun mélange d''espaces vectoriels)';
    END IF;
    PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', true);
    PERFORM set_config('hnsw.ef_search', '80', true);

    RETURN QUERY
    WITH voisins AS MATERIALIZED (
        SELECT v.chunk_id AS id, (v.embedding OPERATOR(public.<=>) p.q) AS distance
          FROM app.knowledge_chunk_vectors_768 v
          CROSS JOIN (SELECT p_embedding_json::public.vector AS q OFFSET 0) AS p
         WHERE v.modele = p_modele AND v.version = p_version
         ORDER BY v.embedding OPERATOR(public.<=>) p.q
         LIMIT v_limite * 4
    )
    SELECT c.id, c.source_id, s.titre, s.version, c.section, c.chunker_version,
           c.langue, c.texte,
           (1 - voisins.distance)::double precision AS score,
           s.statut, s.classification, s.approved_at, s.approved_by,
           (s.review_due_at IS NULL OR s.review_due_at > now()) AS source_revue_a_jour,
           s.superseded_by AS source_remplacee_par,
           c.unit_id, c.parent_texte_hash, c.enfant_index, c.enfants_total
      FROM voisins
      JOIN app.knowledge_chunks c ON c.id = voisins.id
      JOIN app.knowledge_sources s ON s.id = c.source_id
     WHERE s.classification = 'C4'
       AND s.statut = 'active'
       AND s.approved_at IS NOT NULL
       AND s.approved_by IS NOT NULL
       AND (s.review_due_at IS NULL OR s.review_due_at > now())
       AND s.superseded_by IS NULL
       AND c.statut = 'active'
     ORDER BY voisins.distance
     LIMIT v_limite;
END;
$porte$;

COMMENT ON FUNCTION app.search_knowledge_vector_v2_768(text, text, text, integer) IS
    '191 : KNN HNSW sur l''index secondaire 768d, puis filtre d''autorité 092. '
    'modele+version exacts ; aucun mélange d''espaces vectoriels.';

ALTER FUNCTION app.search_knowledge_vector_v2_768(text, text, text, integer) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.search_knowledge_vector_v2_768(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_knowledge_vector_v2_768(text, text, text, integer) TO authenticated;

-- ── 4 · Journal de migration ───────────────────────────────────────────────
INSERT INTO app.schema_migrations (version) VALUES ('191_knowledge_chunk_vectors_768')
    ON CONFLICT DO NOTHING;

COMMIT;
