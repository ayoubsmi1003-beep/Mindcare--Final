-- bootstrap.sql — banc d'essai JETABLE. Ne vit PAS dans supabase/migrations/.
--
-- Reproduit le strict minimum que Supabase Cloud fournit avant 001, et rien de
-- plus : trois rôles, le schéma `auth`, `auth.users`, `auth.uid()`. Tout ce que
-- les migrations attendent, mesuré par inventaire (grep), pas supposé.
--
-- `auth.uid()` lit un GUC de session. C'est ce qui permet aux contrôles de
-- prendre l'identité d'une praticienne SANS jeton JWT réel : `SET ROLE
-- authenticated` + `SET request.jwt.claim.sub`. Sur le cloud, la même fonction
-- lit la même variable, posée par PostgREST à partir du JWT.

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Colonnes reprises de ce que 015 insère RÉELLEMENT, pas de ce que je supposais :
-- une table à deux colonnes a fait échouer le premier rejeu sur `instance_id`.
-- C'est le banc d'essai qui était faux, pas la migration — et c'est précisément
-- ce qu'un rejeu prouve et qu'une relecture n'aurait pas vu.
CREATE TABLE IF NOT EXISTS auth.users (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id        uuid,
    aud                varchar(255),
    role               varchar(255),
    email              varchar(255),
    encrypted_password varchar(255),
    created_at         timestamptz,
    updated_at         timestamptz
);

-- Signature et comportement identiques à ceux de Supabase : STABLE, rend NULL
-- hors session authentifiée plutôt que de lever. Une RLS qui compare à NULL
-- refuse — c'est le défaut sûr, et c'est celui du cloud.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
