-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- 053_case_summaries â€” le RÃ©sumÃ© du cas : stockage append-only, portes,
-- et l'Ã©volution ADDITIVE du contrat du workspace (`contrat` reste 1).
--
-- â•â•â• CE QUE CE LOT N'EST PAS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Le rÃ©sumÃ© IA n'est PAS la source de vÃ©ritÃ© clinique. La vÃ©ritÃ© reste dans
-- diagnoses / scale_administrations / prescriptions / consultations /
-- appointments / documents. Une ligne de rÃ©sumÃ© est rÃ©gÃ©nÃ©rable par nature ;
-- sa suppression ne dÃ©truirait aucune donnÃ©e clinique, mais elle reste en
-- ajout-seul pour que chaque version gÃ©nÃ©rÃ©e reste auditable et comparable.
--
-- â•â•â• AMENDEMENT A â€” VISIBILITÃ‰ PAR PATIENT, PROVENANCE PAR GÃ‰NÃ‰RATEUR â•â•â•â•â•â•
-- Deux colonnes distinctes, deux rÃ´les distincts :
--   practitioner_id         Â« gÃ©nÃ©rÃ© par Â»  â€” provenance/audit AFFICHÃ‰E.
--   patient_practitioner_id Â« possÃ©dÃ© par Â» â€” copie de patients.practitioner_id
--       posÃ©e Ã  la gÃ©nÃ©ration par la porte ; CLÃ‰ DE VISIBILITÃ‰ de la RLS.
-- Pourquoi la copie plutÃ´t qu'une jointure : SELECT sur app.patients est
-- rÃ©voquÃ© aux appelants (ADR-019) â€” une policy ne peut donc pas joindre la
-- table sans rÃ©introduire un chemin direct. Et la copie NE PEUT PAS devenir
-- fausse : update_patient exclut practitioner_id de son allowlist par
-- conception (020) â€” la possession d'un patient est immuable.
-- ConsÃ©quence voulue : l'owner gÃ©nÃ¨re pour une patiente d'une praticienne â‡’
-- la praticienne VOIT le rÃ©sumÃ© (can_see_clinical sur SON patient), quel que
-- soit le gÃ©nÃ©rateur. Jamais de silo par gÃ©nÃ©rateur.
--
-- â•â•â• SÃ‰CURITÃ‰ â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Â· RLS ENABLE + FORCE, policy unique calquÃ©e sur les tables cliniques
--   (cabinet + can_see_clinical(patient_practitioner_id)). AUCUNE policy
--   assistant : invisible pour elle, mÃªme en SQL brut.
-- Â· SELECT/INSERT/UPDATE/DELETE rÃ©voquÃ©s Ã  authenticated ET service_role :
--   la lecture passe par get_patient_workspace (qui journalise dÃ©jÃ  sa trace
--   `fiche`), l'Ã©criture par save_case_summary / flag_case_summary. ZÃ©ro
--   chemin non tracÃ© â€” plus strict que la dette connue sur diagnoses/
--   prescriptions, parce qu'une donnÃ©e DÃ‰RIVÃ‰E n'a aucune raison d'Ãªtre
--   lisible directement.
-- Â· trg_audit (013) attachÃ© aux deux tables : toute Ã©criture tracÃ©e dans la
--   mÃªme transaction (I4/rÃ¨gle 5).
-- Â· Citations vÃ©rifiÃ©es EN BASE : toute `sources[].id` doit exister ET
--   appartenir au patient dans le domaine dÃ©clarÃ©. Un LLM qui invente une
--   rÃ©fÃ©rence se voit refuser l'enregistrement â€” fail secure, double barriÃ¨re
--   avec le validateur de la passerelle.
--
-- â•â•â• WORKSPACE V2 â€” Ã‰VOLUTION NON-ROTURE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- get_patient_workspace est remplacÃ©e avec EXACTEMENT deux ajouts, et le
-- champ `contrat` RESTE Ã€ 1 : des champs OPTIONNELS nouveaux ne cassent aucun
-- consommateur existant (le Zod cÃ´tÃ© Ã©cran ignore ce qu'il ne connaÃ®t pas) ;
-- le bump de contrat est rÃ©servÃ© aux ruptures (STATE V10 Â§1).
--   Â· rendez_vous_du_jour : les RDV du jour [minuit,maxuit[ Africa/Algiers,
--     tous statuts sauf annulÃ©/no_show â€” le bandeau Â« Aujourd'hui Â».
--   Â· resume : derniÃ¨re version valide du rÃ©sumÃ© (null hors droit clinique â€”
--     mÃªme prÃ©dicat que `clinique`, clÃ© = LE PATIENT, jamais le gÃ©nÃ©rateur) ;
--     `a_jour` calculÃ© EN BASE par comparaison aux horodatages des domaines
--     couverts â€” l'Ã©cran affiche trois Ã©tats lisibles, jamais une technique.
--
-- Retour arriÃ¨re (documentation, jamais exÃ©cutÃ© automatiquement) :
--   DROP FUNCTION save_case_summary/flag_case_summary/get_patient_workspace(re-collage 047/048) ;
--   DROP TABLE case_summary_feedback, patient_case_summaries ;
--   retrait des deux clÃ©s jsonb ajoutÃ©es. OpÃ©ration humaine seulement.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 1 Â· Les tables â€” append-only, cloisonnÃ©es par LE PATIENT
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS app.patient_case_summaries (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id              uuid NOT NULL REFERENCES app.cabinets(id),
    patient_id              uuid NOT NULL REFERENCES app.patients(id),
    -- Provenance : QUI a fait gÃ©nÃ©rer cette version (affichÃ© Â« GÃ©nÃ©rÃ© par Â»).
    practitioner_id         uuid NOT NULL REFERENCES app.profiles(id),
    -- VisibilitÃ© : LE praticien du patient, copiÃ© par la porte (voir en-tÃªte).
    patient_practitioner_id uuid NOT NULL REFERENCES app.profiles(id),
    version                 integer NOT NULL,
    content                 jsonb NOT NULL,
    source_state            jsonb NOT NULL,
    model                   text NOT NULL,
    prompt_version          text NOT NULL,
    prompt_hash             text NOT NULL,
    generated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (patient_id, version)
);

CREATE TABLE IF NOT EXISTS app.case_summary_feedback (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id              uuid NOT NULL REFERENCES app.cabinets(id),
    summary_id              uuid NOT NULL REFERENCES app.patient_case_summaries(id),
    author_id               uuid NOT NULL DEFAULT auth.uid() REFERENCES app.profiles(id),
    patient_practitioner_id uuid NOT NULL REFERENCES app.profiles(id),
    verdict                 text NOT NULL
                            CHECK (verdict IN ('incorrect','imprecis','hors_sujet')),
    motif                   text NOT NULL CHECK (length(btrim(motif)) BETWEEN 1 AND 1000),
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_summaries_patient
    ON app.patient_case_summaries (patient_id, version DESC);
CREATE INDEX IF NOT EXISTS case_feedback_summary
    ON app.case_summary_feedback (summary_id, created_at);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 2 Â· RLS â€” la clÃ© est LE PATIENT, jamais le gÃ©nÃ©rateur (Amendement A)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ALTER TABLE app.patient_case_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.patient_case_summaries FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.case_summary_feedback  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.case_summary_feedback  FORCE  ROW LEVEL SECURITY;

CREATE POLICY case_summaries_clinical ON app.patient_case_summaries
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet()
                 AND app.can_see_clinical(patient_practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet()
                 AND app.can_see_clinical(patient_practitioner_id));

CREATE POLICY case_feedback_clinical ON app.case_summary_feedback
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet()
                 AND app.can_see_clinical(patient_practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet()
                 AND app.can_see_clinical(patient_practitioner_id));

-- Aucune policy assistant : la table est inexistante pour elle (motif 004 Â§7).
-- Lecture ET Ã©criture directes fermÃ©es Ã  tous : portes uniquement.
REVOKE ALL ON app.patient_case_summaries FROM authenticated, service_role;
REVOKE ALL ON app.case_summary_feedback  FROM authenticated, service_role;

GRANT SELECT, INSERT ON app.patient_case_summaries TO app_gatekeeper;
GRANT SELECT, INSERT ON app.case_summary_feedback  TO app_gatekeeper;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 3 Â· Audit â€” mÃªme mÃ©canisme que 013, attachÃ© aux nouvelles tables
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
DROP TRIGGER IF EXISTS trg_audit ON app.patient_case_summaries;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON app.patient_case_summaries
    FOR EACH ROW EXECUTE FUNCTION audit.track();

DROP TRIGGER IF EXISTS trg_audit ON app.case_summary_feedback;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON app.case_summary_feedback
    FOR EACH ROW EXECUTE FUNCTION audit.track();

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 4 Â· Porte d'Ã©criture du rÃ©sumÃ© â€” citations vÃ©rifiÃ©es, versions sÃ©rialisÃ©es
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  -- PÃ©rimÃ¨tre : le SELECT ci-dessous est filtrÃ© par la RLS sous l'appelant.
  -- ZÃ©ro ligne = inexistant OU hors pÃ©rimÃ¨tre, indistinctement (ADR-003) ;
  -- la fonction ne teste rien elle-mÃªme (rÃ¨gle 4).
  SELECT practitioner_id INTO v_proprio
    FROM app.patients WHERE id = p_patient_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Charge objet JSON, formes sÃ©rialisÃ©e et brute acceptÃ©es (leÃ§on 049).
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'Contenu de rÃ©sumÃ© manquant.';
  END IF;
  BEGIN
    v_charge := p_content::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Contenu de rÃ©sumÃ© invalide.';
  END;
  IF jsonb_typeof(v_charge) = 'string' THEN
    v_charge := (v_charge #>> '{}')::jsonb;
  END IF;
  IF jsonb_typeof(v_charge) <> 'object' THEN
    RAISE EXCEPTION 'Contenu de rÃ©sumÃ© invalide.';
  END IF;
  IF (v_charge->>'schema') <> '1' THEN
    RAISE EXCEPTION 'SchÃ©ma de rÃ©sumÃ© non pris en charge.';
  END IF;

  -- Chaque item de chaque section : texte non vide + SOURCES typÃ©es.
  FOREACH v_section IN ARRAY ARRAY(
    SELECT jsonb_agg(v_charge -> k) FROM unnest(v_sections) AS k
  ) LOOP
    IF jsonb_typeof(v_section) <> 'array' THEN
      RAISE EXCEPTION 'Section de rÃ©sumÃ© invalide : un tableau est attendu.';
    END IF;
    FOR v_item IN SELECT jsonb_array_elements(v_section) LOOP
      IF coalesce(btrim(v_item->>'texte',''), '') = '' THEN
        RAISE EXCEPTION 'Item de rÃ©sumÃ© sans texte.';
      END IF;
      IF jsonb_typeof(v_item->'sources') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Item de rÃ©sumÃ© sans sources.';
      END IF;
      FOR v_source IN SELECT jsonb_array_elements(v_item->'sources') LOOP
        v_type := v_source->>'t';
        BEGIN
          v_ref := (v_source->>'id')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'Source de rÃ©sumÃ© mal formÃ©e.';
        END;
        IF NOT (v_type = ANY (v_domaines)) THEN
          RAISE EXCEPTION 'Type de source inconnu.';
        END IF;

        -- LA CITATION DOIT EXISTER, DANS LE DOMAINE DÃ‰CLARÃ‰, POUR CE PATIENT.
        -- Chaque sondage est RLS-filtrÃ© : une rÃ©fÃ©rence hors pÃ©rimÃ¨tre est
        -- indiscernable d'une rÃ©fÃ©rence fabriquÃ©e â€” mÃªme refus (fail secure).
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
          RAISE EXCEPTION 'RÃ©sumÃ© refusÃ© : une citation ne correspond Ã  aucune donnÃ©e vÃ©rifiable.'
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

  -- Version suivante, sÃ©rialisÃ©e par le verrou de la ligne patient : deux
  -- gÃ©nÃ©rations concurrentes ne peuvent pas prendre le mÃªme numÃ©ro.
  PERFORM 1 FROM app.patients WHERE id = p_patient_id FOR UPDATE;

  SELECT coalesce(max(s.version), 0) + 1 INTO v_version
    FROM app.patient_case_summaries s WHERE s.patient_id = p_patient_id;

  v_praticien := auth.uid();

  -- trg_audit (posÃ© au Â§3) trace l'INSERT dans la mÃªme transaction.
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
  'Patients V3. Seule Ã©criture d''un RÃ©sumÃ© du cas. Version monotone par '
  'patient (verrou ligne patient), citations vÃ©rifiÃ©es domaine par domaine '
  'au pÃ©rimÃ¨tre RLS de l''appelant, provenance (practitioner_id) sÃ©parÃ©e de '
  'la visibilitÃ© (patient_practitioner_id, Amendement A).';

REVOKE ALL ON FUNCTION app.save_case_summary(uuid,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.save_case_summary(uuid,text,text,text,text,text) TO authenticated;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 5 Â· Porte de signalement â€” append-only, ne mute JAMAIS le rÃ©sumÃ©
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE OR REPLACE FUNCTION app.flag_case_summary(
    p_summary_id uuid,
    p_verdict    text,
    p_motif      text)
RETURNS SETOF app.case_summary_feedback
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_resume  app.patient_case_summaries%ROWTYPE;
BEGIN
  IF p_verdict NOT IN ('incorrect','imprecis','hors_sujet') THEN
    RAISE EXCEPTION 'Verdict de signalement inconnu.';
  END IF;
  IF p_motif IS NULL OR btrim(p_motif) = '' THEN
    RAISE EXCEPTION 'Un motif de signalement est obligatoire.';
  END IF;

  -- PÃ©rimÃ¨tre par la RLS, comme partout : un rÃ©sumÃ© invisible ne peut Ãªtre
  -- signalÃ©, et l'introuvable/hors-pÃ©rimÃ¨tre restent indistincts.
  SELECT * INTO v_resume FROM app.patient_case_summaries WHERE id = p_summary_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO app.case_summary_feedback (
    cabinet_id, summary_id, author_id, patient_practitioner_id, verdict, motif
  ) VALUES (
    app.current_cabinet(), p_summary_id, auth.uid(), v_resume.patient_practitioner_id,
    p_verdict, btrim(p_motif)
  )
  RETURNING *;
END;
$$;

ALTER FUNCTION app.flag_case_summary(uuid,text,text) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.flag_case_summary(uuid,text,text) IS
  'Patients V3. Signalement d''une information de rÃ©sumÃ© jugÃ©e fausse. '
  'Append-only : Ã©vÃ©nement d''Ã©valuation et de traÃ§abilitÃ© ; le correctif du '
  'rÃ©sumÃ© est une RÃ‰GÃ‰NÃ‰RATION (nouvelle version), jamais une mutation.';

REVOKE ALL ON FUNCTION app.flag_case_summary(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.flag_case_summary(uuid,text,text) TO authenticated;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 6 Â· Workspace v2 â€” Ã©volution additive, contrat inchangÃ© (corps Ã©pissÃ©)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE OR REPLACE FUNCTION app.get_patient_workspace(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_pat      app.patients%ROWTYPE;
  v_clinique boolean;
  v_resultat jsonb;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Trace AVANT la lecture, mÃªme transaction (I4, motif `get_patient` 020) :
  -- la TENTATIVE d'ouverture est tracÃ©e, y compris quand la RLS ne rend rien.
  PERFORM audit.log_read(p_id, 'fiche');

  -- La RLS dÃ©cide. ZÃ©ro ligne = inexistant OU hors pÃ©rimÃ¨tre, et les deux
  -- rendent la mÃªme chose : distinguer fabriquerait un oracle d'existence
  -- (ADR-003). Ne jamais Â« amÃ©liorer Â» ce comportement.
  SELECT * INTO v_pat FROM app.patients WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- ReprÃ©sentation, pas autorisation â€” voir l'en-tÃªte. La praticienne du
  -- dossier vient de la ligne DÃ‰JÃ€ filtrÃ©e par la RLS, jamais de l'appelant.
  v_clinique := app.can_see_clinical(v_pat.practitioner_id);

  SELECT jsonb_build_object(
    'contrat',  1,
    'genere_a', now(),

    'identite', jsonb_build_object(
      'id',            v_pat.id,
      'record_number', v_pat.record_number,
      'first_name',    v_pat.first_name,
      'last_name',     v_pat.last_name,
      'birth_date',    v_pat.birth_date,
      'age',           CASE WHEN v_pat.birth_date IS NULL THEN NULL
                            ELSE extract(year FROM age(v_pat.birth_date))::int END,
      'sex',           v_pat.sex,
      'is_active',     v_pat.is_active
    ),

    'contact', jsonb_build_object(
      'phone',             v_pat.phone,
      'phone_alt',         v_pat.phone_alt,
      'address',           v_pat.address,
      'emergency_contact', v_pat.emergency_contact
    ),

    'identification', jsonb_build_object(
      'id_document_number', v_pat.id_document_number,
      'id_document_issuer', v_pat.id_document_issuer
    ),

    'admin', jsonb_build_object('notes_admin', v_pat.notes_admin),

    -- JSON null = domaine inaccessible. Objet aux listes vides = accessible,
    -- sans donnÃ©e. L'Ã©cran distingue les deux ; c'est tout l'enjeu.
    'clinique', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE jsonb_build_object(

      'diagnostics', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id',          d.id,
                 'code_system', d.code_system,
                 'code',        d.code,
                 'label',       d.label,
                 'is_primary',  d.is_primary,
                 'onset_date',  d.onset_date,
                 'resolved_at', d.resolved_at)
               ORDER BY d.is_primary DESC, d.onset_date DESC NULLS LAST, d.created_at DESC)
          FROM app.diagnoses d
         WHERE d.patient_id = p_id), '[]'::jsonb),

      -- Par Ã©chelle : les DEUX derniÃ¨res mesures, jamais plus. `precedent` et
      -- `delta` restent nuls s'il n'y en a qu'une â€” une seule observation ne
      -- fait pas une tendance, et l'Ã©cran ne doit pas pouvoir en dessiner une.
      'echelles', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'scale_code', e.code,
                 'scale_name', e.name_fr,
                 'dernier', jsonb_build_object(
                   'score',          e.d_score,
                   'date',           e.d_date,
                   'interpretation', e.d_interp),
                 'precedent', CASE WHEN e.p_date IS NULL THEN 'null'::jsonb
                                   ELSE jsonb_build_object('score', e.p_score,
                                                           'date',  e.p_date) END,
                 'delta', CASE WHEN e.p_score IS NULL OR e.d_score IS NULL THEN NULL
                               ELSE e.d_score - e.p_score END)
               ORDER BY e.d_date DESC)
          FROM (
            SELECT r.code, r.name_fr,
                   max(r.total_score)     FILTER (WHERE r.rang = 1) AS d_score,
                   max(r.administered_at) FILTER (WHERE r.rang = 1) AS d_date,
                   max(r.interpretation)  FILTER (WHERE r.rang = 1) AS d_interp,
                   max(r.total_score)     FILTER (WHERE r.rang = 2) AS p_score,
                   max(r.administered_at) FILTER (WHERE r.rang = 2) AS p_date
              FROM (
                SELECT s.code, s.name_fr, sa.total_score, sa.interpretation,
                       sa.administered_at,
                       row_number() OVER (PARTITION BY sa.scale_id
                                          ORDER BY sa.administered_at DESC) AS rang
                  FROM app.scale_administrations sa
                  JOIN app.scales s ON s.id = sa.scale_id
                 WHERE sa.patient_id = p_id
              ) r
             WHERE r.rang <= 2
             GROUP BY r.code, r.name_fr
          ) e), '[]'::jsonb),

      'derniere_consultation', (
        SELECT jsonb_build_object(
                 'id',         c.id,
                 'started_at', c.started_at,
                 'ended_at',   c.ended_at,
                 'status',     c.status,
                 -- `kind` vit sur le RENDEZ-VOUS, jamais sur la consultation
                 -- (024 ne l'a ajoutÃ© qu'Ã  `app.appointments`). MÃªme chemin que
                 -- `appointment_kind` dans `get_consultation` (026).
                 'kind',       a.kind,
                 'practitioner_name', pr.full_name)
          FROM app.consultations c
          LEFT JOIN app.profiles pr ON pr.id = c.practitioner_id
          LEFT JOIN app.appointments a ON a.id = c.appointment_id
         WHERE c.patient_id = p_id
         ORDER BY c.started_at DESC
         LIMIT 1),

      'nombre_consultations', (
        SELECT count(*) FROM app.consultations c WHERE c.patient_id = p_id)
    ) END,

    -- Historique de prescriptions, PAS un moteur de statut mÃ©dicamenteux :
    -- le schÃ©ma n'a ni `stopped_at` ni statut de ligne. Â« derniÃ¨re
    -- prescription Â», jamais Â« traitement en cours Â» â€” l'Ã©cran ne peut pas
    -- affirmer ce que la base n'enregistre pas.
    'traitements', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE jsonb_build_object(

      'derniere_prescription', (
        SELECT jsonb_build_object(
                 'id',                px.id,
                 'prescribed_at',     px.prescribed_at,
                 'is_handwritten',    px.is_handwritten,
                 'practitioner_name', pr.full_name,
                 'lignes', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'id',                pl.id,
                            'designation',       COALESCE(m.inn, pl.free_text),
                            'brand_name',        m.brand_name,
                            'dose',              pl.dose,
                            'frequency_per_day', pl.frequency_per_day,
                            'duration_days',     pl.duration_days,
                            'instructions',      pl.instructions)
                          ORDER BY pl.position)
                     FROM app.prescription_lines pl
                     LEFT JOIN app.medications m ON m.id = pl.medication_id
                    WHERE pl.prescription_id = px.id), '[]'::jsonb))
          FROM app.prescriptions px
          LEFT JOIN app.profiles pr ON pr.id = px.practitioner_id
         WHERE px.patient_id = p_id
         ORDER BY px.prescribed_at DESC
         LIMIT 1),

      'nombre_prescriptions', (
        SELECT count(*) FROM app.prescriptions px WHERE px.patient_id = p_id)
    ) END,

    -- L'agenda reste propriÃ©taire du rendez-vous : on en lit un rÃ©sumÃ©, on ne
    -- le duplique pas. Accessible Ã  l'accueil, comme les policies de 006.
    'agenda', jsonb_build_object(
      'prochain_rendez_vous', (
        SELECT jsonb_build_object(
                 'id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
                 'status', a.status, 'kind', a.kind,
                 'practitioner_name', pr.full_name)
          FROM app.appointments a
          LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
         WHERE a.patient_id = p_id
           AND a.starts_at >= now()
           AND a.status NOT IN ('cancelled', 'no_show')
         ORDER BY a.starts_at ASC
         LIMIT 1),
      'dernier_rendez_vous', (
        SELECT jsonb_build_object(
                 'id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
                 'status', a.status, 'kind', a.kind,
                 'practitioner_name', pr.full_name)
          FROM app.appointments a
          LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
         WHERE a.patient_id = p_id
           AND a.starts_at < now()
         ORDER BY a.starts_at DESC
         LIMIT 1),
      'nombre_rendez_vous', (
        SELECT count(*) FROM app.appointments a WHERE a.patient_id = p_id)
    ),

    -- Comptage seulement : la LISTE reste `list_patient_documents` (030), qui
    -- Ã©crit sa propre trace `liste` quand la praticienne la demande vraiment.
    'documents', jsonb_build_object(
      'nombre', (SELECT count(*) FROM app.documents dc WHERE dc.patient_id = p_id),
      'dernier_emis_le', (SELECT max(dc.issued_at) FROM app.documents dc
                           WHERE dc.patient_id = p_id)
    ),    -- â”€â”€ Patients V3 Â· les RDV DU JOUR â€” bornes Africa/Algiers (CLAUDE.md Â§4).
    -- Le bandeau Â« Aujourd'hui Â» rÃ©pond Ã  Â« pourquoi ce dossier maintenant Â»
    -- sans jamais fabriquer un rendez-vous : liste vide = aucun RDV aujourd'hui.
    'rendez_vous_du_jour', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
               'status', a.status, 'kind', a.kind,
               'practitioner_name', pr.full_name)
             ORDER BY a.starts_at ASC)
        FROM app.appointments a
        LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
       WHERE a.patient_id = p_id
         AND a.starts_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') AT TIME ZONE 'Africa/Algiers'
         AND a.starts_at <  (date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') + interval '1 day') AT TIME ZONE 'Africa/Algiers'
         AND a.status NOT IN ('cancelled','no_show')), '[]'::jsonb),

    -- â”€â”€ Patients V3 Â· derniÃ¨re version valide du RÃ©sumÃ© du cas.
    -- JSON null hors droit clinique du PATIENT (Amendement A : mÃªme prÃ©dicat
    -- que `clinique`, JAMAIS le gÃ©nÃ©rateur â€” l'owner peut gÃ©nÃ©rer pour la
    -- patiente d'une praticienne, c'est elle qui doit le voir).
    -- `a_jour` est calculÃ© EN BASE : comparaison de generated_at au dernier
    -- horodatage des domaines couverts par source_state. L'Ã©cran en fait un
    -- des trois libellÃ©s prÃ©vus ; il n'affiche ni hash ni technique.
    'resume', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE COALESCE((
      SELECT jsonb_build_object(
               'id',         s.id,
               'version',    s.version,
               'genere_le',  s.generated_at,
               'genere_par', gp.full_name,
               'a_jour', (
                 SELECT coalesce(max(t.dernier) IS NULL
                                  OR s.generated_at >= max(t.dernier), true)
                   FROM (
                     SELECT max(d.created_at)      AS dernier FROM app.diagnoses d            WHERE d.patient_id = p_id
                     UNION ALL
                     SELECT max(e.administered_at) FROM app.scale_administrations e WHERE e.patient_id = p_id
                     UNION ALL
                     SELECT max(c.started_at)      FROM app.consultations c        WHERE c.patient_id = p_id
                     UNION ALL
                     SELECT max(x.prescribed_at)   FROM app.prescriptions x        WHERE x.patient_id = p_id
                     UNION ALL
                     SELECT max(r.created_at)      FROM app.appointments r         WHERE r.patient_id = p_id
                     UNION ALL
                     SELECT max(dc.issued_at)      FROM app.documents dc           WHERE dc.patient_id = p_id
                   ) t),
               'contenu', s.content)
        FROM app.patient_case_summaries s
        LEFT JOIN app.profiles gp ON gp.id = s.practitioner_id
       WHERE s.patient_id = p_id
       ORDER BY s.version DESC
       LIMIT 1), 'null'::jsonb) END
  )
  INTO v_resultat;

  RETURN v_resultat;
END;


$$;

ALTER FUNCTION app.get_patient_workspace(uuid) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.get_patient_workspace(uuid) IS
  'Patients V2/V3. FaÃ§ade de lecture de l''espace de travail, UNE trace '
  '''fiche'' avant lecture. 053 ajoute rendez_vous_du_jour et resume '
  '(Amendement A : null hors droit clinique du PATIENT), contrat inchangÃ©.';

REVOKE ALL ON FUNCTION app.get_patient_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_patient_workspace(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7 Â· Retrait du privilÃ¨ge de transfert â€” motif 020 Â§5
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('053_case_summaries')
  ON CONFLICT DO NOTHING;

COMMIT;
