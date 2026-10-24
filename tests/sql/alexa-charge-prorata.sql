-- Wholly synthetic, disposable regression. All fixture writes are rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'alexa_eval_intelligence_fixture_20261023' THEN RAISE EXCEPTION 'Disposable fixture required'; END IF;
END $$;
INSERT INTO app.cabinets(id,name) VALUES
 ('c2000000-0000-4000-8000-000000000001','FICTIF prorata'),
 ('c2000000-0000-4000-8000-000000000002','FICTIF other cabinet');
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('c1000000-0000-4000-8000-000000000001','prorata-owner@fixture.invalid','{"full_name":"FICTIF owner"}'),
 ('c1000000-0000-4000-8000-000000000002','prorata-assistant@fixture.invalid','{"full_name":"FICTIF assistant"}'),
 ('c1000000-0000-4000-8000-000000000003','prorata-other@fixture.invalid','{"full_name":"FICTIF other"}'),
 ('c1000000-0000-4000-8000-000000000004','prorata-practitioner@fixture.invalid','{"full_name":"FICTIF practitioner"}');
INSERT INTO app.profiles(id,cabinet_id,role,full_name) VALUES
 ('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','owner','FICTIF owner'),
 ('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','assistant','FICTIF assistant'),
 ('c1000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000002','owner','FICTIF other'),
 ('c1000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000001','practitioner','FICTIF practitioner');
INSERT INTO app.charges(cabinet_id,practitioner_id,intitule,montant_dzd,categorie,type,frequence,date_charge,date_prochaine_echeance,actif,is_synthetic)
 SELECT 'c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001',label,amount,
 category::app.charge_categorie,kind::app.charge_type,frequency::app.charge_frequence,start_date::date,next_date::date,active,true
 FROM (VALUES
 ('FICTIF monthly',3100,'local','recurrente','mensuelle','2026-10-16','2026-11-16',true),
 ('FICTIF quarterly',9300,'personnel','recurrente','trimestrielle','2026-10-16','2027-01-16',true),
 ('FICTIF yearly',37200,'outils','recurrente','annuelle','2026-10-16','2027-10-16',true),
 ('FICTIF prior month',3100,'assurance','recurrente','mensuelle','2026-09-16','2026-11-16',true),
 ('FICTIF one-off',700,'autre','ponctuelle',NULL,'2026-10-20',NULL,true),
 ('FICTIF inactive',9999,'autre','recurrente','mensuelle','2026-01-01','2026-11-01',false),
 ('FICTIF future',9999,'autre','recurrente','mensuelle','2026-11-01','2026-12-01',true)
 ) x(label,amount,category,kind,frequency,start_date,next_date,active);
INSERT INTO app.charges(cabinet_id,practitioner_id,intitule,montant_dzd,categorie,type,frequence,date_charge,date_prochaine_echeance,is_synthetic)
 VALUES ('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000003','FICTIF other cabinet',900000,'local','recurrente','mensuelle','2026-01-01','2026-11-01',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
DO $$ DECLARE got jsonb; categories jsonb; BEGIN
 -- Independent hand calculation: 3*(3100*16/31)+3100+700 = 8600.
 ASSERT abs(app.charges_sur_periode('2026-10-01','2026-10-31')-8600)<0.000000000001,'Recurring charge imputed before its start date';
 ASSERT abs(app.charges_sur_periode('2026-09-01','2026-09-30')-1550)<0.000000000001,'Partial start month failed';
 ASSERT abs(app.charges_sur_periode('2026-09-01','2026-10-31')-10150)<0.000000000001,'Cross-month intersection failed';
 ASSERT abs(app.charges_sur_periode('2026-10-20','2026-10-25')-3100)<0.000000000001,'Period beginning after charge start failed';
 ASSERT abs(app.charges_sur_periode('2026-10-16','2026-10-16')-400)<0.000000000001,'Inclusive single day failed';
 ASSERT abs(app.charges_sur_periode('2026-08-01','2026-08-31')-0)<0.000000000001,'Future charges counted';
 got:=app.get_finance_overview('2026-10-01','2026-10-31');
 ASSERT got->'pulse'->>'charges_periode'='8600','Overview total differs from independent oracle';
 ASSERT got->'pulse'->>'resultat_net_periode'='-8600','Negative net result lost';
 SELECT jsonb_object_agg(item->>'cle',item->'montant') INTO categories
 FROM jsonb_array_elements(got->'composition'->'charges_par_categorie') item;
 ASSERT categories='{"local":1600,"personnel":1600,"outils":1600,"assurance":3100,"autre":700}'::jsonb,'Category prorata differs from independent oracle';
 ASSERT (SELECT sum((item->>'montant')::bigint)=8600 FROM jsonb_array_elements(got->'composition'->'charges_par_categorie') item),'Composition and total differ';
END $$;
RESET ROLE;
INSERT INTO app.charges(cabinet_id,practitioner_id,intitule,montant_dzd,categorie,type,frequence,date_charge,date_prochaine_echeance,is_synthetic)
 VALUES
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000004','FICTIF fractional quarter',1000,'local','recurrente','trimestrielle','2026-10-16','2027-01-16',true),
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000004','FICTIF fractional year',1001,'outils','recurrente','annuelle','2026-10-16','2027-10-16',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000004',true);
DO $$ DECLARE got jsonb; BEGIN
 -- (1000/3+1001/12)*16/31 = 215.096774..., rounded once to 215.
 ASSERT round(app.charges_sur_periode('2026-10-01','2026-10-31'))=215,'Practitioner scope or fractional frequency normalization changed';
 got:=app.get_finance_overview('2026-10-01','2026-10-31');
 ASSERT got->'pulse'->>'charges_periode'='215','Practitioner overview scope widened';
 ASSERT got->'pulse'->>'resultat_net_periode'='-215','Fractional net rounding changed';
 ASSERT (SELECT jsonb_object_agg(item->>'cle',item->'montant')='{"local":172,"outils":43}'::jsonb FROM jsonb_array_elements(got->'composition'->'charges_par_categorie') item),'Fractional category rounding changed';
END $$;
SELECT set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 ASSERT app.get_finance_overview('2026-10-01','2026-10-31') IS NULL,'Assistant finance rights widened';
 ASSERT abs(app.charges_sur_periode('2026-10-01','2026-10-31')-0)<0.000000000001,'Assistant accessed protected charges';
END $$;
RESET ROLE;
UPDATE app.charges SET actif=false WHERE cabinet_id='c2000000-0000-4000-8000-000000000001';
INSERT INTO app.charges(cabinet_id,practitioner_id,intitule,montant_dzd,categorie,type,frequence,date_charge,date_prochaine_echeance,is_synthetic)
 VALUES ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','FICTIF leap month',2900,'local','recurrente','mensuelle','2028-02-15','2028-03-15',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 ASSERT abs(app.charges_sur_periode('2028-02-01','2028-02-29')-1500)<0.000000000001,'Leap-month start intersection failed';
 ASSERT abs(app.charges_sur_periode('2028-02-29','2028-02-29')-100)<0.000000000001,'Leap-day fraction failed';
 ASSERT abs(app.charges_sur_periode('2028-03-01','2028-02-29')-0)<0.000000000001,'Reversed interval counted charges';
 ASSERT abs(app.charges_sur_periode(NULL,NULL)-0)<0.000000000001,'Null interval counted charges';
END $$;
ROLLBACK;
\echo PASS charge start date, month boundaries, normalized frequencies, category totals, negative net, leap year and protected roles; synthetic fixtures rolled back.
