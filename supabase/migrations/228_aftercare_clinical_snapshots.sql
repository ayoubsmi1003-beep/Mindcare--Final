-- ADR-aftercare-master forward228: approved snapshots, never clinical mutations.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper,aftercare_transport;
GRANT SELECT ON app.patient_treatments,app.medications,app.appointments TO app_gatekeeper;

ALTER FUNCTION app.aftercare_validate_body(text,jsonb,text) RENAME TO aftercare_validate_body_227;
CREATE FUNCTION app.aftercare_validate_body(p_kind text,p_body jsonb,p_source text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE cleaned jsonb=p_body; field text; item jsonb;
BEGIN
 IF p_source='sanad' AND p_kind IN ('journal','preparation') THEN
  IF p_kind='journal' AND p_body?'emotionTag' THEN
   IF jsonb_typeof(p_body->'emotionTag')<>'string' OR p_body->>'emotionTag' NOT IN ('happy','calm','excited','tired','sad','anxious') THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
   cleaned=cleaned-'emotionTag';
  ELSIF p_kind='preparation' THEN
   FOREACH field IN ARRAY ARRAY['improved','difficult','surprised','unspoken','doctorShouldKnow'] LOOP
    IF p_body?field THEN IF jsonb_typeof(p_body->field)<>'string' OR length(p_body->>field)>6000 THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF; cleaned=cleaned-field; END IF;
   END LOOP;
  END IF;
 END IF;
 IF p_source='mindcare' AND p_kind IN ('treatment','appointment') THEN
  IF jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>50000 OR NOT p_body?&ARRAY['sourceVersion','sourceUpdatedAt'] THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
  PERFORM (p_body->>'sourceUpdatedAt')::timestamptz;
  IF p_kind='treatment' THEN
   IF NOT p_body?&ARRAY['name','status','validFrom','validUntil','schedule','asNeeded','remindersAuthorizedUntil'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_body) k WHERE k NOT IN ('name','status','dose','instructions','validFrom','validUntil','schedule','asNeeded','remindersAuthorizedUntil','sourceVersion','sourceUpdatedAt')) OR jsonb_typeof(p_body->'name')<>'string' OR length(btrim(p_body->>'name')) NOT BETWEEN 1 AND 300 OR p_body->>'status' NOT IN ('active','paused','stopped') OR jsonb_typeof(p_body->'sourceVersion')<>'number' OR p_body->>'sourceVersion' !~ '^[1-9][0-9]*$' OR jsonb_typeof(p_body->'asNeeded')<>'boolean' OR p_body->'remindersAuthorizedUntil'<>'null'::jsonb OR jsonb_typeof(p_body->'schedule')<>'array' OR jsonb_array_length(p_body->'schedule')>24 THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
   IF p_body?'dose' AND (jsonb_typeof(p_body->'dose')<>'string' OR length(btrim(p_body->>'dose')) NOT BETWEEN 1 AND 1000) THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
   IF p_body?'instructions' AND (jsonb_typeof(p_body->'instructions')<>'string' OR length(btrim(p_body->>'instructions')) NOT BETWEEN 1 AND 12000) THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
   PERFORM (p_body->>'validFrom')::timestamptz;
   IF p_body->'validUntil'<>'null'::jsonb THEN IF (p_body->>'validUntil')::timestamptz<=(p_body->>'validFrom')::timestamptz THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF; END IF;
   FOR item IN SELECT * FROM jsonb_array_elements(p_body->'schedule') LOOP IF jsonb_typeof(item)<>'string' OR item#>>'{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF; END LOOP;
  ELSE
   IF NOT p_body?&ARRAY['confirmedAt','startsAt','status'] OR (SELECT count(*) FROM jsonb_object_keys(p_body))<>5 OR p_body->>'status' NOT IN ('confirmed','cancelled') OR jsonb_typeof(p_body->'sourceVersion')<>'string' THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
   PERFORM (p_body->>'confirmedAt')::timestamptz; PERFORM (p_body->>'startsAt')::timestamptz;
   IF p_body->>'sourceVersion' IS DISTINCT FROM p_body->>'sourceUpdatedAt' THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
  END IF;
  RETURN;
 END IF;
 PERFORM app.aftercare_validate_body_227(p_kind,cleaned,p_source);
END $$;
REVOKE ALL ON FUNCTION app.aftercare_validate_body(text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app.aftercare_validate_body(text,jsonb,text) TO app_gatekeeper,aftercare_transport;

-- Keep the original atomic gate private; public generic publication cannot forge snapshots.
ALTER FUNCTION app.publish_aftercare_object(uuid,uuid,integer,text,jsonb,uuid,boolean) RENAME TO aftercare_publish_object_base;
REVOKE ALL ON FUNCTION app.aftercare_publish_object_base(uuid,uuid,integer,text,jsonb,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION app.publish_aftercare_object(p_binding uuid,p_object uuid,p_expected_version integer,p_kind text,p_body jsonb,p_request uuid,p_confirmed boolean)
RETURNS SETOF app.aftercare_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 IF p_kind NOT IN ('mission','carePlan','doctorNote','review','personalEvent') THEN RAISE EXCEPTION 'AftercareInvalidKind'; END IF;
 RETURN QUERY SELECT * FROM app.aftercare_publish_object_base(p_binding,p_object,p_expected_version,p_kind,p_body,p_request,p_confirmed);
END $$;

CREATE FUNCTION app.aftercare_snapshot_source(p_patient uuid,p_kind text,p_source uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE result jsonb;
BEGIN
 IF p_kind='treatment' THEN
  SELECT jsonb_build_object('id',t.id,'kind','treatment','sourceVersion',t.current_version::text,'body',
   jsonb_strip_nulls(jsonb_build_object('name',coalesce(nullif(btrim(m.brand_name),''),m.inn),'status',t.status,'dose',nullif(btrim(concat_ws(' ',nullif(t.dose,''),nullif(t.dose_unit,''))),''),'instructions',nullif(btrim(concat_ws(E'\n',nullif(t.frequency,''),nullif(t.instructions,''))),''),'sourceVersion',t.current_version,'sourceUpdatedAt',t.updated_at,'validFrom',t.start_date::timestamp AT TIME ZONE 'Africa/Algiers'))
   ||jsonb_build_object('validUntil',CASE WHEN t.end_date IS NULL THEN NULL ELSE (t.end_date+1)::timestamp AT TIME ZONE 'Africa/Algiers' END,'schedule','[]'::jsonb,'asNeeded',false,'remindersAuthorizedUntil',NULL)) INTO result
   FROM app.patient_treatments t JOIN app.medications m ON m.id=t.medication_id WHERE t.id=p_source AND t.patient_id=p_patient;
 ELSIF p_kind='appointment' THEN
  SELECT jsonb_build_object('id',a.id,'kind','appointment','sourceVersion',to_jsonb(a.updated_at)#>>'{}','body',jsonb_build_object('startsAt',a.starts_at,'status',a.status,'confirmedAt',now(),'sourceVersion',a.updated_at,'sourceUpdatedAt',a.updated_at)) INTO result FROM app.appointments a WHERE a.id=p_source AND a.patient_id=p_patient AND a.status IN ('confirmed','cancelled');
 END IF;
 IF result IS NOT NULL THEN
  result=result||jsonb_build_object('publicationVersion',coalesce((SELECT o.version FROM app.aftercare_objects o JOIN app.aftercare_bindings b ON b.id=o.binding_id WHERE b.patient_id=p_patient AND b.revoked_at IS NULL AND o.source='mindcare' AND o.object_id=p_source),0));
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.aftercare_snapshot_source(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app.aftercare_snapshot_source(uuid,text,uuid) TO app_gatekeeper;

CREATE FUNCTION app.list_aftercare_clinical_sources(p_patient uuid) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 PERFORM app.get_patient(p_patient);
 IF NOT EXISTS(SELECT 1 FROM app.aftercare_bindings WHERE patient_id=p_patient AND revoked_at IS NULL) THEN RETURN; END IF;
 RETURN QUERY SELECT app.aftercare_snapshot_source(p_patient,'treatment',t.id) FROM app.patient_treatments t WHERE t.patient_id=p_patient ORDER BY t.updated_at DESC,t.id LIMIT 50;
 RETURN QUERY SELECT app.aftercare_snapshot_source(p_patient,'appointment',a.id) FROM app.appointments a WHERE a.patient_id=p_patient AND a.status IN ('confirmed','cancelled') ORDER BY a.starts_at DESC,a.id LIMIT 50;
END $$;

CREATE FUNCTION app.publish_aftercare_clinical_snapshot(p_binding uuid,p_kind text,p_source uuid,p_source_version text,p_expected_version integer,p_schedule jsonb,p_as_needed boolean,p_request uuid,p_confirmed boolean)
RETURNS SETOF app.aftercare_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.aftercare_bindings; snapshot jsonb; body jsonb; previous app.aftercare_events;
BEGIN
 IF p_confirmed IS DISTINCT FROM true OR p_kind NOT IN ('treatment','appointment') OR p_source IS NULL OR p_request IS NULL OR p_as_needed IS NULL THEN RAISE EXCEPTION 'AftercareConfirmationRequired'; END IF;
 SELECT * INTO b FROM app.aftercare_bindings WHERE id=p_binding AND revoked_at IS NULL FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'AftercareUnavailable'; END IF;
 PERFORM app.get_patient(b.patient_id);
 SELECT * INTO previous FROM app.aftercare_events WHERE binding_id=b.id AND direction='outgoing' AND request_id=p_request;
 IF FOUND THEN
  IF previous.object_id<>p_source OR previous.envelope->'object'->>'kind'<>p_kind OR previous.envelope->'object'->'body'->>'sourceVersion'<>p_source_version OR (previous.envelope->>'version')::integer<>p_expected_version+1 OR (p_kind='treatment' AND (previous.envelope->'object'->'body'->'schedule' IS DISTINCT FROM p_schedule OR previous.envelope->'object'->'body'->'asNeeded' IS DISTINCT FROM to_jsonb(p_as_needed))) THEN RAISE EXCEPTION 'AftercareConflict'; END IF;
  RETURN NEXT previous; RETURN;
 END IF;
 IF p_kind='treatment' THEN PERFORM 1 FROM app.patient_treatments WHERE id=p_source AND patient_id=b.patient_id FOR UPDATE;
 ELSE PERFORM 1 FROM app.appointments WHERE id=p_source AND patient_id=b.patient_id FOR UPDATE; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'AftercareUnavailable'; END IF;
 snapshot=app.aftercare_snapshot_source(b.patient_id,p_kind,p_source);
 IF snapshot IS NULL OR snapshot->>'sourceVersion' IS DISTINCT FROM p_source_version THEN RAISE EXCEPTION 'AftercareConflict'; END IF;
 body=snapshot->'body';
 IF p_kind='treatment' THEN body=body||jsonb_build_object('schedule',p_schedule,'asNeeded',p_as_needed); END IF;
 RETURN QUERY SELECT * FROM app.aftercare_publish_object_base(b.id,p_source,p_expected_version,p_kind,body,p_request,p_confirmed);
END $$;

CREATE FUNCTION app.aftercare_binding_registration(p_clinic uuid,p_binding uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('bindingId',b.id,'patientId',b.portal_patient_id,'consentVersion',b.consent_version,'relationship',b.relationship,'verifiedBy',b.verified_by,'revoked',b.revoked_at IS NOT NULL) FROM app.aftercare_bindings b WHERE b.id=p_binding AND b.cabinet_id=p_clinic
$$;
REVOKE ALL ON FUNCTION app.aftercare_binding_registration(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION app.aftercare_binding_registration(uuid,uuid) OWNER TO aftercare_transport;
GRANT EXECUTE ON FUNCTION app.aftercare_binding_registration(uuid,uuid) TO mindcare_app;
DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['app.publish_aftercare_object(uuid,uuid,integer,text,jsonb,uuid,boolean)','app.list_aftercare_clinical_sources(uuid)','app.publish_aftercare_clinical_snapshot(uuid,text,uuid,text,integer,jsonb,boolean,uuid,boolean)'] LOOP
  EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO app_gatekeeper';
  EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,anon,authenticated,service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO authenticated';
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper,aftercare_transport;
INSERT INTO app.schema_migrations(version) VALUES('228_aftercare_clinical_snapshots') ON CONFLICT DO NOTHING;
COMMIT;
