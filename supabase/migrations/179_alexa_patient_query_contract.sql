-- Bounded patient predicates and explicit creation/consultation periods. Existing RLS and audit retained.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE OR REPLACE FUNCTION app.search_patients(p_spec text, p_as_of timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE s jsonb; cond jsonb; n numeric; m text; lim integer; offst integer;
 clinical boolean; financial boolean; result jsonb; anchor date; filter_groups jsonb; all_filters jsonb; period_name text; period_spec jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(app.can_see_admin(),false) THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501'; END IF;
 IF length(p_spec)>8000 OR p_as_of IS NULL THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END IF;
 s:=p_spec::jsonb; m:=coalesce(s->>'mode','count');
 IF jsonb_typeof(s)<>'object' OR m NOT IN ('count','list','metrics','review')
 OR coalesce(s->>'population','active') NOT IN ('active','archived','all')
 OR coalesce(s->>'sort','name') NOT IN ('name','outstanding_desc')
 OR length(coalesce(s->>'query',''))>160
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE k NOT IN ('mode','population','sort','query','filters','metrics','patientIds','limit','offset','revision','filterGroups','consultationPeriod','createdPeriod'))
 THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END IF;
 lim:=coalesce((s->>'limit')::integer,20); offst:=coalesce((s->>'offset')::integer,0);
 IF lim NOT BETWEEN 1 AND 20 OR offst NOT BETWEEN 0 AND 10000
 OR jsonb_typeof(coalesce(s->'filters','[]'))<>'array' OR jsonb_array_length(coalesce(s->'filters','[]'))>12
 OR jsonb_typeof(coalesce(s->'patientIds','[]'))<>'array' OR jsonb_array_length(coalesce(s->'patientIds','[]'))>100
 OR jsonb_typeof(coalesce(s->'metrics','[]'))<>'array' OR jsonb_array_length(coalesce(s->'metrics','[]'))>7
 OR (m='metrics' AND jsonb_array_length(coalesce(s->'metrics','[]'))=0)
 OR (m<>'metrics' AND s ? 'metrics')
 THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END IF;
 IF s ? 'filterGroups' AND (s ? 'filters' OR m='metrics') THEN RAISE EXCEPTION 'Invalid groups' USING ERRCODE='22023'; END IF;
 filter_groups:=CASE WHEN s ? 'filterGroups' THEN s->'filterGroups' ELSE jsonb_build_array(coalesce(s->'filters','[]')) END;
 IF jsonb_typeof(filter_groups)<>'array' OR jsonb_array_length(filter_groups) NOT BETWEEN 1 AND 4
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(filter_groups) g WHERE jsonb_typeof(g)<>'array' OR (s ? 'filterGroups' AND jsonb_array_length(g)=0))
 THEN RAISE EXCEPTION 'Invalid groups' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(f),'[]') INTO all_filters FROM jsonb_array_elements(filter_groups) g CROSS JOIN LATERAL jsonb_array_elements(g) f;
 IF jsonb_array_length(all_filters)>12 THEN RAISE EXCEPTION 'Too many conditions' USING ERRCODE='22023'; END IF;
 FOREACH period_name IN ARRAY ARRAY['createdPeriod','consultationPeriod'] LOOP
  IF s ? period_name THEN
   period_spec:=s->period_name;
   IF jsonb_typeof(period_spec)<>'object' OR NOT (period_spec ?& ARRAY['from','to']) OR m='metrics'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(period_spec) k WHERE k NOT IN ('from','to','axis'))
    OR (period_spec->>'from')::timestamptz IS NULL OR (period_spec->>'to')::timestamptz IS NULL
    OR (period_spec->>'from')::timestamptz >= (period_spec->>'to')::timestamptz
    OR (period_name='createdPeriod' AND period_spec ? 'axis')
    OR (period_name='consultationPeriod' AND (coalesce(period_spec->>'axis','') NOT IN ('started_at','ended_at') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(all_filters) f WHERE f->>'field'='completed_consultations')))
   THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023'; END IF;
  END IF;
 END LOOP;
 FOR cond IN SELECT value FROM jsonb_array_elements(all_filters) LOOP
  IF jsonb_typeof(cond)<>'object' OR jsonb_typeof(cond->'field')<>'string' OR jsonb_typeof(cond->'op')<>'string' OR NOT (cond ?& ARRAY['field','op','value']) OR (SELECT count(*) FROM jsonb_object_keys(cond))<>3 THEN RAISE EXCEPTION 'Invalid condition' USING ERRCODE='22023'; END IF;
  IF cond->>'field' IN ('phone','identity_card','birth_date','sex') THEN
   IF NOT coalesce((cond->>'op' IN ('missing','present') AND cond->'value'='null'::jsonb) OR (cond->>'field'='sex' AND cond->>'op'='eq' AND jsonb_typeof(cond->'value')='string' AND cond->>'value' IN ('M','F')),false) THEN RAISE EXCEPTION 'Invalid condition' USING ERRCODE='22023'; END IF;
  ELSIF cond->>'field'='administrative_incomplete' THEN
   IF cond->>'op'<>'eq' OR cond->'value'<>'true'::jsonb THEN RAISE EXCEPTION 'Invalid condition' USING ERRCODE='22023'; END IF;
  ELSIF cond->>'field' IN ('age','completed_consultations','outstanding_balance','no_completed_days','no_completed_months') THEN
   IF jsonb_typeof(cond->'value')<>'number' OR cond->>'op' NOT IN ('eq','gt','gte','lt','lte') THEN RAISE EXCEPTION 'Invalid condition' USING ERRCODE='22023'; END IF;
   n:=(cond->>'value')::numeric;
   IF n<>trunc(n) OR n<0 OR n>1000000 OR (cond->>'field'='age' AND n>120)
    OR (cond->>'field' IN ('no_completed_days','no_completed_months') AND (cond->>'op'<>'eq' OR n<1 OR n>CASE WHEN cond->>'field'='no_completed_days' THEN 3650 ELSE 120 END))
   THEN RAISE EXCEPTION 'Invalid condition' USING ERRCODE='22023'; END IF;
  ELSE RAISE EXCEPTION 'Unsupported condition' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(s->'metrics','[]')) x WHERE x NOT IN ('active','missing_identity_card','missing_phone','children','unknown_age','not_seen_6m','never_seen')) THEN RAISE EXCEPTION 'Unsupported metric' USING ERRCODE='22023'; END IF;
 clinical:=EXISTS(SELECT 1 FROM jsonb_array_elements(all_filters) x WHERE x->>'field' IN ('completed_consultations','outstanding_balance','no_completed_days','no_completed_months'))
  OR coalesce(s->'metrics','[]') ?| ARRAY['not_seen_6m','never_seen'];
 financial:=EXISTS(SELECT 1 FROM jsonb_array_elements(all_filters) x WHERE x->>'field'='outstanding_balance') OR coalesce(s->>'sort'='outstanding_desc',false);
 -- An assistant's restricted clinical/payment visibility must never be interpreted as zero attendance/debt.
 IF (clinical OR financial) AND app.current_role() NOT IN ('owner','practitioner') THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501'; END IF;
 -- Whole-history absence/balance predicates cannot be proved from a practitioner's
 -- RLS subset: another practitioner may have treated the same patient. Fail closed.
 IF (clinical OR financial) AND app.current_role()<>'owner' THEN RAISE EXCEPTION 'Complete domain visibility required' USING ERRCODE='42501'; END IF;
 IF s ? 'consultationPeriod' AND EXISTS(SELECT 1 FROM jsonb_array_elements(all_filters) f WHERE f->>'field' IN ('no_completed_days','no_completed_months')) THEN RAISE EXCEPTION 'Conflicting periods' USING ERRCODE='22023'; END IF;
 anchor:=(p_as_of AT TIME ZONE 'Africa/Algiers')::date;
 PERFORM audit.log_read(NULL,'recherche');
 WITH population AS MATERIALIZED (
  SELECT p.*,extract(year FROM age(anchor,p.birth_date))::integer AS age_years
  FROM app.patients p
  WHERE (CASE coalesce(s->>'population','active') WHEN 'active' THEN p.is_active WHEN 'archived' THEN NOT p.is_active ELSE true END)
   AND (NOT (clinical OR financial) OR app.can_see_clinical(p.practitioner_id))
   AND (nullif(btrim(s->>'query'),'') IS NULL OR position(app.nom_recherche(s->>'query') IN app.nom_recherche(p.first_name||' '||p.last_name))>0 OR app.nom_recherche(s->>'query')=app.nom_recherche(p.record_number))
   AND (NOT s ? 'patientIds' OR p.id IN (SELECT value::uuid FROM jsonb_array_elements_text(s->'patientIds')))
   AND (NOT s ? 'createdPeriod' OR p.created_at >= (s->'createdPeriod'->>'from')::timestamptz AND p.created_at < (s->'createdPeriod'->>'to')::timestamptz)
 ), visits AS MATERIALIZED (
  SELECT c.patient_id,count(*) AS completed,max(c.started_at) AS last_completed
  FROM app.consultations c JOIN population p ON p.id=c.patient_id
  WHERE clinical AND c.status='closed' AND c.ended_at IS NOT NULL AND c.started_at<=p_as_of
   AND (NOT s ? 'consultationPeriod' OR (CASE WHEN s->'consultationPeriod'->>'axis'='ended_at' THEN c.ended_at ELSE c.started_at END) >= (s->'consultationPeriod'->>'from')::timestamptz AND (CASE WHEN s->'consultationPeriod'->>'axis'='ended_at' THEN c.ended_at ELSE c.started_at END) < (s->'consultationPeriod'->>'to')::timestamptz) GROUP BY c.patient_id
 ), balances AS MATERIALIZED (
  SELECT pay.patient_id,coalesce(sum(pay.amount_dzd) FILTER(WHERE pay.collected_at IS NULL),0)::bigint AS balance
  FROM app.payments pay JOIN population p ON p.id=pay.patient_id WHERE financial GROUP BY pay.patient_id
 ), base AS MATERIALIZED (
  SELECT p.*,coalesce(v.completed,0) AS completed,v.last_completed,coalesce(b.balance,0) AS balance,
   ARRAY_REMOVE(ARRAY[CASE WHEN app.alexa_missing_text(p.phone) THEN 'phone' END,
    CASE WHEN app.alexa_missing_text(p.id_document_number) THEN 'identity_card' END,
    CASE WHEN p.birth_date IS NULL THEN 'birth_date' END,CASE WHEN p.sex IS NULL THEN 'sex' END],NULL) AS missing
  FROM population p LEFT JOIN visits v ON v.patient_id=p.id LEFT JOIN balances b ON b.patient_id=p.id
 ), matches AS MATERIALIZED (
  SELECT b.* FROM base b WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(filter_groups) g WHERE NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements(g) f WHERE NOT coalesce(CASE
    WHEN f->>'field'='phone' THEN CASE WHEN f->>'op'='present' THEN NOT (app.alexa_missing_text(b.phone)) ELSE app.alexa_missing_text(b.phone) END
    WHEN f->>'field'='identity_card' THEN CASE WHEN f->>'op'='present' THEN NOT (app.alexa_missing_text(b.id_document_number)) ELSE app.alexa_missing_text(b.id_document_number) END
    WHEN f->>'field'='birth_date' THEN CASE WHEN f->>'op'='present' THEN NOT (b.birth_date IS NULL) ELSE b.birth_date IS NULL END
    WHEN f->>'field'='sex' THEN CASE WHEN f->>'op'='present' THEN NOT (b.sex IS NULL) WHEN f->>'op'='eq' THEN b.sex::text=f->>'value' ELSE b.sex IS NULL END
    WHEN f->>'field'='administrative_incomplete' THEN cardinality(b.missing)>0
    WHEN f->>'field'='no_completed_days' THEN b.last_completed IS NULL OR b.last_completed < p_as_of - make_interval(days=>(f->>'value')::integer)
    WHEN f->>'field'='no_completed_months' THEN b.last_completed IS NULL OR b.last_completed < (p_as_of AT TIME ZONE 'Africa/Algiers' - make_interval(months=>(f->>'value')::integer)) AT TIME ZONE 'Africa/Algiers'
    ELSE CASE f->>'op'
     WHEN 'gte' THEN (CASE f->>'field' WHEN 'age' THEN b.age_years WHEN 'completed_consultations' THEN b.completed WHEN 'outstanding_balance' THEN b.balance END)>=(f->>'value')::numeric
     WHEN 'gt' THEN (CASE f->>'field' WHEN 'age' THEN b.age_years WHEN 'completed_consultations' THEN b.completed WHEN 'outstanding_balance' THEN b.balance END)>(f->>'value')::numeric
     WHEN 'lt' THEN (CASE f->>'field' WHEN 'age' THEN b.age_years WHEN 'completed_consultations' THEN b.completed WHEN 'outstanding_balance' THEN b.balance END)<(f->>'value')::numeric
     WHEN 'lte' THEN (CASE f->>'field' WHEN 'age' THEN b.age_years WHEN 'completed_consultations' THEN b.completed WHEN 'outstanding_balance' THEN b.balance END)<=(f->>'value')::numeric
     WHEN 'eq' THEN (CASE f->>'field' WHEN 'age' THEN b.age_years WHEN 'completed_consultations' THEN b.completed WHEN 'outstanding_balance' THEN b.balance END)=(f->>'value')::numeric END END,false)
  ))
 ), page AS (
  SELECT id,first_name,last_name,missing,CASE WHEN clinical THEN completed END AS completed_consultations,
   CASE WHEN financial THEN balance END AS outstanding_balance FROM matches
  ORDER BY CASE WHEN s->>'sort'='outstanding_desc' THEN balance END DESC,last_name,first_name,id
  LIMIT CASE WHEN m IN ('count','metrics') THEN 0 ELSE lim END OFFSET offst
 ), metrics AS (
  SELECT jsonb_build_object('active',count(*) FILTER(WHERE is_active),'missing_identity_card',count(*) FILTER(WHERE app.alexa_missing_text(id_document_number)),
   'missing_phone',count(*) FILTER(WHERE app.alexa_missing_text(phone)),'children',count(*) FILTER(WHERE age_years<18),'unknown_age',count(*) FILTER(WHERE age_years IS NULL),
   'not_seen_6m',count(*) FILTER(WHERE last_completed IS NULL OR last_completed < (p_as_of AT TIME ZONE 'Africa/Algiers' - interval '6 months') AT TIME ZONE 'Africa/Algiers'),
   'never_seen',count(*) FILTER(WHERE last_completed IS NULL)) AS all_metrics FROM matches
 ), revision AS (
  SELECT md5(coalesce(string_agg(id::text||':'||updated_at::text||':'||completed::text||':'||coalesce(last_completed::text,'')||':'||balance::text,',' ORDER BY id),'')||(s-'revision'-'mode'-'offset'-'limit')::text||p_as_of::text) AS value FROM matches
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM matches),'rows',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'),
  'metrics',CASE WHEN m='metrics' THEN (SELECT coalesce(jsonb_object_agg(k,v),'{}') FROM metrics,jsonb_each(all_metrics) e(k,v) WHERE coalesce(s->'metrics','[]') ? k OR k='unknown_age' OR (k='never_seen' AND s->'metrics' ? 'not_seen_6m')) ELSE '{}'::jsonb END,
  'unknownAge',(SELECT count(*) FROM population WHERE birth_date IS NULL),'revision',(SELECT value FROM revision),'asOf',p_as_of,
  'conditions',all_filters,'appliedSpec',s,'complete',true,'offset',offst) INTO result;
 IF s ? 'revision' AND s->>'revision'<>result->>'revision' THEN RAISE EXCEPTION 'Result changed' USING ERRCODE='40001'; END IF;
 RETURN result;
END $$;
ALTER FUNCTION app.search_patients(text,timestamptz) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.search_patients(text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_patients(text,timestamptz) TO authenticated;


CREATE OR REPLACE FUNCTION app.query_alexa_records(p_domain text,p_spec text,p_as_of timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE s jsonb; pid uuid; lo timestamptz; hi timestamptz; offst integer; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(app.can_see_admin(),false) THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501'; END IF;
 IF p_domain NOT IN ('agenda','consultations','documents','finance') OR length(p_spec)>4000 OR p_as_of IS NULL THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END IF;
 s:=p_spec::jsonb; pid:=(s->>'patientId')::uuid;lo:=(s->>'from')::timestamptz;hi:=(s->>'to')::timestamptz;offst:=coalesce((s->>'offset')::integer,0);
 IF jsonb_typeof(s)<>'object' OR offst NOT BETWEEN 0 AND 10000 OR (lo IS NULL)<>(hi IS NULL) OR lo>=hi
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE NOT (k = ANY(CASE p_domain WHEN 'agenda' THEN ARRAY['patientId','from','to','statuses','offset'] WHEN 'consultations' THEN ARRAY['patientId','from','to','status','mode','offset','dateAxis'] WHEN 'finance' THEN ARRAY['patientId','from','to','state','mode','offset'] ELSE ARRAY['patientId','from','to','status','offset','kind','query','documentId','draftId'] END)))
 OR (p_domain='agenda' AND (lo IS NULL OR hi-lo>interval '366 days'))
 OR (p_domain='consultations' AND s ? 'dateAxis' AND coalesce(s->>'dateAxis','') NOT IN ('started_at','ended_at'))
 OR (p_domain='consultations' AND coalesce(s->>'status','all') NOT IN ('all','open','closed','unsigned'))
 OR (p_domain='finance' AND coalesce(s->>'state','all') NOT IN ('all','pending','collected'))
 OR (p_domain='documents' AND coalesce(s->>'status','issued') NOT IN ('issued','voided','draft'))
 OR (p_domain='consultations' AND s ? 'mode' AND s->>'mode' NOT IN ('count','list','group'))
 OR (p_domain='finance' AND s ? 'mode' AND s->>'mode' NOT IN ('list','totals','group'))
 OR (p_domain='documents' AND s ? 'draftId' AND (coalesce(s->>'status','issued')<>'draft' OR s ? 'documentId'))
 OR (p_domain='documents' AND s ? 'documentId' AND s->>'status'='draft')
 OR (p_domain='documents' AND s ? 'kind' AND s->>'kind' NOT IN ('bonne_sante_mentale','suivi_medical','certificat_medical','justification','ordonnance'))
 OR (s ? 'statuses' AND (jsonb_typeof(s->'statuses')<>'array' OR jsonb_array_length(s->'statuses')>7 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(s->'statuses') x WHERE x NOT IN ('requested','confirmed','arrived','in_session','completed','no_show','cancelled'))))
 THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END IF;
 IF p_domain<>'agenda' AND app.current_role() NOT IN ('owner','practitioner') THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501'; END IF;
 IF pid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.patients WHERE id=pid) THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501'; END IF;
 PERFORM audit.log_read(pid,CASE WHEN pid IS NULL THEN 'liste' ELSE 'fiche' END);
 WITH records AS MATERIALIZED (
  SELECT a.id,a.patient_id AS "patientId",coalesce(p.first_name||' '||p.last_name,'') AS label,a.starts_at AS at,a.status::text AS status,NULL::bigint AS amount,false AS unpriced
   FROM app.appointments a LEFT JOIN app.patients p ON p.id=a.patient_id
   WHERE p_domain='agenda' AND (pid IS NULL OR a.patient_id=pid) AND a.starts_at>=lo AND a.starts_at<hi
    AND (CASE WHEN s ? 'statuses' THEN s->'statuses' ? a.status::text ELSE a.status::text<>'cancelled' END)
  UNION ALL
  SELECT c.id,c.patient_id,coalesce(p.first_name||' '||p.last_name,''),CASE WHEN s->>'dateAxis'='ended_at' THEN c.ended_at ELSE c.started_at END,c.status::text,NULL::bigint,false
   FROM app.consultations c JOIN app.patients p ON p.id=c.patient_id
   WHERE p_domain='consultations' AND (pid IS NULL OR c.patient_id=pid) AND (lo IS NULL OR (CASE WHEN s->>'dateAxis'='ended_at' THEN c.ended_at ELSE c.started_at END)>=lo AND (CASE WHEN s->>'dateAxis'='ended_at' THEN c.ended_at ELSE c.started_at END)<hi)
    AND (coalesce(s->>'status','all')='all' OR c.status::text=s->>'status'
      OR (s->>'status'='unsigned' AND EXISTS(SELECT 1 FROM app.clinical_notes n WHERE n.consultation_id=c.id AND n.status='draft')))
  UNION ALL
  SELECT pay.id,pay.patient_id,coalesce(p.first_name||' '||p.last_name,''),CASE WHEN s->>'state'='collected' THEN pay.collected_at ELSE pay.created_at END,
   CASE WHEN pay.collected_at IS NULL THEN 'pending' ELSE 'collected' END,pay.amount_dzd::bigint,false
   FROM app.payments pay JOIN app.patients p ON p.id=pay.patient_id
   WHERE p_domain='finance' AND (pid IS NULL OR pay.patient_id=pid) AND (lo IS NULL OR (CASE WHEN s->>'state'='collected' THEN pay.collected_at ELSE pay.created_at END)>=lo AND (CASE WHEN s->>'state'='collected' THEN pay.collected_at ELSE pay.created_at END)<hi)
    AND (coalesce(s->>'state','all')='all' OR (s->>'state'='pending' AND pay.collected_at IS NULL) OR (s->>'state'='collected' AND pay.collected_at IS NOT NULL))
  UNION ALL
  SELECT c.id,c.patient_id,coalesce(p.first_name||' '||p.last_name,''),c.started_at,'unpriced',NULL::bigint,true
   FROM app.consultations c JOIN app.patients p ON p.id=c.patient_id
   WHERE p_domain='finance' AND (pid IS NULL OR c.patient_id=pid) AND (lo IS NULL OR c.started_at>=lo AND c.started_at<hi)
    AND NOT EXISTS(SELECT 1 FROM app.payments pay WHERE pay.consultation_id=c.id)
  UNION ALL
  SELECT d.id,d.patient_id,d.doc_type::text,d.issued_at,d.status::text,NULL::bigint,false
   FROM app.documents d WHERE p_domain='documents' AND coalesce(s->>'status','issued')<>'draft'
    AND d.status::text=coalesce(s->>'status','issued') AND (pid IS NULL OR d.patient_id=pid)
    AND (lo IS NULL OR d.issued_at>=lo AND d.issued_at<hi) AND (NOT s ? 'kind' OR d.doc_type::text=s->>'kind')
    AND (NOT s ? 'documentId' OR d.id=(s->>'documentId')::uuid)
    AND (nullif(s->>'query','') IS NULL OR position(lower(s->>'query') IN lower(d.doc_type::text))>0)
  UNION ALL
  SELECT d.id,d.patient_id,d.doc_type::text,d.updated_at,'draft',NULL::bigint,false
   FROM app.document_drafts d WHERE p_domain='documents' AND s->>'status'='draft' AND d.archived_at IS NULL AND d.issued_document_id IS NULL
    AND (pid IS NULL OR d.patient_id=pid) AND (lo IS NULL OR d.updated_at>=lo AND d.updated_at<hi)
    AND (NOT s ? 'kind' OR d.doc_type::text=s->>'kind') AND (NOT s ? 'draftId' OR d.id=(s->>'draftId')::uuid)
    AND (nullif(s->>'query','') IS NULL OR position(lower(s->>'query') IN lower(d.doc_type::text))>0)
 ), page AS (
  SELECT id,"patientId",label,at,status,amount FROM records WHERE NOT unpriced ORDER BY CASE WHEN p_domain='agenda' THEN at END ASC,CASE WHEN p_domain<>'agenda' THEN at END DESC,id LIMIT CASE WHEN s->>'mode' IN ('count','totals','group') THEN 0 ELSE 20 END OFFSET offst
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM records WHERE NOT unpriced),'rows',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'),
  'totals',CASE WHEN p_domain='finance' THEN (SELECT jsonb_build_object('pendingDzd',coalesce(sum(amount) FILTER(WHERE status='pending'),0),'collectedDzd',coalesce(sum(amount) FILTER(WHERE status='collected'),0),'unpriced',count(*) FILTER(WHERE unpriced)) FROM records)
   WHEN s->>'mode'='group' THEN (SELECT coalesce(jsonb_object_agg(status,n),'{}') FROM (SELECT status,count(*) n FROM records GROUP BY status) groups) ELSE '{}'::jsonb END,
  'complete',true,'offset',offst) INTO result;
 RETURN result;
END $$;
ALTER FUNCTION app.query_alexa_records(text,text,timestamptz) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.query_alexa_records(text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.query_alexa_records(text,text,timestamptz) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES('179_alexa_patient_query_contract') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
