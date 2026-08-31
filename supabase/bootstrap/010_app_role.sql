-- 010_app_role — le rôle sous lequel l'application se connecte.
--
-- Joué par l'installateur APRÈS 000_platform_compat.sql et après la chaîne de
-- migrations : `authenticated` doit exister (000) et les portes doivent avoir
-- reçu leurs GRANT (020 et suivantes) pour que la vérification finale ait un
-- sens. Comme 000, ce n'est PAS une migration et il ne s'enregistre pas.
--
-- Le mot de passe n'est PAS écrit ici. L'installateur l'engendre sur la machine
-- du cabinet et le pose par `ALTER ROLE mindcare_app PASSWORD …`. Un secret
-- dans un fichier versionné est un secret publié.
--
-- ═══ POURQUOI `NOINHERIT`, ET POURQUOI C'EST LE CŒUR DU DISPOSITIF ═══════════
--
-- `mindcare_app` est membre d'`anon` et d'`authenticated`, mais N'HÉRITE PAS de
-- leurs privilèges. Il doit les ENDOSSER explicitement, par `SET LOCAL ROLE`,
-- à l'intérieur d'une transaction.
--
-- La conséquence est la seule chose qui compte ici : HORS d'un `SET LOCAL ROLE`,
-- `mindcare_app` ne possède aucun droit sur `app` ni sur `audit`. Une requête
-- qui s'exécuterait sans que l'enveloppe ait posé l'identité ne rend donc pas
-- « les données d'un autre » : elle rend `permission denied`.
--
-- C'est la différence entre les deux modes de panne possibles d'un pool de
-- connexions, et elle n'est pas rattrapable ailleurs :
--   · avec héritage  → l'oubli dégrade vers UN ACCÈS SILENCIEUX, avec l'identité
--     de la requête précédente. C'est une fuite de dossier patient.
--   · sans héritage  → l'oubli dégrade vers AUCUN ACCÈS. C'est une panne, elle
--     est bruyante, et elle se corrige.
-- On choisit la panne. `withCaller()` ne doit jamais être la SEULE chose qui
-- empêche la fuite ; le rôle doit la rendre impossible même si l'enveloppe est
-- contournée par une négligence future.
--
-- ═══ CE QU'IL N'EST PAS ═════════════════════════════════════════════════════
--
-- PAS membre d'`app_gatekeeper`. Cette tentation mérite d'être nommée parce
-- qu'elle paraît raisonnable : « l'application doit franchir les portes, donc
-- elle doit être le portier ». C'est faux, et ce serait la fin d'ADR-019.
-- `app_gatekeeper` détient `SELECT` sur `app.patients` (020 §2) ; en hériter
-- rouvrirait le chemin de lecture NON AUDITÉ que 017 à 021 ont mis quatre
-- migrations à fermer. L'application n'a besoin que d'`EXECUTE` sur les portes,
-- et 020 §4 l'accorde déjà à `authenticated`. Les portes s'exécutent sous leur
-- propriétaire, pas sous l'appelant : c'est tout l'intérêt de SECURITY DEFINER.
--
-- PAS `SUPERUSER`, PAS `BYPASSRLS`, PAS `CREATEROLE`. Le rôle qui parle au
-- réseau est celui qui doit pouvoir le moins.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mindcare_app') THEN
    -- Sans mot de passe à la création : l'installateur le pose ensuite.
    CREATE ROLE mindcare_app LOGIN NOINHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END $$;

-- Converge une base déjà provisionnée : si le rôle préexistait avec de mauvais
-- attributs, on les corrige au lieu de faire confiance à l'historique.
-- `NOINHERIT` en particulier ne doit jamais dériver.
ALTER ROLE mindcare_app NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
                        NOBYPASSRLS NOREPLICATION;

-- L'APPARTENANCE, SANS L'HÉRITAGE.
-- `WITH INHERIT FALSE` est explicite pour la même raison que 020 écrit
-- `WITH INHERIT TRUE` : depuis PostgreSQL 16, l'option est figée DANS
-- l'appartenance au moment du GRANT, d'après l'attribut du rôle à cet instant.
-- Un `ALTER ROLE` ultérieur ne la corrige pas rétroactivement. On ne dépend donc
-- d'aucun ordre d'exécution, ici comme là-bas.
--
-- `WITH SET TRUE` (défaut, écrit pour qu'on ne s'interroge pas) est ce qui
-- autorise `SET ROLE` : sans lui, l'appartenance serait décorative et
-- `withCaller()` échouerait à endosser l'identité.
GRANT anon          TO mindcare_app WITH INHERIT FALSE, SET TRUE;
GRANT authenticated TO mindcare_app WITH INHERIT FALSE, SET TRUE;

-- `public` est accessible à tous par défaut en PostgreSQL < 15 et reste un
-- endroit où déposer une fonction qui masquerait celle d'un `search_path`.
-- L'application n'y a rien à faire.
REVOKE ALL ON SCHEMA public FROM mindcare_app;

-- ---------------------------------------------------------------------------
-- Les portes d'authentification (070) — LE GESTE SYMÉTRIQUE
-- ---------------------------------------------------------------------------
-- ⚠️ CE BLOC EST OBLIGATOIRE SUR UNE INSTALLATION NEUVE, et son absence a été
-- trouvée par un test, pas par relecture. Voici l'enchaînement exact :
--
--   1. l'installateur joue 000, puis les migrations 001…070, PUIS ce fichier ;
--   2. `070_local_auth.sql` accorde USAGE et EXECUTE à `mindcare_app` — mais
--      dans un bloc conditionnel `IF EXISTS (… WHERE rolname = 'mindcare_app')` ;
--   3. à cet instant, sur une base NEUVE, le rôle N'EXISTE PAS ENCORE. Le bloc
--      est donc sauté en silence, et l'application ne peut pas se connecter :
--      « permission denied for schema auth » à la première tentative.
--
-- Sur une base déjà provisionnée, le rôle existe et 070 accorde : les tests
-- passaient au vert. C'est le piège classique de ce dépôt — « vert statique
-- n'est pas vert intégré ». Seule une reconstruction DEPUIS ZÉRO l'a montré.
--
-- Les deux fichiers accordent donc la même chose, chacun quand il le peut, et
-- les deux chemins convergent. Même esprit que 021 vis-à-vis de 020.
DO $$
BEGIN
  -- Gardé par l'existence des fonctions : ce fichier doit rester applicable sur
  -- une base où 070 n'aurait pas encore été jouée, sans échouer bruyamment.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'auth' AND p.proname = 'verify_password') THEN
    -- Nécessaire parce que `mindcare_app` est NOINHERIT : le GRANT que 000 pose
    -- sur `authenticated` ne lui parvient pas. Tout ce qu'il peut faire doit
    -- être nommé quelque part — c'est la contrepartie assumée de NOINHERIT.
    GRANT USAGE ON SCHEMA auth TO mindcare_app;
    GRANT EXECUTE ON FUNCTION auth.verify_password(text, text) TO mindcare_app;
    GRANT EXECUTE ON FUNCTION auth.create_session(uuid, bytea) TO mindcare_app;
    GRANT EXECUTE ON FUNCTION auth.resolve_session(bytea)      TO mindcare_app;
    GRANT EXECUTE ON FUNCTION auth.destroy_session(bytea)      TO mindcare_app;
  END IF;

  -- ── La porte du journal de franchissement (071) — MÊME PIÈGE, MÊME REMÈDE ──
  --
  -- Troisième occurrence du même enchaînement, et la plus sournoise des trois.
  -- `071_egress_gatekeeper.sql` accorde `EXECUTE` à `mindcare_app` dans un bloc
  -- conditionnel ; sur une base NEUVE le rôle n'existe pas encore, le bloc est
  -- sauté, et sans la contrepartie ci-dessous l'application ne peut plus écrire
  -- dans `audit.boundary_crossings`.
  --
  -- POURQUOI C'EST PIRE QUE POUR L'AUTHENTIFICATION. Un défaut d'authentification
  -- se voit à la première connexion : personne ne peut entrer. Ici, `journaliser()`
  -- AVALE délibérément ses échecs — pour qu'une panne de journal ne fasse jamais
  -- échouer l'appel clinique qu'il documente. La conséquence serait donc un
  -- journal de sortie vers l'IA qui cesse d'être écrit SANS QUE RIEN NE LE DISE,
  -- pendant qu'on continue de lui faire confiance. C'est exactement ce que
  -- l'en-tête de 071 décrit comme pire que pas de journal du tout.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'audit' AND p.proname = 'log_boundary_crossing') THEN
    GRANT USAGE ON SCHEMA audit TO mindcare_app;
    GRANT EXECUTE ON FUNCTION audit.log_boundary_crossing(
      text, text, text, text, text, uuid,
      integer, integer, integer, numeric, text, integer) TO mindcare_app;
  END IF;
END $$;

COMMENT ON ROLE mindcare_app IS
  'Rôle de connexion de l''application. NOINHERIT par conception : hors '
  'SET LOCAL ROLE il n''a aucun droit, donc une enveloppe oubliée provoque une '
  'panne et non une fuite. Ne jamais lui accorder app_gatekeeper (ADR-019).';

-- ---------------------------------------------------------------------------
-- Les assertions — ce qui empêche ce dispositif de retomber en silence
-- ---------------------------------------------------------------------------
-- Même esprit qu'en 021 : chacune de ces propriétés peut être défaite par une
-- commande d'administration ordinaire, et aucune ne produirait d'erreur visible
-- avant la fuite elle-même.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles
              WHERE rolname='mindcare_app' AND (rolsuper OR rolbypassrls OR rolinherit)) THEN
    RAISE EXCEPTION
      'mindcare_app porte SUPERUSER, BYPASSRLS ou INHERIT.'
      USING HINT = 'Avec INHERIT, une requête hors enveloppe lirait les données '
                   'avec les droits d''authenticated au lieu d''échouer.';
  END IF;

  -- Il doit POUVOIR endosser authenticated, sinon toute l'application tombe.
  IF NOT pg_has_role('mindcare_app', 'authenticated', 'MEMBER') THEN
    RAISE EXCEPTION 'mindcare_app ne peut pas endosser authenticated (SET ROLE impossible).';
  END IF;

  -- Mais il ne doit PAS en avoir les privilèges sans l'endosser.
  IF pg_has_role('mindcare_app', 'authenticated', 'USAGE') THEN
    RAISE EXCEPTION
      'mindcare_app hérite effectivement d''authenticated — NOINHERIT est perdu.'
      USING HINT = 'Voir 020/021, piège 2 : l''option d''héritage est figée au GRANT.';
  END IF;

  -- ADR-019 : la porte reste la seule voie vers app.patients.
  IF pg_has_role('mindcare_app', 'app_gatekeeper', 'MEMBER') THEN
    RAISE EXCEPTION
      'mindcare_app est membre d''app_gatekeeper — le chemin de lecture non audité est rouvert.'
      USING HINT = 'L''application n''a besoin que d''EXECUTE sur les portes.';
  END IF;

  IF has_table_privilege('mindcare_app', 'app.patients', 'SELECT') THEN
    RAISE EXCEPTION 'mindcare_app peut lire app.patients directement — ADR-019 est annulée.';
  END IF;

  -- Si 070 est appliquée, l'application DOIT pouvoir franchir ses portes.
  -- Sans cette assertion, l'oubli décrit plus haut se serait vu à la première
  -- tentative de connexion de la médecin, pas à l'installation.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'auth' AND p.proname = 'verify_password') THEN
    IF NOT has_schema_privilege('mindcare_app', 'auth', 'USAGE')
       OR NOT has_function_privilege('mindcare_app', 'auth.verify_password(text, text)', 'EXECUTE')
       OR NOT has_function_privilege('mindcare_app', 'auth.resolve_session(bytea)', 'EXECUTE') THEN
      RAISE EXCEPTION
        'mindcare_app ne peut pas franchir les portes d''authentification.'
        USING HINT = 'Aucune connexion ne serait possible : permission denied for schema auth.';
    END IF;

    -- Et il ne doit toujours pas voir ce qu''elles protègent.
    IF has_table_privilege('mindcare_app', 'auth.users', 'SELECT')
       OR has_table_privilege('mindcare_app', 'auth.sessions', 'SELECT') THEN
      RAISE EXCEPTION 'mindcare_app peut lire auth.users ou auth.sessions hors des portes.';
    END IF;
  END IF;

  -- Le journal de franchissement : ÉCRIVABLE par la porte, ILLISIBLE en direct.
  -- Les deux moitiés comptent, et l'absence de la première serait muette.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'audit' AND p.proname = 'log_boundary_crossing') THEN
    IF NOT has_function_privilege('mindcare_app', 'audit.log_boundary_crossing(text, text, text, text, text, uuid, integer, integer, integer, numeric, text, integer)', 'EXECUTE') THEN
      RAISE EXCEPTION
        'mindcare_app ne peut pas ecrire le journal de franchissement.'
        USING HINT = 'Les appels a l''IA ne seraient plus traces, et journaliser() avale ses echecs.';
    END IF;
    IF has_table_privilege('mindcare_app', 'audit.boundary_crossings', 'SELECT') THEN
      RAISE EXCEPTION 'mindcare_app peut LIRE le journal de franchissement.';
    END IF;
  END IF;
END $$;

COMMIT;
