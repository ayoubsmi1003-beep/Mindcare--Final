-- Only loaded by checkpoint-aftercare.mjs inside its freshly verified empty native cluster.
ALTER ROLE mindcare_app LOGIN NOINHERIT;
GRANT authenticated,anon TO mindcare_app;
BEGIN;
SELECT app.set_deployment_environment('self-hosted','Disposable synthetic transport qualification');
INSERT INTO app.cabinets(id,name) VALUES('b0000000-0000-4000-8000-000000000001','Synthetic transport clinic');
INSERT INTO auth.users(id) VALUES('b1000000-0000-4000-8000-000000000001'),('b1000000-0000-4000-8000-000000000003');
INSERT INTO app.profiles(id,cabinet_id,role,full_name,is_active) VALUES
 ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','owner','Synthetic doctor',true),
 ('b1000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001','assistant','Synthetic reception',true);
INSERT INTO app.patients(id,cabinet_id,practitioner_id,record_number,first_name,last_name,phone,is_synthetic) VALUES
 ('b2000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','SYNTHETIC-HTTP','Synthetic','Transport','0000000001',true);
INSERT INTO app.medications(id,inn,brand_name) VALUES('b7000000-0000-4000-8000-000000000001','Synthetic substance','Synthetic medication');
INSERT INTO app.patient_treatments(id,cabinet_id,practitioner_id,patient_id,medication_id,dose,dose_unit,frequency,timing,instructions,start_date,is_synthetic) VALUES('b8000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001','5','mg','Matin et soir','["matin","soir"]','Synthetic instructions','2026-11-01',true);
INSERT INTO app.appointments(id,cabinet_id,practitioner_id,patient_id,starts_at,ends_at,status) VALUES('b9000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','2026-11-20T10:00:00+01:00','2026-11-20T11:00:00+01:00','confirmed');
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT app.verify_aftercare_binding('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','self','Synthetic identity/consent verified',1,true);
SELECT app.publish_aftercare_object('b3000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002',0,'mission','{"title":"Synthetic mission","purpose":"Observe","instructions":"Write a reflection","status":"published"}','b6000000-0000-4000-8000-000000000001',true);
COMMIT;
