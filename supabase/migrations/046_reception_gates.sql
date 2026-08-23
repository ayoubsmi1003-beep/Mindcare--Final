-- 046_reception_gates — le poste d'accueil (cockpit assistante, D-08).
--
-- ═══ CE QUE CE FICHIER EST ════════════════════════════════════════════════
--
-- Les portes manquantes du front assistante, identifiées par le lot cockpit :
--
--   1. ARRIVÉE / ABSENT — l'enum `appt_status` porte `arrived` et `no_show`
--      depuis 002, la colonne `arrived_at` existe depuis 006, l'index
--      anti-double-réservation couvre déjà `arrived`. Il n'existait AUCUNE
--      porte qui y écrive : chaque transition est nommée ici, comme
--      `confirm_appointment` (025) et `cancel_appointment` (022).
--
--   2. LE TABLEAU DE BORD EN UN APPEL — PERF §3 (« un écran = un appel »).
--      `reception_board` rend la journée, la file des demandes et la file des
--      paiements en UNE réponse jsonb. Contrat de LECTURE ÉTROIT : les champs
--      opérationnels seulement, aucun champ clinique, aucun agrégat de
--      recette, aucune autorité tarifaire. Il ne remplace aucune porte de
--      domaine — les écritures restent dans leurs portes (022, 025, 029).
--
--   3. MARQUER UNE NOTIFICATION LUE — `notifications_mine` (011) autorise
--      l'UPDATE ; `DbPort` ne sait pas écrire. Une porte minuscule nomme le
--      geste.
--
--   4. LA RÉOUVERTURE DE D-13, ENCADRÉE — « l'assistante n'encaisse pas au
--      mois 1 » (D-13) était explicitement taguée « À rouvrir avec le front
--      assistante ». C'est ce lot. La réouverture est MINIMALE et VERROUILLÉE
--      par trois dispositifs indépendants :
--        · une policy FOR UPDATE ADDITIVE (011 reste ce qu'il est) dont le
--          USING exige : son cabinet, rôle assistant, paiement NON encaissé,
--          fenêtre 24 h identique à `pay_assistant` ;
--        · un déclencheur de COLONNES — la RLS filtre des lignes, jamais des
--          colonnes (leçon ADR-017) : une fois la policy posée, une assistante
--          pourrait muter `amount_dzd` ou `set_by` en PostgREST direct. Le
--          déclencheur refuse toute mutation de colonne protégée sous le rôle
--          assistant, quel que soit l'appelant — même motif que
--          `trg_appt_transition` (022) et `trg_note_immutable` (008) ;
--        · `WITH CHECK` force `collected_by = auth.uid()` : l'encaissement se
--          trace au nom de qui l'a réellement reçu.
--      La porte d'écriture RESTE `app.record_payment_collected` (029),
--      inchangée : verrou FOR UPDATE, heure serveur, idempotence. Aucun
--      second chemin d'écriture n'est créé.
--
-- ═══ CE QUE CE FICHIER NE FAIT PAS ════════════════════════════════════════
--
-- Il ne touche NI 004, NI 006, NI 008, NI 011, NI aucune policy existante.
-- Les deux objets D-13 sont ADDITIFS (policy neuve, déclencheur neuf).
-- Il ne crée ni table, ni colonne, ni valeur d'enum (règle 9).
-- `reception_board` ne teste aucun rôle : les policies de 006 et 011
-- décident des lignes sous lui, comme sous toute porte DEFINER possédée par
-- `app_gatekeeper` (sans BYPASSRLS, héritage INHERIT — 020/021).
--
-- L'AUDIT, ET LE BRUIT DE RAFRAÎCHISSEMENT. Le tableau se rafraîchit seul
-- (~120 s côté écran). Chaque appel écrit UNE ligne `liste`, patient_id NULL
-- — le patron exact de `list_agenda` : « un coup d'œil à la journée ne doit
-- pas se lire comme douze ouvertures de dossier ». Pas une trace par patient
-- nommé : le board est un agenda, pas un journal de caisse nominatif ;
-- `list_day_payments` (029) reste la porte nominative de référence.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Privilèges du porteur — ON NOMME AU LIEU D'HÉRITER (motif 022 §1)
-- ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

GRANT SELECT ON app.appointments TO app_gatekeeper;   -- déjà posé en 022, idempotent
GRANT SELECT ON app.patients     TO app_gatekeeper;   -- déjà posé en 020, idempotent
GRANT SELECT ON app.profiles     TO app_gatekeeper;   -- déjà posé en 022, idempotent

-- ---------------------------------------------------------------------------
-- 2 · Marquer arrivé — SECURITY INVOKER
-- ---------------------------------------------------------------------------
-- Transition nommée : `confirmed` → `arrived`. La RLS de 006 décide seule qui
-- peut franchir la porte (`appt_assistant` pour toutes praticiennes,
-- `appt_clinical` sur sa propre grille). Rejouée sur un RDV déjà arrivé, elle
-- rend son id SANS réécrire `arrived_at` — la première heure d'arrivée est la
-- seule qui vaille quelque chose pour chronométrer la salle d'attente, même
-- raisonnement que `collected_at` en 029 §3.
--
-- Le message distingue chaque refus parce que l'écran doit savoir POURQUOI son
-- geste n'a pas abouti — mais si la RLS masque la ligne, `v_statut` reste NULL
-- et le retour est NULL : introuvable et hors périmètre sont indiscernables
-- (ADR-003, motif `cancel_appointment`).
CREATE OR REPLACE FUNCTION app.mark_appointment_arrived(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_statut app.appt_status;
  v_id     uuid;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT a.status INTO v_statut FROM app.appointments a WHERE a.id = p_id;

  IF v_statut IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_statut = 'arrived' THEN
    RETURN p_id;
  END IF;

  IF v_statut <> 'confirmed' THEN
    RAISE EXCEPTION 'Seul un rendez-vous confirmé peut être marqué arrivé (état actuel : %).', v_statut
      USING HINT = 'Une séance démarrée, terminée, annulée ou non confirmée ne passe pas par l''arrivée.';
  END IF;

  UPDATE app.appointments a SET
    status      = 'arrived',
    arrived_at  = now(),        -- le temps du SERVEUR, jamais du poste
    updated_at  = now()
  WHERE a.id = p_id
  RETURNING a.id INTO v_id;

  -- La trace d'écriture est écrite par `trg_audit` (013), attaché à cette
  -- table : acteur, avant/après. Rien à réimplémenter ici.
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.mark_appointment_arrived(uuid) IS
  'Cockpit D-08. Transition confirmée→arrivée, SECURITY INVOKER : la RLS de 006 '
  'décide. Rejouée après coup, elle rend l''id sans réécrire arrived_at — '
  'l''heure réelle de l''arrivée chronomètre la salle d''attente.';

REVOKE ALL ON FUNCTION app.mark_appointment_arrived(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mark_appointment_arrived(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Marquer absent — SECURITY INVOKER
-- ---------------------------------------------------------------------------
-- Depuis `confirmed` (ne s'est jamais présenté) OU `arrived` (annoncé puis
-- resté dehors) — les deux sont des faits d'accueil. Depuis tout autre état,
-- refus explicite. `arrived_at` n'est PAS effacé : l'historique reste lisible
-- dans audit.log, le dossier est en ajout seul.
CREATE OR REPLACE FUNCTION app.mark_appointment_no_show(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_statut app.appt_status;
  v_id     uuid;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT a.status INTO v_statut FROM app.appointments a WHERE a.id = p_id;

  IF v_statut IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_statut = 'no_show' THEN
    RETURN p_id;
  END IF;

  IF v_statut NOT IN ('confirmed', 'arrived') THEN
    RAISE EXCEPTION 'Seul un rendez-vous confirmé ou arrivé peut être marqué absent (état actuel : %).', v_statut
      USING HINT = 'Le déclencheur de transitions refuserait de toute façon : le message dit pourquoi.';
  END IF;

  UPDATE app.appointments a SET
    status      = 'no_show',
    updated_at  = now()
  WHERE a.id = p_id
  RETURNING a.id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.mark_appointment_no_show(uuid) IS
  'Cockpit D-08. Transition confirmée|arrivée→absent, SECURITY INVOKER. '
  'arrived_at conservé : l''historique d''accueil reste auditable.';

REVOKE ALL ON FUNCTION app.mark_appointment_no_show(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mark_appointment_no_show(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · Marquer une notification lue — SECURITY INVOKER
-- ---------------------------------------------------------------------------
-- `notifications_mine` (011) limite déjà lignes et cabinet. Rejouée sur une
-- notification déjà lue, elle rend son id sans réécrire l'horodatage — même
-- discipline que `record_payment_collected`.
CREATE OR REPLACE FUNCTION app.mark_notification_read(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_lu   timestamptz;
  v_id   uuid;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT n.read_at, n.id INTO v_lu, v_id
    FROM app.notifications n
   WHERE n.id = p_id;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_lu IS NOT NULL THEN
    RETURN v_id;
  END IF;

  UPDATE app.notifications n SET
    read_at = now()
  WHERE n.id = p_id
    AND n.read_at IS NULL
  RETURNING n.id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.mark_notification_read(uuid) IS
  'Cockpit D-08. Pose read_at sur UNE notification visible par l''appelante '
  '(policy notifications_mine de 011). Rejouable sans réécrire l''horodatage.';

REVOKE ALL ON FUNCTION app.mark_notification_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mark_notification_read(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5 · Le tableau de bord en UN appel — SECURITY DEFINER, lecture étroite
-- ---------------------------------------------------------------------------
-- CONTRAT (figé ici, commenté champ par champ dans le service TS) :
--   { journee:[RDV du jour], demandes:[demandes web 60 j], paiements:[24 h] }
-- Champs RDV : ceux de list_agenda (022/025) MOINS rien — ils sont tous
-- administratifs ; `reason` n'existe pas dans la table depuis ADR-017.
-- Champs paiement : reçu, montant, méthode, horodatages, identité patient
-- permise à l'accueil (ADR-005 : statut & montant de paiement).
--
-- INTERDITS PAR CONCEPTION : diagnostic, note, motif, ordonnance, contenu de
-- séance, agrégats de recette (day_revenue reste LA source côté Finances),
-- toute écriture.
--
-- LA JOURNÉE EST CELLE DU CABINET : mêmes bornes locales qu'en 029 §4.
--
-- ⚠️ PAS DE `STABLE` : la porte écrit UNE trace d'audit (`log_read`) avant de
-- lire — comme `list_day_payments` (029), qui ne l'est pas davantage. Déclarer
-- `STABLE` une fonction qui écrit serait un mensonge au planificateur.
CREATE OR REPLACE FUNCTION app.reception_board(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_debut timestamptz;
  v_fin   timestamptz;
  v_resultat jsonb;
BEGIN
  IF p_day IS NULL THEN
    RETURN NULL;
  END IF;

  v_debut := p_day::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin   := (p_day + 1)::timestamp AT TIME ZONE 'Africa/Algiers';

  -- Trace AVANT toute lecture d'identité — une seule, contexte `liste`,
  -- patient_id NULL : c'est un coup d'œil à la journée, pas N ouvertures de
  -- dossier (motif list_agenda, 022 §2). Le rafraîchissement périodique de
  -- l'écran coûte donc ~1 ligne d'audit par passage, pas une par patient.
  PERFORM audit.log_read(NULL, 'liste');

  SELECT jsonb_build_object(
    'journee', COALESCE(
      (SELECT jsonb_agg(ligne ORDER BY ligne->>'starts_at')
         FROM (
           SELECT jsonb_build_object(
                    'id', a.id,
                    'starts_at', a.starts_at,
                    'ends_at', a.ends_at,
                    'status', a.status,
                    'source', a.source,
                    'kind', a.kind,
                    'notes_admin', a.notes_admin,
                    'arrived_at', a.arrived_at,
                    'patient_id', a.patient_id,
                    'record_number', pt.record_number,
                    'first_name', pt.first_name,
                    'last_name', pt.last_name,
                    'practitioner_id', a.practitioner_id,
                    'practitioner_name', pr.full_name
                  ) AS ligne
             FROM app.appointments a
             LEFT JOIN app.patients pt ON pt.id = a.patient_id
             LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
            WHERE a.starts_at >= v_debut
              AND a.starts_at <  v_fin
              AND a.status IN ('confirmed','arrived','in_session','completed','no_show')
         ) g),
      '[]'::jsonb),
    'demandes', COALESCE(
      (SELECT jsonb_agg(ligne ORDER BY ligne->>'starts_at')
         FROM (
           SELECT jsonb_build_object(
                    'id', a.id,
                    'starts_at', a.starts_at,
                    'ends_at', a.ends_at,
                    'status', a.status,
                    'source', a.source,
                    'kind', a.kind,
                    'notes_admin', a.notes_admin,
                    'arrived_at', a.arrived_at,
                    'patient_id', a.patient_id,
                    'record_number', pt.record_number,
                    'first_name', pt.first_name,
                    'last_name', pt.last_name,
                    'practitioner_id', a.practitioner_id,
                    'practitioner_name', pr.full_name
                  ) AS ligne
             FROM app.appointments a
             LEFT JOIN app.patients pt ON pt.id = a.patient_id
             LEFT JOIN app.profiles pr ON pr.id = a.practitioner_id
            WHERE a.status = 'requested'
              AND a.starts_at >= v_debut
              AND a.starts_at <  v_debut + interval '60 days'
         ) g),
      '[]'::jsonb),
    'paiements', COALESCE(
      (SELECT jsonb_agg(ligne ORDER BY ligne->>'created_at' DESC)
         FROM (
           SELECT jsonb_build_object(
                    'payment_id', pm.id,
                    'receipt_number', pm.receipt_number,
                    'amount_dzd', pm.amount_dzd,
                    'method', pm.method,
                    'set_at', pm.created_at,
                    'collected_at', pm.collected_at,
                    'patient_id', pm.patient_id,
                    'record_number', pt.record_number,
                    'first_name', pt.first_name,
                    'last_name', pt.last_name,
                    'practitioner_id', pm.practitioner_id,
                    'practitioner_name', pr.full_name
                  ) AS ligne
             FROM app.payments pm
             LEFT JOIN app.patients pt ON pt.id = pm.patient_id
             LEFT JOIN app.profiles pr ON pr.id = pm.practitioner_id
            WHERE pm.created_at > now() - interval '24 hours'
         ) g),
      '[]'::jsonb),
    'genere_a', now()
  )
  INTO v_resultat;

  RETURN v_resultat;
END;
$$;

ALTER FUNCTION app.reception_board(date) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.reception_board(date) IS
  'Cockpit D-08, PERF §3 : TOUT le tableau d''accueil en UN appel. Lecture '
  'étroite : RDV opérationnels du jour + demandes web + paiements 24 h. '
  'Aucun champ clinique, aucun agrégat de recette, aucune écriture. Une trace '
  '`liste` par appel, patient_id NULL (patron list_agenda) — le '
  'rafraîchissement automatique ne noie pas audit.log.';

REVOKE ALL ON FUNCTION app.reception_board(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reception_board(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6 · Réouverture encadrée de D-13 — policy additive
-- ---------------------------------------------------------------------------
-- ⚠️ ADDITIF PUR : `pay_owner`, `pay_practitioner`, `pay_assistant` de 011 ne
-- changent pas d'un octet. Les policies permissives se combinent en OU : cette
-- policy OUVRE l'UPDATE là où 011 n'ouvrait que le SELECT.
--
-- USING décide quelles lignes existent pour l'assistante : SON cabinet, NON
-- encore encaissées, fenêtre 24 h IDENTIQUE à `pay_assistant` — le périmètre
-- pensé par 01-SCHEMA §10.1, ni plus ni moins.
--
-- WITH CHECK verrouille la ligne résultante : `collected_by` DOIT être
-- l'appelante. Un PATCH direct qui attribuerait l'encaissement à quelqu'un
-- d'autre est refusé ici, et le déclencheur §7 le redouble.
CREATE POLICY pay_assistant_encaissement ON app.payments FOR UPDATE TO authenticated
    USING (cabinet_id = app.current_cabinet()
           AND app.current_role() = 'assistant'
           AND collected_at IS NULL
           AND created_at > now() - interval '24 hours')
    WITH CHECK (cabinet_id = app.current_cabinet()
                AND app.current_role() = 'assistant'
                AND collected_by IS NOT DISTINCT FROM auth.uid());

COMMENT ON POLICY pay_assistant_encaissement ON app.payments IS
  'Réouverture encadrée de D-13 (lot cockpit D-08) : l''assistante ENCAISSE un '
  'paiement déjà tarifé, dans la fenêtre 24 h de pay_assistant, au nom de qui '
  'elle est. Elle ne fixe ni ne modifie un montant — le déclencheur '
  'trg_pay_guard ferme les colonnes, car la RLS filtre des lignes, pas des '
  'colonnes.';

-- ---------------------------------------------------------------------------
-- 7 · Déclencheur de colonnes — le mur que la RLS ne sait pas écrire
-- ---------------------------------------------------------------------------
-- LA LEÇON D'ADR-017, TRANSPPOSÉE AUX PAIEMENTS. La RLS filtre des LIGNES.
-- Dès que la policy ci-dessus laisse passer l'UPDATE, un PATCH PostgREST
-- direct pourrait porter n'importe quelle colonne : `amount_dzd` à 0,
-- `set_by` réattribué, `receipt_number` réécrit. Aucun privilège de colonne
-- ne ferme ça proprement ici : owner et assistante partagent le rôle
-- `authenticated`, et un GRANT de colonnes à `authenticated` donne les mêmes
-- colonnes aux deux.
--
-- La règle vit donc SUR LA TABLE (règle 4), comme `trg_appt_transition` :
-- sous le rôle assistant, les colonnes du TARIF et du RATTACHEMENT sont
-- gelées, et l'encaissement se trace au nom de qui l'a reçu. Tout autre rôle
-- passe sans être regardé : `set_consultation_price` (029) garde sa voie de
-- correction avant encaissement.
CREATE OR REPLACE FUNCTION app.assert_payment_columns_for_assistant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_catalog
AS $$
BEGIN
  IF app.current_role() = 'assistant' THEN
    IF NEW.amount_dzd      IS DISTINCT FROM OLD.amount_dzd
       OR NEW.set_by       IS DISTINCT FROM OLD.set_by
       OR NEW.receipt_number IS DISTINCT FROM OLD.receipt_number
       OR NEW.patient_id   IS DISTINCT FROM OLD.patient_id
       OR NEW.consultation_id IS DISTINCT FROM OLD.consultation_id
       OR NEW.practitioner_id IS DISTINCT FROM OLD.practitioner_id
       OR NEW.cabinet_id   IS DISTINCT FROM OLD.cabinet_id
       OR NEW.method       IS DISTINCT FROM OLD.method THEN
      RAISE EXCEPTION 'Le montant d''un paiement appartient à qui a conduit la séance.'
        USING HINT = 'L''assistante encaisse un tarif déjà fixé ; elle ne le fixe ni ne le corrige.';
    END IF;

    IF NEW.collected_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'L''encaissement se trace au nom de qui l''a réellement reçu.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION app.assert_payment_columns_for_assistant() IS
  'D-13 réouvert, volet colonnes : sous le rôle assistant, montant, tarif, '
  'reçu et rattachements sont gelés (la RLS filtre des lignes, pas des '
  'colonnes — leçon ADR-017), et collected_by vaut auth.uid(). Les autres '
  'rôles passent inchangés.';

DROP TRIGGER IF EXISTS trg_pay_guard ON app.payments;
CREATE TRIGGER trg_pay_guard
  BEFORE UPDATE ON app.payments
  FOR EACH ROW EXECUTE FUNCTION app.assert_payment_columns_for_assistant();

-- ---------------------------------------------------------------------------
-- 8 · Refermer
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('046_reception_gates')
  ON CONFLICT DO NOTHING;

COMMIT;
