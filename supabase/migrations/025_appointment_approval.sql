-- 025_appointment_approval — l'assistante approuve, la praticienne consulte.
--
-- ═══ LA RÈGLE DEMANDÉE, ET CE QU'ELLE EST EXACTEMENT ══════════════════════
--
-- « La praticienne ne voit que les rendez-vous approuvés par l'assistante. »
--
-- C'est un FILTRE DE VUE, pas un mur de confidentialité, et la distinction a
-- été tranchée explicitement. Conséquences, écrites pour qu'on ne les
-- redécouvre pas plus tard :
--
--   · AUCUNE policy de 006 n'est modifiée. La couche sécurité reste gelée
--     (Q-D). Une demande `requested` est toujours LISIBLE par la praticienne —
--     elle n'occupe simplement pas sa grille tant qu'elle n'est pas confirmée.
--
--   · Ce n'est donc PAS une protection, et il ne faut pas le présenter comme
--     telle. Si la règle devenait « la praticienne ne DOIT PAS pouvoir lire une
--     demande non approuvée », il faudrait réécrire `appt_clinical` — et cela
--     créerait un cas où la Dr. Larbi, propriétaire du cabinet, serait aveugle
--     à une demande concernant sa propre patiente. Rejeté pour cette raison.
--
--   · Le filtre vit dans la porte de lecture, `app.list_agenda`, par un
--     paramètre. Pas dans le front : un filtre écrit en TypeScript ne
--     s'appliquerait qu'aux appelants qui y pensent, donc pas à Jarvis ni au
--     futur front assistante.
--
-- ═══ LA TRANSITION ════════════════════════════════════════════════════════
--
-- `requested` → `confirmed` est le geste d'approbation. Il a sa propre porte,
-- comme l'annulation, et pour la même raison : `status` est exclu de
-- l'allowlist de `update_appointment`, donc aucune transition ne peut se faire
-- par une modification de routine. Chaque changement d'état passe par une
-- fonction qui le nomme.
--
-- ⚠️ D'OÙ VIENNENT LES DEMANDES `requested`, ET POURQUOI LA FILE EST VIDE
-- AUJOURD'HUI. `app.create_appointment` pose `confirmed` : un rendez-vous saisi
-- AU CABINET — par l'assistante ou par une praticienne — est déjà approuvé par
-- le geste qui le crée. Faire passer l'assistante par une approbation de ce
-- qu'elle vient elle-même de saisir serait une cérémonie sans contenu.
--
-- L'état `requested` est celui de la DEMANDE WEB (`source = 'web'`,
-- `pending_patient_id`), flux qui n'est pas construit. La file « Demandes en
-- attente » sera donc honnêtement VIDE tant que l'accueil QR n'existe pas, et
-- l'écran le dira au lieu d'afficher un compteur inventé (I19).
--
-- Si le cabinet veut au contraire qu'un rendez-vous saisi par l'assistante
-- attende l'aval de la praticienne, c'est UNE LIGNE à changer dans
-- `create_appointment` — mais c'est une décision d'organisation du cabinet, pas
-- une décision technique, et elle n'a pas été prise.
--
-- QUI PEUT APPROUVER : la RLS, et elle seule. `app.confirm_appointment` est
-- `SECURITY INVOKER` et ne teste aucun rôle. En pratique l'assistante (policy
-- `appt_assistant`) et les praticiennes sur leur propre agenda (policy
-- `appt_clinical`) le peuvent — ce qui est voulu : l'assistante n'est pas
-- toujours là, et une demande bloquée faute d'approbatrice serait un patient
-- qui ne vient pas.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · La porte d'approbation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.confirm_appointment(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_statut app.appt_status;
  v_id     uuid;
BEGIN
  -- Lecture avant écriture pour rendre un message utile. Si la RLS masque la
  -- ligne, `v_statut` reste NULL, l'UPDATE ne touche rien, et on rend NULL —
  -- que l'appelant lit comme « introuvable », sans distinguer l'inexistant du
  -- hors-périmètre.
  SELECT a.status INTO v_statut FROM app.appointments a WHERE a.id = p_id;

  IF v_statut IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_statut <> 'requested' THEN
    RAISE EXCEPTION 'Seule une demande en attente peut être confirmée (état actuel : %).', v_statut
      USING HINT = 'Un rendez-vous déjà confirmé, arrivé, terminé ou annulé ne se confirme pas.';
  END IF;

  UPDATE app.appointments a SET
    status     = 'confirmed',
    updated_at = now()
  WHERE a.id = p_id
  RETURNING a.id INTO v_id;

  -- L'audit de l'écriture est hérité de `trg_audit` (013) : l'approbation
  -- laisse une trace nominative avec son acteur, sans qu'on la réimplémente.
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION app.confirm_appointment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.confirm_appointment(uuid) TO authenticated;

COMMENT ON FUNCTION app.confirm_appointment(uuid) IS
  'ADR-021. Approbation d''une demande de rendez-vous. `status` étant exclu de '
  'l''allowlist d''update_appointment, c''est la seule voie vers `confirmed` — '
  'aucune transition ne se fait par une modification de routine.';

-- ---------------------------------------------------------------------------
-- 2 · Le filtre d'état, dans la porte de lecture
-- ---------------------------------------------------------------------------
-- `p_statuts` est un TABLEAU DE TEXTE, pas d'`app.appt_status`. PostgREST
-- sérialise mal un tableau de type énuméré personnalisé, et la conversion
-- échouerait à l'exécution avec un message qui ne dit pas pourquoi. Le cast est
-- fait ICI, une fois, sur une valeur dont l'ensemble admissible est fermé par
-- l'énumération elle-même : une valeur inconnue lève, elle ne passe pas.
--
-- NULL = aucun filtre. C'est ce que demande l'écran de détail, qui doit
-- pouvoir afficher un rendez-vous quel que soit son état.
DROP FUNCTION IF EXISTS app.list_agenda(timestamptz, timestamptz, uuid);

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

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
         p.id, p.record_number, p.first_name, p.last_name,
         a.practitioner_id, pr.full_name
  FROM app.appointments a
  LEFT JOIN app.patients p ON p.id = a.patient_id
  LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
  WHERE a.starts_at >= p_from
    AND a.starts_at <  p_to
    AND (p_practitioner IS NULL OR a.practitioner_id = p_practitioner)
    -- LE FILTRE N'EST PAS UNE PROTECTION, et cette ligne est le seul endroit
    -- où l'écrire. La RLS a déjà décidé quelles LIGNES existent pour
    -- l'appelant ; ceci ne fait que choisir lesquelles il regarde maintenant.
    AND (v_statuts IS NULL OR a.status = ANY (v_statuts))
  ORDER BY a.starts_at, a.id;
END;
$$;

ALTER FUNCTION app.list_agenda(timestamptz, timestamptz, uuid, text[]) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_agenda(timestamptz, timestamptz, uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_agenda(timestamptz, timestamptz, uuid, text[]) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

COMMENT ON FUNCTION app.list_agenda(timestamptz, timestamptz, uuid, text[]) IS
  'ADR-021. Seule porte vers un agenda nominatif. `p_statuts` est un FILTRE DE '
  'VUE, jamais une protection : la RLS de 006 a déjà décidé quelles lignes '
  'existent pour l''appelant. Une ligne d''audit par appel, contexte `liste`.';

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('025_appointment_approval')
  ON CONFLICT DO NOTHING;

COMMIT;
