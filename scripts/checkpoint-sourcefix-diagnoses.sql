-- Appended to the existing synthetic document-checkpoint prelude, inside its transaction.
SELECT row_to_json(d)::text AS first_diagnosis FROM app.record_diagnosis('d2000000-0000-4000-8000-000000000001','Diagnostic synthétique','ICD-10','F41.1',true,NULL) d \gset
SELECT pg_temp.check_doc((:'first_diagnosis'::jsonb->>'is_primary')::boolean,'first primary');
SELECT pg_temp.check_doc(:'first_diagnosis'::jsonb->>'onset_date' IS NULL,'unknown clinical date');
SELECT app.resolve_diagnosis((:'first_diagnosis'::jsonb->>'id')::uuid,CURRENT_DATE);
SELECT row_to_json(d)::text AS next_diagnosis FROM app.record_diagnosis('d2000000-0000-4000-8000-000000000001','Autre diagnostic synthétique','ICD-10','F32.0',true,NULL) d \gset
RESET ROLE;
SELECT pg_temp.check_doc((SELECT is_primary AND resolved_at IS NOT NULL FROM app.diagnoses WHERE id=(:'first_diagnosis'::jsonb->>'id')::uuid),'historical principal preserved');
SELECT pg_temp.check_doc(EXISTS(SELECT 1 FROM audit.log WHERE table_name='diagnoses' AND operation='insert'),'diagnosis audit');
ROLLBACK;
