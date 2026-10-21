-- User-authorized query-local RLS identity evaluation, 2026-10-07.
-- Same role, cabinet and practitioner predicates; no privilege changes.
BEGIN;
DO $optimize$
DECLARE p record; v_using text; v_check text; v_command text;
BEGIN
  FOR p IN SELECT * FROM pg_policies WHERE schemaname='app'
    AND tablename IN ('patients','medications') LOOP
    v_using := replace(replace(p.qual, 'app.current_cabinet()', '(SELECT app.current_cabinet())'),
      'app."current_role"()', '(SELECT app.current_role())');
    v_check := replace(replace(p.with_check, 'app.current_cabinet()', '(SELECT app.current_cabinet())'),
      'app."current_role"()', '(SELECT app.current_role())');
    v_using := replace(v_using, 'app.can_see_clinical(practitioner_id)',
      '(CASE (SELECT app.current_role()) WHEN ''owner''::app.user_role THEN true WHEN ''practitioner''::app.user_role THEN practitioner_id = (SELECT auth.uid()) ELSE false END)');
    v_check := replace(v_check, 'app.can_see_clinical(practitioner_id)',
      '(CASE (SELECT app.current_role()) WHEN ''owner''::app.user_role THEN true WHEN ''practitioner''::app.user_role THEN practitioner_id = (SELECT auth.uid()) ELSE false END)');
    v_command := format('ALTER POLICY %I ON app.%I',p.policyname,p.tablename);
    IF v_using IS NOT NULL THEN v_command := v_command || format(' USING (%s)',v_using); END IF;
    IF v_check IS NOT NULL THEN v_command := v_command || format(' WITH CHECK (%s)',v_check); END IF;
    EXECUTE v_command;
  END LOOP;
END;
$optimize$;
INSERT INTO app.schema_migrations(version) VALUES ('146_search_rls_initplans')
  ON CONFLICT DO NOTHING;
COMMIT;
