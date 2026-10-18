-- Distinct confirmed editable instance; legacy request marker remains intact.
BEGIN;
ALTER TABLE app.jarvis_actions DROP CONSTRAINT IF EXISTS jarvis_tool_allowlist;
ALTER TABLE app.jarvis_actions ADD CONSTRAINT jarvis_tool_allowlist CHECK(tool_name IN ('create_appointment','set_consultation_price','reschedule_appointment','cancel_appointment','mark_patient_arrived','record_payment_collected','create_document_draft','create_editable_document_draft'));
CREATE OR REPLACE FUNCTION app.execute_jarvis_action(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_state    app.jarvis_state;
  v_conf     timestamptz;
  v_tool     text;
  v_args     jsonb;
  v_affected uuid;
  v_table    text;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT state, confirmed_at, tool_name, tool_args
    INTO v_state, v_conf, v_tool, v_args
    FROM app.jarvis_actions
   WHERE id = p_id
     FOR UPDATE;

  IF v_state IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_state = 'executed' THEN RETURN (SELECT affected_id FROM app.jarvis_actions WHERE id=p_id); END IF;
  IF v_state = 'failed' THEN RETURN NULL; END IF;
  IF v_state <> 'confirmed' OR v_conf IS NULL THEN
    RAISE EXCEPTION 'Action non confirmée : rien ne s''exécute sans confirmation.';
  END IF;

  BEGIN
    CASE v_tool

      -- ── Les deux de 033, RECOPIÉES À L'IDENTIQUE ──
      WHEN 'create_appointment' THEN
        v_table := 'appointments';
        v_affected := app.create_appointment(
          (v_args ->> 'patient_id')::uuid,
          (v_args ->> 'practitioner_id')::uuid,
          (v_args ->> 'starts_at')::timestamptz,
          (v_args ->> 'duration_minutes')::integer,
          v_args ->> 'notes_admin',
          (v_args ->> 'kind')::app.consult_kind);

      WHEN 'set_consultation_price' THEN
        v_table := 'payments';
        v_affected := app.set_consultation_price(
          (v_args ->> 'consultation_id')::uuid,
          (v_args ->> 'amount_dzd')::integer);

      -- ── Les cinq de 061 ──

      -- Le décalage passe par la porte de MODIFICATION, dont la liste blanche
      -- (024) exclut déjà `patient_id`, `practitioner_id`, `cabinet_id` et
      -- `status`. Jarvis ne peut donc pas réaffecter un rendez-vous à un autre
      -- patient en prétendant le décaler — et ce n'est pas ce fichier qui le
      -- garantit, c'est la porte qu'il appelle.
      WHEN 'reschedule_appointment' THEN
        v_table := 'appointments';
        v_affected := app.update_appointment(
          (v_args ->> 'appointment_id')::uuid,
          v_args ->> 'changes');

      WHEN 'cancel_appointment' THEN
        v_table := 'appointments';
        v_affected := app.cancel_appointment(
          (v_args ->> 'appointment_id')::uuid,
          v_args ->> 'motif');

      WHEN 'mark_patient_arrived' THEN
        v_table := 'appointments';
        v_affected := app.mark_appointment_arrived(
          (v_args ->> 'appointment_id')::uuid);

      WHEN 'record_payment_collected' THEN
        v_table := 'payments';
        v_affected := app.record_payment_collected(
          (v_args ->> 'payment_id')::uuid);

      -- ⚠️ LE BROUILLON DE DOCUMENT N'ÉMET RIEN. Il n'appelle PAS
      -- `app.issue_document` : émettre consomme un numéro de la table compteur
      -- (P7), et un numéro consommé ne se rend pas. Un brouillon refusé par la
      -- praticienne laisserait alors un TROU dans la numérotation — une
      -- anomalie comptable sur un document médical.
      --
      -- La ligne `jarvis_actions` est donc la SEULE trace : elle prouve que la
      -- praticienne a demandé et confirmé un brouillon, et l'émission réelle
      -- reste un geste séparé, fait à l'écran des documents, avec ses propres
      -- garde-fous. `affected_id` pointe la consultation, cible du brouillon.
      WHEN 'create_editable_document_draft' THEN
        v_table := 'document_drafts';
        IF v_args->>'document_type' NOT IN ('bonne_sante_mentale','suivi_medical','certificat_medical','justification') THEN RAISE EXCEPTION 'Invalid draft kind'; END IF;
        v_affected := (app.create_editable_document_draft((v_args->>'patient_id')::uuid,(v_args->>'document_type')::app.doc_type,coalesce(v_args->>'variables','{}'))->>'id')::uuid;
      WHEN 'create_document_draft' THEN
        v_table := 'consultations';
        SELECT c.id INTO v_affected
          FROM app.consultations c
         WHERE c.id = (v_args ->> 'consultation_id')::uuid;

      ELSE
        RAISE EXCEPTION 'Outil inconnu : Jarvis ne dispose d''aucune action de ce nom.';
    END CASE;

    -- ⚠️ UN RETOUR NULL N'EST PAS UN SUCCÈS SILENCIEUX. Plusieurs portes
    -- rendent NULL — pas une exception — quand la cible est introuvable OU
    -- masquée par la RLS : c'est leur façon de ne pas fabriquer d'oracle
    -- d'existence (ADR-003). Sans ce test, la ligne passerait à `executed` avec
    -- `affected_id` à NULL et la carte annoncerait une action faite sur une
    -- cible que la base a refusé de montrer.
    IF v_affected IS NULL THEN
      RAISE EXCEPTION 'Action sans effet : la cible est introuvable ou hors de votre périmètre.';
    END IF;

    UPDATE app.jarvis_actions
       SET state          = 'executed',
           executed_at    = now(),
           affected_table = v_table,
           affected_id    = v_affected,
           result         = jsonb_build_object('id', v_affected)
     WHERE id = p_id;

    RETURN v_affected;

  EXCEPTION WHEN others THEN
    UPDATE app.jarvis_actions
       SET state       = 'failed',
           executed_at = now(),
           error       = SQLSTATE
     WHERE id = p_id;

    RETURN NULL;
  END;
END;
$$;


REVOKE ALL ON FUNCTION app.execute_jarvis_action(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.execute_jarvis_action(uuid) TO authenticated;
INSERT INTO app.schema_migrations(version) VALUES('161_alexa_editable_draft_action') ON CONFLICT DO NOTHING;
COMMIT;
