BEGIN;
DO $$ BEGIN IF current_database()<>'alexa_eval_clinical_20261022' THEN RAISE EXCEPTION 'Isolated clinical evaluation required'; END IF; END $$;
CREATE FUNCTION pg_temp.normalize_french(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT replace(replace(replace(replace(value,'de un ','d’un '),'de une ','d’une '),'de le ','du '),'de les ','des ')
$$;
UPDATE app.consultations c SET raw_notes=pg_temp.normalize_french(c.raw_notes)
WHERE c.raw_notes IS DISTINCT FROM pg_temp.normalize_french(c.raw_notes)
AND EXISTS(SELECT 1 FROM app.clinical_notes n WHERE n.consultation_id=c.id AND n.status='draft' AND n.lock_after IS NULL AND n.structured->'evaluation'->>'campaign'='clinical-20261022');
UPDATE app.clinical_notes SET subjective=pg_temp.normalize_french(subjective),objective=pg_temp.normalize_french(objective),assessment=pg_temp.normalize_french(assessment),plan=pg_temp.normalize_french(plan)
WHERE status='draft' AND lock_after IS NULL AND structured->'evaluation'->>'campaign'='clinical-20261022'
AND (subjective IS DISTINCT FROM pg_temp.normalize_french(subjective) OR objective IS DISTINCT FROM pg_temp.normalize_french(objective) OR assessment IS DISTINCT FROM pg_temp.normalize_french(assessment) OR plan IS DISTINCT FROM pg_temp.normalize_french(plan));
COMMIT;
