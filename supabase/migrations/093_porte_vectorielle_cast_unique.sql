-- 093_porte_vectorielle_cast_unique — M07 · action performance bornée (porte B).
--
-- DIAGNOSTIC (mesuré, pas supposé — voir `.eval-out/m07-hnsw-diag*.mjs`) :
-- la porte `search_knowledge_vector` (092) mettait 6 à 11 s par appel sur
-- 15 666 chunks, DANS la fonction uniquement (corps identique hors fonction :
-- 180 à 350 ms). Cause : `($1::public.vector)` — le JSON texte de 1024
-- flottants (~8 Ko) — n'est replié qu'en plan personnalisé. En plan générique
-- (emploi via fonction SQL), la conversion texte→vecteur est réévaluée PAR
-- LIGNE : 15 666 × ~0,2-0,4 ms ≈ 3 à 11 s. Prouvé par `EXPLAIN ANALYZE`
-- (Sort Key `($1)::vector` non replié) et par la barrière ci-dessous (150 ms).
--
-- CORRECTIF MINIMAL, SÉMANTIQUE IDENTIQUE : la conversion a lieu UNE fois,
-- dans une sous-requête `OFFSET 0` (barrière anti-aplatissement — sans elle,
-- le planificateur réexpose la conversion par ligne, mesuré). Même jointure,
-- mêmes filtres d'autorité (C4 + active + approved + revue + non-superseded),
-- mêmes colonnes, même contrat, même borne. Seule l'évaluation change.
--
-- HNSW (index 092, valide/vivant) : le planificateur préfère le balayage exact
-- même `enable_seqscan = off` (mesuré : 174 ms HNSW forcé contre 150-300 ms
-- exact, top-20 OCTET-IDENTIQUE). À 15 666 lignes, forcer l'index approximatif
-- échangerait l'exactitude contre RIEN — refusé (sûreté > latence). L'index
-- reste en place pour la croissance du corpus. Cible p95 ≤ 3000 ms atteinte
-- par ce seul correctif (voir passes C/D).
--
-- ROLLBACK : réappliquer le corps 092 de `search_knowledge_vector`
-- (fichier `092_knowledge_rag.sql` §6, jamais édité). Aucune autre trace.
--
-- Conventions : BEGIN/COMMIT + `schema_migrations`, `CREATE OR REPLACE`
-- uniquement (jamais DROP — motif 029), privilèges/propriétaire 092
-- préservés et réaffirmés, `SET search_path` figé (motif 003), noms
-- qualifiés `public.vector` / `OPERATOR(public.<=>)` / `app.*`.

BEGIN;

CREATE OR REPLACE FUNCTION app.search_knowledge_vector(p_embedding_json text, p_limite integer)
RETURNS TABLE (
    chunk_id text, source_id uuid, source_titre text, source_version text,
    section text, version_chunk text, langue text, texte text, score double precision,
    source_statut text, source_classification text,
    source_approuvee_le timestamptz, source_approuvee_par uuid,
    source_revue_a_jour boolean, source_remplacee_par uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, audit, pg_catalog AS $$
    SELECT c.id, c.source_id, s.titre, s.version, c.section, c.chunker_version,
           c.langue, c.texte,
           1 - (c.embedding OPERATOR(public.<=>) p.q) AS score,
           s.statut, s.classification, s.approved_at, s.approved_by,
           (s.review_due_at IS NULL OR s.review_due_at > now()) AS source_revue_a_jour,
           s.superseded_by AS source_remplacee_par
      FROM app.knowledge_chunks c
      JOIN app.knowledge_sources s ON s.id = c.source_id
      -- Barrière d'évaluation unique (voir en-tête) : SANS `OFFSET 0`, le
      -- planificateur aplati la sous-requête et la conversion texte→vecteur
      -- redevient par-ligne (6 à 11 s mesurés). AVEC : ~150 ms, même ordre.
      CROSS JOIN (SELECT $1::public.vector AS q OFFSET 0) AS p
     WHERE s.classification = 'C4'
       AND s.statut = 'active'
       AND s.approved_at IS NOT NULL
       AND s.approved_by IS NOT NULL
       AND (s.review_due_at IS NULL OR s.review_due_at > now())
       AND s.superseded_by IS NULL
       AND c.statut = 'active'
       AND c.embedding IS NOT NULL
     ORDER BY c.embedding OPERATOR(public.<=>) p.q
     LIMIT LEAST(GREATEST($2, 1), 20);
$$;

COMMENT ON FUNCTION app.search_knowledge_vector(text, integer) IS
    'M07 : branche vectorielle (cosine, embedding JSON→public.vector évalué UNE fois — barrière 093). Voie défaut gouvernée uniquement.';

-- Propriété et droits 092, réaffirmés (CREATE OR REPLACE les conserve ;
-- l'assertion protège contre une application par un rôle inattendu).
ALTER FUNCTION app.search_knowledge_vector(text, integer) OWNER TO app_gatekeeper;
GRANT EXECUTE ON FUNCTION app.search_knowledge_vector(text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
INSERT INTO app.schema_migrations (version) VALUES ('093_porte_vectorielle_cast_unique')
    ON CONFLICT DO NOTHING;

COMMIT;
