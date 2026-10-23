BEGIN;
DO $$ BEGIN IF current_database()<>'alexa_eval_clinical_20261022' THEN RAISE EXCEPTION 'Isolated clinical evaluation required'; END IF; END $$;
CREATE TEMP TABLE trajectory_repair ON COMMIT DROP AS
WITH visits AS (
 SELECT c.id,n.id note_id,n.subjective,c.raw_notes,
 (n.structured#>>'{sessionDetails,mesures,anxiete}')::int anxiety,
 (n.structured#>>'{sessionDetails,mesures,sommeil}')::int sleep,
 (n.structured#>>'{sessionDetails,mesures,humeur}')::int mood,
 lag((n.structured#>>'{sessionDetails,mesures,anxiete}')::int) OVER w previous_anxiety,
 lag((n.structured#>>'{sessionDetails,mesures,sommeil}')::int) OVER w previous_sleep,
 lag((n.structured#>>'{sessionDetails,mesures,humeur}')::int) OVER w previous_mood,
 CASE WHEN c.raw_notes LIKE '%Le parent%' THEN 'Le parent' ELSE 'La personne' END reporter
 FROM app.consultations c JOIN app.clinical_notes n ON n.consultation_id=c.id
 WHERE n.structured->'evaluation'->>'campaign'='clinical-20261022'
 WINDOW w AS (PARTITION BY c.patient_id ORDER BY c.started_at,c.id)
), revised AS (
 SELECT *,reporter||CASE
 WHEN anxiety=previous_anxiety AND sleep=previous_sleep AND mood=previous_mood THEN ' rapporte peu de changement depuis le dernier entretien.'
 WHEN anxiety<=previous_anxiety AND sleep<=previous_sleep AND mood<=previous_mood THEN ' rapporte un mieux depuis le dernier entretien.'
 WHEN anxiety>=previous_anxiety AND sleep>=previous_sleep AND mood>=previous_mood THEN ' rapporte une reprise des difficultés depuis le dernier entretien.'
 ELSE ' rapporte une évolution contrastée des difficultés depuis le dernier entretien.' END replacement
 FROM visits WHERE previous_anxiety IS NOT NULL
)
SELECT id,note_id,
regexp_replace(raw_notes,'(La personne|Le parent) rapporte (un mieux|une reprise des difficultés|peu de changement|une évolution contrastée des difficultés) depuis le dernier entretien\.',replacement,'g') new_raw,
regexp_replace(subjective,'(La personne|Le parent) rapporte (un mieux|une reprise des difficultés|peu de changement|une évolution contrastée des difficultés) depuis le dernier entretien\.',replacement,'g') new_subjective
FROM revised;
UPDATE app.consultations c SET raw_notes=r.new_raw FROM trajectory_repair r
WHERE c.id=r.id AND c.raw_notes IS DISTINCT FROM r.new_raw
AND EXISTS(SELECT 1 FROM app.clinical_notes n WHERE n.id=r.note_id AND n.status='draft' AND n.lock_after IS NULL);
UPDATE app.clinical_notes n SET subjective=r.new_subjective FROM trajectory_repair r
WHERE n.id=r.note_id AND n.status='draft' AND n.lock_after IS NULL AND n.subjective IS DISTINCT FROM r.new_subjective;
COMMIT;
