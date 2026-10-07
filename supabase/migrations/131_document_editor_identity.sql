BEGIN;
CREATE FUNCTION app.update_document_order_number(p_order_number text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,pg_catalog AS $$
BEGIN
 IF app.current_role() NOT IN ('owner','practitioner') OR auth.uid() IS NULL THEN RAISE EXCEPTION 'DocumentIdentityDenied' USING ERRCODE='42501';END IF;
 IF p_order_number IS NULL OR char_length(btrim(p_order_number)) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'DocumentOrderInvalid';END IF;
 UPDATE app.profiles SET order_number=btrim(p_order_number),updated_at=now() WHERE id=auth.uid() AND cabinet_id=app.current_cabinet();
END $$;
ALTER FUNCTION app.update_document_order_number(text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.update_document_order_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_document_order_number(text) TO authenticated;
-- Ordinary settings cannot alter the controlled professional identity. Provisioning remains privileged.
REVOKE UPDATE ON app.profiles,app.cabinets FROM authenticated;
GRANT UPDATE(order_number,updated_at) ON app.profiles TO app_gatekeeper;
GRANT UPDATE(id) ON app.cabinets TO app_gatekeeper;
CREATE OR REPLACE FUNCTION app.update_profile(p_patch text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=app,pg_catalog AS $$
DECLARE j jsonb:=p_patch::jsonb;BEGIN
 IF jsonb_typeof(j)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(j) k WHERE k<>'order_number') THEN RAISE EXCEPTION 'DocumentIdentityControlled' USING ERRCODE='42501';END IF;
 IF j?'order_number' THEN PERFORM app.update_document_order_number(j->>'order_number');END IF;
END $$;
CREATE OR REPLACE FUNCTION app.update_cabinet(p_patch text) RETURNS SETOF app.cabinets LANGUAGE plpgsql SECURITY INVOKER SET search_path=app,pg_catalog AS $$
BEGIN RAISE EXCEPTION 'DocumentIdentityControlled' USING ERRCODE='42501';END $$;
-- Keep the issuance lock order stable and protect identity from concurrent setting updates.
ALTER FUNCTION app.issue_editable_document_draft(uuid,integer,text,text,text) RENAME TO _issue_editable_document_draft_locked;
REVOKE ALL ON FUNCTION app._issue_editable_document_draft_locked(uuid,integer,text,text,text) FROM authenticated,PUBLIC;
CREATE FUNCTION app.issue_editable_document_draft(p_id uuid,p_revision integer,p_content_hash text,p_identity_version text,p_manifest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,pg_catalog AS $$
DECLARE d app.document_drafts%ROWTYPE;BEGIN
 SELECT * INTO d FROM app.document_drafts WHERE id=p_id AND practitioner_id=auth.uid() FOR UPDATE;
 IF d.id IS NULL THEN RETURN NULL;END IF;
 PERFORM 1 FROM app.profiles WHERE id=d.practitioner_id FOR SHARE;
 PERFORM 1 FROM app.cabinets WHERE id=d.cabinet_id FOR SHARE;
 RETURN app._issue_editable_document_draft_locked(p_id,p_revision,p_content_hash,p_identity_version,p_manifest);
END $$;
ALTER FUNCTION app.issue_editable_document_draft(uuid,integer,text,text,text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.issue_editable_document_draft(uuid,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.issue_editable_document_draft(uuid,integer,text,text,text) TO authenticated;
INSERT INTO app.schema_migrations(version) VALUES ('131_document_editor_identity') ON CONFLICT DO NOTHING;
COMMIT;
