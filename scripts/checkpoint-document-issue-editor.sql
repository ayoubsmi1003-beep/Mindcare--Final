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
SELECT app.create_editable_document_draft('d2000000-0000-4000-8000-000000000001','justification','{"date_consultation":"07/10/2026"}') AS created \gset
SELECT set_config('task.issue_draft',(:'created'::jsonb->>'id'),true);
SELECT app.preview_editable_document_draft(current_setting('task.issue_draft')::uuid,1) AS preview \gset
SELECT pg_temp.check_doc((:'preview'::jsonb#>>'{readiness,canIssue}')::boolean,'ready preview');
SELECT pg_temp.check_doc(:'preview'::jsonb->>'html' LIKE '%DocumentTest%' AND :'preview'::jsonb->>'html' LIKE '%07/10/2026%','actual patient body before issue');
SELECT jsonb_build_object('contentHash',:'preview'::jsonb->>'contentHash','rendererVersion','v1','pages','[[{"path":[0],"from":0,"to":30}]]'::jsonb) AS manifest \gset
SELECT pg_temp.check_doc(app.issue_editable_document_draft(current_setting('task.issue_draft')::uuid,1,'bad',:'preview'::jsonb->>'identityVersion',:'manifest')->>'reason'='preview-stale','stale hash refused');
-- A manifest cannot consume a number if its coverage is invalid.
SELECT pg_temp.check_doc(app.issue_editable_document_draft(current_setting('task.issue_draft')::uuid,1,:'preview'::jsonb->>'contentHash',:'preview'::jsonb->>'identityVersion',replace(:'manifest','30','29'))->>'reason'='layout-invalid','invalid coverage refused');
-- An identity change requires another preview, without changing the body.
RESET ROLE;
UPDATE app.profiles SET order_number='TEST-CHANGED' WHERE id='d1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_doc(app.issue_editable_document_draft(current_setting('task.issue_draft')::uuid,1,:'preview'::jsonb->>'contentHash',:'preview'::jsonb->>'identityVersion',:'manifest')->>'reason'='preview-stale','identity change refused');
RESET ROLE;
UPDATE app.profiles SET order_number='TEST-01' WHERE id='d1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT app.issue_editable_document_draft(current_setting('task.issue_draft')::uuid,1,:'preview'::jsonb->>'contentHash',:'preview'::jsonb->>'identityVersion',:'manifest') AS issued \gset
SELECT pg_temp.check_doc(:'issued'::jsonb->>'documentId' IS NOT NULL,'issue persisted');
SELECT pg_temp.check_doc(position('N° d’Ordre : '||(:'issued'::jsonb->>'docNumber') IN (:'issued'::jsonb->>'html'))>0,'header carries the issued document number');
SELECT pg_temp.check_doc(position('TEST-01' IN (:'issued'::jsonb->>'html'))=0,'professional test number is not a document serial');
SELECT pg_temp.check_doc(app.issue_editable_document_draft(current_setting('task.issue_draft')::uuid,1,:'preview'::jsonb->>'contentHash',:'preview'::jsonb->>'identityVersion',:'manifest')->>'documentId'=:'issued'::jsonb->>'documentId','retry exact same piece');
SELECT pg_temp.check_doc(app.verify_document_hash((:'issued'::jsonb->>'documentId')::uuid),'issued HTML hash');
SELECT app.create_editable_document_draft('d2000000-0000-4000-8000-000000000002','justification','{"date_consultation":"07/10/2026"}') AS missing \gset
SELECT pg_temp.check_doc(app.preview_editable_document_draft((:'missing'::jsonb->>'id')::uuid,1)#>'{readiness,reasons}' @> '["patient-sex-missing"]','actionable missing sex');
RESET ROLE;
SELECT pg_temp.check_doc((SELECT count(*)=1 FROM app.documents WHERE cabinet_id='d0000000-0000-4000-8000-000000000001'),'no duplicate piece');
SELECT pg_temp.check_doc((SELECT current_value=1 FROM app.counters WHERE cabinet_id='d0000000-0000-4000-8000-000000000001' AND scope='document'),'no extra number');
DO $$ BEGIN BEGIN UPDATE app.documents SET content_json='{}' WHERE source_draft_id=current_setting('task.issue_draft')::uuid; RAISE EXCEPTION 'IssuedMutationAccepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM='IssuedMutationAccepted' THEN RAISE;END IF;END;END $$;
SET LOCAL ROLE authenticated;
SELECT app.create_editable_document_draft('d2000000-0000-4000-8000-000000000001','justification','{"date_consultation":"07/10/2026"}') AS second_draft \gset
SELECT app.preview_editable_document_draft((:'second_draft'::jsonb->>'id')::uuid,1) AS second_preview \gset
SELECT jsonb_build_object('contentHash',:'second_preview'::jsonb->>'contentHash','rendererVersion','v1','pages','[[{"path":[0],"from":0,"to":30}]]'::jsonb) AS second_manifest \gset
SELECT app.issue_editable_document_draft((:'second_draft'::jsonb->>'id')::uuid,1,:'second_preview'::jsonb->>'contentHash',:'second_preview'::jsonb->>'identityVersion',:'second_manifest') AS second_issued \gset
SELECT pg_temp.check_doc(:'second_issued'::jsonb->>'docNumber'<>:'issued'::jsonb->>'docNumber','each document has a unique serial');
SELECT pg_temp.check_doc(position('N° d’Ordre : '||(:'second_issued'::jsonb->>'docNumber') IN (:'second_issued'::jsonb->>'html'))>0,'second document carries its own serial');
SELECT pg_temp.check_doc(app.verify_document_hash((:'second_issued'::jsonb->>'documentId')::uuid),'second numbered HTML hash');
ROLLBACK;
\echo DOCUMENT ISSUE CHECKPOINT PASS
