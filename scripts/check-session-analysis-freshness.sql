-- Negative regression from an actual stale evaluation artifact; no invented answer.
BEGIN;
DO $$
DECLARE c record; exposed integer; context jsonb;
BEGIN
 IF current_database()<>'alexa_eval_clinical_20261022' THEN RAISE EXCEPTION 'Isolated clinical evaluation required'; END IF;
 SELECT a.consultation_id,a.patient_id,p.practitioner_id INTO c
 FROM app.consultation_analyses a JOIN app.patients p ON p.id=a.patient_id
 WHERE p.is_synthetic AND NOT(a.source_state ? 'context_digest') LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'StaleEvaluationArtifactRequired'; END IF;
 PERFORM set_config('request.jwt.claim.sub',c.practitioner_id::text,true);
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO exposed FROM app.get_consultation_analysis(c.consultation_id);
 IF exposed<>0 THEN RAISE EXCEPTION 'StaleAnalysisWasDisplayed'; END IF;
 SELECT app.get_alexa_clinical_context(c.patient_id,20,NULL,NULL) INTO context;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(context->'consultations') visit
   WHERE visit->>'id'=c.consultation_id::text AND visit ? 'analysis')
 THEN RAISE EXCEPTION 'StaleAnalysisWasProjectedInCase'; END IF;
 IF position('FROM app.get_consultation_analysis(c.id)' in pg_get_functiondef('app.get_alexa_clinical_context(uuid,integer,timestamptz,uuid)'::regprocedure))=0
 THEN RAISE EXCEPTION 'AuthoritativeAnalysisGateNotShared'; END IF;
 RAISE NOTICE 'PASS: stale legacy analysis is not displayed as current';
END $$;
ROLLBACK;
