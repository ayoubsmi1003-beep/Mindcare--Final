-- Disposable, wholly synthetic fixture. Never run against the campaign or clinic database.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'alexa_eval_intelligence_fixture_20261023' THEN RAISE EXCEPTION 'Disposable fixture required'; END IF;
END $$;
INSERT INTO app.cabinets(id,name) VALUES ('b2000000-0000-4000-8000-000000000001','FICTIF Alexa SQL'),('b2000000-0000-4000-8000-000000000002','FICTIF other cabinet');
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('b1000000-0000-4000-8000-000000000001','owner@fixture.invalid','{"full_name":"FICTIF owner"}'),
 ('b1000000-0000-4000-8000-000000000002','assistant@fixture.invalid','{"full_name":"FICTIF assistant"}'),
 ('b1000000-0000-4000-8000-000000000003','other@fixture.invalid','{"full_name":"FICTIF other"}');
INSERT INTO app.profiles(id,cabinet_id,role,full_name) VALUES
 ('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','owner','FICTIF owner'),
 ('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','assistant','FICTIF assistant'),
 ('b1000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000002','owner','FICTIF other');
INSERT INTO app.patients(id,cabinet_id,practitioner_id,record_number,first_name,last_name,birth_date,sex,phone,id_document_number,is_active,is_synthetic,created_by,created_at)
 SELECT ('b3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','FIX-'||n,'FICTIF',n::text,
 CASE n WHEN 1 THEN '2008-10-23'::date WHEN 2 THEN NULL WHEN 3 THEN '2008-10-24'::date ELSE '1961-10-23'::date END,
 CASE WHEN n=2 THEN NULL ELSE 'F'::app.sex END,
 CASE WHEN n IN (1,3) THEN '0000000000' ELSE NULL END,
 CASE WHEN n=1 THEN U&'\2003\00A0' WHEN n IN (2,4) THEN NULL ELSE 'FIX-ID-'||n END,
 n<>4,true,'b1000000-0000-4000-8000-000000000001',
 CASE n WHEN 1 THEN '2026-09-01T00:00:00+01:00'::timestamptz WHEN 2 THEN '2026-08-31T23:59:59+01:00'::timestamptz WHEN 3 THEN '2026-09-30T23:59:59+01:00'::timestamptz ELSE '2026-10-01T00:00:00+01:00'::timestamptz END
 FROM generate_series(1,5) n;
INSERT INTO app.patients(id,cabinet_id,practitioner_id,record_number,first_name,last_name,is_synthetic,created_by)
 VALUES ('b3000000-0000-4000-8000-000000000099','b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000003','OTHER-FIX','FICTIF','OTHER',true,'b1000000-0000-4000-8000-000000000003');
INSERT INTO app.consultations(id,cabinet_id,practitioner_id,patient_id,started_at,ended_at,status,is_synthetic)
 SELECT ('b4000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
 ('b3000000-0000-4000-8000-'||lpad(p::text,12,'0'))::uuid,lo::timestamptz,hi::timestamptz,'closed',true
 FROM (VALUES (1,1,'2026-09-01T00:00:00+01:00','2026-09-01T00:30:00+01:00'),(2,1,'2026-09-30T23:50:00+01:00','2026-10-01T00:20:00+01:00'),(3,1,'2026-10-01T00:00:00+01:00','2026-10-01T00:30:00+01:00'),(4,2,'2026-08-31T23:50:00+01:00','2026-09-01T00:20:00+01:00'),(5,2,'2026-09-15T00:00:00+01:00','2026-09-15T00:30:00+01:00')) t(n,p,lo,hi);
INSERT INTO app.payments(id,cabinet_id,practitioner_id,patient_id,consultation_id,receipt_number,amount_dzd,set_by,is_synthetic)
 SELECT ('b5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',
 ('b4000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'FIX-PAY-'||n,CASE n WHEN 1 THEN 300 ELSE 500 END,'b1000000-0000-4000-8000-000000000001',true FROM generate_series(1,2) n;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
DO $$ DECLARE spec jsonb; got jsonb; next_page jsonb; anchor timestamptz:='2026-10-23T12:00:00+01:00'; BEGIN
 spec:='{"mode":"list","filters":[{"field":"age","op":"gte","value":18},{"field":"identity_card","op":"missing","value":null},{"field":"completed_consultations","op":"gte","value":2}],"consultationPeriod":{"from":"2026-09-01T00:00:00+01:00","to":"2026-10-01T00:00:00+01:00","axis":"started_at"}}';
 got:=app.search_patients(p_spec=>spec::text,p_as_of=>anchor);
 ASSERT (got->>'total')::int=1 AND got->'rows'->0->>'id'='b3000000-0000-4000-8000-000000000001','September aggregate or birthday lost';
 ASSERT got->'appliedSpec'->'consultationPeriod'=spec->'consultationPeriod','Missing period receipt';
 spec:=jsonb_set(spec,'{consultationPeriod,axis}','"ended_at"');
 ASSERT (app.search_patients(p_spec=>spec::text,p_as_of=>anchor)->>'total')::int=0,'Closure axis broadened';
 spec:='{"mode":"list","filterGroups":[[{"field":"identity_card","op":"missing","value":null}],[{"field":"phone","op":"present","value":null}]],"limit":1}';
 got:=app.search_patients(p_spec=>spec::text,p_as_of=>anchor);
 ASSERT (got->>'total')::int=3 AND jsonb_array_length(got->'rows')=1,'OR duplicate or Unicode missing text';
 next_page:=app.search_patients(p_spec=>(spec||jsonb_build_object('offset',1,'revision',got->>'revision'))::text,p_as_of=>anchor);
 ASSERT next_page->'rows'->0->>'id'<>got->'rows'->0->>'id','Pagination repeated member';
 ASSERT (app.search_patients(p_spec=>' {"mode":"count","filters":[{"field":"age","op":"gte","value":18}]}',p_as_of=>anchor)->>'total')::int=2,'Unknown ages or birthday';
 ASSERT (app.search_patients(p_spec=>' {"mode":"count","filters":[{"field":"outstanding_balance","op":"gt","value":800}]}',p_as_of=>anchor)->>'total')::int=0,'Visits multiplied payments';
 ASSERT (app.search_patients(p_spec=>' {"mode":"count","createdPeriod":{"from":"2026-09-01T00:00:00+01:00","to":"2026-10-01T00:00:00+01:00"}}',p_as_of=>anchor)->>'total')::int=2,'Creation boundary';
 ASSERT (app.search_patients(p_spec=>' {"mode":"count","population":"all"}',p_as_of=>anchor)->>'total')::int=5,'Cabinet isolation or archived population';
 ASSERT (app.query_alexa_records('consultations','{"patientId":"b3000000-0000-4000-8000-000000000001","mode":"count","status":"closed","dateAxis":"ended_at","from":"2026-09-01T00:00:00+01:00","to":"2026-10-01T00:00:00+01:00"}',anchor)->>'total')::int=1,'Record closure boundary';
 BEGIN PERFORM app.search_patients(p_spec=>'{"mode":"count","filters":[{"field":"sex","op":"eq","value":null}]}',p_as_of=>anchor); RAISE EXCEPTION 'Invalid sex accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN PERFORM app.search_patients(p_spec=>'{"mode":"count","filters":[{"field":"completed_consultations","op":"gte","value":2}]}',p_as_of=>'2026-10-23T12:00:00+01:00'); RAISE EXCEPTION 'Restricted clinical aggregate accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
RESET ROLE;
INSERT INTO app.jarvis_conversations(id,cabinet_id,utilisateur_id) VALUES
 ('b6000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$ DECLARE action_id uuid:='b7000000-0000-4000-8000-000000000001'; rejected_id uuid:='b7000000-0000-4000-8000-000000000002';
 conversation uuid:='b6000000-0000-4000-8000-000000000001'; args jsonb; affected uuid; refused boolean:=false; BEGIN
 args:='{"patient_id":"b3000000-0000-4000-8000-000000000001","practitioner_id":"b1000000-0000-4000-8000-000000000001","starts_at":"2030-09-01T10:00:00+01:00","duration_minutes":45,"kind":"suivi","notes_admin":"FICTIF"}';
 ASSERT app.propose_jarvis_action(conversation,'FICTIF demande','create_appointment',args,action_id)=action_id;
 BEGIN PERFORM app.execute_jarvis_action(action_id); EXCEPTION WHEN raise_exception THEN refused:=SQLERRM LIKE 'Action non confirm%'; END;
 ASSERT refused,'Execution without confirmation was accepted';
 ASSERT (SELECT count(*)=0 FROM app.appointments),'Unconfirmed proposal wrote an appointment';
 ASSERT app.propose_jarvis_action(conversation,'FICTIF répétition','create_appointment',args,action_id)=action_id;
 ASSERT (SELECT count(*)=1 FROM app.jarvis_actions),'Repeated proposal duplicated its action';
 PERFORM app.confirm_jarvis_action(action_id);
 affected:=app.execute_jarvis_action(action_id);
 ASSERT affected IS NOT NULL,'Confirmed fixture action did not execute';
 ASSERT app.execute_jarvis_action(action_id)=affected,'Replay did not return the verified original outcome';
 ASSERT (SELECT count(*)=1 FROM app.appointments),'Replay duplicated its business write';
 ASSERT app.get_alexa_action_outcome(action_id)->>'state'='executed','Outcome not verified';
 refused:=false;
 BEGIN PERFORM app.propose_jarvis_action(conversation,'FICTIF arguments modifiés','create_appointment',args||'{"duration_minutes":60}'::jsonb,action_id); EXCEPTION WHEN invalid_parameter_value THEN refused:=true; END;
 ASSERT refused,'Action identity admitted altered confirmed arguments';
 PERFORM app.propose_jarvis_action(conversation,'FICTIF refus','create_appointment',args,rejected_id);
 ASSERT app.reject_jarvis_action(rejected_id),'Rejection failed';
 refused:=false;
 BEGIN PERFORM app.execute_jarvis_action(rejected_id); EXCEPTION WHEN raise_exception THEN refused:=SQLERRM LIKE 'Action non confirm%'; END;
 ASSERT refused AND (SELECT count(*)=1 FROM app.appointments),'Rejected proposal executed';
END $$;
DO $$ DECLARE pid uuid:='b3000000-0000-4000-8000-000000000003'; cid uuid; stored uuid; state jsonb; payload jsonb;
 revision text; summary jsonb; refused boolean:=false; appointment uuid; BEGIN
 appointment:=app.create_appointment(pid,'b1000000-0000-4000-8000-000000000001',now()+interval '1 day',45,'FICTIF persistance','suivi');
 cid:=app.start_consultation(pid,appointment);
 ASSERT cid IS NOT NULL,'Fictitious session could not start';
 PERFORM app.save_raw_notes(cid,'FICTIF notes de travail A');
 state:=jsonb_build_object('notes_hash',encode(sha256(convert_to('FICTIF notes de travail A','UTF8')),'hex'),'notes_digest','fixture-A','context_digest','fixture-context','previous_consultation_id',NULL,'notes_snapshot',jsonb_build_object('rawNotes','FICTIF notes de travail A','notes','[]'::jsonb));
 payload:='{"resume":"FICTIF test de persistance","noteStructuree":{"subjective":"","objective":"","assessment":"","plan":""},"evolution":[],"pointsNonExplores":[]}';
 SELECT id INTO stored FROM app.save_session_analysis(cid,payload::text,state::text,'fixture-only','fixture-v1','fixture-prompt');
 ASSERT stored IS NOT NULL,'Session analysis not saved';
 ASSERT (SELECT content->>'resume'='FICTIF test de persistance' FROM app.get_consultation_analysis(cid)),'Session analysis did not reload';
 ASSERT (SELECT id=stored AND version=1 FROM app.save_session_analysis(cid,payload::text,state::text,'fixture-only','fixture-v1','fixture-prompt')),'Unchanged source duplicated its analysis';
 PERFORM app.save_raw_notes(cid,'FICTIF notes de travail B');
 ASSERT NOT EXISTS(SELECT 1 FROM app.save_session_analysis(cid,payload::text,state::text,'fixture-only','fixture-v1','fixture-prompt')),'Stale session notes were persisted';
 state:=jsonb_build_object('notes_hash',encode(sha256(convert_to('FICTIF notes de travail B','UTF8')),'hex'),'notes_digest','fixture-B','context_digest','fixture-context','previous_consultation_id',NULL,'notes_snapshot',jsonb_build_object('rawNotes','FICTIF notes de travail B','notes','[]'::jsonb));
 ASSERT (SELECT version=2 FROM app.save_session_analysis(cid,payload::text,state::text,'fixture-only','fixture-v1','fixture-prompt')),'Changed session could not create a new version';
 revision:=app.get_alexa_clinical_context(pid,1)->>'sourceRevision';
 payload:='{"schema":2,"apercu":{"nom":"FICTIF","diagnostics":[],"traitements":[],"contexte":[]},"chronologie":[],"anterieur":[],"etat_actuel":[]}';
 state:=jsonb_build_object('alexaSourceRevision',revision,'alexaNoteAreas',5);
 PERFORM app.save_alexa_case_summary(pid,payload::text,state::text,'fixture-only','fixture-v1','fixture-prompt');
 summary:=app.get_alexa_case_summary(pid);
 ASSERT summary->>'version'='1' AND summary->>'aJour'='true','Case summary did not reload fresh';
 PERFORM app.save_raw_notes(cid,'FICTIF notes de travail C');
 ASSERT app.get_alexa_case_summary(pid)->>'aJour'='false','Changed source remained fresh';
 BEGIN PERFORM app.save_alexa_case_summary(pid,payload::text,state::text,'fixture-only','fixture-v1','fixture-prompt'); EXCEPTION WHEN raise_exception THEN refused:=SQLERRM='stale-summary-context'; END;
 ASSERT refused,'Stale case summary was saved';
 state:=jsonb_build_object('alexaSourceRevision',app.get_alexa_clinical_context(pid,1)->>'sourceRevision','alexaNoteAreas',5);
 PERFORM app.save_alexa_case_summary(pid,payload::text,state::text,'fixture-only','fixture-v1','fixture-prompt');
 summary:=app.get_alexa_case_summary(pid);
 ASSERT summary->>'version'='2' AND summary->>'aJour'='true','Refreshed case summary did not reload';
END $$;
ROLLBACK;
\echo PASS session and case-summary save/reload, edit, stale-source rejection and new-version persistence; synthetic content, no model-generation claim.
\echo PASS confirmation, rejection, argument identity, replay and verified outcome; fictitious writes rolled back.
\echo PASS bounded patient SQL, independent expected memberships, periods, pagination and roles; fixtures rolled back.
