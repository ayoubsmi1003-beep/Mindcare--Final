-- 029_payment_gates — S7a. Les quatre portes de la finance.
--
-- ADDITIF PUR. Ne modifie ni 010, ni 011, ni aucune policy existante — même
-- discipline que 022, 026, 027. `app.payments`, `app.notifications` et leurs
-- trois policies ADR-005 restent exactement ce que 011 en a fait.
--
-- CE QUE CE FICHIER N'EST PAS. Les noms `set_consultation_price` et
-- `record_payment_collected` figurent aussi dans 03-JARVIS-TOOLS.md §4.6. Ce
-- sont des PORTES SQL, pas des outils Jarvis : la décision 3 de S6 gèle la
-- boucle proposer-confirmer et les 7-8 autres outils. Les noms coïncident, le
-- chantier non. Aucune ligne de `app.jarvis_actions` n'est écrite ici.
--
-- LA CLOISON, ADR-005. La recette est filtrée EN BASE, par `app.current_role()`,
-- jamais en JavaScript (règle 4) :
--   owner        → tout le cabinet, toutes praticiennes confondues
--   practitioner → sa seule recette
--   assistant    → ZÉRO LIGNE, et ce n'est pas une erreur — un écran vide, comme
--                  « premier passage, rien à comparer » en 027.
--
-- LE TEMPS EST CELUI DU SERVEUR. Aucune porte de ce fichier ne prend de
-- timestamp en paramètre. `created_at` (défaut de 011), `collected_at`, la
-- période du compteur et l'ordre des reçus sont décidés par `now()` en base. Si
-- l'horloge du poste dérive de deux minutes, c'est la base qui a raison — même
-- raisonnement qu'en 026 sur la fenêtre de 15 minutes, avec une conséquence de
-- plus : un reçu daté de la veille par une horloge fausse est une pièce
-- comptable fausse. `p_day` des deux portes de lecture est un ARGUMENT DE
-- LECTURE, pas une source de temps : il choisit la journée à afficher, il
-- n'horodate rien. S'il se trompe, il affiche la mauvaise journée, il n'écrit
-- rien de faux.
--
-- ⚠️ MAIS LA JOURNÉE EST CELLE DU CABINET, PAS CELLE DU SERVEUR. Postgres tourne
-- en UTC ; Alger est à UTC+1. Les deux portes de lecture convertissent donc
-- `p_day` en minuit LOCAL (`AT TIME ZONE 'Africa/Algiers'`, §4). Sans cela, un
-- encaissement entre minuit et 1 h du matin tomberait dans la recette de la
-- veille — une caisse fausse d'une séance, sur l'écran qui sert à compter
-- l'argent. Le fuseau est écrit en dur parce que le cabinet est à Alger et
-- qu'ADR-001 ne prévoit pas de second site ; le jour où il y en aurait un, il
-- se lirait sur `app.cabinets`, pas ici.
--
-- LA TRACE FINANCIÈRE EXISTE DÉJÀ — AUCUN MÉCANISME PARALLÈLE N'EST CRÉÉ.
-- `app.payments` porte `trg_audit` depuis 013 (liste explicite, `payments` y
-- figure). Toute modification de montant écrit donc déjà dans `audit.log` :
-- `row_id`, `old_values`/`new_values`, `changed_fields`, `actor_id`,
-- `actor_role`, `occurred_at` — les six champs exigés. Une seconde table
-- d'audit financier créerait DEUX VÉRITÉS sur le même événement, et le jour où
-- elles divergent, c'est la pièce comptable qui ment. `audit.log` est déjà en
-- ajout seul (UPDATE/DELETE révoqués à PUBLIC, anon, authenticated,
-- service_role — 013), donc l'immuabilité est tenue par le même dispositif que
-- le reste du dossier. Rien à écrire ici : seulement à prouver (contrôle 17).
--
-- ⚠️ `CREATE OR REPLACE` SEULEMENT, AUCUN `DROP`. Un DROP emporte le
-- propriétaire : à la recréation, une porte SECURITY DEFINER revient à
-- `postgres`, rôle `rolbypassrls`, et la cloison tombe pendant que la migration
-- reste VERTE. C'est la faute de 018, rejouée en 024/025, documentée en 026 §4
-- et en tête de 027. Si un DROP devenait un jour nécessaire sur `day_revenue`
-- ou `list_day_payments`, `ALTER FUNCTION ... OWNER TO app_gatekeeper` doit
-- suivre IMMÉDIATEMENT, dans le même fichier.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0 · Privilège nécessaire au transfert de propriété, retiré au §6
-- ---------------------------------------------------------------------------
-- Symétrie obligatoire, DANS CE FICHIER, pas ailleurs. C'est le défaut n°1
-- trouvé en vérification locale S6 : `ALTER FUNCTION ... OWNER TO
-- app_gatekeeper` exige que LE NOUVEAU PROPRIÉTAIRE possède CREATE sur le
-- schéma — pas seulement que l'exécutant soit superutilisateur. 026 §3 accorde
-- puis retire ce privilège DANS SA PROPRE transaction ; une migration séparée
-- qui l'oublie hérite d'un rôle déjà refermé et échoue en 42501, après une
-- longue série de migrations vertes.
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 1 · Privilèges NOMMÉS, jamais hérités
-- ---------------------------------------------------------------------------
-- 020 §2 ne donne NOMMÉMENT à `app_gatekeeper` que USAGE sur les schémas et
-- SELECT, UPDATE sur `app.patients` — rien sur `app.payments`. Les deux portes
-- DEFINER plus bas s'exécutent sous lui : on nomme le privilège dont elles
-- dépendent au lieu de le laisser à un héritage tacite (motif 026 §3).
GRANT SELECT ON app.consultations TO app_gatekeeper;   -- déjà posé en 026 §3, idempotent
GRANT SELECT ON app.payments      TO app_gatekeeper;
GRANT SELECT ON app.profiles      TO app_gatekeeper;

-- ⚠️ CE `GRANT SELECT` NE RESTREINT RIEN — IL NE FAIT QUE RENDRE EXPLICITE CE
-- QUI EXISTE DÉJÀ. `app_gatekeeper` est membre de `authenticated` avec
-- `INHERIT TRUE` (020 §2, 021), et 001 pose des privilèges par défaut à
-- `authenticated` : le rôle a donc DÉJÀ SELECT, INSERT, UPDATE et DELETE sur
-- `app.payments` par héritage. Écrire ici « il n'a aucun privilège d'écriture »
-- serait faux, et une garantie fausse empêche la relecture suivante de chercher
-- au bon endroit.
--
-- CE QUI PROTÈGE RÉELLEMENT SOUS LES PORTES DEFINER (§4, §5), C'EST LA RLS, PAS
-- L'ABSENCE DE PRIVILÈGE : `app_gatekeeper` n'a PAS `BYPASSRLS`, donc les
-- policies de 011 s'appliquent sous lui, et `auth.uid()` reste celui de
-- l'appelante. Le `GRANT` explicite ci-dessus documente la dépendance au lieu
-- de la laisser reposer sur un héritage qu'une migration future pourrait
-- retirer sans voir ce qu'elle casse — motif 026 §3, « on nomme au lieu
-- d'hériter ».
--
-- Les deux portes d'écriture (§2, §3) sont SECURITY INVOKER : elles écrivent
-- sous l'appelante, sous SES policies. `pay_owner` / `pay_practitioner` sont
-- FOR ALL sans WITH CHECK explicite — le USING vaut donc aussi WITH CHECK, et
-- c'est lui qui décide ce qui passe.

-- ---------------------------------------------------------------------------
-- 1bis · Index — contrat de performance, et la garantie d'unicité
-- ---------------------------------------------------------------------------
-- 011 ne pose que `(practitioner_id, created_at DESC)`. Il sert
-- `list_day_payments` pour une praticienne, mais PAS `day_revenue` pour l'owner,
-- qui filtre sur `cabinet_id` et une journée. Sans cet index, une année
-- d'exploitation transforme la recette du jour en balayage séquentiel — sur
-- l'écran qui doit se lire en une demi-seconde avec un patient qui parle.
CREATE INDEX IF NOT EXISTS payments_cabinet_day
  ON app.payments (cabinet_id, created_at DESC);

-- ⚠️ LES PORTES FILTRENT LA JOURNÉE PAR PLAGE BORNÉE :
--   created_at >= <minuit local> AND created_at < <minuit local + 1 jour>
-- JAMAIS `created_at::date = p_day`, qui applique une transformation à la
-- colonne et écarte l'index. Écrit ici parce que c'est exactement le genre de
-- détail qui se perd à l'implémentation et ne se voit JAMAIS sur un jeu de test
-- de trente lignes. Le contrôle 18 du checkpoint le vérifie par EXPLAIN.

-- Un paiement par séance, garanti par la BASE et pas seulement par la porte.
-- Le verrou du §2 donne un comportement déterministe ; cet index donne la
-- garantie — y compris pour un INSERT en SQL direct qui n'appelle pas la porte.
-- Les deux, pas l'un ou l'autre : même discipline que la fenêtre de 15 minutes
-- en 026, où l'écran affiche et où la base décide.
-- Motif `one_note_per_consultation` (026 §2).
--
-- ⚠️ VÉRIFIÉ AVANT DE LE POSER : `015_seed_data.sql` n'insère AUCUNE ligne dans
-- `app.payments` (ni dans `app.consultations`, d'ailleurs). Rien à violer.
CREATE UNIQUE INDEX IF NOT EXISTS one_payment_per_consultation
  ON app.payments (consultation_id) WHERE consultation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2 · Fixer le tarif — SECURITY INVOKER
-- ---------------------------------------------------------------------------
-- ADR-010 : « le médecin saisit le prix manuellement en fin de séance ».
--
-- FRONTIÈRE TRANSACTIONNELLE. Appelée par PostgREST, cette fonction s'exécute
-- dans UNE SEULE transaction implicite : validation, verrous, allocation du
-- numéro de reçu, écriture du paiement et écriture de la notification
-- réussissent ENSEMBLE ou ne laissent RIEN. Aucun état partiel n'est
-- observable. Ce n'est pas qu'une propriété agréable : `app.next_number` (010)
-- incrémente une ligne de `app.counters`, et un ROLLBACK doit RENDRE ce numéro
-- — c'est précisément ce qu'une SEQUENCE ne ferait pas, et toute la raison
-- d'I17. Un trou dans une numérotation médico-légale est une suspicion.
--
-- CONTRÔLE DE CONCURRENCE. L'ordre des verrous est imposé, et le verrou vient
-- AVANT la décision de créer ou de mettre à jour :
--   1. on verrouille LA SÉANCE (`FOR UPDATE`), ce qui sérialise deux appelants
--      MÊME QUAND AUCUN PAIEMENT N'EXISTE ENCORE. Verrouiller le paiement seul
--      ne suffirait pas : deux transactions ne trouvant ni l'une ni l'autre de
--      ligne insèreraient toutes les deux, et l'une des deux mourrait sur
--      l'index unique — avec un message illisible et un numéro de reçu déjà
--      consommé ;
--   2. on verrouille LE PAIEMENT existant, s'il y en a un, avant de lire
--      `collected_at` et le montant ;
--   3. on insère ou on met à jour.
-- Comportement attendu sous deux onglets, un double clic, un rejeu ou deux
-- requêtes concurrentes : UN SEUL paiement, aucune mise à jour perdue, aucun
-- résultat dépendant de l'ordonnancement. Contrôles 4, 19, 20.
CREATE OR REPLACE FUNCTION app.set_consultation_price(
  p_consultation_id uuid,
  p_amount_dzd      integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_prat       uuid;
  v_patient    uuid;
  v_payment    uuid;
  v_collected  timestamptz;
  v_receipt    text;
  v_num        bigint;
BEGIN
  -- Le montant d'abord : il ne dit rien de la séance, donc le refuser tôt ne
  -- divulgue rien. Le CHECK de 011 (`amount_dzd >= 0`) reste LA barrière — ce
  -- test ne fait que rendre le message lisible à l'écran plutôt que de laisser
  -- remonter une violation de contrainte brute. Contrôle 14.
  IF p_amount_dzd IS NULL THEN
    RAISE EXCEPTION 'Montant absent : indiquez le tarif de la séance.';
  END IF;

  IF p_amount_dzd < 0 THEN
    RAISE EXCEPTION 'Le tarif ne peut pas être négatif.'
      USING HINT = 'ADR-018 : dinars entiers, un tarif offert se saisit à 0.';
  END IF;

  IF p_consultation_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- (1) LE VERROU SUR LA SÉANCE, avant toute décision. Sérialise deux appelants
  -- même si aucun paiement n'existe encore.
  SELECT c.practitioner_id, c.patient_id
    INTO v_prat, v_patient
    FROM app.consultations c
   WHERE c.id = p_consultation_id
     FOR UPDATE;

  -- Séance inexistante OU masquée par la RLS : la base ne distingue pas les
  -- deux, et cette porte non plus. MÊME RETOUR, jamais une erreur qui
  -- séparerait « ce dossier n'existe pas » de « ce dossier existe mais n'est
  -- pas le vôtre » — cloison ADR-003, principe déjà tenu par
  -- `app.get_consultation` (026 §6) et prouvé sur `analyze_session` en S6.
  --
  -- ⚠️ PORTÉE EXACTE DE CETTE GARANTIE, à ne pas surdéclarer : elle vaut pour
  -- les appelantes à qui la RLS MASQUE la séance — `practitioner` sur la séance
  -- d'une consœur, `assistant` sur n'importe laquelle (contrôles 5, 6, 7).
  -- Elle NE vaut PAS pour l'owner, à qui `can_see_clinical` rend `true` : pour
  -- lui, une séance existante mais étrangère atteint le refus explicite ci-
  -- dessous et se distingue donc d'un identifiant inexistant. Ce n'est pas une
  -- fuite — l'owner a déjà accès à cette ligne, il n'y a rien à lui cacher —
  -- mais écrire « les trois cas sont indiscernables » sans cette réserve
  -- rendrait un contrôle vert sur une propriété plus étroite qu'annoncée. Le
  -- contrôle 5bis du checkpoint mesure le cas owner pour ce qu'il est.
  IF v_prat IS NULL THEN
    RETURN NULL;
  END IF;

  -- L'owner LIT la séance d'une consœur (`can_see_clinical` lui rend true) —
  -- ce qui serait absurde ici : le tarif d'une séance appartient à qui l'a
  -- conduite. Refus EXPLICITE, et non NULL, parce qu'à ce stade l'appelante a
  -- déjà légitimement accès à la ligne : il n'y a plus rien à protéger, et un
  -- silence lui ferait croire que le tarif est posé. Exactement le raisonnement
  -- de `start_consultation` (026 §1) sur « on ne conduit pas la séance d'une
  -- consœur ».
  IF v_prat <> auth.uid() THEN
    RAISE EXCEPTION 'Cette séance n''est pas la vôtre : son tarif appartient à qui l''a conduite.';
  END IF;

  -- (2) LE VERROU SUR LE PAIEMENT, avant de lire son état.
  SELECT p.id, p.collected_at, p.receipt_number
    INTO v_payment, v_collected, v_receipt
    FROM app.payments p
   WHERE p.consultation_id = p_consultation_id
     FOR UPDATE;

  IF v_payment IS NOT NULL THEN
    -- REJOUABLE. Un double clic ou un rechargement ne doit produire ni une
    -- violation d'unicité illisible, ni une SECONDE ligne de recette. Même
    -- raisonnement que la reprise de `start_consultation`.
    IF v_collected IS NOT NULL THEN
      RAISE EXCEPTION 'Ce paiement est déjà encaissé : son montant ne se modifie plus.'
        USING HINT = 'Une somme encaissée est une pièce comptable — la corriger se fait hors de cet écran.';
    END IF;

    -- `trg_audit` (013) écrit la trace immuable de cette modification dans
    -- `audit.log`. Rien à journaliser ici : ce serait la seconde vérité.
    UPDATE app.payments
       SET amount_dzd = p_amount_dzd,
           set_by     = auth.uid()
     WHERE id = v_payment;

    -- ⚠️ LA NOTIFICATION EST RÉÉMISE SUR CORRECTION, et ce n'est pas un
    -- doublon : elle porte un MONTANT. Ne l'écrire que sur le chemin INSERT
    -- laisserait l'assistante encaisser le tarif périmé — le premier montant
    -- notifié, pas celui que la praticienne vient de corriger. Une notification
    -- de caisse qui ment sur la somme à encaisser est un défaut de caisse, pas
    -- un défaut d'affichage. Le contrat §2 ne restreint la règle « chemin
    -- INSERT uniquement » qu'au NUMÉRO DE REÇU (I17), jamais à la notification.
    INSERT INTO app.notifications (cabinet_id, recipient_role, kind, payload)
    VALUES (app.current_cabinet(), 'assistant', 'payment_due',
            jsonb_build_object('receipt_number', v_receipt,
                               'amount_dzd',     p_amount_dzd));

    RETURN v_payment;
  END IF;

  -- (3) Chemin INSERT — et LUI SEUL consomme un numéro de reçu. Le rejeu
  -- ci-dessus n'en consomme aucun, et un ROLLBACK rend celui-ci (contrôle 20).
  v_num := app.next_number(app.current_cabinet(), 'payment', to_char(now(), 'YYYY'));

  -- Format documenté ici parce que le dépôt n'en avait aucun précédent :
  -- `REC-<année>-<compteur sur 5 chiffres>`. L'année vient de `now()` en base,
  -- comme la période du compteur — les deux ne peuvent donc pas diverger.
  -- L'UNIQUE (cabinet_id, receipt_number) de 011 en fait une clé du cabinet.
  v_receipt := 'REC-' || to_char(now(), 'YYYY') || '-' || lpad(v_num::text, 5, '0');

  -- AUCUN de ces champs n'est choisi par l'appelant — la leçon de 023, rejouée
  -- ici. `is_synthetic` est DÉRIVÉ de l'environnement (ADR-016, ADR-001) :
  -- écrit `true` en dur, chaque paiement d'une vraie patiente serait marqué
  -- « synthétique » le jour de la bascule ; écrit `false` en dur, le garde de
  -- 016 refuserait l'insertion en cloud-dev.
  INSERT INTO app.payments (cabinet_id, practitioner_id, patient_id,
                            consultation_id, receipt_number, amount_dzd,
                            set_by, is_synthetic)
  VALUES (app.current_cabinet(), auth.uid(), v_patient,
          p_consultation_id, v_receipt, p_amount_dzd,
          auth.uid(), app.is_cloud_dev())
  RETURNING id INTO v_payment;

  -- Le poste assistante de la semaine 2 se branchera sur cette notification en
  -- Realtime sans retoucher la base (D-08). Écrite dès maintenant pour éviter
  -- une migration sur une porte finance déjà en service.
  --
  -- ⚠️ PAYLOAD SANS AUCUNE DONNÉE CLINIQUE NI IDENTIFIANTE (règle 1, I5) : le
  -- numéro de reçu et le montant, RIEN D'AUTRE. Ni nom, ni `patient_id`, ni
  -- motif de consultation. Une notification est le message le plus facile à
  -- faire fuiter — il s'affiche sur un écran que le patient suivant peut voir.
  INSERT INTO app.notifications (cabinet_id, recipient_role, kind, payload)
  VALUES (app.current_cabinet(), 'assistant', 'payment_due',
          jsonb_build_object('receipt_number', v_receipt,
                             'amount_dzd',     p_amount_dzd));

  RETURN v_payment;
END;
$$;

COMMENT ON FUNCTION app.set_consultation_price(uuid, integer) IS
  'S7a. SECURITY INVOKER : aucune élévation, la RLS de 011 décide. Verrouille la '
  'SÉANCE puis le PAIEMENT (FOR UPDATE) avant de choisir entre INSERT et UPDATE '
  '— deux appelants concurrents ne produisent jamais deux lignes. Séance '
  'introuvable OU hors périmètre : même NULL, aucune fuite (ADR-003). Un numéro '
  'de reçu n''est consommé que sur le chemin INSERT, et un ROLLBACK le rend '
  '(I17 : compteur, jamais une SEQUENCE). cabinet_id, practitioner_id, set_by, '
  'patient_id et is_synthetic sont DÉRIVÉS, jamais choisis par l''appelant (023).';

-- ⚠️ OBLIGATOIRE MÊME SUR UNE PORTE INVOKER — 026 §7 le fait pour ses neuf
-- fonctions, y compris les INVOKER, et voici pourquoi : Postgres accorde
-- EXECUTE à `PUBLIC` sur TOUTE fonction neuve. Sans cette révocation,
-- `service_role` — qui a `rolbypassrls` — peut appeler cette porte. « SECURITY
-- INVOKER » ne protège que si l'invocateur est SOUMIS à la RLS ; sous
-- `service_role` la fonction devient une écriture financière sans cloison :
-- n'importe quel cabinet, n'importe quelle praticienne. `anon` obtient en prime
-- un « permission denied for table payments » qui divulgue le schéma.
REVOKE ALL ON FUNCTION app.set_consultation_price(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_consultation_price(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2bis · Lire le tarif d'UNE séance — SECURITY INVOKER
-- ---------------------------------------------------------------------------
-- ⚠️ AJOUT AU CONTRAT GELÉ (docs/S7A-FINANCE.md), REMONTÉ AVANT D'ÊTRE CODÉ.
-- Le §3 du contrat exige que le bloc de fin de séance affiche un tarif DÉJÀ
-- FIXÉ (« montant affiché, modifiable tant que non encaissé, en lecture seule
-- ensuite »). Aucune des quatre portes prévues ne sait le lire :
-- `list_day_payments` est bornée à une JOURNÉE, ne rend pas `consultation_id`,
-- et surtout écrirait une ligne d'audit `liste` À CHAQUE ouverture de l'écran
-- de séance — noyer `audit.log` sous de fausses lectures de dossier est
-- exactement ce qu'I4 interdit, et la raison pour laquelle
-- `get_open_consultation` (026) ne journalise pas non plus.
--
-- Cette porte est donc le strict nécessaire, et rien de plus : elle ne nomme
-- PERSONNE (aucune jointure sur `app.patients`, aucun `patient_id` rendu), donc
-- aucune trace de lecture ; elle est INVOKER, donc la RLS de 011 décide seule ;
-- elle n'ouvre aucune permission nouvelle. Un appel sur une séance hors
-- périmètre rend zéro ligne, comme partout ailleurs.
CREATE OR REPLACE FUNCTION app.get_consultation_payment(p_consultation_id uuid)
RETURNS TABLE (
  payment_id      uuid,
  receipt_number  text,
  amount_dzd      integer,
  collected_at    timestamptz,
  created_at      timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
  SELECT p.id, p.receipt_number, p.amount_dzd, p.collected_at, p.created_at
    FROM app.payments p
   WHERE p.consultation_id = p_consultation_id;
$$;

COMMENT ON FUNCTION app.get_consultation_payment(uuid) IS
  'S7a. Le paiement d''UNE séance, ou zéro ligne. SECURITY INVOKER : la RLS de '
  '011 décide, aucune élévation. Ne nomme aucun patient, donc AUCUNE trace de '
  'lecture — l''écran de séance l''appelle à chaque ouverture, et journaliser '
  'une lecture de dossier à chaque rendu rendrait audit.log illisible (I4). '
  'Ajout au contrat S7a §3, qui exige d''afficher un tarif déjà fixé.';

REVOKE ALL ON FUNCTION app.get_consultation_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_consultation_payment(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Encaisser — SECURITY INVOKER
-- ---------------------------------------------------------------------------
-- VERROU AVANT LE TEST. Sans `FOR UPDATE`, deux clics simultanés lisent tous
-- deux `collected_at IS NULL` et le second ÉCRASE l'horodatage du premier :
-- une perte de mise à jour sur l'heure réelle d'un encaissement. Le verrou rend
-- le test et l'écriture atomiques ; l'idempotence en DÉCOULE au lieu d'être
-- espérée. Contrôles 15 et 21.
--
-- ⚠️ L'ASSISTANTE N'ENCAISSE PAS AU MOIS 1. 011 ne lui accorde que SELECT, avec
-- un commentaire signalant l'écart possible avec 01-SCHEMA.md §10.1. Aucune
-- permission n'est élargie ici : le constat reste SIGNALÉ, non comblé (D-08
-- reporte son front en semaine 2 de toute façon). Cette porte est INVOKER, donc
-- un appel par l'assistante ne touche simplement aucune ligne.
CREATE OR REPLACE FUNCTION app.record_payment_collected(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_id        uuid;
  v_collected timestamptz;
BEGIN
  IF p_payment_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.id, p.collected_at
    INTO v_id, v_collected
    FROM app.payments p
   WHERE p.id = p_payment_id
     FOR UPDATE;

  -- Introuvable ou hors périmètre : même retour, aucune fuite.
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Déjà encaissé : on rend l'id SANS RÉÉCRIRE l'horodatage. Réencaisser n'est
  -- pas un geste, et réécrire `collected_at` effacerait l'heure RÉELLE de
  -- l'encaissement — la seule qui vaille quelque chose dans une caisse.
  IF v_collected IS NOT NULL THEN
    RETURN v_id;
  END IF;

  UPDATE app.payments
     SET collected_by = auth.uid(),
         collected_at = now()          -- le temps du SERVEUR, jamais du poste
   WHERE id = v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.record_payment_collected(uuid) IS
  'S7a. SECURITY INVOKER. Verrouille le paiement (FOR UPDATE) AVANT de tester '
  'collected_at : deux encaissements simultanés n''écrivent l''horodatage qu''une '
  'fois, et c''est celui du premier. Rejouée sur un paiement déjà encaissé, elle '
  'rend son id sans réécrire l''heure réelle. Introuvable ou hors périmètre : NULL.';

-- Même raison qu'au §2 : `PUBLIC` reçoit EXECUTE par défaut, et `service_role`
-- (rolbypassrls) transformerait cette porte INVOKER en encaissement sans
-- cloison — y compris en posant `collected_by` au nom de n'importe qui, ce que
-- la décision 2 du contrat refuse précisément à l'assistante.
REVOKE ALL ON FUNCTION app.record_payment_collected(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_payment_collected(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · La recette du jour — SECURITY DEFINER, la cloison ADR-005
-- ---------------------------------------------------------------------------
-- DEFINER pour la même raison qu'en 027 : `app_gatekeeper` est le seul rôle à
-- qui 020 §2 accorde EXECUTE sur `audit.log_read`. `day_revenue` ne journalise
-- pas (elle ne nomme personne), mais elle partage la forme et le propriétaire
-- de `list_day_payments` : deux portes du même écran, une seule convention.
--
-- ⚠️ `app_gatekeeper` N'A PAS BYPASSRLS et hérite de `authenticated` (020, 021).
-- Les policies de 011 s'appliquent donc TOUJOURS sous cette fonction, et
-- `auth.uid()` reste celui de l'APPELANTE. Le filtrage explicite ci-dessous
-- n'affaiblit rien : il redit en SQL ce que la RLS impose déjà, pour que la
-- règle soit LISIBLE là où elle est décidée. Deux barrières, pas une.
--
-- L'ASSISTANTE REND 0 LIGNE, PAS UNE ERREUR. Un écran vide, comme « premier
-- passage, rien à comparer » en 027. Une exception lui apprendrait qu'il y a
-- quelque chose à ne pas voir.
CREATE OR REPLACE FUNCTION app.day_revenue(p_day date)
RETURNS TABLE (
  total_dzd        bigint,
  seances          bigint,
  attente_nombre   bigint,
  attente_dzd      bigint,
  perimetre        text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_role  app.user_role;
  v_debut timestamptz;
  v_fin   timestamptz;
BEGIN
  IF p_day IS NULL THEN
    RETURN;
  END IF;

  v_role  := app.current_role();
  -- ⚠️ LA JOURNÉE EST CELLE DU CABINET, PAS CELLE DU SERVEUR. Postgres tourne
  -- en UTC ici ; `p_day::timestamptz` donnerait minuit UTC, soit 01:00 à Alger,
  -- et une séance encaissée entre minuit et 1 h du matin tomberait dans la
  -- recette de LA VEILLE. Une recette journalière fausse d'une séance est une
  -- caisse fausse. `AT TIME ZONE` fixe la frontière sur l'heure locale réelle.
  -- Les deux bornes restent des CONSTANTES : l'index `payments_cabinet_day`
  -- reste utilisable, contrairement à un `created_at AT TIME ZONE ...` qui
  -- transformerait la colonne.
  v_debut := p_day::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin   := (p_day + 1)::timestamp AT TIME ZONE 'Africa/Algiers';

  -- `perimetre` est rendu par la BASE pour que l'écran affiche ce qui a
  -- RÉELLEMENT été filtré, et non une étiquette qu'il aurait devinée de son
  -- côté. Le jour où la règle change ici, le sous-titre change avec elle.
  IF v_role = 'owner' THEN
    RETURN QUERY
    SELECT COALESCE(SUM(p.amount_dzd), 0)::bigint,
           COUNT(*)::bigint,
           COUNT(*) FILTER (WHERE p.collected_at IS NULL)::bigint,
           COALESCE(SUM(p.amount_dzd) FILTER (WHERE p.collected_at IS NULL), 0)::bigint,
           'cabinet'::text
      FROM app.payments p
     WHERE p.cabinet_id  = app.current_cabinet()
       -- PLAGE BORNÉE — l'index `payments_cabinet_day` reste utilisable.
       -- `created_at::date = p_day` transformerait la colonne et l'écarterait.
       AND p.created_at >= v_debut
       AND p.created_at <  v_fin;

  ELSIF v_role = 'practitioner' THEN
    RETURN QUERY
    SELECT COALESCE(SUM(p.amount_dzd), 0)::bigint,
           COUNT(*)::bigint,
           COUNT(*) FILTER (WHERE p.collected_at IS NULL)::bigint,
           COALESCE(SUM(p.amount_dzd) FILTER (WHERE p.collected_at IS NULL), 0)::bigint,
           'praticienne'::text
      FROM app.payments p
     WHERE p.cabinet_id      = app.current_cabinet()
       AND p.practitioner_id = auth.uid()
       AND p.created_at >= v_debut
       AND p.created_at <  v_fin;

  END IF;
  -- assistant, patient, rôle absent → aucun RETURN QUERY : zéro ligne.
END;
$$;

ALTER FUNCTION app.day_revenue(date) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.day_revenue(date) IS
  'S7a. La recette d''une journée, cloisonnée EN BASE (ADR-005, règle 4) : owner '
  '→ le cabinet entier, practitioner → sa seule recette, assistant → zéro ligne '
  'et pas une erreur. Rend `perimetre` pour que l''écran nomme ce que la base a '
  'réellement filtré. Ne nomme aucun patient, donc aucune trace de lecture. '
  'Plage bornée sur created_at : l''index payments_cabinet_day reste utilisable.';

REVOKE ALL ON FUNCTION app.day_revenue(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.day_revenue(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5 · Les lignes du jour — SECURITY DEFINER, et CELLE-CI NOMME DES PATIENTS
-- ---------------------------------------------------------------------------
-- DEUX TEMPS, MÊME ORDRE QU'EN 026 §6 ET 027 §1 : on lit d'abord des clés
-- techniques (les `patient_id` concernés, aucune identité), ON JOURNALISE, PUIS
-- on joint `app.patients`. La trace précède donc toujours la lecture du nom.
--
-- ⚠️ CE QUE CET ORDRE NE DONNE PAS, et qu'il ne faut pas lui prêter : il ne
-- trace PAS les tentatives infructueuses. Le temps 1 porte le MÊME prédicat que
-- le temps 2 — zéro ligne visible, zéro itération, zéro trace. C'est structurel
-- et non corrigeable ici : contrairement à `get_consultation` (026 §6), qui
-- journalise le dossier DEMANDÉ, cette porte ne reçoit aucun identifiant de
-- patient à tracer — seulement une date. Une praticienne qui appelle la journée
-- d'une consœur ne laisse donc aucune trace, parce qu'elle n'a rien lu.
-- Journaliser une lecture qui n'a pas eu lieu serait une trace FAUSSE, et une
-- pièce d'audit fausse vaut moins qu'une pièce absente.
--
-- ⚠️ `audit.log_read` n'admet QUE 'fiche', 'recherche', 'liste' (017 §1) — toute
-- autre valeur lève une exception. Un écran de caisse qui affiche une colonne
-- de noms est une LISTE : c'est le contexte exact, et il évite de noyer
-- `audit.log` sous de fausses ouvertures de dossier (I4).
CREATE OR REPLACE FUNCTION app.list_day_payments(p_day date)
RETURNS TABLE (
  payment_id          uuid,
  receipt_number      text,
  amount_dzd          integer,
  collected_at        timestamptz,
  created_at          timestamptz,
  patient_first_name  text,
  patient_last_name   text,
  record_number       text,
  practitioner_name   text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_role  app.user_role;
  v_pat   uuid;
  v_debut timestamptz;
  v_fin   timestamptz;
BEGIN
  IF p_day IS NULL THEN
    RETURN;
  END IF;

  v_role := app.current_role();

  -- L'assistante n'a pas de front cette session, mais la porte est écrite une
  -- fois pour toutes : zéro ligne, AVANT toute trace de lecture — elle n'a rien
  -- lu, journaliser une lecture serait faux.
  IF v_role NOT IN ('owner', 'practitioner') THEN
    RETURN;
  END IF;

  -- Même frontière de journée que day_revenue (§4) : heure locale du cabinet,
  -- pas minuit UTC.
  v_debut := p_day::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin   := (p_day + 1)::timestamp AT TIME ZONE 'Africa/Algiers';

  -- Temps 1 : les clés techniques seules, aucune identité, aucune jointure sur
  -- `app.patients`. Une ligne de trace par dossier réellement approché.
  FOR v_pat IN
    SELECT DISTINCT p.patient_id
      FROM app.payments p
     WHERE p.cabinet_id = app.current_cabinet()
       AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
       AND p.created_at >= v_debut
       AND p.created_at <  v_fin
  LOOP
    PERFORM audit.log_read(v_pat, 'liste');
  END LOOP;

  -- Temps 2 : la lecture nominative, une fois la trace écrite.
  RETURN QUERY
  SELECT p.id, p.receipt_number, p.amount_dzd, p.collected_at, p.created_at,
         pt.first_name, pt.last_name, pt.record_number,
         pr.full_name
    FROM app.payments p
    LEFT JOIN app.patients pt ON pt.id = p.patient_id
    LEFT JOIN app.profiles pr ON pr.id = p.practitioner_id
   WHERE p.cabinet_id = app.current_cabinet()
     AND (v_role = 'owner' OR p.practitioner_id = auth.uid())
     AND p.created_at >= v_debut
     AND p.created_at <  v_fin
   ORDER BY p.created_at DESC;
END;
$$;

ALTER FUNCTION app.list_day_payments(date) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.list_day_payments(date) IS
  'S7a. Les paiements d''une journée, AVEC les noms des patients — donc trace '
  '`liste` dans audit.log AVANT toute lecture d''identité, comme 026 §6 et 027. '
  'Même cloison qu''app.day_revenue : owner → le cabinet, practitioner → ses '
  'seules séances, assistant → zéro ligne et aucune trace (elle n''a rien lu). '
  'Accès indexé uniquement, volume borné par une journée de cabinet.';

REVOKE ALL ON FUNCTION app.list_day_payments(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_day_payments(date) TO authenticated;

-- `day_revenue` et `list_day_payments` s'exécutent sous `app_gatekeeper`, qui a
-- déjà EXECUTE sur `audit.log_read` depuis 020 §2 — aucun GRANT à poser ici.

-- ---------------------------------------------------------------------------
-- 6 · Refermer
-- ---------------------------------------------------------------------------
-- Symétrique du §0, et pour la même raison qu'en 026 §8 et 027 §3 : la
-- propriété des deux portes est acquise, CREATE sur le schéma n'a plus lieu
-- d'être. Un rôle qui peut créer des objets dans `app` pourrait y planter une
-- fonction masquant une fonction du catalogue dans le `search_path` figé des
-- portes.
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('029_payment_gates')
  ON CONFLICT DO NOTHING;

COMMIT;
