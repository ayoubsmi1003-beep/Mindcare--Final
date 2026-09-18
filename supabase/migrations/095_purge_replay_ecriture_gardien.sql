-- 095_purge_replay_ecriture_gardien — M09 · correctif 094 (appliquee, jamais editee — regle 9).
--
-- DIAGNOSTIC (mesure, pas suppose) : `app.purger_replays()` (094) echoue en
-- execution avec `permission denied for table ai_replay_cases`. Cause : la
-- fonction est SECURITY DEFINER (proprietaire app_gatekeeper) mais 094
-- n'accorde a app_gatekeeper que SELECT, et le RLS FORCE s'applique aussi
-- au proprietaire (sans policy d'ecriture, tout INSERT/UPDATE/DELETE est
-- refuse, meme en DEFINER). Prouve a l'execution le 2026-09-16.
--
-- CORRECTIF MINIMAL : GRANT d'ecriture a app_gatekeeper seul (motif 058 :
-- ecritures reservees aux portes DEFINER verifiees, jamais d'acces direct).
-- AUCUN changement aux grants authenticated/mindcare_app/service_role :
-- l'applicatif tourne en `authenticated`/`anon` (withCaller : SET LOCAL
-- ROLE, jamais app_gatekeeper) et reste sans ecriture (pas de policy
-- d'ecriture : RLS FORCE refuse par defaut). Aucune porte d'ecriture
-- exposee : la seule ecriture possible reste `purger_replays()`.
--
-- Conventions : BEGIN/COMMIT + `schema_migrations`, jamais DROP.

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.ai_replay_runs  TO app_gatekeeper;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.ai_replay_cases TO app_gatekeeper;

COMMENT ON TABLE app.ai_replay_runs IS
  'M09 : en-tetes de runs eval:replay (hashes/verdicts/metriques, jamais de texte patient). Retention 12 mois, purge operateur. Ecriture : purger_replays() uniquement (095).';

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('095_purge_replay_ecriture_gardien')
    ON CONFLICT DO NOTHING;

COMMIT;
