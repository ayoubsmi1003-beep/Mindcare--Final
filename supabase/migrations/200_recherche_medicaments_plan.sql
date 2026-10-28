-- 200_recherche_medicaments_plan — le plan générique est le bon.
--
-- 199 posait `plan_cache_mode = force_custom_plan` : mesuré 1,8 s par appel
-- (le planificateur choisissait un nested loop sur `unnest(v_tokens)`).
-- Le mode automatique rend 48–69 ms sur les mêmes requêtes. On réinitialise.
BEGIN;

ALTER FUNCTION app.search_medications_page(text, integer, integer)
  RESET plan_cache_mode;

INSERT INTO app.schema_migrations (version) VALUES ('200_recherche_medicaments_plan')
  ON CONFLICT DO NOTHING;

COMMIT;
