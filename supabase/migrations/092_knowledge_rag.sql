-- 092_knowledge_rag — M07 · socle de récupération gouvernée (proposition H1, porte A).
--
-- Contenu : extension pgvector + tables knowledge_sources / knowledge_chunks +
-- unicité tenant-sûre partielle + lignée de supersession + index HNSW/GIN +
-- RLS (motif medications 009) + 2 portes de lecture (défaut gouverné uniquement).
--
-- HORS PÉRIMÈTRE : embeddings réels (porte B), corpus de production (porte C),
-- variante historique `p_inclure_historique` (porte dédiée ultérieure), écritures
-- d'ingestion (chargeur Gate C). Aucune écriture applicative n'est ouverte ici.
--
-- CIBLE : runtime PostgreSQL embarqué avec pgvector (image pgvector/pg16).
-- ⚠️ Le conteneur dev mc-p3 (postgres:17 vanilla) NE PORTE PAS l'extension
-- `vector` : cette migration y échoue sur `CREATE EXTENSION` — c'est un écart
-- d'environnement documenté (rapport Gate A), pas une erreur du fichier.
-- ⚠️ Chaîne de packaging : `scripts/elaguer-pgsql.mjs` ne conserve que les
-- extensions nommées par un `CREATE EXTENSION` des migrations — `vector` y
-- figure désormais ; vérifier que le bundle EDB Windows fournit `vector.so`,
-- sinon le paquet ne pourra pas l'installer.
--
-- Conventions respectées : BEGIN/COMMIT + `schema_migrations`, `CREATE OR REPLACE`
-- uniquement (jamais DROP — motif 029 : un DROP rend la porte à `postgres`
-- BYPASSRLS), privilèges nommés + `OWNER TO app_gatekeeper` + `REVOKE CREATE`
-- symétriques (motif 026 §3), `SET search_path` figé (motif 003), noms
-- qualifiés `public.vector` / `OPERATOR(public.<=>)` / `app.immutable_unaccent`
-- car les portes n'incluent pas `public` dans leur search_path.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0 · Extension vecteur + privilège de transfert, retiré au §8
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 1 · Tables — l'autorité tenant vit sur les SOURCES uniquement (H0.2)
-- ---------------------------------------------------------------------------
-- `cabinet_id` NULL = corpus partagé, renseigné = extension du cabinet
-- (motif medications, 009 §2). Les chunks N'ONT PAS de `cabinet_id` : un chunk
-- appartient à sa source, la jointure tranche (matrice n°11).
CREATE TABLE app.knowledge_sources (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid REFERENCES app.cabinets(id),
    titre               text NOT NULL,
    version             text NOT NULL,
    langue              text NOT NULL CHECK (langue IN ('fr', 'ar', 'darija')),
    classification      text NOT NULL CHECK (classification IN ('C1', 'C2', 'C3', 'C4', 'INCONNU')),
    statut              text NOT NULL DEFAULT 'discovered'
                        CHECK (statut IN ('discovered', 'classified', 'reviewed', 'active', 'inactive', 'revoked', 'superseded')),
    approved_at         timestamptz,
    approved_by         uuid REFERENCES app.profiles(id),
    reviewed_by         uuid REFERENCES app.profiles(id),
    reviewed_at         timestamptz,
    review_due_at       timestamptz,
    superseded_by       uuid REFERENCES app.knowledge_sources(id),
    emetteur            text,
    reference_origine   text,
    contenu_hash        text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- Garde anti auto-supersession (le trigger §3 verrouille la lignée complète).
    CONSTRAINT knowledge_sources_no_self_supersede
        CHECK (superseded_by IS NULL OR superseded_by <> id)
);

-- `id` est un texte, PAS un uuid — exception raisonnée à P1 (01-SCHEMA) :
-- l'identité d'un chunk est son hash de contenu stable (découpage struct-v1),
-- pas un aléa : ré-ingérer le même document rend les mêmes identifiants.
CREATE TABLE app.knowledge_chunks (
    id                          text PRIMARY KEY,
    source_id                   uuid NOT NULL REFERENCES app.knowledge_sources(id) ON DELETE RESTRICT,
    ordinal                     integer NOT NULL CHECK (ordinal >= 0),
    section                     text,
    sous_section                text,
    langue                      text NOT NULL CHECK (langue IN ('fr', 'ar', 'darija')),
    texte                       text NOT NULL CHECK (texte <> ''),
    texte_hash                  text NOT NULL,
    occurrence                  integer NOT NULL DEFAULT 0 CHECK (occurrence >= 0),
    statut                      text NOT NULL DEFAULT 'active' CHECK (statut IN ('active', 'inactive')),
    chunker_version             text NOT NULL,
    -- Typmod INITIAL 1024 (HNSW l'exige : pas d'index sans dimensions — vérifié
    -- pgvector 0.8.5). Les deux candidats Gate B (e5-large, bge-m3) sont 1024d ;
    -- si Gate B verrouille d'autres dimensions, migration de suivi + ré-embedding
    -- (stratégie documentée, détection par recette), jamais de coexistence silencieuse.
    embedding                   public.vector(1024),
    embedding_provider          text,
    embedding_modele            text,
    embedding_version           text,
    embedding_dimensions        integer CHECK (embedding_dimensions IS NULL OR embedding_dimensions > 0),
    embedding_normalisation     text,
    embedding_instruction_requete   text NOT NULL DEFAULT '',
    embedding_instruction_document  text NOT NULL DEFAULT '',
    embedding_distance          text NOT NULL DEFAULT 'cosine',
    document_tsv                tsvector GENERATED ALWAYS AS (
                                    to_tsvector('simple', app.immutable_unaccent(coalesce(section, '') || ' ' || texte))
                                ) STORED,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    -- Recette tout-ou-rien : jamais de vecteur à moitié documenté (H0.5).
    CONSTRAINT knowledge_chunks_recette_complete
        CHECK (
            (embedding IS NULL AND embedding_modele IS NULL AND embedding_dimensions IS NULL)
            OR (embedding IS NOT NULL AND embedding_modele IS NOT NULL
                AND embedding_dimensions IS NOT NULL AND embedding_provider IS NOT NULL
                AND embedding_version IS NOT NULL AND embedding_normalisation IS NOT NULL)
        ),
    -- Cohérence dimensions : le vecteur stocké a la dimension déclarée.
    CONSTRAINT knowledge_chunks_dimensions_coherentes
        CHECK (embedding IS NULL OR public.vector_dims(embedding) = embedding_dimensions)
);

-- ---------------------------------------------------------------------------
-- 2 · Lignée de supersession — trigger, pas de promesse applicative
-- ---------------------------------------------------------------------------
-- Règles : (a) `superseded_by` exige `statut = 'superseded'` et réciproquement ;
-- (b) le successeur partage titre ET portée tenant (même `titre`, `cabinet_id`
-- non distinct) — deux sources sans lien, ou deux cabinets, ne se remplacent
-- jamais par accident (H1). La FK garantit l'existence ; ce trigger la lignée.
CREATE OR REPLACE FUNCTION app.check_knowledge_supersession()
RETURNS trigger LANGUAGE plpgsql
SET search_path = app, pg_catalog AS $$
DECLARE
    v_titre   text;
    v_cabinet uuid;
BEGIN
    IF NEW.statut = 'superseded' AND NEW.superseded_by IS NULL THEN
        RAISE EXCEPTION 'knowledge_sources % : statut superseded sans superseded_by', NEW.id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.superseded_by IS NOT NULL AND NEW.statut <> 'superseded' THEN
        RAISE EXCEPTION 'knowledge_sources % : superseded_by exige statut superseded', NEW.id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.superseded_by IS NOT NULL THEN
        SELECT titre, cabinet_id INTO v_titre, v_cabinet
          FROM app.knowledge_sources WHERE id = NEW.superseded_by;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'knowledge_sources % : successeur introuvable', NEW.id
                USING ERRCODE = 'foreign_key_violation';
        END IF;
        IF v_titre IS DISTINCT FROM NEW.titre OR v_cabinet IS DISTINCT FROM NEW.cabinet_id THEN
            RAISE EXCEPTION 'knowledge_sources % : lignée rompue (titre ou cabinet divergent)', NEW.id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_knowledge_supersession
    BEFORE INSERT OR UPDATE ON app.knowledge_sources
    FOR EACH ROW EXECUTE FUNCTION app.check_knowledge_supersession();

-- ---------------------------------------------------------------------------
-- 3 · Unicité tenant-sûre (H0.1) — partielle, car NULL est distinct en PG
-- ---------------------------------------------------------------------------
-- Partagé : un seul (titre, version) sans cabinet. Cabinet : un seul par
-- (cabinet, titre, version). Partagé + cabinet homonymes : autorisés (intersection
-- vide des prédicats). Chunks : identité stable, tenant via la source (H0.2).
CREATE UNIQUE INDEX knowledge_sources_partage
    ON app.knowledge_sources (titre, version) WHERE cabinet_id IS NULL;
CREATE UNIQUE INDEX knowledge_sources_cabinet
    ON app.knowledge_sources (cabinet_id, titre, version) WHERE cabinet_id IS NOT NULL;
CREATE UNIQUE INDEX knowledge_chunks_identite
    ON app.knowledge_chunks (source_id, section, sous_section, texte_hash, occurrence);

-- ---------------------------------------------------------------------------
-- 4 · Index — HNSW cosine (m=16, ef_construction=64, porte A) + FTS/GIN
-- ---------------------------------------------------------------------------
CREATE INDEX knowledge_chunks_embedding_hnsw
    ON app.knowledge_chunks USING hnsw (embedding public.vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
CREATE INDEX knowledge_chunks_document_tsv_gin
    ON app.knowledge_chunks USING gin (document_tsv);
CREATE INDEX knowledge_chunks_source
    ON app.knowledge_chunks (source_id);
CREATE INDEX knowledge_sources_gouvernance
    ON app.knowledge_sources (statut, classification);

-- ---------------------------------------------------------------------------
-- 5 · RLS — ENABLE + FORCE (référence comme 009), motif medications
-- ---------------------------------------------------------------------------
ALTER TABLE app.knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_chunks FORCE ROW LEVEL SECURITY;

-- Référentiel partagé + extension cabinet : lisible par tout rôle authentifié
-- du cabinet, ou partagé. Aucune policy d'écriture : les écritures passent
-- par le chargeur Gate C, jamais en direct (fail-closed).
CREATE POLICY knowledge_sources_read ON app.knowledge_sources
    FOR SELECT TO authenticated
    USING (cabinet_id IS NULL OR cabinet_id = app.current_cabinet());

-- Chunks : tenant via la source (H0.2) — pas de `cabinet_id` dupliqué.
CREATE POLICY knowledge_chunks_read ON app.knowledge_chunks
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM app.knowledge_sources s
         WHERE s.id = knowledge_chunks.source_id
           AND (s.cabinet_id IS NULL OR s.cabinet_id = app.current_cabinet())
    ));

-- Dépendances nommées des portes DEFINER (motif 026 §3).
GRANT SELECT ON app.knowledge_sources TO app_gatekeeper;
GRANT SELECT ON app.knowledge_chunks TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 6 · Portes de lecture — voie DÉFAUT gouvernée uniquement (H1)
-- ---------------------------------------------------------------------------
-- Les deux portes imposent le filtre C4 + active + approved + revue +
-- non-superseded DANS le SQL (matrice n°11). L'historique explicite est une
-- variante de porte séparée (Gate A ultérieure), jamais un mélange ici.
CREATE OR REPLACE FUNCTION app.search_knowledge_lexical(p_requete text, p_langue text, p_limite integer)
RETURNS TABLE (
    chunk_id text, source_id uuid, source_titre text, source_version text,
    section text, version_chunk text, langue text, texte text, score double precision,
    source_statut text, source_classification text,
    source_approuvee_le timestamptz, source_approuvee_par uuid,
    source_revue_a_jour boolean, source_remplacee_par uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, audit, pg_catalog AS $$
    SELECT c.id, c.source_id, s.titre, s.version, c.section, c.chunker_version,
           c.langue, c.texte,
           ts_rank(c.document_tsv, plainto_tsquery('simple', app.immutable_unaccent($1))) AS score,
           s.statut, s.classification, s.approved_at, s.approved_by,
           (s.review_due_at IS NULL OR s.review_due_at > now()) AS source_revue_a_jour,
           s.superseded_by AS source_remplacee_par
      FROM app.knowledge_chunks c
      JOIN app.knowledge_sources s ON s.id = c.source_id
     WHERE s.classification = 'C4'
       AND s.statut = 'active'
       AND s.approved_at IS NOT NULL
       AND s.approved_by IS NOT NULL
       AND (s.review_due_at IS NULL OR s.review_due_at > now())
       AND s.superseded_by IS NULL
       AND c.statut = 'active'
       AND ($2 = 'toutes' OR c.langue = $2)
       AND c.document_tsv @@ plainto_tsquery('simple', app.immutable_unaccent($1))
     ORDER BY score DESC
     LIMIT LEAST(GREATEST($3, 1), 20);
$$;

CREATE OR REPLACE FUNCTION app.search_knowledge_vector(p_embedding_json text, p_limite integer)
RETURNS TABLE (
    chunk_id text, source_id uuid, source_titre text, source_version text,
    section text, version_chunk text, langue text, texte text, score double precision,
    source_statut text, source_classification text,
    source_approuvee_le timestamptz, source_approuvee_par uuid,
    source_revue_a_jour boolean, source_remplacee_par uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, audit, pg_catalog AS $$
    SELECT c.id, c.source_id, s.titre, s.version, c.section, c.chunker_version,
           c.langue, c.texte,
           1 - (c.embedding OPERATOR(public.<=>) ($1::public.vector)) AS score,
           s.statut, s.classification, s.approved_at, s.approved_by,
           (s.review_due_at IS NULL OR s.review_due_at > now()) AS source_revue_a_jour,
           s.superseded_by AS source_remplacee_par
      FROM app.knowledge_chunks c
      JOIN app.knowledge_sources s ON s.id = c.source_id
     WHERE s.classification = 'C4'
       AND s.statut = 'active'
       AND s.approved_at IS NOT NULL
       AND s.approved_by IS NOT NULL
       AND (s.review_due_at IS NULL OR s.review_due_at > now())
       AND s.superseded_by IS NULL
       AND c.statut = 'active'
       AND c.embedding IS NOT NULL
     ORDER BY c.embedding OPERATOR(public.<=>) ($1::public.vector)
     LIMIT LEAST(GREATEST($2, 1), 20);
$$;

COMMENT ON FUNCTION app.search_knowledge_lexical(text, text, integer) IS
    'M07 : branche lexicale (ts_rank + GIN). Voie défaut gouvernée uniquement.';
COMMENT ON FUNCTION app.search_knowledge_vector(text, integer) IS
    'M07 : branche vectorielle (cosine HNSW, embedding JSON→public.vector). Voie défaut gouvernée uniquement.';

REVOKE ALL ON FUNCTION app.search_knowledge_lexical(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_knowledge_lexical(text, text, integer) TO authenticated;
REVOKE ALL ON FUNCTION app.search_knowledge_vector(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_knowledge_vector(text, integer) TO authenticated;
ALTER FUNCTION app.search_knowledge_lexical(text, text, integer) OWNER TO app_gatekeeper;
ALTER FUNCTION app.search_knowledge_vector(text, integer) OWNER TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 7 · Commentaires de traçabilité
-- ---------------------------------------------------------------------------
COMMENT ON TABLE app.knowledge_sources IS
    'M07 : corpus gouverné. cabinet_id NULL = partagé (motif medications 009). Autorité tenant unique (H0.2).';
COMMENT ON TABLE app.knowledge_chunks IS
    'M07 : chunks struct-v1. id = hash stable (exception raisonnée à P1). embedding SANS typmod : dimensions verrouillées porte B.';

-- ---------------------------------------------------------------------------
-- 8 · Fermeture — symétrie 026 §3, reload, journal de migration
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
NOTIFY pgrst, 'reload schema';
INSERT INTO app.schema_migrations (version) VALUES ('092_knowledge_rag')
    ON CONFLICT DO NOTHING;

COMMIT;
