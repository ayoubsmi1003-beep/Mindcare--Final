-- 016_deployment_guard
-- ADR-016 — phase cloud encadrée. Applique la condition 2 : données synthétiques
-- uniquement, tant que le déploiement est en 'cloud-dev'.
--
-- Placée en 016 et non insérée dans 001–015 : l'ordre du §16 de 01-SCHEMA.md est
-- gelé, on l'ALLONGE, on ne le renumérote pas. Conséquence assumée : le trigger
-- s'attache après la création des tables (001–014) et après le seed (015), donc
-- les lignes de seed sont marquées synthétiques rétroactivement plus bas.
--
-- POURQUOI UN TRIGGER ET PAS LA RLS : `service_role` contourne la RLS par
-- conception. Il ne contourne pas un trigger. Une edge function, PostgREST, un
-- COPY et un futur outil Jarvis tombent tous dessus.
--
-- LIMITE, ÉCRITE ICI PARCE QU'ELLE EXISTE : un SUPERUTILISATEUR Postgres peut
-- toujours `ALTER TABLE ... DISABLE TRIGGER`. Ce mécanisme est EFFECTIVEMENT
-- immuable, pas inviolable. Ce qui est réellement fermé : toute écriture venant
-- de l'application, de PostgREST, d'une edge function ou de Jarvis. Ne pas
-- présenter cette couverture comme totale.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · L'environnement de déploiement
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.deployment (
  -- ligne unique : la colonne constante porte la contrainte, pas une convention
  singleton    boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
  environment  text        NOT NULL CHECK (environment IN ('cloud-dev', 'self-hosted')),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.deployment IS
  'ADR-016. Pilote le garde-fou synthétique. Ne jamais écrire en direct : '
  'passer par app.set_deployment_environment().';

ALTER TABLE app.deployment ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.deployment FORCE  ROW LEVEL SECURITY;

-- Lecture seule pour l'application : le bandeau d'interface en a besoin.
-- Aucune policy d'écriture — leur absence EST la règle.
DROP POLICY IF EXISTS deployment_read ON app.deployment;
CREATE POLICY deployment_read ON app.deployment FOR SELECT USING (true);

REVOKE ALL     ON app.deployment FROM anon, authenticated, service_role;
GRANT  SELECT  ON app.deployment TO   anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2 · Journal des transitions — ajout seul (I4)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit.deployment_transitions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_environment text,
  to_environment   text        NOT NULL,
  actor            text        NOT NULL,
  reason           text        NOT NULL CHECK (length(trim(reason)) > 0),
  occurred_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit.deployment_transitions IS
  'ADR-016. Toute bascule cloud-dev <-> self-hosted, dans la MÊME transaction '
  'que la bascule elle-même. Un basculement sans trace est exactement ce que '
  'ce garde-fou empêche.';

ALTER TABLE audit.deployment_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.deployment_transitions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deployment_transitions_read ON audit.deployment_transitions;
CREATE POLICY deployment_transitions_read ON audit.deployment_transitions
  FOR SELECT USING (true);

REVOKE ALL    ON audit.deployment_transitions FROM anon, authenticated, service_role;
GRANT  SELECT ON audit.deployment_transitions TO   anon, authenticated, service_role;

-- Ajout seul : même le propriétaire ne réécrit pas l'histoire.
CREATE OR REPLACE FUNCTION audit.deployment_transitions_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'audit.deployment_transitions est en ajout seul (ADR-016, I4) : % refusé.', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS deployment_transitions_append_only ON audit.deployment_transitions;
CREATE TRIGGER deployment_transitions_append_only
  BEFORE UPDATE OR DELETE ON audit.deployment_transitions
  FOR EACH ROW EXECUTE FUNCTION audit.deployment_transitions_append_only();

-- ---------------------------------------------------------------------------
-- 3 · `environment` immuable hors procédure de migration
-- ---------------------------------------------------------------------------
-- Le trigger refuse TOUTE écriture directe, quel que soit le rôle. Seule
-- app.set_deployment_environment() pose le garde de session qu'il reconnaît.

CREATE OR REPLACE FUNCTION app.deployment_no_direct_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.deployment_change_ok', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'app.deployment est en écriture interdite (ADR-016). Utilise '
      'app.set_deployment_environment(target, reason).';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS deployment_no_direct_write ON app.deployment;
CREATE TRIGGER deployment_no_direct_write
  BEFORE INSERT OR UPDATE OR DELETE ON app.deployment
  FOR EACH ROW EXECUTE FUNCTION app.deployment_no_direct_write();

CREATE OR REPLACE FUNCTION app.set_deployment_environment(target text, reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  current_env text;
BEGIN
  IF target NOT IN ('cloud-dev', 'self-hosted') THEN
    RAISE EXCEPTION 'Environnement inconnu : %', target;
  END IF;
  IF reason IS NULL OR length(trim(reason)) = 0 THEN
    RAISE EXCEPTION 'Un motif est obligatoire : la bascule doit rester lisible dans l''audit.';
  END IF;

  SELECT environment INTO current_env FROM app.deployment WHERE singleton;

  -- Journal AVANT la bascule, même transaction : pas de bascule sans trace.
  INSERT INTO audit.deployment_transitions (from_environment, to_environment, actor, reason)
  VALUES (current_env, target, current_user, reason);

  PERFORM set_config('app.deployment_change_ok', 'on', true);   -- true = LOCAL
  IF current_env IS NULL THEN
    INSERT INTO app.deployment (singleton, environment) VALUES (true, target);
  ELSE
    UPDATE app.deployment SET environment = target, updated_at = now() WHERE singleton;
  END IF;
  PERFORM set_config('app.deployment_change_ok', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION app.set_deployment_environment(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4 · Le garde-fou synthétique
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.is_cloud_dev() RETURNS boolean
LANGUAGE sql STABLE SET search_path = app, pg_catalog AS $$
  SELECT COALESCE((SELECT environment = 'cloud-dev' FROM app.deployment WHERE singleton), false);
$$;

CREATE OR REPLACE FUNCTION app.assert_synthetic_when_cloud()
RETURNS trigger LANGUAGE plpgsql SET search_path = app, pg_catalog AS $$
BEGIN
  IF app.is_cloud_dev() AND NEW.is_synthetic IS NOT TRUE THEN
    RAISE EXCEPTION
      'ADR-016 — déploiement cloud-dev : seules les données synthétiques sont '
      'acceptées (table %.%, is_synthetic doit valoir true). Aucune donnée '
      'patient réelle ne doit atteindre le cloud.',
      TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING HINT = 'Migrer vers l''auto-hébergé avant de saisir un patient réel.';
  END IF;
  RETURN NEW;
END;
$$;

-- L'AMORÇAGE VIENT AVANT L'ATTACHEMENT, et l'ordre n'est pas cosmétique :
-- le rattrapage du seed plus bas teste `app.is_cloud_dev()`. Amorcé après, il
-- lisait une table vide, renvoyait `false`, et laissait les lignes de seed
-- marquées `is_synthetic = false` — c'est-à-dire présentées comme RÉELLES.
-- Défaut trouvé par exécution sur Postgres 15, pas par relecture.
SELECT app.set_deployment_environment(
  'cloud-dev',
  'ADR-016 — ouverture de la phase de développement cloud, données synthétiques uniquement.');

-- Attachement PAR DÉCOUVERTE, pas par énumération : une table Tier 0/1 ajoutée
-- demain ne peut pas s'exonérer en silence parce qu'on aurait oublié un nom.
-- Critère : toute table de `app` portant `patient_id`, plus `app.patients`.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app' AND c.relkind = 'r'
      AND (c.relname = 'patients'
           OR EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attname = 'patient_id'
                        AND a.attnum > 0 AND NOT a.attisdropped))
  LOOP
    EXECUTE format(
      'ALTER TABLE app.%I ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT false',
      t.relname);

    -- Le seed 015 a tourné avant ce garde-fou : en cloud-dev, tout ce qui
    -- préexiste EST synthétique. Le dire, plutôt que laisser un `false` qui ment.
    EXECUTE format(
      'UPDATE app.%I SET is_synthetic = true WHERE app.is_cloud_dev()', t.relname);

    EXECUTE format('DROP TRIGGER IF EXISTS assert_synthetic ON app.%I', t.relname);
    EXECUTE format(
      'CREATE TRIGGER assert_synthetic BEFORE INSERT OR UPDATE ON app.%I '
      'FOR EACH ROW EXECUTE FUNCTION app.assert_synthetic_when_cloud()', t.relname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5 · Enregistrement
-- ---------------------------------------------------------------------------
-- NB — le trigger est BEFORE INSERT OR UPDATE : un retour en 'cloud-dev' après
-- une phase 'self-hosted' n'efface ni ne requalifie les lignes déjà écrites. Il
-- barre les écritures à venir, il ne réécrit pas le passé (append-only, ADR-004).

INSERT INTO app.schema_migrations (version) VALUES ('016_deployment_guard')
  ON CONFLICT DO NOTHING;

COMMIT;
