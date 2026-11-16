-- Approved ADR-aftercare-master. Source candidate only: synthetic bindings, no transport activation.
BEGIN;

CREATE ROLE aftercare_transport NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA app TO aftercare_transport;
GRANT CREATE ON SCHEMA app TO aftercare_transport,app_gatekeeper;

CREATE TABLE app.aftercare_bindings (
 id uuid PRIMARY KEY,
 cabinet_id uuid NOT NULL REFERENCES app.cabinets(id),
 practitioner_id uuid NOT NULL REFERENCES app.profiles(id),
 patient_id uuid NOT NULL REFERENCES app.patients(id),
 portal_patient_id uuid NOT NULL,
 relationship text NOT NULL CHECK(relationship IN ('self','guardian')),
 verification_evidence text NOT NULL CHECK(length(btrim(verification_evidence)) BETWEEN 1 AND 2000),
 consent_version integer NOT NULL CHECK(consent_version>0),
 verified_by uuid NOT NULL REFERENCES app.profiles(id),
 verified_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE UNIQUE INDEX aftercare_active_patient ON app.aftercare_bindings(patient_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX aftercare_active_portal ON app.aftercare_bindings(cabinet_id,portal_patient_id) WHERE revoked_at IS NULL;
CREATE TABLE app.aftercare_objects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 binding_id uuid NOT NULL REFERENCES app.aftercare_bindings(id),
 patient_id uuid NOT NULL REFERENCES app.patients(id),
 cabinet_id uuid NOT NULL REFERENCES app.cabinets(id),
 practitioner_id uuid NOT NULL REFERENCES app.profiles(id),
 object_id uuid NOT NULL,
 source text NOT NULL CHECK(source IN ('mindcare','sanad')),
 kind text NOT NULL,
 version integer NOT NULL CHECK(version>0),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),
 share_state text NOT NULL CHECK(share_state IN ('shared','revoked')),
 effective_at timestamptz NOT NULL,
 approved_by uuid REFERENCES app.profiles(id), approved_at timestamptz,
 read_by uuid REFERENCES app.profiles(id), read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(binding_id,source,object_id),
 CHECK(share_state<>'revoked' OR body='{}'::jsonb),
 CHECK((source='mindcare')=(approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TABLE app.aftercare_events (
 id uuid PRIMARY KEY,
 binding_id uuid NOT NULL REFERENCES app.aftercare_bindings(id),
 patient_id uuid NOT NULL REFERENCES app.patients(id),
 cabinet_id uuid NOT NULL REFERENCES app.cabinets(id),
 practitioner_id uuid NOT NULL REFERENCES app.profiles(id),
 object_id uuid NOT NULL,
 direction text NOT NULL CHECK(direction IN ('incoming','outgoing')),
 request_id uuid NOT NULL,
 digest text NOT NULL,
 envelope jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','applied','duplicate','stale')),
 delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(binding_id,direction,request_id)
);
CREATE INDEX aftercare_outbox_pending ON app.aftercare_events(created_at,id) WHERE direction='outgoing' AND delivered_at IS NULL;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['aftercare_bindings','aftercare_objects','aftercare_events'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON app.%I TO app_gatekeeper,aftercare_transport',t);
  EXECUTE format('CREATE POLICY aftercare_clinical ON app.%I TO app_gatekeeper USING (cabinet_id=app.current_cabinet() AND app.can_see_clinical(practitioner_id) AND EXISTS(SELECT 1 FROM app.profiles WHERE id=auth.uid() AND is_active) AND EXISTS(SELECT 1 FROM app.patients p WHERE p.id=patient_id AND app.can_see_clinical(p.practitioner_id))) WITH CHECK (cabinet_id=app.current_cabinet() AND app.can_see_clinical(practitioner_id) AND EXISTS(SELECT 1 FROM app.profiles WHERE id=auth.uid() AND is_active) AND EXISTS(SELECT 1 FROM app.patients p WHERE p.id=patient_id AND app.can_see_clinical(p.practitioner_id)))',t);
  EXECUTE format('CREATE POLICY aftercare_channel ON app.%I TO aftercare_transport USING (true) WITH CHECK (true)',t);
  EXECUTE format('CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION audit.track()',t);
 END LOOP;
END $$;

-- Closed field specification shared by SQL ingress and publication. Unknown keys fail closed.
CREATE FUNCTION app.aftercare_validate_body(p_kind text,p_body jsonb,p_source text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE spec jsonb; field record; value jsonb; rule text; item jsonb; n integer; required text[]; allowed text[];
BEGIN
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>50000 THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
 IF p_source='mindcare' THEN
  CASE p_kind
   WHEN 'mission' THEN spec='{"title":"title","purpose":"nonempty","instructions":"nonempty","durationMinutes":"duration","status":"publication","dueOn":"date","reviewAt":"date"}'; required=ARRAY['title','purpose','instructions','status'];
   WHEN 'carePlan' THEN spec='{"title":"title","text":"nonempty","status":"publication"}'; required=ARRAY['title','text','status'];
   WHEN 'doctorNote' THEN spec='{"text":"nonempty","status":"publication"}'; required=ARRAY['text','status'];
   WHEN 'review' THEN spec='{"sourceId":"uuid","sourceVersion":"version","status":"reviewed","text":"text"}'; required=ARRAY['sourceId','sourceVersion','status'];
   WHEN 'personalEvent' THEN spec='{"type":"milestone","title":"title","detail":"text","happenedOn":"date","category":"category","tags":"tags"}'; required=ARRAY['type','title','detail','happenedOn','category','tags'];
   ELSE RAISE EXCEPTION 'AftercareInvalidKind';
  END CASE;
 ELSIF p_source='sanad' THEN
  CASE p_kind
   WHEN 'journal' THEN spec='{"format":"format","text":"text","situation":"text","emotion":"text","need":"text","helped":"text","status":"saved","tags":"tags","mediaIds":"media"}'; required=ARRAY[]::text[];
   WHEN 'preparation' THEN spec='{"questions":"nonempty","summary":"text","appointmentId":"uuid","appointmentVersion":"version","selectedSources":"sources20"}'; required=ARRAY['questions'];
   WHEN 'message' THEN spec='{"category":"messageCategory","text":"text","status":"sent","simulation":"true","mediaIds":"media1"}'; required=ARRAY['category','status','simulation'];
   WHEN 'blueprint' THEN spec='{"goals":"short","helps":"short","difficult":"short","communication":"short","doctorShouldKnow":"short","supportPreferences":"short"}'; required=ARRAY['goals','helps','difficult','communication','doctorShouldKnow','supportPreferences'];
   WHEN 'missionResponse' THEN spec='{"missionId":"uuid","missionVersion":"version","status":"responseStatus","reflection":"text"}'; required=ARRAY['missionId','missionVersion','status','reflection'];
   WHEN 'personalEvent' THEN spec='{"type":"eventType","title":"title","detail":"text","happenedOn":"date","category":"category","tags":"tags","emotion":"emotion","sourceId":"uuid"}'; required=ARRAY['type','title','detail','happenedOn','category','tags'];
   WHEN 'letter' THEN spec='{"recipient":"recipient","title":"optionalTitle","text":"letter","status":"saved","mediaIds":"media"}'; required=ARRAY['recipient','title','text','status'];
   WHEN 'atlas' THEN spec='{"title":"title","nodes":"nodes","edges":"edges"}'; required=ARRAY['title','nodes','edges'];
   WHEN 'roomSession' THEN spec='{"roomType":"room","completedSteps":"steps","reflection":"text","status":"completed"}'; required=ARRAY['roomType','completedSteps','reflection','status'];
   WHEN 'report' THEN spec='{"title":"title","from":"date","to":"date","audience":"audience","selectedSources":"sources30","status":"ready","sourceSnapshot":"snapshots","generatedAt":"timestamp"}'; required=ARRAY['title','from','to','audience','selectedSources','status'];
   ELSE RAISE EXCEPTION 'AftercareInvalidKind';
  END CASE;
 ELSE RAISE EXCEPTION 'AftercareInvalidSource'; END IF;
 IF NOT p_body ?& required OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_body) k WHERE NOT spec?k) THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
 FOR field IN SELECT * FROM jsonb_each(p_body) LOOP
  value=field.value; rule=spec->>field.key;
  IF rule IN ('version','duration') THEN
   IF jsonb_typeof(value)<>'number' OR value::text !~ '^[1-9][0-9]*$' OR value::numeric>(CASE WHEN rule='duration' THEN 180 ELSE 2147483647 END) THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
  ELSIF rule='true' THEN
   IF value<>'true'::jsonb THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
  ELSIF rule IN ('tags','media','media1','steps','sources20','sources30','snapshots','nodes','edges') THEN
   n=CASE rule WHEN 'media' THEN 5 WHEN 'media1' THEN 1 WHEN 'tags' THEN 8 WHEN 'steps' THEN 12 WHEN 'sources20' THEN 20 WHEN 'sources30' THEN 30 WHEN 'snapshots' THEN 30 WHEN 'nodes' THEN 32 ELSE 64 END;
   IF jsonb_typeof(value)<>'array' OR jsonb_array_length(value)>n THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
   FOR item IN SELECT * FROM jsonb_array_elements(value) LOOP
    IF rule IN ('tags','steps','media','media1') THEN
     IF jsonb_typeof(item)<>'string' OR length(btrim(item#>>'{}')) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
     IF rule IN ('media','media1') THEN PERFORM (item#>>'{}')::uuid; END IF;
     IF rule='steps' AND item#>>'{}' NOT IN ('arrive','notice','choose','practice','reflect') THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
    ELSIF rule IN ('sources20','sources30','snapshots') THEN
     IF jsonb_typeof(item)<>'object' OR NOT item ?& ARRAY['recordId','version'] OR (SELECT count(*) FROM jsonb_object_keys(item))<>(CASE WHEN rule='snapshots' THEN 5 ELSE 2 END) OR jsonb_typeof(item->'recordId')<>'string' OR jsonb_typeof(item->'version')<>'number' OR item->>'version' !~ '^[1-9][0-9]*$' OR (item->>'version')::numeric>2147483647 THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
     PERFORM (item->>'recordId')::uuid;
     IF rule='snapshots' THEN
      IF NOT item ?& ARRAY['kind','createdAt','updatedAt'] OR jsonb_typeof(item->'kind')<>'string' OR length(btrim(item->>'kind')) NOT BETWEEN 1 AND 40 OR jsonb_typeof(item->'createdAt')<>'string' OR jsonb_typeof(item->'updatedAt')<>'string' OR item->>'createdAt' !~ '(Z|[+-]\d{2}:\d{2})$' OR item->>'updatedAt' !~ '(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
      PERFORM (item->>'createdAt')::timestamptz; PERFORM (item->>'updatedAt')::timestamptz;
     END IF;
    ELSIF rule='nodes' THEN
     IF jsonb_typeof(item)<>'object' OR NOT item ?& ARRAY['id','type','text'] OR (SELECT count(*) FROM jsonb_object_keys(item))<>3 OR jsonb_typeof(item->'id')<>'string' OR item->>'type' NOT IN ('situation','thought','emotion','sensation','response','strategy','helped') OR jsonb_typeof(item->'text')<>'string' OR length(btrim(item->>'text')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
     PERFORM (item->>'id')::uuid;
    ELSE
     IF jsonb_typeof(item)<>'object' OR NOT item ?& ARRAY['from','to'] OR (SELECT count(*) FROM jsonb_object_keys(item))<>2 OR jsonb_typeof(item->'from')<>'string' OR jsonb_typeof(item->'to')<>'string' OR item->>'from'=item->>'to' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_body->'nodes') x WHERE x->>'id'=item->>'from') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_body->'nodes') x WHERE x->>'id'=item->>'to') THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
    END IF;
   END LOOP;
   IF rule IN ('media','media1','nodes','sources20','sources30','snapshots') AND (SELECT count(DISTINCT CASE WHEN rule='nodes' THEN x->>'id' WHEN rule IN ('sources20','sources30','snapshots') THEN x->>'recordId' ELSE x::text END) FROM jsonb_array_elements(value) x)<>jsonb_array_length(value) THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
  ELSE
   IF jsonb_typeof(value)<>'string' THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
   IF length(value#>>'{}')>(CASE rule WHEN 'title' THEN 200 WHEN 'optionalTitle' THEN 200 WHEN 'short' THEN 3000 WHEN 'letter' THEN 12000 ELSE 6000 END) THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
   IF rule IN ('title','nonempty') AND length(btrim(value#>>'{}'))=0 THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
   CASE rule
    WHEN 'uuid' THEN PERFORM (value#>>'{}')::uuid;
    WHEN 'date' THEN IF value#>>'{}' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF; PERFORM (value#>>'{}')::date;
    WHEN 'timestamp' THEN IF value#>>'{}' !~ '(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF; PERFORM (value#>>'{}')::timestamptz;
    WHEN 'publication' THEN allowed=ARRAY['published','withdrawn'];
    WHEN 'reviewed' THEN allowed=ARRAY['reviewed'];
    WHEN 'milestone' THEN allowed=ARRAY['milestone'];
    WHEN 'format' THEN allowed=ARRAY['free','guided'];
    WHEN 'saved' THEN allowed=ARRAY['saved'];
    WHEN 'sent' THEN allowed=ARRAY['sent'];
    WHEN 'completed' THEN allowed=ARRAY['completed'];
    WHEN 'ready' THEN allowed=ARRAY['ready'];
    WHEN 'messageCategory' THEN allowed=ARRAY['renewal','appointment','effect','administrative'];
    WHEN 'responseStatus' THEN allowed=ARRAY['planned','completed','deferred'];
    WHEN 'eventType' THEN allowed=ARRAY['life-event','moment','victory','milestone'];
    WHEN 'category' THEN allowed=ARRAY['work','study','family','relationship','routine','challenge','achievement','other'];
    WHEN 'emotion' THEN allowed=ARRAY['happy','calm','excited','tired','sad','anxious'];
    WHEN 'recipient' THEN allowed=ARRAY['person','past-self','future-self','emotion','experience','missed-person'];
    WHEN 'room' THEN allowed=ARRAY['sleep','conversation','appointment','stress','thoughts','routine'];
    WHEN 'audience' THEN allowed=ARRAY['personal','clinician'];
    ELSE allowed=NULL;
   END CASE;
   IF allowed IS NOT NULL AND NOT (value#>>'{}'=ANY(allowed)) THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
   allowed=NULL;
  END IF;
 END LOOP;
 IF p_kind IN ('journal','blueprint','letter','message') AND NOT EXISTS(SELECT 1 FROM jsonb_each(p_body) f WHERE f.key IN ('text','situation','emotion','need','helped','title','goals','helps','difficult','communication','doctorShouldKnow','supportPreferences') AND jsonb_typeof(f.value)='string' AND length(btrim(f.value#>>'{}'))>0) AND coalesce(jsonb_array_length(p_body->'mediaIds'),0)=0 THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
 IF p_kind='journal' AND p_body->>'format'='free' AND NOT p_body ?& ARRAY['text','status'] THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
 IF p_kind='journal' AND coalesce(p_body->>'format','guided')='guided' AND NOT p_body ?& ARRAY['situation','emotion','need','helped'] THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
 IF p_kind='letter' AND length(btrim(p_body->>'text'))=0 THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
 IF p_kind='preparation' AND (p_body?'appointmentId')<>(p_body?'appointmentVersion') THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
 IF p_kind='report' AND ((p_body->>'to')::date<(p_body->>'from')::date OR (p_body->>'to')::date-(p_body->>'from')::date>90) THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
 IF p_kind='report' AND ((p_body?'sourceSnapshot')<>(p_body?'generatedAt') OR (p_body?'sourceSnapshot' AND (SELECT coalesce(jsonb_agg(jsonb_build_object('recordId',x->'recordId','version',x->'version') ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(p_body->'sourceSnapshot') WITH ORDINALITY s(x,ord)) IS DISTINCT FROM p_body->'selectedSources')) THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
END $$;
REVOKE ALL ON FUNCTION app.aftercare_validate_body(text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app.aftercare_validate_body(text,jsonb,text) TO app_gatekeeper,aftercare_transport;

CREATE FUNCTION app.verify_aftercare_binding(p_binding uuid,p_patient uuid,p_portal_patient uuid,p_relationship text,p_evidence text,p_consent_version integer,p_confirmed boolean)
RETURNS SETOF app.aftercare_bindings LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE p app.patients; b app.aftercare_bindings;
BEGIN
 IF p_confirmed IS DISTINCT FROM true OR p_binding IS NULL OR p_portal_patient IS NULL THEN RAISE EXCEPTION 'AftercareConfirmationRequired'; END IF;
 SELECT * INTO p FROM app.get_patient(p_patient);
 IF p.id IS NULL OR NOT p.is_synthetic OR NOT app.can_see_clinical(p.practitioner_id) THEN RAISE EXCEPTION 'AftercareUnavailable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_patient::text,227));
 SELECT * INTO b FROM app.aftercare_bindings WHERE id=p_binding FOR UPDATE;
 IF FOUND THEN
  IF b.patient_id<>p_patient OR b.portal_patient_id<>p_portal_patient OR b.relationship IS DISTINCT FROM p_relationship OR b.verification_evidence IS DISTINCT FROM p_evidence OR b.consent_version IS DISTINCT FROM p_consent_version OR b.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'AftercareConflict'; END IF;
  RETURN NEXT b; RETURN;
 END IF;
 INSERT INTO app.aftercare_bindings(id,cabinet_id,practitioner_id,patient_id,portal_patient_id,relationship,verification_evidence,consent_version,verified_by)
 VALUES(p_binding,p.cabinet_id,p.practitioner_id,p.id,p_portal_patient,p_relationship,p_evidence,p_consent_version,auth.uid()) RETURNING * INTO b;
 RETURN NEXT b;
END $$;

CREATE FUNCTION app.revoke_aftercare_binding(p_binding uuid,p_confirmed boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.aftercare_bindings;
BEGIN
 SELECT * INTO b FROM app.aftercare_bindings WHERE id=p_binding FOR UPDATE;
 IF b.id IS NULL OR p_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'AftercareUnavailable'; END IF;
 PERFORM app.get_patient(b.patient_id);
 UPDATE app.aftercare_bindings SET revoked_at=coalesce(revoked_at,now()) WHERE id=b.id;
 UPDATE app.aftercare_objects SET body='{}',share_state='revoked',updated_at=now() WHERE binding_id=b.id AND share_state='shared';
END $$;

CREATE FUNCTION app.publish_aftercare_object(p_binding uuid,p_object uuid,p_expected_version integer,p_kind text,p_body jsonb,p_request uuid,p_confirmed boolean)
RETURNS SETOF app.aftercare_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.aftercare_bindings; o app.aftercare_objects; e app.aftercare_events; v integer; body jsonb; envelope jsonb; command jsonb; h text; event_id uuid=gen_random_uuid();
BEGIN
 IF p_confirmed IS DISTINCT FROM true OR p_object IS NULL OR p_request IS NULL OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'AftercareConfirmationRequired'; END IF;
 SELECT * INTO b FROM app.aftercare_bindings WHERE id=p_binding AND revoked_at IS NULL FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'AftercareUnavailable'; END IF;
 PERFORM app.get_patient(b.patient_id);
 PERFORM app.aftercare_validate_body(p_kind,p_body,'mindcare');
 command=jsonb_build_object('object',p_object,'expectedVersion',p_expected_version,'kind',p_kind,'body',p_body);
 h=encode(sha256(convert_to(command::text,'UTF8')),'hex');
 SELECT * INTO e FROM app.aftercare_events WHERE binding_id=b.id AND direction='outgoing' AND request_id=p_request;
 IF FOUND THEN IF e.digest<>h THEN RAISE EXCEPTION 'AftercareConflict'; END IF; RETURN NEXT e; RETURN; END IF;
 SELECT * INTO o FROM app.aftercare_objects WHERE binding_id=b.id AND source='mindcare' AND object_id=p_object FOR UPDATE;
 IF coalesce(o.version,0)<>p_expected_version OR (o.id IS NOT NULL AND o.kind<>p_kind) THEN RAISE EXCEPTION 'AftercareConflict'; END IF;
 IF p_kind='review' THEN
  PERFORM 1 FROM app.aftercare_objects WHERE binding_id=b.id AND source='sanad' AND object_id=(p_body->>'sourceId')::uuid AND version=(p_body->>'sourceVersion')::integer AND share_state='shared' AND read_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AftercareReadRequired'; END IF;
 END IF;
 v=p_expected_version+1;
 body=p_body||CASE WHEN p_kind='review' THEN jsonb_build_object('reviewedBy',auth.uid(),'reviewedAt',now()) ELSE jsonb_build_object('approvedBy',auth.uid(),'publishedAt',now()) END;
 envelope=jsonb_build_object('schemaVersion',2,'eventId',event_id,'patientId',b.portal_patient_id,'bindingId',b.id,'objectId',p_object,'version',v,'effectiveAt',now(),'emittedAt',now(),'source','mindcare','correlationId',p_request,'shareState','shared','object',jsonb_build_object('kind',p_kind,'body',body));
 INSERT INTO app.aftercare_objects(binding_id,patient_id,cabinet_id,practitioner_id,object_id,source,kind,version,body,share_state,effective_at,approved_by,approved_at)
 VALUES(b.id,b.patient_id,b.cabinet_id,b.practitioner_id,p_object,'mindcare',p_kind,v,body,'shared',now(),auth.uid(),now())
 ON CONFLICT(binding_id,source,object_id) DO UPDATE SET version=excluded.version,body=excluded.body,share_state='shared',effective_at=excluded.effective_at,approved_by=excluded.approved_by,approved_at=excluded.approved_at,updated_at=now();
 INSERT INTO app.aftercare_events(id,binding_id,patient_id,cabinet_id,practitioner_id,object_id,direction,request_id,digest,envelope,status)
 VALUES(event_id,b.id,b.patient_id,b.cabinet_id,b.practitioner_id,p_object,'outgoing',p_request,h,envelope,'pending') RETURNING * INTO e;
 RETURN NEXT e;
END $$;

CREATE FUNCTION app.ingest_aftercare_event(p_clinic uuid,p_envelope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.aftercare_bindings; o app.aftercare_objects; e app.aftercare_events; v_body jsonb; v_object_id uuid; v_event_id uuid; v_request_id uuid; v integer; kind text; state text; h text; outcome text='applied'; effective timestamptz;
BEGIN
 IF jsonb_typeof(p_envelope) IS DISTINCT FROM 'object' OR octet_length(p_envelope::text)>60000 OR NOT p_envelope ?& ARRAY['schemaVersion','eventId','patientId','bindingId','objectId','version','effectiveAt','emittedAt','source','correlationId','shareState','object'] OR (SELECT count(*) FROM jsonb_object_keys(p_envelope))<>12 OR p_envelope->'schemaVersion'<>'2'::jsonb OR p_envelope->>'source'<>'sanad' OR jsonb_typeof(p_envelope->'version')<>'number' OR p_envelope->>'version' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'AftercareInvalidEnvelope'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_envelope) f WHERE f.key NOT IN ('schemaVersion','version','object') AND jsonb_typeof(f.value)<>'string') THEN RAISE EXCEPTION 'AftercareInvalidEnvelope'; END IF;
 v_event_id=(p_envelope->>'eventId')::uuid; v_request_id=(p_envelope->>'correlationId')::uuid; v_object_id=(p_envelope->>'objectId')::uuid; v=(p_envelope->>'version')::integer;
 IF p_envelope->>'effectiveAt' !~ '(Z|[+-]\d{2}:\d{2})$' OR p_envelope->>'emittedAt' !~ '(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'AftercareInvalidEnvelope'; END IF;
 effective=(p_envelope->>'effectiveAt')::timestamptz; PERFORM (p_envelope->>'emittedAt')::timestamptz;
 IF jsonb_typeof(p_envelope->'object')<>'object' OR NOT (p_envelope->'object') ?& ARRAY['kind','body'] OR (SELECT count(*) FROM jsonb_object_keys(p_envelope->'object'))<>2 OR jsonb_typeof(p_envelope->'object'->'kind')<>'string' THEN RAISE EXCEPTION 'AftercareInvalidEnvelope'; END IF;
 kind=p_envelope->'object'->>'kind'; v_body=p_envelope->'object'->'body'; state=p_envelope->>'shareState';
 IF kind NOT IN ('journal','preparation','message','report','missionResponse','blueprint','personalEvent','letter','atlas','roomSession') OR state NOT IN ('shared','revoked') THEN RAISE EXCEPTION 'AftercareInvalidKind'; END IF;
 IF state='shared' THEN PERFORM app.aftercare_validate_body(kind,v_body,'sanad'); ELSIF v_body IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'AftercareInvalidBody'; END IF;
 SELECT * INTO b FROM app.aftercare_bindings WHERE id=(p_envelope->>'bindingId')::uuid AND cabinet_id=p_clinic AND portal_patient_id=(p_envelope->>'patientId')::uuid AND revoked_at IS NULL FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'AftercareUnavailable'; END IF;
 h=encode(sha256(convert_to(p_envelope::text,'UTF8')),'hex');
 SELECT * INTO e FROM app.aftercare_events WHERE id=v_event_id OR (binding_id=b.id AND direction='incoming' AND request_id=v_request_id);
 IF FOUND THEN
  IF e.id<>v_event_id OR e.binding_id<>b.id OR e.direction<>'incoming' OR e.request_id<>v_request_id OR e.digest<>h THEN RAISE EXCEPTION 'AftercareConflict'; END IF;
  RETURN jsonb_build_object('schemaVersion',2,'eventId',v_event_id,'correlationId',v_request_id,'status','duplicate','technicalOnly',true);
 END IF;
 SELECT * INTO o FROM app.aftercare_objects WHERE binding_id=b.id AND source='sanad' AND aftercare_objects.object_id=v_object_id FOR UPDATE;
 IF o.id IS NOT NULL AND o.kind<>kind THEN RAISE EXCEPTION 'AftercareConflict'; END IF;
 IF o.id IS NOT NULL AND v=o.version AND state='shared' AND o.share_state='shared' AND o.body IS DISTINCT FROM v_body THEN RAISE EXCEPTION 'AftercareConflict'; END IF;
 IF state='shared' AND o.id IS NOT NULL AND v<=o.version THEN outcome='stale';
 ELSE
  IF state='shared' AND kind='missionResponse' THEN
   PERFORM 1 FROM app.aftercare_objects WHERE binding_id=b.id AND source='mindcare' AND aftercare_objects.object_id=(v_body->>'missionId')::uuid AND version=(v_body->>'missionVersion')::integer AND aftercare_objects.kind='mission' AND share_state='shared' AND aftercare_objects.body->>'status'='published';
   IF NOT FOUND THEN RAISE EXCEPTION 'AftercareUnavailable'; END IF;
  END IF;
  INSERT INTO app.aftercare_objects(binding_id,patient_id,cabinet_id,practitioner_id,object_id,source,kind,version,body,share_state,effective_at)
  VALUES(b.id,b.patient_id,b.cabinet_id,b.practitioner_id,v_object_id,'sanad',kind,greatest(v,coalesce(o.version,0)),v_body,state,effective)
  ON CONFLICT(binding_id,source,object_id) DO UPDATE SET version=excluded.version,body=excluded.body,share_state=excluded.share_state,effective_at=excluded.effective_at,read_by=NULL,read_at=NULL,updated_at=now();
 END IF;
 INSERT INTO app.aftercare_events(id,binding_id,patient_id,cabinet_id,practitioner_id,object_id,direction,request_id,digest,envelope,status)
 VALUES(v_event_id,b.id,b.patient_id,b.cabinet_id,b.practitioner_id,v_object_id,'incoming',v_request_id,h,CASE WHEN state='revoked' THEN p_envelope ELSE p_envelope #- '{object,body}' END,outcome);
 RETURN jsonb_build_object('schemaVersion',2,'eventId',v_event_id,'correlationId',v_request_id,'status',outcome,'technicalOnly',true);
END $$;

CREATE FUNCTION app.ack_aftercare_event(p_clinic uuid,p_event uuid,p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE e app.aftercare_events;
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('applied','duplicate','stale') THEN RAISE EXCEPTION 'AftercareInvalidAck'; END IF;
 SELECT * INTO e FROM app.aftercare_events WHERE id=p_event AND cabinet_id=p_clinic AND direction='outgoing' FOR UPDATE;
 IF e.id IS NULL THEN RAISE EXCEPTION 'AftercareUnavailable'; END IF;
 IF e.delivered_at IS NOT NULL THEN RETURN; END IF;
 UPDATE app.aftercare_events SET delivered_at=coalesce(delivered_at,now()),status=p_status WHERE id=e.id;
END $$;

CREATE FUNCTION app.list_aftercare_objects(p_patient uuid,p_limit integer DEFAULT 25,p_offset integer DEFAULT 0)
RETURNS SETOF app.aftercare_objects LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 PERFORM app.get_patient(p_patient);
 RETURN QUERY SELECT o.* FROM app.aftercare_objects o JOIN app.aftercare_bindings b ON b.id=o.binding_id WHERE o.patient_id=p_patient AND b.revoked_at IS NULL AND o.share_state='shared' ORDER BY o.updated_at DESC,o.id LIMIT least(greatest(coalesce(p_limit,25),1),50) OFFSET greatest(coalesce(p_offset,0),0);
END $$;

CREATE FUNCTION app.list_aftercare_bindings(p_patient uuid) RETURNS SETOF app.aftercare_bindings
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 PERFORM app.get_patient(p_patient);
 RETURN QUERY SELECT * FROM app.aftercare_bindings WHERE patient_id=p_patient ORDER BY verified_at DESC,id;
END $$;

CREATE FUNCTION app.pending_aftercare_events(p_clinic uuid,p_limit integer DEFAULT 25) RETURNS SETOF jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT e.envelope FROM app.aftercare_events e JOIN app.aftercare_bindings b ON b.id=e.binding_id
 WHERE e.cabinet_id=p_clinic AND e.direction='outgoing' AND e.delivered_at IS NULL AND b.revoked_at IS NULL
 ORDER BY e.created_at,e.id LIMIT least(greatest(coalesce(p_limit,25),1),50)
$$;

CREATE FUNCTION app.read_aftercare_object(p_binding uuid,p_object uuid,p_version integer) RETURNS SETOF app.aftercare_objects
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.aftercare_bindings; o app.aftercare_objects;
BEGIN
 SELECT * INTO b FROM app.aftercare_bindings WHERE id=p_binding AND revoked_at IS NULL FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'AftercareUnavailable'; END IF;
 PERFORM app.get_patient(b.patient_id);
 UPDATE app.aftercare_objects SET read_by=auth.uid(),read_at=now() WHERE binding_id=b.id AND object_id=p_object AND source='sanad' AND share_state='shared' AND version=p_version RETURNING * INTO o;
 IF o.id IS NULL THEN RAISE EXCEPTION 'AftercareUnavailable'; END IF;
 RETURN NEXT o;
END $$;

-- Reply is a doctorNote publication carrying the exact reviewed submission reference.
-- Reuse the review gate: its optional text is the human reply, never a generated answer.

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('verify_aftercare_binding','revoke_aftercare_binding','publish_aftercare_object','ingest_aftercare_event','ack_aftercare_event','pending_aftercare_events','list_aftercare_objects','list_aftercare_bindings','read_aftercare_object') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  IF f.proname IN ('ingest_aftercare_event','ack_aftercare_event','pending_aftercare_events') THEN
   EXECUTE format('ALTER FUNCTION %s OWNER TO aftercare_transport',f.signature);
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mindcare_app') THEN
    GRANT USAGE ON SCHEMA app TO mindcare_app;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO mindcare_app',f.signature);
   END IF;
  ELSE
   EXECUTE format('ALTER FUNCTION %s OWNER TO app_gatekeeper',f.signature);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
  END IF;
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA app FROM aftercare_transport,app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES('227_aftercare_master') ON CONFLICT DO NOTHING;
COMMIT;
