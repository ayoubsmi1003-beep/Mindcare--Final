-- ADR-aftercare-master: technical retry projects a real read, never creates one.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE FUNCTION app.get_aftercare_read_receipt(p_binding uuid,p_object uuid,p_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.aftercare_bindings; o app.aftercare_objects;
BEGIN
 SELECT * INTO b FROM app.aftercare_bindings WHERE id=p_binding AND revoked_at IS NULL;
 IF b.id IS NULL THEN RAISE EXCEPTION 'AftercareUnavailable'; END IF;
 PERFORM app.get_patient(b.patient_id);
 SELECT * INTO o FROM app.aftercare_objects WHERE binding_id=b.id AND object_id=p_object AND source='sanad' AND share_state='shared' AND version=p_version AND read_by IS NOT NULL AND read_at IS NOT NULL;
 IF o.id IS NULL THEN RAISE EXCEPTION 'AftercareReadRequired'; END IF;
 RETURN jsonb_build_object('bindingId',b.id,'patientId',b.portal_patient_id,'objectId',o.object_id,'version',o.version,'readAt',o.read_at);
END $$;
ALTER FUNCTION app.get_aftercare_read_receipt(uuid,uuid,integer) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_aftercare_read_receipt(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app.get_aftercare_read_receipt(uuid,uuid,integer) TO authenticated;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES('230_aftercare_read_receipt') ON CONFLICT DO NOTHING;
COMMIT;
