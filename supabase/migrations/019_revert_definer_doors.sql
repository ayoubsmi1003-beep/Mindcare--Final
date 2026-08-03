-- 019_revert_definer_doors — ANNULE le SECURITY DEFINER introduit par 018.
--
-- CE QUI S'EST PASSÉ, ÉCRIT SANS L'ADOUCIR. 018 a fait passer les portes en
-- SECURITY DEFINER en s'appuyant sur un raisonnement VÉRIFIÉ À MOITIÉ :
--
--     app.patients est en FORCE ROW LEVEL SECURITY, et son propriétaire
--     `postgres` n'est pas superutilisateur (rolsuper = false) — donc la RLS
--     s'applique aussi à lui, donc la cloison tient.
--
-- La première moitié est vraie. La seconde est fausse, et l'erreur est d'avoir
-- lu `rolsuper` sans lire `rolbypassrls` :
--
--     rolname   | rolsuper | rolbypassrls
--     postgres  | f        | t
--
-- `BYPASSRLS` suffit à contourner la RLS, indépendamment de `FORCE` et de
-- `rolsuper`. Les trois portes s'exécutant en tant que `postgres` ne voyaient
-- donc AUCUNE policy.
--
-- MESURÉ SUR LA BASE, pas déduit — c'est ce qui a révélé la faute :
--     search_patients vue par la Dr #2 → 2 patients (elle n'en a qu'UN)
--     get_patient(patient de la Dr Larbi) par la Dr #2 → 1 ligne rendue
--
-- C'est exactement la cloison d'ADR-003 et du §6 tombée : une praticienne
-- lisant le dossier d'une patiente de l'autre. Aucune circonstance atténuante :
-- la migration prétendait par écrit que le mur tenait.
--
-- ON REVIENT DONC À SECURITY INVOKER. État obtenu, décrit sans euphémisme :
-- les deux portes de lecture redeviennent INUTILISABLES (permission denied),
-- comme après 017. `app.patients` reste sans chemin de lecture applicatif.
-- C'est un blocage fonctionnel, pas une fuite — et entre les deux, on prend le
-- blocage. Une porte fermée se rouvre ; une donnée lue ne se dé-lit pas.
--
-- La vraie réparation demande de choisir un propriétaire de fonction SANS
-- BYPASSRLS et de rendre les policies de 004 applicables à ce rôle. Cela touche
-- le fichier le plus sensible du corpus : la décision revient à l'humain, elle
-- est inscrite au §7 de WORKING-CONTEXT comme litige ouvert (Q-D).

BEGIN;

CREATE OR REPLACE FUNCTION app.get_patient(p_id uuid)
RETURNS SETOF app.patients
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, audit, pg_catalog
AS $$
BEGIN
  PERFORM audit.log_read(p_id, 'fiche');
  RETURN QUERY SELECT * FROM app.patients WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION app.get_patient(uuid) IS
  'ADR-019, en attente de réparation (Q-D). Droits de l''appelant : la RLS de '
  '004 décide. Inutilisable tant que SELECT est révoqué — état assumé.';

CREATE OR REPLACE FUNCTION app.search_patients(
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0)
RETURNS TABLE (
  id              uuid,
  record_number   text,
  first_name      text,
  last_name       text,
  birth_date      date,
  phone           text,
  is_active       boolean,
  total_count     bigint)
LANGUAGE plpgsql
SECURITY INVOKER
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
    SELECT p.* FROM app.patients p
    WHERE p.is_active
      AND (v_needle IS NULL
           OR app.immutable_unaccent(lower(p.first_name || ' ' || p.last_name))
              ILIKE '%' || app.immutable_unaccent(lower(v_needle)) || '%'
           OR p.phone LIKE '%' || v_needle || '%'
           OR p.record_number = v_needle)
  ), compte AS (SELECT count(*) AS n FROM visibles)
  SELECT v.id, v.record_number, v.first_name, v.last_name, v.birth_date,
         v.phone, v.is_active, c.n
  FROM visibles v CROSS JOIN compte c
  ORDER BY v.last_name, v.first_name
  LIMIT v_limit OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION app.search_patients(text, integer, integer) IS
  'ADR-019, en attente de réparation (Q-D). Droits de l''appelant.';

-- La porte d'écriture disparaît entièrement plutôt que de repasser en droits de
-- l'appelant : sous les droits de `postgres` elle ignorait la cloison, et sous
-- ceux de l'appelant elle ne peut pas fonctionner (SELECT révoqué, exigé par le
-- WHERE). Une fonction qui ne peut être ni sûre ni utile ne doit pas exister :
-- laissée en place, elle serait reprise plus tard pour acquise.
DROP FUNCTION IF EXISTS app.update_patient(uuid, jsonb);

INSERT INTO app.schema_migrations (version) VALUES ('019_revert_definer_doors')
  ON CONFLICT DO NOTHING;

COMMIT;
