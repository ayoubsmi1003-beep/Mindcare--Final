-- alexa-installed-schema-check.sql: read-only. Reports what an installed database really holds for
-- the reads Alexa depends on. A row in app.schema_migrations doesn't prove a function's signature:
-- the evaluation database records 211 as applied and still has the older three-argument workload gate.
--
-- Run on the cabinet database with an administrator role, then read the rows. Nothing is written and
-- no patient data is selected. To run it:
--   psql -X -A -t -f scripts/alexa-installed-schema-check.sql <connection>

BEGIN READ ONLY;

SELECT 'migration ' || m.wanted || ' : ' ||
       CASE WHEN EXISTS (SELECT 1 FROM app.schema_migrations s WHERE s.version LIKE m.wanted || '%') THEN 'present' ELSE 'absent' END
FROM (VALUES ('207'), ('208'), ('209'), ('210'), ('211'), ('212'), ('213'), ('214')) AS m(wanted);

SELECT 'function ' || f.wanted || '(' ||
       COALESCE((SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' / ')
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'app' AND p.proname = f.wanted), 'ABSENT') || ')'
FROM (VALUES ('list_medication_workload'), ('get_analysis_overview'), ('list_patient_medication_timeline'), ('get_alexa_case_summary')) AS f(wanted);

SELECT 'treatment screen call : ' ||
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'app' AND p.proname = 'list_medication_workload'
                           AND 'p_attention' = ANY (p.proargnames))
            THEN 'compatible (the gate accepts p_attention)'
            ELSE 'INCOMPATIBLE (the screen sends p_attention, the gate lacks it)' END;

SELECT 'alexa workload call : ' ||
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'app' AND p.proname = 'list_medication_workload'
                           AND 'p_query' = ANY (p.proargnames) AND 'p_limit' = ANY (p.proargnames) AND 'p_offset' = ANY (p.proargnames))
            THEN 'compatible' ELSE 'INCOMPATIBLE' END;

SELECT 'grant authenticated ' || p.proname || ' : ' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'app' AND p.proname IN ('list_medication_workload', 'get_analysis_overview', 'list_patient_medication_timeline', 'get_alexa_case_summary');

ROLLBACK;
