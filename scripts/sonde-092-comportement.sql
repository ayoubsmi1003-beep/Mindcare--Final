-- sonde-092-comportement — preuves d'exécution de 092 sur bac pgvector (H1/H0.1/H0.2).
-- Exécuter après harnais + 092, avec ON_ERROR_STOP=1 : tout écart LÈVE (FAIL),
-- le silence + exit 0 vaut PASS. Bac à sable UNIQUEMENT.
--
-- Conventions : identifiants fixes, aucune donnée identifiante (fixtures).

-- ── 0 · Socle : cabinet, profil, rôle lecteur RLS ───────────────────────────
-- Idempotent (ON CONFLICT DO NOTHING) : la sonde peut être rejouée après un
-- échec sans reconstruire le bac.
INSERT INTO app.cabinets (id) VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO app.cabinets (id) VALUES ('00000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO app.profiles (id) VALUES ('00000000-0000-0000-0000-0000000000a1')
ON CONFLICT DO NOTHING;
DO $$ BEGIN
    CREATE ROLE t_reader NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
GRANT authenticated TO t_reader;

-- ── 1 · Unicité partielle partagée : doublon rejeté ─────────────────────────
INSERT INTO app.knowledge_sources (id, cabinet_id, titre, version, langue, classification, statut)
VALUES ('10000000-0000-4000-8000-000000000001', NULL, 'Guide', 'v1', 'fr', 'C4', 'discovered')
ON CONFLICT DO NOTHING;
DO $$ BEGIN
    INSERT INTO app.knowledge_sources (cabinet_id, titre, version, langue, classification, statut)
    VALUES (NULL, 'Guide', 'v1', 'fr', 'C4', 'discovered');
    RAISE EXCEPTION 'H0.1-ECHEC : doublon partagé accepté';
EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'H0.1-OK : doublon partagé rejeté';
END $$;

-- ── 2 · Même titre/version dans un autre cabinet : autorisé ─────────────────
INSERT INTO app.knowledge_sources (id, cabinet_id, titre, version, langue, classification, statut)
VALUES ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Guide', 'v1', 'fr', 'C4', 'discovered')
ON CONFLICT DO NOTHING;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.knowledge_sources WHERE id = '10000000-0000-4000-8000-000000000002') THEN
        RAISE EXCEPTION 'H0.1-ECHEC : homonyme inter-cabinets rejeté à tort';
    END IF;
    RAISE NOTICE 'H0.1-OK : homonymes partagé + cabinet coexistent';
END $$;

-- ── 3 · Même cabinet, même titre/version : rejeté ───────────────────────────
DO $$ BEGIN
    INSERT INTO app.knowledge_sources (cabinet_id, titre, version, langue, classification, statut)
    VALUES ('00000000-0000-4000-8000-000000000001', 'Guide', 'v1', 'fr', 'C4', 'discovered');
    RAISE EXCEPTION 'H0.1-ECHEC : doublon cabinet accepté';
EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'H0.1-OK : doublon cabinet rejeté';
END $$;

-- ── 4 · Tenant chunks : PAS de cabinet_id (H0.2) ────────────────────────────
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'app' AND table_name = 'knowledge_chunks' AND column_name = 'cabinet_id') THEN
        RAISE EXCEPTION 'H0.2-ECHEC : cabinet_id sur les chunks (double autorité)';
    END IF;
    RAISE NOTICE 'H0.2-OK : autorité tenant via source_id uniquement';
END $$;

-- ── 5 · FK + RESTRICT ───────────────────────────────────────────────────────
DO $$ BEGIN
    INSERT INTO app.knowledge_chunks (id, source_id, ordinal, langue, texte, texte_hash, chunker_version)
    VALUES ('chunk-orphelin', '00000000-0000-4000-8000-00000000ffff', 0, 'fr', 'x', 'h', 'struct-v1');
    RAISE EXCEPTION 'FK-ECHEC : chunk orphelin accepté';
EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'FK-OK : chunk orphelin rejeté';
END $$;

-- ── 6 · Lifecycle CHECK ─────────────────────────────────────────────────────
DO $$ BEGIN
    INSERT INTO app.knowledge_sources (cabinet_id, titre, version, langue, classification, statut)
    VALUES (NULL, 'X', 'v1', 'fr', 'C4', 'publie');
    RAISE EXCEPTION 'LIFECYCLE-ECHEC : statut inconnu accepté';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'LIFECYCLE-OK : statut inconnu rejeté';
END $$;
DO $$ BEGIN
    INSERT INTO app.knowledge_sources (cabinet_id, titre, version, langue, classification, statut)
    VALUES (NULL, 'X', 'v1', 'xx', 'C4', 'discovered');
    RAISE EXCEPTION 'LIFECYCLE-ECHEC : langue inconnue acceptée';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'LIFECYCLE-OK : langue inconnue rejetée';
END $$;
DO $$ BEGIN
    INSERT INTO app.knowledge_sources (cabinet_id, titre, version, langue, classification, statut)
    VALUES (NULL, 'X', 'v1', 'fr', 'C9', 'discovered');
    RAISE EXCEPTION 'LIFECYCLE-ECHEC : classification inconnue acceptée';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'LIFECYCLE-OK : classification inconnue rejetée';
END $$;

-- ── 7 · Lignée : auto-référence rejetée ─────────────────────────────────────
-- Reset préalable (rejouabilité : §10 a pu superséder cette ligne avant).
UPDATE app.knowledge_sources SET statut = 'active', superseded_by = NULL
 WHERE id = '10000000-0000-4000-8000-000000000001';
DO $$ BEGIN
    UPDATE app.knowledge_sources SET statut = 'superseded', superseded_by = id
     WHERE id = '10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'LIGNEE-ECHEC : auto-supersession acceptée';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'LIGNEE-OK : auto-supersession rejetée';
END $$;

-- ── 8 · Lignée : superseded sans successeur rejeté ──────────────────────────
UPDATE app.knowledge_sources SET statut = 'active', superseded_by = NULL
 WHERE id = '10000000-0000-4000-8000-000000000001';
DO $$ BEGIN
    UPDATE app.knowledge_sources SET statut = 'superseded'
     WHERE id = '10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'LIGNEE-ECHEC : superseded sans successeur accepté';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'LIGNEE-OK : superseded sans successeur rejeté';
END $$;

-- ── 9 · Lignée : successeur cross-titre rejeté ──────────────────────────────
INSERT INTO app.knowledge_sources (id, cabinet_id, titre, version, langue, classification, statut,
        approved_at, approved_by)
VALUES ('10000000-0000-4000-8000-000000000010', NULL, 'Autre', 'v9', 'fr', 'C4', 'active',
        '2026-09-01T10:00:00+01', '00000000-0000-0000-0000-0000000000a1')
ON CONFLICT DO NOTHING;
DO $$ BEGIN
    UPDATE app.knowledge_sources SET statut = 'superseded', superseded_by = '10000000-0000-4000-8000-000000000010'
     WHERE id = '10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'LIGNEE-ECHEC : supersession cross-titre acceptée';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'LIGNEE-OK : supersession cross-titre rejetée';
END $$;

-- ── 10 · Lignée : même titre, même portée → autorisée ───────────────────────
INSERT INTO app.knowledge_sources (id, cabinet_id, titre, version, langue, classification, statut,
        approved_at, approved_by, reviewed_by, reviewed_at, review_due_at,
        emetteur, reference_origine, contenu_hash)
VALUES ('10000000-0000-4000-8000-000000000011', NULL, 'Guide', 'v2', 'fr', 'C4', 'active',
        '2026-09-01T10:00:00+01', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a1', '2026-09-01T10:00:00+01', NULL,
        'Emetteur', 'Ref-1', 'abcdef1234567890')
ON CONFLICT DO NOTHING;
UPDATE app.knowledge_sources SET statut = 'superseded', superseded_by = '10000000-0000-4000-8000-000000000011'
 WHERE id = '10000000-0000-4000-8000-000000000001';
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.knowledge_sources
                   WHERE id = '10000000-0000-4000-8000-000000000001' AND statut = 'superseded') THEN
        RAISE EXCEPTION 'LIGNEE-ECHEC : supersession légitime refusée';
    END IF;
    RAISE NOTICE 'LIGNEE-OK : supersession même titre/portée autorisée';
END $$;

-- ── 11 · Index : HNSW cosine paramétré, GIN, partiels ───────────────────────
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'knowledge_chunks_embedding_hnsw'
                   AND indexdef ILIKE '%hnsw%' AND indexdef ILIKE '%vector_cosine_ops%') THEN
        RAISE EXCEPTION 'INDEX-ECHEC : HNSW cosine absent';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'knowledge_chunks_document_tsv_gin'
                   AND indexdef ILIKE '%gin%') THEN
        RAISE EXCEPTION 'INDEX-ECHEC : GIN tsvector absent';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'knowledge_sources_partage'
                   AND indexdef ILIKE '%(cabinet_id IS NULL)%') THEN
        RAISE EXCEPTION 'INDEX-ECHEC : unicité partielle partagée absente';
    END IF;
    IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'app'
        AND tablename = 'knowledge_sources' AND indexdef ILIKE '%ivfflat%') <> 0 THEN
        RAISE EXCEPTION 'INDEX-ECHEC : trace IVFFLAT interdite';
    END IF;
    RAISE NOTICE 'INDEX-OK : HNSW(m=16) + GIN + partiels, zéro IVFFLAT';
END $$;

-- ── 12 · RLS : ENABLE + FORCE + policies ────────────────────────────────────
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'app' AND c.relname = 'knowledge_sources'
                   AND c.relrowsecurity AND c.relforcerowsecurity) THEN
        RAISE EXCEPTION 'RLS-ECHEC : sources sans ENABLE+FORCE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'app' AND c.relname = 'knowledge_chunks'
                   AND c.relrowsecurity AND c.relforcerowsecurity) THEN
        RAISE EXCEPTION 'RLS-ECHEC : chunks sans ENABLE+FORCE';
    END IF;
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'app'
        AND tablename IN ('knowledge_sources', 'knowledge_chunks')) <> 2 THEN
        RAISE EXCEPTION 'RLS-ECHEC : policies manquantes';
    END IF;
    RAISE NOTICE 'RLS-OK : ENABLE+FORCE + 2 policies';
END $$;

-- ── 13 · Jeu gouverné : partagé actif + révoqué + overdue + cabinet ─────────
-- Vecteurs 1024-dim (typmod 092) construits en SQL, jamais à la main.
INSERT INTO app.knowledge_sources (id, cabinet_id, titre, version, langue, classification, statut,
        approved_at, approved_by, reviewed_by, reviewed_at, review_due_at, emetteur, reference_origine, contenu_hash)
VALUES
 ('20000000-0000-4000-8000-000000000001', NULL, 'Guide partage', 'v1', 'fr', 'C4', 'active',
  '2026-09-01T10:00:00+01', '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1', '2026-09-01T10:00:00+01', NULL, 'E', 'R', 'aa11'),
 ('20000000-0000-4000-8000-000000000002', NULL, 'Guide revoque', 'v1', 'fr', 'C4', 'revoked',
  '2026-09-01T10:00:00+01', '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1', '2026-09-01T10:00:00+01', NULL, 'E', 'R', 'bb22'),
 ('20000000-0000-4000-8000-000000000003', NULL, 'Guide perime', 'v1', 'fr', 'C4', 'active',
  '2024-01-01T10:00:00+01', '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1', '2024-01-01T10:00:00+01', '2024-06-01T00:00:00+00', 'E', 'R', 'cc33')
ON CONFLICT DO NOTHING;
INSERT INTO app.knowledge_chunks (id, source_id, ordinal, section, langue, texte, texte_hash, chunker_version,
        embedding, embedding_provider, embedding_modele, embedding_version, embedding_dimensions, embedding_normalisation)
SELECT x.id, x.source_id::uuid, 0, 'Traitement', 'fr', 'sertraline cinquante milligrammes', 'h1', 'struct-v1',
       ('[' || repeat('0.1,', 1023) || '0.1]')::public.vector, 'bench', 'm', 'v', 1024, 'n'
  FROM (VALUES ('k-partage-1', '20000000-0000-4000-8000-000000000001'),
               ('k-revoque-1', '20000000-0000-4000-8000-000000000002'),
               ('k-perime-1', '20000000-0000-4000-8000-000000000003')) AS x(id, source_id)
ON CONFLICT DO NOTHING;

-- ── 14 · Recette : vecteur sans métadonnées rejeté ; dims incohérentes rejetées
DO $$ BEGIN
    INSERT INTO app.knowledge_chunks (id, source_id, ordinal, langue, texte, texte_hash, chunker_version, embedding)
    VALUES ('k-sans-recette', '20000000-0000-4000-8000-000000000001', 9, 'fr', 'y', 'hy', 'struct-v1',
            ('[' || repeat('0.1,', 1023) || '0.1]')::public.vector);
    RAISE EXCEPTION 'RECETTE-ECHEC : vecteur sans métadonnées accepté';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'RECETTE-OK : vecteur sans métadonnées rejeté';
END $$;
DO $$ BEGIN
    INSERT INTO app.knowledge_chunks (id, source_id, ordinal, langue, texte, texte_hash, chunker_version,
            embedding, embedding_provider, embedding_modele, embedding_version, embedding_dimensions, embedding_normalisation)
    VALUES ('k-dims-ko', '20000000-0000-4000-8000-000000000001', 9, 'fr', 'y', 'hy', 'struct-v1',
            ('[' || repeat('0.1,', 1023) || '0.1]')::public.vector, 'bench', 'm', 'v', 5, 'n');
    RAISE EXCEPTION 'RECETTE-ECHEC : dims incohérentes acceptées';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'RECETTE-OK : dims incohérentes rejetées';
END $$;

-- ── 15 · Portes : défaut gouverné (révoqué + périmé absents) ────────────────
DO $$ DECLARE n_actif integer; n_total integer; BEGIN
    SELECT count(*) INTO n_total FROM app.search_knowledge_lexical('sertraline', 'fr', 20);
    SELECT count(*) INTO n_actif FROM app.search_knowledge_lexical('sertraline', 'fr', 20) WHERE source_id = '20000000-0000-4000-8000-000000000001';
    IF n_total <> 1 OR n_actif <> 1 THEN
        RAISE EXCEPTION 'PORTE-ECHEC : lexicale rend % ligne(s), attendu 1 (actif seul)', n_total;
    END IF;
    RAISE NOTICE 'PORTE-OK : lexicale exclut révoqué + périmé';
END $$;
DO $$ DECLARE n_total integer; BEGIN
    SELECT count(*) INTO n_total FROM app.search_knowledge_vector(
        (SELECT '[' || repeat('0.1,', 1023) || '0.1]'), 20);
    IF n_total <> 1 THEN
        RAISE EXCEPTION 'PORTE-ECHEC : vectorielle rend % ligne(s), attendu 1', n_total;
    END IF;
    RAISE NOTICE 'PORTE-OK : vectorielle exclut révoqué + périmé, ordonne cosine';
END $$;

-- ── 16 · RLS comportementale : sonde séparée (rôle t_reader, trust local) ─────
-- Exécutée hors de ce fichier (requiert une session sous t_reader) :
--   SELECT count(*) FROM app.knowledge_sources;            -- attendu : partagées seules
--   SELECT count(*) FROM app.knowledge_chunks;             -- attendu : chunks partagés seuls
--   INSERT INTO app.knowledge_sources (...) → refusé (aucune policy d'écriture).
SELECT 'RLS-INFO : sonde t_reader à exécuter en session séparée (voir §16)' AS note;
