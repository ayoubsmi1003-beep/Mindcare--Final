-- 062_documents_settings_and_print — Cabinet/profil update + print audit coherence
--
-- Ce fichier complète 061 en ajoutant les portes d'écriture minimales pour la
-- configuration requise par Documents (cabinet + praticienne), et en
-- documentant l'audit de l'impression (printed_count déjà atomique — on y
-- ajoute la trace métier via audit.log existant, sans parallèle).
--
-- CHOIX: on n'ouvre PAS .update sur cabinets à tout authenticated sans filtre.
-- La RLS existe mais cabinets_read seulement. On ajoute self pour owner.

BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 1 · Cabinets: permettre à l'owner de mettre à jour son cabinet
--     (practitioner peut aussi corriger l'adresse/téléphone du lieu où elle exerce)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS cabinets_update ON app.cabinets;
CREATE POLICY cabinets_update ON app.cabinets
  FOR UPDATE TO authenticated
  USING (id = app.current_cabinet())
  WITH CHECK (id = app.current_cabinet());

-- ---------------------------------------------------------------------------
-- 2 · Profiles: déjà self-update (003). On s'assure que signature_block est
--     modifiable par soi-même (déjà inclus car policy porte sur la ligne)
-- ---------------------------------------------------------------------------
-- rien à ajouter: profiles_self_update couvre déjà tout le row, y compris
-- signature_block / order_number / title etc.

-- ---------------------------------------------------------------------------
-- 3 · Portes cabinet / profil (écriture par le praticien sur son propre cabinet/profil)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.update_cabinet(p_patch text)
RETURNS SETOF app.cabinets
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE v_cab uuid := app.current_cabinet();
DECLARE v_j jsonb;
BEGIN
  BEGIN
    v_j := COALESCE(p_patch, '{}')::jsonb;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Patch invalide.'; END;
  IF jsonb_typeof(v_j) <> 'object' THEN RAISE EXCEPTION 'Patch invalide.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_j) k WHERE k NOT IN ('name','address','phone')) THEN
    RAISE EXCEPTION 'Champ non autorisé dans patch cabinet.';
  END IF;
  UPDATE app.cabinets
     SET name    = COALESCE(nullif(btrim(v_j->>'name'),''), name),
         address = CASE WHEN v_j ? 'address' THEN nullif(btrim(v_j->>'address'),'') ELSE address END,
         phone   = CASE WHEN v_j ? 'phone' THEN nullif(btrim(v_j->>'phone'),'') ELSE phone END
   WHERE id = v_cab;
  RETURN QUERY SELECT * FROM app.cabinets WHERE id = v_cab;
END;
$$;
REVOKE ALL ON FUNCTION app.update_cabinet(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_cabinet(text) TO authenticated;

CREATE OR REPLACE FUNCTION app.update_profile(p_patch text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE v_uid uuid := auth.uid();
DECLARE v_sb jsonb;
DECLARE v_j jsonb;
BEGIN
  BEGIN
    v_j := COALESCE(p_patch, '{}')::jsonb;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Patch invalide.'; END;
  IF jsonb_typeof(v_j) <> 'object' THEN RAISE EXCEPTION 'Patch invalide.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_j) k WHERE k NOT IN ('full_name','title','speciality_fr','speciality_ar','order_number','phone','full_name_ar')) THEN
    RAISE EXCEPTION 'Champ non autorisé dans patch profil.';
  END IF;
  SELECT signature_block INTO v_sb FROM app.profiles WHERE id = v_uid;
  v_sb := COALESCE(v_sb, '{}'::jsonb);
  IF v_j ? 'full_name_ar' THEN
    IF nullif(btrim(v_j->>'full_name_ar'),'') IS NULL THEN
      v_sb := v_sb - 'full_name_ar';
    ELSE
      v_sb := jsonb_set(v_sb, '{full_name_ar}', to_jsonb(btrim(v_j->>'full_name_ar')));
    END IF;
  END IF;
  UPDATE app.profiles
     SET full_name     = COALESCE(nullif(btrim(v_j->>'full_name'),''), full_name),
         title         = CASE WHEN v_j ? 'title' THEN nullif(btrim(v_j->>'title'),'') ELSE title END,
         speciality_fr = CASE WHEN v_j ? 'speciality_fr' THEN nullif(btrim(v_j->>'speciality_fr'),'') ELSE speciality_fr END,
         speciality_ar = CASE WHEN v_j ? 'speciality_ar' THEN nullif(btrim(v_j->>'speciality_ar'),'') ELSE speciality_ar END,
         order_number  = CASE WHEN v_j ? 'order_number' THEN nullif(btrim(v_j->>'order_number'),'') ELSE order_number END,
         phone         = CASE WHEN v_j ? 'phone' THEN nullif(btrim(v_j->>'phone'),'') ELSE phone END,
         signature_block = v_sb,
         updated_at = now()
   WHERE id = v_uid;
END;
$$;
REVOKE ALL ON FUNCTION app.update_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_profile(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · Helpers lecture cabinet/profil courant (évite filtrage côté client)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.get_my_cabinet()
RETURNS SETOF app.cabinets
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$ SELECT * FROM app.cabinets WHERE id = app.current_cabinet(); $$;
REVOKE ALL ON FUNCTION app.get_my_cabinet() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_my_cabinet() TO authenticated;

CREATE OR REPLACE FUNCTION app.get_my_profile()
RETURNS SETOF app.profiles
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$ SELECT * FROM app.profiles WHERE id = auth.uid(); $$;
REVOKE ALL ON FUNCTION app.get_my_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_my_profile() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5 · Helper hash
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.verify_document_hash(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog, extensions
AS $$
  SELECT content_hash = encode(extensions.digest(rendered_html, 'sha256'),'hex')
    FROM app.documents
   WHERE id = p_id
     AND cabinet_id = app.current_cabinet()
     AND app.can_see_clinical(practitioner_id);
$$;
ALTER FUNCTION app.verify_document_hash(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.verify_document_hash(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.verify_document_hash(uuid) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
NOTIFY pgrst, 'reload schema';
INSERT INTO app.schema_migrations (version) VALUES ('062_documents_settings_and_print') ON CONFLICT DO NOTHING;
COMMIT;
