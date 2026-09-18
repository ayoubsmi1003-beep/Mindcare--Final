-- 096_replay_maintenance_gardien — M09 · correctif 094 (appliquee, jamais editee — regle 9).
--
-- DIAGNOSTIC (mesure, pas suppose) : `app.purger_replays()` (094, grants
-- 095) ne supprime rien (0,0) meme sur des runs expires. Cause : le RLS
-- FORCE s'evalue contre le role INVOQUANT dans les portes DEFINER (prouve
-- par contraste : `get_jarvis_history` en contexte authenticated lit
-- correctement, `purger_replays` invoque en superuser ne voit aucune
-- ligne — aucune policy TO postgres, PUBLIC revoque). La porte de
-- maintenance n'a donc aucune ligne visible a supprimer.
--
-- CORRECTIF MINIMAL : policy de maintenance `USING (true)` reservee a
-- app_gatekeeper (atteignable uniquement via superuser SET ROLE ou les
-- portes DEFINER qu'il possede — jamais depuis l'applicatif, qui tourne
-- en `authenticated`/`anon` per withCaller). `get_replay_history` reste
-- borne par son WHERE explicite (cabinet + role, NULL hors perimetre —
-- prouve), independamment du RLS. Aucun changement aux policies
-- authenticated ni aux GRANTs applicatifs.
--
-- Conventions : BEGIN/COMMIT + `schema_migrations`, jamais DROP.

BEGIN;

CREATE POLICY ai_replay_runs_maintenance ON app.ai_replay_runs
    FOR ALL TO app_gatekeeper
    USING (true)
    WITH CHECK (true);

CREATE POLICY ai_replay_cases_maintenance ON app.ai_replay_cases
    FOR ALL TO app_gatekeeper
    USING (true)
    WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('096_replay_maintenance_gardien')
    ON CONFLICT DO NOTHING;

COMMIT;
