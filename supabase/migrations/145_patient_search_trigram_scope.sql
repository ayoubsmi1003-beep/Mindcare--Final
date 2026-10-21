-- Repair 141's operator lookup inside the existing restricted search_path.
-- No data, permissions, search ordering or audit behavior is changed.
BEGIN;
DO $repair$
DECLARE v_definition text;
BEGIN
  SELECT pg_get_functiondef('app.search_patients(text,integer,integer)'::regprocedure)
    INTO v_definition;
  IF position('p.search_text % v_aiguille' IN v_definition) > 0 THEN
    EXECUTE replace(v_definition, 'p.search_text % v_aiguille',
      'p.search_text OPERATOR(public.%) v_aiguille');
  ELSIF position('p.search_text OPERATOR(public.%) v_aiguille' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Patient search definition differs from expected 141';
  END IF;
END;
$repair$;
INSERT INTO app.schema_migrations(version) VALUES ('145_patient_search_trigram_scope')
  ON CONFLICT DO NOTHING;
COMMIT;
