-- 181_agenda_contact_phone — expose le téléphone opérationnel à l'accueil.
--
-- POURQUOI. Une demande web arrive sans dossier patient validé : l'accueil doit
-- appeler la personne avant de fixer le créneau. `app.list_agenda` et
-- `app.get_appointment` rendaient le nom et le numéro de dossier, jamais le
-- téléphone — l'écran de traitement ne pouvait donc pas remplir sa fonction.
-- `phone` existe déjà sur `app.patients` : ce n'est ni une colonne ni une table
-- nouvelle, seulement un champ opérationnel de plus dans deux portes de lecture
-- déjà journalisées. Aucune donnée clinique n'est ajoutée, `reason` reste
-- absent (ADR-017), et les policies de 006/022 ne changent pas.
--
-- ⚠️ `CREATE OR REPLACE` ne peut pas changer un type de retour : les deux
-- fonctions sont recréées, puis re-propriétées et re-grantées à l'identique.
BEGIN;

DROP FUNCTION IF EXISTS app.list_agenda(timestamptz, timestamptz, uuid, text[]);

CREATE FUNCTION app.list_agenda(
  p_from         timestamptz,
  p_to           timestamptz,
  p_practitioner uuid   DEFAULT NULL,
  p_statuts      text[] DEFAULT NULL)
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
  phone             text,
  practitioner_id   uuid,
  practitioner_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_statuts app.appt_status[];
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'Plage d''agenda invalide : la borne haute doit suivre la borne basse.';
  END IF;

  IF p_to - p_from > interval '62 days' THEN
    RAISE EXCEPTION 'Plage d''agenda trop large : 62 jours au maximum.'
      USING HINT = 'Une plage sans limite n''est pas un agenda, c''est un export.';
  END IF;

  IF p_statuts IS NOT NULL AND array_length(p_statuts, 1) IS NOT NULL THEN
    v_statuts := p_statuts::app.appt_status[];
  END IF;

  PERFORM audit.log_read(NULL, 'liste');

  RETURN QUERY
  SELECT a.id, a.starts_at, a.ends_at, a.status, a.source, a.kind, a.notes_admin,
         a.arrived_at,
         p.id, p.record_number, p.first_name, p.last_name, p.phone,
         a.practitioner_id, pr.full_name
  FROM app.appointments a
  LEFT JOIN app.patients p ON p.id = a.patient_id
  LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
  WHERE a.starts_at >= p_from
    AND a.starts_at <  p_to
    AND (p_practitioner IS NULL OR a.practitioner_id = p_practitioner)
    AND (v_statuts IS NULL OR a.status = ANY (v_statuts))
  ORDER BY a.starts_at, a.id;
END;
$$;

ALTER FUNCTION app.list_agenda(timestamptz, timestamptz, uuid, text[]) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_agenda(timestamptz, timestamptz, uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_agenda(timestamptz, timestamptz, uuid, text[]) TO authenticated;

COMMENT ON FUNCTION app.list_agenda(timestamptz, timestamptz, uuid, text[]) IS
  'ADR-021. Agenda nominatif + téléphone opérationnel pour le rappel. '
  '`p_statuts` est un FILTRE DE VUE, jamais une protection. Une ligne d''audit '
  'par appel, contexte `liste`; `reason` reste absent (ADR-017).';

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
  phone             text,
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
         p.id, p.record_number, p.first_name, p.last_name, p.phone,
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
  'ADR-021. Détail nominatif + téléphone opérationnel. Trace `liste` avec patient_id.';

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('181_agenda_contact_phone')
  ON CONFLICT DO NOTHING;

COMMIT;
