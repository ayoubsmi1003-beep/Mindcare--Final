-- Keep audited patient doors, exact populations, RLS and page snapshots unchanged.
-- Empty text follows ECMAScript trim whitespace; invalid nonblank identifiers stay present.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE OR REPLACE FUNCTION app.alexa_missing_text(p_text text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT coalesce(btrim(p_text,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='',true)
$$;
ALTER FUNCTION app.alexa_missing_text(text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.alexa_missing_text(text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION app.search_patients(p_spec text, p_as_of timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE s jsonb; cond jsonb; n numeric; m text; lim integer; offst integer;
 clinical boolean; financial boolean; result jsonb; anchor date;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(app.can_see_admin(),false) THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501'; END IF;
 IF length(p_spec)>8000 OR p_as_of IS NULL THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END IF;
 s:=p_spec::jsonb; m:=coalesce(s->>'mode','count');
 IF jsonb_typeof(s)<>'object' OR m NOT IN ('count','list','metrics','review')
 OR coalesce(s->>'population','active') NOT IN ('active','archived','all')
 OR coalesce(s->>'sort','name') NOT IN ('name','outstanding_desc')
 OR length(coalesce(s->>'query',''))>160
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE k NOT IN ('mode','population','sort','query','filters','metrics','patientIds','limit','offset','revision'))
 THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END IF;
 lim:=coalesce((s->>'limit')::integer,20); offst:=coalesce((s->>'offset')::integer,0);
 IF lim NOT BETWEEN 1 AND 20 OR offst NOT BETWEEN 0 AND 10000
 OR jsonb_typeof(coalesce(s->'filters','[]'))<>'array' OR jsonb_array_length(coalesce(s->'filters','[]'))>12
 OR jsonb_typeof(coalesce(s->'patientIds','[]'))<>'array' OR jsonb_array_length(coalesce(s->'patientIds','[]'))>100
 OR jsonb_typeof(coalesce(s->'metrics','[]'))<>'array' OR jsonb_array_length(coalesce(s->'metrics','[]'))>7
 OR (m='metrics' AND jsonb_array_length(coalesce(s->'metrics','[]'))=0)
 OR (m<>'metrics' AND s ? 'metrics')
 THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END IF;
 FOR cond IN SELECT value FROM jsonb_array_elements(coalesce(s->'filters','[]')) LOOP
  IF jsonb_typeof(cond)<>'object' OR NOT (cond ?& ARRAY['field','op','value']) OR (SELECT count(*) FROM jsonb_object_keys(cond))<>3 THEN RAISE EXCEPTION 'Invalid condition' USING ERRCODE='22023'; END IF;
  IF cond->>'field' IN ('phone','identity_card','birth_date','sex') THEN
   IF cond->>'op'<>'missing' OR cond->'value'<>'null'::jsonb THEN RAISE EXCEPTION 'Invalid condition' USING ERRCODE='22023'; END IF;
  ELSIF cond->>'field'='administrative_incomplete' THEN
   IF cond->>'op'<>'eq' OR cond->'value'<>'true'::jsonb THEN RAISE EXCEPTION 'Invalid condition' USING ERRCODE='22023'; END IF;
  ELSIF cond->>'field' IN ('age','completed_consultations','outstanding_balance','no_completed_days','no_completed_months') THEN
   IF jsonb_typeof(cond->'value')<>'number' OR cond->>'op' NOT IN ('eq','gt','gte','lt') THEN RAISE EXCEPTION 'Invalid condition' USING ERRCODE='22023'; END IF;
   n:=(cond->>'value')::numeric;
   IF n<>trunc(n) OR n<0 OR n>1000000 OR (cond->>'field'='age' AND n>120)
    OR (cond->>'field' IN ('no_completed_days','no_completed_months') AND (cond->>'op'<>'eq' OR n<1 OR n>CASE WHEN cond->>'field'='no_completed_days' THEN 3650 ELSE 120 END))
   THEN RAISE EXCEPTION 'Invalid condition' USING ERRCODE='22023'; END IF;
  ELSE RAISE EXCEPTION 'Unsupported condition' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(s->'metrics','[]')) x WHERE x NOT IN ('active','missing_identity_card','missing_phone','children','unknown_age','not_seen_6m','never_seen')) THEN RAISE EXCEPTION 'Unsupported metric' USING ERRCODE='22023'; END IF;
 clinical:=EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(s->'filters','[]')) x WHERE x->>'field' IN ('completed_consultations','outstanding_balance','no_completed_days','no_completed_months'))
  OR coalesce(s->'metrics','[]') ?| ARRAY['not_seen_6m','never_seen'];
 financial:=EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(s->'filters','[]')) x WHERE x->>'field'='outstanding_balance') OR coalesce(s->>'sort'='outstanding_desc',false);
 -- An assistant's restricted clinical/payment visibility must never be interpreted as zero attendance/debt.
 IF (clinical OR financial) AND app.current_role() NOT IN ('owner','practitioner') THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501'; END IF;
 -- Whole-history absence/balance predicates cannot be proved from a practitioner's
 -- RLS subset: another practitioner may have treated the same patient. Fail closed.
 IF (clinical OR financial) AND app.current_role()<>'owner' THEN RAISE EXCEPTION 'Complete domain visibility required' USING ERRCODE='42501'; END IF;
 anchor:=(p_as_of AT TIME ZONE 'Africa/Algiers')::date;
 PERFORM audit.log_read(NULL,'recherche');
 WITH population AS MATERIALIZED (
  SELECT p.*,extract(year FROM age(anchor,p.birth_date))::integer AS age_years
  FROM app.patients p
  WHERE (CASE coalesce(s->>'population','active') WHEN 'active' THEN p.is_active WHEN 'archived' THEN NOT p.is_active ELSE true END)
   AND (NOT (clinical OR financial) OR app.can_see_clinical(p.practitioner_id))
   AND (nullif(btrim(s->>'query'),'') IS NULL OR position(app.nom_recherche(s->>'query') IN app.nom_recherche(p.first_name||' '||p.last_name))>0 OR app.nom_recherche(s->>'query')=app.nom_recherche(p.record_number))
   AND (NOT s ? 'patientIds' OR p.id IN (SELECT value::uuid FROM jsonb_array_elements_text(s->'patientIds')))
 ), visits AS MATERIALIZED (
  SELECT c.patient_id,count(*) AS completed,max(c.started_at) AS last_completed
  FROM app.consultations c JOIN population p ON p.id=c.patient_id
  WHERE clinical AND c.status='closed' AND c.ended_at IS NOT NULL AND c.started_at<=p_as_of GROUP BY c.patient_id
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
  SELECT b.* FROM base b WHERE NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements(coalesce(s->'filters','[]')) f WHERE NOT coalesce(CASE
    WHEN f->>'field'='phone' THEN app.alexa_missing_text(b.phone)
    WHEN f->>'field'='identity_card' THEN app.alexa_missing_text(b.id_document_number)
    WHEN f->>'field'='birth_date' THEN b.birth_date IS NULL
    WHEN f->>'field'='sex' THEN b.sex IS NULL
    WHEN f->>'field'='administrative_incomplete' THEN cardinality(b.missing)>0
    WHEN f->>'field'='no_completed_days' THEN b.last_completed IS NULL OR b.last_completed < p_as_of - make_interval(days=>(f->>'value')::integer)
    WHEN f->>'field'='no_completed_months' THEN b.last_completed IS NULL OR b.last_completed < (p_as_of AT TIME ZONE 'Africa/Algiers' - make_interval(months=>(f->>'value')::integer)) AT TIME ZONE 'Africa/Algiers'
    ELSE CASE f->>'op'
     WHEN 'gte' THEN (CASE f->>'field' WHEN 'age' THEN b.age_years WHEN 'completed_consultations' THEN b.completed WHEN 'outstanding_balance' THEN b.balance END)>=(f->>'value')::numeric
     WHEN 'gt' THEN (CASE f->>'field' WHEN 'age' THEN b.age_years WHEN 'completed_consultations' THEN b.completed WHEN 'outstanding_balance' THEN b.balance END)>(f->>'value')::numeric
     WHEN 'lt' THEN (CASE f->>'field' WHEN 'age' THEN b.age_years WHEN 'completed_consultations' THEN b.completed WHEN 'outstanding_balance' THEN b.balance END)<(f->>'value')::numeric
     WHEN 'eq' THEN (CASE f->>'field' WHEN 'age' THEN b.age_years WHEN 'completed_consultations' THEN b.completed WHEN 'outstanding_balance' THEN b.balance END)=(f->>'value')::numeric END END,false)
  )
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
  'conditions',coalesce(s->'filters','[]'),'complete',true,'offset',offst) INTO result;
 IF s ? 'revision' AND s->>'revision'<>result->>'revision' THEN RAISE EXCEPTION 'Result changed' USING ERRCODE='40001'; END IF;
 RETURN result;
END $$;
ALTER FUNCTION app.search_patients(text,timestamptz) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.search_patients(text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_patients(text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION app.search_patients(p_query text, p_limit integer, p_offset integer, p_missing_field text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, audit, pg_catalog AS $$
DECLARE v_result jsonb; v_limit integer := least(greatest(coalesce(p_limit,20),0),20);
BEGIN
  IF p_missing_field IS NOT NULL AND p_missing_field NOT IN ('phone','identity_card') THEN
    RAISE EXCEPTION 'Recherche indisponible.' USING ERRCODE='22023';
  END IF;
  IF coalesce(p_offset,0) < 0 OR coalesce(p_offset,0) > 10000 OR length(coalesce(p_query,'')) > 160 THEN
    RAISE EXCEPTION 'Recherche indisponible.' USING ERRCODE='22023';
  END IF;
  PERFORM audit.log_read(NULL,'recherche');
  WITH visible AS MATERIALIZED (
    SELECT p.id,p.first_name,p.last_name FROM app.patients p
    WHERE p.is_active
      AND (nullif(btrim(p_query),'') IS NULL OR app.nom_recherche(p.first_name || ' ' || p.last_name)
        LIKE '%' || app.nom_recherche(p_query) || '%')
      AND (p_missing_field IS NULL
        OR (p_missing_field='phone' AND app.alexa_missing_text(p.phone))
        OR (p_missing_field='identity_card' AND app.alexa_missing_text(p.id_document_number)))
  ), page AS (
    SELECT id,first_name,last_name FROM visible ORDER BY last_name,first_name,id LIMIT v_limit OFFSET coalesce(p_offset,0)
  ) SELECT jsonb_build_object('total_count',(SELECT count(*) FROM visible),
    'patients',coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY last_name,first_name,id) FROM page),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END;
$$;
ALTER FUNCTION app.search_patients(text,integer,integer,text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.search_patients(text,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_patients(text,integer,integer,text) TO authenticated;
COMMENT ON FUNCTION app.search_patients(text,integer,integer,text) IS 'ADR-019: audited filtered page and atomic exact count; identities only on requested pages, never phone/ID values. Caller RLS remains authoritative.';

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES('164_alexa_missing_text') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
