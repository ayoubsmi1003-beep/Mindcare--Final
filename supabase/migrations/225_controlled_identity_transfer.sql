BEGIN;
-- Administrative transfer only. No application account can edit the controlled identity.
CREATE FUNCTION app.provision_document_identity(p_profile uuid,p_cabinet uuid,p_identity jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=app,pg_catalog AS $$
DECLARE pr app.profiles%ROWTYPE; cb app.cabinets%ROWTYPE; j jsonb:=p_identity->'practitioner'; c jsonb:=p_identity->'cabinet'; k text;
BEGIN
 IF jsonb_typeof(j) IS DISTINCT FROM 'object' OR jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'IdentityTransferInvalid';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(j) key WHERE key NOT IN ('full_name','title','speciality_fr','speciality_ar','order_number','phone','full_name_ar','document_footer')) OR EXISTS(SELECT 1 FROM jsonb_object_keys(c) key WHERE key NOT IN ('name','address','phone')) THEN RAISE EXCEPTION 'IdentityTransferInvalid';END IF;
 FOREACH k IN ARRAY ARRAY['full_name','title','speciality_fr','speciality_ar','order_number','phone','full_name_ar'] LOOP
  IF jsonb_typeof(j->k) IS DISTINCT FROM 'string' OR length(btrim(j->>k)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'IdentityTransferIncomplete';END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['name','address','phone'] LOOP
  IF jsonb_typeof(c->k) IS DISTINCT FROM 'string' OR length(btrim(c->>k)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'IdentityTransferIncomplete';END IF;
 END LOOP;
 IF j?'document_footer' THEN
  IF jsonb_typeof(j->'document_footer') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(j->'document_footer') key WHERE key NOT IN ('facebook_label','instagram_label')) THEN RAISE EXCEPTION 'IdentityTransferInvalid';END IF;
  FOR k IN SELECT jsonb_object_keys(j->'document_footer') LOOP
   IF jsonb_typeof(j->'document_footer'->k) IS DISTINCT FROM 'string' OR length(btrim(j->'document_footer'->>k)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'IdentityTransferInvalid';END IF;
  END LOOP;
 END IF;
 SELECT * INTO pr FROM app.profiles WHERE id=p_profile AND cabinet_id=p_cabinet AND is_active AND role IN ('owner','practitioner') FOR UPDATE;
 SELECT * INTO cb FROM app.cabinets WHERE id=p_cabinet FOR UPDATE;
 IF pr.id IS NULL OR cb.id IS NULL THEN RAISE EXCEPTION 'IdentityTransferTargetInvalid';END IF;
 IF pr.signature_block IS NOT NULL AND jsonb_typeof(pr.signature_block)<>'object' THEN RAISE EXCEPTION 'IdentityTransferInvalid';END IF;
 IF (nullif(btrim(pr.full_name),'') IS NOT NULL AND pr.full_name IS DISTINCT FROM j->>'full_name') OR (nullif(btrim(pr.title),'') IS NOT NULL AND pr.title IS DISTINCT FROM j->>'title') OR (nullif(btrim(pr.speciality_fr),'') IS NOT NULL AND pr.speciality_fr IS DISTINCT FROM j->>'speciality_fr') OR (nullif(btrim(pr.speciality_ar),'') IS NOT NULL AND pr.speciality_ar IS DISTINCT FROM j->>'speciality_ar') OR (nullif(btrim(pr.order_number),'') IS NOT NULL AND pr.order_number IS DISTINCT FROM j->>'order_number') OR (nullif(btrim(pr.phone),'') IS NOT NULL AND pr.phone IS DISTINCT FROM j->>'phone') OR (nullif(pr.signature_block->>'full_name_ar','') IS NOT NULL AND pr.signature_block->>'full_name_ar' IS DISTINCT FROM j->>'full_name_ar') OR (pr.signature_block?'document_footer' AND j?'document_footer' AND pr.signature_block->'document_footer' IS DISTINCT FROM j->'document_footer') OR (nullif(cb.name,'') IS NOT NULL AND cb.name IS DISTINCT FROM c->>'name') OR (nullif(cb.address,'') IS NOT NULL AND cb.address IS DISTINCT FROM c->>'address') OR (nullif(cb.phone,'') IS NOT NULL AND cb.phone IS DISTINCT FROM c->>'phone') THEN RAISE EXCEPTION 'IdentityTransferConflict';END IF;
 UPDATE app.profiles SET full_name=coalesce(nullif(btrim(pr.full_name),''),j->>'full_name'),
 title=coalesce(nullif(btrim(pr.title),''),j->>'title'),
 speciality_fr=coalesce(nullif(btrim(pr.speciality_fr),''),j->>'speciality_fr'),
 speciality_ar=coalesce(nullif(btrim(pr.speciality_ar),''),j->>'speciality_ar'),
 order_number=coalesce(nullif(btrim(pr.order_number),''),j->>'order_number'),
 phone=coalesce(nullif(btrim(pr.phone),''),j->>'phone'),
 signature_block=coalesce(signature_block,'{}')||jsonb_build_object('full_name_ar',j->>'full_name_ar')||CASE WHEN j?'document_footer' THEN jsonb_build_object('document_footer',j->'document_footer') ELSE '{}'::jsonb END,updated_at=now() WHERE id=p_profile;
 UPDATE app.cabinets SET name=coalesce(nullif(name,''),c->>'name'),address=coalesce(nullif(address,''),c->>'address'),phone=coalesce(nullif(phone,''),c->>'phone') WHERE id=p_cabinet;
END $$;
REVOKE ALL ON FUNCTION app.provision_document_identity(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO app.schema_migrations(version) VALUES ('225_controlled_identity_transfer') ON CONFLICT DO NOTHING;
COMMIT;
