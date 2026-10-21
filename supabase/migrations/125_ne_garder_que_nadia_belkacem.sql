-- 125_ne_garder_que_nadia_belkacem — ne garde que Nadia Belkacem (P-1016) parmi les fixtures.
--
-- Demande : supprimer tous les patients de test, ne garder que Belkacem Nadia.
-- La patiente gardée est la fixture synthétique `Nadia Belkacem` (P-1016,
-- id a1000000-0000-4000-8000-000000001016) posée par 091, avec ses
-- 2 consultations (003161, 003162) et sa note signée (004161).
--
-- ═══ POURQUOI UNE MIGRATION, PAS UN DELETE DIRECT ═══════════════════════════
-- Règle 3 de CLAUDE.md (« aucun DELETE sur une donnée clinique ») protège les
-- dossiers RÉELS ; comme l'écrit 083, elle ne s'applique pas aux fixtures que
-- le garde-fou 016 désigne explicitement comme synthétiques (`is_synthetic`).
-- En revanche `scripts/README.md` impose que toute destruction passe par une
-- migration relue — jamais par un DELETE ad hoc (`guard-bash.sh` le bloque).
-- Cette migration suit donc le motif éprouvé de 090 (purge du synthétique en
-- ordre FK, gardes temporaires désactivées puis réactivées), avec une seule
-- différence : l'exclusion de la patiente gardée.
--
-- ═══ GARANTIES ══════════════════════════════════════════════════════════════
-- · Ne touche AUCUNE ligne réelle : chaque DELETE/UPDATE est filtré par
--   `is_synthetic IS TRUE` directement ou via une jointure vers un patient
--   `is_synthetic IS TRUE`. Une ligne `is_synthetic = false` est inatteignable.
-- · Fail-closed : si la patiente gardée est absente (base sans 091), la
--   migration REFUSE (EXCEPTION) au lieu de tout vider.
-- · Auto-vérifiée : en fin de transaction, elle contrôle qu'il reste
--   exactement 1 patient synthétique et que c'est Nadia Belkacem, sinon
--   EXCEPTION (rollback complet).
-- · Idempotente : rejouée, elle ne trouve plus rien à purger et rend les
--   mêmes contrôles verts.
-- · Compteurs et référentiels (médicaments, échelles, modèles de documents,
--   charges, profils, cabinet) intacts — comme 090, on ne touche ni aux
--   numéros déjà attribués ni à l'identité du cabinet.
--
-- Ordre FK (enfants avant parents, patients en dernier) : feedback →
-- résumés → analyses → amendements → notes → échelles → diagnostics → lignes de
-- prescription → prescriptions → historique des traitements → traitements →
-- documents → paiements → segments → insights → consultations → motifs RDV →
-- RDV → patients. Préalable : unlink des FK NULLABLES (conversations,
-- pending) et suppression des consentements (FK NOT NULL sans is_synthetic).

BEGIN;

-- ── 0 · Garde fail-closed : la patiente à garder doit exister ───────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.patients
    WHERE id = 'a1000000-0000-4000-8000-000000001016'
  ) THEN
    RAISE EXCEPTION
      '125_ne_garder_que_nadia_belkacem refuse : patiente gardée '
      'a1000000-0000-4000-8000-000000001016 (Nadia Belkacem, P-1016) absente. '
      'Appliquer 091 avant, ou vérifier la base visée.'
      USING HINT = 'Refus volontaire : sans la gardée, cette purge viderait tout le synthétique.';
  END IF;
END $$;

-- ── Gardes temporairement levées (motif 090 : désactiver → purger → réactiver)
ALTER TABLE app.clinical_notes DISABLE RULE no_delete_notes;
-- history immuable : on désactive temporairement le trigger d'interdiction
DROP TRIGGER IF EXISTS forbid_history_update ON app.patient_treatment_history;

-- ── 1 · Unlink des FK NULLABLES vers les fixtures supprimées (jamais de DELETE)
UPDATE app.communication_conversations SET patient_id = NULL
 WHERE patient_id IN (SELECT id FROM app.patients
                       WHERE is_synthetic IS TRUE
                         AND id <> 'a1000000-0000-4000-8000-000000001016');

UPDATE app.pending_patients SET matched_patient_id = NULL
 WHERE matched_patient_id IN (SELECT id FROM app.patients
                               WHERE is_synthetic IS TRUE
                                 AND id <> 'a1000000-0000-4000-8000-000000001016');

-- ── 2 · Consentements (FK NOT NULL, pas de is_synthetic : filtre par patient)
DELETE FROM app.communication_consents
 WHERE patient_id IN (SELECT id FROM app.patients
                       WHERE is_synthetic IS TRUE
                         AND id <> 'a1000000-0000-4000-8000-000000001016');

-- ── 3 · Résumés du cas (feedback AVANT résumés : FK summary_id, motif 090
--        corrigé — 090 supprime les résumés d'abord, ce qui n'est sûr que si le
--        feedback est vide ; ici l'ordre est sûr dans les deux cas)
DELETE FROM app.case_summary_feedback
 WHERE summary_id IN (SELECT s.id FROM app.patient_case_summaries s
                       JOIN app.patients p ON p.id = s.patient_id
                      WHERE p.is_synthetic IS TRUE
                        AND p.id <> 'a1000000-0000-4000-8000-000000001016');

DELETE FROM app.patient_case_summaries
 WHERE patient_id IN (SELECT id FROM app.patients
                       WHERE is_synthetic IS TRUE
                         AND id <> 'a1000000-0000-4000-8000-000000001016');

DELETE FROM app.consultation_analyses
 WHERE patient_id IN (SELECT id FROM app.patients
                       WHERE is_synthetic IS TRUE
                         AND id <> 'a1000000-0000-4000-8000-000000001016');

DELETE FROM app.clinical_note_amendments
 WHERE note_id IN (SELECT id FROM app.clinical_notes
                    WHERE is_synthetic IS TRUE
                      AND patient_id <> 'a1000000-0000-4000-8000-000000001016');

DELETE FROM app.clinical_notes
 WHERE is_synthetic IS TRUE
   AND patient_id <> 'a1000000-0000-4000-8000-000000001016';

DELETE FROM app.scale_administrations
 WHERE is_synthetic IS TRUE
   AND patient_id <> 'a1000000-0000-4000-8000-000000001016';

DELETE FROM app.diagnoses
 WHERE is_synthetic IS TRUE
   AND patient_id <> 'a1000000-0000-4000-8000-000000001016';

DELETE FROM app.prescription_lines
 WHERE prescription_id IN (SELECT id FROM app.prescriptions
                            WHERE is_synthetic IS TRUE
                              AND patient_id <> 'a1000000-0000-4000-8000-000000001016');
DELETE FROM app.prescriptions
 WHERE is_synthetic IS TRUE
   AND patient_id <> 'a1000000-0000-4000-8000-000000001016';

DELETE FROM app.patient_treatment_history
 WHERE is_synthetic IS TRUE
   AND treatment_id IN (SELECT id FROM app.patient_treatments
                         WHERE patient_id <> 'a1000000-0000-4000-8000-000000001016');
DELETE FROM app.patient_treatments
 WHERE is_synthetic IS TRUE
   AND patient_id <> 'a1000000-0000-4000-8000-000000001016';

-- documents : désactive forbid_document_delete le temps de la purge (motif 090)
ALTER TABLE app.documents DISABLE TRIGGER ALL;
DELETE FROM app.documents
 WHERE is_synthetic IS TRUE
   AND patient_id <> 'a1000000-0000-4000-8000-000000001016';
ALTER TABLE app.documents ENABLE TRIGGER ALL;

DELETE FROM app.payments
 WHERE is_synthetic IS TRUE
   AND patient_id <> 'a1000000-0000-4000-8000-000000001016';

DELETE FROM app.transcript_segments
 WHERE consultation_id IN (SELECT id FROM app.consultations
                            WHERE is_synthetic IS TRUE
                              AND patient_id <> 'a1000000-0000-4000-8000-000000001016');
DELETE FROM app.live_insights
 WHERE consultation_id IN (SELECT id FROM app.consultations
                            WHERE is_synthetic IS TRUE
                              AND patient_id <> 'a1000000-0000-4000-8000-000000001016');
DELETE FROM app.consultations
 WHERE is_synthetic IS TRUE
   AND patient_id <> 'a1000000-0000-4000-8000-000000001016';

DELETE FROM app.appointment_reasons
 WHERE appointment_id IN (SELECT id FROM app.appointments
                           WHERE is_synthetic IS TRUE
                             AND patient_id <> 'a1000000-0000-4000-8000-000000001016');
DELETE FROM app.appointments
 WHERE is_synthetic IS TRUE
   AND patient_id <> 'a1000000-0000-4000-8000-000000001016';

DELETE FROM app.patients
 WHERE is_synthetic IS TRUE
   AND id <> 'a1000000-0000-4000-8000-000000001016';

-- ── Réactivation des gardes ─────────────────────────────────────────────────
ALTER TABLE app.clinical_notes ENABLE RULE no_delete_notes;
CREATE TRIGGER forbid_history_update BEFORE UPDATE OR DELETE ON app.patient_treatment_history
  FOR EACH ROW EXECUTE FUNCTION app.forbid_treatment_history_mutation();

-- ── 4 · Auto-vérification : exactement 1 synthétique restant, et c'est Nadia ─
DO $$
DECLARE
  n int;
  prenom text;
  nom text;
BEGIN
  SELECT count(*) INTO n FROM app.patients WHERE is_synthetic IS TRUE;
  IF n <> 1 THEN
    RAISE EXCEPTION
      '125_ne_garder_que_nadia_belkacem : attendu 1 patient synthétique restant, trouvé %.',
      n;
  END IF;

  SELECT first_name, last_name INTO prenom, nom FROM app.patients
   WHERE is_synthetic IS TRUE;
  IF prenom <> 'Nadia' OR nom <> 'Belkacem' THEN
    RAISE EXCEPTION
      '125_ne_garder_que_nadia_belkacem : le patient restant n''est pas Nadia Belkacem (trouvé % %).',
      prenom, nom;
  END IF;

  RAISE NOTICE '125_ne_garder_que_nadia_belkacem : OK — seule Nadia Belkacem (P-1016) subsiste côté synthétique.';
END $$;

INSERT INTO app.schema_migrations (version) VALUES ('125_ne_garder_que_nadia_belkacem')
  ON CONFLICT DO NOTHING;

COMMIT;
