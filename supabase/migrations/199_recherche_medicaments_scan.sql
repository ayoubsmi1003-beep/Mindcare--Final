-- ═══════════════════════════════════════════════════════════════════════════
-- 199_recherche_medicaments_scan — un seul balayage, classé.
--
-- 198 scannait deux fois (préfixe + contenu) pour réunir les mêmes lignes :
-- sous RLS, le préfixe `LIKE` ne prend pas l'index et les deux CTE coûtaient
-- ~110 ms. 199 garde les MÊMES résultats (33 « doli », 58 « amox clav »,
-- 4 « troxene ») avec UN balayage de 15 645 lignes et un classement calculé
-- dans la même passe. Le repli approximatif reste inchangé.
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
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_raw    text    := nullif(trim(coalesce(p_query, '')), '');
  v_needle text;
  v_tokens text[];
  v_pivot  text;
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

  SELECT t INTO v_pivot
  FROM unnest(v_tokens) AS t
  ORDER BY length(t) DESC, t
  LIMIT 1;

  -- ═══ Phase 1 — tous les jetons, une seule passe, classement ═══
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
           (CASE WHEN m.normalized_search = v_needle THEN 0.0
                 WHEN m.normalized_search LIKE v_needle || '%' THEN 1.0
                 WHEN m.normalized_search LIKE v_pivot || '%'
                   OR m.brand_inn_search LIKE v_pivot || '%' THEN 2.0
                 ELSE 3.0 END)::real AS rank,
           public.similarity(m.normalized_search, v_needle) AS sim,
           count(*) OVER () AS total_count
    FROM app.medications m
    WHERE m.is_active IS NOT FALSE
      AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(v_tokens) AS t
        WHERE position(t IN coalesce(m.normalized_search, '')) = 0
          AND position(t IN coalesce(m.brand_inn_search, '')) = 0
      )
  )
  SELECT h.id, h.raw_name, h.inn, h.brand_name, h.form, h.strength,
         h.normalized_name, h.source, h.rank, h.total_count
  FROM hits h
  ORDER BY h.rank ASC, h.sim DESC, h.brand_name NULLS LAST, h.inn, h.id
  LIMIT v_limit OFFSET v_offset;

  IF FOUND THEN
    RETURN;
  END IF;

  -- ═══ Phase 2 — faute de frappe sur la fin du nom (« troxene ») ═══
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
        AND (
          m.normalized_search LIKE left(v_pivot, 2) || '%'
          OR m.brand_inn_search LIKE left(v_pivot, 2) || '%'
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
  'Recherche catalogue paginée (195→199) : tous les jetons en une passe, '
  'ordre libre, classement exact/préfixe/contenu, repli approximatif 0,15, '
  'total_count. Compatible RLS.';

ANALYZE app.medications;

INSERT INTO app.schema_migrations (version) VALUES ('199_recherche_medicaments_scan')
  ON CONFLICT DO NOTHING;

COMMIT;
