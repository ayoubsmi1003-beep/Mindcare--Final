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
SELECT set_config('task.document_draft',(:'created'::jsonb->>'id'),true);
SELECT pg_temp.check_doc(:'created'::jsonb->>'revision'='1','draft revision');
SELECT app.save_editable_document_draft(current_setting('task.document_draft')::uuid,1,'{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Texte libre français et العربية 🧠"}]}]}','{"date_consultation":"07/10/2026"}','2026-10-07') AS saved \gset
SELECT pg_temp.check_doc(:'saved'::jsonb->>'revision'='2','saved revision');
SELECT pg_temp.check_doc(app.get_editable_document_draft(current_setting('task.document_draft')::uuid)->'content'=:'saved'::jsonb->'content','exact content');
SELECT pg_temp.check_doc(app.save_editable_document_draft(current_setting('task.document_draft')::uuid,1,'{"type":"doc","content":[]}','{"date_consultation":"07/10/2026"}','2026-10-07')->>'reason'='draft-conflict','optimistic conflict');
SELECT pg_temp.check_doc(jsonb_array_length(app.list_document_draft_revisions(current_setting('task.document_draft')::uuid))=2,'revision history');
SELECT app.archive_editable_document_draft(current_setting('task.document_draft')::uuid,true);
SELECT pg_temp.check_doc(app.get_editable_document_draft(current_setting('task.document_draft')::uuid)->>'archivedAt' IS NOT NULL,'archive');
SELECT app.archive_editable_document_draft(current_setting('task.document_draft')::uuid,false);
SELECT pg_temp.check_doc(app.get_editable_document_draft(current_setting('task.document_draft')::uuid)->>'archivedAt' IS NULL,'restore');
SELECT pg_temp.check_doc(app.duplicate_editable_document_draft(current_setting('task.document_draft')::uuid)->>'issuedDocumentId' IS NULL,'duplicate remains draft');
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
SELECT pg_temp.check_doc(app.get_editable_document_draft(current_setting('task.document_draft')::uuid) IS NULL,'practitioner isolation');
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000003',true);
SELECT pg_temp.check_doc(app.get_editable_document_draft(current_setting('task.document_draft')::uuid) IS NULL,'assistant isolation');
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000004',true);
SELECT pg_temp.check_doc(app.get_editable_document_draft(current_setting('task.document_draft')::uuid) IS NULL,'cabinet isolation');
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM app.save_editable_document_draft(current_setting('task.document_draft')::uuid,2,'{"type":"doc","content":[{"type":"script","attrs":{"src":"https://invalid.example"}}]}','{"date_consultation":"07/10/2026"}','2026-10-07'); RAISE EXCEPTION 'UnsafeContentAccepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='UnsafeContentAccepted' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.check_doc(app.get_editable_document_draft(current_setting('task.document_draft')::uuid)->>'revision'='2','unsafe write rollback');
SELECT pg_temp.check_doc(jsonb_array_length(app.list_editable_document_drafts(NULL,false))=2,'audited draft list');
RESET ROLE;
SELECT pg_temp.check_doc(EXISTS(SELECT 1 FROM audit.log WHERE table_name='document_drafts' AND operation='insert'),'same transaction audit');
DO $$ BEGIN
 BEGIN UPDATE app.document_draft_revisions SET content_json='{}' WHERE draft_id=current_setting('task.document_draft')::uuid; RAISE EXCEPTION 'RevisionMutationAccepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='RevisionMutationAccepted' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
\echo DOCUMENT DRAFT CHECKPOINT PASS
