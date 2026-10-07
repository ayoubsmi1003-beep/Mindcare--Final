\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.check_doc(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'document checkpoint: %',message; END IF; END $$;
INSERT INTO app.cabinets(id,name,address,phone) VALUES ('d0000000-0000-4000-8000-000000000001','Document test cabinet','Test address','0000000000'),('d0000000-0000-4000-8000-000000000002','Other test cabinet','Test address','0000000000');
INSERT INTO auth.users(id) VALUES ('d1000000-0000-4000-8000-000000000001'),('d1000000-0000-4000-8000-000000000002'),('d1000000-0000-4000-8000-000000000003'),('d1000000-0000-4000-8000-000000000004');
INSERT INTO app.profiles(id,cabinet_id,role,full_name,title,speciality_fr,speciality_ar,order_number,phone,signature_block) VALUES
('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','owner','Docteur test','Dr.','Specialite test','اختبار','TEST-01','0000000000','{"full_name_ar":"طبيب اختبار"}'),
('d1000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','practitioner','Autre test','Dr.','Specialite test','اختبار','TEST-02','0000000000','{"full_name_ar":"طبيب اختبار"}'),
('d1000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001','assistant','Assistant test',null,null,null,null,null,null),
('d1000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000002','owner','Foreign test','Dr.','Specialite test','اختبار','TEST-03','0000000000','{"full_name_ar":"طبيب اختبار"}');
INSERT INTO app.patients(id,cabinet_id,practitioner_id,record_number,first_name,last_name,birth_date,sex,phone,is_synthetic) VALUES
('d2000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','P-TEST-1','DocumentTest','Synthetic','2000-01-15','F','0000000000',true),
('d2000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','P-TEST-2','DocumentTest','Missing','2000-01-15',null,'0000000001',true);
INSERT INTO app.document_templates(cabinet_id,doc_type,version,title_fr,header_html,body_html,is_active) VALUES ('d0000000-0000-4000-8000-000000000001','justification',1,'Justification','<header></header>','<p>Texte {{patient.first_name}} {{vars.date_consultation}}.</p>',true);
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
RESET ROLE;
SELECT app.create_editable_document_draft('d2000000-0000-4000-8000-000000000001','ordonnance','{}') AS created \gset
SELECT pg_temp.check_doc(app.preview_editable_document_draft((:'created'::jsonb->>'id')::uuid,1)#>'{readiness,reasons}' @> '["medication-invalid"]','empty prescription refused');
SELECT app.save_editable_document_draft((:'created'::jsonb->>'id')::uuid,1,'{"type":"doc","content":[{"type":"medication","attrs":{"rowId":"test-line","medicationId":null,"source":"free-text","designation":"Médicament test عربي","strength":"","posology":"Posologie décidée par médecin","quantity":"Une boîte","frequency":"","duration":"Sept jours","administration":"","instructions":"Texte libre 😀"}}]}','{}','2026-10-07') AS saved \gset
SELECT app.preview_editable_document_draft((:'created'::jsonb->>'id')::uuid,2) AS preview \gset
SELECT pg_temp.check_doc((:'preview'::jsonb#>>'{readiness,canIssue}')::boolean,'valid free text prescription');
RESET ROLE;
SELECT jsonb_build_object('contentHash',:'preview'::jsonb->>'contentHash','rendererVersion','v1','pages',jsonb_build_array(jsonb_build_array(jsonb_build_object('path',jsonb_build_array(0),'from',0,'to',char_length(app.document_node_text(:'preview'::jsonb#>'{content,content,0}')))))) AS manifest \gset
SET LOCAL ROLE authenticated;
SELECT app.issue_editable_document_draft((:'created'::jsonb->>'id')::uuid,2,:'preview'::jsonb->>'contentHash',:'preview'::jsonb->>'identityVersion',:'manifest') AS issued \gset
SELECT pg_temp.check_doc(:'issued'::jsonb->>'documentId' IS NOT NULL,'prescription issue');
SELECT pg_temp.check_doc(app.issue_editable_document_draft((:'created'::jsonb->>'id')::uuid,2,:'preview'::jsonb->>'contentHash',:'preview'::jsonb->>'identityVersion',:'manifest')->>'documentId'=:'issued'::jsonb->>'documentId','no duplicate prescription on retry');
SELECT app.void_document((:'issued'::jsonb->>'documentId')::uuid,'Synthetic prescription checkpoint');
SELECT pg_temp.check_doc(app.get_patient_workspace('d2000000-0000-4000-8000-000000000001')#>>'{traitements,derniere_prescription,document_status}'='voided','patient history exposes voided prescription');
RESET ROLE;
SELECT pg_temp.check_doc((SELECT count(*)=1 FROM app.prescriptions WHERE patient_id='d2000000-0000-4000-8000-000000000001'),'one prescription');
SELECT pg_temp.check_doc((SELECT document_medication->>'quantity'='Une boîte' AND document_medication->>'instructions'='Texte libre 😀' FROM app.prescription_lines WHERE prescription_id IN(SELECT id FROM app.prescriptions WHERE patient_id='d2000000-0000-4000-8000-000000000001')),'raw medication exact');
SELECT pg_temp.check_doc((SELECT count(*)=0 FROM app.patient_treatments WHERE patient_id='d2000000-0000-4000-8000-000000000001'),'no active treatment inferred');
ROLLBACK;
\echo DOCUMENT PRESCRIPTION CHECKPOINT PASS
