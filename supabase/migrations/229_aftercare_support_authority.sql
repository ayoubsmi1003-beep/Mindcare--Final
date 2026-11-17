-- ADR-aftercare-master Feature8: human recipient verification, never an access grant.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE TABLE app.aftercare_authority_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE,
 binding_id uuid NOT NULL REFERENCES app.aftercare_bindings(id),
 patient_id uuid NOT NULL REFERENCES app.patients(id),
 cabinet_id uuid NOT NULL REFERENCES app.cabinets(id),
 practitioner_id uuid NOT NULL REFERENCES app.profiles(id),
 relationship_id uuid NOT NULL,
 evidence_ref text NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 200 AND evidence_ref ~ '^[A-Za-z0-9_./:-]+$'),
 scopes text[] NOT NULL CHECK(cardinality(scopes) BETWEEN 1 AND 3 AND scopes <@ ARRAY['emotional-support','care-coordination','legal-representation']::text[]),
 verified_by uuid NOT NULL REFERENCES app.profiles(id),
 verified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.aftercare_authority_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.aftercare_authority_decisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.aftercare_authority_decisions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON app.aftercare_authority_decisions TO app_gatekeeper;
CREATE POLICY authority_clinical ON app.aftercare_authority_decisions TO app_gatekeeper
 USING(cabinet_id=app.current_cabinet() AND app.can_see_clinical(practitioner_id) AND EXISTS(SELECT 1 FROM app.profiles WHERE id=auth.uid() AND is_active) AND EXISTS(SELECT 1 FROM app.patients p WHERE p.id=patient_id AND app.can_see_clinical(p.practitioner_id)))
 WITH CHECK(cabinet_id=app.current_cabinet() AND app.can_see_clinical(practitioner_id) AND EXISTS(SELECT 1 FROM app.profiles WHERE id=auth.uid() AND is_active) AND EXISTS(SELECT 1 FROM app.patients p WHERE p.id=patient_id AND app.can_see_clinical(p.practitioner_id)));
CREATE FUNCTION app.aftercare_forbid_authority_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AftercareAuthorityImmutable'; END $$;
REVOKE ALL ON FUNCTION app.aftercare_forbid_authority_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER authority_immutable BEFORE UPDATE OR DELETE ON app.aftercare_authority_decisions FOR EACH ROW EXECUTE FUNCTION app.aftercare_forbid_authority_mutation();
CREATE TRIGGER trg_audit AFTER INSERT ON app.aftercare_authority_decisions FOR EACH ROW EXECUTE FUNCTION audit.track();

CREATE FUNCTION app.approve_aftercare_support_verification(p_binding uuid,p_relationship uuid,p_evidence_ref text,p_scopes text[],p_request uuid,p_confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.aftercare_bindings; decision app.aftercare_authority_decisions;
BEGIN
 IF p_confirmed IS DISTINCT FROM true OR p_relationship IS NULL OR p_request IS NULL OR p_evidence_ref IS NULL OR length(p_evidence_ref) NOT BETWEEN 1 AND 200 OR p_evidence_ref !~ '^[A-Za-z0-9_./:-]+$' OR p_scopes IS NULL OR cardinality(p_scopes) NOT BETWEEN 1 AND 3 OR NOT p_scopes<@ARRAY['emotional-support','care-coordination','legal-representation']::text[] OR array_position(p_scopes,NULL) IS NOT NULL OR (SELECT count(DISTINCT x) FROM unnest(p_scopes) x)<>cardinality(p_scopes) THEN RAISE EXCEPTION 'AftercareConfirmationRequired'; END IF;
 SELECT * INTO b FROM app.aftercare_bindings WHERE id=p_binding AND revoked_at IS NULL FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'AftercareUnavailable'; END IF;
 PERFORM app.get_patient(b.patient_id);
 SELECT * INTO decision FROM app.aftercare_authority_decisions WHERE request_id=p_request;
 IF FOUND THEN
  IF decision.binding_id<>b.id OR decision.relationship_id<>p_relationship OR decision.evidence_ref<>p_evidence_ref OR decision.scopes IS DISTINCT FROM p_scopes THEN RAISE EXCEPTION 'AftercareConflict'; END IF;
 ELSE
  INSERT INTO app.aftercare_authority_decisions(request_id,binding_id,patient_id,cabinet_id,practitioner_id,relationship_id,evidence_ref,scopes,verified_by)
  VALUES(p_request,b.id,b.patient_id,b.cabinet_id,b.practitioner_id,p_relationship,p_evidence_ref,p_scopes,auth.uid()) RETURNING * INTO decision;
 END IF;
 RETURN jsonb_build_object('bindingId',b.id,'patientId',b.portal_patient_id,'action','verify','relationshipId',decision.relationship_id,'clinicianId',decision.verified_by,'evidenceRef',decision.evidence_ref,'scopes',decision.scopes);
END $$;
ALTER FUNCTION app.approve_aftercare_support_verification(uuid,uuid,text,text[],uuid,boolean) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.approve_aftercare_support_verification(uuid,uuid,text,text[],uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app.approve_aftercare_support_verification(uuid,uuid,text,text[],uuid,boolean) TO authenticated;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES('229_aftercare_support_authority') ON CONFLICT DO NOTHING;
COMMIT;
