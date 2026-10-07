BEGIN;
ALTER TABLE app.prescriptions ADD COLUMN document_status text NOT NULL DEFAULT 'issued' CHECK(document_status IN ('issued','voided'));
ALTER TABLE app.prescription_lines ADD COLUMN document_medication jsonb;
GRANT INSERT,UPDATE ON app.prescriptions TO app_gatekeeper;
GRANT INSERT ON app.prescription_lines TO app_gatekeeper;
INSERT INTO app.document_templates(cabinet_id,doc_type,version,title_fr,header_html,body_html,content_json,is_active)
 SELECT c.id,'ordonnance',1,'Ordonnance','','','{"type":"doc","content":[{"type":"paragraph","content":[]}]}'::jsonb,true FROM app.cabinets c WHERE NOT EXISTS(SELECT 1 FROM app.document_templates t WHERE t.cabinet_id=c.id AND t.doc_type='ordonnance');
CREATE FUNCTION app.link_document_prescription() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,pg_catalog AS $$
DECLARE prescription uuid;node jsonb;attrs jsonb;position integer:=0;BEGIN
 IF NEW.doc_type<>'ordonnance' THEN RETURN NEW;END IF;
 IF NEW.content_json IS NULL OR NEW.source_draft_id IS NULL THEN RAISE EXCEPTION 'PrescriptionEditableDraftRequired';END IF;
 INSERT INTO app.prescriptions(cabinet_id,practitioner_id,patient_id,prescribed_at,is_handwritten,is_synthetic)
 VALUES(NEW.cabinet_id,NEW.practitioner_id,NEW.patient_id,NEW.issued_at,false,NEW.is_synthetic) RETURNING id INTO prescription;
 FOR node IN SELECT value FROM jsonb_array_elements(NEW.content_json->'content') WHERE value->>'type'='medication' LOOP
 attrs:=node->'attrs';position:=position+1;
 IF btrim(attrs->>'designation')='' OR btrim(attrs->>'posology')='' THEN RAISE EXCEPTION 'PrescriptionMedicationInvalid';END IF;
 INSERT INTO app.prescription_lines(prescription_id,medication_id,free_text,dose,instructions,position,is_synthetic,document_medication)
 VALUES(prescription,CASE WHEN attrs->>'source'='catalogue' THEN (attrs->>'medicationId')::uuid ELSE NULL END,attrs->>'designation',attrs->>'posology',attrs->>'instructions',position,NEW.is_synthetic,attrs);
 END LOOP;
 IF position=0 THEN RAISE EXCEPTION 'PrescriptionEmpty';END IF;
 NEW.prescription_id:=prescription;RETURN NEW;
END $$;
ALTER FUNCTION app.link_document_prescription() OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.link_document_prescription() FROM PUBLIC;
CREATE TRIGGER document_prescription_link BEFORE INSERT ON app.documents FOR EACH ROW EXECUTE FUNCTION app.link_document_prescription();
CREATE FUNCTION app.void_document_prescription() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,pg_catalog AS $$
BEGIN IF NEW.status='voided' AND OLD.status='issued' AND NEW.prescription_id IS NOT NULL THEN UPDATE app.prescriptions SET document_status='voided' WHERE id=NEW.prescription_id;END IF;RETURN NEW;END $$;
ALTER FUNCTION app.void_document_prescription() OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.void_document_prescription() FROM PUBLIC;
CREATE TRIGGER document_prescription_void AFTER UPDATE OF status ON app.documents FOR EACH ROW EXECUTE FUNCTION app.void_document_prescription();
-- Enrich the existing audited workspace read. Its authorization and audit remain inside the original door.
ALTER FUNCTION app.get_patient_workspace(uuid) RENAME TO _get_patient_workspace_before_document_editor;
REVOKE ALL ON FUNCTION app._get_patient_workspace_before_document_editor(uuid) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION app._get_patient_workspace_before_document_editor(uuid) TO app_gatekeeper;
CREATE FUNCTION app.get_patient_workspace(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,pg_catalog AS $$
DECLARE result jsonb;prescription uuid;status text;lines jsonb;BEGIN
 result:=app._get_patient_workspace_before_document_editor(p_id);
 prescription:=(result#>>'{traitements,derniere_prescription,id}')::uuid;
 IF prescription IS NULL THEN RETURN result;END IF;
 SELECT document_status INTO status FROM app.prescriptions WHERE id=prescription;
 result:=jsonb_set(result,'{traitements,derniere_prescription,document_status}',to_jsonb(status));
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',l.id,'designation',COALESCE(l.document_medication->>'designation',m.inn,l.free_text),'brand_name',m.brand_name,'dose',l.dose,'frequency_per_day',l.frequency_per_day,'duration_days',l.duration_days,'instructions',l.instructions,'document_medication',l.document_medication) ORDER BY l.position),'[]') INTO lines FROM app.prescription_lines l LEFT JOIN app.medications m ON m.id=l.medication_id WHERE l.prescription_id=prescription;
 RETURN jsonb_set(result,'{traitements,derniere_prescription,lignes}',lines);
END $$;
ALTER FUNCTION app.get_patient_workspace(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_patient_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_patient_workspace(uuid) TO authenticated;
INSERT INTO app.schema_migrations(version) VALUES ('132_document_editor_prescription') ON CONFLICT DO NOTHING;
COMMIT;
