-- 026_consultation_gates — les portes de la séance et de la note clinique (S5).
--
-- ADDITIF PUR. Ce fichier ne modifie NI 004, NI 007, NI 008, NI aucune policy
-- existante. La cloison de Q-D tient parce que les fichiers les plus sensibles
-- du corpus ne sont pas touchés ; ce qui a valu pour `patients` en 020 et pour
-- `appointments` en 022 vaut ici, et le clinique est ce qu'il y a de plus
-- sensible dans ce dépôt.
--
-- ═══ CE QUE CE FICHIER N'A PAS LE DROIT DE FAIRE ══════════════════════════
--
-- Le verrou d'immuabilité de 008 (`trg_note_immutable`, `trg_note_sign`, la
-- règle `no_delete_notes`) N'EST PAS TOUCHÉ, pas contourné, pas assoupli, et
-- aucune porte d'ici ne s'exécute avec un privilège qui lui permettrait de le
-- faire. C'est la valeur juridique du dossier (ADR-004, I15) ; une porte de
-- confort qui saurait réécrire une note signée annulerait à elle seule tout ce
-- que 008 garantit.
--
-- Conséquence concrète et voulue : `app.sign_note` N'ÉCRIT NI `signed_at`, NI
-- `signed_by`, NI `lock_after`. Elle pose `status = 'signed'` et laisse
-- `trg_note_sign` faire le reste. Les écrire ici créerait une SECONDE source de
-- vérité pour l'horodatage de signature — et le jour où les deux divergent,
-- c'est le document légal qui ment.
--
-- ═══ LA FENÊTRE DE 15 MINUTES — CE QU'ELLE EST EXACTEMENT ═════════════════
--
-- Après signature, la note reste modifiable pendant 15 minutes, PUIS se
-- verrouille. Ce n'est pas une tolérance : c'est le dispositif d'I15, et il est
-- clinique. Elle signe, le patient sort, elle se rappelle une posologie — la
-- corriger dans la minute est plus honnête qu'un amendement qui laisserait
-- croire à une révision postérieure.
--
-- Aucune porte d'ici ne teste cette fenêtre. `trg_note_immutable` la teste, et
-- elle seule : un second test, écrit ici, serait faux le jour où l'un des deux
-- changerait. L'interface AFFICHE le décompte ; la base DÉCIDE.
--
-- ═══ POURQUOI `raw_notes` VIT SUR LA SÉANCE, PAS SUR LA NOTE ══════════════
--
-- Les notes brutes sont le brouillon de travail de la praticienne pendant la
-- séance : ce qu'elle tape au fil de la parole. Ce n'est PAS une pièce du
-- dossier signé, et les loger dans `clinical_notes` aurait deux conséquences
-- fausses :
--
--   · elles se figeraient avec la signature, alors qu'elles n'ont aucune valeur
--     probante et qu'il n'y a aucune raison de les geler ;
--   · `analyze_session` (S6) lit les notes brutes et ÉCRIT la note structurée.
--     Dans la même table, elle écraserait la source qu'elle vient de lire.
--
-- Elles appartiennent donc à la SÉANCE. Une séance close les fige — non par
-- valeur légale, mais parce qu'un brouillon qu'on peut réécrire six mois plus
-- tard n'est plus un compte rendu de ce qui s'est dit.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · La colonne de notes brutes
-- ---------------------------------------------------------------------------
ALTER TABLE app.consultations ADD COLUMN IF NOT EXISTS raw_notes text;

COMMENT ON COLUMN app.consultations.raw_notes IS
  'Brouillon de travail saisi PENDANT la séance. N''est pas une pièce du '
  'dossier signé et ne bénéficie d''aucune immuabilité : la valeur légale est '
  'portée par app.clinical_notes (ADR-004). Source de lecture d''analyze_session '
  '(S6), qui écrit ailleurs — d''où la séparation.';

-- ---------------------------------------------------------------------------
-- 2 · Une seule note par séance
-- ---------------------------------------------------------------------------
-- Sans cet index, `app.save_note` n'aurait pas de cible définie : deux notes
-- rattachées à la même séance, et « la note de cette consultation » ne veut
-- plus rien dire — l'écran en afficherait une, la signature en toucherait une
-- autre, sans que rien ne le signale.
--
-- La contrainte n'appauvrit pas le dossier : une correction est un AMENDEMENT
-- (008), pas une seconde note. Et `consultation_id` reste nullable, donc les
-- notes hors séance — dont celle du seed de 015 — ne sont pas concernées.
CREATE UNIQUE INDEX IF NOT EXISTS one_note_per_consultation
  ON app.clinical_notes (consultation_id)
  WHERE consultation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3 · Privilèges du porteur des portes de lecture
-- ---------------------------------------------------------------------------
-- ON NOMME AU LIEU D'HÉRITER, pour la raison écrite en 022 : `app_gatekeeper`
-- est membre de `authenticated` avec INHERIT, mais s'appuyer sur une adhésion
-- de rôle pour un privilège de TABLE fait dépendre les portes de deux
-- mécanismes que Postgres n'oblige pas à rester alignés. La panne évitée est la
-- pire à diagnostiquer : migration verte, 42501 à l'exécution.
--
-- ⚠️ SELECT SEULEMENT. `app_gatekeeper` n'obtient AUCUN privilège d'écriture
-- sur `app.clinical_notes` ici, et ne doit jamais en obtenir : toutes les
-- portes d'écriture de ce fichier sont SECURITY INVOKER et écrivent donc sous
-- l'appelante, sous ses policies, sous ses déclencheurs.
GRANT SELECT ON app.consultations           TO app_gatekeeper;
GRANT SELECT ON app.clinical_notes          TO app_gatekeeper;

-- Nécessaire au transfert de propriété, retiré au §8 de ce fichier.
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 4 · Ouvrir, reprendre et clore une séance
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER, comme les portes d'écriture de 022 : `authenticated`
-- possède déjà INSERT/UPDATE sur `app.consultations` (privilèges par défaut de
-- 001), et la policy `consultations_clinical` de 007 porte un `WITH CHECK`.
-- Cette fonction ne teste aucun rôle et ne filtre rien — la RLS décide.
--
-- UNE RÈGLE QUI N'EST PAS DE LA RLS, ET QU'ON ÉCRIT QUAND MÊME : on ne conduit
-- que ses propres séances. `can_see_clinical` rend `true` à la Dr. Larbi
-- (owner) pour les rendez-vous de la Dr #2 — c'est voulu pour la LECTURE, c'est
-- absurde pour l'ouverture d'une séance. Une consultation porte le nom de qui
-- l'a conduite ; la signer au nom d'une autre praticienne serait un faux dans
-- un dossier médical.
--
-- REPRENDRE PLUTÔT QU'ÉCHOUER. L'index `one_open_consult` de 007 interdit deux
-- séances ouvertes pour une même praticienne. Sans le traitement ci-dessous,
-- un rechargement de page rendrait une violation d'unicité illisible. La porte
-- rend donc l'identifiant de la séance déjà ouverte quand c'est LA MÊME, et
-- refuse explicitement quand c'en est une autre — parce que là, il y a
-- vraiment quelque chose à décider : clore la précédente.
--
-- ⚠️ LE RENDEZ-VOUS EST OBLIGATOIRE, ET C'EST UNE DÉCISION DE SÉCURITÉ.
-- Trouvé en relisant ce fichier, pas par un contrôle : une première version
-- acceptait `p_appointment_id NULL` avec un `p_patient_id` libre, pour couvrir
-- le patient reçu sans créneau. Or le `WITH CHECK` de `consultations_clinical`
-- (007) ne porte que sur `practitioner_id` — il ne dit RIEN de `patient_id`.
-- Une praticienne pouvait donc ouvrir une séance, puis écrire une note, sur le
-- dossier d'une patiente de sa consœur.
--
-- Aucune identité ne fuyait : `patients_clinical` (004) masque la ligne, et la
-- jointure de `get_consultation` serait revenue vide. Mais ADR-003 n'interdit
-- pas seulement de LIRE le dossier d'une consœur — il n'y a pas de patient
-- partagé, donc il n'y a pas non plus d'écriture. Une note signée par la
-- mauvaise praticienne dans le dossier d'une patiente est un faux, et
-- l'immuabilité de 008 la rendrait ineffaçable.
--
-- LE GARDE NE PEUT PAS ÊTRE « vérifier que le patient est visible » : `SELECT`
-- sur `app.patients` est révoqué à `authenticated` depuis 017, et cette porte
-- est SECURITY INVOKER — elle n'a pas le droit de regarder. On rattache donc la
-- séance à un rendez-vous, dont l'appartenance EST vérifiable, et dont on tire
-- le patient. `p_patient_id` n'est plus qu'une confirmation croisée.
--
-- Coût assumé : le patient reçu sans créneau demande d'abord un rendez-vous,
-- soit un clic dans l'agenda. C'est aussi un meilleur dossier — une séance sans
-- trace d'agenda ne se retrouve pas six mois plus tard.
-- `CREATE OR REPLACE` NE SAIT PAS RETIRER UN DÉFAUT DE PARAMÈTRE — Postgres
-- répond « cannot remove parameter defaults from existing function ». Il faut
-- donc supprimer d'abord.
--
-- ⚠️ CE `DROP` EST SANS DANGER ICI, ET SEULEMENT ICI. Un DROP emporte le
-- PROPRIÉTAIRE avec lui : sur une porte `SECURITY DEFINER`, la recréation la
-- réattribue à `postgres`, rôle `rolbypassrls`, et la cloison entre
-- praticiennes tombe pendant que la migration reste VERTE — c'est la faute de
-- 018, réapparue en 024/025. `start_consultation` est `SECURITY INVOKER` :
-- elle s'exécute sous l'appelante quel que soit son propriétaire, donc le
-- propriétaire n'a aucun effet de sécurité. NE PAS recopier ce motif sur
-- `app.get_consultation` sans reposer explicitement `OWNER TO app_gatekeeper`.
DROP FUNCTION IF EXISTS app.start_consultation(uuid, uuid);

CREATE OR REPLACE FUNCTION app.start_consultation(
  p_patient_id     uuid,
  p_appointment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_id            uuid;
  v_ouverte       uuid;
  v_ouverte_appt  uuid;
  v_appt_patient  uuid;
  v_appt_prat     uuid;
  v_appt_statut   app.appt_status;
BEGIN
  IF p_patient_id IS NULL OR p_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Séance incomplète : le dossier patient et le rendez-vous sont requis.'
      USING HINT = 'Une séance se rattache toujours à un rendez-vous — voir l''en-tête de 026.';
  END IF;

  BEGIN
    SELECT a.patient_id, a.practitioner_id, a.status
      INTO v_appt_patient, v_appt_prat, v_appt_statut
      FROM app.appointments a WHERE a.id = p_appointment_id;

    -- Ligne masquée par la RLS ou inexistante : la base ne distingue pas les
    -- deux, et cette porte non plus. Dire « ce rendez-vous existe mais ne vous
    -- est pas accessible » divulguerait l'activité d'une autre praticienne.
    IF v_appt_prat IS NULL THEN
      RAISE EXCEPTION 'Rendez-vous introuvable.';
    END IF;

    IF v_appt_prat <> auth.uid() THEN
      RAISE EXCEPTION 'Ce rendez-vous ne vous est pas attribué.'
        USING HINT = 'Une séance porte le nom de qui la conduit ; on ne conduit pas celle d''une consœur.';
    END IF;

    IF v_appt_patient IS DISTINCT FROM p_patient_id THEN
      RAISE EXCEPTION 'Ce rendez-vous ne concerne pas ce dossier patient.';
    END IF;

    IF v_appt_statut IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'Ce rendez-vous est % : aucune séance ne s''y ouvre.', v_appt_statut;
    END IF;
  END;

  SELECT c.id, c.appointment_id INTO v_ouverte, v_ouverte_appt
    FROM app.consultations c
   WHERE c.practitioner_id = auth.uid() AND c.status = 'open';

  IF v_ouverte IS NOT NULL THEN
    IF v_ouverte_appt IS NOT DISTINCT FROM p_appointment_id THEN
      RETURN v_ouverte;   -- reprise : le même geste, rejoué
    END IF;
    RAISE EXCEPTION 'Une séance est déjà ouverte.'
      USING HINT = 'Clôturez la séance en cours avant d''en ouvrir une autre.';
  END IF;

  INSERT INTO app.consultations (cabinet_id, practitioner_id, patient_id,
                                 appointment_id, status, is_synthetic)
  VALUES (app.current_cabinet(), auth.uid(), p_patient_id,
          p_appointment_id, 'open',
          -- DÉRIVÉ DE L'ENVIRONNEMENT, jamais déclaré par l'appelant : la
          -- leçon de 023, dans le fichier qui la rejouerait sinon. Écrit `true`
          -- en dur, chaque séance d'une vraie patiente serait marquée
          -- « synthétique » le jour de la bascule ADR-001.
          app.is_cloud_dev())
  RETURNING id INTO v_id;

  -- La séance ouvre le rendez-vous sur `in_session`. `trg_appt_transition`
  -- (022) refuse déjà de toucher un RDV terminé ou annulé, et on ne redouble
  -- pas sa règle ici : elle vit sur la table, donc elle vaut pour tout le monde.
  UPDATE app.appointments a SET status = 'in_session', updated_at = now()
   WHERE a.id = p_appointment_id AND a.status <> 'in_session';

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.start_consultation(uuid, uuid) IS
  'S5. SECURITY INVOKER : aucune élévation. `practitioner_id` vient de '
  'auth.uid() et `is_synthetic` de l''environnement (ADR-016) — aucune des deux '
  'n''est choisie par l''appelant. Le rendez-vous est OBLIGATOIRE : c''est lui '
  'qui prouve que le dossier relève de l''appelante, le WITH CHECK de 007 ne '
  'portant que sur practitioner_id (ADR-003). Rejouée sur le même rendez-vous, '
  'elle reprend la séance ouverte au lieu de heurter `one_open_consult`.';

-- Sans identité patient : elle ne rend qu'un identifiant de séance, donc AUCUNE
-- ligne d'audit et aucune élévation. Le port d'entrée de l'écran « une séance
-- est en cours » — que la coquille pourra afficher partout sans journaliser une
-- ouverture de dossier à chaque rendu.
CREATE OR REPLACE FUNCTION app.get_open_consultation()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
  SELECT c.id FROM app.consultations c
   WHERE c.practitioner_id = auth.uid() AND c.status = 'open';
$$;

COMMENT ON FUNCTION app.get_open_consultation() IS
  'S5. Rend l''identifiant de la séance ouverte de l''appelante, ou NULL. Ne '
  'nomme personne, donc pas de trace de lecture : journaliser une ouverture de '
  'dossier à chaque rendu de la coquille rendrait audit.log illisible (I4).';

-- La saisie au fil de la séance. Appelée souvent — à chaque pause de frappe —
-- donc délibérément pauvre : aucune jointure, aucune identité, aucun audit de
-- lecture. `trg_audit` (013) journalise l'écriture, ce qui suffit.
CREATE OR REPLACE FUNCTION app.save_raw_notes(p_id uuid, p_texte text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_statut app.consult_status;
  v_id     uuid;
BEGIN
  SELECT c.status INTO v_statut FROM app.consultations c WHERE c.id = p_id;

  IF v_statut IS NULL THEN
    RETURN NULL;   -- inexistante ou hors périmètre : l'appelant lit « introuvable »
  END IF;

  IF v_statut = 'closed' THEN
    RAISE EXCEPTION 'Séance close : ses notes de travail ne se réécrivent plus.'
      USING HINT = 'Une correction du dossier passe par un amendement de la note signée.';
  END IF;

  UPDATE app.consultations c
     SET raw_notes = nullif(btrim(coalesce(p_texte, '')), '')
   WHERE c.id = p_id
  RETURNING c.id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.save_raw_notes(uuid, text) IS
  'S5. Brouillon de travail de la séance. Figé à la clôture — un brouillon '
  'réécrit six mois plus tard n''est plus un compte rendu de ce qui s''est dit.';

-- Clore la séance. `ended_at` renseigné fait calculer `duration_seconds`, qui
-- est une colonne GÉNÉRÉE (007) : on ne l'écrit pas, on ne la lit pas non plus
-- avant qu'elle existe.
CREATE OR REPLACE FUNCTION app.close_consultation(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_statut app.consult_status;
  v_appt   uuid;
  v_id     uuid;
BEGIN
  SELECT c.status, c.appointment_id INTO v_statut, v_appt
    FROM app.consultations c WHERE c.id = p_id;

  IF v_statut IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_statut = 'closed' THEN
    RAISE EXCEPTION 'Cette séance est déjà close.';
  END IF;

  UPDATE app.consultations c
     SET status = 'closed', ended_at = now()
   WHERE c.id = p_id
  RETURNING c.id INTO v_id;

  -- Le rendez-vous suit la séance. La condition sur le statut évite de heurter
  -- `trg_appt_transition` sur un RDV annulé entre-temps : clore une séance ne
  -- doit pas échouer pour une raison qui appartient à l'agenda.
  IF v_appt IS NOT NULL THEN
    UPDATE app.appointments a SET status = 'completed', updated_at = now()
     WHERE a.id = v_appt AND a.status NOT IN ('completed', 'cancelled');
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.close_consultation(uuid) IS
  'S5. Clôt la séance et fait suivre le rendez-vous en `completed`. Ne touche '
  'jamais à la note : une séance close peut porter une note encore en brouillon, '
  'et forcer la signature à la clôture serait signer sous contrainte d''horaire.';

-- ---------------------------------------------------------------------------
-- 5 · La note clinique — brouillon, signature, amendement
-- ---------------------------------------------------------------------------
-- ALLOWLIST STRICTE, et c'est elle qui porte la sécurité de cette porte.
-- Absents par conception :
--   `status`     — la signature a sa propre porte. Laisser passer `status` ici
--                  ferait signer une note par une modification de routine, sans
--                  le geste explicite qui engage la responsabilité médicale.
--   `signed_at`, `signed_by`, `lock_after` — posés par `trg_note_sign` (008) et
--                  par lui seul. Les rendre écrivables permettrait de repousser
--                  sa propre fenêtre de verrouillage, c'est-à-dire de désarmer
--                  I15 depuis l'application.
--   `patient_id`, `practitioner_id`, `cabinet_id`, `consultation_id` — dérivés
--                  de la séance. Une note qu'on peut réattribuer est une note
--                  dont l'auteur n'est plus prouvé.
--
-- LE PARAMÈTRE EST `text`, PAS `jsonb`, ET C'EST LE PORT QUI L'IMPOSE :
-- `RpcArgs` (ADR-020) n'accepte que des scalaires. Même forme qu'en 022, pour
-- que la règle s'apprenne une seule fois.
--
-- ⚠️ CETTE PORTE NE TESTE PAS LE VERROU, ET C'EST DÉLIBÉRÉ. Après signature, la
-- note reste modifiable 15 minutes ; ensuite `trg_note_immutable` lève. Un
-- second test écrit ici serait une DEUXIÈME définition de la fenêtre, fausse le
-- jour où l'une des deux bougerait. La base décide, l'interface affiche.
CREATE OR REPLACE FUNCTION app.save_note(p_consultation_id uuid, p_changes text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  k         text;
  v_note    uuid;
  v_cab     uuid;
  v_prat    uuid;
  v_patient uuid;
  v_changes jsonb := nullif(btrim(coalesce(p_changes, '')), '')::jsonb;
  allowed constant text[] := ARRAY['subjective', 'objective', 'assessment', 'plan'];
BEGIN
  IF v_changes IS NULL OR jsonb_typeof(v_changes) <> 'object' THEN
    RAISE EXCEPTION 'Charge de note invalide : un objet JSON est attendu.';
  END IF;

  -- On REFUSE la clé inconnue au lieu de l'ignorer. Ignorer en silence ferait
  -- croire à la praticienne que sa saisie est enregistrée — sur un dossier
  -- médical, c'est la pire des réponses.
  FOREACH k IN ARRAY ARRAY(SELECT jsonb_object_keys(v_changes)) LOOP
    IF NOT (k = ANY (allowed)) THEN
      RAISE EXCEPTION 'Champ non modifiable par cette porte : %.', k
        USING HINT = 'status, signed_at, signed_by et lock_after sont posés par la base seule (I15).';
    END IF;
  END LOOP;

  SELECT c.cabinet_id, c.practitioner_id, c.patient_id
    INTO v_cab, v_prat, v_patient
    FROM app.consultations c WHERE c.id = p_consultation_id;

  IF v_prat IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT n.id INTO v_note
    FROM app.clinical_notes n WHERE n.consultation_id = p_consultation_id;

  IF v_note IS NULL THEN
    INSERT INTO app.clinical_notes (cabinet_id, practitioner_id, patient_id,
                                    consultation_id, status,
                                    subjective, objective, assessment, plan,
                                    is_synthetic)
    VALUES (v_cab, v_prat, v_patient, p_consultation_id, 'draft',
            nullif(btrim(coalesce(v_changes->>'subjective', '')), ''),
            nullif(btrim(coalesce(v_changes->>'objective',  '')), ''),
            nullif(btrim(coalesce(v_changes->>'assessment', '')), ''),
            nullif(btrim(coalesce(v_changes->>'plan',       '')), ''),
            app.is_cloud_dev())
    RETURNING id INTO v_note;

    RETURN v_note;
  END IF;

  -- Clé absente = inchangée. Clé présente et vide = effacée. Sans cette
  -- distinction, on ne pourrait pas vider un champ SOAP rempli par erreur.
  UPDATE app.clinical_notes n SET
    subjective = CASE WHEN v_changes ? 'subjective'
                      THEN nullif(btrim(coalesce(v_changes->>'subjective', '')), '')
                      ELSE n.subjective END,
    objective  = CASE WHEN v_changes ? 'objective'
                      THEN nullif(btrim(coalesce(v_changes->>'objective', '')), '')
                      ELSE n.objective END,
    assessment = CASE WHEN v_changes ? 'assessment'
                      THEN nullif(btrim(coalesce(v_changes->>'assessment', '')), '')
                      ELSE n.assessment END,
    plan       = CASE WHEN v_changes ? 'plan'
                      THEN nullif(btrim(coalesce(v_changes->>'plan', '')), '')
                      ELSE n.plan END
    -- `updated_at` n'est PAS écrit ici : `enforce_note_immutability` (008) le
    -- pose sur chaque UPDATE. Deux écritures pour une même colonne, et c'est
    -- l'ordre des déclencheurs qui déciderait de la valeur.
  WHERE n.id = v_note
  RETURNING n.id INTO v_note;

  RETURN v_note;
END;
$$;

COMMENT ON FUNCTION app.save_note(uuid, text) IS
  'S5. Brouillon SOAP d''une séance, une note par séance. Allowlist stricte : '
  'status, signed_at, signed_by et lock_after en sont exclus — les poser ici '
  'permettrait de signer par une modification de routine ou de repousser sa '
  'propre fenêtre de verrouillage (I15). Ne teste pas le verrou : 008 le fait.';

-- LA SEULE VOIE `draft` → `signed`.
--
-- `sign_clinical_note` est un outil INTERDIT pour Jarvis (CLAUDE.md) : seule
-- une humaine signe, parce que la signature porte SA responsabilité médicale.
-- Cette fonction n'est pas cet outil — elle est le geste de l'interface, appelé
-- après un clic explicite. Elle ne doit jamais entrer dans l'allowlist Jarvis.
--
-- REFUS D'UNE NOTE VIDE. Une note signée sans contenu est une pièce juridique
-- qui atteste de rien, et elle se retourne contre la praticienne : le dossier
-- affirme qu'une consultation a été documentée. Au moins un des quatre champs
-- SOAP doit porter du texte.
CREATE OR REPLACE FUNCTION app.sign_note(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_statut app.note_status;
  v_vide   boolean;
  v_id     uuid;
BEGIN
  SELECT n.status,
         coalesce(btrim(n.subjective), '') = ''
     AND coalesce(btrim(n.objective),  '') = ''
     AND coalesce(btrim(n.assessment), '') = ''
     AND coalesce(btrim(n.plan),       '') = ''
    INTO v_statut, v_vide
    FROM app.clinical_notes n WHERE n.id = p_id;

  IF v_statut IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_statut = 'signed' THEN
    RAISE EXCEPTION 'Cette note est déjà signée.'
      USING HINT = 'Une correction passe par un amendement.';
  END IF;

  IF v_vide THEN
    RAISE EXCEPTION 'Une note vide ne se signe pas.'
      USING HINT = 'Renseignez au moins un des quatre champs avant de signer.';
  END IF;

  -- `signed_at`, `signed_by` et `lock_after` NE SONT PAS ÉCRITS ICI.
  -- `trg_note_sign` (008) les pose. Une seule source de vérité pour
  -- l'horodatage de signature : c'est celle que le dossier oppose à un juge.
  UPDATE app.clinical_notes n SET status = 'signed'
   WHERE n.id = p_id
  RETURNING n.id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.sign_note(uuid) IS
  'S5, I15. Seule voie draft → signed. N''écrit ni signed_at, ni signed_by, ni '
  'lock_after : trg_note_sign (008) les pose, et une seconde source de vérité '
  'pour l''horodatage de signature ferait mentir le document légal. '
  'À NE JAMAIS exposer à Jarvis — seule une humaine signe.';

-- L'amendement — la seule correction possible après verrouillage (ADR-004).
-- Il ne modifie PAS la note : il s'ajoute à côté, horodaté et signé. C'est ce
-- qui distingue une correction traçable d'une réécriture.
CREATE OR REPLACE FUNCTION app.amend_note(p_note_id uuid, p_motif text, p_corps text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_motif  text := nullif(btrim(coalesce(p_motif, '')), '');
  v_corps  text := nullif(btrim(coalesce(p_corps, '')), '');
  v_statut app.note_status;
  v_id     uuid;
BEGIN
  IF v_motif IS NULL OR v_corps IS NULL THEN
    RAISE EXCEPTION 'Amendement incomplet : motif et contenu sont requis.'
      USING HINT = 'Un amendement sans motif ne se relit pas six mois plus tard.';
  END IF;

  SELECT n.status INTO v_statut FROM app.clinical_notes n WHERE n.id = p_note_id;

  IF v_statut IS NULL THEN
    RETURN NULL;
  END IF;

  -- Amender un brouillon n'a pas de sens : il suffit de le corriger. Autoriser
  -- les deux chemins produirait des dossiers où la même correction est tantôt
  -- visible, tantôt invisible, selon le moment où elle a été faite.
  IF v_statut <> 'signed' THEN
    RAISE EXCEPTION 'Seule une note signée s''amende.'
      USING HINT = 'Un brouillon se corrige directement.';
  END IF;

  INSERT INTO app.clinical_note_amendments (note_id, author_id, reason, body)
  VALUES (p_note_id, auth.uid(), v_motif, v_corps)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.amend_note(uuid, text, text) IS
  'ADR-004, I15. La correction d''une note signée est un ajout VISIBLE à côté '
  'd''elle, jamais un écrasement. La note d''origine reste intacte, mot pour mot.';

-- Les amendements d'une note. Aucune identité PATIENT n'y transite — seulement
-- le nom de l'autrice, qui est une collègue du cabinet et que `profiles` rend
-- déjà lisible. Donc SECURITY INVOKER, et aucune trace de lecture : la trace
-- est écrite par `app.get_consultation`, qui est le geste d'ouverture réel.
CREATE OR REPLACE FUNCTION app.list_amendments(p_note_id uuid)
RETURNS TABLE (
  id          uuid,
  author_id   uuid,
  author_name text,
  reason      text,
  body        text,
  created_at  timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
  SELECT am.id, am.author_id, pr.full_name, am.reason, am.body, am.created_at
    FROM app.clinical_note_amendments am
    LEFT JOIN app.profiles pr ON pr.id = am.author_id
   WHERE am.note_id = p_note_id
   ORDER BY am.created_at, am.id;
$$;

COMMENT ON FUNCTION app.list_amendments(uuid) IS
  'S5. Les amendements d''une note, du plus ancien au plus récent. Ordre '
  'chronologique STRICT : un dossier médical se lit dans le sens où il a été '
  'écrit.';

-- ---------------------------------------------------------------------------
-- 6 · La porte de lecture de la séance — SECURITY DEFINER
-- ---------------------------------------------------------------------------
-- Elle nomme un patient, et `SELECT` sur `app.patients` est révoqué depuis 017.
-- Possédée par `app_gatekeeper` : rôle SANS BYPASSRLS, membre de
-- `authenticated` avec INHERIT TRUE, donc les policies de 004, 007 et 008
-- s'appliquent INCHANGÉES. Le contrôle 12 de `checkpoint-s2.sh` rendrait ROUGE
-- sur un propriétaire `postgres` — c'est la faute de 018, mesurée, et 024/025
-- l'ont failli rejouer par un DROP. Ne pas la rejouer ici.
--
-- CONTEXTE D'AUDIT : `fiche`, et c'est le bon. Ouvrir une séance, c'est ouvrir
-- le dossier médical de quelqu'un — pas jeter un œil à une plage horaire. La
-- preuve I4 de S3 (« une fiche ouverte = +1 ligne, exactement ») reste vraie :
-- l'écran de consultation appelle cette porte une fois à l'ouverture.
--
-- DEUX TEMPS, ET L'ORDRE COMPTE. On lit d'abord `patient_id` sur
-- `app.consultations` — une clé, aucune identité —, on journalise, PUIS on
-- joint `app.patients`. Aucune identité n'est lue avant que la trace existe, et
-- une tentative sur une séance invisible est tracée quand même : c'est ce qu'un
-- audit doit savoir dire.
CREATE OR REPLACE FUNCTION app.get_consultation(p_id uuid)
RETURNS TABLE (
  id                uuid,
  status            app.consult_status,
  started_at        timestamptz,
  ended_at          timestamptz,
  raw_notes         text,
  appointment_id    uuid,
  appointment_kind  app.consult_kind,
  patient_id        uuid,
  record_number     text,
  first_name        text,
  last_name         text,
  practitioner_id   uuid,
  practitioner_name text,
  note_id           uuid,
  note_status       app.note_status,
  subjective        text,
  objective         text,
  assessment        text,
  plan              text,
  signed_at         timestamptz,
  signer_name       text,
  lock_after        timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_patient uuid;
BEGIN
  SELECT c.patient_id INTO v_patient FROM app.consultations c WHERE c.id = p_id;

  PERFORM audit.log_read(v_patient, 'fiche');

  RETURN QUERY
  -- LEFT JOIN sur la note : une séance qui vient de s'ouvrir n'en a pas encore,
  -- et un INNER JOIN ferait DISPARAÎTRE la séance elle-même. L'écran doit
  -- pouvoir afficher une séance sans note — c'est même son état initial.
  SELECT c.id, c.status, c.started_at, c.ended_at, c.raw_notes,
         c.appointment_id, a.kind,
         p.id, p.record_number, p.first_name, p.last_name,
         c.practitioner_id, pr.full_name,
         n.id, n.status, n.subjective, n.objective, n.assessment, n.plan,
         n.signed_at, sg.full_name, n.lock_after
    FROM app.consultations c
    LEFT JOIN app.patients     p  ON p.id  = c.patient_id
    LEFT JOIN app.profiles     pr ON pr.id = c.practitioner_id
    LEFT JOIN app.appointments a  ON a.id  = c.appointment_id
    LEFT JOIN app.clinical_notes n ON n.consultation_id = c.id
    LEFT JOIN app.profiles     sg ON sg.id = n.signed_by
   WHERE c.id = p_id;
END;
$$;

ALTER FUNCTION app.get_consultation(uuid) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.get_consultation(uuid) IS
  'S5, ADR-019/021. Seule porte vers une séance nominative et sa note. Trace '
  '`fiche` AVANT toute lecture d''identité — la tentative est ce qu''un audit '
  'doit savoir dire. N''expose jamais le motif de consultation (ADR-017).';

-- ---------------------------------------------------------------------------
-- 7 · Qui peut franchir les portes
-- ---------------------------------------------------------------------------
-- `PUBLIC` reçoit EXECUTE par défaut sur toute fonction nouvellement créée :
-- sans révocation, `anon` — le visiteur non authentifié — pourrait les appeler.
-- La RLS le renverrait bredouille, mais il sonderait l'existence d'identifiants
-- et produirait des lignes d'audit à volonté.
--
-- `service_role` reste exclu, comme partout depuis 020 : il contourne la RLS
-- par conception, et lui ouvrir une porte auditée reviendrait à lui offrir un
-- export propre plutôt qu'un accès contrôlé.
REVOKE ALL ON FUNCTION app.start_consultation(uuid, uuid)   FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_open_consultation()          FROM PUBLIC;
REVOKE ALL ON FUNCTION app.save_raw_notes(uuid, text)       FROM PUBLIC;
REVOKE ALL ON FUNCTION app.close_consultation(uuid)         FROM PUBLIC;
REVOKE ALL ON FUNCTION app.save_note(uuid, text)            FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sign_note(uuid)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION app.amend_note(uuid, text, text)     FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_amendments(uuid)            FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_consultation(uuid)           FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.start_consultation(uuid, uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION app.get_open_consultation()          TO authenticated;
GRANT EXECUTE ON FUNCTION app.save_raw_notes(uuid, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION app.close_consultation(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION app.save_note(uuid, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION app.sign_note(uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION app.amend_note(uuid, text, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION app.list_amendments(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION app.get_consultation(uuid)           TO authenticated;

-- `app.get_consultation` s'exécute sous `app_gatekeeper` et appelle le noyau
-- d'audit, qui reste refusé à `authenticated` (017 §1) : personne ne peut
-- fabriquer une fausse trace de lecture, seules les portes en produisent.
-- `app_gatekeeper` a déjà EXECUTE sur `audit.log_read` depuis 020 §2.

-- ---------------------------------------------------------------------------
-- 8 · Refermer
-- ---------------------------------------------------------------------------
-- La propriété de la porte de lecture est acquise ; CREATE sur le schéma n'a
-- plus lieu d'être. Un rôle qui peut créer des objets dans `app` pourrait y
-- planter une fonction masquant une fonction du catalogue dans le `search_path`
-- figé des portes.
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

-- PostgREST met son cache de schéma à jour sur notification. Sans ça, les neuf
-- fonctions n'apparaissent dans l'API qu'au prochain redémarrage.
NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('026_consultation_gates')
  ON CONFLICT DO NOTHING;

COMMIT;
