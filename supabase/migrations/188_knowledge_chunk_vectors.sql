-- 188_knowledge_chunk_vectors — index vectoriel SECONDAIRE, versionné par modèle.
--
-- ═══ POURQUOI CETTE MIGRATION ═══
-- `app.knowledge_chunks.embedding` est `vector(1024)` : il porte l'index BGE-M3
-- de production. Le passage à un modèle < 300 M paramètres impose 384
-- dimensions, donc un ESPACE VECTORIEL DIFFÉRENT. On ne peut ni convertir ni
-- mélanger les deux : cette migration crée un index SÉPARÉ, à côté de l'ancien.
-- L'ancien index, ses 48 760 vecteurs, ses textes, ses pages et ses
-- approbations restent INTOUCHÉS. Décision humaine D1/A.
--
-- ═══ CE QUE CETTE MIGRATION NE FAIT PAS ═══
--   · Aucun backfill : la table naît vide.
--   · Aucune activation : la fonction n'est appelée par personne tant que
--     `KNOWLEDGE_VECTOR` n'est pas câblé et que l'évaluation n'a pas tranché.
--   · Aucune modification de 092/093/111/123.
--
-- ═══ POURQUOI PAS DE RLS SUR LA TABLE DE VECTEURS ═══
-- Elle ne contient AUCUNE donnée patient : un `chunk_id` interne et des
-- nombres. `authenticated` n'a aucun privilège de table ; la seule voie est la
-- porte SECURITY DEFINER, qui applique le filtre d'autorité C4 + active +
-- approved + revue + non-superseded sur la SOURCE. Activer RLS ici
-- réintroduirait la jointure RLS qui a rendu l'index HNSW inutilisable sur
-- 092 (mesuré : `idx_scan = 0`, 48 760 lignes lues par requête).
--
-- ═══ CE QUE LA PORTE GARANTIT ═══
--   · `modele` + `version` EXACTS : jamais de mélange de deux espaces.
--   · KNN d'abord (`MATERIALIZED` + `OFFSET 0`), autorité ensuite : l'index
--     HNSW est utilisable, et les lignes non autorisées ne sortent jamais.
--   · `hnsw.iterative_scan` : un filtre sélectif ne dégrade pas en seq scan.
--
-- RETOUR ARRIÈRE : `DROP FUNCTION app.search_knowledge_vector_v2(...)` puis
-- `DROP TABLE app.knowledge_chunk_vectors`. Aucun texte source, aucune
-- approbation, aucun identifiant de chunk n'est perdu : les vecteurs sont
-- régénérables depuis les chunks + la recette.

BEGIN;

-- ── 0 · Préconditions : le socle connaissance doit être celui qu'on croit ───
DO $garde$
BEGIN
  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION '188 : PostgreSQL 16+ requis';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = '092_knowledge_rag')
    OR NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = '111_provenance_lignee_connaissance') THEN
    RAISE EXCEPTION '188 : socle connaissance absent (092/111)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION '188 : extension vector absente';
  END IF;
END;
$garde$;

-- ── 1 · La table des vecteurs secondaires ──────────────────────────────────
-- 384 = dimension des trois candidats éligibles (< 300 M) : E5-small,
-- Horizon-Labs multilingual-embedding-small, bekko-embedding-v1-a25m.
-- Un futur modèle d'une autre dimension exige une NOUVELLE migration, pas une
-- édition de celle-ci.
CREATE TABLE IF NOT EXISTS app.knowledge_chunk_vectors (
    chunk_id      text NOT NULL REFERENCES app.knowledge_chunks(id) ON DELETE RESTRICT,
    modele        text NOT NULL CHECK (btrim(modele) <> ''),
    version       text NOT NULL CHECK (btrim(version) <> ''),
    dimensions    integer NOT NULL CHECK (dimensions = 384),
    normalisation text NOT NULL CHECK (btrim(normalisation) <> ''),
    distance      text NOT NULL DEFAULT 'cosine' CHECK (distance = 'cosine'),
    embedding     public.vector(384) NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT knowledge_chunk_vectors_pkey PRIMARY KEY (chunk_id, modele, version),
    CONSTRAINT knowledge_chunk_vectors_coherentes
        CHECK (public.vector_dims(embedding) = dimensions)
);

CREATE INDEX IF NOT EXISTS knowledge_chunk_vectors_hnsw
    ON app.knowledge_chunk_vectors USING hnsw (embedding public.vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS knowledge_chunk_vectors_modele
    ON app.knowledge_chunk_vectors (modele, version);

COMMENT ON TABLE app.knowledge_chunk_vectors IS
    '188 / D1-A : index vectoriel secondaire, versionné par (modele, version). Aucune donnée patient. '
    'L''index 1024d de knowledge_chunks reste l''index de production jusqu''à promotion évaluée.';

-- ── 2 · Droits : la porte seule ────────────────────────────────────────────
GRANT SELECT ON app.knowledge_chunk_vectors TO app_gatekeeper;
REVOKE ALL ON app.knowledge_chunk_vectors FROM PUBLIC;

-- ── 3 · La porte de lecture v2 ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.search_knowledge_vector_v2(
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
        RAISE EXCEPTION '188 : modele/version requis (aucun mélange d''espaces vectoriels)';
    END IF;
    -- Filtre sélectif : l'itération HNSW évite la dégradation en parcours complet.
    PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', true);
    PERFORM set_config('hnsw.ef_search', '80', true);

    RETURN QUERY
    WITH voisins AS MATERIALIZED (
        SELECT v.chunk_id AS id, (v.embedding OPERATOR(public.<=>) p.q) AS distance
          FROM app.knowledge_chunk_vectors v
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

COMMENT ON FUNCTION app.search_knowledge_vector_v2(text, text, text, integer) IS
    '188 / D1-A : KNN HNSW sur l''index secondaire, puis filtre d''autorité 092. '
    'modele+version exacts ; aucun mélange d''espaces vectoriels.';

ALTER FUNCTION app.search_knowledge_vector_v2(text, text, text, integer) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.search_knowledge_vector_v2(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_knowledge_vector_v2(text, text, text, integer) TO authenticated;

-- ── 4 · Journal de migration ───────────────────────────────────────────────
INSERT INTO app.schema_migrations (version) VALUES ('188_knowledge_chunk_vectors')
    ON CONFLICT DO NOTHING;

COMMIT;
