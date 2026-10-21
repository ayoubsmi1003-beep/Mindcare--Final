-- ═══════════════════════════════════════════════════════════════════════════
-- 141_recherche_instantanee — la recherche médicament/patient en <100 ms.
--
-- ═══ LE DÉFAUT MESURÉ ═══
-- `app.search_medications('doliprane', 50)` : ~1 300 ms par appel sur 15 645
-- lignes (EXPLAIN ANALYZE, 2026-10-08), AVANT le round-trip HTTP
-- (`services/db/http.ts`) et le debounce 200 ms de la palette. Ressenti : ~2 s
-- par frappe. Cause : chaque prédicat enveloppait la colonne indexée dans
-- `coalesce(normalized_search, immutable_unaccent(lower(...)))` — l'index GIN
-- trigramme de 073 devenait inutilisable — puis calculait `similarity()` DEUX
-- fois par ligne (SELECT + ORDER BY) et `immutable_unaccent(lower())` à chaque
-- comparaison. `app.search_patients` (066) avait le même motif sur
-- `first_name || ' ' || last_name` (calculé par ligne, aucun index).
--
-- ═══ CE QUE CHANGE CETTE MIGRATION ═══
-- 1. `search_medications` : prédicats sur la colonne NUE `normalized_search`
--    (l'index GIN trigramme s'applique : opérateur `%`, ILIKE préfixe et
--    ILIKE `%…%`) ; le rang est calculé UNE fois dans une sous-requête.
--    Sémantique de classement INCHANGÉE (préfixe 0.0 > contenu 0.2 > reste 0.5,
--    pondéré par la similarité). `CREATE OR REPLACE` : signature, propriétaire
--    et droits inchangés.
-- 2. `search_patients` : nouvelle colonne GÉNÉRÉE `search_text`
--    (`immutable_unaccent(lower(prénom + nom))`, recalculée par la base à
--    chaque écriture — jamais par le poste) + index GIN trigramme ; le corps
--    est RECOPIÉ de 066 à l'identique sauf le prédicat de nom. Audit
--    (`audit.log_read`), RLS (SECURITY DEFINER + `app_gatekeeper`), pagination
--    bornée à 100, colonne `age` : INCHANGÉS.
--
-- ═══ POURQUOI UN `DROP` POUR search_patients ═══
-- Même règle que 066 : la signature ne change pas ici, mais le `DROP`
-- garantit un corps neuf (pas de résidu d'une version intermédiaire) ; il
-- emporte propriétaire et droits, qui sont REPOSÉS dans la même transaction
-- (OWNER `app_gatekeeper`, REVOKE PUBLIC, GRANT authenticated). GRANT CREATE
-- ON SCHEMA app accordé avant, RETIRÉ après (motif 065/066).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Filet : aucune ligne sans forme normalisée (0 ligne le 2026-10-08).
-- ---------------------------------------------------------------------------
UPDATE app.medications
SET normalized_search = app.immutable_unaccent(lower(trim(source_raw_value)))
WHERE normalized_search IS NULL
  AND source_raw_value IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. search_medications — prédicats nus, rang calculé une fois.
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
  lim AS (SELECT least(greatest(coalesce(p_limit, 20), 1), 50) AS v),
  cand AS (
    -- Prédicats sur la colonne NUE : l'index GIN trigramme de 073
    -- (medications_normalized_search_trgm) couvre `%`, ILIKE préfixe et
    -- ILIKE `%…%`. La 4e branche (DCI/marque) garde son expression.
    SELECT m.id,
           coalesce(m.source_raw_value, coalesce(m.brand_name,'') || ' ' || m.inn) AS raw_name,
           m.inn,
           m.brand_name,
           m.form,
           m.strength,
           m.normalized_search AS normalized_name,
           m.source,
           m.normalized_search AS norm
    FROM app.medications m, q, lim
    WHERE m.is_active IS NOT FALSE
      AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
      AND (SELECT raw FROM q) IS NOT NULL
      AND (
        m.normalized_search ILIKE (SELECT needle FROM q) || '%'
        OR m.normalized_search ILIKE '%' || (SELECT needle FROM q) || '%'
        OR m.normalized_search % (SELECT needle FROM q)
        OR app.immutable_unaccent(lower(coalesce(m.brand_name,'') || ' ' || m.inn)) ILIKE '%' || (SELECT needle FROM q) || '%'
      )
  ),
  ranked AS (
    -- `norm` est déjà la forme normalisée : `similarity()` et les ILIKE ne
    -- recomputent plus `immutable_unaccent(lower())` par ligne.
    SELECT c.*,
      (
        CASE WHEN c.norm ILIKE (SELECT needle FROM q) || '%' THEN 0.0
             WHEN c.norm ILIKE '%' || (SELECT needle FROM q) || '%' THEN 0.2
             ELSE 0.5 END
        + (1 - coalesce(public.similarity(c.norm, (SELECT needle FROM q)), 0)) * 0.5
      )::real AS rank,
      CASE WHEN c.norm ILIKE (SELECT needle FROM q) || '%' THEN 0 ELSE 1 END AS prefix_2,
      public.similarity(c.norm, (SELECT needle FROM q)) AS sim
    FROM cand c, q
  )
  SELECT id, raw_name, inn, brand_name, form, strength, normalized_name, source, rank
  FROM ranked
  ORDER BY rank ASC,
           prefix_2,
           sim DESC,
           brand_name NULLS LAST, inn
  LIMIT (SELECT v FROM lim);
$$;

COMMENT ON FUNCTION app.search_medications(text, integer) IS
  'Recherche catalogue côté base (<100 ms, accent/casse/prefix/typo). Jamais 15k lignes en React. '
  '141 : prédicats sur colonne nue (index GIN trigramme), rang calculé une fois — classement inchangé.';

-- ---------------------------------------------------------------------------
-- 3. search_patients — colonne générée + index, corps 066 sinon inchangé.
-- ---------------------------------------------------------------------------
ALTER TABLE app.patients
  ADD COLUMN IF NOT EXISTS search_text text
  GENERATED ALWAYS AS (app.immutable_unaccent(lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'')))) STORED;

COMMENT ON COLUMN app.patients.search_text IS
  'Forme normalisée prénom+nom pour la recherche (141). Calculée par la base à '
  'chaque écriture — jamais par l''horloge ni le code du poste.';

CREATE INDEX IF NOT EXISTS patients_search_text_trgm ON app.patients
  USING gin (search_text gin_trgm_ops);

-- `ALTER FUNCTION … OWNER TO app_gatekeeper` EXIGE que le futur propriétaire
-- ait CREATE sur le schéma. Accordé ici, RETIRÉ en fin de transaction (065).
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

DROP FUNCTION IF EXISTS app.search_patients(text, integer, integer);

CREATE FUNCTION app.search_patients(
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0)
RETURNS TABLE (
  id              uuid,
  record_number   text,
  first_name      text,
  last_name       text,
  birth_date      date,
  age             integer,
  phone           text,
  is_active       boolean,
  total_count     bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_limit  integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_needle text    := nullif(trim(coalesce(p_query, '')), '');
  -- Forme normalisée calculée UNE fois (141) : avant, chaque ligne payait
  -- `immutable_unaccent(lower())` dans le WHERE.
  v_aiguille text;
BEGIN
  PERFORM audit.log_read(NULL, 'recherche');
  v_aiguille := app.immutable_unaccent(lower(v_needle));

  RETURN QUERY
  WITH visibles AS (
    -- La RLS s'applique à ce SELECT : `visibles` ne contient déjà que ce que
    -- l'appelant a le droit de voir. Le comptage porte donc sur SON périmètre,
    -- jamais sur le cabinet entier — un total global divulguerait la file de
    -- l'autre praticienne sans en montrer une seule ligne.
    SELECT p.* FROM app.patients p
    WHERE p.is_active
      AND (v_needle IS NULL
           OR p.search_text ILIKE '%' || v_aiguille || '%'
           OR p.search_text % v_aiguille
           OR p.phone LIKE '%' || v_needle || '%'
           OR p.record_number = v_needle)
  ), compte AS (SELECT count(*) AS n FROM visibles)
  -- `age` reste NULL quand la date de naissance est inconnue : un écran qui
  -- affiche « 0 ans » invente une donnée (règle 8). L'absence se dit.
  SELECT v.id, v.record_number, v.first_name, v.last_name, v.birth_date,
         CASE WHEN v.birth_date IS NULL THEN NULL
              ELSE extract(year FROM age(v.birth_date))::int END,
         v.phone, v.is_active, c.n
  FROM visibles v CROSS JOIN compte c
  ORDER BY v.last_name, v.first_name
  LIMIT v_limit OFFSET v_offset;
END;
$$;

-- LES TROIS LIGNES QUE LE `DROP` A EMPORTÉES. Voir 066.
ALTER FUNCTION app.search_patients(text, integer, integer) OWNER TO app_gatekeeper;
REVOKE ALL     ON FUNCTION app.search_patients(text, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app.search_patients(text, integer, integer) TO authenticated;

COMMENT ON FUNCTION app.search_patients(text, integer, integer) IS
  'ADR-019. Seule porte vers la liste des patients. `p_limit` borné à 100 en '
  'base : une pagination que l''appelant choisit sans limite est un export. '
  '066 : ajoute `age`, calculé sur l''horloge du serveur — jamais celle du poste. '
  '141 : prédicat de nom sur colonne générée indexée (GIN trigramme) — résultats inchangés.';

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

-- PostgREST met son cache de schéma à jour sur notification (motif 066).
NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('141_recherche_instantanee')
  ON CONFLICT DO NOTHING;

COMMIT;
