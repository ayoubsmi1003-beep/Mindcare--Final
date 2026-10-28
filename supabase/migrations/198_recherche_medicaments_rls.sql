-- ═══════════════════════════════════════════════════════════════════════════
-- 198_recherche_medicaments_rls — l'index FTS est inutilisable sous RLS.
--
-- ═══ MESURÉ ═══
-- `to_tsvector()` et `@@` ne sont pas LEAKPROOF. Sous `FORCE ROW LEVEL
-- SECURITY` (146), le planificateur refuse l'index GIN et retombe sur un
-- Seq Scan qui recalcule `to_tsvector` sur 15 645 lignes : 400–1 600 ms.
-- L'index de 195 ne sert donc à rien pour l'écran (rôle authenticated).
--
-- ═══ CE QUE FAIT 198 ═══
-- 1. Supprime l'index GIN et la fonction de texte de 195 (inutilisés).
-- 2. `search_medications_page` revient à des prédicats LEAKPROOF-compatibles :
--    - préfixe du jeton le plus long sur `normalized_search` / `brand_inn_search`
--      (btree `text_pattern_ops` de 142) ;
--    - filtre « tous les jetons » par `position()` (balayage 15 645 lignes,
--      ~30 ms) ;
--    - union préfixe + contenu, dédupliquée, avec `total_count` ;
--    - repli approximatif inchangé (`troxene` → TRANXENE), mêmes seuils.
-- 3. Signature, droits, wrapper `search_medications`, RLS et pagination
--    inchangés.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP INDEX IF EXISTS app.medications_search_fts;
DROP FUNCTION IF EXISTS app.medication_search_text(text, text);

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

  -- Le jeton le plus long est le meilleur candidat pour l'index préfixe.
  SELECT t INTO v_pivot
  FROM unnest(v_tokens) AS t
  ORDER BY length(t) DESC, t
  LIMIT 1;

  -- ═══ Phase 1 — préfixe indexé + contenu, tous les jetons ═══
  RETURN QUERY
  WITH pref AS (
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
           public.similarity(m.normalized_search, v_needle) AS sim
    FROM app.medications m
    WHERE m.is_active IS NOT FALSE
      AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
      AND (
        m.normalized_search LIKE v_pivot || '%'
        OR m.brand_inn_search LIKE v_pivot || '%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(v_tokens) AS t
        WHERE position(t IN coalesce(m.normalized_search, '')) = 0
          AND position(t IN coalesce(m.brand_inn_search, '')) = 0
      )
  ), contenu AS (
    SELECT m.id,
           coalesce(m.source_raw_value, coalesce(m.brand_name, '') || ' ' || m.inn) AS raw_name,
           m.inn,
           m.brand_name,
           m.form,
           m.strength,
           m.normalized_search AS normalized_name,
           m.source,
           3.0::real AS rank,
           public.similarity(m.normalized_search, v_needle) AS sim
    FROM app.medications m
    WHERE m.is_active IS NOT FALSE
      AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
      AND NOT EXISTS (SELECT 1 FROM pref p WHERE p.id = m.id)
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(v_tokens) AS t
        WHERE position(t IN coalesce(m.normalized_search, '')) = 0
          AND position(t IN coalesce(m.brand_inn_search, '')) = 0
      )
  ), hits AS (
    SELECT * FROM pref
    UNION ALL
    SELECT * FROM contenu
  )
  SELECT h.id, h.raw_name, h.inn, h.brand_name, h.form, h.strength,
         h.normalized_name, h.source, h.rank, count(*) OVER () AS total_count
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
  'Recherche catalogue paginée (195/197/198) : préfixe indexé du jeton le plus '
  'long + contenu de tous les jetons, ordre libre, repli approximatif 0,15, '
  'total_count. Compatible RLS (pas d''index FTS non LEAKPROOF).';

ANALYZE app.medications;

INSERT INTO app.schema_migrations (version) VALUES ('198_recherche_medicaments_rls')
  ON CONFLICT DO NOTHING;

COMMIT;
