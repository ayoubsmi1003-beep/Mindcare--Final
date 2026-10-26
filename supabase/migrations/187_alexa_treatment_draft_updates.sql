-- Extend the existing confirmed-action pipeline for versioned treatment and draft edits.
-- No table, column, enum, or issuance path is added; domain gates remain authoritative.
BEGIN;
ALTER TABLE app.jarvis_actions DROP CONSTRAINT IF EXISTS jarvis_tool_allowlist;
ALTER TABLE app.jarvis_actions ADD CONSTRAINT jarvis_tool_allowlist
  CHECK (tool_name IN (
    'create_appointment','reschedule_appointment','cancel_appointment','mark_patient_arrived',
    'set_consultation_price','record_payment_collected','close_consultation','create_document_draft',
    'create_editable_document_draft','update_editable_document_draft','update_treatment','stop_treatment',
    'send_internal_message'
  ));
CREATE OR REPLACE FUNCTION app.propose_jarvis_action(
  p_conversation_id uuid,
  p_user_utterance text,
  p_tool_name text,
  p_tool_args jsonb,
  p_action_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  a app.jarvis_actions%ROWTYPE;
BEGIN
  IF p_action_id IS NULL OR p_tool_name NOT IN (
    'create_appointment','reschedule_appointment','cancel_appointment',
    'mark_patient_arrived','set_consultation_price','record_payment_collected',
    'close_consultation','create_document_draft','create_editable_document_draft','update_editable_document_draft','update_treatment','stop_treatment','send_internal_message'
  ) OR length(p_user_utterance) NOT BETWEEN 1 AND 4000 OR jsonb_typeof(p_tool_args) <> 'object' THEN
    RAISE EXCEPTION 'Invalid proposal' USING ERRCODE = '22023';
  END IF;
  IF app.alexa_owns_conversation(p_conversation_id) IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  INSERT INTO app.jarvis_actions(
    id, cabinet_id, actor_id, conversation_id, user_utterance,
    tool_name, tool_args, expires_at
  )
  VALUES(
    p_action_id, app.current_cabinet(), auth.uid(), p_conversation_id,
    p_user_utterance, p_tool_name, p_tool_args, now() + interval '15 minutes'
  )
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO a FROM app.jarvis_actions WHERE id = p_action_id;
  IF a.actor_id IS DISTINCT FROM auth.uid()
     OR a.conversation_id IS DISTINCT FROM p_conversation_id
     OR a.tool_name IS DISTINCT FROM p_tool_name
     OR a.tool_args IS DISTINCT FROM p_tool_args THEN
    RAISE EXCEPTION 'Proposal conflict' USING ERRCODE = '22023';
  END IF;
  RETURN a.id;
END $$;

ALTER FUNCTION app.propose_jarvis_action(uuid, text, text, jsonb, uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.propose_jarvis_action(uuid, text, text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.propose_jarvis_action(uuid, text, text, jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.propose_jarvis_action(
  p_conversation_id uuid,
  p_user_utterance text,
  p_tool_name text,
  p_tool_args text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_args jsonb;
  v_id uuid;
BEGIN
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Conversation absente : une proposition appartient à un échange.';
  END IF;
  IF nullif(btrim(coalesce(p_user_utterance, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Demande vide : une proposition cite toujours ce qui l''a déclenchée.';
  END IF;
  BEGIN
    v_args := p_tool_args::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Arguments illisibles : le contenu attendu est un objet JSON.';
  END;
  IF jsonb_typeof(v_args) <> 'object' THEN
    RAISE EXCEPTION 'Arguments illisibles : le contenu attendu est un objet JSON.';
  END IF;
  IF p_tool_name IS NULL OR p_tool_name NOT IN (
    'create_appointment','reschedule_appointment','cancel_appointment',
    'mark_patient_arrived','set_consultation_price','record_payment_collected',
    'close_consultation','create_document_draft','create_editable_document_draft','update_editable_document_draft','update_treatment','stop_treatment','send_internal_message'
  ) THEN
    RAISE EXCEPTION 'Outil inconnu : Jarvis ne dispose d''aucune action de ce nom.';
  END IF;
  INSERT INTO app.jarvis_actions(
    cabinet_id, actor_id, conversation_id, user_utterance,
    tool_name, tool_args, state, expires_at
  )
  VALUES(
    app.current_cabinet(), auth.uid(), p_conversation_id,
    p_user_utterance, p_tool_name, v_args, 'proposed',
    now() + interval '15 minutes'
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

ALTER FUNCTION app.propose_jarvis_action(uuid, text, text, text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.propose_jarvis_action(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.propose_jarvis_action(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION app.execute_jarvis_action(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_state app.jarvis_state;
  v_conf timestamptz;
  v_expires timestamptz;
  v_tool text;
  v_args jsonb;
  v_affected uuid;
  v_table text;
  v_result jsonb;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT state, confirmed_at, expires_at, tool_name, tool_args
    INTO v_state, v_conf, v_expires, v_tool, v_args
    FROM app.jarvis_actions
   WHERE id = p_id
     FOR UPDATE;
  IF v_state IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_state = 'executed' THEN
    RETURN (SELECT affected_id FROM app.jarvis_actions WHERE id = p_id);
  END IF;
  IF v_state = 'failed' THEN
    RETURN NULL;
  END IF;
  IF v_state <> 'confirmed' OR v_conf IS NULL THEN
    RAISE EXCEPTION 'Action non confirmée : rien ne s''exécute sans confirmation.';
  END IF;
  IF v_expires IS NOT NULL AND now() > v_expires THEN
    RAISE EXCEPTION 'Cette proposition a expiré. Demandez une nouvelle proposition.';
  END IF;

  BEGIN
    CASE v_tool
      WHEN 'create_appointment' THEN
        v_table := 'appointments';
        v_affected := app.create_appointment(
          (v_args ->> 'patient_id')::uuid,
          (v_args ->> 'practitioner_id')::uuid,
          (v_args ->> 'starts_at')::timestamptz,
          (v_args ->> 'duration_minutes')::integer,
          v_args ->> 'notes_admin',
          (v_args ->> 'kind')::app.consult_kind
        );

      WHEN 'set_consultation_price' THEN
        v_table := 'payments';
        v_affected := app.set_consultation_price(
          (v_args ->> 'consultation_id')::uuid,
          (v_args ->> 'amount_dzd')::integer
        );

      -- 182 · le service envoie nouveau_debut / nouvelle_duree_minutes ;
      -- 161 attendait un objet `changes` que personne ne construisait.
      WHEN 'reschedule_appointment' THEN
        v_table := 'appointments';
        v_affected := app.update_appointment(
          (v_args ->> 'appointment_id')::uuid,
          jsonb_strip_nulls(jsonb_build_object(
            'starts_at', v_args ->> 'nouveau_debut',
            'duration_minutes', CASE
              WHEN v_args ? 'nouvelle_duree_minutes'
              THEN (v_args ->> 'nouvelle_duree_minutes')::integer
              ELSE NULL
            END
          ))::text
        );

      WHEN 'cancel_appointment' THEN
        v_table := 'appointments';
        v_affected := app.cancel_appointment(
          (v_args ->> 'appointment_id')::uuid,
          v_args ->> 'motif'
        );

      WHEN 'mark_patient_arrived' THEN
        v_table := 'appointments';
        v_affected := app.mark_appointment_arrived(
          (v_args ->> 'appointment_id')::uuid
        );

      WHEN 'record_payment_collected' THEN
        v_table := 'payments';
        v_affected := app.record_payment_collected(
          (v_args ->> 'payment_id')::uuid
        );

      WHEN 'close_consultation' THEN
        v_table := 'consultations';
        v_affected := app.close_consultation(
          (v_args ->> 'consultation_id')::uuid
        );

      -- 182 · le brouillon peut être créé avec un contenu auto-rempli. La
      -- création et l'application du contenu restent une seule transaction.
      WHEN 'create_editable_document_draft' THEN
        v_table := 'document_drafts';
        IF v_args->>'document_type' NOT IN (
          'bonne_sante_mentale','suivi_medical','certificat_medical','justification','ordonnance'
        ) THEN
          RAISE EXCEPTION 'Invalid draft kind';
        END IF;
        v_affected := (
          app.create_alexa_document_draft(
            (v_args->>'patient_id')::uuid,
            (v_args->>'document_type')::app.doc_type,
            coalesce(v_args->>'variables','{}'),
            v_args->>'content'
          )->>'id'
        )::uuid;

      WHEN 'create_document_draft' THEN
        v_table := 'consultations';
        SELECT c.id INTO v_affected
          FROM app.consultations c
         WHERE c.id = (v_args ->> 'consultation_id')::uuid;

      -- 182 · message interne uniquement. Le texte ne porte ni patient, ni
      -- donnée clinique : le canal 178 est explicitement opérationnel.
      WHEN 'send_internal_message' THEN
        v_table := 'internal_messages';
        SELECT m.id INTO v_affected
          FROM app.send_internal_message(
            (v_args->>'client_msg_id')::uuid,
            v_args->>'body'
          ) AS m;

      WHEN 'update_treatment' THEN
        v_table := 'patient_treatments';
        IF v_args->>'expected_version' IS NULL THEN RAISE EXCEPTION 'Treatment version required' USING ERRCODE='22023'; END IF;
        SELECT updated.id INTO v_affected
          FROM app.update_treatment(
            (v_args->>'treatment_id')::uuid,
            (v_args->>'expected_version')::integer,
            v_args->>'changes',
            (v_args->>'consultation_id')::uuid
          ) AS updated
         LIMIT 1;

      WHEN 'stop_treatment' THEN
        v_table := 'patient_treatments';
        IF v_args->>'expected_version' IS NULL THEN RAISE EXCEPTION 'Treatment version required' USING ERRCODE='22023'; END IF;
        SELECT updated.id INTO v_affected
          FROM app.stop_treatment(
            (v_args->>'treatment_id')::uuid,
            (v_args->>'expected_version')::integer,
            v_args->>'reason',
            (v_args->>'consultation_id')::uuid,
            v_args->>'notes'
          ) AS updated
         LIMIT 1;

      WHEN 'update_editable_document_draft' THEN
        v_table := 'document_drafts';
        IF v_args->>'expected_revision' IS NULL OR v_args->>'document_date' IS NULL THEN
          RAISE EXCEPTION 'Draft revision and date required' USING ERRCODE='22023';
        END IF;
        v_result := app.get_editable_document_draft((v_args->>'draft_id')::uuid);
        IF v_result IS NULL
           OR v_result->>'patientId' IS DISTINCT FROM v_args->>'patient_id'
           OR v_result->>'kind' IS DISTINCT FROM v_args->>'document_type' THEN
          RAISE EXCEPTION 'Draft target changed' USING ERRCODE='42501';
        END IF;
        v_result := app.save_editable_document_draft(
          (v_args->>'draft_id')::uuid,
          (v_args->>'expected_revision')::integer,
          v_args->>'content',
          v_args->>'variables',
          (v_args->>'document_date')::date
        );
        IF v_result IS NULL THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='42501'; END IF;
        IF v_result ? 'reason' THEN RAISE EXCEPTION 'Draft revision conflict' USING ERRCODE='40001'; END IF;
        v_affected := (v_result->>'id')::uuid;
      ELSE
        RAISE EXCEPTION 'Outil inconnu : Jarvis ne dispose d''aucune action de ce nom.';
    END CASE;

    IF v_affected IS NULL THEN
      RAISE EXCEPTION 'Action sans effet : la cible est introuvable ou hors de votre périmètre.';
    END IF;

    UPDATE app.jarvis_actions
       SET state = 'executed',
           executed_at = now(),
           affected_table = v_table,
           affected_id = v_affected,
           result = jsonb_build_object('id', v_affected)
     WHERE id = p_id;
    RETURN v_affected;
  EXCEPTION WHEN others THEN
    UPDATE app.jarvis_actions
       SET state = 'failed',
           executed_at = now(),
           error = SQLSTATE
     WHERE id = p_id;
    RETURN NULL;
  END;
END $$;

ALTER FUNCTION app.execute_jarvis_action(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.execute_jarvis_action(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.execute_jarvis_action(uuid) TO authenticated;
INSERT INTO app.schema_migrations(version)
VALUES ('187_alexa_treatment_draft_updates')
ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
