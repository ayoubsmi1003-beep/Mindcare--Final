-- 017_read_audit — ADR-019. Comble le trou d'I4 laissé ouvert par 013.
--
-- CE QUE 013 NE POUVAIT PAS FAIRE. Aucun déclencheur Postgres ne voit un
-- `SELECT`. L'en-tête de 013 le dit sans le maquiller : l'audit des ÉCRITURES
-- était couvert, celui des LECTURES ne l'était pas. C'était Q-B, le dernier
-- litige ouvert du §7 de WORKING-CONTEXT.
--
-- POURQUOI PAS pgaudit. Il journalise le TEXTE DE LA REQUÊTE dans le log
-- Postgres, qui sur le cloud part vers l'ingestion de logs de Supabase. Un
-- `SELECT … WHERE id = '<patient_id>'` dans ce flux est une donnée
-- identifiante qui quitte la machine : règle 1 de CLAUDE.md et I5. Le remède
-- aurait fabriqué la fuite qu'il prétend surveiller. Il redevient pertinent en
-- auto-hébergé (ADR-001), où le log ne quitte pas le PC du cabinet — en SECOND
-- FILET SOUS ce qui suit, jamais à sa place.
--
-- POURQUOI PAS UN APPEL APPLICATIF DISCIPLINÉ. Première rédaction du plan :
-- chaque service appelle une fonction de journalisation à la main. Elle portait
-- sa propre faille — un appel oublié n'est pas tracé, et rien ne le signale.
-- Même raisonnement qu'ADR-017 : on FERME LE CHEMIN, on ne discipline pas
-- l'usage. `SELECT` est révoqué sur `app.patients` ; lire un dossier sans
-- laisser de trace n'est plus une question de rigueur, c'est un
-- `permission denied`.
--
-- LIMITE, ÉCRITE ICI PARCE QU'ELLE EXISTE : un SUPERUTILISATEUR Postgres lit
-- toujours la table en direct, et peut révoquer ces révocations. Même portée
-- qu'ADR-016 §3 — EFFECTIVEMENT fermé pour l'application, PostgREST, les edge
-- functions et Jarvis ; pas INVIOLABLE. Ne pas présenter cette couverture
-- comme totale.

-- NOTE — `app.audit_op` contient DÉJÀ 'select' depuis 002. Une première
-- rédaction de cette migration l'ajoutait par `ALTER TYPE ... ADD VALUE`, ce
-- qui imposait un COMMIT au milieu du fichier (une valeur d'énumération n'est
-- utilisable qu'une fois validée) — donc une fenêtre où 017 pouvait s'appliquer
-- à moitié, pour rien. 002 avait vu juste avant nous ; on s'appuie dessus.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Le noyau de journalisation
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER : `audit.log` n'accorde d'INSERT à personne en direct, et
-- c'est voulu. Seul ce noyau écrit.
--
-- CE QUI N'ENTRE JAMAIS DANS LA CHARGE : un nom, un téléphone, une adresse, un
-- contenu de colonne (I5). Uniquement un identifiant technique et un libellé de
-- contexte choisi dans un ensemble FERMÉ — un texte libre finirait tôt ou tard
-- par porter le nom cherché, c'est-à-dire exactement la fuite qu'on prétend
-- éviter. Trois valeurs suffisent ; une quatrième se discute avant d'exister.
CREATE OR REPLACE FUNCTION audit.log_read(p_patient_id uuid, p_context text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
BEGIN
  IF p_context IS NULL OR p_context NOT IN ('fiche', 'recherche', 'liste') THEN
    RAISE EXCEPTION
      'Contexte de lecture inconnu : %. Valeurs admises : fiche, recherche, liste.', p_context
      USING HINT = 'Un contexte libre finirait par porter une donnée patient (I5).';
  END IF;

  INSERT INTO audit.log (actor_id, actor_role, operation, table_name, row_id,
                         patient_id, changed_fields, old_values, new_values)
  VALUES (auth.uid(), app.current_role(), 'select', 'patients',
          p_patient_id, p_patient_id, ARRAY[p_context], NULL, NULL);
END;
$$;

COMMENT ON FUNCTION audit.log_read(uuid, text) IS
  'ADR-019. Journalise une LECTURE de dossier. Charge volontairement pauvre : '
  'identifiant et contexte, jamais une valeur de colonne (I5).';

-- Nul ne l'appelle directement : elle n'est qu'un rouage des deux fonctions
-- ci-dessous. Une fonction d'audit appelable seule permettrait de fabriquer de
-- fausses traces de lecture — un journal falsifiable ne vaut pas mieux qu'un
-- journal absent.
REVOKE ALL ON FUNCTION audit.log_read(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2 · Les deux seules portes vers l'identité patient
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER (le défaut, écrit ici pour qu'on ne s'y trompe pas en
-- relisant) : la RLS de 004 s'applique INCHANGÉE. Aucun privilège n'est élargi,
-- la cloison entre praticiennes tient exactement comme avant. Ce qui disparaît,
-- c'est le chemin NON AUDITÉ — rien d'autre.
--
-- Conséquence de ce choix, assumée : les filtres et la pagination de PostgREST
-- ne s'appliquent plus à `app.patients`, ils deviennent des paramètres. Toute
-- jointure future ayant besoin de l'identité passera par ces deux portes.

CREATE OR REPLACE FUNCTION app.get_patient(p_id uuid)
RETURNS SETOF app.patients
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, audit, pg_catalog
AS $$
BEGIN
  -- Journal AVANT la lecture, même transaction. Si la RLS ne rend aucune ligne,
  -- la TENTATIVE reste tracée : « qui a cherché à ouvrir quel dossier » est
  -- précisément ce qu'un audit doit savoir dire.
  PERFORM audit.log_read(p_id, 'fiche');
  RETURN QUERY SELECT * FROM app.patients WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION app.get_patient(uuid) IS
  'ADR-019. Seule porte vers une fiche patient. SECURITY INVOKER : la RLS de '
  '004 décide, cette fonction ne fait qu''y ajouter la trace.';

-- Recherche : `p_query` est comparé par trigramme sur l'index `patients_name_trgm`
-- de 004. `p_limit` est BORNÉ ICI et pas seulement côté client : une pagination
-- que l'appelant choisit librement n'est pas une pagination, c'est un export.
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
  SELECT v.id, v.record_number, v.first_name, v.last_name, v.birth_date,
         v.phone, v.is_active, c.n
  FROM visibles v CROSS JOIN compte c
  ORDER BY v.last_name, v.first_name
  LIMIT v_limit OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION app.search_patients(text, integer, integer) IS
  'ADR-019. Seule porte vers la liste des patients. `p_limit` borné à 100 en '
  'base : une pagination que l''appelant choisit sans limite est un export.';

-- ---------------------------------------------------------------------------
-- 3 · Fermeture du chemin direct
-- ---------------------------------------------------------------------------
-- LA LIGNE QUI PORTE TOUT ADR-019. Sans elle, les fonctions ci-dessus ne sont
-- qu'une politesse : PostgREST sert `app.patients` en direct et la trace
-- n'existe pas.
--
-- `service_role` est révoqué AUSSI. Il contourne la RLS par conception, donc le
-- laisser lire `patients` rouvrirait le chemin non audité pour toute edge
-- function et tout futur outil Jarvis — c'est-à-dire pour le code qui touchera
-- le plus de dossiers.
REVOKE SELECT ON app.patients FROM authenticated, service_role;

-- Et pour les tables créées PLUS TARD : le défaut de 001 accorde SELECT sur
-- toute nouvelle table de `app`. Il reste correct pour les autres tables ; il ne
-- doit simplement plus s'appliquer à `patients`, qui existe déjà — d'où une
-- révocation explicite plutôt qu'un changement de défaut, qui aurait des effets
-- de bord sur les 28 autres tables.

-- ⚠️ `001` accorde les privilèges par défaut sur les TABLES et les SEQUENCES,
-- PAS sur les ROUTINES. Sans les deux GRANT ci-dessous, la migration réussit et
-- l'appel échoue en 42501 — une panne qui se diagnostique mal, parce que tout
-- semble vert. Constaté en vérifiant 001, pas à l'exécution.
GRANT EXECUTE ON FUNCTION app.get_patient(uuid)                        TO authenticated;
GRANT EXECUTE ON FUNCTION app.search_patients(text, integer, integer)  TO authenticated;

-- PostgREST met son cache de schéma à jour sur notification. Sans ça, les deux
-- fonctions n'apparaissent dans l'API qu'au prochain redémarrage.
NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('017_read_audit')
  ON CONFLICT DO NOTHING;

COMMIT;
