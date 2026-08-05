-- 027_previous_note — S6. Lit la consultation antérieure du même patient.
--
-- ADDITIF PUR, sur le modèle exact de 026 §6 (`app.get_consultation`) : même
-- porte de lecture nominative, même schéma d'audit, même façon de nommer un
-- patient sans passer par `app.patients` en direct.
--
-- POURQUOI CETTE FONCTION EXISTE. `analyze_session` (S6, passerelle Deno) doit
-- comparer la séance en cours à la précédente — « sommeil : 5h le 12/07 → 3h
-- aujourd'hui ». Sans elle, la passerelle devrait requêter `app.consultations`
-- en direct, hors RLS auditée, exactement le chemin qu'ADR-019 a fermé.
--
-- ⚠️ `CREATE OR REPLACE` SEULEMENT — PAS DE `DROP`. La signature ne change
-- aucun défaut de paramètre par rapport à une version antérieure (il n'y en a
-- aucune), donc rien n'impose de supprimer avant de recréer. Un DROP sur une
-- fonction SECURITY DEFINER en emporte le propriétaire à la recréation
-- (rôle `postgres`, `rolbypassrls`) — la faute de 018, rejouée en 024/025 et
-- documentée en tête de 026 §4. Cette fonction est SECURITY DEFINER : elle
-- DOIT rester possédée par `app_gatekeeper`, jamais par `postgres`.
--
-- ⚠️ ÉCART ASSUMÉ AVEC LE PLAN S6 APPROUVÉ, QUI ESQUISSAIT `SECURITY INVOKER`.
-- Vérifié dans 020 §2 avant d'écrire une ligne : `audit.log_read` n'a EXECUTE
-- accordé qu'à `app_gatekeeper`, jamais à `authenticated` (017 §1, redit en
-- 018/020). Une fonction INVOKER appelée par une praticienne s'exécuterait
-- sous SON rôle et heurterait un 42501 au premier `PERFORM audit.log_read`.
-- DEFINER est donc la seule forme qui puisse journaliser, exactement pour la
-- raison qui a fait choisir DEFINER pour `app.get_consultation` (026 §6).
--
-- ZÉRO LIGNE SI AUCUNE CONSULTATION ANTÉRIEURE : ce n'est pas une erreur, c'est
-- « premier passage, rien à comparer ». La passerelle le lit comme tel.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · La porte de lecture — SECURITY DEFINER, comme app.get_consultation
-- ---------------------------------------------------------------------------
-- MÊME FORME QUE `app.get_consultation` (026 §6), volontairement : une
-- passerelle qui doit lire les deux ne réapprend pas une seconde convention de
-- colonnes. Pas de `raw_notes` ici : la note PRÉCÉDENTE compte pour la
-- comparaison, le brouillon de travail de l'ancienne séance n'a plus de sens
-- une fois la séance close.
--
-- DEUX TEMPS, MÊME ORDRE QU'EN 026 : on lit d'abord une clé technique (l'id de
-- la consultation antérieure, aucune identité), on journalise, PUIS on joint
-- `app.patients`. Une tentative sur un patient hors périmètre reste tracée
-- même si la RLS ne rend ensuite aucune ligne.
CREATE OR REPLACE FUNCTION app.get_previous_note(
  p_patient_id               uuid,
  p_excluding_consultation_id uuid)
RETURNS TABLE (
  id           uuid,
  started_at   timestamptz,
  note_id      uuid,
  note_status  app.note_status,
  subjective   text,
  objective    text,
  assessment   text,
  plan         text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_patient_id IS NULL THEN
    RETURN;   -- rien à comparer sans patient : pas une erreur, une absence.
  END IF;

  -- La consultation antérieure la plus récente du même patient, hors la
  -- séance en cours. `started_at <` d'abord ; en cas d'égalité (import, seed),
  -- `id <> p_excluding_consultation_id` départage sans favoriser une ligne au
  -- hasard de l'ordre de stockage.
  SELECT c.id INTO v_id
    FROM app.consultations c
   WHERE c.patient_id = p_patient_id
     AND c.id <> p_excluding_consultation_id
     AND c.status = 'closed'
   ORDER BY c.started_at DESC, c.id DESC
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;   -- aucune consultation antérieure : zéro ligne, pas une erreur.
  END IF;

  PERFORM audit.log_read(p_patient_id, 'fiche');

  RETURN QUERY
  SELECT c.id, c.started_at,
         n.id, n.status, n.subjective, n.objective, n.assessment, n.plan
    FROM app.consultations c
    LEFT JOIN app.clinical_notes n ON n.consultation_id = c.id
   WHERE c.id = v_id;
END;
$$;

ALTER FUNCTION app.get_previous_note(uuid, uuid) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.get_previous_note(uuid, uuid) IS
  'S6. La consultation CLOSE la plus récente d''un patient, hors la séance en '
  'cours. Zéro ligne si aucune antérieure : état normal, pas une erreur. Trace '
  '`fiche` AVANT toute lecture d''identité, comme app.get_consultation (026).';

-- ---------------------------------------------------------------------------
-- 2 · Qui peut franchir la porte
-- ---------------------------------------------------------------------------
-- Même raisonnement qu'en 026 §7 : `PUBLIC` reçoit EXECUTE par défaut sur toute
-- fonction neuve, `service_role` reste exclu par construction (il contourne la
-- RLS), donc une révocation explicite avant le seul GRANT voulu.
REVOKE ALL ON FUNCTION app.get_previous_note(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.get_previous_note(uuid, uuid) TO authenticated;

-- `app.get_previous_note` s'exécute sous `app_gatekeeper`, qui a déjà EXECUTE
-- sur `audit.log_read` depuis 020 §2 — aucun GRANT supplémentaire à poser ici.

-- PostgREST met son cache de schéma à jour sur notification.
NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('027_previous_note')
  ON CONFLICT DO NOTHING;

COMMIT;
