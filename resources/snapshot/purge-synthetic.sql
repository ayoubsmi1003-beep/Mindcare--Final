-- purge-synthetic.sql — purge des fixtures de démonstration après restauration.
--
-- Contexte (décision D0 vérifiée le 2026-10-06 sur mc-p3) : les 1558 dossiers
-- importés de Syglab portent `is_synthetic = TRUE` (import exécuté sous
-- `environment = 'cloud-dev'`) — ce SONT les dossiers de production, on ne
-- touche NI à leurs flags NI à leurs lignes. Seules les fixtures de
-- démonstration non rattachées au legs (ex. Nadia Belkacem P-1016 posée par
-- 091, conservée seule par 125) sont purgées : tout patient `is_synthetic`
-- ABSENT de `legacy_id_map` (source_kind = 'patient').
--
-- Règles : enfants avant parents (ordre FK), gardes temporaires désactivées
-- puis réactivées (motif 090/125), unlink des FK NULLABLES (jamais de DELETE
-- aveugle), auto-vérification finale (EXCEPTION = rollback complet).
-- Appliqué via `psql -v ON_ERROR_STOP=1 -q -f` : toute erreur refuse le
-- démarrage (base partielle jamais servie).

BEGIN;

-- ── 0 · Ensemble condamné : synthétique ET non rattaché au legs ─────────────
CREATE TEMPORARY TABLE doomed_patients ON COMMIT DROP AS
SELECT p.id
FROM app.patients p
WHERE p.is_synthetic IS TRUE
  AND NOT EXISTS (
    SELECT 1 FROM app.legacy_id_map m
    WHERE m.source_kind = 'patient' AND m.mindcare_id = p.id
  );

-- ── Gardes temporairement levées (motif 090/125) ─────────────────────────────
ALTER TABLE app.clinical_notes DISABLE RULE no_delete_notes;
DROP TRIGGER IF EXISTS forbid_history_update ON app.patient_treatment_history;

-- ── 1 · Unlink des FK NULLABLES (jamais de DELETE ici) ───────────────────────
UPDATE app.communication_conversations SET patient_id = NULL
 WHERE patient_id IN (SELECT id FROM doomed_patients);

UPDATE app.pending_patients SET matched_patient_id = NULL
 WHERE matched_patient_id IN (SELECT id FROM doomed_patients);

-- ── 2 · Consentements (FK NOT NULL, pas de is_synthetic : filtre par patient)
DELETE FROM app.communication_consents
 WHERE patient_id IN (SELECT id FROM doomed_patients);

-- ── 3 · Enfants directs et indirects, dans l'ordre FK ─────────────────────────
DELETE FROM app.case_summary_feedback
 WHERE summary_id IN (SELECT s.id FROM app.patient_case_summaries s
                       JOIN doomed_patients d ON d.id = s.patient_id);

DELETE FROM app.patient_case_summaries
 WHERE patient_id IN (SELECT id FROM doomed_patients);

DELETE FROM app.consultation_analyses
 WHERE patient_id IN (SELECT id FROM doomed_patients);

DELETE FROM app.clinical_note_amendments
 WHERE note_id IN (SELECT id FROM app.clinical_notes
                    WHERE patient_id IN (SELECT id FROM doomed_patients));

DELETE FROM app.clinical_notes
 WHERE patient_id IN (SELECT id FROM doomed_patients);

DELETE FROM app.scale_administrations
 WHERE patient_id IN (SELECT id FROM doomed_patients);

DELETE FROM app.diagnoses
 WHERE patient_id IN (SELECT id FROM doomed_patients);

-- Draft revisions and nullable document links form a small cycle. Break the
-- links only inside the synthetic patient's document graph before deleting it.
ALTER TABLE app.documents DISABLE TRIGGER ALL;
ALTER TABLE app.document_drafts DISABLE TRIGGER ALL;
ALTER TABLE app.document_draft_revisions DISABLE TRIGGER ALL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app.documents d
    JOIN app.document_drafts draft ON draft.id = d.source_draft_id
    WHERE (d.patient_id IN (SELECT id FROM doomed_patients))
       <> (draft.patient_id IN (SELECT id FROM doomed_patients))
  ) OR EXISTS (
    SELECT 1 FROM app.document_drafts draft
    JOIN app.documents d ON d.id IN (draft.issued_document_id, draft.source_document_id)
    WHERE (draft.patient_id IN (SELECT id FROM doomed_patients))
       <> (d.patient_id IN (SELECT id FROM doomed_patients))
  ) OR EXISTS (
    SELECT 1 FROM app.documents d
    JOIN app.prescriptions p ON p.id = d.prescription_id
    WHERE (d.patient_id IN (SELECT id FROM doomed_patients))
       <> (p.patient_id IN (SELECT id FROM doomed_patients))
  ) THEN
    RAISE EXCEPTION 'purge-synthetic : document cross-patient reference; cleanup refused.';
  END IF;
END $$;

UPDATE app.documents
   SET source_draft_id = NULL
 WHERE patient_id IN (SELECT id FROM doomed_patients);
UPDATE app.document_drafts
   SET issued_document_id = NULL, source_document_id = NULL
 WHERE patient_id IN (SELECT id FROM doomed_patients);

DELETE FROM app.document_draft_revisions
 WHERE patient_id IN (SELECT id FROM doomed_patients);
DELETE FROM app.document_drafts
 WHERE patient_id IN (SELECT id FROM doomed_patients);

-- Documents can reference prescriptions and consultations, so remove them first.
DELETE FROM app.documents
 WHERE patient_id IN (SELECT id FROM doomed_patients);
ALTER TABLE app.document_draft_revisions ENABLE TRIGGER ALL;
ALTER TABLE app.document_drafts ENABLE TRIGGER ALL;
ALTER TABLE app.documents ENABLE TRIGGER ALL;

DELETE FROM app.prescription_lines
 WHERE prescription_id IN (SELECT id FROM app.prescriptions
                            WHERE patient_id IN (SELECT id FROM doomed_patients));
DELETE FROM app.prescriptions
 WHERE patient_id IN (SELECT id FROM doomed_patients);

DELETE FROM app.patient_treatment_history
 WHERE treatment_id IN (SELECT id FROM app.patient_treatments
                         WHERE patient_id IN (SELECT id FROM doomed_patients));
DELETE FROM app.patient_treatments
 WHERE patient_id IN (SELECT id FROM doomed_patients);

DELETE FROM app.payments
 WHERE patient_id IN (SELECT id FROM doomed_patients);

DELETE FROM app.transcript_segments
 WHERE consultation_id IN (SELECT id FROM app.consultations
                            WHERE patient_id IN (SELECT id FROM doomed_patients));
DELETE FROM app.live_insights
 WHERE consultation_id IN (SELECT id FROM app.consultations
                            WHERE patient_id IN (SELECT id FROM doomed_patients));
DELETE FROM app.consultations
 WHERE patient_id IN (SELECT id FROM doomed_patients);

DELETE FROM app.appointment_reasons
 WHERE appointment_id IN (SELECT id FROM app.appointments
                           WHERE patient_id IN (SELECT id FROM doomed_patients));
DELETE FROM app.appointments
 WHERE patient_id IN (SELECT id FROM doomed_patients);

DELETE FROM app.legacy_clinical_history
 WHERE patient_id IN (SELECT id FROM doomed_patients);

DELETE FROM app.patients
 WHERE id IN (SELECT id FROM doomed_patients);

-- ── Réactivation des gardes ──────────────────────────────────────────────────
ALTER TABLE app.clinical_notes ENABLE RULE no_delete_notes;
CREATE TRIGGER forbid_history_update BEFORE UPDATE OR DELETE ON app.patient_treatment_history
  FOR EACH ROW EXECUTE FUNCTION app.forbid_treatment_history_mutation();

-- ── 4 · Auto-vérification : aucune fixture orpheline ne subsiste ─────────────
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM app.patients p
  WHERE p.is_synthetic IS TRUE
    AND NOT EXISTS (
      SELECT 1 FROM app.legacy_id_map m
      WHERE m.source_kind = 'patient' AND m.mindcare_id = p.id
    );
  IF n <> 0 THEN
    RAISE EXCEPTION 'purge-synthetic : % patient(s) fixture subsistent après purge.', n;
  END IF;
  RAISE NOTICE 'purge-synthetic : OK — aucune fixture de démonstration ne subsiste.';
END $$;

COMMIT;
