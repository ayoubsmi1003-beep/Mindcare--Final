-- 024_consultation_kind — le type de consultation entre au schéma.
--
-- ═══ POURQUOI CE FICHIER N'EXISTAIT PAS EN 022 ════════════════════════════
--
-- S4 a été livré SANS ce champ, délibérément : la colonne n'existait pas et la
-- liste réellement employée par la praticienne n'avait pas été fournie.
-- Inventer « première consultation / suivi / urgence » aurait fabriqué une
-- taxonomie clinique dans un dossier médical — le genre de donnée que personne
-- ne relit parce qu'elle a l'air juste (I19). Les treize valeurs ci-dessous
-- viennent du cabinet, pas de nous.
--
-- ⚠️ `kind` N'EST PAS `source`, ET LES CONFONDRE EST LA FAUTE À ÉVITER ICI.
-- `source` (`app.appt_source`) dit par quel CANAL le rendez-vous est entré —
-- téléphone, sans rendez-vous, web, assistante, praticienne. `kind` dit ce
-- qu'on va FAIRE pendant la séance. Deux colonnes, deux questions.
--
-- ═══ NULLABLE, ET C'EST UNE DÉCISION ══════════════════════════════════════
--
-- `NOT NULL` aurait imposé un backfill sur les rendez-vous existants, donc
-- d'ATTRIBUER un type à des séances déjà planifiées dont personne ne connaît la
-- nature. Une valeur inventée dans une colonne clinique vaut moins que rien :
-- elle a l'air d'une donnée. La colonne est nullable, l'écran affiche
-- « Non renseigné », et c'est honnête.
--
-- ═══ CE QUE `kind` N'EST PAS ══════════════════════════════════════════════
--
-- Ce n'est PAS le motif de consultation. `reason` vit dans
-- `app.appointment_reasons`, sans policy assistante (ADR-017), parce qu'il
-- décrit la plainte du patient. `kind` décrit la MODALITÉ de la séance :
-- l'assistante en a besoin pour tenir l'agenda — une thérapie de groupe et un
-- renouvellement d'ordonnance n'occupent pas le même créneau. Il est donc
-- exposé à tous les rôles, y compris dans `appointments_admin`.
--
-- Un doute demeure et il est écrit ici plutôt que tranché en silence :
-- `evaluation_psychiatrique` et `bilan_psychologique` disent quelque chose du
-- patient, pas seulement de l'organisation. Ils restent visibles de
-- l'assistante parce qu'elle doit les planifier, et parce que le mur d'ADR-017
-- porte sur le MOTIF. Si le cabinet juge que ces deux valeurs sont déjà une
-- information clinique, elles se déplaceront dans une table sœur — c'est une
-- décision à prendre avec la praticienne, pas ici.

BEGIN;

CREATE TYPE app.consult_kind AS ENUM (
  'premiere_consultation',
  'suivi',
  'psychotherapie_individuelle',
  'therapie_couple',
  'therapie_familiale',
  'therapie_groupe',
  'teleconsultation',
  'certificat_medical',
  'renouvellement_ordonnance',
  'evaluation_psychiatrique',
  'bilan_psychologique',
  'entretien_famille',
  'entretien_tiers'
);

ALTER TABLE app.appointments ADD COLUMN IF NOT EXISTS kind app.consult_kind;

COMMENT ON COLUMN app.appointments.kind IS
  'Type de consultation (ADR-021, migration 024). Valeurs fournies par le '
  'cabinet, jamais inventées. NULLABLE : les rendez-vous antérieurs à cette '
  'migration n''ont pas de type connu, et lui en attribuer un serait une '
  'donnée fabriquée. Distinct de `source` (canal) et de `reason` (motif, '
  'ADR-017, invisible à l''assistante).';

-- ---------------------------------------------------------------------------
-- 1 · La vue administrative suit
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` n'autorise QUE l'ajout de colonnes EN FIN de liste ;
-- toute autre modification exige un DROP. D'où `kind` en dernier, et non à côté
-- de `source` où il serait mieux placé à la lecture. Contrainte de Postgres,
-- pas un oubli.
CREATE OR REPLACE VIEW app.appointments_admin WITH (security_invoker = true) AS
SELECT id, cabinet_id, practitioner_id, patient_id, pending_patient_id,
       starts_at, ends_at, status, source, notes_admin, arrived_at, created_at,
       kind
FROM app.appointments;

-- ---------------------------------------------------------------------------
-- 2 · Les portes de lecture rendent `kind`
-- ---------------------------------------------------------------------------
-- ⚠️ `CREATE OR REPLACE FUNCTION` NE PEUT PAS CHANGER UN TYPE DE RETOUR. Une
-- fonction `RETURNS TABLE` dont on ajoute une colonne doit être SUPPRIMÉE puis
-- recréée — et la propriété (`app_gatekeeper`) comme les privilèges sont perdus
-- avec elle. Les deux sont donc reposés ci-dessous. Les oublier laisserait la
-- migration verte et la fonction en 42501 à l'exécution, ou pire : possédée par
-- `postgres`, c'est-à-dire par un rôle `rolbypassrls` — la faute exacte de 018,
-- que le contrôle 14 du checkpoint S4 attraperait.
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

DROP FUNCTION IF EXISTS app.list_agenda(timestamptz, timestamptz, uuid);
CREATE FUNCTION app.list_agenda(
  p_from         timestamptz,
  p_to           timestamptz,
  p_practitioner uuid DEFAULT NULL)
RETURNS TABLE (
  id                uuid,
  starts_at         timestamptz,
  ends_at           timestamptz,
  status            app.appt_status,
  source            app.appt_source,
  kind              app.consult_kind,
  notes_admin       text,
  arrived_at        timestamptz,
  patient_id        uuid,
  record_number     text,
  first_name        text,
  last_name         text,
  practitioner_id   uuid,
  practitioner_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'Plage d''agenda invalide : la borne haute doit suivre la borne basse.';
  END IF;

  IF p_to - p_from > interval '62 days' THEN
    RAISE EXCEPTION 'Plage d''agenda trop large : 62 jours au maximum.'
      USING HINT = 'Une plage sans limite n''est pas un agenda, c''est un export.';
  END IF;

  PERFORM audit.log_read(NULL, 'liste');

  RETURN QUERY
  SELECT a.id, a.starts_at, a.ends_at, a.status, a.source, a.kind, a.notes_admin,
         a.arrived_at,
         p.id, p.record_number, p.first_name, p.last_name,
         a.practitioner_id, pr.full_name
  FROM app.appointments a
  LEFT JOIN app.patients p ON p.id = a.patient_id
  LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
  WHERE a.starts_at >= p_from
    AND a.starts_at <  p_to
    AND (p_practitioner IS NULL OR a.practitioner_id = p_practitioner)
  ORDER BY a.starts_at, a.id;
END;
$$;

ALTER FUNCTION app.list_agenda(timestamptz, timestamptz, uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_agenda(timestamptz, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_agenda(timestamptz, timestamptz, uuid) TO authenticated;

COMMENT ON FUNCTION app.list_agenda(timestamptz, timestamptz, uuid) IS
  'ADR-021. Seule porte vers un agenda nominatif. Une ligne d''audit par appel, '
  'contexte `liste`, patient_id NULL. N''expose jamais `reason` (ADR-017).';

DROP FUNCTION IF EXISTS app.get_appointment(uuid);
CREATE FUNCTION app.get_appointment(p_id uuid)
RETURNS TABLE (
  id                uuid,
  starts_at         timestamptz,
  ends_at           timestamptz,
  status            app.appt_status,
  source            app.appt_source,
  kind              app.consult_kind,
  notes_admin       text,
  arrived_at        timestamptz,
  patient_id        uuid,
  record_number     text,
  first_name        text,
  last_name         text,
  practitioner_id   uuid,
  practitioner_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_patient uuid;
BEGIN
  SELECT a.patient_id INTO v_patient FROM app.appointments a WHERE a.id = p_id;

  PERFORM audit.log_read(v_patient, 'liste');

  RETURN QUERY
  SELECT a.id, a.starts_at, a.ends_at, a.status, a.source, a.kind, a.notes_admin,
         a.arrived_at,
         p.id, p.record_number, p.first_name, p.last_name,
         a.practitioner_id, pr.full_name
  FROM app.appointments a
  LEFT JOIN app.patients p ON p.id = a.patient_id
  LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
  WHERE a.id = p_id;
END;
$$;

ALTER FUNCTION app.get_appointment(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_appointment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_appointment(uuid) TO authenticated;

COMMENT ON FUNCTION app.get_appointment(uuid) IS
  'ADR-021. Détail nominatif d''un rendez-vous. Trace `liste` avec patient_id.';

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 3 · Les portes d'écriture acceptent `kind`
-- ---------------------------------------------------------------------------
-- ⚠️ ON SUPPRIME L'ANCIENNE SIGNATURE. Ajouter un paramètre à valeur par défaut
-- crée une SURCHARGE, pas un remplacement : deux fonctions coexisteraient et un
-- appel par arguments nommés pourrait résoudre vers l'ancienne — celle qui
-- ignore le type de consultation, silencieusement.
DROP FUNCTION IF EXISTS app.create_appointment(uuid, uuid, timestamptz, integer, text);

CREATE FUNCTION app.create_appointment(
  p_patient_id       uuid,
  p_practitioner_id  uuid,
  p_starts_at        timestamptz,
  p_duration_minutes integer,
  p_notes_admin      text DEFAULT NULL,
  p_kind             app.consult_kind DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_id     uuid;
  v_source app.appt_source;
BEGIN
  IF p_patient_id IS NULL OR p_practitioner_id IS NULL OR p_starts_at IS NULL THEN
    RAISE EXCEPTION 'Rendez-vous incomplet : patient, praticien et date sont requis.';
  END IF;

  IF p_duration_minutes IS NULL OR p_duration_minutes < 5 OR p_duration_minutes > 240 THEN
    RAISE EXCEPTION 'Durée hors bornes : de 5 à 240 minutes.';
  END IF;

  v_source := CASE WHEN app.current_role() = 'assistant' THEN 'assistant' ELSE 'doctor' END;

  INSERT INTO app.appointments (cabinet_id, practitioner_id, patient_id,
                                starts_at, ends_at, status, source, kind,
                                notes_admin, created_by, is_synthetic)
  VALUES (app.current_cabinet(), p_practitioner_id, p_patient_id,
          p_starts_at, p_starts_at + make_interval(mins => p_duration_minutes),
          'confirmed', v_source, p_kind,
          nullif(btrim(coalesce(p_notes_admin, '')), ''), auth.uid(),
          -- Dérivé de l'environnement, jamais déclaré par l'appelant (023).
          app.is_cloud_dev())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION app.create_appointment(uuid, uuid, timestamptz, integer, text, app.consult_kind) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_appointment(uuid, uuid, timestamptz, integer, text, app.consult_kind) TO authenticated;

COMMENT ON FUNCTION app.create_appointment(uuid, uuid, timestamptz, integer, text, app.consult_kind) IS
  'ADR-021. SECURITY INVOKER : aucune élévation. `cabinet_id` vient de la '
  'session, `source` du rôle, `is_synthetic` de l''environnement — aucune de ces '
  'trois valeurs n''est choisie par l''appelant.';

-- `kind` rejoint l'allowlist de modification. `patient_id`, `practitioner_id`,
-- `cabinet_id` et `status` en restent exclus : réattribuer un rendez-vous
-- contournerait la cloison ADR-003 par une modification de routine.
CREATE OR REPLACE FUNCTION app.update_appointment(p_id uuid, p_changes text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  k          text;
  v_duration integer;
  v_id       uuid;
  v_changes  jsonb := nullif(btrim(coalesce(p_changes, '')), '')::jsonb;
  allowed constant text[] := ARRAY['starts_at', 'duration_minutes', 'notes_admin', 'kind'];
BEGIN
  IF v_changes IS NULL OR jsonb_typeof(v_changes) <> 'object' THEN
    RAISE EXCEPTION 'Charge de modification invalide : un objet JSON est attendu.';
  END IF;

  FOREACH k IN ARRAY ARRAY(SELECT jsonb_object_keys(v_changes)) LOOP
    IF NOT (k = ANY (allowed)) THEN
      RAISE EXCEPTION 'Champ non modifiable par cette porte : %.', k
        USING HINT = 'patient_id, practitioner_id, cabinet_id et status sont exclus par conception.';
    END IF;
  END LOOP;

  IF v_changes ? 'duration_minutes' THEN
    v_duration := (v_changes->>'duration_minutes')::integer;
    IF v_duration IS NULL OR v_duration < 5 OR v_duration > 240 THEN
      RAISE EXCEPTION 'Durée hors bornes : de 5 à 240 minutes.';
    END IF;
  END IF;

  UPDATE app.appointments a SET
    starts_at   = CASE WHEN v_changes ? 'starts_at'
                       THEN (v_changes->>'starts_at')::timestamptz ELSE a.starts_at END,
    ends_at     = CASE WHEN v_changes ? 'starts_at'
                       THEN (v_changes->>'starts_at')::timestamptz ELSE a.starts_at END
                  + make_interval(mins => coalesce(v_duration,
                      (extract(epoch FROM (a.ends_at - a.starts_at)) / 60)::integer)),
    notes_admin = CASE WHEN v_changes ? 'notes_admin'
                       THEN nullif(btrim(coalesce(v_changes->>'notes_admin', '')), '')
                       ELSE a.notes_admin END,
    -- Une clé absente ne change rien, une clé à `null` efface le type. Le
    -- second cas est légitime : un rendez-vous mal typé doit pouvoir redevenir
    -- « non renseigné » plutôt que de garder une valeur fausse.
    kind        = CASE WHEN v_changes ? 'kind'
                       THEN (v_changes->>'kind')::app.consult_kind
                       ELSE a.kind END,
    updated_at  = now()
  WHERE a.id = p_id
  RETURNING a.id INTO v_id;

  RETURN v_id;
END;
$$;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('024_consultation_kind')
  ON CONFLICT DO NOTHING;

COMMIT;
