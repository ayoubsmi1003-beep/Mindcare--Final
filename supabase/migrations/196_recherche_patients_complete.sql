-- ═══════════════════════════════════════════════════════════════════════════
-- 196_recherche_patients_complete — tous les dossiers atteignables, nom dans
-- n'importe quel ordre.
--
-- ═══ CE QUI ÉTAIT CASSÉ (MESURÉ LE 2026-10-28) ═══
-- 141 avait recopié le corps de 066 et perdu, sans le dire, les apports de 108 :
-- repli arabe, ordre « nom prénom », filet trigramme ordonné. Résultat : un nom
-- tapé dans l'ordre de l'écran (« Benali Ahmed ») ne matchait que par similarité
-- globale, sans classement ; et un nom arabe avec variantes (ى/ي, ة/ه) pouvait
-- rendre zéro. La liste, elle, n'affichait que 25 lignes sur 1 558 sans aucun
-- contrôle de page.
--
-- ═══ CE QUE FAIT CETTE MIGRATION ═══
-- 1. Correspondance par JETONS : chaque jeton de la saisie doit apparaître dans
--    `search_text` (prénom + nom normalisés) — l'ordre de frappe ne compte
--    plus, et les deux ordres « prénom nom » / « nom prénom » coïncident.
-- 2. Classement : tous les jetons en début de mot > préfixe complet > préfixe
--    du premier jeton > sous-chaîne. Le bon dossier remonte au lieu d'être
--    noyé dans l'ordre alphabétique.
-- 3. Téléphone : chiffres seuls, `+213` ramené à `0`, espaces ignorés.
-- 4. Repli arabe (miroir 108) et repli trigramme seulement si le principal ne
--    rend rien — le chemin courant ne paie plus la similarité sur chaque ligne.
-- 5. Signature, RLS, audit (`recherche`), plafond 100 et `total_count`
--    inchangés. 141/145 ne sont pas modifiées : corps neuf, mêmes droits.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION app.search_patients(
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
  v_limit   integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_needle  text    := nullif(trim(coalesce(p_query, '')), '');
  v_aiguille text;
  v_tokens  text[];
  v_digits  text;
BEGIN
  -- Une trace par appel, comme depuis 017. Le debounce de l'écran regroupe
  -- les frappes ; la porte ne devine jamais une intention.
  PERFORM audit.log_read(NULL, 'recherche');

  IF v_needle IS NULL THEN
    RETURN QUERY
    SELECT p.id, p.record_number, p.first_name, p.last_name, p.birth_date,
           CASE WHEN p.birth_date IS NULL THEN NULL
                ELSE extract(year FROM age(p.birth_date))::int END,
           p.phone, p.is_active, count(*) OVER () AS total_count
    FROM app.patients p
    WHERE p.is_active
    ORDER BY p.last_name, p.first_name
    LIMIT v_limit OFFSET v_offset;
    RETURN;
  END IF;

  v_aiguille := app.immutable_unaccent(lower(v_needle));
  v_tokens := ARRAY(
    SELECT t
    FROM unnest(regexp_split_to_array(v_aiguille, '[^[:alnum:]]+')) AS t
    WHERE t <> ''
    LIMIT 6
  );

  -- « +213 555 12 34 56 » et « 0555 12 34 56 » désignent le même numéro.
  v_digits := regexp_replace(v_needle, '\D', '', 'g');
  IF left(v_digits, 3) = '213' THEN
    v_digits := '0' || substr(v_digits, 4);
  END IF;

  -- ═══ Phase 1 — jetons, ordre libre ═══
  IF coalesce(cardinality(v_tokens), 0) > 0 THEN
    RETURN QUERY
    WITH base AS (
      SELECT p.*,
             cardinality(v_tokens) AS ntok,
             (SELECT count(*)
              FROM unnest(v_tokens) AS t
              WHERE (length(t) >= 2 AND position(t IN p.search_text) > 0)
                 OR (length(t) = 1 AND (
                      p.search_text LIKE t || '%'
                      OR p.search_text LIKE '% ' || t || '%'
                    ))) AS matched,
             (SELECT count(*)
              FROM unnest(v_tokens) AS t
              WHERE p.search_text LIKE t || '%'
                 OR p.search_text LIKE '% ' || t || '%') AS starts
      FROM app.patients p
      WHERE p.is_active
    ), visibles AS (
      SELECT b.*,
             CASE WHEN b.starts = b.ntok THEN 0
                  WHEN b.search_text LIKE v_aiguille || '%' THEN 1
                  WHEN b.search_text LIKE v_tokens[1] || '%' THEN 2
                  ELSE 3 END AS score
      FROM base b
      WHERE b.matched = b.ntok
         OR (length(v_digits) >= 4
             AND regexp_replace(b.phone, '\D', '', 'g') LIKE '%' || v_digits || '%')
         OR b.record_number ILIKE v_needle || '%'
    ), compte AS (SELECT count(*) AS n FROM visibles)
    SELECT v.id, v.record_number, v.first_name, v.last_name, v.birth_date,
           CASE WHEN v.birth_date IS NULL THEN NULL
                ELSE extract(year FROM age(v.birth_date))::int END,
           v.phone, v.is_active, c.n
    FROM visibles v CROSS JOIN compte c
    ORDER BY v.score, v.last_name, v.first_name
    LIMIT v_limit OFFSET v_offset;

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  -- ═══ Phase 2 — repli arabe (108) + trigramme, seulement si vide ═══
  RETURN QUERY
  WITH visibles AS (
    SELECT p.*,
           GREATEST(
             coalesce(public.similarity(p.search_text, v_aiguille), 0),
             CASE WHEN app.pli_arabe(p.search_text)
                       LIKE '%' || app.pli_arabe(v_aiguille) || '%'
                  THEN 1 ELSE 0 END
           ) AS sim
    FROM app.patients p
    WHERE p.is_active
      AND (
        app.pli_arabe(p.search_text) LIKE '%' || app.pli_arabe(v_aiguille) || '%'
        OR p.search_text OPERATOR(public.%) v_aiguille
        OR (length(v_digits) >= 4
            AND regexp_replace(p.phone, '\D', '', 'g') LIKE '%' || v_digits || '%')
        OR p.record_number ILIKE v_needle || '%'
      )
  ), compte AS (SELECT count(*) AS n FROM visibles)
  SELECT v.id, v.record_number, v.first_name, v.last_name, v.birth_date,
         CASE WHEN v.birth_date IS NULL THEN NULL
              ELSE extract(year FROM age(v.birth_date))::int END,
         v.phone, v.is_active, c.n
  FROM visibles v CROSS JOIN compte c
  ORDER BY v.sim DESC, v.last_name, v.first_name
  LIMIT v_limit OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION app.search_patients(text, integer, integer) IS
  'ADR-019. Seule porte vers la liste des patients. `p_limit` borné à 100 en '
  'base : une pagination que l''appelant choisit sans limite est un export. '
  '196 : jetons ordre-libre (nom/prénom), téléphone +213, repli arabe 108 et '
  'trigramme seulement si vide ; total_count et audit inchangés.';

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('196_recherche_patients_complete')
  ON CONFLICT DO NOTHING;

COMMIT;
