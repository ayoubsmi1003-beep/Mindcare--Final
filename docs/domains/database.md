# Domaine base de données (CURRENT)

PURPOSE: PostgreSQL 16 local (exigé par `WITH INHERIT` de `020`/`010` ;
mentions « 15 » ailleurs = STALE), RLS comme décideur, portes comme seul chemin
d'écriture. Historique : `supabase/migrations/` (85 fichiers `001`–`087`,
trous volontaires `031`/`035` — ne jamais renuméroter ni éditer l'appliqué).
RÔLES: `app_gatekeeper` (`020`, portes métier) · `auth_gatekeeper` (`070`,
sessions) · `egress_gatekeeper` (`071`, audit egress) · `mindcare_app`
(NOINHERIT, connexion applicative) · `service_role` factice SANS BYPASSRLS.
ACCÈS: navigateur → `httpDbPort` → `/api/*` → `frontiere.ts` (Zod + allowlist
74 RPC générés) → `withCaller/withAuthGate/withEgressGate` → `PgDataPort`
(`server/db/pgPort.ts`, seul `pg` valeur = `pool.ts`).
DÉMARRAGE: `src/server/demarrage.ts` + `scripts/verifier-base.mjs` REFUSENT
de démarrer si le disque ≠ la base (jamais de réparation silencieuse).
`garde-origine.mjs` refuse si le PORT est pris.
INVARIANTS: 1 fichier = 1 transaction · `FOR UPDATE` ×45 · compteurs table
(jamais `SEQUENCE`) · `assert_synthetic` sur tables patient (`016` + `038` +
`074`, vérifié par `checkpoint-j1a.sh:246` + `preflight.sh:372`) · triggers
`trg_audit` · `deployment` verrouillé par trigger GUC (`016`).
TESTS: intégration `demarrage-sante`/`frontiere-donnees`/`identite-pool`/
`auth-locale` (exigent `MINDCARE_TEST_DATABASE_URL`, sinon NOT RUN — jamais PASS) ·
unit `verifier-base` · `verify-migrations.sh` (statique) · `checkpoint-j1a.sh` (T10).
KNOWN RISKS: `014 run_purges()` propriété `postgres` (scheduler seul, VERIFIED SAFE) ·
re-bascule `cloud-dev` ne requalifie pas le passé (`016:246-248`, cf. ARCHITECTURE.md) ·
`032` coquille vide assumée.
FORBIDDEN: éditer/supprimer une migration · `GRANT`/`REVOKE`/`OWNER TO` sans ADR ·
`FORCE RLS` supposé (piège `019`) · `supabase db reset` (bloqué par hook).
