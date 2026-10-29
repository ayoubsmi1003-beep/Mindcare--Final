-- ═══════════════════════════════════════════════════════════════════════════
-- 195_recherche_medicaments_complete — tous les médicaments atteignables.
--
-- ═══ CE QUI ÉTAIT CASSÉ (MESURÉ LE 2026-10-28 SUR mc-p3) ═══
-- Catalogue : 15 645 lignes actives. La porte plafonnait à 50 et l'ordonnance
-- n'en demandait que 8 : « doli » a 33 correspondances, 25 restaient invisibles.
-- « para » en a 1 050, 1 000 restaient invisibles, sans aucune pagination.
-- Les requêtes multi-mots étaient littérales : « amox clav » rendait 0,
-- « amoxicilline acide clavulanique » 2 (le catalogue écrit « .../acide »).
-- Enfin « troxene » (faute de frappe pour TRANXENE) rendait 0 : similarité
-- 0,238 < seuil 0,30 de la branche typo.
--
-- ═══ CE QUE FAIT CETTE MIGRATION ═══
-- 1. Index GIN d'expression sur le texte de recherche normalisé (séparateurs
--    remplacés par des espaces) — l'ordre des mots et « / » ne comptent plus.
-- 2. `search_medications_page(query, limit, offset)` : correspondance par
--    préfixes de mots (FTS `simple`, `mot:*`), classement exact > préfixe >
--    jeton, repli sous-chaîne puis repli approximatif (similarité ≥ 0,15 sur
--    les 2 premières lettres), `total_count` pour la pagination.
-- 3. `search_medications` reste une enveloppe 2-arguments : signature, droits
--    et appelants inchangés.
-- 4. Plafond de page : 100 (le plafond de `search_patients`). L'écran demande
--    50 et « Afficher plus » avance par offset — jamais 15 000 lignes en React.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Texte de recherche canonique, partagé par l'index et la porte.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.medication_search_text(p_normalized text, p_brand_inn text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT regexp_replace(
    coalesce(p_normalized, '') || ' ' || coalesce(p_brand_inn, ''),
    '[^[:alnum:]]+', ' ', 'g'
  );
$$;

COMMENT ON FUNCTION app.medication_search_text(text, text) IS
  'Forme canonique de recherche médicament (séparateurs → espaces). IMMUTABLE, '
  'partagée par l''index GIN de 195 et la porte search_medications_page.';

-- ---------------------------------------------------------------------------
-- 1. Index FTS — le prédicat indexable de la phase 1.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS medications_search_fts
  ON app.medications
  USING gin (
    to_tsvector(
      'simple',
      app.medication_search_text(normalized_search, brand_inn_search)
    )
  );

-- ---------------------------------------------------------------------------
-- 2. La porte paginée.
-- ---------------------------------------------------------------------------
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

  -- `simple` ne retire aucun mot-outil et ne coupe pas les chiffres : le
  -- catalogue contient « 1000 mg », « 2,4 % », « 1 g/125 mg ».
  v_tsq := to_tsquery(
    'simple',
    array_to_string(
      ARRAY(SELECT t || ':*' FROM unnest(v_tokens) AS t),
      ' & '
    )
  );
  v_debut := left(v_tokens[1], 2);

  -- ═══ Phase 1 — préfixe de mot, ordre libre, index GIN ═══
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
                 ELSE 2.0 END)::real AS rank,
           ts_rank(
             to_tsvector('simple', app.medication_search_text(m.normalized_search, m.brand_inn_search)),
             v_tsq
           ) AS trank,
           count(*) OVER () AS total_count
    FROM app.medications m
    WHERE m.is_active IS NOT FALSE
      AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
      AND to_tsvector('simple', app.medication_search_text(m.normalized_search, m.brand_inn_search)) @@ v_tsq
  )
  SELECT h.id, h.raw_name, h.inn, h.brand_name, h.form, h.strength,
         h.normalized_name, h.source, h.rank, h.total_count
  FROM hits h
  ORDER BY h.rank ASC, h.trank DESC, h.brand_name NULLS LAST, h.inn, h.id
  LIMIT v_limit OFFSET v_offset;

  IF FOUND THEN
    RETURN;
  END IF;

  -- ═══ Phase 2 — sous-chaîne (milieu de mot), position() littéral ═══
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
           (3.0 + (1 - coalesce(public.similarity(m.normalized_search, v_needle), 0)) * 0.5)::real AS rank,
           0::real AS trank,
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
  ORDER BY h.rank ASC, h.brand_name NULLS LAST, h.inn, h.id
  LIMIT v_limit OFFSET v_offset;

  IF FOUND THEN
    RETURN;
  END IF;

  -- ═══ Phase 3 — faute de frappe sur la fin du nom (« troxene ») ═══
  -- Le filtre sur les 2 premières lettres garde l'index préfixe et évite un
  -- balayage de similarité sur 15 645 lignes à chaque frappe.
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
    LIMIT least(v_limit, 20) OFFSET v_offset;

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  -- ═══ Phase 4 — faute sur le début (« roliprane ») ═══
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
    LIMIT least(v_limit, 20) OFFSET v_offset;
  END IF;
END;
$$;

COMMENT ON FUNCTION app.search_medications_page(text, integer, integer) IS
  'Recherche catalogue paginée (195) : préfixes de mots FTS (ordre libre, '
  'séparateurs ignorés), repli sous-chaîne, repli approximatif 0,15, total_count. '
  'Plafond 100 par page — jamais 15 000 lignes côté React.';

REVOKE ALL ON FUNCTION app.search_medications_page(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.search_medications_page(text, integer, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Enveloppe historique : même signature, mêmes droits, mêmes appelants.
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
  rank real)
LANGUAGE sql
STABLE
SET search_path = app, public, pg_catalog
AS $$
  SELECT p.id, p.raw_name, p.inn, p.brand_name, p.form, p.strength,
         p.normalized_name, p.source, p.rank
  FROM app.search_medications_page(p_query, p_limit, 0) AS p;
$$;

COMMENT ON FUNCTION app.search_medications(text, integer) IS
  'Enveloppe 2-arguments de app.search_medications_page (195). Conservée pour '
  'les appelants historiques ; la pagination passe par la porte _page.';

ANALYZE app.medications;

INSERT INTO app.schema_migrations (version) VALUES ('195_recherche_medicaments_complete')
  ON CONFLICT DO NOTHING;

COMMIT;
