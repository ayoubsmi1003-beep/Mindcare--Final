-- 070_local_auth — l'authentification locale, en remplacement de GoTrue.
--
-- Jusqu'ici, l'identité venait de GoTrue : il vérifiait le mot de passe, signait
-- un JWT, et PostgREST le traduisait en `auth.uid()`. En auto-hébergé sans
-- Supabase, ces trois maillons disparaissent. Cette migration reconstruit le
-- premier (vérifier) et le deuxième (matérialiser une session) ; le troisième
-- est déjà fait par `withCaller()` (phase 2), qui pose le GUC que lit
-- `auth.uid()` de `000_platform_compat.sql`.
--
-- ═══ POURQUOI UN RÔLE PORTEUR, ET NON DES FONCTIONS POSSÉDÉES PAR postgres ═══
--
-- La solution courte existait : `SECURITY DEFINER` possédée par `postgres`. Sur
-- une installation locale, `postgres` est SUPERUTILISATEUR, donc `rolbypassrls`.
-- C'est EXACTEMENT la faute de la migration 018, que 019/020/021 ont mis trois
-- migrations à réparer, et dont le commentaire de 020 dit : « `rolsuper = f` ne
-- prouve RIEN, c'est `rolbypassrls` qu'il faut lire ».
--
-- On pourrait plaider que le cas est différent — et il l'est en partie : ces
-- fonctions ne prennent AUCUNE décision de périmètre, elles ne comparent aucun
-- `practitioner_id`, et `auth.users` n'a de toute façon pas de policy à
-- contourner. Mais la propriété qu'on perdrait est celle qui a coûté le plus
-- cher au dépôt : « aucune fonction du chemin d'authentification ne s'exécute
-- avec un rôle capable d'ignorer la RLS ». Une fonction possédée par `postgres`
-- peut, par un défaut futur, lire N'IMPORTE QUELLE table du cabinet. Le rôle
-- porteur, lui, ne peut lire que ce que cette migration lui accorde nommément :
-- `auth.users` et `auth.sessions`, rien d'autre.
--
-- On reprend donc le patron de 020, qui est éprouvé : rôle NOLOGIN sans
-- BYPASSRLS, propriétaire des portes, privilèges nommés un par un, assertions
-- qui refusent d'appliquer la migration si l'une des propriétés est fausse.
--
-- ═══ POURQUOI DES POLICIES ALORS QUE 000 DISAIT « AUCUNE POLICY » ═══════════
--
-- `000_platform_compat.sql` pose `auth.users` en FORCE RLS SANS policy, et
-- commente : « personne ne lit, personne n'écrit, propriétaire compris ». Cette
-- garantie n'est pas abandonnée, elle est PRÉCISÉE : on ajoute des policies qui
-- ne nomment QUE `auth_gatekeeper`. Pour `anon`, `authenticated`, `service_role`
-- et `mindcare_app`, la table reste rigoureusement injoignable — et l'assertion
-- du §6 le vérifie au lieu de le supposer.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Le rôle porteur des portes d'authentification
-- ---------------------------------------------------------------------------
DO $bloc$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_gatekeeper') THEN
    CREATE ROLE auth_gatekeeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
                                INHERIT NOREPLICATION;
  END IF;
END $bloc$;

-- ASSERTION, PAS AFFECTATION — même raison qu'en 020 §1 : selon l'installation,
-- le rôle qui applique les migrations n'a pas toujours le droit de POSER ces
-- attributs. On vérifie donc, ce qui a le mérite de refuser bruyamment si
-- quelqu'un a pré-créé le rôle autrement.
DO $bloc$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolbypassrls, rolcanlogin INTO r
    FROM pg_roles WHERE rolname = 'auth_gatekeeper';

  IF r.rolsuper OR r.rolbypassrls THEN
    RAISE EXCEPTION
      'auth_gatekeeper porte SUPERUSER ou BYPASSRLS : le chemin d''authentification pourrait lire tout le cabinet.'
      USING HINT = 'C''est la faute de la migration 018. Retirer l''attribut, puis rejouer.';
  END IF;

  IF r.rolcanlogin THEN
    RAISE EXCEPTION 'auth_gatekeeper peut ouvrir une session : il ne doit jamais le pouvoir.';
  END IF;
END $bloc$;

COMMENT ON ROLE auth_gatekeeper IS
  'Proprietaire des portes d''authentification (070). Sans BYPASSRLS par '
  'conception : ne voit que auth.users et auth.sessions, par policies nommees.';

GRANT USAGE ON SCHEMA auth TO auth_gatekeeper;

-- ---------------------------------------------------------------------------
-- 2 · La table des sessions
-- ---------------------------------------------------------------------------
-- LE JETON N'EST PAS STOCKÉ. Seul son SHA-256 l'est, calculé côté Node : la base
-- ne voit jamais la valeur qui circule dans le cookie. Une copie de sauvegarde,
-- ou une lecture accidentelle de cette table, ne permet donc de REJOUER aucune
-- session — il faudrait inverser un SHA-256.
--
-- Pas de sel, et c'est délibéré : le jeton porte 256 bits d'entropie tirés au
-- hasard, il n'est pas devinable par dictionnaire. Le salage protège les
-- secrets à FAIBLE entropie (les mots de passe), pas ceux-là — et un sel
-- interdirait la recherche par clé primaire, qui est tout l'intérêt ici.
CREATE TABLE IF NOT EXISTS auth.sessions (
  token_sha256         bytea       PRIMARY KEY,
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at  timestamptz NOT NULL,
  CONSTRAINT sessions_token_longueur CHECK (octet_length(token_sha256) = 32)
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON auth.sessions (user_id);
-- La purge balaye par expiration : sans cet index, chaque ouverture de session
-- devient un parcours complet de la table.
CREATE INDEX IF NOT EXISTS sessions_absolute_expires_at_idx
  ON auth.sessions (absolute_expires_at);

COMMENT ON TABLE auth.sessions IS
  'Sessions locales. La cle est le SHA-256 du jeton, jamais le jeton lui-meme : '
  'une fuite de cette table ne permet de rejouer aucune session.';

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.sessions FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON auth.sessions FROM PUBLIC;
REVOKE ALL ON auth.sessions FROM anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3 · Les privilèges du rôle porteur — nommés un par un
-- ---------------------------------------------------------------------------
GRANT SELECT, UPDATE                 ON auth.users    TO auth_gatekeeper;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.sessions TO auth_gatekeeper;

-- Les policies ne nomment que `auth_gatekeeper` : la garantie de 000
-- (« injoignable ») reste entière pour tous les autres rôles.
DROP POLICY IF EXISTS users_gate ON auth.users;
CREATE POLICY users_gate ON auth.users
  FOR ALL TO auth_gatekeeper USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS sessions_gate ON auth.sessions;
CREATE POLICY sessions_gate ON auth.sessions
  FOR ALL TO auth_gatekeeper USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3bis · L'ACCÈS DE LECTURE À `app.profiles`, ET SES BORNES
-- ---------------------------------------------------------------------------
-- `verify_password` consulte `app.profiles.is_active` (voir §4a) : désactiver
-- une assistante dans l'application doit VRAIMENT lui fermer la porte, et non
-- la laisser ouvrir des sessions parce que la désactivation vit dans une table
-- que le chemin d'authentification ne regarde pas.
--
-- CE QUE ÇA COÛTE, ÉCRIT ICI PLUTÔT QUE DÉCOUVERT PLUS TARD. `auth_gatekeeper`
-- sort de son schéma : il peut désormais LIRE l'annuaire du personnel. Ce
-- n'était pas le cas une ligne plus haut, et c'est un élargissement réel.
--
-- POURQUOI IL RESTE ACCEPTABLE, ET LA MESURE EXACTE DE CE QUI EST EXPOSÉ :
--   · `app.profiles` ne contient AUCUNE donnée patient — c'est l'annuaire des
--     soignants (nom, rôle, spécialité, numéro d'ordre) ;
--   · la policy `profiles_read` de 003 laisse DÉJÀ tout utilisateur authentifié
--     lire l'annuaire complet de son cabinet. Cette lecture-ci n'ouvre donc pas
--     une classe d'information nouvelle, elle ouvre le même annuaire à un rôle
--     de plus, qui n'a pas de LOGIN et n'exécute que quatre fonctions ;
--   · le privilège est `SELECT` SEUL, sur UNE table nommée. Pas d'écriture, pas
--     de `app.patients`, pas de schéma entier. L'assertion du §6 le vérifie.
--
-- L'ALTERNATIVE ÉCARTÉE, pour qu'on ne la reprenne pas par inadvertance :
-- ne consulter que `auth.users.is_active` garderait `auth_gatekeeper`
-- strictement dans son schéma — mais la désactivation faite depuis
-- l'application ne fermerait alors plus la porte. On préfère un élargissement
-- de lecture mesuré à un garde-fou qui ne garde rien.
GRANT USAGE  ON SCHEMA app     TO auth_gatekeeper;
GRANT SELECT ON app.profiles   TO auth_gatekeeper;

-- `app.profiles` porte FORCE RLS (003) : le privilège de table ne suffit pas,
-- il faut une policy. Elle est en LECTURE SEULE et ne nomme que ce rôle.
DROP POLICY IF EXISTS profiles_auth_gate ON app.profiles;
CREATE POLICY profiles_auth_gate ON app.profiles
  FOR SELECT TO auth_gatekeeper USING (true);

-- ---------------------------------------------------------------------------
-- 4 · Les portes
-- ---------------------------------------------------------------------------
-- `search_path = auth, pg_catalog` — SANS `public`. Les appels à pgcrypto sont
-- donc qualifiés (`public.crypt`). Laisser `public` dans le chemin d'une
-- fonction SECURITY DEFINER est l'escalade de privilèges classique : il suffit
-- d'y déposer une fonction `crypt(text, text)` qui rend toujours vrai.
GRANT CREATE ON SCHEMA auth TO auth_gatekeeper;

-- 4a · Vérification du mot de passe.
--
-- REND UN `uuid` OU `NULL`, JAMAIS UNE RAISON. « Compte inconnu », « mot de
-- passe faux », « compte désactivé » et « hachage hérité » donnent le même
-- résultat. Distinguer les cas fabriquerait un oracle d'existence de compte —
-- la règle qu'ADR-003 impose déjà aux portes patient.
--
-- LE FILTRE DE FORME BCRYPT FERME UNE VRAIE FAILLE — MESURÉE, PAS SUPPOSÉE.
--
-- La première rédaction de ce commentaire affirmait que `public.crypt(mdp,
-- 'CONNEXION-IMPOSSIBLE')` LÈVE parce que le sel est malformé. C'EST FAUX, et
-- la mesure l'a montré : l'appel rend tranquillement `COUYyeobcZg..`. pgcrypto
-- ne rejette pas un sel qu'il ne reconnaît pas — il RETOMBE SUR DES,
-- l'algorithme historique d'Unix, en prenant les deux premiers caractères comme
-- sel. Aucune erreur, aucun avertissement.
--
-- Ce que cela implique, et qui est la vraie raison d'être de ce filtre :
--   · un hachage DES se re-vérifie normalement — `crypt(mdp, h) = h` rend
--     `true` ;
--   · et DES N'UTILISE QUE LES 8 PREMIERS CARACTÈRES du mot de passe. Mesuré
--     sur cette base : `motdepasse-ABCDEF` et `motdepasse-ZZZZZZ` sont TOUS DEUX
--     acceptés contre le même hachage.
--
-- Autrement dit, sans ce filtre, un compte dont le `encrypted_password` serait
-- un vieux hachage DES (13 caractères) s'ouvrirait à n'importe quel mot de passe
-- partageant ses huit premiers caractères. Le filtre n'est donc pas une
-- politesse envers le semis de 015 : c'est lui qui garantit que SEUL bcrypt est
-- accepté, et que rien ne dégrade en silence vers un algorithme de 1979.
--
-- Le semis de 015 (`encrypted_password = 'CONNEXION-IMPOSSIBLE'`) est refusé
-- dans les deux cas — mais par accident sans le filtre (le hachage DES calculé
-- ne coïncide pas), et PAR CONCEPTION avec lui. On préfère la seconde.
CREATE OR REPLACE FUNCTION auth.verify_password(p_email text, p_password text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, pg_catalog
AS $corps$
DECLARE
  v_id    uuid;
  v_hash  text;
  v_actif boolean;
BEGIN
  SELECT u.id, u.encrypted_password, (u.is_active AND coalesce(p.is_active, false))
    INTO v_id, v_hash, v_actif
    FROM auth.users u
    LEFT JOIN app.profiles p ON p.id = u.id
   WHERE lower(u.email) = lower(btrim(coalesce(p_email, '')));

  -- Un compte sans `profiles` actif ne peut pas ouvrir de session : désactiver
  -- une assistante dans l'application doit VRAIMENT lui fermer la porte. C'est
  -- une décision d'AUTHENTIFICATION (ce compte peut-il ouvrir une session), pas
  -- d'autorisation (que peut-il voir) — celle-là reste à la RLS, règle 4.
  --
  -- Temporisation sur TOUS les chemins de refus, pour que la durée de la
  -- réponse ne trahisse pas lequel a été pris. Ce n'est pas une protection
  -- forte (la charge de la machine bruite la mesure), mais elle est gratuite.
  IF v_id IS NULL OR v_hash IS NULL OR NOT v_actif
     OR v_hash !~ '^[$]2[aby][$]'
     -- bcrypt ignore silencieusement ce qui dépasse 72 octets : deux mots de
     -- passe longs partageant un préfixe deviendraient équivalents. On refuse.
     OR octet_length(coalesce(p_password, '')) NOT BETWEEN 1 AND 72 THEN
    PERFORM pg_sleep(0.25);
    RETURN NULL;
  END IF;

  IF public.crypt(p_password, v_hash) = v_hash THEN
    UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = v_id;
    RETURN v_id;
  END IF;

  PERFORM pg_sleep(0.25);
  RETURN NULL;
END;
$corps$;

-- 4b · Ouverture de session.
-- 8 h glissantes d'inactivité, 24 h absolues : une consultation ne dure pas la
-- nuit, et une session oubliée sur un poste du cabinet doit mourir seule.
CREATE OR REPLACE FUNCTION auth.create_session(p_user_id uuid, p_token_sha256 bytea)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, pg_catalog
AS $corps$
DECLARE v_expire timestamptz := now() + interval '24 hours';
BEGIN
  IF p_user_id IS NULL OR p_token_sha256 IS NULL THEN
    RAISE EXCEPTION 'Ouverture de session sans identite ni jeton.';
  END IF;

  -- Purge opportuniste : pas de `pg_cron` en auto-hébergé (cf. 032), donc le
  -- ménage se fait au fil de l'eau plutôt que par une tâche qui n'existe pas.
  DELETE FROM auth.sessions
   WHERE absolute_expires_at < now()
      OR last_seen_at < now() - interval '8 hours';

  INSERT INTO auth.sessions (token_sha256, user_id, absolute_expires_at)
  VALUES (p_token_sha256, p_user_id, v_expire);

  RETURN v_expire;
END;
$corps$;

-- 4c · Résolution de session — appelée à chaque requête authentifiée.
-- Fait glisser `last_seen_at` ET rend l'identité en UNE SEULE instruction :
-- deux requêtes séparées laisseraient une fenêtre où une session tout juste
-- expirée serait prolongée par la lecture même qui vient de la constater.
CREATE OR REPLACE FUNCTION auth.resolve_session(p_token_sha256 bytea)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, pg_catalog
AS $corps$
DECLARE v_id uuid;
BEGIN
  IF p_token_sha256 IS NULL THEN RETURN NULL; END IF;

  UPDATE auth.sessions s
     SET last_seen_at = now()
   WHERE s.token_sha256 = p_token_sha256
     AND s.absolute_expires_at > now()
     AND s.last_seen_at > now() - interval '8 hours'
  RETURNING s.user_id INTO v_id;

  RETURN v_id;
END;
$corps$;

-- 4d · Fermeture de session. Le jeton étant OPAQUE, la révocation est immédiate
-- et réelle : rien ne survit côté client, contrairement à un JWT qu'on ne peut
-- que laisser expirer.
CREATE OR REPLACE FUNCTION auth.destroy_session(p_token_sha256 bytea)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, pg_catalog
AS $corps$
BEGIN
  DELETE FROM auth.sessions WHERE token_sha256 = p_token_sha256;
END;
$corps$;

ALTER FUNCTION auth.verify_password(text, text) OWNER TO auth_gatekeeper;
ALTER FUNCTION auth.create_session(uuid, bytea) OWNER TO auth_gatekeeper;
ALTER FUNCTION auth.resolve_session(bytea)      OWNER TO auth_gatekeeper;
ALTER FUNCTION auth.destroy_session(bytea)      OWNER TO auth_gatekeeper;

-- Le privilège de transfert n'a plus lieu d'être (même geste qu'en 020 §5) :
-- un rôle qui peut créer dans `auth` pourrait y masquer une fonction du
-- `search_path` figé des portes.
REVOKE CREATE ON SCHEMA auth FROM auth_gatekeeper;

-- ---------------------------------------------------------------------------
-- 5 · Qui peut franchir ces portes
-- ---------------------------------------------------------------------------
-- `mindcare_app` SEUL, et surtout PAS `authenticated`.
--
-- La raison tient à l'ordre des opérations : ces fonctions s'exécutent AVANT
-- qu'une identité existe, donc avant le `SET LOCAL ROLE` de `withCaller()`.
-- Elles sont appelées par `withAuthGate()`, qui laisse délibérément la
-- transaction sous le rôle de connexion. Les accorder à `authenticated`
-- donnerait à toute session déjà ouverte le pouvoir d'en forger d'autres, ou
-- d'éprouver des mots de passe à volonté.
--
-- `mindcare_app` étant NOINHERIT (bootstrap 010), un `SET LOCAL ROLE
-- authenticated` lui fait PERDRE ce droit : une session ouverte ne peut pas
-- revenir en arrière et rappeler ces portes. Les deux dispositifs se tiennent.
REVOKE ALL ON FUNCTION auth.verify_password(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.create_session(uuid, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.resolve_session(bytea)      FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.destroy_session(bytea)      FROM PUBLIC;

DO $bloc$
BEGIN
  -- `mindcare_app` n'existe pas encore sur une base fraîche : le bootstrap 010
  -- est joué APRÈS la chaîne de migrations. On accorde s'il est déjà là, et
  -- `010_app_role.sql` fait le geste symétrique. Les deux chemins convergent,
  -- exactement comme 021 fait converger 020.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mindcare_app') THEN
    -- `USAGE` SUR LE SCHÉMA, sans quoi rien de ce qui suit ne sert : Postgres
    -- refuse « permission denied for schema auth » AVANT même de regarder le
    -- privilège de la fonction. 000 accorde cet USAGE à `anon`, `authenticated`
    -- et `service_role` — mais `mindcare_app` est NOINHERIT (bootstrap 010),
    -- donc il n'hérite de RIEN et doit être nommé.
    --
    -- C'est la contrepartie exacte du choix NOINHERIT, et elle est saine : tout
    -- ce que ce rôle peut faire est écrit noir sur blanc quelque part. `USAGE`
    -- sur un schéma n'ouvre aucune table ; l'assertion du §6 le vérifie.
    GRANT USAGE ON SCHEMA auth TO mindcare_app;
    GRANT EXECUTE ON FUNCTION auth.verify_password(text, text) TO mindcare_app;
    GRANT EXECUTE ON FUNCTION auth.create_session(uuid, bytea) TO mindcare_app;
    GRANT EXECUTE ON FUNCTION auth.resolve_session(bytea)      TO mindcare_app;
    GRANT EXECUTE ON FUNCTION auth.destroy_session(bytea)      TO mindcare_app;
  END IF;
END $bloc$;

-- ---------------------------------------------------------------------------
-- 6 · Les assertions — ce qui empêche ce dispositif de retomber en silence
-- ---------------------------------------------------------------------------
DO $bloc$
BEGIN
  -- Le chemin d'authentification ne contourne pas la RLS.
  IF EXISTS (SELECT 1 FROM pg_roles
              WHERE rolname = 'auth_gatekeeper' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'auth_gatekeeper a acquis SUPERUSER ou BYPASSRLS.';
  END IF;

  -- La garantie de 000 tient pour tout le monde sauf le porteur.
  IF has_table_privilege('authenticated', 'auth.users', 'SELECT')
     OR has_table_privilege('anon', 'auth.users', 'SELECT')
     OR has_table_privilege('service_role', 'auth.users', 'SELECT') THEN
    RAISE EXCEPTION 'auth.users est redevenue lisible hors des portes : les hachages sont exposes.';
  END IF;

  IF has_table_privilege('authenticated', 'auth.sessions', 'SELECT')
     OR has_table_privilege('anon', 'auth.sessions', 'SELECT') THEN
    RAISE EXCEPTION 'auth.sessions est lisible hors des portes : les sessions seraient rejouables.';
  END IF;

  -- Les bornes d'`auth_gatekeeper` hors de son schéma : l'annuaire, et RIEN
  -- d'autre. C'est la contrepartie explicite du §3bis.
  IF has_table_privilege('auth_gatekeeper', 'app.patients', 'SELECT')
     OR has_table_privilege('auth_gatekeeper', 'app.profiles', 'UPDATE')
     OR has_table_privilege('auth_gatekeeper', 'app.profiles', 'DELETE') THEN
    RAISE EXCEPTION
      'auth_gatekeeper a depasse la lecture de l''annuaire.'
      USING HINT = 'Il ne doit avoir que SELECT sur app.profiles (070 §3bis).';
  END IF;

  -- `mindcare_app` peut ATTEINDRE le schéma mais rien y LIRE. Les deux moitiés
  -- comptent : sans la première, l'authentification ne fonctionne pas ; sans la
  -- seconde, les hachages seraient à portée du rôle qui parle au réseau.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mindcare_app') THEN
    IF NOT has_schema_privilege('mindcare_app', 'auth', 'USAGE') THEN
      RAISE EXCEPTION 'mindcare_app ne peut pas atteindre le schema auth : la connexion echouera.';
    END IF;
    IF has_table_privilege('mindcare_app', 'auth.users', 'SELECT')
       OR has_table_privilege('mindcare_app', 'auth.sessions', 'SELECT') THEN
      RAISE EXCEPTION 'mindcare_app peut lire auth.users ou auth.sessions hors des portes.';
    END IF;
  END IF;

  -- Une session ouverte ne doit pas pouvoir en forger une autre.
  IF has_function_privilege('authenticated', 'auth.create_session(uuid, bytea)', 'EXECUTE')
     OR has_function_privilege('anon', 'auth.create_session(uuid, bytea)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'auth.verify_password(text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'auth.verify_password(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'anon ou authenticated peut appeler les portes d''authentification.'
      USING HINT = 'Une session ouverte pourrait en forger d''autres, ou eprouver des mots de passe.';
  END IF;
END $bloc$;

INSERT INTO app.schema_migrations (version) VALUES ('070_local_auth')
  ON CONFLICT DO NOTHING;

COMMIT;
