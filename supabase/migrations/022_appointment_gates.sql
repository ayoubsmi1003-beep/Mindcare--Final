-- 022_appointment_gates — les portes de l'agenda (S4, ADR-021).
--
-- ADDITIF PUR. Ce fichier ne modifie NI 004, NI 006, NI aucune policy existante.
-- La cloison décrite en Q-D tient précisément parce que le fichier le plus
-- sensible du corpus n'est pas touché ; ce qui vaut pour `patients` vaut ici.
--
-- ═══ POURQUOI DES FONCTIONS PLUTÔT QU'UN PORT QUI SAIT ÉCRIRE ══════════════
--
-- `DbPort` (ADR-020) expose `select`, `rpc` et l'authentification. Il ne sait
-- pas écrire, et on ne le lui apprend pas ici. Trois raisons, dans l'ordre :
--
--   1. ATOMICITÉ. ADR-020 l'écrit noir sur blanc : « PostgREST n'expose pas de
--      transaction multi-requêtes ; un assistant de transaction donnerait une
--      garantie d'atomicité FAUSSE. Quand l'atomicité est requise, elle s'écrit
--      en fonction Postgres. » Un RDV et son motif (ADR-017) sont deux lignes
--      dans deux tables : les écrire en deux appels PostgREST, c'est accepter
--      qu'un RDV existe sans son motif, ou l'inverse.
--
--   2. LES RÈGLES DU DOSSIER VIVENT EN BASE. Refuser d'annuler une consultation
--      déjà terminée est une règle du dossier médical, pas une préférence
--      d'interface. Écrite en TypeScript, elle ne s'applique qu'aux appelants
--      qui pensent à la respecter — donc pas à Jarvis, pas au futur front
--      assistante, pas à un script. Écrite en déclencheur, elle s'applique à
--      tout le monde. C'est la règle 4 de CLAUDE.md.
--
--   3. SURFACE. Une porte nomme ses paramètres. Un `update` générique accepte
--      n'importe quelle colonne, y compris `practitioner_id` — c'est-à-dire le
--      déplacement d'un RDV d'une praticienne vers l'autre, la cloison ADR-003
--      contournée par une modification de routine. Même raisonnement, et même
--      allowlist, que `app.update_patient` en 020.
--
-- ═══ CE QUI N'EST PAS ÉLARGI, ET C'EST L'ESSENTIEL ═════════════════════════
--
-- Les trois portes d'ÉCRITURE sont `SECURITY INVOKER`. Aucune élévation, nulle
-- part : `authenticated` possède déjà INSERT et UPDATE sur `app.appointments`
-- (privilèges par défaut de 001), et les policies `appt_clinical` /
-- `appt_assistant` de 006 portent un `WITH CHECK`. Ces fonctions ne testent
-- aucun rôle, ne comparent aucun `practitioner_id`, ne filtrent rien. La RLS
-- décide, comme partout ailleurs dans ce dépôt.
--
-- Les deux portes de LECTURE sont `SECURITY DEFINER` — non pour élargir, mais
-- parce qu'elles nomment un patient, et que `SELECT` sur `app.patients` est
-- révoqué depuis 017. Elles sont possédées par `app_gatekeeper`, exactement
-- comme les portes de 020 : rôle sans BYPASSRLS, membre de `authenticated`
-- WITH INHERIT TRUE, donc les policies de 004 et 006 s'appliquent INCHANGÉES.
-- Le contrôle 12 de `checkpoint-s2.sh` rendrait ROUGE sur un propriétaire
-- `postgres` — c'est la faute de la migration 018, mesurée (la Dr #2 lisait la
-- patiente de la Dr Larbi). Ne pas la rejouer.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Privilèges du porteur
-- ---------------------------------------------------------------------------
-- 020 accorde déjà USAGE sur les deux schémas et SELECT/UPDATE sur `patients`.
-- Les portes de lecture ci-dessous joignent deux relations de plus.
--
-- ON NOMME AU LIEU D'HÉRITER. `app_gatekeeper` est membre de `authenticated`,
-- qui possède ces SELECT ; s'appuyer là-dessus rendrait les portes dépendantes
-- d'une adhésion de rôle pour un privilège de TABLE, deux mécanismes distincts
-- que Postgres n'oblige pas à rester alignés. 020 a pris le même parti pour
-- `USAGE ON SCHEMA`, et la panne évitée est la pire à diagnostiquer : migration
-- verte, fonction en 42501 à l'exécution.
GRANT SELECT ON app.appointments TO app_gatekeeper;
GRANT SELECT ON app.profiles     TO app_gatekeeper;

-- Nécessaire au transfert de propriété, retiré au §6 de ce fichier.
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 2 · Porte de lecture — la vue d'agenda
-- ---------------------------------------------------------------------------
-- POURQUOI CETTE PORTE EXISTE, ET CE QU'ELLE ÉVITE.
--
-- Un agenda affiche des noms. Le nom d'un patient ne s'obtient que par
-- `app.get_patient`, qui journalise une ligne `fiche` PAR APPEL. Afficher douze
-- rendez-vous produirait donc douze « ouvertures de dossier » dans le journal
-- légal — et la preuve écrite en S3 (« une fiche ouverte = +1 ligne d'audit,
-- exactement ») deviendrait fausse. Un journal qui ne distingue plus un coup
-- d'œil à l'agenda d'une consultation de dossier ne dit plus rien devant un
-- juge, ce qui est exactement ce qu'I4 demande de pouvoir dire.
--
-- `audit.log_read` accepte trois contextes depuis 017 : `fiche`, `recherche`,
-- `liste`. Le troisième n'a jamais servi. C'est celui-ci : UNE ligne par
-- consultation d'agenda, `patient_id` à NULL — une plage horaire ne nomme
-- personne, et le journal ne doit pas prétendre le contraire.
--
-- LA PLAGE EST BORNÉE EN BASE. C'est l'analogue exact du `p_limit ≤ 100` de
-- `search_patients`, et pour la même raison : une plage que l'appelant choisit
-- sans limite n'est pas un agenda, c'est un export de la base patients par la
-- porte de service.
--
-- `reason` N'APPARAÎT PAS ICI et n'y apparaîtra pas. Il vit dans
-- `app.appointment_reasons` (ADR-017), sans policy assistante ; le faire
-- transiter par une fonction possédée par `app_gatekeeper` ferait tomber ce
-- mur-là par la porte de derrière. Le motif appartient à un service clinique,
-- dont la RLS décidera — pas à l'agenda.

CREATE OR REPLACE FUNCTION app.list_agenda(
  p_from         timestamptz,
  p_to           timestamptz,
  p_practitioner uuid DEFAULT NULL)
RETURNS TABLE (
  id                uuid,
  starts_at         timestamptz,
  ends_at           timestamptz,
  status            app.appt_status,
  source            app.appt_source,
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

  -- Journal AVANT la lecture des identités, même transaction. Si l'insertion
  -- d'audit échoue, le RETURN QUERY n'a jamais lieu.
  PERFORM audit.log_read(NULL, 'liste');

  RETURN QUERY
  -- LEFT JOIN, et c'est une décision. Un RDV peut porter un `pending_patient_id`
  -- au lieu d'un `patient_id` (demande web non validée), et la RLS de `patients`
  -- peut masquer un dossier que celle d'`appointments` laisse voir. Un INNER
  -- JOIN ferait DISPARAÎTRE le rendez-vous de l'agenda — une heure occupée
  -- invisible, donc un double booking. On rend la ligne, sans nom.
  SELECT a.id, a.starts_at, a.ends_at, a.status, a.source, a.notes_admin,
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

COMMENT ON FUNCTION app.list_agenda(timestamptz, timestamptz, uuid) IS
  'ADR-021. Seule porte vers un agenda nominatif. Une ligne d''audit par appel, '
  'contexte `liste`, patient_id NULL : un coup d''œil à l''agenda ne doit pas se '
  'lire comme douze ouvertures de dossier. N''expose jamais `reason` (ADR-017).';

-- ---------------------------------------------------------------------------
-- 3 · Porte de lecture — le détail d'un rendez-vous
-- ---------------------------------------------------------------------------
-- Ici le `patient_id` EST renseigné dans la trace : consulter un rendez-vous
-- précis désigne une personne, et le journal doit pouvoir le dire. Le contexte
-- reste `liste` — ce n'est pas l'ouverture du dossier médical, et confondre les
-- deux ferait perdre au journal la distinction qui lui donne sa valeur.
--
-- DEUX TEMPS, ET L'ORDRE COMPTE. On lit d'abord `patient_id` sur
-- `app.appointments` — ce qui ne révèle AUCUNE identité, seulement une clé —,
-- on journalise, puis seulement ensuite on joint `app.patients` pour le nom.
-- Aucune identité n'est donc lue avant que la trace existe. Si le RDV n'est pas
-- visible, `v_patient` reste NULL et la TENTATIVE est tracée quand même : c'est
-- ce qu'un audit doit savoir dire.
CREATE OR REPLACE FUNCTION app.get_appointment(p_id uuid)
RETURNS TABLE (
  id                uuid,
  starts_at         timestamptz,
  ends_at           timestamptz,
  status            app.appt_status,
  source            app.appt_source,
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
  SELECT a.id, a.starts_at, a.ends_at, a.status, a.source, a.notes_admin,
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

COMMENT ON FUNCTION app.get_appointment(uuid) IS
  'ADR-021. Détail nominatif d''un rendez-vous. Trace `liste` avec patient_id : '
  'consulter un RDV désigne une personne, ouvrir son dossier est autre chose.';

-- ---------------------------------------------------------------------------
-- 4 · Portes d'écriture — SECURITY INVOKER, aucune élévation
-- ---------------------------------------------------------------------------

-- La durée est le paramètre, pas `ends_at` : c'est ce que l'interface demande
-- (« 30 min »), et le laisser calculer au client autoriserait un `ends_at`
-- antérieur au début — que la contrainte `appt_time_valid` refuserait, mais
-- avec un message que personne ne sait lire.
--
-- BORNES : 5 minutes à 4 heures. Ce ne sont pas des valeurs cliniques (une
-- durée de consultation n'est pas prescrite par ce système) mais des garde-fous
-- de saisie : ils attrapent le zéro et la faute de frappe à trois chiffres.
--
-- `source` EST DÉRIVÉ DU RÔLE, PAS SAISI. La colonne dit par quel canal le RDV
-- est entré ; laisser l'écran le choisir librement inviterait à le confondre
-- avec le TYPE de consultation, qui est une donnée différente et qui n'existe
-- pas encore dans ce schéma. Un RDV saisi par l'assistante est 'assistant',
-- saisi par une praticienne 'doctor'. Les canaux 'phone', 'walk_in' et 'web'
-- appartiennent à des flux qui ne sont pas construits.
CREATE OR REPLACE FUNCTION app.create_appointment(
  p_patient_id       uuid,
  p_practitioner_id  uuid,
  p_starts_at        timestamptz,
  p_duration_minutes integer,
  p_notes_admin      text DEFAULT NULL)
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

  -- `cabinet_id` vient de la session, jamais du client : un cabinet passé en
  -- paramètre serait un paramètre de portée, donc une décision d'autorisation
  -- déplacée dans l'appelant. La policy le revérifie de toute façon.
  --
  -- Statut 'confirmed' : un rendez-vous saisi au cabinet est pris. 'requested'
  -- reste ce qu'il a toujours été — la demande web en attente de validation,
  -- flux qui n'est pas construit.
  INSERT INTO app.appointments (cabinet_id, practitioner_id, patient_id,
                                starts_at, ends_at, status, source,
                                notes_admin, created_by)
  VALUES (app.current_cabinet(), p_practitioner_id, p_patient_id,
          p_starts_at, p_starts_at + make_interval(mins => p_duration_minutes),
          'confirmed', v_source,
          nullif(btrim(coalesce(p_notes_admin, '')), ''), auth.uid())
  RETURNING id INTO v_id;

  -- L'audit de l'écriture n'est pas réimplémenté : `trg_audit` de 013 est
  -- attaché à cette table et journalise l'INSERT avec sa charge complète.
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.create_appointment(uuid, uuid, timestamptz, integer, text) IS
  'ADR-021. SECURITY INVOKER : aucune élévation. `cabinet_id` vient de la '
  'session, `source` du rôle, et la RLS de 006 décide seule du droit d''écrire.';

-- ALLOWLIST STRICTE, et c'est elle qui porte la sécurité de cette fonction.
-- Absents par conception :
--   `patient_id`, `practitioner_id`, `cabinet_id` — les déplacer réattribuerait
--   un rendez-vous d'une praticienne à l'autre, c'est-à-dire la cloison ADR-003
--   contournée par une modification de routine. Un RDV mal attribué se corrige
--   en l'annulant et en en créant un autre : deux traces d'audit lisibles
--   plutôt qu'une mutation silencieuse.
--   `status` — les transitions ont leurs propres portes (§ ci-dessous) et leur
--   propre déclencheur. Les laisser ici les rendrait contournables.
--
-- CHARGE EN DOCUMENT JSON : avec des paramètres nullables, `NULL` signifie à la
-- fois « ne change pas » et « efface », et on ne peut plus vider `notes_admin`.
-- Une clé absente ne change rien, une clé à `null` efface. Même forme que
-- `app.update_patient` (020), pour qu'elle s'apprenne une seule fois.
--
-- LE PARAMÈTRE EST `text`, PAS `jsonb`, ET C'EST LE PORT QUI L'IMPOSE.
-- `RpcArgs` (ADR-020) n'accepte que des scalaires — `string | number | boolean
-- | null` — délibérément : un port qui transporterait des structures arbitraires
-- obligerait chaque adaptateur futur à reproduire la sérialisation de PostgREST,
-- et l'abstraction ne tiendrait plus. Le document voyage donc en texte et se
-- décode ICI, par un cast explicite. `update_patient` n'a pas encore d'appelant,
-- ce qui est la seule raison pour laquelle elle n'a pas rencontré ce mur ; le
-- jour où l'édition de fiche se construira, elle prendra la même forme.
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
  -- Nom DISTINCT du paramètre : une variable qui porterait le même nom le
  -- masquerait, et son propre initialiseur se référerait à elle-même.
  v_changes  jsonb := nullif(btrim(coalesce(p_changes, '')), '')::jsonb;
  allowed constant text[] := ARRAY['starts_at', 'duration_minutes', 'notes_admin'];
BEGIN
  IF v_changes IS NULL OR jsonb_typeof(v_changes) <> 'object' THEN
    RAISE EXCEPTION 'Charge de modification invalide : un objet JSON est attendu.';
  END IF;

  -- On REFUSE la clé inconnue au lieu de l'ignorer. Ignorer en silence ferait
  -- croire à l'appelant que sa modification a été prise en compte.
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
    -- `ends_at` est TOUJOURS recalculé à partir des deux entrées, même quand une
    -- seule change : déplacer un RDV sans déplacer sa fin produirait une durée
    -- négative, refusée par `appt_time_valid` avec un message illisible.
    ends_at     = CASE WHEN v_changes ? 'starts_at'
                       THEN (v_changes->>'starts_at')::timestamptz ELSE a.starts_at END
                  + make_interval(mins => coalesce(v_duration,
                      (extract(epoch FROM (a.ends_at - a.starts_at)) / 60)::integer)),
    notes_admin = CASE WHEN v_changes ? 'notes_admin'
                       THEN nullif(btrim(coalesce(v_changes->>'notes_admin', '')), '')
                       ELSE a.notes_admin END,
    updated_at  = now()
  WHERE a.id = p_id
  RETURNING a.id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.update_appointment(uuid, text) IS
  'ADR-021. Allowlist stricte : patient_id, practitioner_id, cabinet_id et '
  'status en sont exclus, pour qu''une modification de routine ne puisse pas '
  'réattribuer un rendez-vous d''une praticienne à l''autre (ADR-003).';

-- L'annulation est une TRANSITION, pas une suppression. Le clinique est en
-- ajout seul (§9) : le rendez-vous reste, marqué, avec son historique dans
-- `audit.log`. Rien dans ce système ne supprime un rendez-vous.
--
-- LE MOTIF VA DANS `notes_admin`, JAMAIS DANS `appointment_reasons`. Le premier
-- est administratif et visible de l'assistante — c'est elle qui rappelle le
-- patient. Le second est le MOTIF DE CONSULTATION, clinique, protégé par
-- ADR-017. Les confondre ferait entrer une donnée administrative dans une table
-- que l'assistante ne peut pas lire, ou pire, l'inverse.
CREATE OR REPLACE FUNCTION app.cancel_appointment(p_id uuid, p_motif text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_motif  text := nullif(btrim(coalesce(p_motif, '')), '');
  v_statut app.appt_status;
  v_id     uuid;
BEGIN
  IF v_motif IS NULL THEN
    RAISE EXCEPTION 'Motif d''annulation requis.'
      USING HINT = 'Un rendez-vous annulé sans motif ne se relit pas six mois plus tard.';
  END IF;

  -- Lecture avant écriture pour rendre un message utile. Le déclencheur §5
  -- refuserait de toute façon — mais avec un message générique, et la
  -- praticienne mérite de savoir POURQUOI son geste n'a pas abouti.
  -- Si la RLS masque la ligne, `v_statut` reste NULL et l'UPDATE ne touchera
  -- rien : on rend NULL, et l'appelant le lit comme « introuvable », sans
  -- distinguer l'inexistant du hors-périmètre.
  SELECT a.status INTO v_statut FROM app.appointments a WHERE a.id = p_id;

  IF v_statut = 'cancelled' THEN
    RAISE EXCEPTION 'Ce rendez-vous est déjà annulé.';
  END IF;
  IF v_statut = 'completed' THEN
    RAISE EXCEPTION 'Une consultation terminée ne s''annule pas.'
      USING HINT = 'Le dossier est en ajout seul : la séance a eu lieu.';
  END IF;

  UPDATE app.appointments a SET
    status      = 'cancelled',
    notes_admin = btrim(coalesce(a.notes_admin || E'\n', '') || 'Annulé : ' || v_motif),
    updated_at  = now()
  WHERE a.id = p_id
  RETURNING a.id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.cancel_appointment(uuid, text) IS
  'ADR-021. Transition, pas suppression : le rendez-vous reste et son historique '
  'aussi. Motif en notes_admin (administratif), jamais en appointment_reasons.';

-- ---------------------------------------------------------------------------
-- 5 · Le déclencheur de transitions — la règle, hors de portée des appelants
-- ---------------------------------------------------------------------------
-- Les gardes écrits dans `cancel_appointment` produisent de bons messages, mais
-- ils ne protègent que ceux qui passent par elle. Ce déclencheur protège la
-- table : Jarvis, un futur front assistante, un script de reprise, tous butent
-- dessus. C'est la différence entre une règle et une convention.
--
-- `RAISE EXCEPTION` rend le SQLSTATE P0001, que `src/services/errors.ts`
-- traduit déjà en `regle-metier` — « L'enregistrement a été refusé par une règle
-- du dossier médical ». Aucun câblage à ajouter côté application.
--
-- `notes_admin` RESTE MODIFIABLE sur un rendez-vous terminé ou annulé, et c'est
-- délibéré : une annotation administrative postérieure (« patient rappelé »)
-- n'altère aucun fait clinique, et l'interdire pousserait à noter ailleurs.
CREATE OR REPLACE FUNCTION app.assert_appointment_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_catalog
AS $$
BEGIN
  IF OLD.status IN ('completed', 'cancelled')
     AND (NEW.status          IS DISTINCT FROM OLD.status
       OR NEW.starts_at       IS DISTINCT FROM OLD.starts_at
       OR NEW.ends_at         IS DISTINCT FROM OLD.ends_at
       OR NEW.patient_id      IS DISTINCT FROM OLD.patient_id
       OR NEW.practitioner_id IS DISTINCT FROM OLD.practitioner_id) THEN
    RAISE EXCEPTION
      'Rendez-vous % : un rendez-vous % ne se modifie plus.', OLD.id, OLD.status
      USING HINT = 'Le dossier est en ajout seul. Créer un nouveau rendez-vous.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appt_transition ON app.appointments;
CREATE TRIGGER trg_appt_transition
  BEFORE UPDATE ON app.appointments
  FOR EACH ROW EXECUTE FUNCTION app.assert_appointment_transition();

COMMENT ON FUNCTION app.assert_appointment_transition() IS
  'ADR-021. Un rendez-vous terminé ou annulé ne change plus d''heure, de patient, '
  'de praticienne ni de statut. La règle est sur la TABLE : elle s''applique aussi '
  'à Jarvis et à tout appelant futur.';

-- ---------------------------------------------------------------------------
-- 6 · Qui peut franchir les portes
-- ---------------------------------------------------------------------------
-- `PUBLIC` reçoit EXECUTE par défaut sur toute fonction nouvellement créée :
-- sans cette révocation, `anon` — le visiteur non authentifié — pourrait les
-- appeler. La RLS le renverrait bredouille, mais il produirait des lignes
-- d'audit à volonté et sonderait l'existence d'un identifiant.
--
-- `service_role` reste exclu, comme des portes de 020 : il contourne la RLS par
-- conception (`rolbypassrls = t`), et lui ouvrir une porte auditée reviendrait à
-- offrir un export propre plutôt qu'un accès contrôlé.
REVOKE ALL ON FUNCTION app.list_agenda(timestamptz, timestamptz, uuid)               FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_appointment(uuid)                                     FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_appointment(uuid, uuid, timestamptz, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.update_appointment(uuid, text)                           FROM PUBLIC;
REVOKE ALL ON FUNCTION app.cancel_appointment(uuid, text)                            FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.list_agenda(timestamptz, timestamptz, uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION app.get_appointment(uuid)                                     TO authenticated;
GRANT EXECUTE ON FUNCTION app.create_appointment(uuid, uuid, timestamptz, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.update_appointment(uuid, text)                           TO authenticated;
GRANT EXECUTE ON FUNCTION app.cancel_appointment(uuid, text)                            TO authenticated;

-- Les deux portes de lecture s'exécutent sous `app_gatekeeper` et appellent le
-- noyau d'audit, qui reste refusé à `authenticated` (017 §1) : personne ne peut
-- fabriquer une fausse trace de lecture, seules les portes en produisent.
-- `app_gatekeeper` a déjà EXECUTE dessus depuis 020 §2.

-- La propriété des deux portes de lecture est acquise ; CREATE sur le schéma
-- n'a plus lieu d'être. Un rôle qui peut créer des objets dans `app` pourrait y
-- planter une fonction masquant une fonction du catalogue dans le `search_path`
-- figé des portes.
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

-- PostgREST met son cache de schéma à jour sur notification. Sans ça, les cinq
-- fonctions n'apparaissent dans l'API qu'au prochain redémarrage.
NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('022_appointment_gates')
  ON CONFLICT DO NOTHING;

COMMIT;
