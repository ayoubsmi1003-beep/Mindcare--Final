-- Execute only against the isolated evaluation database. Everything rolls back.
BEGIN;
DO $$ BEGIN IF current_database() NOT LIKE 'alexa_eval_%' THEN RAISE EXCEPTION 'Evaluation database required'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT practitioner_id::text FROM app.consultations LIMIT 1),true);
WITH created AS (
 INSERT INTO app.consultations(cabinet_id,practitioner_id,patient_id,status,is_synthetic)
 SELECT cabinet_id,practitioner_id,patient_id,'open',true FROM app.consultations LIMIT 1 RETURNING id
) SELECT set_config('evaluation.consultation',(SELECT id::text FROM created),true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE id uuid:=current_setting('evaluation.consultation')::uuid; v jsonb; BEGIN
 v:=app.save_session_details(id,'{"focus":["Sommeil"],"focusLibre":"Réveils nocturnes","mesures":{"anxiete":4,"sommeil":7,"humeur":null},"scoreConvention":"difficulty-v1"}');
 IF v IS NULL OR app.get_session_details(id) IS DISTINCT FROM v THEN RAISE EXCEPTION 'Session detail readback failed'; END IF;
 BEGIN
  PERFORM app.save_session_details(id,'{"focus":[],"focusLibre":"","mesures":{"anxiete":11,"sommeil":null,"humeur":null},"scoreConvention":"difficulty-v1"}');
  RAISE EXCEPTION 'Out of range score accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 IF app.get_session_details(id) IS DISTINCT FROM v THEN RAISE EXCEPTION 'Invalid score changed saved details'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM app.profiles WHERE role='assistant' LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF app.get_session_details(current_setting('evaluation.consultation')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'Clinical details exposed to assistant'; END IF;
END $$;
ROLLBACK;
