-- ═══════════════════════════════════════════════════════════════════════════
-- 069_case_summary_schema2 — LE RÉSUMÉ DEVIENT UNE CHRONOLOGIE.
--
-- ═══ POURQUOI UNE NOUVELLE FORME ═══
-- Le schéma 1 range le dossier en cinq sections fixes (`en_bref`,
-- `evolution_recente`, `a_discuter`, `traitements_documentes`,
-- `points_attention`). Cette forme n'a AUCUNE dimension temporelle : sur une
-- patiente suivie trois ans, les faits de 2024 et ceux de 2026 tombent dans la
-- même liste, et la praticienne ne peut plus lire un parcours — seulement un
-- inventaire. C'est le défaut que 069 corrige.
--
-- Le schéma 2 :
--   apercu       l'aperçu compact — nom, âge, résidence, diagnostics,
--                traitements documentés, contexte stable. ÉCRIT PAR LA
--                PASSERELLE DEPUIS `build_case_context.socle` (068), donc
--                DÉTERMINISTE : aucun modèle ne rédige cette section, et rien
--                ne peut s'y inventer. C'est le premier paragraphe exigé.
--   chronologie  une entrée par PÉRIODE (l'année), de la plus récente à la
--                plus ancienne, chaque période portant ses faits datés.
--   anterieur    la synthèse compressée de ce qui précède la fenêtre détaillée.
--   etat_actuel  l'état documenté le plus récent, et les points d'attention.
--
-- ═══ CE QUI NE CHANGE PAS, ET C'EST L'ESSENTIEL ═══
-- · Le schéma 1 reste ACCEPTÉ et lisible. Les versions déjà écrites ne
--   deviennent pas illisibles, et un déploiement partiel ne casse rien
--   (règle 9 dans l'esprit comme dans la lettre : 053 et 055 ne sont pas
--   retouchées, leur corps est recopié depuis la migration, méthode 048/052).
-- · Les citations restent vérifiées EN BASE, domaine par domaine, au périmètre
--   RLS. Le contrôle est désormais dans `app.verifier_items_resume`, appelée
--   par les DEUX schémas : une seule règle, donc aucune divergence possible
--   entre la forme ancienne et la nouvelle.
-- · Versions monotones, append-only, provenance et visibilité inchangées.
--
-- Retour arrière (documentation) : DROP FUNCTION app.verifier_items_resume ;
-- réapplication du corps 055. Humain seulement.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ───────────────────────────────────────────────────────────────────────────
-- 1 · La vérification des citations, EXTRAITE — une seule règle pour deux formes
-- ───────────────────────────────────────────────────────────────────────────
-- Recopiée à l'identique de 055, sans une condition en moins. La sortir de la
-- boucle n'assouplit rien : elle rend seulement impossible que le schéma 2
-- soit validé plus mollement que le schéma 1 — ce qui serait arrivé tôt ou
-- tard avec deux copies à maintenir.
CREATE OR REPLACE FUNCTION app.verifier_items_resume(
    p_patient_id uuid,
    p_items      jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_item   jsonb;
  v_source jsonb;
  v_type   text;
  v_ref    uuid;
  v_existe boolean;
  v_domaines constant text[] :=
      ARRAY['diagnostic','echelle','prescription','consultation','rdv','document'];
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Section de résumé invalide : un tableau est attendu.';
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    IF coalesce(btrim(v_item->>'texte',''), '') = '' THEN
      RAISE EXCEPTION 'Item de résumé sans texte.';
    END IF;
    IF jsonb_typeof(v_item->'sources') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Item de résumé sans sources.';
    END IF;
    FOR v_source IN SELECT jsonb_array_elements(v_item->'sources') LOOP
      v_type := v_source->>'t';
      BEGIN
        v_ref := (v_source->>'id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Source de résumé mal formée.';
      END;
      IF NOT (v_type = ANY (v_domaines)) THEN
        RAISE EXCEPTION 'Type de source inconnu.';
      END IF;

      -- LA CITATION DOIT EXISTER, DANS LE DOMAINE DÉCLARÉ, POUR CE PATIENT.
      -- Chaque sondage est RLS-filtré : une référence hors périmètre est
      -- indiscernable d'une référence fabriquée — même refus (fail secure).
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
        RAISE EXCEPTION 'Résumé refusé : une citation ne correspond à aucune donnée vérifiable.'
          USING HINT = 'La passerelle doit n''envoyer que des identifiants issus du dossier.';
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

ALTER FUNCTION app.verifier_items_resume(uuid, jsonb) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.verifier_items_resume(uuid, jsonb) FROM PUBLIC;

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · La porte d'écriture — deux schémas, une seule règle de citation
-- ───────────────────────────────────────────────────────────────────────────
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
  v_charge    jsonb;
  v_cle       text;
  v_periode   jsonb;
  v_version   integer;
  v_praticien uuid;
  v_proprio   uuid;
  v_schema    text;
  v_apercu    jsonb;
  v_sections  constant text[] :=
      ARRAY['en_bref','evolution_recente','a_discuter',
            'traitements_documentes','points_attention'];
BEGIN
  IF p_patient_id IS NULL THEN
    RETURN;
  END IF;

  -- Périmètre : le SELECT ci-dessous est filtré par la RLS sous l'appelant.
  -- Zéro ligne = inexistant OU hors périmètre, indistinctement (ADR-003).
  SELECT practitioner_id INTO v_proprio
    FROM app.patients WHERE id = p_patient_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'Contenu de résumé manquant.';
  END IF;
  BEGIN
    v_charge := p_content::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Contenu de résumé invalide.';
  END;
  IF jsonb_typeof(v_charge) = 'string' THEN
    v_charge := (v_charge #>> '{}')::jsonb;
  END IF;
  IF jsonb_typeof(v_charge) <> 'object' THEN
    RAISE EXCEPTION 'Contenu de résumé invalide.';
  END IF;

  v_schema := coalesce(v_charge->>'schema', '');
  IF v_schema NOT IN ('1', '2') THEN
    RAISE EXCEPTION 'Schéma de résumé non pris en charge.';
  END IF;

  IF v_schema = '1' THEN
    -- ─── Forme historique : cinq sections plates ───────────────────────────
    FOREACH v_cle IN ARRAY v_sections LOOP
      PERFORM app.verifier_items_resume(p_patient_id, v_charge -> v_cle);
    END LOOP;
    IF jsonb_typeof(v_charge->'dernier_etat') IS DISTINCT FROM 'object'
       AND jsonb_typeof(v_charge->'dernier_etat') IS DISTINCT FROM 'null' THEN
      RAISE EXCEPTION 'Section dernier_etat invalide.';
    END IF;

  ELSE
    -- ─── Forme chronologique ───────────────────────────────────────────────
    v_apercu := v_charge -> 'apercu';
    IF jsonb_typeof(v_apercu) <> 'object' THEN
      RAISE EXCEPTION 'Aperçu de résumé manquant.';
    END IF;
    -- Le nom est le seul champ EXIGÉ de l'aperçu : l'âge, la résidence ou un
    -- traitement peuvent légitimement manquer au dossier, et une absence
    -- s'affiche — elle ne se comble pas (règle 8).
    IF coalesce(btrim(v_apercu->>'nom',''), '') = '' THEN
      RAISE EXCEPTION 'Aperçu de résumé sans identité.';
    END IF;
    PERFORM app.verifier_items_resume(p_patient_id, coalesce(v_apercu->'diagnostics','[]'::jsonb));
    PERFORM app.verifier_items_resume(p_patient_id, coalesce(v_apercu->'traitements','[]'::jsonb));
    PERFORM app.verifier_items_resume(p_patient_id, coalesce(v_apercu->'contexte','[]'::jsonb));

    IF jsonb_typeof(v_charge->'chronologie') <> 'array' THEN
      RAISE EXCEPTION 'Chronologie de résumé invalide.';
    END IF;
    FOR v_periode IN SELECT jsonb_array_elements(v_charge->'chronologie') LOOP
      IF coalesce(btrim(v_periode->>'periode',''), '') = '' THEN
        RAISE EXCEPTION 'Période de chronologie sans libellé.';
      END IF;
      PERFORM app.verifier_items_resume(p_patient_id, coalesce(v_periode->'entrees','[]'::jsonb));
    END LOOP;

    PERFORM app.verifier_items_resume(p_patient_id, coalesce(v_charge->'anterieur','[]'::jsonb));
    PERFORM app.verifier_items_resume(p_patient_id, coalesce(v_charge->'etat_actuel','[]'::jsonb));
  END IF;

  -- Version suivante, sérialisée par le verrou de la ligne patient : deux
  -- générations concurrentes ne peuvent pas prendre le même numéro.
  PERFORM 1 FROM app.patients WHERE id = p_patient_id FOR UPDATE;

  SELECT coalesce(max(s.version), 0) + 1 INTO v_version
    FROM app.patient_case_summaries s WHERE s.patient_id = p_patient_id;

  v_praticien := auth.uid();

  -- trg_audit (053 §3) trace l'INSERT dans la même transaction.
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
REVOKE ALL     ON FUNCTION app.save_case_summary(uuid,text,text,text,text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app.save_case_summary(uuid,text,text,text,text,text) TO authenticated;

COMMENT ON FUNCTION app.save_case_summary(uuid,text,text,text,text,text) IS
  'Patients V3 (069). Accepte le schéma 1 (cinq sections) ET le schéma 2 '
  '(aperçu déterministe + chronologie par période). Les citations des deux '
  'formes passent par app.verifier_items_resume : une seule règle, aucune '
  'divergence possible entre l''ancienne forme et la nouvelle.';

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('069_case_summary_schema2')
  ON CONFLICT DO NOTHING;

COMMIT;
