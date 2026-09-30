-- ═══════════════════════════════════════════════════════════════════════════
-- 111_provenance_lignee_connaissance — D3 option A : lignée unité/parent
-- au niveau chunk (décision humaine D3-A).
--
-- PORTÉE — QUATRE COLONNES NULLABLES, RIEN D'AUTRE :
-- `unit_id` (unité canonique source), `parent_texte_hash` (texte parent FNV),
-- `enfant_index` / `enfants_total` (position dans la fratrie, 0-based).
-- NULL = lignée inconnue (toutes les lignes existantes : honnête, jamais
-- deviné). Aucune ligne déplacée. Aucune RLS touchée. Aucune porte
-- d'écriture touchée. Les deux portes de lecture sont recréées à l'identique
-- + les 4 colonnes (CREATE OR REPLACE : propriétaire et droits conservés,
-- réaffirmés comme en 093). Rejouable (IF NOT EXISTS).
-- Retour arrière : DROP COLUMN (perte de lignée acceptée : régénérable
-- depuis les chargeurs déterministes).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE app.knowledge_chunks ADD COLUMN IF NOT EXISTS unit_id text NULL;
ALTER TABLE app.knowledge_chunks ADD COLUMN IF NOT EXISTS parent_texte_hash text NULL;
ALTER TABLE app.knowledge_chunks ADD COLUMN IF NOT EXISTS enfant_index integer NULL;
ALTER TABLE app.knowledge_chunks ADD COLUMN IF NOT EXISTS enfants_total integer NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_chunks_enfant_index_check') THEN
    ALTER TABLE app.knowledge_chunks ADD CONSTRAINT knowledge_chunks_enfant_index_check
      CHECK (enfant_index IS NULL OR enfant_index >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_chunks_enfants_total_check') THEN
    ALTER TABLE app.knowledge_chunks ADD CONSTRAINT knowledge_chunks_enfants_total_check
      CHECK (enfants_total IS NULL OR enfants_total >= 0);
  END IF;
END $$;

COMMENT ON COLUMN app.knowledge_chunks.unit_id IS
  'D3-A : unité canonique source (ex. tu-xxxxxxxx Taylor, dsm5fr-u-…) — NULL = inconnue.';
COMMENT ON COLUMN app.knowledge_chunks.parent_texte_hash IS
  'D3-A : hash FNV du texte parent (scission v2) — NULL = chunk non scindé ou lignée inconnue.';
COMMENT ON COLUMN app.knowledge_chunks.enfant_index IS
  'D3-A : index 0-based dans la fratrie — NULL = non scindé ou inconnu.';
COMMENT ON COLUMN app.knowledge_chunks.enfants_total IS
  'D3-A : taille de la fratrie — NULL = non scindé ou inconnu.';

-- ── Portes recréées à l'identique + lignée (sémantique 092/093 inchangée) ──
-- EXCEPTION DOCUMENTÉE au motif 029 (jamais DROP) : PostgreSQL interdit
-- CREATE OR REPLACE quand le type de retour change (nouvelles colonnes).
-- Vérifié : 0 dépendants normaux sur les deux portes (pg_depend). DROP +
-- CREATE dans la MÊME transaction, propriétaire et droits réaffirmés
-- aussitôt (même discipline que 093) — aucune fenêtre sans porte, aucune
-- perte de privilège.
DROP FUNCTION IF EXISTS app.search_knowledge_lexical(text, text, integer);
CREATE FUNCTION app.search_knowledge_lexical(p_requete text, p_langue text, p_limite integer)
RETURNS TABLE (
    chunk_id text, source_id uuid, source_titre text, source_version text,
    section text, version_chunk text, langue text, texte text, score double precision,
    source_statut text, source_classification text,
    source_approuvee_le timestamptz, source_approuvee_par uuid,
    source_revue_a_jour boolean, source_remplacee_par uuid,
    unit_id text, parent_texte_hash text, enfant_index integer, enfants_total integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, audit, pg_catalog AS $$
    SELECT c.id, c.source_id, s.titre, s.version, c.section, c.chunker_version,
           c.langue, c.texte,
           ts_rank(c.document_tsv, plainto_tsquery('simple', app.immutable_unaccent($1))) AS score,
           s.statut, s.classification, s.approved_at, s.approved_by,
           (s.review_due_at IS NULL OR s.review_due_at > now()) AS source_revue_a_jour,
           s.superseded_by AS source_remplacee_par,
           c.unit_id, c.parent_texte_hash, c.enfant_index, c.enfants_total
      FROM app.knowledge_chunks c
      JOIN app.knowledge_sources s ON s.id = c.source_id
     WHERE s.classification = 'C4'
       AND s.statut = 'active'
       AND s.approved_at IS NOT NULL
       AND s.approved_by IS NOT NULL
       AND (s.review_due_at IS NULL OR s.review_due_at > now())
       AND s.superseded_by IS NULL
       AND c.statut = 'active'
       AND ($2 = 'toutes' OR c.langue = $2)
       AND c.document_tsv @@ plainto_tsquery('simple', app.immutable_unaccent($1))
     ORDER BY score DESC
     LIMIT LEAST(GREATEST($3, 1), 20);
$$;

DROP FUNCTION IF EXISTS app.search_knowledge_vector(text, integer);
CREATE FUNCTION app.search_knowledge_vector(p_embedding_json text, p_limite integer)
RETURNS TABLE (
    chunk_id text, source_id uuid, source_titre text, source_version text,
    section text, version_chunk text, langue text, texte text, score double precision,
    source_statut text, source_classification text,
    source_approuvee_le timestamptz, source_approuvee_par uuid,
    source_revue_a_jour boolean, source_remplacee_par uuid,
    unit_id text, parent_texte_hash text, enfant_index integer, enfants_total integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, audit, pg_catalog AS $$
    SELECT c.id, c.source_id, s.titre, s.version, c.section, c.chunker_version,
           c.langue, c.texte,
           1 - (c.embedding OPERATOR(public.<=>) p.q) AS score,
           s.statut, s.classification, s.approved_at, s.approved_by,
           (s.review_due_at IS NULL OR s.review_due_at > now()) AS source_revue_a_jour,
           s.superseded_by AS source_remplacee_par,
           c.unit_id, c.parent_texte_hash, c.enfant_index, c.enfants_total
      FROM app.knowledge_chunks c
      JOIN app.knowledge_sources s ON s.id = c.source_id
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

ALTER FUNCTION app.search_knowledge_lexical(text, text, integer) OWNER TO app_gatekeeper;
GRANT EXECUTE ON FUNCTION app.search_knowledge_lexical(text, text, integer) TO authenticated;
ALTER FUNCTION app.search_knowledge_vector(text, integer) OWNER TO app_gatekeeper;
GRANT EXECUTE ON FUNCTION app.search_knowledge_vector(text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('111_provenance_lignee_connaissance')
  ON CONFLICT DO NOTHING;

COMMIT;
