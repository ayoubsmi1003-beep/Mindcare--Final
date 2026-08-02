-- 014_storage_health_and_purges — §13 de 01-SCHEMA.md (RSK-1).
-- Le disque est une contrainte de sécurité, pas d'exploitation :
-- 🔴 Postgres sur disque plein NE RALENTIT PAS, il S'ARRÊTE — en pleine consultation.

BEGIN;

CREATE OR REPLACE VIEW app.storage_health AS
SELECT
    pg_size_pretty(pg_database_size(current_database()))  AS db_size,
    (SELECT count(*) FROM app.transcript_segments)        AS segments,
    (SELECT count(*) FROM audit.log)                      AS audit_rows,
    pg_size_pretty(pg_total_relation_size('audit.log'))   AS audit_size;

-- Purges. Appelées par une tâche planifiée (pg_cron ou Windows) — la fonction
-- existe dès maintenant pour que la tâche n'ait rien à inventer.
--
-- `transcript_segments` n'est JAMAIS purgé : il fait partie du dossier.
-- `audit.log` n'est pas purgé non plus : archivage hors ligne au-delà de
-- 24 mois, décision humaine. Aucune des deux ne figure ci-dessous, exprès.
CREATE OR REPLACE FUNCTION app.run_purges()
RETURNS TABLE (target text, removed bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_catalog AS $$
DECLARE n bigint;
BEGIN
    -- soumissions QR non validées, au-delà de 7 jours
    DELETE FROM app.pending_patients
    WHERE status = 'awaiting' AND expires_at < now();
    GET DIAGNOSTICS n = ROW_COUNT;
    target := 'pending_patients'; removed := n; RETURN NEXT;

    -- suggestions de l'IA au-delà de 90 jours : ce sont des propositions,
    -- pas le dossier (I7). Les supprimer n'enlève rien au dossier médical.
    DELETE FROM app.live_insights WHERE emitted_at < now() - interval '90 days';
    GET DIAGNOSTICS n = ROW_COUNT;
    target := 'live_insights'; removed := n; RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION app.run_purges() FROM PUBLIC, anon, authenticated;

INSERT INTO app.schema_migrations (version) VALUES ('014_storage_health_and_purges')
    ON CONFLICT DO NOTHING;

COMMIT;
