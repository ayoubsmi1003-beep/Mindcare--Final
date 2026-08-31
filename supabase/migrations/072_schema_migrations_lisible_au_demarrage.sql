-- 072_schema_migrations_lisible_au_demarrage
--
-- ═══ LE PROBLÈME, TROUVÉ AU DÉMARRAGE DU SERVEUR ═══════════════════════════
--
-- Le contrôle de démarrage (phase 7) compare les migrations présentes sur le
-- DISQUE à celles enregistrées dans `app.schema_migrations`. Il refuse de
-- servir sur un schéma partiellement migré — l'état le plus dangereux pour un
-- dossier médical, parce que l'application a l'air de fonctionner.
--
-- Ce contrôle s'exécute AVANT toute identité : il n'y a pas d'utilisatrice
-- connectée au lancement du serveur. Il tourne donc sous `anon`.
--
-- Or `001_extensions_and_migrations_table.sql` n'accorde `SELECT` sur
-- `app.schema_migrations` qu'à `authenticated` et `service_role`, et sa policy
-- ne nomme qu'`authenticated`. Le contrôle échouait donc en
-- « permission denied » — que le diagnostic rapportait comme
-- « base injoignable », c'est-à-dire en désignant le mauvais organe.
--
-- ═══ POURQUOI C'EST SANS CONSÉQUENCE POUR LA CONFIDENTIALITÉ ═══════════════
--
-- Cette table ne contient que des NOMS DE FICHIERS de migration, leur date
-- d'application et le rôle qui les a jouées. Aucune donnée patient, aucun
-- secret, aucune information sur le cabinet. C'est un journal de version.
--
-- Et l'exposition réelle est nulle : `anon` n'a aucun chemin HTTP vers cette
-- table. L'allowlist engendrée de `/api/db/select` ne connaît que `profiles`,
-- `notifications` et `deployment` — ajouter une relation demanderait qu'un
-- service la lise, donc un diff relu. Le seul appelant est le contrôle de
-- démarrage, côté serveur.
--
-- L'ALTERNATIVE ÉCARTÉE : faire tourner le contrôle sous `authenticated` en
-- lui fabriquant une identité. On aurait alors inventé une session sans
-- utilisatrice pour lire un numéro de version — un précédent bien plus
-- coûteux que ce GRANT.

BEGIN;

GRANT SELECT ON app.schema_migrations TO anon;

-- La table porte `ENABLE ROW LEVEL SECURITY` depuis 001 : le privilège de
-- table ne suffit pas, il faut une policy. Elle est en LECTURE SEULE.
DROP POLICY IF EXISTS schema_migrations_read_anon ON app.schema_migrations;
CREATE POLICY schema_migrations_read_anon ON app.schema_migrations
    FOR SELECT TO anon USING (true);

COMMENT ON TABLE app.schema_migrations IS
  'Journal de version du schema. Lisible par anon depuis 072 : le controle de '
  'demarrage tourne avant toute identite. Ne contient aucune donnee patient.';

-- ---------------------------------------------------------------------------
-- Les assertions
-- ---------------------------------------------------------------------------
DO $bloc$
BEGIN
  IF NOT has_table_privilege('anon', 'app.schema_migrations', 'SELECT') THEN
    RAISE EXCEPTION
      'anon ne peut pas lire app.schema_migrations.'
      USING HINT = 'Le controle de demarrage rendrait « base injoignable » a tort.';
  END IF;

  -- L'élargissement s'arrête LÀ. `anon` ne doit rien avoir gagné d'autre, et
  -- surtout pas d'écriture : le journal de version dirait alors n'importe quoi.
  IF has_table_privilege('anon', 'app.schema_migrations', 'INSERT')
     OR has_table_privilege('anon', 'app.schema_migrations', 'UPDATE')
     OR has_table_privilege('anon', 'app.schema_migrations', 'DELETE') THEN
    RAISE EXCEPTION 'anon peut ECRIRE dans app.schema_migrations.';
  END IF;

  IF has_table_privilege('anon', 'app.patients', 'SELECT')
     OR has_table_privilege('anon', 'app.consultations', 'SELECT')
     OR has_table_privilege('anon', 'app.clinical_notes', 'SELECT') THEN
    RAISE EXCEPTION
      'anon a acquis un acces clinique.'
      USING HINT = '072 n''ouvre que le journal de version.';
  END IF;
END $bloc$;

INSERT INTO app.schema_migrations (version)
  VALUES ('072_schema_migrations_lisible_au_demarrage')
  ON CONFLICT DO NOTHING;

COMMIT;
