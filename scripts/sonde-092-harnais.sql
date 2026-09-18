-- sonde-092-harnais — harnais MINIMAL pour valider 092 sur un PostgreSQL + pgvector,
-- SANS la chaîne applicative (pas de auth.*, pas de app.profiles réel).
--
-- USAGE (bac à sable UNIQUEMENT, jamais dev/prod) :
--   docker exec ... psql -U mindcare -d m07scratch -v ON_ERROR_STOP=1 -f sonde-092-harnais.sql
--   docker cp supabase/migrations/092_knowledge_rag.sql <conteneur>:/tmp/092.sql
--   docker exec ... psql -U mindcare -d m07scratch -v ON_ERROR_STOP=1 -f /tmp/092.sql
--   ... -f scripts/sonde-092-comportement.sql
--
-- DIVERGENCES ASSUMÉES vs production (documentées, pas cachées) :
--   · app.current_cabinet() → stub NULL (pas de JWT ici) : les lignes partagées
--     sont visibles, les lignes cabinet ne le sont pas — exactement ce que la
--     RLS doit faire pour un appelant sans cabinet.
--   · app.immutable_unaccent() → stub lower() (la vraie fonction exige le
--     dictionnaire unaccent ; la mécanique GENERATED/GIN est ce qui est éprouvé).
--   · app.profiles/app.cabinets → coquilles (PK seules) pour les FK.
--   · Propriétaire des portes : mindcare (superuser du bac) au lieu
--     d'app_gatekeeper — la sémantique OWNER/GRANT est relue, pas rejouée.
BEGIN;

-- Rôles cluster-globaux : idempotents (le bac est reconstruit entre passes).
DO $$ BEGIN
    CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE ROLE app_gatekeeper NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE SCHEMA app;

CREATE TABLE app.cabinets (id uuid PRIMARY KEY);
CREATE TABLE app.profiles (id uuid PRIMARY KEY);
-- Coquille de 001 (suivi des migrations) pour valider l'enregistrement 092.
CREATE TABLE app.schema_migrations (version text PRIMARY KEY);

CREATE OR REPLACE FUNCTION app.current_cabinet()
RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE OR REPLACE FUNCTION app.immutable_unaccent(text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT lower($1) $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;

GRANT USAGE ON SCHEMA app TO authenticated;
-- Miroir 020 §2 : app_gatekeeper est membre de authenticated (INHERIT TRUE).
-- Sans cela, les portes DEFINER (propriété app_gatekeeper) n'ont pas USAGE
-- sur le schéma dans le bac — en production l'héritage le donne.
GRANT authenticated TO app_gatekeeper;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, app_gatekeeper;

COMMIT;
