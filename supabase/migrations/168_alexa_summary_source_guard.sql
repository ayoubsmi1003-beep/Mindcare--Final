-- Atomic freshness for a derived, explicitly requested session summary.
BEGIN;
GRANT CREATE ON SCHEMA app TO app_gatekeeper;
CREATE OR REPLACE FUNCTION app.save_session_analysis(
    p_consultation_id uuid,
    p_content         text,
    p_source_state    text,
    p_model           text,
    p_prompt_version  text,
    p_prompt_hash     text)
RETURNS SETOF app.consultation_analyses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_charge     jsonb;
  v_etat       jsonb;
  v_note       jsonb;
  v_patient    uuid;
  v_cabinet    uuid;
  v_proprio    uuid;
  v_version    integer;
  v_existante  app.consultation_analyses;
  v_champ      text;
  v_snapshot   jsonb;
  v_champs     constant text[] := ARRAY['subjective','objective','assessment','plan'];
BEGIN
  IF p_consultation_id IS NULL THEN
    RETURN;
  END IF;

  -- PÉRIMÈTRE ET VERROU. Le SELECT est filtré par la RLS sous l'appelant :
  -- zéro ligne = inexistant OU hors périmètre, indistinctement (ADR-003). La
  -- fonction ne teste aucun rôle elle-même (règle 4).
  -- `FOR UPDATE` sérialise les appels concurrents : deux clics sur « Analyser »
  -- ne peuvent pas calculer le même numéro de version en parallèle.
  SELECT c.patient_id, c.cabinet_id
    INTO v_patient, v_cabinet
    FROM app.consultations c
   WHERE c.id = p_consultation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT p.practitioner_id INTO v_proprio
    FROM app.patients p WHERE p.id = v_patient;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'Contenu d''analyse manquant.';
  END IF;
  BEGIN
    v_charge := p_content::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Contenu d''analyse invalide.';
  END;
  -- Forme sérialisée acceptée aussi (leçon 049 : le client a le droit d'envoyer
  -- une chaîne JSON dans une chaîne JSON, et l'a déjà fait).
  IF jsonb_typeof(v_charge) = 'string' THEN
    v_charge := (v_charge #>> '{}')::jsonb;
  END IF;
  IF jsonb_typeof(v_charge) <> 'object' THEN
    RAISE EXCEPTION 'Contenu d''analyse invalide.';
  END IF;

  BEGIN
    v_etat := coalesce(p_source_state, '{}')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'État de source invalide.';
  END;

  -- La note structurée est le cœur de l'analyse : ses quatre champs SOAP
  -- doivent exister et être du texte. On valide la FORME, jamais le fond —
  -- juger le contenu clinique n'est pas le rôle d'une contrainte.
  v_note := v_charge -> 'noteStructuree';
  IF v_note IS NULL OR jsonb_typeof(v_note) <> 'object' THEN
    RAISE EXCEPTION 'Analyse sans note structurée.';
  END IF;
  FOREACH v_champ IN ARRAY v_champs LOOP
    IF jsonb_typeof(v_note -> v_champ) <> 'string' THEN
      RAISE EXCEPTION 'Note structurée incomplète : %.', v_champ;
    END IF;
  END LOOP;
  IF jsonb_typeof(coalesce(v_charge -> 'evolution', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(v_charge -> 'pointsNonExplores', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Analyse mal formée.';
  END IF;

  -- The source comparison and derived write share this transaction and locks.
  IF v_etat ? 'notes_snapshot' THEN
    PERFORM 1 FROM app.clinical_notes n WHERE n.consultation_id=p_consultation_id ORDER BY n.id FOR UPDATE;
    SELECT jsonb_build_object('rawNotes',c.raw_notes,'notes',coalesce((
      SELECT jsonb_agg(jsonb_build_object('id',n.id,'status',n.status,'subjective',n.subjective,'objective',n.objective,'assessment',n.assessment,'plan',n.plan,
        'amendments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'body',a.body,'reason',a.reason) ORDER BY a.id)
          FROM app.clinical_note_amendments a WHERE a.note_id=n.id),'[]'::jsonb)) ORDER BY n.id)
      FROM app.clinical_notes n WHERE n.consultation_id=c.id),'[]'::jsonb))
    INTO v_snapshot FROM app.consultations c WHERE c.id=p_consultation_id;
    IF v_snapshot IS DISTINCT FROM v_etat->'notes_snapshot' THEN RETURN; END IF;
    -- Persist only fingerprints, not another copy of the clinical notes.
    v_etat := v_etat - 'notes_snapshot';
  END IF;

  -- ═══ IDEMPOTENCE ═══
  -- Même prompt ET mêmes notes ⇒ on REND la ligne existante au lieu d'en
  -- créer une seconde. Sans cela, un double-clic, un retour arrière du
  -- navigateur ou une relance après échec réseau empileraient des versions
  -- identiques, et l'historique d'analyses cesserait de vouloir dire quelque
  -- chose. La comparaison porte sur l'empreinte des notes, pas sur les notes.
  SELECT a.* INTO v_existante
    FROM app.consultation_analyses a
   WHERE a.consultation_id = p_consultation_id
   ORDER BY a.version DESC
   LIMIT 1;
  IF FOUND
     AND v_existante.prompt_hash = p_prompt_hash
     AND v_existante.source_state ->> 'notes_hash' IS NOT DISTINCT FROM v_etat ->> 'notes_hash'
     AND v_existante.source_state ->> 'notes_digest' IS NOT DISTINCT FROM v_etat ->> 'notes_digest'
     AND v_etat ->> 'notes_hash' IS NOT NULL THEN
    RETURN NEXT v_existante;
    RETURN;
  END IF;

  SELECT coalesce(max(a.version), 0) + 1 INTO v_version
    FROM app.consultation_analyses a
   WHERE a.consultation_id = p_consultation_id;

  RETURN QUERY
  INSERT INTO app.consultation_analyses (
      cabinet_id, patient_id, consultation_id, practitioner_id,
      patient_practitioner_id, version, content, source_state,
      model, prompt_version, prompt_hash)
  VALUES (
      v_cabinet, v_patient, p_consultation_id, auth.uid(),
      v_proprio, v_version, v_charge, v_etat,
      p_model, p_prompt_version, p_prompt_hash)
  RETURNING *;
END;
$$;

ALTER FUNCTION app.save_session_analysis(uuid, text, text, text, text, text)
  OWNER TO app_gatekeeper;
REVOKE ALL     ON FUNCTION app.save_session_analysis(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app.save_session_analysis(uuid, text, text, text, text, text) TO authenticated;

COMMENT ON FUNCTION app.save_session_analysis(uuid, text, text, text, text, text) IS
  'Écrit une analyse de séance. Idempotente à prompt et notes inchangés : '
  'un double-clic rend la version existante au lieu d''en empiler une seconde.';



REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
COMMIT;
