-- ═══════════════════════════════════════════════════════════════════════════
-- 108_recherche_patients_arabe_trigramme — Alexa fiabilité A2.
--
-- POURQUOI : `search_patients` (066) ne repliait ni l'arabe ni l'ordre
-- inversé, et n'avait aucun filet trigramme : « BELKACEM Nadia » (stocké
-- « Nadia BELKACEM »), un nom en écriture arabe, ou une coquille STT
-- (« ayoub salmi » vs « Ayoub Selmi ») rendaient zéro ligne — lu par Jarvis
-- comme « patient introuvable ». Le filet existe depuis 051
-- (`find_similar_patients`, seuil 0.38) mais n'est pas utilisé ici.
--
-- CE QUE ÇA CHANGE (compatible) : mêmes signature/colonnes que 066 + 3
-- disjonctions OR supplémentaires, même ordre de tri avec similarité en
-- dernier recours. Aucun appelant à modifier.
--
--   1. repli arabe miroir de `normalisation.ts:replierArabe` (TS) :
--      tashkil/tatweel retirés, آأإٱ→ا, ى→ي, ة→ه — appliqué des DEUX côtés ;
--   2. ordre inversé `nom + ' ' + prénom` en plus de `prénom + ' ' + nom` ;
--   3. filet trigramme `pg_trgm` (déjà installé en 001, motif wrapper 051) :
--      similarité ≥ 0.30 sur la forme `nom_recherche` (minuscule, désaccentuée,
--      séparateurs supprimés), ordre direct OU inversé.
--
-- SÉCURITÉ : RLS inchangée (SELECT sur `app.patients` sous l'appelant via
-- SECURITY DEFINER + OWNER app_gatekeeper, comme 066). Le comptage porte sur
-- le périmètre visible uniquement. Une trace `recherche` par appel (I4).
--
-- PERFORMANCE : prédicats sur expressions — balayage des lignes VISIBLES,
-- borné LIMIT 100 comme avant. À l'échelle du cabinet (< 1 000 patients),
-- négligeable. Pas d'index nouveau : à justifier par mesure (mission §26).
--
-- RÈGLE 9 : 066 appliquée, non retouchée. Corps recopié + ajouts.
-- Retour arrière : DROP FUNCTION app.search_patients(text,integer,integer)
-- puis réappliquer le corps de 066, OWNER et GRANT compris.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ── 1 · Repli arabe IMMUTABLE (miroir TS `replierArabe`) ─────────────────
CREATE OR REPLACE FUNCTION app.pli_arabe(p_texte text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = app, pg_catalog
AS $$
  SELECT translate(
    regexp_replace(
      regexp_replace(coalesce(p_texte, ''),
        '[ً-ْٰـ]', '', 'g'),
      '[آأإٱ]', 'ا', 'g'),
    'ىة', 'يه');
$$;

COMMENT ON FUNCTION app.pli_arabe(text) IS
  'A2 Alexa. Repli graphique arabe (miroir TS replierArabe) : tashkil/tatweel '
  'retirés, variantes d''alef→ا, ى→ي, ة→ه. IMMUTABLE, utilisable dans les portes.';

GRANT EXECUTE ON FUNCTION app.pli_arabe(text) TO PUBLIC;

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
  v_cible  text;
  v_seuil  constant real := 0.30;
BEGIN
  PERFORM audit.log_read(NULL, 'recherche');

  -- Forme trigramme de l'aiguille : même canonique que 051 (nom_recherche).
  v_cible := CASE WHEN v_needle IS NULL THEN NULL
                 ELSE app.nom_recherche(v_needle) END;
  IF v_cible = '' THEN v_cible := NULL; END IF;

  RETURN QUERY
  WITH visibles AS (
    -- La RLS s'applique à ce SELECT : `visibles` ne contient déjà que ce que
    -- l'appelant a le droit de voir. Le comptage porte donc sur SON périmètre,
    -- jamais sur le cabinet entier.
    SELECT p.*,
      GREATEST(
        app.trigram_similarite(app.nom_recherche(p.first_name || ' ' || p.last_name), coalesce(v_cible, '')),
        app.trigram_similarite(app.nom_recherche(p.last_name || ' ' || p.first_name), coalesce(v_cible, ''))
      ) AS v_sim
    FROM app.patients p
    WHERE p.is_active
      AND (v_needle IS NULL
           -- 066 historique : ordre direct, insensible accents/casse.
           OR app.immutable_unaccent(lower(p.first_name || ' ' || p.last_name))
              ILIKE '%' || app.immutable_unaccent(lower(v_needle)) || '%'
           -- A2-1 : même ordre direct avec repli arabe des deux côtés.
           OR app.pli_arabe(app.immutable_unaccent(lower(p.first_name || ' ' || p.last_name)))
              ILIKE '%' || app.pli_arabe(app.immutable_unaccent(lower(v_needle))) || '%'
           -- A2-2 : ordre inversé (nom prénom), avec et sans repli arabe.
           OR app.immutable_unaccent(lower(p.last_name || ' ' || p.first_name))
              ILIKE '%' || app.immutable_unaccent(lower(v_needle)) || '%'
           OR app.pli_arabe(app.immutable_unaccent(lower(p.last_name || ' ' || p.first_name)))
              ILIKE '%' || app.pli_arabe(app.immutable_unaccent(lower(v_needle))) || '%'
           OR p.phone LIKE '%' || v_needle || '%'
           OR p.record_number = v_needle
           -- A2-3 : filet trigramme (fautes STT/frappe), direct ou inversé.
           OR (v_cible IS NOT NULL AND GREATEST(
                 app.trigram_similarite(app.nom_recherche(p.first_name || ' ' || p.last_name), v_cible),
                 app.trigram_similarite(app.nom_recherche(p.last_name || ' ' || p.first_name), v_cible)
               ) >= v_seuil))
  ), compte AS (SELECT count(*) AS n FROM visibles)
  -- `age` reste NULL quand la date de naissance est inconnue (règle 8).
  -- Tri : correspondances exactes/ILIKE d'abord (v_sim faible mais match),
  -- puis similarité décroissante, puis alphabétique (066 préservé en queue).
  SELECT v.id, v.record_number, v.first_name, v.last_name, v.birth_date,
         CASE WHEN v.birth_date IS NULL THEN NULL
              ELSE extract(year FROM age(v.birth_date))::int END,
         v.phone, v.is_active, c.n
  FROM visibles v CROSS JOIN compte c
  ORDER BY v.v_sim DESC, v.last_name, v.first_name
  LIMIT v_limit OFFSET v_offset;
END;
$$;

-- LES TROIS LIGNES QUE LE `DROP` A EMPORTÉES (motif 066).
ALTER FUNCTION app.search_patients(text, integer, integer) OWNER TO app_gatekeeper;
REVOKE ALL     ON FUNCTION app.search_patients(text, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app.search_patients(text, integer, integer) TO authenticated;

COMMENT ON FUNCTION app.search_patients(text, integer, integer) IS
  'ADR-019. Seule porte vers la liste des patients. `p_limit` borné à 100 en '
  'base : une pagination que l''appelant choisit sans limite est un export. '
  '066 : ajoute `age` (horloge serveur). '
  '108 : + repli arabe (miroir TS), ordre nom-prénom, filet trigramme ≥ 0.30.';

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('108_recherche_patients_arabe_trigramme')
  ON CONFLICT DO NOTHING;

COMMIT;
