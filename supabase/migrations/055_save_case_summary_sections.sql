-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- 055_save_case_summary_sections â€” la boucle de validation lit les SECTIONS.
--
-- TROUVÃ‰ PAR LA SONDE D'INTÃ‰GRATION, PAS EN RELICTURE. Premier appel rÃ©el :
-- un rÃ©sumÃ© parfaitement conforme Ã©tait refusÃ© Â« Item de rÃ©sumÃ© sans texte Â».
--
-- LA CAUSE. La premiÃ¨re rÃ©daction itÃ©rait ainsi :
--     FOREACH v_section IN ARRAY ARRAY(SELECT jsonb_agg(v_charge -> k) ...)
-- `jsonb_agg` agrÃ¨ge les cinq valeurs de sections en UN SEUL tableau jsonb ;
-- `ARRAY(...)` l'enveloppe encore. Le FOREACH ne tournait donc qu'UNE fois,
-- avec pour Â« section Â» le tableau-des-tableaux â€” et chaque VRAIE section
-- Ã©tait ensuite parcourue comme si c'Ã©tait un item : `item->>'texte'` valait
-- NULL, refus systÃ©matique.
--
-- LE CORRECTIF. ItÃ©rer les clÃ©s, extraire chaque section :
--     FOREACH v_cle IN ARRAY v_sections LOOP
--       v_section := v_charge -> v_cle;
-- MÃªme contrat, mÃªmes messages, mÃªmes garde-fous ; une variable dÃ©clarÃ©e en
-- plus (`v_cle text`). Le diff est vÃ©rifiable : quatre lignes.
--
-- âš ï¸ RÃˆGLE 9 : 053 est appliquÃ©e, elle n'est pas retouchÃ©e. Corps RECOPIÃ‰ de
-- pg_proc.prosrc (mÃ©thode 048/052), changement ci-dessus seul.
--
-- Retour arriÃ¨re (documentation) : DROP FUNCTION app.save_case_summary(...)
-- puis rÃ©application du corps 053. Humain seulement.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE OR REPLACE FUNCTION app.save_case_summary(
    p_patient_id     uuid,
    p_content        text,
    p_source_state   text,
    p_model          text,
    p_prompt_version text,
    p_prompt_hash    text)
RETURNS SETOF app.patient_case_summaries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_charge      jsonb;
  v_section     jsonb;
  v_cle         text;
  v_item        jsonb;
  v_source      jsonb;
  v_type        text;
  v_ref         uuid;
  v_existe      boolean;
  v_version     integer;
  v_praticien   uuid;
  v_proprio     uuid;
  v_domaines    constant text[] :=
      ARRAY['diagnostic','echelle','prescription','consultation','rdv','document'];
  v_sections    constant text[] :=
      ARRAY['en_bref','evolution_recente','a_discuter',
            'traitements_documentes','points_attention'];
BEGIN
  IF p_patient_id IS NULL THEN
    RETURN;
  END IF;

  -- PÃƒÂ©rimÃƒÂ¨tre : le SELECT ci-dessous est filtrÃƒÂ© par la RLS sous l'appelant.
  -- ZÃƒÂ©ro ligne = inexistant OU hors pÃƒÂ©rimÃƒÂ¨tre, indistinctement (ADR-003) ;
  -- la fonction ne teste rien elle-mÃƒÂªme (rÃƒÂ¨gle 4).
  SELECT practitioner_id INTO v_proprio
    FROM app.patients WHERE id = p_patient_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Charge objet JSON, formes sÃƒÂ©rialisÃƒÂ©e et brute acceptÃƒÂ©es (leÃƒÂ§on 049).
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'Contenu de rÃƒÂ©sumÃƒÂ© manquant.';
  END IF;
  BEGIN
    v_charge := p_content::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Contenu de rÃƒÂ©sumÃƒÂ© invalide.';
  END;
  IF jsonb_typeof(v_charge) = 'string' THEN
    v_charge := (v_charge #>> '{}')::jsonb;
  END IF;
  IF jsonb_typeof(v_charge) <> 'object' THEN
    RAISE EXCEPTION 'Contenu de rÃƒÂ©sumÃƒÂ© invalide.';
  END IF;
  IF (v_charge->>'schema') <> '1' THEN
    RAISE EXCEPTION 'SchÃƒÂ©ma de rÃƒÂ©sumÃƒÂ© non pris en charge.';
  END IF;

  -- Chaque item de chaque section : texte non vide + SOURCES typÃƒÂ©es.
  FOREACH v_cle IN ARRAY v_sections LOOP
    v_section := v_charge -> v_cle;
    IF jsonb_typeof(v_section) <> 'array' THEN
      RAISE EXCEPTION 'Section de rÃƒÂ©sumÃƒÂ© invalide : un tableau est attendu.';
    END IF;
    FOR v_item IN SELECT jsonb_array_elements(v_section) LOOP
      IF coalesce(btrim(v_item->>'texte',''), '') = '' THEN
        RAISE EXCEPTION 'Item de rÃƒÂ©sumÃƒÂ© sans texte.';
      END IF;
      IF jsonb_typeof(v_item->'sources') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Item de rÃƒÂ©sumÃƒÂ© sans sources.';
      END IF;
      FOR v_source IN SELECT jsonb_array_elements(v_item->'sources') LOOP
        v_type := v_source->>'t';
        BEGIN
          v_ref := (v_source->>'id')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'Source de rÃƒÂ©sumÃƒÂ© mal formÃƒÂ©e.';
        END;
        IF NOT (v_type = ANY (v_domaines)) THEN
          RAISE EXCEPTION 'Type de source inconnu.';
        END IF;

        -- LA CITATION DOIT EXISTER, DANS LE DOMAINE DÃƒâ€°CLARÃƒâ€°, POUR CE PATIENT.
        -- Chaque sondage est RLS-filtrÃƒÂ© : une rÃƒÂ©fÃƒÂ©rence hors pÃƒÂ©rimÃƒÂ¨tre est
        -- indiscernable d'une rÃƒÂ©fÃƒÂ©rence fabriquÃƒÂ©e Ã¢â‚¬â€ mÃƒÂªme refus (fail secure).
        v_existe := CASE v_type
          WHEN 'diagnostic' THEN
            EXISTS (SELECT 1 FROM app.diagnoses d
                     WHERE d.id = v_ref AND d.patient_id = p_patient_id)
          WHEN 'echelle' THEN
            EXISTS (SELECT 1 FROM app.scale_administrations e
                     WHERE e.id = v_ref AND e.patient_id = p_patient_id)
          WHEN 'prescription' THEN
            EXISTS (SELECT 1 FROM app.prescriptions x
                     WHERE x.id = v_ref AND x.patient_id = p_patient_id)
          WHEN 'consultation' THEN
            EXISTS (SELECT 1 FROM app.consultations c
                     WHERE c.id = v_ref AND c.patient_id = p_patient_id)
          WHEN 'rdv' THEN
            EXISTS (SELECT 1 FROM app.appointments a
                     WHERE a.id = v_ref AND a.patient_id = p_patient_id)
          WHEN 'document' THEN
            EXISTS (SELECT 1 FROM app.documents g
                     WHERE g.id = v_ref AND g.patient_id = p_patient_id)
          ELSE false END;
        IF NOT v_existe THEN
          RAISE EXCEPTION 'RÃƒÂ©sumÃƒÂ© refusÃƒÂ© : une citation ne correspond ÃƒÂ  aucune donnÃƒÂ©e vÃƒÂ©rifiable.'
            USING HINT = 'La passerelle doit n''envoyer que des identifiants issus du dossier.';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- `dernier_etat` : objet libre mais objet.
  IF jsonb_typeof(v_charge->'dernier_etat') IS DISTINCT FROM 'object'
     AND jsonb_typeof(v_charge->'dernier_etat') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'Section dernier_etat invalide.';
  END IF;

  -- Version suivante, sÃƒÂ©rialisÃƒÂ©e par le verrou de la ligne patient : deux
  -- gÃƒÂ©nÃƒÂ©rations concurrentes ne peuvent pas prendre le mÃƒÂªme numÃƒÂ©ro.
  PERFORM 1 FROM app.patients WHERE id = p_patient_id FOR UPDATE;

  SELECT coalesce(max(s.version), 0) + 1 INTO v_version
    FROM app.patient_case_summaries s WHERE s.patient_id = p_patient_id;

  v_praticien := auth.uid();

  -- trg_audit (posÃƒÂ© au Ã‚Â§3) trace l'INSERT dans la mÃƒÂªme transaction.
  RETURN QUERY
  INSERT INTO app.patient_case_summaries (
    cabinet_id, patient_id, practitioner_id, patient_practitioner_id,
    version, content, source_state, model, prompt_version, prompt_hash
  ) VALUES (
    app.current_cabinet(), p_patient_id, v_praticien, v_proprio,
    v_version, v_charge,
    CASE WHEN p_source_state IS NULL OR btrim(p_source_state) = ''
         THEN '{}'::jsonb ELSE p_source_state::jsonb END,
    left(coalesce(p_model, 'inconnu'), 120),
    left(coalesce(p_prompt_version, 'inconnu'), 40),
    left(coalesce(p_prompt_hash, ''), 16)
  )
  RETURNING *;
END;


$$;

ALTER FUNCTION app.save_case_summary(uuid,text,text,text,text,text) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.save_case_summary(uuid,text,text,text,text,text) IS
  'Patients V3 (055). Identique Ã  053 : versions monotones par patient, '
  'citations vÃ©rifiÃ©es domaine par domaine au pÃ©rimÃ¨tre RLS, provenance '
  '(practitioner_id) sÃ©parÃ©e de la visibilitÃ© (patient_practitioner_id). '
  'Correctif 055 : la boucle de validation itÃ¨re les CLÃ‰S de sections '
  '(la forme ARRAY(jsonb_agg(...)) lisait le tableau-des-tableaux comme une '
  'section unique et refusait tout rÃ©sumÃ© conforme).';

REVOKE ALL ON FUNCTION app.save_case_summary(uuid,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.save_case_summary(uuid,text,text,text,text,text) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('055_save_case_summary_sections')
  ON CONFLICT DO NOTHING;

COMMIT;
