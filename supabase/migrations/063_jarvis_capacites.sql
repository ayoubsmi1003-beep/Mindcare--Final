-- 063_jarvis_capacites — ouvre l'allowlist d'écriture de Jarvis à cinq
-- capacités supplémentaires, et pose la porte de disponibilité de créneau.
--
-- ═══ CE QUE CETTE MIGRATION NE FAIT PAS ═══
-- Elle NE MODIFIE PAS 033, qui est appliquée (règle 9). 033 reste intacte,
-- octet pour octet ; l'histoire du schéma se lit dans l'ordre des fichiers.
-- Elle REMPLACE la contrainte et la fonction que 033 a posées, exactement comme
-- 034 l'a fait pour l'allowlist de `purpose` de 028.
--
-- ⚠️ `CREATE OR REPLACE`, JAMAIS `DROP` — ET CE N'EST PAS UNE PRÉFÉRENCE DE
-- STYLE. Un `DROP FUNCTION` suivi d'un `CREATE` change le PROPRIÉTAIRE de la
-- fonction au rôle qui exécute la migration. Sur une fonction `SECURITY
-- INVOKER` c'est encore sans effet, mais le jour où l'une d'elles passe en
-- `SECURITY DEFINER`, le même geste rouvrirait la cloison d'ADR-019 avec une
-- migration parfaitement verte. On ne prend pas l'habitude.
--
-- ═══ POURQUOI CINQ ÉCRITURES ET PAS PLUS ═══
-- Les actes ENGAGEANTS restent HORS de l'allowlist, donc inatteignables par
-- Jarvis — pas seulement « non décrits » : émission de certificat ou
-- d'ordonnance, impression, correction financière, suppression, export, envoi
-- de message, changement de permission. Un modèle ne peut pas les proposer
-- utilement, et s'il les proposait, la contrainte de table refuserait la ligne
-- avant même la carte de confirmation.
--
-- ═══ LA CONFIRMATION RESTE LA MÊME, ET C'EST L'ESSENTIEL ═══
-- Aucune des cinq n'a de chemin vers l'exécution qui saute `confirmed_at` :
-- `execute_jarvis_action` continue de lever si l'état n'est pas `confirmed`, et
-- la contrainte `jarvis_must_confirm` de 011/033 le garantit en base. Ajouter
-- des outils n'élargit pas le pouvoir de Jarvis d'un iota sur ce point.

BEGIN;

-- ⚠️ NUMÉROTÉE 063, ET PAS 061 : DEUX MIGRATIONS PORTAIENT DÉJÀ CE NUMÉRO
-- (`061_documents_snapshot_and_lifecycle`) ET `062` ÉTAIT PRIS. Une collision de
-- numéro est un défaut connu de ce dépôt — deux fichiers `058` ont déjà coûté
-- une reprise : le suivi des migrations extrait la version DU NOM DE FICHIER, et
-- deux `061` rendent l'ordre d'application indéterminé.
-- ---------------------------------------------------------------------------
-- 1 · L'ALLOWLIST — sept outils, la contrainte reste l'autorité
-- ---------------------------------------------------------------------------
-- Pas d'`ADD CONSTRAINT IF NOT EXISTS` pour un CHECK (Postgres ne le propose
-- pas) : on retire puis on repose, comme 033 le fait déjà.
ALTER TABLE app.jarvis_actions DROP CONSTRAINT IF EXISTS jarvis_tool_allowlist;

ALTER TABLE app.jarvis_actions ADD CONSTRAINT jarvis_tool_allowlist
    CHECK (tool_name IN (
      -- Les deux de 033, conservées telles quelles.
      'create_appointment',
      'set_consultation_price',
      -- Les cinq de cette passe.
      'reschedule_appointment',
      'cancel_appointment',
      'mark_patient_arrived',
      'record_payment_collected',
      'create_document_draft'
    ));

COMMENT ON CONSTRAINT jarvis_tool_allowlist ON app.jarvis_actions IS
  'L1 de 03-JARVIS-TOOLS : un outil absent de cette liste n''existe pas, et le '
  'refus vient de la BASE — pas du client, pas du prompt. Les actes engageants '
  '(émission, impression, correction financière, suppression, export, envoi) '
  'sont délibérément absents : ils restent inatteignables par Jarvis.';

-- ---------------------------------------------------------------------------
-- 2 · LA PORTE DE DISPONIBILITÉ — la couture manquante de `reschedule`
-- ---------------------------------------------------------------------------
-- ⚠️ POURQUOI CETTE PORTE EXISTE, PLUTÔT QU'UN CALCUL EN TYPESCRIPT. Décaler un
-- rendez-vous exige de savoir si le créneau visé est libre. Le calculer côté
-- client sur une liste d'agenda déjà chargée donnerait une réponse JUSTE AU
-- MOMENT DE LA LECTURE et fausse à celui de l'écriture : deux praticiennes, ou
-- la même dans deux onglets, verraient toutes deux « libre » et écriraient
-- toutes deux. Seule la base voit l'état au moment où elle décide.
--
-- Elle NE RÉSERVE RIEN et ne remplace aucune contrainte : c'est une LECTURE
-- consultative, destinée à ce que la carte de confirmation dise la vérité avant
-- que l'humaine ne clique. L'autorité reste à `update_appointment`.
--
-- SECURITY INVOKER : la RLS de `app.appointments` décide de ce que l'appelante
-- voit. Une praticienne ne peut donc pas sonder les créneaux d'une autre — la
-- porte rendrait « libre » pour un créneau qu'elle n'a pas le droit de voir, ce
-- qui ne divulgue rien de plus que ce que la RLS lui montre déjà.
CREATE OR REPLACE FUNCTION app.check_slot_available(
  p_practitioner_id  uuid,
  p_starts_at        timestamptz,
  p_duration_minutes integer,
  p_exclude_id       uuid DEFAULT NULL
)
RETURNS TABLE (disponible boolean, motif text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_fin      timestamptz;
  v_conflits integer;
BEGIN
  IF p_practitioner_id IS NULL OR p_starts_at IS NULL OR p_duration_minutes IS NULL THEN
    RETURN QUERY SELECT false, 'arguments-incomplets'::text;
    RETURN;
  END IF;

  -- Mêmes bornes que 024 : la duplication ici sert un refus LISIBLE, elle ne
  -- remplace pas la contrainte, qui reste l'autorité.
  IF p_duration_minutes < 5 OR p_duration_minutes > 240 THEN
    RETURN QUERY SELECT false, 'duree-hors-bornes'::text;
    RETURN;
  END IF;

  v_fin := p_starts_at + make_interval(mins => p_duration_minutes);

  -- `p_exclude_id` exclut le rendez-vous qu'on est en train de DÉPLACER : sans
  -- lui, tout décalage à l'intérieur de sa propre plage se déclarerait en
  -- conflit avec lui-même.
  --
  -- Les états `cancelled` et `no_show` ne bloquent rien : un créneau annulé est
  -- un créneau libre, et le contraire immobiliserait l'agenda à chaque
  -- désistement.
  SELECT count(*) INTO v_conflits
    FROM app.appointments a
   WHERE a.practitioner_id = p_practitioner_id
     AND a.status NOT IN ('cancelled', 'no_show')
     AND (p_exclude_id IS NULL OR a.id <> p_exclude_id)
     -- Chevauchement DEMI-OUVERT [début, fin) : deux rendez-vous qui se
     -- touchent bout à bout (14h00-14h30 puis 14h30-15h00) ne se chevauchent
     -- PAS. Un test fermé les déclarerait en conflit et interdirait des
     -- journées parfaitement normales.
     AND a.starts_at < v_fin
     AND a.ends_at   > p_starts_at;

  IF v_conflits > 0 THEN
    RETURN QUERY SELECT false, 'creneau-occupe'::text;
  ELSE
    RETURN QUERY SELECT true, NULL::text;
  END IF;
END;
$$;

COMMENT ON FUNCTION app.check_slot_available(uuid, timestamptz, integer, uuid) IS
  'Lecture consultative : le créneau est-il libre ? Ne réserve rien, ne '
  'remplace aucune contrainte. Existe pour que la carte de confirmation dise '
  'vrai AVANT le clic — un calcul côté client serait juste à la lecture et faux '
  'à l''écriture.';

REVOKE ALL ON FUNCTION app.check_slot_available(uuid, timestamptz, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.check_slot_available(uuid, timestamptz, integer, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · L'EXÉCUTEUR — sept branches, aucune nouvelle permission
-- ---------------------------------------------------------------------------
-- ⚠️ CHAQUE BRANCHE APPELLE LA PORTE MÉTIER EXISTANTE, avec sa signature
-- VIVANTE — celle de la DERNIÈRE migration qui l'a touchée, jamais celle qui
-- l'a créée :
--     app.update_appointment(uuid, text)          → 024 (022 remplacée)
--     app.cancel_appointment(uuid, text)          → 022
--     app.mark_appointment_arrived(uuid)          → 046
--     app.record_payment_collected(uuid)          → 029
-- Se tromper de signature lèverait `42883`, que le bloc EXCEPTION rangerait en
-- `failed` — indiscernable d'un refus de la RLS. C'est le défaut exact qui a
-- coûté une session sur `create_appointment` à cinq arguments.
--
-- ⚠️ AUCUNE DE CES BRANCHES NE RÉIMPLÉMENTE UNE RÈGLE MÉTIER. Elles n'ajoutent
-- ni test de rôle, ni test de périmètre : la RLS décide (règle 4). Un
-- `IF role = …` ici serait un bug de conception, pas une précaution.
CREATE OR REPLACE FUNCTION app.execute_jarvis_action(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_state    app.jarvis_state;
  v_conf     timestamptz;
  v_tool     text;
  v_args     jsonb;
  v_affected uuid;
  v_table    text;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT state, confirmed_at, tool_name, tool_args
    INTO v_state, v_conf, v_tool, v_args
    FROM app.jarvis_actions
   WHERE id = p_id
     FOR UPDATE;

  IF v_state IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_state <> 'confirmed' OR v_conf IS NULL THEN
    RAISE EXCEPTION 'Action non confirmée : rien ne s''exécute sans confirmation.';
  END IF;

  BEGIN
    CASE v_tool

      -- ── Les deux de 033, RECOPIÉES À L'IDENTIQUE ──
      WHEN 'create_appointment' THEN
        v_table := 'appointments';
        v_affected := app.create_appointment(
          (v_args ->> 'patient_id')::uuid,
          (v_args ->> 'practitioner_id')::uuid,
          (v_args ->> 'starts_at')::timestamptz,
          (v_args ->> 'duration_minutes')::integer,
          v_args ->> 'notes_admin',
          (v_args ->> 'kind')::app.consult_kind);

      WHEN 'set_consultation_price' THEN
        v_table := 'payments';
        v_affected := app.set_consultation_price(
          (v_args ->> 'consultation_id')::uuid,
          (v_args ->> 'amount_dzd')::integer);

      -- ── Les cinq de 061 ──

      -- Le décalage passe par la porte de MODIFICATION, dont la liste blanche
      -- (024) exclut déjà `patient_id`, `practitioner_id`, `cabinet_id` et
      -- `status`. Jarvis ne peut donc pas réaffecter un rendez-vous à un autre
      -- patient en prétendant le décaler — et ce n'est pas ce fichier qui le
      -- garantit, c'est la porte qu'il appelle.
      WHEN 'reschedule_appointment' THEN
        v_table := 'appointments';
        v_affected := app.update_appointment(
          (v_args ->> 'appointment_id')::uuid,
          v_args ->> 'changes');

      WHEN 'cancel_appointment' THEN
        v_table := 'appointments';
        v_affected := app.cancel_appointment(
          (v_args ->> 'appointment_id')::uuid,
          v_args ->> 'motif');

      WHEN 'mark_patient_arrived' THEN
        v_table := 'appointments';
        v_affected := app.mark_appointment_arrived(
          (v_args ->> 'appointment_id')::uuid);

      WHEN 'record_payment_collected' THEN
        v_table := 'payments';
        v_affected := app.record_payment_collected(
          (v_args ->> 'payment_id')::uuid);

      -- ⚠️ LE BROUILLON DE DOCUMENT N'ÉMET RIEN. Il n'appelle PAS
      -- `app.issue_document` : émettre consomme un numéro de la table compteur
      -- (P7), et un numéro consommé ne se rend pas. Un brouillon refusé par la
      -- praticienne laisserait alors un TROU dans la numérotation — une
      -- anomalie comptable sur un document médical.
      --
      -- La ligne `jarvis_actions` est donc la SEULE trace : elle prouve que la
      -- praticienne a demandé et confirmé un brouillon, et l'émission réelle
      -- reste un geste séparé, fait à l'écran des documents, avec ses propres
      -- garde-fous. `affected_id` pointe la consultation, cible du brouillon.
      WHEN 'create_document_draft' THEN
        v_table := 'consultations';
        SELECT c.id INTO v_affected
          FROM app.consultations c
         WHERE c.id = (v_args ->> 'consultation_id')::uuid;

      ELSE
        RAISE EXCEPTION 'Outil inconnu : Jarvis ne dispose d''aucune action de ce nom.';
    END CASE;

    -- ⚠️ UN RETOUR NULL N'EST PAS UN SUCCÈS SILENCIEUX. Plusieurs portes
    -- rendent NULL — pas une exception — quand la cible est introuvable OU
    -- masquée par la RLS : c'est leur façon de ne pas fabriquer d'oracle
    -- d'existence (ADR-003). Sans ce test, la ligne passerait à `executed` avec
    -- `affected_id` à NULL et la carte annoncerait une action faite sur une
    -- cible que la base a refusé de montrer.
    IF v_affected IS NULL THEN
      RAISE EXCEPTION 'Action sans effet : la cible est introuvable ou hors de votre périmètre.';
    END IF;

    UPDATE app.jarvis_actions
       SET state          = 'executed',
           executed_at    = now(),
           affected_table = v_table,
           affected_id    = v_affected,
           result         = jsonb_build_object('id', v_affected)
     WHERE id = p_id;

    RETURN v_affected;

  EXCEPTION WHEN others THEN
    UPDATE app.jarvis_actions
       SET state       = 'failed',
           executed_at = now(),
           error       = SQLSTATE
     WHERE id = p_id;

    RETURN NULL;
  END;
END;
$$;

COMMENT ON FUNCTION app.execute_jarvis_action(uuid) IS
  '063 — sept outils. Exécute une action CONFIRMÉE en appelant la porte métier '
  'existante, et journalise le résultat dans la même transaction. SECURITY '
  'INVOKER : l''appel imbriqué s''exécute sous `authenticated`, sinon les '
  'policies TO authenticated cesseraient de s''appliquer. `error` ne porte que '
  'le SQLSTATE, jamais SQLERRM — règle 1.';

-- `CREATE OR REPLACE` conserve les droits existants ; le REVOKE/GRANT est
-- réaffirmé par prudence, il est idempotent.
REVOKE ALL ON FUNCTION app.execute_jarvis_action(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.execute_jarvis_action(uuid) TO authenticated;

INSERT INTO app.schema_migrations (version) VALUES ('063_jarvis_capacites')
    ON CONFLICT DO NOTHING;

COMMIT;
