-- ═══════════════════════════════════════════════════════════════════════════
-- 197_recherche_medicaments_infixe — le préfixe FTS ET le contenu.
--
-- 195 avait remplacé la phase « contenu » par le seul préfixe de mot FTS :
-- « doli » rendait 29 lignes au lieu de 33 (les CODOLIPRANE, où « doli » est au
-- milieu du mot, disparaissaient). 197 rétablit l'union FTS + `position()` :
-- le préfixe indexé d'abord, le contenu ensuite, dédupliqué, avec le même
-- `total_count` et la même pagination.
--
-- Aucun changement de signature, de droits, de RLS ni d'index.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION app.search_medications_page(
  p_query text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid,
  raw_name text,
  inn text,
  brand_name text,
  form text,
  strength text,
  normalized_name text,
  source text,
  rank real,
  total_count bigint)
LANGUAGE plpgsql
STABLE
SET search_path = app, public, pg_catalog
AS $$
DECLARE
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_raw    text    := nullif(trim(coalesce(p_query, '')), '');
  v_needle text;
  v_tokens text[];
  v_tsq    tsquery;
  v_debut  text;
BEGIN
  IF v_raw IS NULL THEN
    RETURN;
  END IF;

  v_needle := app.immutable_unaccent(lower(v_raw));
  v_tokens := ARRAY(
    SELECT t
    FROM unnest(regexp_split_to_array(v_needle, '[^[:alnum:]]+')) AS t
    WHERE t <> ''
    LIMIT 8
  );

  IF coalesce(cardinality(v_tokens), 0) = 0 THEN
    RETURN;
  END IF;

  v_tsq := to_tsquery(
    'simple',
    array_to_string(
      ARRAY(SELECT t || ':*' FROM unnest(v_tokens) AS t),
      ' & '
    )
  );
  v_debut := left(v_tokens[1], 2);

  -- ═══ Phase 1 — préfixe de mot (index GIN) + contenu littéral (position) ═══
  -- L'union garantit qu'aucune ligne du catalogue n'est invisible : le préfixe
  -- est rapide, le contenu rattrape les mots composés (« CODOLIPRANE » pour
  -- « doli »), les séparateurs et l'ordre libre.
  RETURN QUERY
  WITH fts AS (
    SELECT m.id,
           coalesce(m.source_raw_value, coalesce(m.brand_name, '') || ' ' || m.inn) AS raw_name,
           m.inn,
           m.brand_name,
           m.form,
           m.strength,
           m.normalized_search AS normalized_name,
           m.source,
           (CASE WHEN m.normalized_search = v_needle THEN 0.0
                 WHEN m.normalized_search LIKE v_needle || '%' THEN 1.0
                 ELSE 2.0 END)::real AS rank,
           ts_rank(
             to_tsvector('simple', app.medication_search_text(m.normalized_search, m.brand_inn_search)),
             v_tsq
           ) AS trank
    FROM app.medications m
    WHERE m.is_active IS NOT FALSE
      AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
      AND to_tsvector('simple', app.medication_search_text(m.normalized_search, m.brand_inn_search)) @@ v_tsq
  ), contenu AS (
    SELECT m.id,
           coalesce(m.source_raw_value, coalesce(m.brand_name, '') || ' ' || m.inn) AS raw_name,
           m.inn,
           m.brand_name,
           m.form,
           m.strength,
           m.normalized_search AS normalized_name,
           m.source,
           (3.0 + (1 - coalesce(public.similarity(m.normalized_search, v_needle), 0)) * 0.5)::real AS rank,
           0::real AS trank
    FROM app.medications m
    WHERE m.is_active IS NOT FALSE
      AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
      AND NOT EXISTS (SELECT 1 FROM fts f WHERE f.id = m.id)
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(v_tokens) AS t
        WHERE position(t IN coalesce(m.normalized_search, '')) = 0
          AND position(t IN coalesce(m.brand_inn_search, '')) = 0
      )
  ), hits AS (
    SELECT * FROM fts
    UNION ALL
    SELECT * FROM contenu
  )
  SELECT h.id, h.raw_name, h.inn, h.brand_name, h.form, h.strength,
         h.normalized_name, h.source, h.rank, count(*) OVER () AS total_count
  FROM hits h
  ORDER BY h.rank ASC, h.trank DESC, h.brand_name NULLS LAST, h.inn, h.id
  LIMIT v_limit OFFSET v_offset;

  IF FOUND THEN
    RETURN;
  END IF;

  -- ═══ Phase 2 — faute de frappe sur la fin du nom (« troxene ») ═══
  IF char_length(v_needle) >= 4 AND v_debut <> '' THEN
    RETURN QUERY
    WITH hits AS (
      SELECT m.id,
             coalesce(m.source_raw_value, coalesce(m.brand_name, '') || ' ' || m.inn) AS raw_name,
             m.inn,
             m.brand_name,
             m.form,
             m.strength,
             m.normalized_search AS normalized_name,
             m.source,
             (4.0 + (1 - public.similarity(m.normalized_search, v_needle)) * 0.5)::real AS rank,
             public.similarity(m.normalized_search, v_needle) AS sim,
             count(*) OVER () AS total_count
      FROM app.medications m
      WHERE m.is_active IS NOT FALSE
        AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
        AND (
          m.normalized_search LIKE v_debut || '%'
          OR m.brand_inn_search LIKE v_debut || '%'
        )
        AND public.similarity(m.normalized_search, v_needle) >= 0.15
    )
    SELECT h.id, h.raw_name, h.inn, h.brand_name, h.form, h.strength,
           h.normalized_name, h.source, h.rank, h.total_count
    FROM hits h
    ORDER BY h.sim DESC, h.brand_name NULLS LAST, h.inn, h.id
    LIMIT v_limit OFFSET v_offset;

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  -- ═══ Phase 3 — faute sur le début (« roliprane ») ═══
  IF char_length(v_needle) >= 4 THEN
    RETURN QUERY
    WITH hits AS (
      SELECT m.id,
             coalesce(m.source_raw_value, coalesce(m.brand_name, '') || ' ' || m.inn) AS raw_name,
             m.inn,
             m.brand_name,
             m.form,
             m.strength,
             m.normalized_search AS normalized_name,
             m.source,
             (4.0 + (1 - public.similarity(m.normalized_search, v_needle)) * 0.5)::real AS rank,
             public.similarity(m.normalized_search, v_needle) AS sim,
             count(*) OVER () AS total_count
      FROM app.medications m
      WHERE m.is_active IS NOT FALSE
        AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
        AND public.similarity(m.normalized_search, v_needle) >= 0.20
    )
    SELECT h.id, h.raw_name, h.inn, h.brand_name, h.form, h.strength,
           h.normalized_name, h.source, h.rank, h.total_count
    FROM hits h
    ORDER BY h.sim DESC, h.brand_name NULLS LAST, h.inn, h.id
    LIMIT v_limit OFFSET v_offset;
  END IF;
END;
$$;

COMMENT ON FUNCTION app.search_medications_page(text, integer, integer) IS
  'Recherche catalogue paginée (195/197) : préfixe de mot FTS + contenu '
  'littéral, ordre libre, repli approximatif 0,15, total_count. Plafond 100.';

ANALYZE app.medications;

INSERT INTO app.schema_migrations (version) VALUES ('197_recherche_medicaments_infixe')
  ON CONFLICT DO NOTHING;

COMMIT;
