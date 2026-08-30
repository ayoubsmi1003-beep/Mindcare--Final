-- ═══════════════════════════════════════════════════════════════════════════
-- 066_search_patients_age — l'âge dans la LISTE des patients, calculé en base.
--
-- ═══ LE DÉFAUT, ET POURQUOI IL N'ÉTAIT PAS DANS L'ÉCRAN ═══
-- La fiche patient affiche l'âge depuis toujours : la porte 047
-- (`get_patient_workspace`) le calcule et le rend dans `identite.age`. La LISTE
-- ne l'affiche pas, et le composant n'y est pour rien — `app.search_patients`
-- ne renvoie que `birth_date`. Il n'y avait donc rien à afficher : on ne
-- corrige pas cela dans `LignePatient`, on le corrige ici.
--
-- ═══ POURQUOI PAS EN JAVASCRIPT ═══
-- `src/components/patients/format.ts` l'interdit explicitement, et le motif est
-- juste : un âge recalculé dans le navigateur dépend de l'horloge DU POSTE.
-- Une machine mal réglée vieillit ou rajeunit une patiente d'un an, en silence,
-- et le jour de l'anniversaire cette erreur devient systématique. `age()` de
-- Postgres tranche sur l'horloge du serveur — une seule, vérifiable.
-- L'expression est RECOPIÉE de 047 pour que les deux écrans ne puissent pas
-- diverger : `extract(year FROM age(birth_date))::int`.
--
-- ═══ POURQUOI UN `DROP` ICI, ET CE QU'IL EMPORTE ═══
-- ⚠️ Ajouter une colonne à un `RETURNS TABLE` CHANGE LE TYPE DE RETOUR :
-- `CREATE OR REPLACE` refuse, il faut supprimer puis recréer. Or un `DROP`
-- emporte AUSSI le propriétaire et les droits — et le propriétaire de cette
-- fonction n'est pas décoratif : `app_gatekeeper` est un rôle SANS BYPASSRLS
-- (ADR-019). Recréée sous `postgres`, la fonction contournerait la RLS tout en
-- restant parfaitement verte à la migration. La cloison tomberait sans qu'une
-- seule ligne ne l'annonce.
-- Les trois lignes de 020 sont donc REPOSÉES ci-dessous, dans la même
-- transaction : OWNER, REVOKE PUBLIC, GRANT authenticated. Aucune n'est
-- facultative.
--
-- ⚠️ RÈGLE 9 : 020 est appliquée, elle n'est pas retouchée. Le corps est
-- RECOPIÉ à l'identique (méthode 048/052/055) ; le seul changement est la
-- colonne `age` dans la signature et dans le SELECT final.
--
-- Retour arrière (documentation, jamais exécuté automatiquement) :
--   DROP FUNCTION app.search_patients(text, integer, integer);
--   puis réapplication du corps de 020, OWNER et GRANT compris.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- `ALTER FUNCTION … OWNER TO app_gatekeeper` EXIGE que le futur propriétaire
-- ait CREATE sur le schéma. Accordé ici, RETIRÉ en fin de transaction (065) :
-- un rôle qui peut créer dans `app` pourrait y planter une fonction masquant
-- une fonction du catalogue dans le `search_path` figé des portes.
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

DROP FUNCTION IF EXISTS app.search_patients(text, integer, integer);

CREATE FUNCTION app.search_patients(
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0)
RETURNS TABLE (
  id              uuid,
  record_number   text,
  first_name      text,
  last_name       text,
  birth_date      date,
  age             integer,
  phone           text,
  is_active       boolean,
  total_count     bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_limit  integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_needle text    := nullif(trim(coalesce(p_query, '')), '');
BEGIN
  PERFORM audit.log_read(NULL, 'recherche');

  RETURN QUERY
  WITH visibles AS (
    -- La RLS s'applique à ce SELECT : `visibles` ne contient déjà que ce que
    -- l'appelant a le droit de voir. Le comptage porte donc sur SON périmètre,
    -- jamais sur le cabinet entier — un total global divulguerait la file de
    -- l'autre praticienne sans en montrer une seule ligne.
    SELECT p.* FROM app.patients p
    WHERE p.is_active
      AND (v_needle IS NULL
           OR app.immutable_unaccent(lower(p.first_name || ' ' || p.last_name))
              ILIKE '%' || app.immutable_unaccent(lower(v_needle)) || '%'
           OR p.phone LIKE '%' || v_needle || '%'
           OR p.record_number = v_needle)
  ), compte AS (SELECT count(*) AS n FROM visibles)
  -- `age` reste NULL quand la date de naissance est inconnue : un écran qui
  -- affiche « 0 ans » invente une donnée (règle 8). L'absence se dit.
  SELECT v.id, v.record_number, v.first_name, v.last_name, v.birth_date,
         CASE WHEN v.birth_date IS NULL THEN NULL
              ELSE extract(year FROM age(v.birth_date))::int END,
         v.phone, v.is_active, c.n
  FROM visibles v CROSS JOIN compte c
  ORDER BY v.last_name, v.first_name
  LIMIT v_limit OFFSET v_offset;
END;
$$;

-- LES TROIS LIGNES QUE LE `DROP` A EMPORTÉES. Voir l'en-tête.
ALTER FUNCTION app.search_patients(text, integer, integer) OWNER TO app_gatekeeper;
REVOKE ALL     ON FUNCTION app.search_patients(text, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app.search_patients(text, integer, integer) TO authenticated;

COMMENT ON FUNCTION app.search_patients(text, integer, integer) IS
  'ADR-019. Seule porte vers la liste des patients. `p_limit` borné à 100 en '
  'base : une pagination que l''appelant choisit sans limite est un export. '
  '066 : ajoute `age`, calculé sur l''horloge du serveur — jamais celle du poste.';

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

-- PostgREST met son cache de schéma à jour sur notification. Sans elle, la
-- colonne `age` existerait en base et resterait invisible à l'API — un écran
-- « buggé » dont la cause est un cache, pas un code.
NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('066_search_patients_age')
  ON CONFLICT DO NOTHING;

COMMIT;
