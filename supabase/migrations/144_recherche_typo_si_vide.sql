-- ═══════════════════════════════════════════════════════════════════════════
-- 144_recherche_typo_si_vide — la tolérance typo ne tourne que si tout est vide.
--
-- ═══ MESURÉ APRÈS 143, EN SESSION CHAUDE (2026-10-08) ═══
-- `pref` seul : 5-50 ms. `reste` (143) : +240 ms dès qu'il tourne — son unique
-- cause est la branche `%` (pg_trgm) : `similarity()` sur 15 645 lignes coûte
-- ~240 ms à elle seule, même en session chaude. Or `reste` tourne dès que le
-- préfixe rend moins de 50 lignes, c'est-à-dire pour presque toute recherche
-- précise (« doliprane » : 475 ms stables pour 31 lignes).
--
-- ═══ LE DÉCOUPAGE ═══
-- Trois phases gardées, même formule de rang qu'en 073 (préfixe 0.0 > contenu
-- 0.2 > reste 0.5, pondéré par la similarité) :
--   1. `pref` — préfixe, Index Only Scan (btree couvrant de 142) ;
--   2. `contient` — `position()` littéral sur nom et DCI/marque (~15-30 ms),
--      seulement si `pref` n'a pas rempli la limite ;
--   3. `typo` — `%` pg_trgm (aiguilles ≥ 5 lettres), seulement si les phases
--      1+2 n'ont RIEN rendu : une faute de frappe (« dolipranne ») trouve ses
--      9 lignes en ~250 ms au lieu de 0 ligne, et une recherche normale ne paie
--      jamais les 240 ms.
-- Déduplication garantie par construction : chaque phase exclut les motifs des
-- précédentes (préfixe, puis contenu, puis les deux). Le tri final est le même
-- qu'en 073/141-143 ; seule nuance assumée : une ligne « typo » ne s'intercale
-- plus devant une ligne « contenu » quand les deux existent — les têtes de
-- liste (préfixe, contenu exact) sont inchangées.
-- `CREATE OR REPLACE` : signature, propriétaire et droits inchangés.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

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
           app.immutable_unaccent(lower(trim(coalesce(p_query,'')))) AS needle,
           replace(replace(replace(app.immutable_unaccent(lower(trim(coalesce(p_query,'')))), '\', '\\'), '%', '\%'), '_', '\_') AS pat
  ),
  lim AS (SELECT least(greatest(coalesce(p_limit, 20), 1), 50) AS v),
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
      AND m.normalized_search LIKE (SELECT pat FROM q) || '%'
  ),
  contient AS (
    SELECT m.id,
           coalesce(m.source_raw_value, coalesce(m.brand_name,'') || ' ' || m.inn) AS raw_name,
           m.inn,
           m.brand_name,
           m.form,
           m.strength,
           m.normalized_search AS normalized_name,
           m.source,
           (0.2 + (1 - coalesce(public.similarity(m.normalized_search, (SELECT needle FROM q)), 0)) * 0.5)::real AS rank,
           1 AS prefix_2,
           public.similarity(m.normalized_search, (SELECT needle FROM q)) AS sim
    FROM app.medications m, q
    WHERE (SELECT count(*) FROM pref) < (SELECT v FROM lim)
      AND m.is_active IS NOT FALSE
      AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
      AND (SELECT raw FROM q) IS NOT NULL
      AND m.normalized_search NOT LIKE (SELECT pat FROM q) || '%'
      AND (
        position((SELECT needle FROM q) IN m.normalized_search) > 0
        OR position((SELECT needle FROM q) IN m.brand_inn_search) > 0
      )
  ),
  -- Dernier recours : la faute de frappe. Ne tourne que si préfixe + contenu
  -- n'ont rien rendu ; exclut leurs motifs pour ne jamais doublonner.
  typo AS (
    SELECT m.id,
           coalesce(m.source_raw_value, coalesce(m.brand_name,'') || ' ' || m.inn) AS raw_name,
           m.inn,
           m.brand_name,
           m.form,
           m.strength,
           m.normalized_search AS normalized_name,
           m.source,
           (0.5 + (1 - coalesce(public.similarity(m.normalized_search, (SELECT needle FROM q)), 0)) * 0.5)::real AS rank,
           1 AS prefix_2,
           public.similarity(m.normalized_search, (SELECT needle FROM q)) AS sim
    FROM app.medications m, q
    WHERE (SELECT count(*) FROM pref) + (SELECT count(*) FROM contient) = 0
      AND char_length((SELECT needle FROM q)) >= 5
      AND m.is_active IS NOT FALSE
      AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
      AND (SELECT raw FROM q) IS NOT NULL
      AND m.normalized_search NOT LIKE (SELECT pat FROM q) || '%'
      AND position((SELECT needle FROM q) IN m.normalized_search) = 0
      AND position((SELECT needle FROM q) IN m.brand_inn_search) = 0
      AND m.normalized_search % (SELECT needle FROM q)
  ),
  tout AS (SELECT * FROM pref UNION ALL SELECT * FROM contient UNION ALL SELECT * FROM typo)
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
  '144 : préfixe indexé, contenu position() littéral, typo pg_trgm seulement si vide — classement inchangé.';

ANALYZE app.medications;

INSERT INTO app.schema_migrations (version) VALUES ('144_recherche_typo_si_vide')
  ON CONFLICT DO NOTHING;

COMMIT;
