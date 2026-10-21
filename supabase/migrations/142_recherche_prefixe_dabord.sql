-- ═══════════════════════════════════════════════════════════════════════════
-- 142_recherche_prefixe_dabord — le préfixe d'abord, en index-only.
--
-- ═══ POURQUOI 141 N'A PAS SUFFI (MESURÉ, 2026-10-08) ═══
-- Après 141, `search_medications('doliprane')` restait à ~1 s. Diagnostic :
--   - un ILIKE `%…%` coûte ~30 µs/ligne et `similarity()` ~15 µs/ligne ;
--     × 15 645 lignes = ~1 s, même sur colonnes nues ;
--   - le GIN trigramme ne filtre pas : le bitmap rendait les 15 645 lignes
--     (re-vérification sur le tas, 627 blocs lus — lent sur le volume Docker) ;
--   - la 4e branche (DCI/marque) payait `immutable_unaccent(lower())` par ligne.
-- Le plan le plus rapide n'est pas un meilleur filtre, c'est MOINS DE LIGNES
-- TOUCHÉES : une recherche qui tape « dol » veut les préfixes — quelques
-- dizaines de lignes via un btree, sans toucher au tas.
--
-- ═══ CE QUE FAIT CETTE MIGRATION ═══
-- 1. Colonne générée `brand_inn_search` (forme normalisée DCI+marque, calculée
--    par la base à l'écriture — le motif `search_text` de 141) : la 4e branche
--    ne recompute plus rien par ligne. Élargissement documenté : une ligne dont
--    la DCI est NULL mais la marque correspond devient trouvable (avant, le
--    `NULL` tuait la concaténation et la ligne était invisible).
-- 2. Deux btree `text_pattern_ops` COUVRANTS (`INCLUDE` : toutes les colonnes
--    rendues) : la phase préfixe est un Index Only Scan — aucun accès au tas,
--    rapide même à froid.
-- 3. `search_medications` en DEUX PHASES, classement INCHANGÉ :
--    `pref` (préfixe, indexé) puis `reste` (contenu/trigramme/DCI, seulement si
--    `pref` n'a pas rempli la limite — garde par sous-requête scalaire) ;
--    tri final et limite identiques à 073/141. `CREATE OR REPLACE` : signature,
--    propriétaire et droits inchangés.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE app.medications
  ADD COLUMN IF NOT EXISTS brand_inn_search text
  GENERATED ALWAYS AS (app.immutable_unaccent(lower(coalesce(brand_name,'') || ' ' || coalesce(inn,'')))) STORED;

COMMENT ON COLUMN app.medications.brand_inn_search IS
  'Forme normalisée DCI+marque pour la 4e branche de recherche (142). Calculée '
  'par la base à chaque écriture — jamais recomputée par ligne et par appel.';

DROP INDEX IF EXISTS medications_norm_pref_cov;
CREATE INDEX medications_norm_pref_cov ON app.medications (normalized_search text_pattern_ops)
  INCLUDE (source_raw_value, inn, brand_name, form, strength, source, cabinet_id, is_active)
  WHERE normalized_search IS NOT NULL;

DROP INDEX IF EXISTS medications_brand_pref_cov;
CREATE INDEX medications_brand_pref_cov ON app.medications (brand_inn_search text_pattern_ops)
  INCLUDE (source_raw_value, inn, brand_name, form, strength, source, cabinet_id, is_active)
  WHERE brand_inn_search IS NOT NULL;

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
  lim AS (SELECT least(greatest(coalesce(p_limit, 20), 1), 50) AS v),
  -- Phase 1 : le préfixe. `ILIKE 'aiguille%'` + btree `text_pattern_ops` =
  -- Index (Only) Scan sur quelques dizaines de lignes. Couvre ~toutes les
  -- frappes au fil de l'eau (« dol », « amox », « para »).
  pref AS (
    SELECT m.id,
           coalesce(m.source_raw_value, coalesce(m.brand_name,'') || ' ' || m.inn) AS raw_name,
           m.inn,
           m.brand_name,
           m.form,
           m.strength,
           m.normalized_search AS normalized_name,
           m.source,
           (0.0 + (1 - coalesce(public.similarity(m.normalized_search, (SELECT needle FROM q)), 0)) * 0.5)::real AS rank,
           0 AS prefix_2,
           public.similarity(m.normalized_search, (SELECT needle FROM q)) AS sim
    FROM app.medications m, q
    WHERE m.is_active IS NOT FALSE
      AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
      AND (SELECT raw FROM q) IS NOT NULL
      AND m.normalized_search ILIKE (SELECT needle FROM q) || '%'
  ),
  -- Phase 2 : contenu, typo, DCI/marque. Ne tourne que si `pref` n'a pas
  -- rempli la limite : la sous-requête scalaire est évaluée une fois, et un
  -- faux y court-circuite le reste du WHERE ligne par ligne.
  reste AS (
    SELECT m.id,
           coalesce(m.source_raw_value, coalesce(m.brand_name,'') || ' ' || m.inn) AS raw_name,
           m.inn,
           m.brand_name,
           m.form,
           m.strength,
           m.normalized_search AS normalized_name,
           m.source,
           (
             CASE WHEN m.normalized_search ILIKE '%' || (SELECT needle FROM q) || '%' THEN 0.2
                  ELSE 0.5 END
             + (1 - coalesce(public.similarity(m.normalized_search, (SELECT needle FROM q)), 0)) * 0.5
           )::real AS rank,
           1 AS prefix_2,
           public.similarity(m.normalized_search, (SELECT needle FROM q)) AS sim
    FROM app.medications m, q
    WHERE (SELECT count(*) FROM pref) < (SELECT v FROM lim)
      AND m.is_active IS NOT FALSE
      AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
      AND (SELECT raw FROM q) IS NOT NULL
      AND m.normalized_search NOT ILIKE (SELECT needle FROM q) || '%'
      AND (
        m.normalized_search ILIKE '%' || (SELECT needle FROM q) || '%'
        OR m.normalized_search % (SELECT needle FROM q)
        OR m.brand_inn_search ILIKE '%' || (SELECT needle FROM q) || '%'
      )
  ),
  tout AS (SELECT * FROM pref UNION ALL SELECT * FROM reste)
  SELECT id, raw_name, inn, brand_name, form, strength, normalized_name, source, rank
  FROM tout
  ORDER BY rank ASC,
           prefix_2,
           sim DESC,
           brand_name NULLS LAST, inn
  LIMIT (SELECT v FROM lim);
$$;

COMMENT ON FUNCTION app.search_medications(text, integer) IS
  'Recherche catalogue côté base (accent/casse/prefix/typo). Jamais 15k lignes en React. '
  '142 : préfixe d''abord en Index Only Scan (btree pattern_ops couvrant), repli contenu/trigramme/DCI — classement inchangé.';

ANALYZE app.medications;
ANALYZE app.patients;

INSERT INTO app.schema_migrations (version) VALUES ('142_recherche_prefixe_dabord')
  ON CONFLICT DO NOTHING;

COMMIT;
