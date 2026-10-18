-- Alexa-only read consistency: chronological agenda and exhausted available history.
-- Existing authentication, read audit, permissions, note coverage and source revisions remain intact.
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
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE NOT (k = ANY(CASE p_domain WHEN 'agenda' THEN ARRAY['patientId','from','to','statuses','offset'] WHEN 'consultations' THEN ARRAY['patientId','from','to','status','mode','offset'] WHEN 'finance' THEN ARRAY['patientId','from','to','state','mode','offset'] ELSE ARRAY['patientId','from','to','status','offset','kind','query','documentId','draftId'] END)))
 OR (p_domain='agenda' AND (lo IS NULL OR hi-lo>interval '366 days'))
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
  SELECT c.id,c.patient_id,coalesce(p.first_name||' '||p.last_name,''),c.started_at,c.status::text,NULL::bigint,false
   FROM app.consultations c JOIN app.patients p ON p.id=c.patient_id
   WHERE p_domain='consultations' AND (pid IS NULL OR c.patient_id=pid) AND (lo IS NULL OR c.started_at>=lo AND c.started_at<hi)
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

CREATE OR REPLACE FUNCTION app.get_alexa_clinical_context(
  p_patient_id uuid,
  p_limit integer DEFAULT 5,
  p_before_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_patient app.patients%ROWTYPE;
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 20);
  v_consultations jsonb;
  v_current jsonb;
  v_treatments jsonb;
  v_history jsonb;
  v_history_complete boolean;
  v_diagnoses jsonb;
  v_scales jsonb;
  v_revision text;
  v_more boolean;
  v_count integer;
  v_last jsonb;
BEGIN
  -- Same audited access door for missing and inaccessible patient references.
  SELECT * INTO v_patient FROM app.get_patient(p_patient_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Clinical RLS remains authoritative. In particular an assistant who can
  -- open demographic data must not receive a clinical dossier or its revision.
  IF NOT app.can_see_clinical(v_patient.practitioner_id) THEN RETURN NULL; END IF;
  IF (p_before_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'invalid-cursor' USING ERRCODE = '22023';
  END IF;

  -- Revision covers the entire visible record, independently of the cursor.
  -- No clock or generated response is hashed; identical facts stay identical.
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'patient', to_jsonb(v_patient),
    'consultations', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id), '[]'::jsonb)
      FROM app.consultations c WHERE c.patient_id = p_patient_id),
    'notes', (SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id), '[]'::jsonb)
      FROM app.clinical_notes n WHERE n.patient_id = p_patient_id),
    'amendments', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::jsonb)
      FROM app.clinical_note_amendments a JOIN app.clinical_notes n ON n.id = a.note_id
      WHERE n.patient_id = p_patient_id),
    'treatments', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
      FROM app.patient_treatments t WHERE t.patient_id = p_patient_id),
    'medications', (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb)
      FROM app.medications m WHERE EXISTS (SELECT 1 FROM app.patient_treatments t
        WHERE t.patient_id = p_patient_id AND t.medication_id = m.id)),
    'history', (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id), '[]'::jsonb)
      FROM app.patient_treatment_history h JOIN app.patient_treatments t ON t.id = h.treatment_id
      WHERE t.patient_id = p_patient_id),
    'analyses', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::jsonb)
      FROM app.consultation_analyses a WHERE a.patient_id = p_patient_id),
    'diagnoses', (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id), '[]'::jsonb)
      FROM app.diagnoses d WHERE d.patient_id = p_patient_id),
    'scales', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]'::jsonb)
      FROM app.scale_administrations s WHERE s.patient_id = p_patient_id)
  )::text, 'UTF8')), 'hex') INTO v_revision;

  WITH selected AS (
    SELECT c.id, c.started_at, c.ended_at, c.raw_notes
    FROM app.consultations c
    WHERE c.patient_id = p_patient_id AND c.status = 'closed'
      AND (p_before_at IS NULL OR (c.started_at, c.id) < (p_before_at, p_before_id))
    ORDER BY c.started_at DESC, c.id DESC LIMIT v_limit
  ), projected AS (
    SELECT c.id, c.started_at,
      jsonb_build_object('id', c.id, 'startedAt', c.started_at, 'endedAt', c.ended_at, 'rawNotes', c.raw_notes, 'rawNotesVersion', v_revision,
        'notes', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', n.id, 'version', n.updated_at::text, 'status', n.status,
          'subjective', n.subjective, 'objective', n.objective, 'assessment', n.assessment, 'plan', n.plan,
          'amendments', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'body', a.body,
            'reason', a.reason, 'createdAt', a.created_at) ORDER BY a.created_at, a.id)
            FROM app.clinical_note_amendments a WHERE a.note_id = n.id), '[]'::jsonb)
          ) ORDER BY n.created_at, n.id) FROM app.clinical_notes n
          WHERE n.consultation_id = c.id), '[]'::jsonb)
      ) || coalesce((SELECT jsonb_build_object('analysis', jsonb_build_object(
          'id', a.id, 'version', a.version, 'content', a.content))
        FROM app.consultation_analyses a WHERE a.consultation_id = c.id
          AND c.raw_notes IS NOT NULL
          AND a.source_state ->> 'notes_hash' = encode(sha256(convert_to(c.raw_notes, 'UTF8')), 'hex')
          AND a.generated_at >= coalesce((SELECT max(n.updated_at) FROM app.clinical_notes n
            WHERE n.consultation_id = c.id), '-infinity'::timestamptz)
          AND a.generated_at >= coalesce((SELECT max(am.created_at) FROM app.clinical_note_amendments am
            JOIN app.clinical_notes n ON n.id = am.note_id WHERE n.consultation_id = c.id), '-infinity'::timestamptz)
        ORDER BY a.version DESC LIMIT 1), '{}'::jsonb) AS value
    FROM selected c
  ) SELECT coalesce(jsonb_agg(value ORDER BY started_at DESC, id DESC), '[]'::jsonb)
    INTO v_consultations FROM projected;
  v_count := jsonb_array_length(v_consultations);
  v_last := v_consultations -> (v_count - 1);
  SELECT EXISTS (SELECT 1 FROM app.consultations c
    WHERE c.patient_id = p_patient_id AND c.status = 'closed' AND v_last IS NOT NULL
      AND (c.started_at, c.id) < ((v_last ->> 'startedAt')::timestamptz, (v_last ->> 'id')::uuid)) INTO v_more;

  -- Current open consultation is separate; recorded working/SOAP notes carry their unsigned status.
  SELECT jsonb_build_object('id', c.id, 'startedAt', c.started_at, 'endedAt', c.ended_at, 'rawNotes', c.raw_notes, 'rawNotesVersion', v_revision,
    'notes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'version', n.updated_at::text, 'status', n.status,
      'subjective', n.subjective, 'objective', n.objective, 'assessment', n.assessment, 'plan', n.plan,
      'amendments', coalesce((SELECT jsonb_agg(jsonb_build_object('id', am.id, 'body', am.body,
        'reason', am.reason, 'createdAt', am.created_at) ORDER BY am.created_at, am.id)
        FROM app.clinical_note_amendments am WHERE am.note_id = n.id), '[]'::jsonb)) ORDER BY n.created_at, n.id)
      FROM app.clinical_notes n WHERE n.consultation_id = c.id), '[]'::jsonb))
    INTO v_current FROM app.consultations c WHERE c.patient_id = p_patient_id AND c.status = 'open'
    ORDER BY c.started_at DESC, c.id DESC LIMIT 1;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'medication', coalesce(nullif(m.source_raw_value, ''), m.brand_name, m.inn),
    'status', t.status, 'dose', t.dose, 'doseUnit', t.dose_unit, 'frequency', t.frequency,
    'timing', t.timing, 'instructions', t.instructions, 'startDate', t.start_date, 'endDate', t.end_date,
    'version', t.current_version) ORDER BY t.start_date DESC, t.id DESC), '[]'::jsonb)
    INTO v_treatments FROM app.patient_treatments t JOIN app.medications m ON m.id = t.medication_id
    WHERE t.patient_id = p_patient_id;

  -- The newest 200 changes are sufficient for the normal read. Truncation is
  -- explicit; a caller must never claim complete treatment evolution here.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'treatmentId', h.treatment_id,
    'version', h.version, 'action', h.action, 'occurredAt', h.occurred_at,
    'previous', CASE WHEN h.previous_values IS NULL THEN NULL ELSE jsonb_build_object(
      'status', h.previous_values -> 'status', 'dose', h.previous_values -> 'dose',
      'doseUnit', h.previous_values -> 'dose_unit', 'frequency', h.previous_values -> 'frequency',
      'timing', coalesce(h.previous_values -> 'timing', '[]'::jsonb), 'instructions', h.previous_values -> 'instructions',
      'startDate', h.previous_values -> 'start_date', 'endDate', h.previous_values -> 'end_date') END,
    'next', CASE WHEN h.new_values IS NULL THEN NULL ELSE jsonb_build_object(
      'status', h.new_values -> 'status', 'dose', h.new_values -> 'dose',
      'doseUnit', h.new_values -> 'dose_unit', 'frequency', h.new_values -> 'frequency',
      'timing', coalesce(h.new_values -> 'timing', '[]'::jsonb), 'instructions', h.new_values -> 'instructions',
      'startDate', h.new_values -> 'start_date', 'endDate', h.new_values -> 'end_date') END,
    'reason', h.reason, 'notes', h.notes) ORDER BY h.occurred_at DESC, h.id DESC), '[]'::jsonb)
    INTO v_history FROM (SELECT h.* FROM app.patient_treatment_history h
      JOIN app.patient_treatments t ON t.id = h.treatment_id WHERE t.patient_id = p_patient_id
      ORDER BY h.occurred_at DESC, h.id DESC LIMIT 200) h;
  SELECT count(*) <= 200 INTO v_history_complete FROM app.patient_treatment_history h
    JOIN app.patient_treatments t ON t.id = h.treatment_id WHERE t.patient_id = p_patient_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'code', d.code,
    'primary', d.is_primary, 'onsetDate', d.onset_date, 'resolvedAt', d.resolved_at)
    ORDER BY (d.resolved_at IS NOT NULL), d.is_primary DESC, d.id), '[]'::jsonb)
    INTO v_diagnoses FROM app.diagnoses d WHERE d.patient_id = p_patient_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', sc.name_fr,
    'administeredAt', s.administered_at, 'score', s.total_score, 'interpretation', s.interpretation)
    ORDER BY s.administered_at DESC, s.id DESC), '[]'::jsonb)
    INTO v_scales FROM app.scale_administrations s JOIN app.scales sc ON sc.id = s.scale_id
    WHERE s.patient_id = p_patient_id;

  RETURN jsonb_build_object('patientId', p_patient_id, 'consultations', v_consultations,
    'treatments', jsonb_build_object('current', v_treatments, 'history', v_history, 'historyComplete', v_history_complete),
    'diagnoses', v_diagnoses, 'scales', v_scales, 'sourceRevision', v_revision,
    'coverage', jsonb_build_object('requested', v_limit, 'returned', v_count,
      'complete', (v_count = v_limit OR NOT v_more) AND v_history_complete AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_consultations) x WHERE jsonb_array_length(x -> 'notes') = 0 AND nullif(btrim(x ->> 'rawNotes'), '') IS NULL),
      'hasMore', v_more) || CASE WHEN v_more THEN jsonb_build_object('next',
        jsonb_build_object('startedAt', v_last -> 'startedAt', 'id', v_last -> 'id')) ELSE '{}'::jsonb END)
    || CASE WHEN v_current IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('currentConsultation', v_current) END;
END; $$;

ALTER FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_alexa_clinical_context(uuid, integer, timestamptz, uuid) TO authenticated;
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
INSERT INTO app.schema_migrations(version) VALUES('165_alexa_read_consistency') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
