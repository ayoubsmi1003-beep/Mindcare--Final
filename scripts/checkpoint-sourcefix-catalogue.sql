-- Only consumed after the synthetic document checkpoint prelude, in its transaction.
RESET ROLE;
SELECT pg_temp.check_doc((SELECT count(*)>=15645 FROM app.medications WHERE source_fingerprint IS NOT NULL),'full reference imported');
SELECT pg_temp.check_doc(NOT has_function_privilege('authenticated','app.provision_document_identity(uuid,uuid,jsonb)','EXECUTE'),'identity transfer is administrative only');
-- Filling missing identity data does not rewrite configured names or other values.
UPDATE app.profiles SET speciality_ar=NULL WHERE id='d1000000-0000-4000-8000-000000000001';
SELECT app.provision_document_identity('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','{"practitioner":{"full_name":"Docteur test","title":"Dr.","speciality_fr":"Specialite test","speciality_ar":"اختبار","order_number":"TEST-01","phone":"0000000000","full_name_ar":"طبيب اختبار","document_footer":{"facebook_label":"Cabinet synthétique","instagram_label":"Cabinet synthétique"}},"cabinet":{"name":"Document test cabinet","address":"Test address","phone":"0000000000"}}');
SELECT pg_temp.check_doc((SELECT speciality_ar='اختبار' AND full_name='Docteur test' AND signature_block#>>'{document_footer,facebook_label}'='Cabinet synthétique' FROM app.profiles WHERE id='d1000000-0000-4000-8000-000000000001'),'identity preserved and missing value filled');
DO $$ BEGIN
 BEGIN
  PERFORM app.provision_document_identity('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','{"practitioner":{"full_name":"Wrong target identity","title":"Dr.","speciality_fr":"Specialite test","speciality_ar":"اختبار","order_number":"TEST-01","phone":"0000000000","full_name_ar":"طبيب اختبار"},"cabinet":{"name":"Document test cabinet","address":"Test address","phone":"0000000000"}}');
  RAISE EXCEPTION 'ConflictNotRejected';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'IdentityTransferConflict' THEN RAISE;END IF;
 END;
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_doc((SELECT count(*)=1 FROM app.search_medications_page('doli',1,1)),'second page accessible');
SELECT pg_temp.check_doc((SELECT total_count>1 FROM app.search_medications_page('doli',1,1)),'total covers following pages');
SELECT pg_temp.check_doc(NOT EXISTS(SELECT 1 FROM app.search_medications_page('doli',10,100000)),'exact results exhausted without switching to fuzzy family');
SELECT pg_temp.check_doc((SELECT count(*)>=2 FROM app.search_medications_page('zoloft',100,0)),'multiple brand strengths remain searchable');
SELECT pg_temp.check_doc((SELECT array_agg(id ORDER BY id) FROM app.search_medications_page('AERIUS',100,0))=(SELECT array_agg(id ORDER BY id) FROM app.search_medications_page('  aérius  ',100,0)),'case accents and whitespace');
SELECT pg_temp.check_doc((SELECT available_count>=15645 FROM app.get_medication_catalog_status()),'catalogue status respects available reference');
SELECT pg_temp.check_doc(NOT EXISTS(SELECT 1 FROM app.search_medications_page('no-such-synthetic-medication-xyz',10,0)),'a genuine no-match query stays empty');
RESET ROLE;
ROLLBACK;
