-- ═══════════════════════════════════════════════════════════════════════════
-- 067_consultation_analyses — L'ANALYSE DE SÉANCE DEVIENT DURABLE.
--
-- ═══ LE CHAÎNON QUI MANQUAIT ═══
-- `jarvis-analyze-session` lisait la consultation, l'historique des notes et le
-- workspace, pseudonymisait, appelait le modèle, validait la réponse — et ne
-- l'écrivait NULLE PART. L'analyse vivait dans l'état React de l'écran :
-- fermer la consultation la perdait, le dossier n'en gardait rien, et le
-- résumé du cas ne pouvait pas la consommer. Il n'existait donc AUCUNE mémoire
-- longitudinale de ce que l'assistant avait déjà compris d'une séance.
--
-- ═══ POURQUOI PAS `app.live_insights` (007) ═══
-- Cette table existe et paraît proche. Elle ne convient pas : 014 la PURGE à
-- 90 jours, avec un motif explicite — « ce sont des suggestions, pas le
-- dossier ». Y ranger une mémoire longitudinale reviendrait à bâtir le résumé
-- du cas sur des lignes qui s'effacent toutes seules, et à découvrir le trou
-- trois mois plus tard sur un dossier ancien. Les sémantiques sont opposées :
-- une table est éphémère par contrat, l'autre doit durer.
--
-- ═══ CE QUE CETTE TABLE N'EST PAS ═══
-- Elle n'est PAS le dossier médical. La vérité clinique reste dans
-- `consultations.raw_notes`, `clinical_notes`, `diagnoses`, `prescriptions`.
-- Une analyse est DÉRIVÉE et régénérable ; sa perte ne détruirait aucune
-- donnée clinique. Elle reste en ajout-seul pour que chaque version produite
-- demeure auditable et comparable — et pour qu'aucune main, humaine ou non,
-- ne puisse réécrire après coup ce que l'assistant avait dit.
--
-- ═══ SÉCURITÉ — calquée sur 053, sans une ligne en moins ═══
-- · `practitioner_id` = QUI a fait générer (provenance affichée).
--   `patient_practitioner_id` = LE praticien du patient, copié par la porte :
--   CLÉ DE VISIBILITÉ de la RLS. Motif identique à 053 : `SELECT` sur
--   `app.patients` est révoqué aux appelants (ADR-019), une policy ne peut
--   donc pas joindre la table sans rouvrir un chemin direct. Et la copie ne
--   peut pas devenir fausse : `update_patient` exclut `practitioner_id` de son
--   allowlist par conception (020).
-- · RLS ENABLE + FORCE. AUCUNE policy assistante : la table n'existe pas pour
--   elle, même en SQL brut (motif 004 §7).
-- · SELECT/INSERT/UPDATE/DELETE révoqués à `authenticated` ET `service_role` :
--   tout passe par les portes, zéro chemin non tracé.
-- · `trg_audit` (013) : toute écriture tracée dans la MÊME transaction (règle 5).
--
-- ⚠️ RÈGLE 9 : aucune migration appliquée n'est retouchée. 067 n'ajoute.
--
-- Retour arrière (documentation, jamais exécuté automatiquement) :
--   DROP FUNCTION app.save_session_analysis(uuid,text,text,text,text,text);
--   DROP FUNCTION app.get_consultation_analysis(uuid);
--   DROP FUNCTION app.get_recent_session_analyses(uuid,integer);
--   DROP TABLE app.consultation_analyses;
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- `ALTER … OWNER TO app_gatekeeper` exige CREATE sur le schéma. Retiré en fin
-- de transaction (motif 065) : un rôle qui peut créer dans `app` pourrait y
-- planter une fonction masquant le catalogue dans le `search_path` des portes.
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ───────────────────────────────────────────────────────────────────────────
-- 1 · La table — ajout-seul, cloisonnée par LE PATIENT
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.consultation_analyses (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id              uuid NOT NULL REFERENCES app.cabinets(id),
    patient_id              uuid NOT NULL REFERENCES app.patients(id),
    consultation_id         uuid NOT NULL REFERENCES app.consultations(id),
    -- Provenance : QUI a fait générer cette version.
    practitioner_id         uuid NOT NULL REFERENCES app.profiles(id),
    -- Visibilité : LE praticien du patient, copié par la porte (voir en-tête).
    patient_practitioner_id uuid NOT NULL REFERENCES app.profiles(id),
    version                 integer NOT NULL,
    content                 jsonb NOT NULL,
    source_state            jsonb NOT NULL,
    model                   text NOT NULL,
    prompt_version          text NOT NULL,
    prompt_hash             text NOT NULL,
    generated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (consultation_id, version)
);

-- L'index sert la lecture longitudinale (`get_recent_session_analyses`), qui
-- est le chemin chaud : le résumé du cas la fait à chaque génération.
CREATE INDEX IF NOT EXISTS consultation_analyses_patient
    ON app.consultation_analyses (patient_id, generated_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · RLS — la clé est LE PATIENT, jamais le générateur
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE app.consultation_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.consultation_analyses FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consultation_analyses_clinical ON app.consultation_analyses;
CREATE POLICY consultation_analyses_clinical ON app.consultation_analyses
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet()
                 AND app.can_see_clinical(patient_practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet()
                 AND app.can_see_clinical(patient_practitioner_id));

REVOKE ALL ON app.consultation_analyses FROM authenticated, service_role;
GRANT SELECT, INSERT ON app.consultation_analyses TO app_gatekeeper;

DROP TRIGGER IF EXISTS trg_audit ON app.consultation_analyses;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON app.consultation_analyses
    FOR EACH ROW EXECUTE FUNCTION audit.track();

-- ───────────────────────────────────────────────────────────────────────────
-- 3 · La porte d'écriture — périmètre · verrou · transition · écriture · trace
-- ───────────────────────────────────────────────────────────────────────────
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

-- ───────────────────────────────────────────────────────────────────────────
-- 4 · Les portes de lecture
-- ───────────────────────────────────────────────────────────────────────────

-- Réhydrate l'écran à la réouverture d'une consultation : c'est CE manque qui
-- faisait « perdre » l'analyse au premier changement d'écran.
CREATE OR REPLACE FUNCTION app.get_consultation_analysis(p_consultation_id uuid)
RETURNS SETOF app.consultation_analyses
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  SELECT a.* FROM app.consultation_analyses a
   WHERE a.consultation_id = p_consultation_id
   ORDER BY a.version DESC
   LIMIT 1;
$$;

ALTER FUNCTION app.get_consultation_analysis(uuid) OWNER TO app_gatekeeper;
REVOKE ALL     ON FUNCTION app.get_consultation_analysis(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app.get_consultation_analysis(uuid) TO authenticated;

-- La mémoire longitudinale, plafonnée EN BASE. Une limite que l'appelant
-- choisirait sans borne est un export (même motif que `search_patients`).
-- L'ordre est déterministe jusqu'au départage par `id` : sans lui, deux
-- analyses écrites dans la même milliseconde sortiraient dans un ordre
-- instable, et deux générations du résumé sur les mêmes faits différeraient.
CREATE OR REPLACE FUNCTION app.get_recent_session_analyses(
    p_patient_id uuid,
    p_limit      integer DEFAULT 5)
RETURNS SETOF app.consultation_analyses
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  SELECT a.* FROM app.consultation_analyses a
   WHERE a.patient_id = p_patient_id
   ORDER BY a.generated_at DESC, a.id DESC
   LIMIT least(greatest(coalesce(p_limit, 5), 1), 20);
$$;

ALTER FUNCTION app.get_recent_session_analyses(uuid, integer) OWNER TO app_gatekeeper;
REVOKE ALL     ON FUNCTION app.get_recent_session_analyses(uuid, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app.get_recent_session_analyses(uuid, integer) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

-- PostgREST met son cache de schéma à jour sur notification. Sans elle, les
-- portes existeraient en base et resteraient introuvables par l'API.
NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('067_consultation_analyses')
  ON CONFLICT DO NOTHING;

COMMIT;
