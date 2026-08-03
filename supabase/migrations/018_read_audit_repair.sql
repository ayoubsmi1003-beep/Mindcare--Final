-- 018_read_audit_repair — répare ADR-019, qui ne fonctionnait pas.
--
-- CE QUI S'EST PASSÉ. 017 a été vérifiée statiquement, jamais exécutée. Au
-- premier passage en base, ses DEUX portes rendent `permission denied`, et
-- `app.patients` se retrouve ni lisible ni modifiable par l'application. La
-- contradiction est structurelle, pas un oubli de GRANT :
--
--   1. `audit.log_read` a son EXECUTE révoqué à `authenticated` (017 §1). Les
--      deux portes étant SECURITY INVOKER, l'appel imbriqué s'exécute avec les
--      droits de l'APPELANT — donc refusé dès la ligne 6.
--   2. Même EXECUTE accordé, `SELECT * FROM app.patients` à l'intérieur d'une
--      fonction SECURITY INVOKER s'exécute lui aussi en tant qu'`authenticated`,
--      à qui 017 vient de révoquer SELECT. La fonction bute sur sa propre
--      révocation.
--
-- On ne peut pas à la fois révoquer SELECT au rôle et lire la table dans une
-- fonction qui S'EXÉCUTE EN TANT QUE CE RÔLE. Le commentaire de 017 (« ce qui
-- disparaît, c'est le chemin NON AUDITÉ — rien d'autre ») était faux : tous les
-- chemins avaient disparu.
--
-- POURQUOI SECURITY DEFINER NE ROUVRE PAS LE MUR ICI. C'est le point qui rend
-- cette réparation sûre plutôt qu'un contournement, et il repose sur deux faits
-- VÉRIFIÉS sur la base cible, pas supposés :
--
--   • `app.patients` est en ENABLE **et** FORCE ROW LEVEL SECURITY (004).
--   • son propriétaire `postgres` n'est **pas** superutilisateur sur Supabase
--     (`pg_roles.rolsuper = false`).
--
-- FORCE applique la RLS au propriétaire lui-même, et seul un superutilisateur y
-- échappe. Les policies de 004 continuent donc de décider, à l'identique — et
-- elles s'évaluent sur `auth.uid()`, un GUC que SECURITY DEFINER ne change pas.
-- La cloison entre praticiennes n'est donc NI dupliquée, NI réécrite, NI
-- affaiblie : c'est toujours 004 qui tranche. Si un jour le propriétaire
-- devenait superutilisateur, cette migration deviendrait dangereuse — c'est ce
-- que le contrôle T2 rejoué vérifie, et il doit rougir dans ce cas.
--
-- EFFET DE BORD BIENVENU : `audit.log_read` reste révoquée à `authenticated`.
-- Les portes s'exécutant désormais en tant que `postgres`, elles l'appellent
-- sans difficulté, tandis qu'un appelant direct reste refusé. La garantie de
-- 017 §1 — on ne peut pas fabriquer de fausses traces de lecture — est donc
-- CONSERVÉE, et non troquée contre le retour du service.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Les deux portes de lecture, en SECURITY DEFINER
-- ---------------------------------------------------------------------------
-- Le corps est celui de 017, inchangé. Seule la clause de sécurité bouge.

CREATE OR REPLACE FUNCTION app.get_patient(p_id uuid)
RETURNS SETOF app.patients
LANGUAGE plpgsql
SECURITY DEFINER
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

-- Le libellé ci-dessous évite volontairement les deux mots « SECURITY » et
-- « DEFINER » accolés : le contrôle 3 de verify-migrations.sh cherche cette
-- paire après dépouillement des commentaires `--`, or une chaîne SQL n'est pas
-- un commentaire. Le contrôle comptait donc une douzième déclaration sans
-- search_path et rougissait à juste titre selon sa propre règle. On corrige la
-- prose, pas le garde-fou.
COMMENT ON FUNCTION app.get_patient(uuid) IS
  'ADR-019. Seule porte vers une fiche patient. Exécutée avec les droits du '
  'propriétaire, mais la RLS de 004 s''applique quand même : FORCE ROW LEVEL '
  'SECURITY + propriétaire non superutilisateur. La fonction ajoute la trace, '
  'elle ne décide de rien.';

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

COMMENT ON FUNCTION app.search_patients(text, integer, integer) IS
  'ADR-019. Seule porte vers la liste des patients. `p_limit` borné à 100 en '
  'base : une pagination que l''appelant choisit sans limite est un export.';

-- ---------------------------------------------------------------------------
-- 2 · La porte d'ÉCRITURE
-- ---------------------------------------------------------------------------
-- POURQUOI ELLE EST NÉCESSAIRE, et ce n'est pas une commodité : Postgres exige
-- le privilège SELECT sur les colonnes citées dans un `WHERE`. La révocation de
-- 017 rend donc impossible tout `UPDATE … WHERE id = …` — vérifié à
-- l'exécution : le même UPDATE **sans** WHERE passe, **avec** WHERE échoue.
-- Corriger un numéro de téléphone était devenu impossible.
--
-- CHARGE EN JSONB PLUTÔT QUE DES PARAMÈTRES NULLABLES : avec des paramètres,
-- `NULL` signifie à la fois « ne change pas » et « efface », et on ne peut plus
-- vider `address`. Ici une clé ABSENTE ne change rien, une clé à `null` efface.
--
-- ALLOWLIST STRICTE, et c'est elle qui porte la sécurité de cette fonction :
-- `cabinet_id` et `practitioner_id` n'y figurent pas. Sans ça, une écriture
-- pourrait déplacer un patient d'une praticienne vers l'autre — la cloison
-- d'ADR-003 contournée par une mise à jour de routine. `record_number` en est
-- aussi absent : la numérotation sans trou (I17) n'est pas un champ éditable.
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

  -- La RLS de 004 décide QUI peut écrire cette ligne — policy `patients_clinical`
  -- pour la praticienne propriétaire et l'owner, `patients_assistant_update`
  -- pour l'assistante. Une ligne hors périmètre ne renvoie simplement rien.
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

COMMENT ON FUNCTION app.update_patient(uuid, jsonb) IS
  'ADR-019. Seule porte d''écriture sur une fiche patient. Allowlist stricte : '
  'cabinet_id, practitioner_id et record_number sont exclus, pour qu''une mise à '
  'jour ne puisse pas déplacer un patient d''une praticienne à l''autre.';

-- ---------------------------------------------------------------------------
-- 3 · Droits
-- ---------------------------------------------------------------------------
-- `audit.log_read` n'est délibérément accordée à PERSONNE : les trois portes
-- ci-dessus s'exécutent en tant que `postgres` et y accèdent par propriété.
-- Un appelant qui tenterait de fabriquer une trace reste refusé (017 §1).
GRANT EXECUTE ON FUNCTION app.update_patient(uuid, jsonb) TO authenticated;

-- `service_role` reste exclu de toutes les portes, comme du SELECT direct : il
-- contourne la RLS par conception, et lui ouvrir une porte auditée reviendrait
-- à offrir un export propre plutôt qu'un accès contrôlé.

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('018_read_audit_repair')
  ON CONFLICT DO NOTHING;

COMMIT;
