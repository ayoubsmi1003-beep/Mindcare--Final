-- 021_gatekeeper_inheritance — convergence et VERROU de la sémantique d'héritage.
--
-- POURQUOI CE FICHIER EXISTE ALORS QUE 020 EST DÉJÀ CORRIGÉ. 020 a été appliqué
-- une première fois avec `NOINHERIT`, sur la base de développement. Corriger 020
-- rend une installation NEUVE correcte, mais ne répare pas une base DÉJÀ
-- migrée : `db-migrate` ne rejoue jamais une version enregistrée. Ce fichier
-- fait converger les deux chemins, et il est volontairement IDEMPOTENT — sur
-- une base neuve où 020 a déjà tout posé, il ne change rien et se contente de
-- vérifier.
--
-- CE QU'IL VERROUILLE, ET POURQUOI ÇA VAUT UNE MIGRATION À SOI SEUL.
-- Le design entier d'ADR-019 tient à une propriété que RIEN d'autre ne
-- surveille : `app_gatekeeper` doit avoir les privilèges d'`authenticated` AU
-- SENS DE `has_privs_of_role()`. Si cette propriété tombe, la RLS ne s'applique
-- pas « moins » — elle refuse TOUT, et les portes rendent silencieusement zéro
-- ligne. Une panne muette, qu'on prendrait pour une base vide.
--
-- Trois pièges rencontrés, tous les trois SILENCIEUX :
--   1. `NOINHERIT` sur le rôle → aucune policy ne s'applique.
--   2. `GRANT` posé alors que le rôle était encore `NOINHERIT` → l'appartenance
--      garde `inherit = false` pour toujours (Postgres 16+).
--   3. `ALTER ROLE … INHERIT` ensuite → ne corrige PAS l'appartenance existante.
-- Aucun des trois ne produit d'erreur. D'où l'assertion finale.

BEGIN;

ALTER ROLE app_gatekeeper INHERIT;

-- Re-poser l'appartenance AVEC l'option explicite. Rejouable sans effet de bord.
GRANT authenticated TO app_gatekeeper WITH INHERIT TRUE;

-- ---------------------------------------------------------------------------
-- L'assertion — la seule chose qui empêche ce design de retomber en silence
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT pg_has_role('app_gatekeeper', 'authenticated', 'USAGE') THEN
    RAISE EXCEPTION
      'app_gatekeeper n''hérite pas effectivement de authenticated.'
      USING HINT = 'Les policies de 004 ne s''appliqueraient pas et les portes '
                   'rendraient zéro ligne sans erreur. Voir 021, piège 2.';
  END IF;

  -- La contrepartie : hériter d'`authenticated` ne doit PAS rendre `SELECT` sur
  -- `app.patients`, sinon la révocation de 017 serait annulée par la bande et
  -- l'audit redeviendrait contournable. On vérifie que le privilège vient bien
  -- du GRANT explicite de 020 et non d'un élargissement d'`authenticated`.
  IF has_table_privilege('authenticated', 'app.patients', 'SELECT') THEN
    RAISE EXCEPTION
      'authenticated a retrouvé SELECT sur app.patients — ADR-019 est annulée.'
      USING HINT = 'Le chemin de lecture non audité est rouvert. Ne pas déployer.';
  END IF;
END $$;

INSERT INTO app.schema_migrations (version) VALUES ('021_gatekeeper_inheritance')
  ON CONFLICT DO NOTHING;

COMMIT;
