-- 214_purge_documents_synthetiques — vide l'onglet Émis des artefacts de développement.
--
-- Demande : les 28 documents émis visibles sur /documents ont été générés pendant
-- le développement. Les retirer, sans toucher aucune pièce réelle.
--
-- ═══ POURQUOI UNE MIGRATION, PAS UN DELETE DIRECT ═══════════════════════════
-- `scripts/README.md` impose que toute destruction passe par une migration relue ;
-- `guard-bash.sh` bloque `DELETE FROM app.*`. La règle 3 (« aucun DELETE sur une
-- donnée clinique ») ne s'applique pas aux lignes que le garde-fou 016 désigne
-- comme synthétiques (`is_synthetic`), comme l'écrivent 083/090/125. Ici on ne
-- purge QUE `app.documents WHERE is_synthetic IS TRUE` : une pièce réelle
-- (`is_synthetic = false`) est inatteignable.
--
-- ═══ GARANTIES ══════════════════════════════════════════════════════════════
-- · Ne touche AUCUNE ligne réelle : filtre `is_synthetic IS TRUE` uniquement.
-- · Ne touche ni patients, ni consultations, ni notes, ni paiements, ni drafts :
--   seuls les FK entrants des drafts vers les docs supprimés sont neutralisés
--   (NULL), jamais effacés.
-- · Idempotente : rejouée, elle supprime 0 ligne et rend les mêmes contrôles.
-- · Compteurs et modèles (`document_templates`, counters) intacts.
--
-- Ordre : unlink drafts (FK drafts -> documents) AVANT delete, puis vérification.

BEGIN;

-- ── 1 · Neutralise les FK des brouillons vers les docs synthétiques (jamais de DELETE draft)
-- Garde IF EXISTS : bases antérieures à 129 n'ont pas ces colonnes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'app' AND table_name = 'document_drafts'
               AND column_name = 'issued_document_id') THEN
    UPDATE app.document_drafts SET issued_document_id = NULL
     WHERE issued_document_id IN (SELECT id FROM app.documents WHERE is_synthetic IS TRUE);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'app' AND table_name = 'document_drafts'
               AND column_name = 'source_document_id') THEN
    UPDATE app.document_drafts SET source_document_id = NULL
     WHERE source_document_id IN (SELECT id FROM app.documents WHERE is_synthetic IS TRUE);
  END IF;
END $$;

-- ── 2 · Purge des seuls documents synthétiques (motif 090/125 : triggers neutralisés le temps du DELETE)
ALTER TABLE app.documents DISABLE TRIGGER ALL;
DELETE FROM app.documents WHERE is_synthetic IS TRUE;
ALTER TABLE app.documents ENABLE TRIGGER ALL;

-- ── 3 · Auto-vérification fail-closed : plus aucun synthétique, réel intact par construction du WHERE
DO $$
DECLARE v_synth integer;
BEGIN
  SELECT count(*) INTO v_synth FROM app.documents WHERE is_synthetic IS TRUE;
  IF v_synth <> 0 THEN
    RAISE EXCEPTION '214_purge_documents_synthetiques refuse : % document(s) synthétique(s) restant(s).', v_synth;
  END IF;
END $$;

INSERT INTO app.schema_migrations (version) VALUES ('214_purge_documents_synthetiques')
  ON CONFLICT DO NOTHING;

COMMIT;
