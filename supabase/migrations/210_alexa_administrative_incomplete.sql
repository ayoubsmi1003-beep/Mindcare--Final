-- Administrative incompleteness counts identity, phone and birth-date gaps.
-- Sex remains visible in the per-row missing list but does not mark almost
-- every synthetic record incomplete on its own.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE OR REPLACE FUNCTION app.search_patients(p_spec text, p_as_of timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'audit', 'pg_catalog'
AS $function$
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
    WHEN f->>'field'='administrative_incomplete' THEN (b.missing && ARRAY['phone','identity_card','birth_date'])
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
END $function$;

ALTER FUNCTION app.search_patients(text,timestamptz) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.search_patients(text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_patients(text,timestamptz) TO authenticated;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES('210_alexa_administrative_incomplete') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;

