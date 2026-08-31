-- 000_platform_compat — la plateforme Supabase, réduite à ce que le schéma utilise.
--
-- ═══ CE QUE CE FICHIER EST, ET CE QU'IL N'EST PAS ═════════════════════════════
--
-- Ce n'est PAS une migration. Il ne s'enregistre pas dans `app.schema_migrations`
-- et ne porte pas de numéro dans la chaîne 001–069. Un `000_` déposé dans
-- `supabase/migrations/` réécrirait rétroactivement une chaîne DÉJÀ APPLIQUÉE
-- (69 versions enregistrées) — ce que la règle 9 de CLAUDE.md interdit. Il est
-- joué UNE FOIS par l'installateur, avant `db-migrate.sh`, sur une base nue.
--
-- Son unique fonction : poser les quelques objets que Supabase fournissait et
-- qu'un PostgreSQL 15 nu n'a pas, pour que les migrations 001 à 069 s'appliquent
-- SANS ÊTRE MODIFIÉES. L'inventaire a été fait, il est court et il est clos :
--
--   auth.uid()            142 appels dans 35 migrations
--   auth.users            003 (clé étrangère de app.profiles) et 015 (semis)
--   extensions.digest     062 et 064 (061 appelle `digest` non qualifié)
--   anon/authenticated/service_role   les policies et les GRANT les nomment
--
-- Storage, Realtime, pg_cron, Vault, GraphQL : AUCUN usage dans les 69
-- migrations. Rien n'est posé pour eux — un adaptateur qu'on pose « au cas où »
-- est une surface qu'on ne teste jamais.
--
-- `NOTIFY pgrst, 'reload schema'` (présent dans plusieurs migrations) n'a besoin
-- d'AUCUN adaptateur : en PostgreSQL natif, un NOTIFY sur un canal que personne
-- n'écoute est un no-op silencieux, et le canal n'a pas à exister.
--
-- ═══ QUI JOUE LES MIGRATIONS, ET POURQUOI CE N'EST PAS UN DÉTAIL ══════════════
--
-- Les migrations doivent être jouées par `postgres`, le superutilisateur natif.
-- Ce n'est pas un raccourci de confort, c'est la reproduction FIDÈLE de la
-- plateforme d'origine, et deux mécanismes en dépendent :
--
--   1. `013_audit_schema_and_triggers.sql` §83 le dit sans ambiguïté : le rôle
--      qui exécute le déclencheur d'audit doit contourner la RLS, « sinon
--      l'insertion dans le journal échoue — et avec elle TOUTE écriture sur les
--      tables auditées ». Sur Supabase ce rôle est `postgres`, porteur de
--      `rolbypassrls`. Un propriétaire ordinaire casserait toutes les écritures.
--
--   2. Sur 112 fonctions `SECURITY DEFINER`, une soixantaine seulement reçoit un
--      `ALTER FUNCTION … OWNER TO app_gatekeeper` explicite. Les autres restent
--      la propriété de qui les a créées. Changer ce propriétaire changerait donc
--      la sémantique effective d'une cinquantaine de fonctions d'un coup — c'est
--      exactement la faute de la migration 018, et elle a coûté une session.
--
-- Ce qui protège la cloison n'est PAS la faiblesse du propriétaire : c'est
-- `app_gatekeeper`, créé par 020, sans LOGIN ni BYPASSRLS, et les deux
-- assertions de 021. Elles s'exécutent ici comme sur Supabase et échouent aussi
-- fort. On ne déplace pas le mur, on rebâtit le terrain sous lui.
--
-- ═══ IDEMPOTENT ═══════════════════════════════════════════════════════════════
-- Rejouable sans effet de bord : l'installateur peut être relancé après un
-- échec partiel sans qu'on ait à savoir où il s'était arrêté.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Les schémas de plateforme
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;

-- ---------------------------------------------------------------------------
-- 2 · Les rôles nommés par les policies et les GRANT
-- ---------------------------------------------------------------------------
-- 001 fait `GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role` :
-- ces trois rôles doivent exister AVANT la première migration.
--
-- NOLOGIN : aucune session ne s'ouvre directement sous eux. L'application se
-- connecte sous `mindcare_app` (posé en phase 2) et prend le rôle voulu par
-- `SET LOCAL ROLE` — le seul mécanisme qui garantit qu'une identité ne survit
-- pas à sa transaction.
--
-- `service_role` est créé pour que les GRANT des migrations ne cassent pas, mais
-- il reste SANS TITULAIRE : rien dans l'architecture locale ne s'en sert. Sur
-- Supabase il portait BYPASSRLS ; ici il ne le porte pas, et c'est un
-- durcissement, pas une régression — 020 §« service_role reste exclu » explique
-- que lui ouvrir un chemin reviendrait à offrir un export propre.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- ASSERTION, comme en 020 : on vérifie au lieu d'imposer. Si `authenticated`
-- portait BYPASSRLS, toute la RLS du dépôt deviendrait décorative, et rien
-- d'autre dans la chaîne ne le remarquerait.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles
              WHERE rolname IN ('anon','authenticated','service_role')
                AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION
      'anon/authenticated/service_role portent LOGIN, SUPERUSER ou BYPASSRLS.'
      USING HINT = 'La RLS des 69 migrations serait contournée ou une session '
                   'pourrait s''ouvrir directement sous un rôle de policy.';
  END IF;
END $$;

-- `app_gatekeeper` n'est VOLONTAIREMENT PAS créé ici. La migration 020 le crée
-- dans un bloc conditionnel `IF NOT EXISTS` puis VÉRIFIE ses attributs. Le
-- pré-créer ferait sauter la création et laisserait l'assertion valider des
-- attributs posés ailleurs — on perdrait le contrôle au moment précis où il
-- compte. 020 est le propriétaire de ce rôle, ici comme sur Supabase.

-- ---------------------------------------------------------------------------
-- 3 · auth.users — la table d'identité, réduite à son usage réel
-- ---------------------------------------------------------------------------
-- Colonnes retenues, et d'où vient chacune :
--   · 015 insère (id, instance_id, aud, role, email, encrypted_password,
--     created_at, updated_at) ;
--   · 003 pose `app.profiles.id REFERENCES auth.users(id) ON DELETE RESTRICT` ;
--   · `scripts/compte-praticienne.sh` et `dev-account.sh` écrivent en plus
--     email_confirmed_at et les jetons GoTrue, qu'ils `coalesce` à ''.
-- Les jetons n'ont plus de fonction (GoTrue est parti) mais restent présents et
-- nullables : c'est ce qui laisse les scripts de comptes marcher SANS ÊTRE
-- RÉÉCRITS, et un script de compte qu'on réécrit est un script qu'on reteste.
CREATE TABLE IF NOT EXISTS auth.users (
  id                          uuid PRIMARY KEY,
  instance_id                 uuid,
  aud                         text,
  role                        text,
  email                       text UNIQUE,
  encrypted_password          text,
  email_confirmed_at          timestamptz,
  last_sign_in_at             timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  is_active                   boolean     NOT NULL DEFAULT true,
  confirmation_token          text,
  recovery_token              text,
  email_change_token_new      text,
  email_change_token_current  text,
  email_change                text,
  phone_change                text,
  phone_change_token          text,
  reauthentication_token      text,
  raw_app_meta_data           jsonb,
  raw_user_meta_data          jsonb
);

COMMENT ON TABLE auth.users IS
  'Remplace la table GoTrue. Injoignable par l''application : aucune policy, '
  'et FORCE RLS. Seules les fonctions SECURITY DEFINER de 070_local_auth la '
  'lisent, et elles ne rendent jamais le hachage.';

-- LA TABLE EST INJOIGNABLE, ET C'EST LE POINT.
-- `ENABLE` + `FORCE` sans AUCUNE policy = personne ne lit, personne n'écrit,
-- propriétaire compris. Un hachage de mot de passe ne doit jamais pouvoir
-- remonter par une lecture de routine, et l'absence de policy est une garantie
-- plus solide qu'une policy restrictive : il n'y a rien à contourner.
-- L'authentification passera par des fonctions SECURITY DEFINER (070), seule
-- surface, et elles ne rendent qu'un `uuid`.
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.users FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON auth.users FROM PUBLIC;
REVOKE ALL ON auth.users FROM anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4 · auth.uid() — l'identité de la session
-- ---------------------------------------------------------------------------
-- LE NOM DU GUC N'EST PAS LIBRE. `request.jwt.claim.sub` est déjà celui que
-- pilotent `scripts/checkpoint-adr019.sh`, `checkpoint-j1a.sh`,
-- `checkpoint-patients-v2.sql` et `checkpoint-longitudinal.sql` par
-- `SET LOCAL request.jwt.claim.sub = …`, et celui que cite le commentaire de
-- 015. En le conservant, toute la suite de tests RLS existante devient la
-- recette de cette migration, SANS QU'UNE LIGNE N'EN SOIT MODIFIÉE. En changer
-- rendrait ces tests verts sans qu'ils prouvent quoi que ce soit.
--
-- `STABLE` et non `IMMUTABLE` : la valeur change d'une transaction à l'autre.
-- `IMMUTABLE` autoriserait le planificateur à replier le résultat dans un plan
-- mis en cache — une identité figée pour toutes les sessions suivantes.
--
-- Le second argument `true` de `current_setting` rend NULL au lieu de lever
-- quand le GUC n'est pas posé : `anon` avant connexion doit obtenir NULL, pas
-- une erreur. `nullif(…, '')` traite la chaîne vide de la même façon, parce que
-- `set_config(…, '', true)` est la manière naturelle d'écrire « personne ».
--
-- Une valeur non conforme lève au CAST, délibérément : une identité illisible
-- doit arrêter la requête, jamais dégrader en NULL — NULL, ici, ressemble trop
-- à « visiteur légitime ».
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

COMMENT ON FUNCTION auth.uid() IS
  'Identité de la session, lue dans le GUC request.jwt.claim.sub que pose '
  'withCaller() par SET LOCAL. Même nom de GUC que les checkpoints RLS du '
  'dépôt : leur verdict reste valide sans modification.';

GRANT USAGE   ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5 · extensions.digest — l'alias, pas un déménagement
-- ---------------------------------------------------------------------------
-- 001 fait `CREATE EXTENSION pgcrypto` sans qualifier : sur une base nue,
-- pgcrypto atterrit donc dans `public`. Mais 062 et 064 appellent
-- `extensions.digest(...)` (Supabase installe ses extensions dans ce schéma),
-- pendant que 061 appelle `digest(...)` non qualifié.
-- LES DEUX CHEMINS DOIVENT MARCHER, d'où un alias plutôt qu'un déplacement :
-- déplacer l'extension casserait 061, la dupliquer casserait 001.
--
-- Les deux signatures sont posées parce que les deux existent en pgcrypto et
-- qu'on ne veut pas dépendre de la résolution implicite de `text` vers `bytea`.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION extensions.digest(text, text)
RETURNS bytea LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = public, pg_catalog
AS $$ SELECT public.digest($1, $2); $$;

CREATE OR REPLACE FUNCTION extensions.digest(bytea, text)
RETURNS bytea LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = public, pg_catalog
AS $$ SELECT public.digest($1, $2); $$;

GRANT USAGE   ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION extensions.digest(text, text)  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION extensions.digest(bytea, text) TO anon, authenticated, service_role;

COMMIT;
