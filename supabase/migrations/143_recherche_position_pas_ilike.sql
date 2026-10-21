-- ═══════════════════════════════════════════════════════════════════════════
-- 143_recherche_position_pas_ilike — le contenu via position(), pas ILIKE.
--
-- ═══ MESURÉ APRÈS 142 (2026-10-08) ═══
-- `pref` (préfixe, btree) : 35-50 ms quand il remplit la limite seul. Mais dès
-- que `pref` rend moins de 50 lignes, `reste` tourne et coûte 200-320 ms, et
-- le pire cas est la frappe sans espoir (« xyzNOP » : 316 ms pour 0 ligne).
-- Par ligne (15 645) : ILIKE `%…%` ~30 µs + `similarity()` ~15 µs.
-- Le GIN trigramme ne sauve rien : ses trigrammes courts (« ane », « e  »)
-- existent dans presque toutes les lignes, le bitmap rend toute la table.
--
-- ═══ L'ÉQUIVALENCE ═══
-- `norm` et l'aiguille sont déjà en minuscules sans accent : sur des chaînes
-- normalisées, `ILIKE '%x%'` (x sans joker) ≡ `position(x IN norm) > 0`, en
-- ~2 µs/ligne au lieu de ~30. MAIS l'aiguille vient de la saisie : un `%` ou
-- `_` tapé y serait un joker ILIKE. On échappe donc l'aiguille pour les motifs
-- LIKE (`\%`, `\_`, `\\`), et `position()` reçoit l'aiguille BRUTE (littérale
-- des deux côtés) : les deux formes coïncident exactement, jokers tapés
-- compris. Le préfixe passe en LIKE (même remarque de casse) : le btree
-- `text_pattern_ops` de 142 s'applique au sens manuel.
-- La branche typo (`%`, pg_trgm) est gardée pour les aiguilles ≥ 5 lettres :
-- en dessous, le seuil 0,3 matche tout et n'apporte que du bruit — et son
-- coût. Classement INCHANGÉ (même formule qu'en 073/141/142).
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
           -- Échappement LIKE de l'aiguille (saisie brute : `%`, `_`, `\`
           -- tapés doivent rester littéraux, cf. en-tête).
           replace(replace(replace(app.immutable_unaccent(lower(trim(coalesce(p_query,'')))), '\', '\\'), '%', '\%'), '_', '\_') AS pat
  ),
  lim AS (SELECT least(greatest(coalesce(p_limit, 20), 1), 50) AS v),
  -- Phase 1 : le préfixe, LIKE + btree pattern_ops couvrant (142) =
  -- Index Only Scan sur quelques dizaines de lignes.
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
  -- Phase 2 : contenu (position(), littéral), typo (trigramme, aiguilles
  -- longues), DCI/marque (colonne générée 142). Seulement si `pref` n'a pas
  -- rempli la limite.
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
             CASE WHEN position((SELECT needle FROM q) IN m.normalized_search) > 0 THEN 0.2
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
      AND m.normalized_search NOT LIKE (SELECT pat FROM q) || '%'
      AND (
        position((SELECT needle FROM q) IN m.normalized_search) > 0
        OR (char_length((SELECT needle FROM q)) >= 5 AND m.normalized_search % (SELECT needle FROM q))
        OR position((SELECT needle FROM q) IN m.brand_inn_search) > 0
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
  '143 : contenu via position() littéral (équivalent ILIKE sur chaînes normalisées, aiguille échappée), '
  'typo réservée aux aiguilles ≥ 5 lettres — classement inchangé.';

ANALYZE app.medications;

INSERT INTO app.schema_migrations (version) VALUES ('143_recherche_position_pas_ilike')
  ON CONFLICT DO NOTHING;

COMMIT;
