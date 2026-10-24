-- Projection only: authorized patient labels, pinned template titles and issued numbers.
-- No new storage, predicates, permissions, pagination or audit behavior.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
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
  SELECT d.id,d.patient_id,concat_ws(' — ',nullif(p.first_name||' '||p.last_name,''),coalesce(t.title_fr,d.doc_type::text),d.doc_number),d.issued_at,d.status::text,NULL::bigint,false
   FROM app.documents d LEFT JOIN app.patients p ON p.id=d.patient_id LEFT JOIN app.document_templates t ON t.id=d.template_id AND t.version=d.template_version WHERE p_domain='documents' AND coalesce(s->>'status','issued')<>'draft'
    AND d.status::text=coalesce(s->>'status','issued') AND (pid IS NULL OR d.patient_id=pid)
    AND (lo IS NULL OR d.issued_at>=lo AND d.issued_at<hi) AND (NOT s ? 'kind' OR d.doc_type::text=s->>'kind')
    AND (NOT s ? 'documentId' OR d.id=(s->>'documentId')::uuid)
    AND (nullif(s->>'query','') IS NULL OR position(lower(s->>'query') IN lower(d.doc_type::text))>0)
  UNION ALL
  SELECT d.id,d.patient_id,concat_ws(' — ',nullif(p.first_name||' '||p.last_name,''),coalesce(t.title_fr,d.doc_type::text)),d.updated_at,'draft',NULL::bigint,false
   FROM app.document_drafts d LEFT JOIN app.patients p ON p.id=d.patient_id LEFT JOIN app.document_templates t ON t.id=d.template_id AND t.version=d.template_version WHERE p_domain='documents' AND s->>'status'='draft' AND d.archived_at IS NULL AND d.issued_document_id IS NULL
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
INSERT INTO app.schema_migrations(version) VALUES('183_alexa_document_display_labels') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
