-- 073_medication_catalog_enrich — ADR-028 catalogue source identity & search.
--
-- Enrichit app.medications (009) sans toucher aux 60 lignes manuelles existantes :
--   - source_raw_value       : valeur brute exacte du fichier (autorité)
--   - normalized_search      : lower(unaccent(trim(raw))) pour la recherche
--   - source_fingerprint     : sha256(canonical_raw) — identité d'import
--   - source_version         : sha256 du fichier source (sha256:<hex>)
-- Les 4 colonnes sont NULLABLES pour survivre aux lignes legacy.
-- Un index UNIQUE PARTIEL garantit l'idempotence sans invalider les lignes manuelles.

BEGIN;

-- ---------------------------------------------------------------------------
-- Colonnes (NULLABLE pour compatibilité legacy, Règle 9 / Décision 4 mission)
-- ---------------------------------------------------------------------------
ALTER TABLE app.medications ADD COLUMN IF NOT EXISTS source_raw_value text;
ALTER TABLE app.medications ADD COLUMN IF NOT EXISTS normalized_search text;
ALTER TABLE app.medications ADD COLUMN IF NOT EXISTS source_fingerprint text;
ALTER TABLE app.medications ADD COLUMN IF NOT EXISTS source_version text;

COMMENT ON COLUMN app.medications.source_raw_value IS
  'Valeur brute exacte du fichier Médicaments.xlsx (autorité). NULL pour lignes manuelles legacy.';
COMMENT ON COLUMN app.medications.normalized_search IS
  'lower(immutable_unaccent(trim(raw))) — recherche accent/casse insensible.';
COMMENT ON COLUMN app.medications.source_fingerprint IS
  'sha256(canonical_raw) où canonical = trim + collapse whitespace — identité import.';
COMMENT ON COLUMN app.medications.source_version IS
  'sha256:<hex> du fichier source complet.';

-- ---------------------------------------------------------------------------
-- Index d'idempotence — partiel pour ne pas toucher les NULL legacy
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS medications_source_fingerprint_uidx;
CREATE UNIQUE INDEX medications_source_fingerprint_uidx ON app.medications (source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Index de recherche — GIN trigram sur normalized_search (pg_trgm + unaccent déjà installés par 001)
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS medications_normalized_search_trgm;
CREATE INDEX medications_normalized_search_trgm ON app.medications
  USING gin (normalized_search gin_trgm_ops)
  WHERE normalized_search IS NOT NULL;

-- Fallback : index sur source_raw_value pour recherches sans normalisation (tooling)
DROP INDEX IF EXISTS medications_raw_trgm;
CREATE INDEX medications_raw_trgm ON app.medications
  USING gin ((app.immutable_unaccent(lower(source_raw_value))) gin_trgm_ops)
  WHERE source_raw_value IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Porte de recherche — exécutée côté base, jamais 15k lignes en React
-- Supporte : case/accent/prefix/typo (pg_trgm), recherche sur raw + inn/brand legacy
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.search_medications(p_query text, p_limit integer DEFAULT 20)
RETURNS TABLE(
  id uuid,
  raw_name text,
  inn text,
  brand_name text,
  form text,
  strength text,
  normalized_name text,
  source text,
  rank real
)
LANGUAGE sql STABLE
SET search_path = app, public, pg_catalog
AS $$
  WITH q AS (
    SELECT nullif(trim(p_query), '') AS raw,
           app.immutable_unaccent(lower(trim(coalesce(p_query,'')))) AS needle
  ),
  lim AS (SELECT least(greatest(coalesce(p_limit, 20), 1), 50) AS v)
  SELECT m.id,
         coalesce(m.source_raw_value, coalesce(m.brand_name,'') || ' ' || m.inn) AS raw_name,
         m.inn,
         m.brand_name,
         m.form,
         m.strength,
         m.normalized_search AS normalized_name,
         m.source,
         -- rang : prefix exact > trigram similarity > lexicographique
         (
           CASE WHEN coalesce(m.normalized_search, app.immutable_unaccent(lower(coalesce(m.source_raw_value,'')))) ILIKE (SELECT needle FROM q) || '%' THEN 0.0
                WHEN coalesce(m.normalized_search, app.immutable_unaccent(lower(coalesce(m.source_raw_value,'')))) ILIKE '%' || (SELECT needle FROM q) || '%' THEN 0.2
                ELSE 0.5 END
           + (1 - coalesce(public.similarity(coalesce(m.normalized_search, app.immutable_unaccent(lower(coalesce(m.source_raw_value,'')))), (SELECT needle FROM q)), 0)) * 0.5
         )::real AS rank
  FROM app.medications m, q, lim
  WHERE m.is_active IS NOT FALSE
    AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
    AND (SELECT raw FROM q) IS NOT NULL
    AND (
      coalesce(m.normalized_search, app.immutable_unaccent(lower(coalesce(m.source_raw_value,'')))) ILIKE '%' || (SELECT needle FROM q) || '%'
      OR coalesce(m.normalized_search, app.immutable_unaccent(lower(coalesce(m.source_raw_value,'')))) % (SELECT needle FROM q)
      OR app.immutable_unaccent(lower(coalesce(m.brand_name,'') || ' ' || m.inn)) ILIKE '%' || (SELECT needle FROM q) || '%'
    )
  ORDER BY rank ASC,
           CASE WHEN coalesce(m.normalized_search, app.immutable_unaccent(lower(coalesce(m.source_raw_value,'')))) ILIKE (SELECT needle FROM q) || '%' THEN 0 ELSE 1 END,
           public.similarity(coalesce(m.normalized_search, app.immutable_unaccent(lower(coalesce(m.source_raw_value,'')))), (SELECT needle FROM q)) DESC,
           m.brand_name NULLS LAST, m.inn
  LIMIT (SELECT v FROM lim);
$$;

REVOKE ALL ON FUNCTION app.search_medications(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.search_medications(text, integer) TO authenticated;

COMMENT ON FUNCTION app.search_medications(text, integer) IS
  'Recherche catalogue côté base (<300ms, accent/casse/prefix/typo). Jamais 15k lignes en React.';

INSERT INTO app.schema_migrations (version) VALUES ('073_medication_catalog_enrich')
  ON CONFLICT DO NOTHING;

COMMIT;
