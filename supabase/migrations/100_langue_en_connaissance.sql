-- 100_langue_en_connaissance — ADR-038 · incrément de périmètre : langue 'en'.
--
-- DÉCISION (humaine, session d'architecture) : le corpus initial R0
-- (ADR-037 : fr/ar/darija) s'étend à l'anglais pour deux sources de
-- staging OCR — `ICD-11 Reference Guide` (codage) et `The Maudsley
-- Prescribing Guidelines in Psychiatry, Taylor 2021` (prescription).
-- FR/AR/Darija inchangés ; aucune autre valeur n'est admise.
--
-- PORTÉE STRICTE : élargissement additif de deux CHECK sur `langue`
-- (constraints inline de 092, noms automatiques Postgres
-- `{table}_langue_check`, remplacées ici par des contraintes NOMMÉES
-- explicites). Aucune table/colonnes/index/RLS/porte/fonction modifiée.
-- 092 et toutes les migrations appliquées restent INT touchées (règle 9).
--
-- COMPATIBILITÉ ARRIÈRE : tout jeu existant satisfait le nouveau CHECK
-- (élargissement monotone) ; lexical `simple`, HNSW, GIN, RLS et portes
-- sont indépendants de la langue (constaté, pas supposé).
--
-- ACTIVATION : cette migration n'active RIEN. Les sources EN restent
-- `discovered`, sans approbation ; R3/backfill et `active` exigent des
-- instructions humaines séparées. Taylor reste `discovered` jusqu'à G7.
--
-- ROLLBACK : réappliquer le CHECK étroit ci-dessous — sûr uniquement si
-- aucune ligne `en` n'existe (garde incluse : échec fermé sinon).
--
-- Conventions : BEGIN/COMMIT + `schema_migrations`, jamais DROP d'objet
-- hors ces deux CHECK (motif 029 : aucun DROP de table/porte/fonction),
-- noms qualifiés `app.*`.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0 · Préconditions (échec fermé si le socle 092 n'est pas tel qu'attendu)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'knowledge_sources_langue_check'
          AND connamespace = 'app'::regnamespace
    ) THEN
        RAISE EXCEPTION '100 : précondition absente (knowledge_sources_langue_check introuvable — 092 non appliquée ?)'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'knowledge_chunks_langue_check'
          AND connamespace = 'app'::regnamespace
    ) THEN
        RAISE EXCEPTION '100 : précondition absente (knowledge_chunks_langue_check introuvable — 092 non appliquée ?)'
            USING ERRCODE = 'check_violation';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1 · Élargissement additif fr/ar/darija → fr/ar/darija/en (contraintes nommées)
-- ---------------------------------------------------------------------------
ALTER TABLE app.knowledge_sources
    DROP CONSTRAINT knowledge_sources_langue_check;
ALTER TABLE app.knowledge_sources
    ADD CONSTRAINT knowledge_sources_langue_vocab
    CHECK (langue IN ('fr', 'ar', 'darija', 'en'));

ALTER TABLE app.knowledge_chunks
    DROP CONSTRAINT knowledge_chunks_langue_check;
ALTER TABLE app.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_langue_vocab
    CHECK (langue IN ('fr', 'ar', 'darija', 'en'));

-- ---------------------------------------------------------------------------
-- 2 · Journal de migration
-- ---------------------------------------------------------------------------
INSERT INTO app.schema_migrations (version) VALUES ('100_langue_en_connaissance')
    ON CONFLICT DO NOTHING;

COMMIT;
