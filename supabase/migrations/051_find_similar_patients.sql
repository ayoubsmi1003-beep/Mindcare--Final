-- ═══════════════════════════════════════════════════════════════════════════
-- 051_find_similar_patients — détection vivante de doublons à la création.
--
-- POURQUOI CETTE PORTE EXISTE : un patient introuvable devient un doublon de
-- dossier. Les variantes algériennes (Mohammed / Muhammed / M'hamed,
-- Belkacem / Bel Kacem) échappent au ILIKE exact de `search_patients`, qui
-- reste INCHANGÉ (son correctif d'ordre garde la migration 035 réservée).
--
-- ═══ STRATÉGIE — pg_trgm similarity, PAS fuzzystrmatch ═════════════════════
--
--   · `pg_trgm` est DÉJÀ installé (001) et l'index GIN trigram des noms existe
--     depuis 004. Aucune extension nouvelle : la liste de 01-SCHEMA §1 est
--     gelée, et en ajouter une serait une décision de schéma non demandée.
--   · soundex/metaphone (fuzzystrmatch) sont orientés phonétique anglaise et
--     médiocres sur les translittérations arabes ; ils exigeraient un index
--     fonctionnel nouveau pour des résultats moins bons.
--   · La similarité trigramme tolère les transpositions, les séparateurs et
--     les variantes de voyelles — exactement la famille d'écarts visée.
--
-- ⚠️ LOCALISATION DE L'EXTENSION — VÉRIFIÉE SUR L'INSTANCE (2026-08-23) :
--    `pg_trgm` vit dans le schéma **public** (`public.similarity`), pas dans
--    `extensions`. Les portes épinglent leur `search_path = app, audit,
--    pg_catalog` précisément pour interdire le masquage de fonctions (020 §3)
--    : y ajouter `public` rouvrirait cette surface. Le motif du dépôt est donc
--    celui de `app.immutable_unaccent` (001) : un WRAPPER IMMUTABLE dans le
--    schéma app, appel QUALIFIÉ, search_path minimal.
--
-- ═══ LES DEUX FONCTIONS ════════════════════════════════════════════════════
--
--   `app.nom_recherche(text)`  — normalisateur : minuscules → désaccentuation
--       (immutable_unaccent) → suppression des séparateurs et de TOUT espace.
--       « Bel Kacem » ≡ « belkacem », « M'hamed » ≡ « mhamed ». IMMUTABLE
--       STRICT, utilisable dans les requêtes sans barrière de mise en plan.
--
--   `app.find_similar_patients(...)` — la porte. UNE trace `recherche` par
--       appel (I4, même contrat que search_patients) ; limite bornée à 8 EN
--       BASE ; rend au plus huit candidats du SEUL périmètre RLS de l'appelant.
--
--   Chaque ligne porte son SCORE brut (0..1, jamais affiché tel quel :
--   l'écran traduit en raisons lisibles) et trois RAISONS booléennes qui sont
--   la seule chose que l'interface montre :
--       raison_telephone — mêmes 9 derniers chiffres ;
--       raison_nom       — similarité normalisée ≥ seuil, ordre direct OU
--                          inversé (« Benali Karim » vs « Karim Benali ») ;
--       raison_naissance — même date de naissance fournie.
--
-- ═══ LE SEUIL ══════════════════════════════════════════════════════════════
--
--   `v_seuil = 0.38` n'est pas une intuition : il est CALÉ par les fixtures du
--   checkpoint Patients V3, qui exige que Mohamed/Muhammed/M'hamed,
--   Belkacem/Bel Kacem et les homonymes exacts soient trouvés — et qu'un nom
--   franchement différent ne le soit pas. S'il doit bouger, c'est par ces
--   contrôles, jamais à l'œil.
--
-- ═══ PERFORMANCE, ASSUMÉE ══════════════════════════════════════════════════
--
--   Le prédicat OR sur expressions calculées ne peut pas prendre l'index GIN :
--   c'est un balayage des lignes VISIBLES de l'appelant, borné LIMIT 8. À
--   l'échelle réelle du cabinet (PERF §4 : « moins de 1 000 patients »), ce
--   coût est négligeable face à l'aller-retour réseau. Un index d'expression
--   sera justifié par une mesure, pas par l'inquiétude.
--
-- ═══ RETOUR ARRIÈRE (documentation, jamais exécuté automatiquement) ════════
--
--   DROP FUNCTION IF EXISTS app.find_similar_patients(text,text,text,date,integer);
--   DROP FUNCTION IF EXISTS app.trigram_similarite(text,text);
--   DROP FUNCTION IF EXISTS app.nom_recherche(text);

BEGIN;

-- Transfert de propriété : `app_gatekeeper` doit porter CREATE sur le schéma
-- AU MOMENT de l'ALTER OWNER (020 §3, rappel 030 §1). Sans ces deux lignes,
-- l'ALTER échoue en « permission denied for schema app » — constaté à
-- l'application de cette migration : 050 avait refermé le privilège après son
-- propre transfert. On rouvre, on transfère, on referme (§5).
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 1 · Normalisateur de nom — le socle partagé avec la garde dure de 050
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.nom_recherche(p_saisie text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = app, pg_catalog
AS $$
  SELECT regexp_replace(
           regexp_replace(
             app.immutable_unaccent(lower(p_saisie)),
             '[''’ʼ\-\.,;:!?]', '', 'g'),
           '\s+', '', 'g');
$$;

COMMENT ON FUNCTION app.nom_recherche(text) IS
  'Patients V3. Forme canonique de comparaison des noms : minuscules, '
  'désaccentuée, séparateurs et espaces supprimés. Utilisée par la garde de '
  'doublon de create_patient et par find_similar_patients.';

-- ---------------------------------------------------------------------------
-- 2 · Wrapper qualifié — public.similarity, vérifié sur l'instance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.trigram_similarite(p_a text, p_b text)
RETURNS real
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = app, pg_catalog
AS $$
  SELECT public.similarity(p_a, p_b);
$$;

COMMENT ON FUNCTION app.trigram_similarite(text,text) IS
  'Patients V3. Accès qualifié à public.similarity (pg_trgm) depuis les portes '
  'dont le search_path est épinglé — même motif qu''app.immutable_unaccent (001).';

GRANT EXECUTE ON FUNCTION app.nom_recherche(text)        TO PUBLIC;
REVOKE ALL ON FUNCTION app.trigram_similarite(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.trigram_similarite(text,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · La porte
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.find_similar_patients(
  p_prenom    text DEFAULT NULL,
  p_nom       text DEFAULT NULL,
  p_telephone text DEFAULT NULL,
  p_naissance date DEFAULT NULL,
  p_limit     integer DEFAULT 8)
RETURNS TABLE (
  id               uuid,
  record_number    text,
  first_name       text,
  last_name        text,
  birth_date       date,
  phone            text,
  is_active        boolean,
  score            real,
  raison_nom       boolean,
  raison_telephone boolean,
  raison_naissance boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_limite       integer := least(greatest(coalesce(p_limit, 8), 1), 8);
  v_cible        text;
  v_tel_chiffres text;
  -- Calé par les fixtures du checkpoint V3 — voir l'en-tête. Ne pas retoucher
  -- à l'œil.
  v_seuil        constant real := 0.38;
BEGIN
  -- I4 : une trace par appel, AVANT la lecture, même transaction. L'appel est
  -- débounced côté écran (300 ms) : chaque frappe ne doit pas écrire une trace.
  PERFORM audit.log_read(NULL, 'recherche');

  v_cible := nullif(
    app.nom_recherche(coalesce(p_prenom, '') || ' ' || coalesce(p_nom, '')), '');
  -- Le téléphone n'est un signal qu'à partir de 6 chiffres : un préfixe plus
  -- court correspondrait à une fraction de la base entière.
  v_tel_chiffres := nullif(regexp_replace(coalesce(p_telephone, ''), '[^0-9]', '', 'g'), '');
  IF v_tel_chiffres IS NOT NULL AND length(v_tel_chiffres) < 6 THEN
    v_tel_chiffres := NULL;
  END IF;

  RETURN QUERY
  WITH candidats AS (
    SELECT p.id,
           p.record_number,
           p.first_name,
           p.last_name,
           p.birth_date,
           p.phone,
           p.is_active,
           GREATEST(
             CASE WHEN v_cible IS NULL THEN 0::real ELSE
               app.trigram_similarite(app.nom_recherche(p.first_name || ' ' || p.last_name), v_cible)
             END,
             CASE WHEN v_cible IS NULL THEN 0::real ELSE
               app.trigram_similarite(app.nom_recherche(p.last_name || ' ' || p.first_name), v_cible)
             END) AS v_score,
           (v_tel_chiffres IS NOT NULL AND right(regexp_replace(p.phone, '[^0-9]', '', 'g'),
                length(v_tel_chiffres)) = v_tel_chiffres) AS v_tel_match
    FROM app.patients p
    WHERE p.is_active
      AND (
        (v_cible IS NOT NULL AND GREATEST(
           CASE WHEN v_cible IS NULL THEN 0::real ELSE
             app.trigram_similarite(app.nom_recherche(p.first_name || ' ' || p.last_name), v_cible)
           END,
           CASE WHEN v_cible IS NULL THEN 0::real ELSE
             app.trigram_similarite(app.nom_recherche(p.last_name || ' ' || p.first_name), v_cible)
           END) >= v_seuil)
        OR
        (v_tel_chiffres IS NOT NULL AND right(regexp_replace(p.phone, '[^0-9]', '', 'g'),
             length(v_tel_chiffres)) = v_tel_chiffres)
      )
  )
  SELECT c.id, c.record_number, c.first_name, c.last_name, c.birth_date,
         c.phone, c.is_active, c.v_score,
         c.v_score >= v_seuil,
         c.v_tel_match,
         (p_naissance IS NOT NULL AND c.birth_date = p_naissance)
  FROM candidats c
  ORDER BY c.v_score DESC, c.last_name, c.first_name
  LIMIT v_limite;
END;
$$;

ALTER FUNCTION app.find_similar_patients(text,text,text,date,integer) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.find_similar_patients(text,text,text,date,integer) IS
  'Patients V3. Candidats doublons pendant la saisie de création. Une trace '
  '''recherche'' par appel, limite 8 en base, périmètre RLS de l''appelant. '
  'Le score sert à classer, jamais à être affiché : l''écran montre des raisons.';

REVOKE ALL ON FUNCTION app.find_similar_patients(text,text,text,date,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.find_similar_patients(text,text,text,date,integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5 · Retrait du privilège de transfert — même motif que 020 §5 / 050 §4
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('051_find_similar_patients')
  ON CONFLICT DO NOTHING;

COMMIT;
