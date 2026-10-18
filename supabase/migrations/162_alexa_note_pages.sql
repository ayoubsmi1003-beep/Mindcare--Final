-- Full source text remains behind the existing doctor/RLS/read-audit boundary.
-- Only a bounded page is returned. No storage or clinical write behavior changes.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE OR REPLACE FUNCTION app.query_alexa_note_sections(p_spec text,p_as_of timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=app,audit,pg_catalog AS $$
DECLARE s jsonb; p app.patients%ROWTYPE; lim integer; offst integer; txt integer; cap integer; result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501'; END IF;
 IF p_spec IS NULL OR length(p_spec)>3000 OR p_as_of IS NULL THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END IF;
 s:=p_spec::jsonb;
 IF jsonb_typeof(s)<>'object' OR NOT s ? 'patientId'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE k NOT IN ('patientId','consultationId','area','query','from','to','status','offset','textOffset','maxCharacters','revision'))
 OR coalesce(s->>'area','all') NOT IN ('all','working','subjective','objective','assessment','plan','amendment','structured')
 OR coalesce(s->>'status','all') NOT IN ('all','open','closed') OR length(coalesce(s->>'query',''))>160
 OR (s ? 'from')<>(s ? 'to')
 THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END IF;
 BEGIN
  offst:=coalesce((s->>'offset')::integer,0);txt:=coalesce((s->>'textOffset')::integer,0);cap:=coalesce((s->>'maxCharacters')::integer,1200);
  IF s ? 'from' AND (s->>'from')::timestamptz >= (s->>'to')::timestamptz THEN RAISE EXCEPTION 'Invalid period'; END IF;
  SELECT * INTO p FROM app.get_patient((s->>'patientId')::uuid);
 EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END;
 IF offst NOT BETWEEN 0 AND 10000 OR txt NOT BETWEEN 0 AND 10000000 OR cap NOT BETWEEN 100 AND 1200
 THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023'; END IF;
 IF p.id IS NULL OR NOT coalesce(app.can_see_clinical(p.practitioner_id),false) THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501'; END IF;
 IF s ? 'consultationId' AND NOT EXISTS(SELECT 1 FROM app.consultations c WHERE c.id=(s->>'consultationId')::uuid AND c.patient_id=p.id)
 THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501'; END IF;
 WITH consultations AS MATERIALIZED (
  SELECT c.* FROM app.consultations c WHERE c.patient_id=p.id AND c.started_at<=p_as_of
   AND (NOT s ? 'consultationId' OR c.id=(s->>'consultationId')::uuid)
   AND (coalesce(s->>'status','all')='all' OR c.status::text=s->>'status')
   AND (NOT s ? 'from' OR (c.started_at>=(s->>'from')::timestamptz AND c.started_at<(s->>'to')::timestamptz))
 ), fields AS MATERIALIZED (
  SELECT c.id consultation_id,c.started_at,c.status::text consultation_status,c.id source_id,'working'::text area,0 priority,
   'working'::text status,md5(coalesce(c.raw_notes,'')) version,NULL::timestamptz signed_at,false ai_draft,NULL::text reason,c.raw_notes body
  FROM consultations c
  UNION ALL
  SELECT c.id,c.started_at,c.status::text,coalesce(n.id,c.id),v.area,v.priority,coalesce(n.status::text,'missing'),
   coalesce(n.updated_at::text,'missing'),n.signed_at,coalesce(n.ai_draft,false),NULL::text,v.body
  FROM consultations c LEFT JOIN app.clinical_notes n ON n.consultation_id=c.id
  CROSS JOIN LATERAL (VALUES('subjective',1,n.subjective),('objective',2,n.objective),('assessment',3,n.assessment),('plan',4,n.plan)) v(area,priority,body)
  UNION ALL
  SELECT c.id,c.started_at,c.status::text,a.id,'amendment',5,'amendment',a.created_at::text,NULL::timestamptz,false,a.reason,a.body
  FROM consultations c JOIN app.clinical_notes n ON n.consultation_id=c.id JOIN app.clinical_note_amendments a ON a.note_id=n.id
  UNION ALL
  SELECT c.id,c.started_at,c.status::text,n.id,'structured',6,n.status::text,n.updated_at::text,n.signed_at,n.ai_draft,NULL::text,n.structured::text
  FROM consultations c JOIN app.clinical_notes n ON n.consultation_id=c.id
  WHERE s->>'area'='structured'
 ), selected AS MATERIALIZED (
  SELECT *,row_number() OVER(ORDER BY started_at DESC,consultation_id DESC,priority,source_id)-1 idx
  FROM fields WHERE (coalesce(s->>'area','all')='all' OR area=s->>'area')
   AND (nullif(btrim(s->>'query'),'') IS NULL OR position(app.nom_recherche(s->>'query') IN app.nom_recherche(coalesce(body,'')))>0)
 ), candidates AS MATERIALIZED (
  SELECT *,CASE WHEN idx=offst THEN txt ELSE 0 END start_char FROM selected WHERE idx>=offst AND idx<offst+5
 ), page AS MATERIALIZED (
  -- Stop at the first unfinished field, so its remaining characters cannot be skipped.
  SELECT * FROM candidates WHERE idx<=coalesce((SELECT min(idx) FROM candidates WHERE length(coalesce(body,''))-start_char>cap),offst+4)
 ), last_row AS (SELECT * FROM page ORDER BY idx DESC LIMIT 1),
 revision AS (
  SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY idx)::text,'[]')||(s-'offset'-'textOffset'-'maxCharacters'-'revision')::text||p_as_of::text) value FROM selected x
 )
 SELECT jsonb_build_object('patientId',p.id,'total',(SELECT count(*) FROM selected),'revision',(SELECT value FROM revision),
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('consultationId',consultation_id,'startedAt',started_at,'consultationStatus',consultation_status,
    'sourceId',source_id,'area',area,'status',status,'version',version,'signedAt',signed_at,'aiDraft',ai_draft,'reason',reason,
    'text',substring(coalesce(body,'') FROM start_char+1 FOR cap),'textLength',length(coalesce(body,'')),'textOffset',start_char) ORDER BY idx) FROM page),'[]'),
  'complete',NOT EXISTS(SELECT 1 FROM last_row WHERE length(coalesce(body,''))>start_char+cap OR idx<(SELECT count(*)-1 FROM selected)),
  'cursorValid',offst<=(SELECT count(*) FROM selected) AND (txt=0 OR EXISTS(SELECT 1 FROM selected WHERE idx=offst AND txt<length(coalesce(body,'')))))
  ||coalesce((SELECT CASE WHEN length(coalesce(body,''))>start_char+cap THEN jsonb_build_object('next',jsonb_build_object('offset',idx,'textOffset',start_char+cap))
    WHEN idx<(SELECT count(*)-1 FROM selected) THEN jsonb_build_object('next',jsonb_build_object('offset',idx+1,'textOffset',0)) ELSE '{}'::jsonb END FROM last_row),'{}') INTO result;
 IF NOT (result->>'cursorValid')::boolean THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023'; END IF;
 IF s ? 'revision' AND s->>'revision'<>result->>'revision' THEN RAISE EXCEPTION 'Results changed' USING ERRCODE='40001'; END IF;
 RETURN result-'cursorValid';
END; $$;
ALTER FUNCTION app.query_alexa_note_sections(text,timestamptz) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.query_alexa_note_sections(text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.query_alexa_note_sections(text,timestamptz) TO authenticated;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
NOTIFY pgrst,'reload schema';
INSERT INTO app.schema_migrations(version) VALUES('162_alexa_note_pages') ON CONFLICT DO NOTHING;
COMMIT;
