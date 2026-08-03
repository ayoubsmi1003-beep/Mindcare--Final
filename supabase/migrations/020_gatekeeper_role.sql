-- 020_gatekeeper_role — répare ADR-019 pour de bon (résout Q-D).
--
-- ═══ POURQUOI LES TROIS TENTATIVES PRÉCÉDENTES ONT ÉCHOUÉ ══════════════════
--
--   017 · SECURITY INVOKER + SELECT révoqué
--         La fonction s'exécute EN TANT QUE l'appelant, donc elle bute sur la
--         révocation qu'elle est censée compenser. Aucun accès, ni audité ni
--         direct. Invariant A impossible à satisfaire.
--
--   018 · SECURITY DEFINER possédé par `postgres`
--         `postgres` porte `rolbypassrls = t` sur Supabase. Une fonction qui
--         s'exécute sous ce rôle ne voit AUCUNE policy. Mesuré : la Dr #2
--         lisait la patiente de la Dr Larbi. Invariant B violé.
--         Leçon : `rolsuper = f` ne prouve RIEN. C'est `rolbypassrls` qu'il
--         faut lire, et `FORCE ROW LEVEL SECURITY` n'y change rien.
--
--   019 · retour en arrière sur ADR-019
--         Supprime l'audit obligatoire des lectures. Invariant A abandonné.
--
-- ═══ LE QUATRIÈME DESIGN, ET POURQUOI IL NE PEUT PAS CONTOURNER LA RLS ═════
--
-- Un rôle dédié `app_gatekeeper` possède les portes. Trois propriétés, toutes
-- VÉRIFIÉES SUR LA BASE avant d'être écrites ici, jamais déduites :
--
--   1. `app_gatekeeper` n'a NI `SUPERUSER` NI `BYPASSRLS`. La RLS s'applique
--      donc à lui comme à n'importe qui. C'est ce qui manquait à 018.
--
--   2. Il n'est PAS propriétaire de `app.patients` — `postgres` le reste. La
--      RLS s'applique donc par le mécanisme ordinaire (`ENABLE`), sans même
--      dépendre de `FORCE`, qui ne concerne que le propriétaire de la table.
--      `FORCE` demeure et continue de couvrir `postgres`.
--
--   3. Il est MEMBRE de `authenticated`. C'est le pivot du design : Postgres
--      fait correspondre les policies `TO <rôle>` par APPARTENANCE, pas par
--      égalité stricte. Les policies de 004 s'appliquent donc à lui
--      INCHANGÉES — pas réécrites, pas élargies, pas dupliquées.
--
-- Conséquence : aucune décision d'autorisation n'existe dans ce fichier. Les
-- portes ne testent aucun rôle, ne comparent aucun `practitioner_id`, ne
-- filtrent rien. Elles se contentent de LIRE, et c'est `patients_clinical` de
-- 004 qui décide, en s'évaluant sur `auth.uid()` — un GUC de session que
-- SECURITY DEFINER ne modifie pas. Le mur reste à un seul endroit du système.
--
-- ═══ POURQUOI L'AUDIT RESTE OBLIGATOIRE, ET NON « FORTEMENT ENCOURAGÉ » ════
--
-- `SELECT` reste révoqué à `authenticated` et `service_role` (017 §3). Le seul
-- rôle qui peut lire la table est `app_gatekeeper`, qui n'a pas de LOGIN et
-- dont personne n'est membre à part `postgres`. Or les seules fonctions qui
-- s'exécutent sous ce rôle journalisent avant de retourner, dans la MÊME
-- transaction : si l'écriture d'audit échoue, la lecture est annulée avec elle.
-- Lire sans laisser de trace n'est pas une négligence possible, c'est un
-- `permission denied`.
--
-- `audit.log_read` reste refusée à `authenticated` : les portes y accèdent par
-- leur propriétaire. On ne peut donc pas non plus FABRIQUER de fausses traces,
-- garantie que 017 §1 posait et que ce design conserve.
--
-- ═══ COMPATIBILITÉ AVEC L'AUTO-HÉBERGEMENT (ADR-001) ══════════════════════
--
-- Rien ici n'est propre au cloud Supabase. `authenticated` existe à l'identique
-- dans une installation auto-hébergée, et `app_gatekeeper` est créé par cette
-- migration elle-même. Le design ne dépend d'aucune extension, d'aucun réglage
-- de plateforme, et d'aucun privilège que le cabinet n'aurait pas sur son
-- propre serveur. Il survit tel quel au déménagement — c'est un changement de
-- machine, pas une réécriture. `pgaudit` pourra s'ajouter EN SECOND FILET
-- au-dessus (ADR-019), sans rien retirer de ceci.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Le rôle porteur
-- ---------------------------------------------------------------------------
-- NOLOGIN : aucune session ne s'ouvre sous ce rôle, jamais. Il n'existe que
-- pour être le propriétaire des trois portes.
-- Pas de `CREATE ROLE IF NOT EXISTS` en Postgres, d'où le bloc conditionnel.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_gatekeeper') THEN
    CREATE ROLE app_gatekeeper NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
                               INHERIT NOREPLICATION;
  END IF;
END $$;

-- ASSERTION, PAS AFFECTATION — et c'est mieux ainsi.
-- Première rédaction : `ALTER ROLE app_gatekeeper NOBYPASSRLS …`. Refusé à
-- l'exécution : « Only roles with the SUPERUSER attribute may alter roles with
-- the SUPERUSER attribute » — `postgres` n'est pas superutilisateur sur
-- Supabase, il ne peut donc pas POSER ces attributs.
--
-- On VÉRIFIE donc au lieu d'imposer, ce qui est plus solide : si un jour
-- quelqu'un accorde `BYPASSRLS` à ce rôle, ou le pré-crée mal, cette migration
-- refuse de s'appliquer et le dit — au lieu de corriger en silence une
-- situation que personne n'aurait vue. C'est exactement le contrôle dont
-- l'absence a laissé passer 018.
DO $$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolbypassrls, rolcanlogin INTO r
    FROM pg_roles WHERE rolname = 'app_gatekeeper';

  IF r.rolsuper OR r.rolbypassrls THEN
    RAISE EXCEPTION
      'app_gatekeeper porte SUPERUSER ou BYPASSRLS — la RLS serait contournée.'
      USING HINT = 'C''est précisément la faute de la migration 018. '
                   'Retirer l''attribut avec un rôle superutilisateur, puis rejouer.';
  END IF;

  IF r.rolcanlogin THEN
    RAISE EXCEPTION 'app_gatekeeper peut ouvrir une session — il ne doit jamais le pouvoir.';
  END IF;
END $$;

-- APPARTENANCE — le pivot. Les policies `TO authenticated` de 004 s'appliquent
-- désormais à `app_gatekeeper`, sans qu'une seule d'entre elles soit modifiée.
--
-- `WITH INHERIT TRUE` N'EST PAS DÉCORATIF, et l'omettre coûte une session.
-- Postgres fait correspondre les policies avec `has_privs_of_role()`, PAS avec
-- la simple appartenance : sans héritage effectif, `pg_has_role(…,'USAGE')` est
-- FAUX, aucune policy de 004 ne s'applique, et la RLS refuse tout par défaut —
-- la Dr #2 ne voyait plus ses PROPRES patients.
--
-- Depuis Postgres 16, l'option d'héritage est figée DANS L'APPARTENANCE au
-- moment du GRANT, d'après l'attribut du rôle À CET INSTANT. Un
-- `ALTER ROLE … INHERIT` ultérieur ne la corrige PAS rétroactivement — constaté
-- ici même : `rolinherit = true` et `pg_has_role(…,'USAGE') = false` en même
-- temps. D'où la clause explicite, qui ne dépend d'aucun ordre d'exécution.
GRANT authenticated TO app_gatekeeper WITH INHERIT TRUE;

-- `postgres` doit être membre pour pouvoir attribuer la propriété des
-- fonctions, et pour que les migrations futures puissent les remplacer.
-- Il l'était déjà implicitement en tant que créateur du rôle ; on l'écrit.
GRANT app_gatekeeper TO postgres;

COMMENT ON ROLE app_gatekeeper IS
  'ADR-019 / Q-D. Propriétaire des portes patient. Sans BYPASSRLS par '
  'conception : c''est ce qui garantit que la RLS de 004 continue de décider. '
  'Ne jamais lui accorder LOGIN, BYPASSRLS ou SUPERUSER.';

-- ---------------------------------------------------------------------------
-- 2 · Les privilèges minimaux
-- ---------------------------------------------------------------------------
-- SELECT et UPDATE sur la seule table concernée. Pas DELETE : le clinique est
-- append-only (§9), et une porte qui ne peut pas supprimer ne sera pas détournée
-- pour le faire. Pas INSERT : la création de patient n'est pas dans ADR-019 et
-- n'entrera ici que par une décision explicite.
-- `NOINHERIT` oblige à tout nommer : le rôle n'hérite pas des USAGE de schéma
-- d'`authenticated`. Sans ces deux lignes, les portes échouent à l'exécution
-- alors que la migration passe — la panne la plus coûteuse à diagnostiquer.
GRANT USAGE ON SCHEMA app   TO app_gatekeeper;
GRANT USAGE ON SCHEMA audit TO app_gatekeeper;

GRANT SELECT, UPDATE ON app.patients TO app_gatekeeper;

-- Le noyau d'audit. Il reste refusé à `authenticated` : personne ne peut
-- fabriquer une trace de lecture, seules les portes en produisent.
GRANT EXECUTE ON FUNCTION audit.log_read(uuid, text) TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 3 · Les portes
-- ---------------------------------------------------------------------------
-- Corps identiques à 017. Ce qui change : la clause de sécurité et, surtout,
-- LE PROPRIÉTAIRE — c'est lui qui fait toute la différence entre 018 et ceci.
--
-- `ALTER FUNCTION … OWNER TO` exige que le NOUVEAU propriétaire ait CREATE sur
-- le schéma. On l'accorde pour la durée du transfert et on le RETIRE aussitôt
-- après (§5) : un rôle qui peut créer des objets dans `app` pourrait y planter
-- une fonction masquant une fonction du catalogue dans le `search_path` figé
-- des portes. Le privilège n'est nécessaire qu'à cet instant précis ; il n'a
-- aucune raison de subsister ensuite.
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE OR REPLACE FUNCTION app.get_patient(p_id uuid)
RETURNS SETOF app.patients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
BEGIN
  -- Journal AVANT la lecture, même transaction. Si la RLS ne rend aucune ligne,
  -- la TENTATIVE reste tracée : « qui a cherché à ouvrir quel dossier » est
  -- précisément ce qu'un audit doit savoir dire. Et si l'insertion d'audit
  -- échoue, le RETURN QUERY n'aura jamais lieu — l'atomicité fait le reste.
  PERFORM audit.log_read(p_id, 'fiche');
  RETURN QUERY SELECT * FROM app.patients WHERE id = p_id;
END;
$$;

ALTER FUNCTION app.get_patient(uuid) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.get_patient(uuid) IS
  'ADR-019. Seule porte vers une fiche patient. Exécutée sous app_gatekeeper, '
  'rôle sans BYPASSRLS et membre de authenticated : les policies de 004 '
  's''appliquent sans être modifiées. La fonction trace, elle ne décide pas.';

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
  SELECT v.id, v.record_number, v.first_name, v.last_name, v.birth_date,
         v.phone, v.is_active, c.n
  FROM visibles v CROSS JOIN compte c
  ORDER BY v.last_name, v.first_name
  LIMIT v_limit OFFSET v_offset;
END;
$$;

ALTER FUNCTION app.search_patients(text, integer, integer) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.search_patients(text, integer, integer) IS
  'ADR-019. Seule porte vers la liste des patients. `p_limit` borné à 100 en '
  'base : une pagination que l''appelant choisit sans limite est un export.';

-- La porte d'ÉCRITURE. Nécessaire, et pas par confort : Postgres exige le
-- privilège SELECT sur les colonnes citées dans un `WHERE`, donc la révocation
-- de 017 rendait impossible tout `UPDATE … WHERE id = …`. Vérifié à
-- l'exécution : le même UPDATE **sans** WHERE passait, **avec** WHERE échouait.
-- Corriger un numéro de téléphone était devenu impossible.
--
-- ALLOWLIST STRICTE, et c'est elle qui porte la sécurité de cette fonction :
-- `cabinet_id` et `practitioner_id` n'y figurent pas. Sans ça, une écriture
-- pourrait déplacer un patient d'une praticienne vers l'autre — la cloison
-- d'ADR-003 contournée par une mise à jour de routine. `record_number` en est
-- aussi absent : la numérotation sans trou (I17) n'est pas un champ éditable.
-- Ce n'est PAS une décision d'autorisation : c'est une restriction de SURFACE,
-- identique pour tous les rôles. Qui a le droit d'écrire cette ligne reste
-- tranché par `patients_clinical` et `patients_assistant_update` de 004.
--
-- CHARGE EN JSONB PLUTÔT QUE DES PARAMÈTRES NULLABLES : avec des paramètres,
-- `NULL` signifie à la fois « ne change pas » et « efface », et on ne peut plus
-- vider `address`. Ici une clé ABSENTE ne change rien, une clé à `null` efface.
CREATE OR REPLACE FUNCTION app.update_patient(p_id uuid, p_changes jsonb)
RETURNS SETOF app.patients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  k text;
  allowed constant text[] := ARRAY[
    'first_name','last_name','birth_date','sex','phone','phone_alt',
    'address','id_document_number','id_document_issuer',
    'emergency_contact','notes_admin','is_active'];
BEGIN
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'Charge de modification invalide : un objet JSON est attendu.';
  END IF;

  -- On refuse la clé inconnue au lieu de l'ignorer. Ignorer silencieusement
  -- ferait croire à l'appelant que sa modification a été prise en compte.
  FOREACH k IN ARRAY ARRAY(SELECT jsonb_object_keys(p_changes)) LOOP
    IF NOT (k = ANY (allowed)) THEN
      RAISE EXCEPTION 'Champ non modifiable par cette porte : %.', k
        USING HINT = 'cabinet_id, practitioner_id et record_number sont exclus par conception.';
    END IF;
  END LOOP;

  -- Le déclencheur `trg_audit` de 013 journalise la modification : l'audit des
  -- écritures n'est pas réimplémenté ici, il est hérité.
  RETURN QUERY
  UPDATE app.patients p SET
    first_name         = coalesce(p_changes->>'first_name', p.first_name),
    last_name          = coalesce(p_changes->>'last_name',  p.last_name),
    birth_date         = CASE WHEN p_changes ? 'birth_date'
                         THEN (p_changes->>'birth_date')::date ELSE p.birth_date END,
    sex                = CASE WHEN p_changes ? 'sex'
                         THEN (p_changes->>'sex')::app.sex ELSE p.sex END,
    phone              = coalesce(p_changes->>'phone', p.phone),
    phone_alt          = CASE WHEN p_changes ? 'phone_alt'
                         THEN p_changes->>'phone_alt' ELSE p.phone_alt END,
    address            = CASE WHEN p_changes ? 'address'
                         THEN p_changes->>'address' ELSE p.address END,
    id_document_number = CASE WHEN p_changes ? 'id_document_number'
                         THEN p_changes->>'id_document_number' ELSE p.id_document_number END,
    id_document_issuer = CASE WHEN p_changes ? 'id_document_issuer'
                         THEN p_changes->>'id_document_issuer' ELSE p.id_document_issuer END,
    emergency_contact  = CASE WHEN p_changes ? 'emergency_contact'
                         THEN p_changes->'emergency_contact' ELSE p.emergency_contact END,
    notes_admin        = CASE WHEN p_changes ? 'notes_admin'
                         THEN p_changes->>'notes_admin' ELSE p.notes_admin END,
    is_active          = coalesce((p_changes->>'is_active')::boolean, p.is_active),
    updated_at         = now()
  WHERE p.id = p_id
  RETURNING p.*;
END;
$$;

ALTER FUNCTION app.update_patient(uuid, jsonb) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.update_patient(uuid, jsonb) IS
  'ADR-019. Seule porte d''écriture sur une fiche patient. Allowlist stricte : '
  'cabinet_id, practitioner_id et record_number sont exclus, pour qu''une mise à '
  'jour ne puisse pas déplacer un patient d''une praticienne à l''autre.';

-- ---------------------------------------------------------------------------
-- 4 · Qui peut franchir les portes
-- ---------------------------------------------------------------------------
-- `PUBLIC` reçoit EXECUTE par défaut sur toute fonction nouvellement créée :
-- sans cette révocation, `anon` — le visiteur non authentifié — pourrait
-- appeler les portes. La RLS le renverrait bredouille, mais il produirait des
-- lignes d'audit à volonté et sonderait l'existence d'un identifiant.
REVOKE ALL ON FUNCTION app.get_patient(uuid)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION app.search_patients(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.update_patient(uuid, jsonb)             FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.get_patient(uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION app.search_patients(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION app.update_patient(uuid, jsonb)             TO authenticated;

-- ---------------------------------------------------------------------------
-- 5 · Retrait du privilège de transfert
-- ---------------------------------------------------------------------------
-- La propriété des trois fonctions est acquise ; CREATE sur le schéma n'a plus
-- lieu d'être. Une migration future qui remplacerait ces fonctions le
-- réaccordera le temps de son propre transfert, et le retirera de même.
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

-- `service_role` reste exclu des trois portes, comme du SELECT direct : il
-- contourne la RLS par conception (`rolbypassrls = t`), et lui ouvrir une porte
-- auditée reviendrait à offrir un export propre plutôt qu'un accès contrôlé.

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('020_gatekeeper_role')
  ON CONFLICT DO NOTHING;

COMMIT;
