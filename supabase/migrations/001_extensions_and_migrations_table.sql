-- 001_extensions_and_migrations_table — §1 et §1.1 de 01-SCHEMA.md
-- pgvector est volontairement ABSENT : Mois 2, avec le GPU (§17).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- recherche floue sur les noms
CREATE EXTENSION IF NOT EXISTS unaccent;     -- recherche insensible aux accents

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS app.schema_migrations (
    version       text PRIMARY KEY,
    applied_at    timestamptz NOT NULL DEFAULT now(),
    applied_by    text        NOT NULL DEFAULT current_user,
    checksum      text,
    execution_ms  integer
);

-- ---------------------------------------------------------------------------
-- Privilèges de base — la RLS RESTREINT, elle n'ACCORDE pas
-- ---------------------------------------------------------------------------
-- Sans ces droits, toute requête applicative échoue sur « permission denied for
-- schema app », policies parfaitement écrites ou non. Supabase accorde
-- automatiquement les droits sur `public`, mais PAS sur un schéma personnalisé.
-- Constaté en éprouvant les migrations hors ligne — le cloud aurait rendu la
-- même erreur, mais plus tard et plus cher.
--
-- `ALTER DEFAULT PRIVILEGES` couvre les tables des migrations SUIVANTES : une
-- table ajoutée demain hérite des droits sans qu'on ait à y penser. Ce qui la
-- protège reste sa RLS, obligatoire et vérifiée par le test T10.
GRANT USAGE ON SCHEMA app   TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA audit TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA app
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
    GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

-- Le journal d'audit : lecture seule. 013 révoque explicitement UPDATE/DELETE.
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
    GRANT SELECT, INSERT ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
    GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

-- La table de suivi des migrations porte sa RLS comme les autres : le test T10
-- n'admet aucune exception, et une exception qu'on s'accorde est une exception
-- qu'on oublie. Lecture seule pour l'application ; les migrations l'écrivent
-- avec le rôle qui les applique.
ALTER TABLE app.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.schema_migrations FORCE  ROW LEVEL SECURITY;
GRANT SELECT ON app.schema_migrations TO authenticated, service_role;
CREATE POLICY schema_migrations_read ON app.schema_migrations
    FOR SELECT TO authenticated USING (true);

-- `unaccent` est utilisé dans un index de 004. Un index doit être IMMUTABLE, or
-- `unaccent(text)` ne l'est pas (il dépend d'un dictionnaire modifiable). On
-- fige donc un enrobage immuable plutôt que de renoncer à l'index trigram.
CREATE OR REPLACE FUNCTION app.immutable_unaccent(text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = public, pg_catalog AS $$
    SELECT public.unaccent('public.unaccent', $1);
$$;

INSERT INTO app.schema_migrations (version) VALUES ('001_extensions_and_migrations_table')
    ON CONFLICT DO NOTHING;

COMMIT;
