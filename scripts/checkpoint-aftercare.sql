\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.check_aftercare(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Aftercare checkpoint: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.reject_aftercare(command text,code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=code THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Aftercare checkpoint accepted forbidden command';
END $$;
CREATE FUNCTION pg_temp.incoming(v integer,state text DEFAULT 'shared',event uuid DEFAULT gen_random_uuid(),request uuid DEFAULT gen_random_uuid(),kind text DEFAULT 'journal',body jsonb DEFAULT '{"format":"free","text":"Synthetic shared journal","status":"saved"}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('schemaVersion',2,'eventId',event,'patientId','b4000000-0000-4000-8000-000000000001','bindingId','b3000000-0000-4000-8000-000000000001','objectId','b5000000-0000-4000-8000-000000000001','version',v,'effectiveAt','2026-11-16T10:00:00+01:00','emittedAt','2026-11-16T10:00:00+01:00','source','sanad','correlationId',request,'shareState',state,'object',jsonb_build_object('kind',kind,'body',body))
$$;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('journal','{"situation":"Synthetic","emotion":"Calm","need":"Rest","helped":"Walking"}'::jsonb),
  ('preparation','{"questions":"Synthetic question"}'::jsonb),
  ('message','{"category":"effect","text":"Patient words","status":"sent","simulation":true}'::jsonb),
  ('blueprint','{"goals":"Synthetic goal","helps":"","difficult":"","communication":"","doctorShouldKnow":"","supportPreferences":""}'::jsonb),
  ('missionResponse','{"missionId":"b5000000-0000-4000-8000-000000000002","missionVersion":1,"status":"completed","reflection":"Patient words"}'::jsonb),
  ('personalEvent','{"type":"victory","title":"Synthetic event","detail":"","happenedOn":"2026-11-16","category":"routine","tags":[]}'::jsonb),
  ('letter','{"recipient":"future-self","title":"Synthetic letter","text":"Patient words","status":"saved"}'::jsonb),
  ('atlas','{"title":"Synthetic map","nodes":[{"id":"b7000000-0000-4000-8000-000000000001","type":"thought","text":"Patient words"}],"edges":[]}'::jsonb),
  ('roomSession','{"roomType":"stress","completedSteps":["arrive","reflect"],"reflection":"Patient words","status":"completed"}'::jsonb),
  ('report','{"title":"Synthetic report","from":"2026-11-01","to":"2026-11-16","audience":"clinician","selectedSources":[{"recordId":"b5000000-0000-4000-8000-000000000001","version":1}],"status":"ready","generatedAt":"2026-11-16T10:00:00Z","sourceSnapshot":[{"recordId":"b5000000-0000-4000-8000-000000000001","version":1,"kind":"journal","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-02T10:00:00Z"}]}'::jsonb)
 ) fixture(kind,body) LOOP
  PERFORM app.aftercare_validate_body(r.kind,r.body,'sanad');
 END LOOP;
END $$;
SELECT pg_temp.reject_aftercare($q$SELECT app.aftercare_validate_body('report','{"title":"Synthetic report","from":"2026-11-01","to":"2026-11-16","audience":"clinician","selectedSources":[],"status":"ready","generatedAt":"2026-11-16T10:00:00Z","sourceSnapshot":[{"recordId":"b5000000-0000-4000-8000-000000000001","version":1,"kind":"journal","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-02T10:00:00Z"}]}','sanad')$q$,'P0001');
SELECT pg_temp.reject_aftercare($q$SELECT app.aftercare_validate_body('atlas','{"title":"Map","nodes":[],"edges":[{"from":"b7000000-0000-4000-8000-000000000001","to":"b7000000-0000-4000-8000-000000000002"}]}','sanad')$q$,'P0001');
SELECT pg_temp.reject_aftercare($q$SELECT app.aftercare_validate_body('roomSession','{"roomType":"stress","completedSteps":["invented-step"],"reflection":"Patient words","status":"completed"}','sanad')$q$,'P0001');
SELECT pg_temp.reject_aftercare($q$SELECT app.aftercare_validate_body('journal','{"format":"free","text":"","status":"saved"}','sanad')$q$,'P0001');
SELECT pg_temp.reject_aftercare($q$SELECT app.aftercare_validate_body('missionResponse','{"missionId":"b5000000-0000-4000-8000-000000000002","missionVersion":0,"status":"completed","reflection":""}','sanad')$q$,'P0001');
SELECT app.set_deployment_environment('self-hosted','Disposable synthetic Aftercare qualification, all identities fabricated');
INSERT INTO app.cabinets(id,name) VALUES('b0000000-0000-4000-8000-000000000001','Synthetic clinic'),('b0000000-0000-4000-8000-000000000002','Synthetic other clinic');
INSERT INTO auth.users(id) SELECT ('b1000000-0000-4000-8000-00000000000'||n)::uuid FROM generate_series(1,5)n;
INSERT INTO app.profiles(id,cabinet_id,role,full_name,is_active) VALUES
 ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','owner','Synthetic owner',true),
 ('b1000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','practitioner','Synthetic practitioner',true),
 ('b1000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001','assistant','Synthetic reception',true),
 ('b1000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000002','owner','Synthetic foreign owner',true),
 ('b1000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000001','owner','Synthetic inactive owner',false);
INSERT INTO app.patients(id,cabinet_id,practitioner_id,record_number,first_name,last_name,phone,is_synthetic) VALUES
 ('b2000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','SYNTHETIC-1','Synthetic','Aftercare','0000000001',true),
 ('b2000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','SYNTHETIC-FALSE-FLAG','Synthetic','Rejection fixture','0000000002',false),
 ('b2000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','SYNTHETIC-3','Synthetic','Other practitioner','0000000003',true);
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject_aftercare($q$SELECT * FROM app.aftercare_objects$q$,'42501');
SELECT pg_temp.reject_aftercare($q$SELECT app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000001','{}')$q$,'42501');
SELECT pg_temp.reject_aftercare($q$SELECT app.ack_aftercare_event('b0000000-0000-4000-8000-000000000001',gen_random_uuid(),'applied')$q$,'42501');
SELECT pg_temp.reject_aftercare($q$SELECT app.verify_aftercare_binding('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','guardian','Synthetic identity and authority checked',1,false)$q$,'P0001');
SELECT pg_temp.reject_aftercare($q$SELECT app.verify_aftercare_binding(gen_random_uuid(),'b2000000-0000-4000-8000-000000000002',gen_random_uuid(),'self','Synthetic false-flag rejection',1,true)$q$,'P0001');
SELECT pg_temp.check_aftercare((SELECT count(*)=1 FROM app.verify_aftercare_binding('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','guardian','Synthetic identity and authority checked',1,true)),'doctor verified binding');
SELECT pg_temp.check_aftercare((SELECT count(*)=1 FROM app.verify_aftercare_binding('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','guardian','Synthetic identity and authority checked',1,true)),'binding exact retry');
SELECT pg_temp.reject_aftercare($q$SELECT app.verify_aftercare_binding('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','self','Changed authority',1,true)$q$,'P0001');
SELECT id AS outbox FROM app.publish_aftercare_object('b3000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002',0,'mission','{"title":"Synthetic mission","purpose":"Observe","instructions":"Write a reflection","status":"published"}','b6000000-0000-4000-8000-000000000001',true) \gset
SELECT set_config('aftercare.test.outbox',:'outbox',true);
SELECT pg_temp.check_aftercare((SELECT id=:'outbox'::uuid FROM app.publish_aftercare_object('b3000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002',0,'mission','{"title":"Synthetic mission","purpose":"Observe","instructions":"Write a reflection","status":"published"}','b6000000-0000-4000-8000-000000000001',true)),'atomic outbox exact retry');
SELECT pg_temp.reject_aftercare($q$SELECT app.publish_aftercare_object('b3000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002',0,'mission','{"title":"Changed","purpose":"Observe","instructions":"Write","status":"published"}','b6000000-0000-4000-8000-000000000001',true)$q$,'P0001');
SELECT pg_temp.reject_aftercare($q$SELECT app.publish_aftercare_object('b3000000-0000-4000-8000-000000000001',gen_random_uuid(),0,'doctorNote','{"text":"Synthetic note","status":"published","approvedBy":"forged"}',gen_random_uuid(),true)$q$,'P0001');
SELECT pg_temp.reject_aftercare($q$SELECT app.publish_aftercare_object('b3000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002',0,'mission','{"title":"Synthetic mission","purpose":"Observe","instructions":"Write","status":"published"}',gen_random_uuid(),true)$q$,'P0001');
SELECT app.publish_aftercare_object('b3000000-0000-4000-8000-000000000001',gen_random_uuid(),0,'carePlan','{"title":"Synthetic plan","text":"A human instruction","status":"published"}',gen_random_uuid(),true);
SELECT app.publish_aftercare_object('b3000000-0000-4000-8000-000000000001',gen_random_uuid(),0,'doctorNote','{"text":"A human note","status":"published"}',gen_random_uuid(),true);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE mindcare_app;
SELECT pg_temp.reject_aftercare($q$SELECT * FROM app.patients$q$,'42501');
SELECT pg_temp.check_aftercare((SELECT count(*)=3 FROM app.pending_aftercare_events('b0000000-0000-4000-8000-000000000001')),'pending outbox gate');
SELECT pg_temp.check_aftercare((SELECT count(*)=0 FROM app.pending_aftercare_events('b0000000-0000-4000-8000-000000000002')),'outbox clinic isolation');
SELECT pg_temp.reject_aftercare($q$SELECT app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000001',pg_temp.incoming(1,'shared',gen_random_uuid(),gen_random_uuid(),'missionResponse','{"missionId":"b5000000-0000-4000-8000-000000000002","missionVersion":2,"status":"completed","reflection":"Patient words"}'))$q$,'P0001');
SAVEPOINT mission_response;
SELECT pg_temp.check_aftercare(app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000001',pg_temp.incoming(1,'shared',gen_random_uuid(),gen_random_uuid(),'missionResponse','{"missionId":"b5000000-0000-4000-8000-000000000002","missionVersion":1,"status":"completed","reflection":"Patient words"}'))->>'status'='applied','mission response exact published version');
ROLLBACK TO SAVEPOINT mission_response;
SELECT pg_temp.reject_aftercare($q$SELECT app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000002',pg_temp.incoming(1))$q$,'P0001');
SELECT pg_temp.reject_aftercare($q$SELECT app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000001',pg_temp.incoming(1)||'{"source":"mindcare"}')$q$,'P0001');
SELECT pg_temp.incoming(1) AS incoming \gset
SELECT pg_temp.check_aftercare(app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000001',:'incoming')->>'status'='applied','shared submission');
SELECT pg_temp.check_aftercare(app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000001',:'incoming')->>'status'='duplicate','identical incoming retry');
SELECT pg_temp.reject_aftercare(format('SELECT app.ingest_aftercare_event(%L,%L::jsonb)','b0000000-0000-4000-8000-000000000001',jsonb_set(:'incoming','{object,body,text}','"Conflicting body"')),'P0001');
SELECT pg_temp.reject_aftercare($q$SELECT app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000001',pg_temp.incoming(2,'shared',gen_random_uuid(),gen_random_uuid(),'journal','{"format":"free","text":"Synthetic","status":"saved","instructions":"injected"}'))$q$,'P0001');
SELECT pg_temp.check_aftercare(app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000001',pg_temp.incoming(3))->>'status'='applied','newer version');
SELECT pg_temp.check_aftercare(app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000001',pg_temp.incoming(2))->>'status'='stale','stale version');
SELECT app.ack_aftercare_event('b0000000-0000-4000-8000-000000000001',current_setting('aftercare.test.outbox')::uuid,'applied');
SELECT app.ack_aftercare_event('b0000000-0000-4000-8000-000000000001',current_setting('aftercare.test.outbox')::uuid,'applied');
SELECT app.ack_aftercare_event('b0000000-0000-4000-8000-000000000001',current_setting('aftercare.test.outbox')::uuid,'duplicate');
SELECT pg_temp.reject_aftercare($q$SELECT app.ack_aftercare_event('b0000000-0000-4000-8000-000000000002',current_setting('aftercare.test.outbox')::uuid,'applied')$q$,'P0001');
RESET ROLE;
SELECT pg_temp.check_aftercare((SELECT read_at IS NULL FROM app.aftercare_objects WHERE source='sanad'),'technical receipt is not human read');
SELECT pg_temp.check_aftercare((SELECT count(*)=1 FROM app.aftercare_events WHERE direction='outgoing' AND request_id='b6000000-0000-4000-8000-000000000001'),'exactly one publication');
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject_aftercare($q$SELECT app.publish_aftercare_object('b3000000-0000-4000-8000-000000000001',gen_random_uuid(),0,'review','{"sourceId":"b5000000-0000-4000-8000-000000000001","sourceVersion":3,"status":"reviewed","text":"Human reply"}',gen_random_uuid(),true)$q$,'P0001');
SELECT pg_temp.check_aftercare((SELECT read_at IS NOT NULL AND read_by=auth.uid() FROM app.read_aftercare_object('b3000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001',3)),'actual doctor read');
SELECT pg_temp.check_aftercare((SELECT envelope->'object'->'body'->>'reviewedBy'=auth.uid()::text FROM app.publish_aftercare_object('b3000000-0000-4000-8000-000000000001',gen_random_uuid(),0,'review','{"sourceId":"b5000000-0000-4000-8000-000000000001","sourceVersion":3,"status":"reviewed","text":"Human reply"}',gen_random_uuid(),true)),'review and reply authority assigned by SQL');
SELECT pg_temp.check_aftercare((SELECT count(*)=5 FROM app.list_aftercare_objects('b2000000-0000-4000-8000-000000000001')),'audited dossier listing');
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
SELECT pg_temp.check_aftercare((SELECT count(*)=0 FROM app.list_aftercare_objects('b2000000-0000-4000-8000-000000000001')),'other practitioner denied');
SELECT pg_temp.reject_aftercare($q$SELECT app.read_aftercare_object('b3000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001',3)$q$,'P0001');
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
SELECT pg_temp.check_aftercare((SELECT count(*)=0 FROM app.list_aftercare_objects('b2000000-0000-4000-8000-000000000001')),'reception clinical read denied');
SELECT pg_temp.reject_aftercare($q$SELECT app.publish_aftercare_object('b3000000-0000-4000-8000-000000000001',gen_random_uuid(),0,'doctorNote','{"text":"Synthetic","status":"published"}',gen_random_uuid(),true)$q$,'P0001');
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000004',true);
SELECT pg_temp.check_aftercare((SELECT count(*)=0 FROM app.list_aftercare_bindings('b2000000-0000-4000-8000-000000000001')),'foreign clinic denied');
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000005',true);
SELECT pg_temp.check_aftercare((SELECT count(*)=0 FROM app.list_aftercare_objects('b2000000-0000-4000-8000-000000000001')),'inactive owner denied');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE mindcare_app;
SELECT pg_temp.check_aftercare(app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000001',pg_temp.incoming(2,'revoked',gen_random_uuid(),gen_random_uuid(),'journal','{}'))->>'status'='applied','older revocation retained');
SELECT pg_temp.check_aftercare(app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000001',pg_temp.incoming(3))->>'status'='stale','same version cannot reshare revoked body');
RESET ROLE;
SELECT pg_temp.check_aftercare((SELECT body='{}' AND share_state='revoked' AND version=3 AND read_at IS NULL FROM app.aftercare_objects WHERE source='sanad'),'revocation hides body and clears read');
SET LOCAL ROLE mindcare_app;
SELECT pg_temp.check_aftercare(app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000001',pg_temp.incoming(4))->>'status'='applied','newer explicit reshare');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT app.revoke_aftercare_binding('b3000000-0000-4000-8000-000000000001',true);
SELECT pg_temp.check_aftercare((SELECT count(*)=0 FROM app.list_aftercare_objects('b2000000-0000-4000-8000-000000000001')),'binding revocation removes dossier content');
RESET ROLE;
SET LOCAL ROLE mindcare_app;
SELECT pg_temp.check_aftercare((SELECT count(*)=0 FROM app.pending_aftercare_events('b0000000-0000-4000-8000-000000000001')),'revoked binding suppresses pending delivery');
SELECT pg_temp.reject_aftercare($q$SELECT app.ingest_aftercare_event('b0000000-0000-4000-8000-000000000001',pg_temp.incoming(5))$q$,'P0001');
RESET ROLE;
SELECT pg_temp.check_aftercare((SELECT count(*)=3 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname IN ('aftercare_bindings','aftercare_objects','aftercare_events') AND c.relrowsecurity AND c.relforcerowsecurity),'all tables FORCE RLS');
SELECT pg_temp.check_aftercare(NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('app_gatekeeper','aftercare_transport') AND (rolsuper OR rolbypassrls OR rolcanlogin)),'owners cannot bypass RLS');
SELECT pg_temp.check_aftercare(NOT has_table_privilege('aftercare_transport','app.patients','SELECT'),'transport has no EMR access');
SELECT pg_temp.check_aftercare((SELECT count(DISTINCT table_name)=3 FROM audit.log WHERE table_name IN ('aftercare_bindings','aftercare_objects','aftercare_events')),'all mutations audited');
SELECT pg_temp.check_aftercare((SELECT count(*)>0 FROM audit.log WHERE operation='select' AND patient_id='b2000000-0000-4000-8000-000000000001'),'patient reads audited');
SELECT pg_temp.check_aftercare((SELECT count(*)=0 FROM app.clinical_notes WHERE patient_id='b2000000-0000-4000-8000-000000000001'),'submissions never insert official notes');
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_aftercare((SELECT count(*)=1 FROM app.verify_aftercare_binding('b3000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000003','b4000000-0000-4000-8000-000000000002','self','Synthetic identity verified',1,true)),'practitioner may bind own patient');
RESET ROLE;
UPDATE app.patients SET practitioner_id='b1000000-0000-4000-8000-000000000001' WHERE id='b2000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_aftercare((SELECT count(*)=0 FROM app.list_aftercare_bindings('b2000000-0000-4000-8000-000000000003')),'former practitioner loses binding access after patient transfer');
RESET ROLE;
ROLLBACK;
\echo AFTERCARE SQL CHECKPOINT PASS
