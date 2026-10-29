-- 201_record_missing_schema_versions — répare le registre de deux migrations
-- antérieures qui ont appliqué leurs objets sans s'enregistrer.
--
-- 167_alexa_session_summary et 168_alexa_summary_source_guard n'ont pas de
-- `INSERT INTO app.schema_migrations`. Leur DDL a bien été appliqué, mais le
-- contrôle de démarrage du cabinet compare le disque au registre et refuse de
-- servir une base où ces versions manquent. On ne modifie PAS les migrations
-- appliquées : on ajoute une migration neuve, idempotente, qui vérifie d'abord
-- que les fonctions existent réellement.
--
-- FAIL CLOSED : si l'une des fonctions manque, la migration lève et le registre
-- n'est pas maquillé. Une base réellement incomplète doit être réparée, pas
-- déclarée à jour.

BEGIN;

DO $bloc$
DECLARE
  v_context boolean;
  v_analysis boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app'
       AND p.proname = 'get_alexa_clinical_context'
  ) INTO v_context;

  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app'
       AND p.proname = 'save_session_analysis'
  ) INTO v_analysis;

  IF NOT v_context OR NOT v_analysis THEN
    RAISE EXCEPTION
      'Registre incomplet : les fonctions de 167/168 sont absentes. Migration refusée.'
      USING HINT = 'Restaurer la sauvegarde pré-mise à jour et rejouer les migrations manquantes.';
  END IF;

  INSERT INTO app.schema_migrations (version)
  VALUES ('167_alexa_session_summary')
  ON CONFLICT DO NOTHING;

  INSERT INTO app.schema_migrations (version)
  VALUES ('168_alexa_summary_source_guard')
  ON CONFLICT DO NOTHING;
END $bloc$;

INSERT INTO app.schema_migrations (version)
VALUES ('201_record_missing_schema_versions')
ON CONFLICT DO NOTHING;

COMMIT;
