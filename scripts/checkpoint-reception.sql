-- checkpoint-reception.sql — lot COCKPIT (D-08). La vérité des portes 046,
-- la réouverture ENCADRÉE de D-13, et la non-régression de la cloison.
--
--   docker run --rm -i -e PGURL="$DATABASE_URL" postgres:15 \
--     sh -c 'psql "$PGURL" -f -' < scripts/checkpoint-reception.sql
--
-- ⚠️ TOUT SE PASSE DANS UNE TRANSACTION ANNULÉE — fixtures posées sous le rôle
-- de connexion, impersonation par `SET LOCAL ROLE authenticated` +
-- `SET request.jwt.claim.sub` (voie de checkpoint-v2-rls / v6-finance),
-- ROLLBACK final. Rien n'entre dans les données livrées (règle 8).
--
-- CE QUE LE FICHIER PROUVE, SECTION PAR SECTION :
--   §A  arrivée / absent : transitions nommées, idempotence, gels
--   §B  reception_board  : une journée en un appel, cloisons par rôle,
--                          zéro champ clinique, trace d'audit unique
--   §C  paiements        : l'assistante ENCAISSE mais ne tarife pas ;
--                          trg_pay_guard ferme les colonnes ; 24 h ; audit
--   §D  motif clinique   : invisible structurellement (ADR-017)
--   §E  notifications    : lecture par rôle, marquage lu, hors périmètre NULL
--
-- Les contrôles refusent le NULL : une condition qui ne compare rien n'est
-- pas verte (leçon v6, conservée telle quelle).

\set ON_ERROR_STOP on
\pset pager off
\set QUIET on

BEGIN;

CREATE FUNCTION pg_temp.controle(p_label text, p_cond boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NULL THEN
    RAISE INFO 'BLOQUÉ | % | % (condition NULL — rien n''a été comparé)', rpad(p_label, 58), p_detail;
  ELSIF p_cond THEN
    RAISE INFO 'vert   | % | %', rpad(p_label, 58), p_detail;
  ELSE
    RAISE INFO 'ROUGE  | % | %', rpad(p_label, 58), p_detail;
  END IF;
END $$;

-- Compteur d'audit lisible quel que soit le rôle testé (SECURITY DEFINER,
-- réservé à l'instrument — même motif que v6).
CREATE FUNCTION pg_temp.traces_total() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = audit, pg_catalog AS $$
  SELECT count(*) FROM audit.log;
$$;

CREATE FUNCTION pg_temp.traces_liste_depuis(p_depuis bigint) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = audit, pg_catalog AS $$
  SELECT count(*) FROM audit.log
   WHERE id > p_depuis AND changed_fields && ARRAY['liste']::text[];
$$;

-- Compteur de notifications par reçu, SECURITY DEFINER : la policy
-- `notifications_mine` rend ces lignes invisibles à une praticienne (elles ne
-- lui sont pas adressées) — un compte mesuré sous son rôle serait 0 sans que
-- rien ait échoué. Même motif que `traces_total`, instrument seulement.
CREATE FUNCTION pg_temp.notifs_assistant_recu(p_recu text) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_catalog AS $$
  SELECT count(*) FROM app.notifications
   WHERE recipient_role = 'assistant'
     AND payload->>'receipt_number' = p_recu;
$$;

CREATE FUNCTION pg_temp.traces_paiement_maj() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = audit, pg_catalog AS $$
  SELECT count(*) FROM audit.log
   WHERE table_name = 'payments' AND operation = 'update';
$$;

CREATE FUNCTION pg_temp.rejeu_inchangent(p_consultation uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_avant  timestamptz;
  v_apres  timestamptz;
  v_id     uuid;
BEGIN
  SELECT id, collected_at INTO v_id, v_avant
    FROM app.payments WHERE consultation_id = p_consultation;
  PERFORM app.record_payment_collected(v_id);
  SELECT collected_at INTO v_apres FROM app.payments WHERE id = v_id;
  RETURN v_avant IS NOT NULL AND v_avant = v_apres;
END $$;

CREATE FUNCTION pg_temp.arrivee_rejoue_sans_recrire(p_appt uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_avant timestamptz;
BEGIN
  SELECT arrived_at INTO v_avant FROM app.appointments WHERE id = p_appt;
  PERFORM app.mark_appointment_arrived(p_appt);
  RETURN v_avant IS NOT NULL
     AND v_avant = (SELECT arrived_at FROM app.appointments WHERE id = p_appt);
END $$;

-- Accesseur du board : la fonction renvoie UN jsonb dont la colonne de sortie
-- s'appelle `reception_board` — jamais `FROM app.reception_board(...)` en
-- croyant lire `journee`/`paiements` directement. Ce helper rend les clés
-- accessibles par `->` et reste SECURITY INVOKER : il voit le board DU RÔLE
-- impersoné au moment de l'appel.
CREATE FUNCTION pg_temp.board() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER AS $$
  SELECT app.reception_board(CURRENT_DATE);
$$;

-- Séquençage explicite : Postgres ne garantit PAS l'ordre d'évaluation des
-- arguments d'une fonction — une sonde « porte PUIS vérification » écrite en
-- deux arguments d'un même appel peut lire l'état AVANT la mutation et rendre
-- un faux ROUGE. Chaque geste suivi de sa vérification vit donc dans un
-- helper, où l'ordre est celui du pl/pgsql.
CREATE FUNCTION pg_temp.absent_puis_verifie(p_appt uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_ret uuid;
  v_ok  boolean;
BEGIN
  v_ret := app.mark_appointment_no_show(p_appt);
  IF v_ret IS NULL THEN RETURN false; END IF;
  SELECT status = 'no_show' INTO v_ok FROM app.appointments WHERE id = p_appt;
  RETURN COALESCE(v_ok, false);
END $$;

CREATE FUNCTION pg_temp.confirme_puis_verifie(p_appt uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_ret uuid;
  v_ok  boolean;
BEGIN
  v_ret := app.confirm_appointment(p_appt);
  IF v_ret IS NULL THEN RETURN false; END IF;
  SELECT status = 'confirmed' INTO v_ok FROM app.appointments WHERE id = p_appt;
  RETURN COALESCE(v_ok, false);
END $$;

CREATE FUNCTION pg_temp.marque_lu_puis_compte() RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_recu  text;
  v_ret   uuid;
  v_nb    integer;
BEGIN
  -- Le reçu visé est celui du paiement de la consultation fixture : c'est le
  -- SEUL que la porte `set_consultation_price` a notifié dans ce scénario
  -- (le paiement dû pré-existant n'a jamais transité par la porte).
  SELECT receipt_number INTO v_recu
    FROM app.payments
   WHERE consultation_id = '00000000-0000-0000-0000-f04600000005';

  SELECT id INTO v_ret
    FROM app.notifications
   WHERE recipient_role = 'assistant'
     AND payload->>'receipt_number' = v_recu
     AND read_at IS NULL
   ORDER BY created_at LIMIT 1;
  IF v_ret IS NULL THEN RETURN false; END IF;

  PERFORM app.mark_notification_read(v_ret);

  SELECT count(*) INTO v_nb
    FROM app.notifications
   WHERE payload->>'receipt_number' = v_recu
     AND read_at IS NOT NULL;
  RETURN v_nb = 1;
END $$;

-- Refus attendu : vrai SI l'UPDATE a levé. Chaque sonde est appelée sous le
-- rôle déjà impersoné — elle ne change aucun rôle elle-même.
CREATE FUNCTION pg_temp.patch_refuse(p_sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;                       -- passé => ROUGE
EXCEPTION WHEN OTHERS THEN
  RETURN true;                        -- levé  => vert
END $$;

CREATE FUNCTION pg_temp.appel_refuse(p_sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END $$;

-- ---------------------------------------------------------------------------
-- FIXTURES — cabinet synthétique 001, patients b1/b2, praticiennes a1/a2
-- ---------------------------------------------------------------------------
INSERT INTO app.appointments (id, cabinet_id, practitioner_id, patient_id,
                              starts_at, ends_at, status, source, created_by,
                              is_synthetic)
VALUES ('00000000-0000-0000-0000-f04600000001',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000b1',
        now() + interval '15 minutes', now() + interval '45 minutes',
        'confirmed', 'doctor', '00000000-0000-0000-0000-0000000000a1', true),
       ('00000000-0000-0000-0000-f04600000002',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        now() + interval '25 minutes', now() + interval '55 minutes',
        'confirmed', 'doctor', '00000000-0000-0000-0000-0000000000a2', true),
       ('00000000-0000-0000-0000-f04600000003',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        now() - interval '2 hours', now() - interval '90 minutes',
        'completed', 'doctor', '00000000-0000-0000-0000-0000000000a2', true),
       ('00000000-0000-0000-0000-f04600000004',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        now() + interval '3 days', now() + interval '3 days 30 minutes',
        'requested', 'web', '00000000-0000-0000-0000-0000000000a2', true);

INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id,
                               appointment_id, started_at, status, is_synthetic)
VALUES ('00000000-0000-0000-0000-f04600000005',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        '00000000-0000-0000-0000-f04600000002',
        now() - interval '30 minutes', 'open', true);

INSERT INTO app.payments (id, cabinet_id, practitioner_id, patient_id,
                          receipt_number, amount_dzd, method, set_by, created_at, is_synthetic)
VALUES ('00000000-0000-0000-0000-f04600000006',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        'REC-2026-F0461', 3500, 'cash',
        '00000000-0000-0000-0000-0000000000a2', now(), true),
       ('00000000-0000-0000-0000-f04600000007',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        'REC-2026-F0462', 2000, 'cash',
        '00000000-0000-0000-0000-0000000000a2', now() - interval '25 hours', true);

INSERT INTO app.notifications (id, cabinet_id, recipient_role, kind, payload)
VALUES ('00000000-0000-0000-0000-f04600000008',
        '00000000-0000-0000-0000-000000000001',
        'owner', 'payment_due',
        jsonb_build_object('receipt_number','REC-2026-F0469','amount_dzd',999));

-- Le motif vit sous le rôle de connexion : l'INSERT par une assistante serait
-- refusé (aucune policy), et c'est justement ce que D1 prouve en LECTURE.
INSERT INTO app.appointment_reasons (appointment_id, reason)
VALUES ('00000000-0000-0000-0000-f04600000002',
        'Motif de test — jamais lisible par l''assistante.');

\echo ''
\echo '═══ §A · ARRIVÉE / ABSENT (portes 046) — rôle ASSISTANTE ═══'

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';

SELECT pg_temp.controle(
  'A1 · arrivée posée sur RDV confirmé',
  app.mark_appointment_arrived('00000000-0000-0000-0000-f04600000002')
    IS NOT NULL);

SELECT pg_temp.controle(
  'A2 · statut = arrived et arrived_at serveur',
  (SELECT status = 'arrived' AND arrived_at IS NOT NULL
     FROM app.appointments
    WHERE id = '00000000-0000-0000-0000-f04600000002'));

SELECT pg_temp.controle(
  'A3 · rejeu idempotent (arrived_at inchangé)',
  pg_temp.arrivee_rejoue_sans_recrire('00000000-0000-0000-0000-f04600000002'));

SELECT pg_temp.controle(
  'A4 · arrivée refusée sur séance terminée',
  pg_temp.appel_refuse($sql$
    SELECT app.mark_appointment_arrived('00000000-0000-0000-0000-f04600000003')$sql$));

SELECT pg_temp.controle(
  'A5 · absent posé depuis confirmed',
  pg_temp.absent_puis_verifie('00000000-0000-0000-0000-f04600000001'));

SELECT pg_temp.controle(
  'A6 · absent refusé sur terminé',
  pg_temp.appel_refuse($sql$
    SELECT app.mark_appointment_no_show('00000000-0000-0000-0000-f04600000003')$sql$));

SELECT pg_temp.controle(
  'A7 · approbation d''une demande par l''assistante',
  pg_temp.confirme_puis_verifie('00000000-0000-0000-0000-f04600000004'));

RESET ROLE;

\echo ''
\echo '═══ §B · RECEPTION_BOARD — un appel, les cloisons, zéro clinique ═══'

SELECT COALESCE(max(id), 0) AS since_b FROM audit.log \gset

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';

SELECT pg_temp.controle(
  'B1 · board assistante contient les DEUX praticiennes du jour',
  EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.board()->'journee') e
           WHERE e.value->>'practitioner_id'
             = '00000000-0000-0000-0000-0000000000a1')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.board()->'journee') e
               WHERE e.value->>'practitioner_id'
                 = '00000000-0000-0000-0000-0000000000a2'));

SELECT pg_temp.controle(
  'B2 · board assistante porte le paiement dû de moins de 24 h',
  EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.board()->'paiements') e
           WHERE e.value->>'payment_id' = '00000000-0000-0000-0000-f04600000006'
             AND e.value->>'collected_at' IS NULL));

SELECT pg_temp.controle(
  'B3 · board assistante EXCLUT le paiement de plus de 24 h',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.board()->'paiements') e
               WHERE e.value->>'payment_id'
                 = '00000000-0000-0000-0000-f04600000007'));

SELECT pg_temp.controle(
  'B4 · ZÉRO champ clinique dans le contrat (pas de clé reason)',
  position('"reason"' in pg_temp.board()::text) = 0);

SELECT pg_temp.controle(
  'B5 · UNE trace liste après le board (patron list_agenda)',
  (SELECT pg_temp.traces_liste_depuis(:'since_b') >= 1));

RESET ROLE;
RESET request.jwt.claim.sub;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
SELECT pg_temp.controle(
  'B6 · board praticienne limitée à SA grille (cloison ADR-003)',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.board()->'journee') e
               WHERE e.value->>'practitioner_id'
                 <> '00000000-0000-0000-0000-0000000000a2'));
RESET ROLE;
RESET request.jwt.claim.sub;

\echo ''
\echo '═══ §C · PAIEMENTS — encaisser oui, tarifer jamais ═══'

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

SELECT app.set_consultation_price('00000000-0000-0000-0000-f04600000005', 2500);
SELECT app.set_consultation_price('00000000-0000-0000-0000-f04600000005', 3000);

SELECT pg_temp.controle(
  'C1 · tarif corrigé avant encaissement = 3000',
  (SELECT amount_dzd = 3000 FROM app.payments
    WHERE consultation_id = '00000000-0000-0000-0000-f04600000005'));

SELECT pg_temp.controle(
  'C2 · notification payment_due réémise à chaque correction (×2)',
  (SELECT pg_temp.notifs_assistant_recu(
             (SELECT receipt_number FROM app.payments
               WHERE consultation_id = '00000000-0000-0000-0000-f04600000005'))
     = 2));

RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';

SELECT pg_temp.controle(
  'C3 · assistante VOIT le paiement dû (fenêtre 24 h)',
  (SELECT count(*) = 1 FROM app.payments
    WHERE id = '00000000-0000-0000-0000-f04600000006'));

SELECT pg_temp.controle(
  'C4 · assistante NE voit PAS au-delà de 24 h',
  (SELECT count(*) = 0 FROM app.payments
    WHERE id = '00000000-0000-0000-0000-f04600000007'));

SELECT pg_temp.controle(
  'C5 · assistante encaisse un paiement déjà tarifé',
  app.record_payment_collected(
    (SELECT id FROM app.payments
      WHERE consultation_id = '00000000-0000-0000-0000-f04600000005'))
  IS NOT NULL);

SELECT pg_temp.controle(
  'C6 · encaissement tracé à SON nom, heure SERVEUR',
  (SELECT collected_by = '00000000-0000-0000-0000-0000000000a3'
          AND collected_at IS NOT NULL
     FROM app.payments
    WHERE consultation_id = '00000000-0000-0000-0000-f04600000005'));

SELECT pg_temp.controle(
  'C7 · rejeu idempotent — horodatage inchangé',
  pg_temp.rejeu_inchangent('00000000-0000-0000-0000-f04600000005'));

SELECT pg_temp.controle(
  'C8 · PATCH direct amount_dzd REFUSÉ (trg_pay_guard)',
  pg_temp.patch_refuse($sql$
    UPDATE app.payments SET amount_dzd = 1
     WHERE id = '00000000-0000-0000-0000-f04600000006'$sql$));

SELECT pg_temp.controle(
  'C9 · PATCH direct set_by REFUSÉ',
  pg_temp.patch_refuse($sql$
    UPDATE app.payments SET set_by = '00000000-0000-0000-0000-0000000000a3'
     WHERE id = '00000000-0000-0000-0000-f04600000006'$sql$));

SELECT pg_temp.controle(
  'C10 · attribution d''encaissement à un tiers REFUSÉE',
  pg_temp.patch_refuse($sql$
    UPDATE app.payments SET collected_by = '00000000-0000-0000-0000-0000000000a2'
     WHERE id = '00000000-0000-0000-0000-f04600000006'$sql$));

SELECT pg_temp.controle(
  'C11 · set_consultation_price par l''assistante → NULL',
  app.set_consultation_price('00000000-0000-0000-0000-f04600000005', 1)
    IS NULL);

SELECT pg_temp.controle(
  'C12 · day_revenue assistante → zéro ligne',
  (SELECT count(*) = 0 FROM app.day_revenue(CURRENT_DATE)));

SELECT pg_temp.controle(
  'C13 · list_day_payments assistante → zéro ligne',
  (SELECT count(*) = 0 FROM app.list_day_payments(CURRENT_DATE)));

SELECT pg_temp.controle(
  'C14 · trace audit écrite sur payments (trg_audit 013)',
  pg_temp.traces_paiement_maj() > 0);

RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

SELECT pg_temp.controle(
  'C15 · correction APRÈS encaissement refusée (029 §2)',
  pg_temp.appel_refuse($sql$
    SELECT app.set_consultation_price('00000000-0000-0000-0000-f04600000005', 500)$sql$));

SELECT pg_temp.controle(
  'C16 · recette praticienne reflète l''encaissement (attente recalculée)',
  (SELECT attente_dzd >= 0 AND total_dzd >= 3000 FROM app.day_revenue(CURRENT_DATE)));

RESET ROLE;

\echo ''
\echo '═══ §D · MOTIF CLINIQUE — invisible, structurellement ═══'

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';

SELECT pg_temp.controle(
  'D1 · appointment_reasons → zéro ligne pour l''assistante',
  (SELECT count(*) = 0 FROM app.appointment_reasons));

\echo ''
\echo '═══ §E · NOTIFICATIONS — lecture par rôle, marquage lu ═══'

SELECT pg_temp.controle(
  'E1 · l''assistante lit les notifications de SON rôle',
  (SELECT count(*) >= 2 FROM app.notifications
    WHERE recipient_role = 'assistant'));

SELECT pg_temp.controle(
  'E2 · elle NE lit PAS celles d''un autre rôle',
  (SELECT count(*) = 0 FROM app.notifications
    WHERE id = '00000000-0000-0000-0000-f04600000008'));

SELECT pg_temp.controle(
  'E3 · marquer lu pose read_at sur UNE notification du reçu',
  pg_temp.marque_lu_puis_compte());

SELECT pg_temp.controle(
  'E4 · marquer lu hors périmètre → NULL',
  app.mark_notification_read('00000000-0000-0000-0000-f04600000008') IS NULL);

RESET ROLE;

\echo ''
ROLLBACK;
