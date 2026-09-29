-- 117_confirmation_reverifiee — confirme une demande EN REVÉRIFIANT le créneau.
--
-- POURQUOI CETTE PORTE EXISTE. `confirm_appointment` (025) ne regarde que la
-- demande elle-même : deux confirmations concurrentes du même créneau (deux
-- patients, deux praticiennes, deux onglets) passent toutes les deux, et
-- l'agenda porte un double booking que personne n'a décidé. `check_slot`
-- (063) dit vrai AVANT le clic, pas PENDANT : entre les deux, le créneau
-- peut se remplir. Cette porte soude les trois temps en UNE transaction :
-- verrou (FOR UPDATE sur les rendez-vous actifs qui chevauchent le créneau
-- du même praticien — les concurrents s'y sérialisent) · re-lecture
-- (chevauchement demi-ouvert, mêmes états exclus que 063) · écriture
-- (requested→confirmed, `trg_audit` hérité) · trace.
--
-- INVOKER comme 022/025 : c'est la RLS qui décide du périmètre, jamais un
-- paramètre. Idempotente : confirmer deux fois (retry) rend true sans
-- seconde écriture. Seul `requested` avance ; le reste lève nommément.
-- La reprogrammation (update) garde sa porte 022 + pré-vérification 063 :
-- la contrainte EXCLUDE reste la dette documentée (jamais de vérif JS,
-- `docs/domains/agenda.md`).

BEGIN;

CREATE OR REPLACE FUNCTION app.confirmer_apres_reverification(p_appointment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_praticien uuid;
  v_debut     timestamptz;
  v_fin       timestamptz;
  v_statut    app.appt_status;
  v_conflits  integer;
BEGIN
  -- Cible, verrouillée. Hors périmètre RLS : introuvable, pas d'oracle (ADR-003).
  SELECT a.practitioner_id, a.starts_at, a.ends_at, a.status
    INTO v_praticien, v_debut, v_fin, v_statut
    FROM app.appointments a
   WHERE a.id = p_appointment_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Retry sans doublon : déjà confirmé, rien à réécrire.
  IF v_statut = 'confirmed' THEN
    RETURN true;
  END IF;
  IF v_statut <> 'requested' THEN
    RAISE EXCEPTION 'Seule une demande en attente peut être confirmée (état actuel : %).', v_statut;
  END IF;

  -- Verrou de sérialisation : les rendez-vous actifs du même praticien qui
  -- chevauchent ce créneau. Deux confirmations concurrentes du même créneau
  -- s'ordonnent ici — la seconde voit la première et lève.
  PERFORM 1
    FROM app.appointments a
   WHERE a.practitioner_id = v_praticien
     AND a.status NOT IN ('cancelled', 'no_show')
     AND a.id <> p_appointment_id
     AND a.starts_at < v_fin
     AND a.ends_at   > v_debut
     FOR UPDATE;

  -- Re-lecture APRÈS le verrou : le créneau a pu se remplir entre le
  -- `check_slot` de l'écran et cette transaction.
  SELECT count(*) INTO v_conflits
    FROM app.appointments a
   WHERE a.practitioner_id = v_praticien
     AND a.status NOT IN ('cancelled', 'no_show')
     AND a.id <> p_appointment_id
     AND a.starts_at < v_fin
     AND a.ends_at   > v_debut;
  IF v_conflits > 0 THEN
    RAISE EXCEPTION 'Créneau occupé : une confirmation concurrente l''a pris.';
  END IF;

  UPDATE app.appointments a SET
    status     = 'confirmed',
    updated_at = now()
   WHERE a.id = p_appointment_id;
  RETURN true;
END;
$$;

ALTER FUNCTION app.confirmer_apres_reverification(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.confirmer_apres_reverification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.confirmer_apres_reverification(uuid) TO authenticated;

COMMENT ON FUNCTION app.confirmer_apres_reverification(uuid) IS
  'Booking agent : confirme une demande en revérifiant le créneau sous verrou. '
  'Un seul gagnant par créneau ; retry idempotent.';

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('117_confirmation_reverifiee')
    ON CONFLICT DO NOTHING;

COMMIT;
