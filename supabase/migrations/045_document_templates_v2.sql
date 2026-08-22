-- 045_document_templates_v2 — V8 Documents. Les 4 modèles, version 2.
--
-- Source : docs/DOCUMENT-TEMPLATES-v2.md, « Approved by Dr. Larbi Nassiba »,
--          + les 4 maquettes docs/*.jpg déposées le 2026-08-22.
--          v2 SUPPLANTE docs/DOCUMENT-TEMPLATES.md, retiré du dépôt le même
--          jour par la praticienne.
--
-- ═══ POURQUOI UNE MIGRATION, ALORS QUE 044 VIENT D'ÊTRE APPLIQUÉE ══════════
--
-- Parce que v2 demande une chose que le contrat GELÉ ne sait pas dire.
-- `certificat_medical` doit porter DEUX lignes de traitement, en liste à puces,
-- « et la seconde doit pouvoir rester vide sans forcer deux puces » (v2 §3).
-- Or `issue_document` (030 §2, redéfinie par 043) exige que CHAQUE clé du jeu
-- soit présente ET non vide : `traitement_2` vide était REFUSÉE. Aucun réglage
-- d'écran ne contourne ça — c'est la porte qui refuse, et c'est bien son rôle.
--
-- ⚠️ 042, 043 ET 044 NE SONT PAS TOUCHÉES. Elles sont appliquées ; règle 9. Le
-- texte v1 des modèles reste en base, désactivé, et les certificats déjà émis
-- gardent leur `rendered_html` figé — c'est tout l'objet de l'immuabilité de
-- 010. Un document de juillet ne devient pas rétroactivement un document v2.
--
-- ═══ CE QUE CETTE MIGRATION CHANGE DANS `issue_document`, ET RIEN D'AUTRE ══
--
-- Le corps de la fonction est repris MOT POUR MOT de 043. Diff des lignes de
-- code (commentaires exclus), vérifié avant écriture — QUATRE changements :
--
--   1. `v_facultatives text[]` déclarée ;
--   2. `certificat_medical` : le jeu ['date_naissance','traitement'] devient
--      ['date_naissance','traitement_1','traitement_2'] ;
--   3. `v_facultatives` calculée : ['traitement_2'] pour ce type, vide sinon ;
--   4. le test « chaîne vide » exempte les clés facultatives — et LUI SEUL.
--
-- Tout le reste — cloison, verrou, trace d'audit avant lecture nominative,
-- refus explicite pour l'owner et NULL pour l'assistante, numérotation en
-- Africa/Algiers, écrasement de `jours_lettres`, figeage du HTML — est
-- rigoureusement celui de 043. Le REPRENDRE plutôt que le récrire est
-- délibéré : une fonction de 400 lignes retapée à la main est une fonction
-- dont plus personne ne peut prouver qu'elle n'a pas bougé ailleurs.
--
-- ⚠️ AUCUN `DROP FUNCTION`. `CREATE OR REPLACE` préserve le propriétaire ET les
-- GRANT ; `DROP` les emporte et réattribue la fonction à `postgres`
-- (`rolbypassrls`) — la cloison d'ADR-019 tomberait pendant que la migration
-- resterait verte. C'est le défaut de 018, et il ne se refait pas.
--
-- ═══ « FACULTATIF » VEUT DIRE VIDE, JAMAIS ABSENT ══════════════════════════
--
-- Le test d'égalité d'ensemble reste EXACT : `traitement_2` doit être PRÉSENTE
-- dans le JSON, même vide. Ce n'est pas un scrupule de forme.
--   · Clé ABSENTE → `#>>` rend NULL → `render_template` laisse le marqueur
--     LITTÉRAL (030:291) → « {{vars.traitement_2}} » s'imprime sur un
--     certificat médico-légal. C'est le trou que tout ce module existe pour
--     empêcher.
--   · Clé PRÉSENTE ET VIDE → `#>>` rend '' → substitution RÉELLE → `<li></li>`,
--     que `li:empty` masque dans tokens.css.
-- Les deux se ressemblent en JSON et n'ont rien à voir sur le papier.
--
-- Et `null` JSON reste refusé même pour une clé facultative, pour la même
-- raison : devant `#>>`, `null` se comporte comme une clé absente.
--
-- ⚠️ LA PUCE VIDE EST MASQUÉE PAR LA FEUILLE DE STYLE, PAS PAR DU HTML
-- FABRIQUÉ ICI. Composer la liste côté base réclamerait d'injecter des balises
-- dans une valeur — or `app.html_escape` les échapperait, et c'est exactement
-- ce qu'il doit faire. Le moteur de rendu n'a AUCUN mode HTML brut, et ce lot
-- ne lui en ajoute pas un.
--
-- ═══ CE QUE v2 CHANGE DANS LE TEXTE, ET QUI EST UN ARBITRAGE MÉDICAL ═══════
--
-- ⚠️ `suivi_medical` N'IMPRIME PLUS LA DURÉE EN TOUTES LETTRES. v1 portait
-- « 30 Jours (trente jours) », relevé sur le document Word d'origine ; v2 écrit
-- « de {{vars.jours}} jours ». C'est le choix de la praticienne, appliqué tel
-- quel — c'est son document et sa responsabilité devant un tiers.
--
-- MAIS IL FAUT SAVOIR CE QU'IL COÛTE, et c'est écrit ici pour que personne ne
-- le redécouvre à ses dépens : les lettres étaient une protection
-- ANTI-FALSIFICATION. Un « 30 » se rature en « 90 » au stylo sur un arrêt de
-- travail présenté à un employeur ; « (trente jours) » à côté rend la retouche
-- visible. Cette protection est perdue SUR LE PAPIER.
--
-- Elle n'est PAS perdue en base : `jours_lettres` reste dans le jeu de clés
-- exigé, reste RECALCULÉE et écrasée par `app.nombre_en_lettres` (043 §5bis),
-- et reste dans la colonne `variables`. `042` n'est donc pas devenue du code
-- mort, et rétablir les lettres au papier ne demandera qu'une ligne de modèle.
-- C'est POUR CELA que le jeu de clés de `suivi_medical` n'est pas allégé ici.
--
-- ⚠️ « Mr/Mme/Mlle » REDEVIENT LITTÉRAL, les trois. v1 dérivait
-- `{{patient.civilite}}` du sexe, qui ne connaît que Mr et Mme (`app.sex`, 002)
-- — « Mlle » avait disparu, perte acquittée le 2026-08-21. v2 revient au texte
-- d'origine et la rend. `patient.civilite` reste dans le contexte de rendu,
-- simplement inutilisée par les modèles : on n'enlève rien au moteur.
--
-- ═══ AUCUNE DONNÉE NOMINATIVE ICI ══════════════════════════════════════════
--
-- Les maquettes v2 montrent « Dr. LARBI. N », le n° d'ordre et le téléphone.
-- Ils NE SONT PAS recopiés : v2 dit lui-même « supersedes any earlier versions
-- with practitioner data hardcoded ». Le corps garde donc
-- {{praticien.title}} {{praticien.full_name}} et {{praticien.speciality_fr}} ;
-- les valeurs vivent dans `app.profiles`, saisies sur l'instance, jamais
-- commitées (ADR-016, amendement du 03-08).
--
-- ⚠️ CONSÉQUENCE POUR L'ARBITRAGE A1. v2 corrige « Pychiaterie » →
-- « Psychiatrie » ET met la spécialité sur une seule ligne. Ni l'un ni l'autre
-- ne se corrige dans ce fichier : les deux viennent de
-- `app.profiles.speciality_fr`. A1 reste une CONSIGNE DE SAISIE sur l'instance.
-- Une relecture qui chercherait la correction ici ne la trouvera pas, et aurait
-- tort d'en conclure qu'elle a été perdue.
--
-- Marqueurs : allowlist fermée patient.* · vars.* · praticien.* · cabinet.*
--             Un marqueur inconnu reste littéral. Toute valeur est échappée.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · `issue_document` — le jeu de champs de certificat_medical
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.issue_document(
  p_patient_id      uuid,
  p_doc_type        app.doc_type,
  p_variables       text,
  p_consultation_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_vars      jsonb;
  v_vars_rendu jsonb;   -- 043 : vars + clés serveur. NE VA PAS dans l'INSERT.
  v_jours     integer;  -- 043 : forme de vars->>'jours', contrôlée avant cast.
  v_attendues text[];
  v_facultatives text[];  -- 045 : clés du jeu autorisées à rester VIDES.
  v_recues    text[];
  v_prat      uuid;
  v_pat_id    uuid;
  v_pat       record;
  v_moi       record;
  v_cab       record;
  v_tpl       record;
  v_ctx       jsonb;
  v_html      text;
  v_num       bigint;
  v_numero    text;
  v_id        uuid;
  v_c_prat    uuid;
  v_c_pat     uuid;
BEGIN
  IF p_patient_id IS NULL OR p_doc_type IS NULL THEN
    RETURN NULL;
  END IF;

  -- (1) Le JSON d'abord : il ne dit rien du dossier, donc le refuser tôt ne
  -- divulgue rien. Un texte non parsable et un tableau JSON sont l'un et
  -- l'autre refusés — `vars` est un OBJET de clés nommées, pas autre chose.
  BEGIN
    v_vars := COALESCE(p_variables, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Variables illisibles : le document n''a pas été émis.'
      USING HINT = 'p_variables doit être un objet JSON sérialisé (ADR-020).';
  END;

  IF jsonb_typeof(v_vars) <> 'object' THEN
    RAISE EXCEPTION 'Variables invalides : un objet JSON est attendu.';
  END IF;

  -- (2) Le jeu de champs EXACT du type, fixé par ADR-011. Ni clé en trop — comme
  -- `save_note` refuse une clé hors SOAP — ni clé manquante : un certificat
  -- d'arrêt sans nombre de jours est un certificat défectueux, pas un
  -- brouillon, et il partira quand même à l'impression si on le laisse passer.
  --
  -- ⚠️ `doc_type` COUVRE AUJOURD'HUI LES 4 VALEURS DE L'ENUM (002), MAIS UN
  -- `CASE` SANS `ELSE` SERAIT SILENCIEUX LE JOUR OÙ UNE 5ᵉ VALEUR ARRIVE
  -- (`ordonnance`, §B9, annoncée mais hors périmètre) : `v_attendues` vaudrait
  -- NULL, `NOT (v_recues @> NULL AND …)` vaudrait NULL, et le `IF` ci-dessous
  -- NE SE DÉCLENCHERAIT PAS — un document partirait sans AUCUNE validation de
  -- champs. Défaut trouvé en revue. Le garde explicite ferme ce trou avant
  -- qu'il n'existe.
  v_attendues := CASE p_doc_type
    WHEN 'bonne_sante_mentale' THEN ARRAY['id_document_number','mairie']
    WHEN 'suivi_medical'       THEN ARRAY['jours','jours_lettres','date_debut']
    WHEN 'certificat_medical'  THEN ARRAY['date_naissance','traitement_1','traitement_2']
    WHEN 'justification'       THEN ARRAY['date_consultation']
  END;

  -- 045 · LES CLÉS FACULTATIVES. `traitement_2` est la SECONDE ligne de la
  -- liste de traitements du certificat médical : DOCUMENT-TEMPLATES-v2 §3
  -- demande explicitement qu'elle puisse rester vide sans forcer deux puces.
  --
  -- ⚠️ ELLE RESTE OBLIGATOIREMENT PRÉSENTE DANS LE JEU DE CLÉS. Facultative
  -- veut dire « peut être vide », pas « peut être absente » : le test d'égalité
  -- d'ensemble ci-dessous reste EXACT, et une clé oubliée est toujours un
  -- refus. Relâcher l'ensemble ferait rentrer par la fenêtre le « brouillon »
  -- que 030 §2 refuse par la porte.
  --
  -- ⚠️ ET ELLE NE PEUT PAS LAISSER DE MARQUEUR. Une chaîne VIDE n'est pas NULL :
  -- `#>>` rend '' et `render_template` substitue pour de bon (030:291). C'est
  -- une clé ABSENTE du contexte qui resterait littérale — d'où l'exigence de
  -- présence ci-dessus. La puce vide est ensuite masquée par `li:empty` dans
  -- tokens.css, jamais par du HTML fabriqué ici : `html_escape` échapperait
  -- toute balise qu'on tenterait d'injecter, et c'est exactement ce qu'il faut.
  v_facultatives := CASE p_doc_type
    WHEN 'certificat_medical' THEN ARRAY['traitement_2']
    ELSE ARRAY[]::text[]
  END;

  IF v_attendues IS NULL THEN
    RAISE EXCEPTION 'Type de document non pris en charge par ce moteur : %.', p_doc_type
      USING HINT = 'Un type ajouté à l''enum doit d''abord recevoir son propre jeu de champs ici.';
  END IF;

  SELECT array_agg(k ORDER BY k) INTO v_recues FROM jsonb_object_keys(v_vars) AS k;
  v_recues := COALESCE(v_recues, ARRAY[]::text[]);

  IF NOT (v_recues @> v_attendues AND v_recues <@ v_attendues) THEN
    RAISE EXCEPTION 'Champs du document incorrects. Attendus : %.',
                    array_to_string(v_attendues, ', ')
      USING HINT = 'Ni clé absente, ni clé en trop — le jeu est celui d''ADR-011.';
  END IF;

  -- ⚠️ LE JEU DE CLÉS NE SUFFIT PAS — DÉFAUT TROUVÉ EN REVUE. `{"jours": null}`
  -- passe le test ci-dessus (la clé existe) puis `#>>` rend NULL dans
  -- `render_template`, qui laisse le marqueur LITTÉRAL : un certificat part
  -- avec `{{vars.jours}}` écrit noir sur blanc. Une chaîne vide fait le même
  -- trou en silence. Chaque valeur doit donc être un SCALAIRE non vide — un
  -- objet ou un tableau imbriqué serait de toute façon injecté tel quel (JSON
  -- brut, illisible sur un certificat) par le même chemin.
  DECLARE
    v_cle text;
  BEGIN
    FOREACH v_cle IN ARRAY v_attendues LOOP
      -- 045 : `null` JSON reste refusé MÊME pour une clé facultative. `#>>`
      -- rendrait NULL, donc `render_template` laisserait le marqueur littéral
      -- sur le papier — le trou que tout ce module existe pour empêcher.
      -- « Facultatif » veut dire chaîne VIDE, jamais `null`.
      IF v_vars -> v_cle IS NULL OR jsonb_typeof(v_vars -> v_cle) = 'null' THEN
        RAISE EXCEPTION 'Champ « % » vide : un certificat ne part pas avec un blanc.', v_cle;
      END IF;
      IF jsonb_typeof(v_vars -> v_cle) NOT IN ('string', 'number', 'boolean') THEN
        RAISE EXCEPTION 'Champ « % » invalide : une valeur simple est attendue, pas une structure.', v_cle;
      END IF;
      IF jsonb_typeof(v_vars -> v_cle) = 'string' AND btrim(v_vars ->> v_cle) = ''
         AND NOT (v_cle = ANY (v_facultatives)) THEN
        RAISE EXCEPTION 'Champ « % » vide : un certificat ne part pas avec un blanc.', v_cle;
      END IF;
    END LOOP;
  END;

  -- (2ter) 043 · LA FORME DE « jours », avant tout cast.
  -- 030 garantit que la valeur est scalaire et non vide — pas qu'elle est un
  -- nombre. Sans ce garde, le cast du §6bis lèverait un 22P02 brut
  -- (« invalid input syntax for type integer: "trente" »), illisible pour la
  -- praticienne et porteur de la valeur saisie. On refuse en français, ici.
  IF p_doc_type = 'suivi_medical' THEN
    IF (v_vars ->> 'jours') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Nombre de jours invalide : un entier est attendu.'
        USING HINT = 'La version en lettres est calculée par la base, ne la saisissez pas.';
    END IF;
    v_jours := (v_vars ->> 'jours')::int;
    IF v_jours < 1 OR v_jours > 365 THEN
      RAISE EXCEPTION 'Nombre de jours hors bornes : un arret de travail se compte entre 1 et 365 jours.';
    END IF;
  END IF;

  -- (3) LE VERROU SUR LE DOSSIER, avant toute décision : il sérialise deux
  -- émissions concurrentes sur le même patient (contrôle 16).
  --
  -- DEUX TEMPS, motif de 029 §5 / 026 §6 / get_document (§3 plus bas) : ce
  -- premier SELECT ne lit AUCUNE identité — seulement la clé technique
  -- `practitioner_id`, qui sert à DÉCIDER si l'émission est autorisée. Rien de
  -- nominatif ne sort encore de cette fonction.
  SELECT p.id, p.practitioner_id
    INTO v_pat_id, v_prat
    FROM app.patients p
   WHERE p.id = p_patient_id
     FOR UPDATE;

  -- Dossier inexistant OU masqué par la RLS : la base ne distingue pas les deux,
  -- et cette porte non plus. MÊME RETOUR, jamais une erreur qui séparerait « ce
  -- dossier n'existe pas » de « ce dossier existe mais n'est pas le vôtre » —
  -- cloison ADR-003. Contrôles 5, 6, 7. Aucune lecture d'identité n'a eu lieu :
  -- rien à tracer.
  IF v_pat_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- ÉMETTRE EST PLUS ÉTROIT QUE LIRE. L'owner LIT le dossier d'une consœur
  -- (`can_see_clinical` lui rend true) et l'assistante aussi
  -- (`patients_assistant_read`, 004) — ce qui serait absurde ici : un
  -- certificat porte un NOM et engage une responsabilité médicale nominative.
  -- On ne signe pas pour une consœur, et l'assistante ne signe jamais rien.
  --
  -- ⚠️ DÉFAUT TROUVÉ EN REVUE, corrigé ici : les DEUX rôles qui voient la ligne
  -- (owner, assistant) ne reçoivent PAS le même traitement, et c'est délibéré,
  -- pas un oubli.
  --   - OWNER : refus EXPLICITE, jamais NULL. À ce stade il a déjà légitimement
  --     accès à la ligne (can_see_clinical lui rend true en LECTURE) : il n'y a
  --     plus rien à protéger, et un silence lui ferait croire que le document
  --     est parti. Même raisonnement que
  -- `start_consultation` (026 §1) et `set_consultation_price` (029 §2).
  --   - ASSISTANT : NULL, comme une praticienne masquée par la RLS. Sa
  --     visibilité vient d'une policy ADMINISTRATIVE (`patients_assistant_read`)
  --     qui ne lui donne AUCUNE prétention clinique sur le dossier — un refus
  --     parlant lui apprendrait qu'un document existe potentiellement là où elle
  --     n'a rien à faire. `app.current_role()` distingue les deux : c'est la
  --     SEULE fonction du fichier qui teste le rôle directement plutôt que de
  --     laisser la RLS décider seule, précisément parce que la RLS rend les deux
  --     rôles visibles pour des raisons différentes (clinique vs administratif)
  --     et que ce fichier doit les traiter différemment. Prouvé par un
  --     contrôle 5bis dans `checkpoint-s7b.sh` (owner → RAISE) et par le
  --     contrôle 6 gelé (assistant → NULL, identique à practitioner hors
  --     périmètre) — même motif que le 5bis déjà écrit et revu pour
  --     `set_consultation_price` (029 §2, `checkpoint-s7.sh`) : ce n'est pas un
  --     numéro inventé, c'est le complément que ce fichier ajoute à son propre
  --     checkpoint pour prouver une garantie plus étroite que le texte gelé.
  IF v_prat <> auth.uid() THEN
    IF app.current_role() = 'owner' THEN
      RAISE EXCEPTION 'Ce dossier n''est pas le vôtre : un certificat est signé par la praticienne qui suit le patient.';
    END IF;
    RETURN NULL;
  END IF;

  -- (4) La séance rattachée, si elle est fournie, doit être la sienne ET porter
  -- sur CE patient — même raisonnement que le rendez-vous obligatoire de 026.
  -- ⚠️ LES DEUX CONDITIONS, PAS UNE SEULE : vérifier seulement le praticien
  -- laisserait une praticienne rattacher à un certificat de b1 une séance qui
  -- appartient à b2 — même praticienne, mauvais dossier. `document.patient_id`
  -- et `document.consultation_id` pointeraient alors deux patients différents,
  -- une incohérence qui ne se voit à l'écran qu'en ouvrant la séance liée.
  IF p_consultation_id IS NOT NULL THEN
    SELECT c.practitioner_id, c.patient_id INTO v_c_prat, v_c_pat
      FROM app.consultations c
     WHERE c.id = p_consultation_id;

    IF v_c_prat IS NULL OR v_c_prat <> auth.uid() OR v_c_pat <> p_patient_id THEN
      RAISE EXCEPTION 'Séance introuvable, hors de votre périmètre, ou d''un autre patient : document non émis.';
    END IF;
  END IF;

  -- TEMPS 2 : la décision d'émettre est prise (patient autorisé, séance le cas
  -- échéant cohérente). Trace AVANT toute lecture nominative — même motif que
  -- `get_document` (§3) et `list_patient_documents` (§3) : la trace précède
  -- toujours le nom.
  PERFORM audit.log_read(p_patient_id, 'fiche');

  SELECT p.first_name, p.last_name, p.record_number, p.birth_date,
         p.id_document_number, p.sex
    INTO v_pat
    FROM app.patients p
   WHERE p.id = p_patient_id;

  -- 043 · DOSSIER INCOMPLET → REFUS, JAMAIS UN BLANC.
  -- `civilite` dérive de `sex`, `age` et `birth_date_fr` de `birth_date`.
  -- L'une des deux colonnes manquante, ces clés vaudraient NULL et
  -- `render_template` laisserait « {{patient.civilite}} » LITTÉRAL sur le
  -- papier — exactement le défaut que cette migration existe pour fermer.
  -- Même principe qu'au §2 de 030 : « un certificat ne part pas avec un blanc ».
  IF v_pat.sex IS NULL OR v_pat.birth_date IS NULL THEN
    RAISE EXCEPTION 'Dossier incomplet : le certificat n''a pas ete emis.'
      USING HINT = 'Renseignez le sexe et la date de naissance dans le dossier, puis reessayez.';
  END IF;

  -- (5) Le modèle ACTIF le plus récent. AUCUN MODÈLE → EXCEPTION : on n'émet
  -- jamais un document sans modèle. Un certificat sans corps n'est pas un
  -- document vide, c'est une pièce qui sortira du cabinet quand même.
  SELECT t.title_fr, t.header_html, t.body_html, t.footer_html
    INTO v_tpl
    FROM app.document_templates t
   WHERE t.cabinet_id = app.current_cabinet()
     AND t.doc_type   = p_doc_type
     AND t.is_active
   ORDER BY t.version DESC
   LIMIT 1;

  IF v_tpl.body_html IS NULL THEN
    RAISE EXCEPTION 'Aucun modèle actif pour ce type de document (%).', p_doc_type
      USING HINT = 'Les modèles sont fournis par la praticienne — ils ne s''inventent pas (D-12).';
  END IF;

  SELECT pr.full_name, pr.title, pr.speciality_fr, pr.speciality_ar,
         pr.order_number, pr.phone, pr.signature_block
    INTO v_moi
    FROM app.profiles pr
   WHERE pr.id = auth.uid();

  SELECT cb.name, cb.address, cb.phone
    INTO v_cab
    FROM app.cabinets cb
   WHERE cb.id = app.current_cabinet();

  -- (5bis) 043 · LES DEUX CLÉS SERVEUR DE `vars`.
  --
  -- ⚠️ ELLES VONT DANS LE RENDU, PAS DANS L'INSERT. `v_vars_rendu` sert à
  -- construire le contexte ; `v_vars` — ce que l'appelante a réellement soumis
  -- — reste ce qui est stocké dans la colonne `variables`. La colonne demeure
  -- la trace de la SAISIE, `rendered_html` demeure la PIÈCE. Les confondre
  -- ferait mentir l'une ou l'autre.
  --
  -- POURQUOI ICI ET PAS DANS `render_template`. Ajouter un préfixe
  -- `document.` à l'allowlist reviendrait à rouvrir le moteur — « chaque
  -- capacité ajoutée ici serait une capacité offerte à qui écrirait un modèle »
  -- (030 §1quater). Passer par `vars` obtient le même résultat sans toucher
  -- une ligne de `render_template`, qui reste RIGOUREUSEMENT celle de 030.
  --
  -- `date_affichee` : l'en-tête des quatre documents porte une date. Pour
  -- `justification`, le corps dit « à la date sus-citée » et renvoie donc à
  -- une consultation PASSÉE — c'est `date_consultation` qui s'affiche, décision
  -- de la praticienne du 2026-08-21. Pour les trois autres, la date du jour,
  -- prise en Africa/Algiers comme le numéro (030 §8), jamais en UTC serveur.
  v_vars_rendu := v_vars || jsonb_build_object(
    'date_affichee',
    CASE p_doc_type
      WHEN 'justification' THEN v_vars ->> 'date_consultation'
      ELSE to_char(now() AT TIME ZONE 'Africa/Algiers', 'DD/MM/YYYY')
    END);

  -- `jours_lettres` : RECALCULÉE ET ÉCRASÉE. La valeur reçue a passé la
  -- validation de 030 (présente, scalaire, non vide) et n'est plus regardée :
  -- ce qui s'imprime vient de `app.nombre_en_lettres` (042), pas de
  -- l'appelante. Sans cet écrasement, {"jours":"30","jours_lettres":"trois"}
  -- produirait un certificat qui se contredit lui-même — un faux.
  IF p_doc_type = 'suivi_medical' THEN
    v_vars_rendu := v_vars_rendu
      || jsonb_build_object('jours_lettres', app.nombre_en_lettres(v_jours));
  END IF;

  -- (6) Le contexte de rendu — construit ICI, à partir de la base, jamais reçu
  -- de l'appelant. Seul `vars` vient de lui, et il vient de passer l'allowlist.
  v_ctx := jsonb_build_object(
    'patient', jsonb_build_object(
        'first_name',         v_pat.first_name,
        'last_name',          v_pat.last_name,
        'record_number',      v_pat.record_number,
        'birth_date',         v_pat.birth_date,
        'id_document_number', v_pat.id_document_number,
        -- 043 · TROIS CLÉS DÉRIVÉES, calculées ici et nulle part ailleurs.
        -- `civilite` : l'enum app.sex (002) ne connaît que 'M' et 'F'. « Mlle »
        -- n'est donc PAS dérivable et disparaît des certificats — perte
        -- fonctionnelle par rapport aux documents Word d'origine, acquittée
        -- par la praticienne le 2026-08-21. Ne pas la « rétablir » en devinant.
        'civilite',      CASE v_pat.sex WHEN 'M' THEN 'Mr' WHEN 'F' THEN 'Mme' END,
        -- `age` : calculé À L'ÉMISSION, en Africa/Algiers. Un âge stocké
        -- vieillirait mal ; un âge calculé en UTC serait faux une heure par nuit.
        'age',           extract(year FROM age(
                           (now() AT TIME ZONE 'Africa/Algiers')::date,
                           v_pat.birth_date))::int::text,
        -- `birth_date_fr` : `birth_date` est une `date`, que jsonb sérialise
        -- « 2022-01-01 ». Un certificat algérien écrit « 01/01/2022 ». La clé
        -- brute reste exposée : on n'enlève rien, on ajoute.
        'birth_date_fr', to_char(v_pat.birth_date, 'DD/MM/YYYY')),
    'praticien', jsonb_build_object(
        'full_name',     v_moi.full_name,
        'title',         v_moi.title,
        'speciality_fr', v_moi.speciality_fr,
        'speciality_ar', v_moi.speciality_ar,
        'order_number',  v_moi.order_number,
        'phone',         v_moi.phone,
        -- 043 · LE NOM ARABE DE L'EN-TÊTE. `app.profiles` (003) n'a pas de
        -- colonne pour lui — seulement `speciality_ar`. Plutôt que d'ajouter
        -- une colonne absente de 01-SCHEMA.md (règle 9), il vit dans le
        -- `signature_block jsonb` qui existe déjà. Décision du 2026-08-21.
        -- Absent → la clé vaut NULL → le marqueur reste LITTÉRAL et se voit,
        -- ce qui est le comportement voulu : un en-tête muet serait pire.
        'full_name_ar',  v_moi.signature_block ->> 'full_name_ar'),
    'cabinet', jsonb_build_object(
        'name',    v_cab.name,
        'address', v_cab.address,
        'phone',   v_cab.phone),
    'vars', v_vars_rendu);

  -- (7) LE RENDU, ET LE FIGEAGE. Si le modèle change en 2027, le document de
  -- 2026 reste RIGOUREUSEMENT ce qui a été remis au patient (010). Contrôle 11.
  v_html := app.render_template(v_tpl.header_html, v_ctx)
         || app.render_template(v_tpl.body_html,   v_ctx)
         || COALESCE(app.render_template(v_tpl.footer_html, v_ctx), '');

  -- (8) LE NUMÉRO, EN DERNIER — et un ROLLBACK le rend (I17, contrôles 15/15bis).
  -- Format `DOC-<année>-<compteur sur 5 chiffres>`, sur le modèle de `REC-` en
  -- 029.
  --
  -- ⚠️ DÉFAUT TROUVÉ EN REVUE, corrigé ici : « l'année vient de now() » est vrai
  -- côté serveur et FAUX côté cabinet. Postgres tourne en UTC ; Alger est à
  -- UTC+1. Un certificat émis entre 00h00 et 01h00 heure d'Alger le 1er janvier
  -- aurait reçu l'année UTC de la veille — `DOC-2026-000xx` alors que
  -- `issued_at` (010, timestamptz) marque déjà 2027, et imputé au compteur de
  -- la MAUVAISE période. C'est exactement le piège qu'029_payment_gates.sql
  -- §2quater a identifié et corrigé pour la caisse ; il rejoue ici sans
  -- `AT TIME ZONE`. `issued_at` lui-même n'a pas besoin de correction : un
  -- `timestamptz` est un instant absolu, la conversion ne concerne que ce texte
  -- LISIBLE qu'est l'année du numéro.
  v_num    := app.next_number(app.current_cabinet(), 'document',
                               to_char(now() AT TIME ZONE 'Africa/Algiers', 'YYYY'));
  v_numero := 'DOC-' || to_char(now() AT TIME ZONE 'Africa/Algiers', 'YYYY')
                     || '-' || lpad(v_num::text, 5, '0');

  -- AUCUN de ces champs n'est choisi par l'appelant — la leçon de 023, rejouée.
  -- `is_synthetic` est DÉRIVÉ de l'environnement (ADR-016, ADR-001) : 016
  -- l'ajoute PAR DÉCOUVERTE à toute table portant `patient_id`, donc à
  -- `app.documents`, avec le trigger `assert_synthetic`. Écrit `true` en dur,
  -- chaque certificat d'une vraie patiente serait marqué « synthétique » le jour
  -- de la bascule ; écrit `false` en dur, le garde de 016 refuserait l'insertion
  -- en cloud-dev. `issued_at` vient du DÉFAUT de la table : le temps du serveur.
  INSERT INTO app.documents (cabinet_id, practitioner_id, patient_id,
                             consultation_id, doc_type, doc_number,
                             variables, rendered_html, is_synthetic)
  VALUES (app.current_cabinet(), auth.uid(), p_patient_id,
          p_consultation_id, p_doc_type, v_numero,
          v_vars, v_html, app.is_cloud_dev())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ⚠️ `OWNER TO` REPOSÉ IMMÉDIATEMENT APRÈS LA FONCTION, motif de 030:640 et
-- 043:469. `CREATE OR REPLACE` conserve normalement le propriétaire ; on le
-- repose quand même, parce qu'une cloison qu'on suppose intacte est une cloison
-- qu'on ne vérifie plus. Le §4 la contrôle ensuite.
ALTER FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) IS
  'Emet un document et fige son HTML. 045 : certificat_medical attend '
  'date_naissance, traitement_1 et traitement_2 ; traitement_2 peut etre une '
  'chaine VIDE (presente mais vide) — la puce correspondante est masquee par '
  'li:empty dans tokens.css. Toutes les autres garanties sont celles de 043.';

REVOKE ALL ON FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2 · LES MODÈLES v2
-- ---------------------------------------------------------------------------
-- L'en-tête est repris À L'IDENTIQUE de 044 : les maquettes v2 montrent le même
-- bloc, et ses marqueurs sont déjà ceux du contexte de rendu. Le recopier plutôt
-- que le partager par référence est le choix de 044, maintenu : `issue_document`
-- lit `header_html` DE LA LIGNE DU MODÈLE, et un en-tête partagé rendrait le
-- catalogue incohérent avec lui-même le jour d'une correction de version.
CREATE TEMP TABLE _hdr2(html text) ON COMMIT DROP;
INSERT INTO _hdr2
SELECT DISTINCT header_html FROM app.document_templates WHERE version = 1;

-- ⚠️ LE CAS « AUCUN CABINET » N'EST PAS UNE ERREUR. Sur une base rejouee a
-- vide, 044 ne seme rien et son propre controle passe (0 = 0 x 4). Exiger un
-- en-tete v1 ici ferait ECHOUER LE REJEU INTEGRAL du corpus — le controle 12 du
-- checkpoint — sur une base parfaitement saine. On n'exige l'en-tete que s'il y
-- a quelque chose a en-teter.
DO $chk$
DECLARE
  v_n   integer;
  v_cab integer;
BEGIN
  SELECT count(*) INTO v_cab FROM app.cabinets;
  SELECT count(*) INTO v_n   FROM _hdr2;

  IF v_cab > 0 AND v_n <> 1 THEN
    RAISE EXCEPTION '045 : % en-tete(s) v1 distinct(s), 1 attendu — le catalogue v1 n est pas homogene.', v_n;
  END IF;
END $chk$;

-- Les modèles v1 sortent de service. Ils RESTENT EN BASE : `document_templates`
-- porte l'historique des versions, et `issue_document` prend « le modèle ACTIF
-- le plus récent » (043 §5). Les supprimer effacerait la trace de ce qui a été
-- imprimé avant aujourd'hui.
UPDATE app.document_templates SET is_active = false WHERE version = 1;

INSERT INTO app.document_templates
       (cabinet_id, doc_type, version, title_fr, header_html, body_html, footer_html, is_active)
SELECT c.id, t.doc_type, 2, t.title_fr, h.html, t.body_html, NULL, true
FROM   app.cabinets c
CROSS  JOIN _hdr2 h
CROSS  JOIN (VALUES

-- ── 2.1 · Certificat de bonne santé mentale ─────────────────────────────────
--    v2 §1. Un seul paragraphe pour l'identité et la pièce d'identité, là où v1
--    en faisait trois alinéas indentés. Les maquettes montrent des paragraphes
--    AU FER À GAUCHE : plus de `doc-alinea`, et ce n'est pas un oubli.
 ('bonne_sante_mentale'::app.doc_type,
  'Certificat de bonne santé mentale',
  $B1$
<h1 class="doc-titre">Certificat de bonne santé mentale</h1>

<p>Je soussignée, {{praticien.title}} {{praticien.full_name}}, {{praticien.speciality_fr}},
Certifie avoir reçu et examiné ce jour Mr/Mme/Mlle {{patient.last_name}} {{patient.first_name}},
âgé(e) de {{patient.age}} ans, porteur(euse) de la pièce d'identité n° {{vars.id_document_number}},
délivrée par la mairie de {{vars.mairie}}.</p>

<p>Et déclare qu'il/elle ne présente, à l'examen de ce jour, aucun trouble psychique apparent
et est apte à assurer ses responsabilités civiles.</p>

<p>Certificat établi à la demande de l'intéressé(e) et remis en main propre, pour servir et
valoir ce que de droit en vue de l'établissement d'un acte notarié.</p>
  $B1$),

-- ── 2.2 · Certificat de suivi médical ───────────────────────────────────────
--    v2 §2. La maquette porte « Certificat de de suivi médical » — v2 signale
--    lui-même le « de » en double comme un défaut d'export et le corrige. On
--    applique la correction du document APPROUVÉ, pas la coquille de l'image.
--    ⚠️ Plus de « (trente jours) » : voir l'en-tête de fichier. C'est un
--    arbitrage de la praticienne, et il a un coût.
 ('suivi_medical'::app.doc_type,
  'Certificat de suivi médical',
  $B2$
<h1 class="doc-titre">Certificat de suivi médical</h1>

<p>Je soussignée, {{praticien.title}} {{praticien.full_name}}, {{praticien.speciality_fr}},
Déclare que le/la patient(e) {{patient.last_name}} {{patient.first_name}}, âgé(e) de
{{patient.age}} ans, suivi(e) dans le cadre de sa prise en charge médicale, nécessite un
arrêt de travail de {{vars.jours}} jours, à compter du {{vars.date_debut}}.</p>

<p>Certificat établi pour servir et valoir ce que de droit.</p>
  $B2$),

-- ── 2.3 · Certificat médical ────────────────────────────────────────────────
--    v2 §3. Le traitement devient une LISTE À PUCES de deux lignes, la seconde
--    facultative — c'est ce modèle qui a rendu la migration nécessaire.
--
--    ⚠️ `<li>{{vars.traitement_2}}</li>` EST ÉCRIT SANS AUCUNE ESPACE À
--    L'INTÉRIEUR, ET C'EST STRUCTUREL. Vide, le marqueur se substitue par une
--    chaîne vide et l'élément devient `<li></li>`, que `li:empty` masque. Une
--    seule espace ou un saut de ligne entre les balises, et l'élément n'est
--    plus `:empty` : une puce blanche s'imprimerait sur le certificat. Ne pas
--    « reformater proprement » cette ligne. Le contrôle §3(d) la vérifie.
--
--    ⚠️ La date affichée vient de {{patient.birth_date_fr}}, pas de
--    {{vars.date_naissance}} : la base connaît déjà la date du dossier. Le jeu
--    de `vars` exige quand même `date_naissance` en saisie — le formulaire la
--    pré-remplit depuis le dossier, et la valeur soumise reste tracée dans
--    `variables` comme confirmation explicite. Incohérence du contrat gelé,
--    héritée de 030, signalée et NON corrigée en douce.
 ('certificat_medical'::app.doc_type,
  'Certificat médical',
  $B3$
<h1 class="doc-titre">Certificat médical</h1>

<p>Je soussignée, {{praticien.title}} {{praticien.full_name}}, {{praticien.speciality_fr}},
Certifie que Mr/Mme/Mlle {{patient.last_name}} {{patient.first_name}}, né(e) le
{{patient.birth_date_fr}}, présente une affection psychique chronique et invalidante
nécessitant un traitement par :</p>

<ul class="doc-liste">
<li>{{vars.traitement_1}}</li>
<li>{{vars.traitement_2}}</li>
</ul>

<p>Le présent certificat est établi pour servir et valoir ce que de droit.</p>
  $B3$),

-- ── 2.4 · Justification ─────────────────────────────────────────────────────
--    v2 §4. La date de consultation est désormais ÉCRITE dans le corps
--    (« à la date du … »), là où v1 disait « à la date sus-citée » et renvoyait
--    à l'en-tête. `043 §5bis` fait par ailleurs valoir `vars.date_affichee` =
--    `vars.date_consultation` pour ce type : les deux dates concordent donc, et
--    la praticienne peut toujours justifier une consultation PASSÉE.
 ('justification'::app.doc_type,
  'Justification',
  $B4$
<h1 class="doc-titre">Justification</h1>

<p>Je soussignée, {{praticien.title}} {{praticien.full_name}}, {{praticien.speciality_fr}},
Certifie que Mr/Mme/Mlle {{patient.last_name}} {{patient.first_name}}, né(e) le
{{patient.birth_date_fr}}, a été présent(e) à la date du {{vars.date_consultation}} à ma
consultation.</p>

<p>Attestation établie à la demande de l'intéressé(e), pour servir et valoir ce que de droit.</p>
  $B4$)

) AS t(doc_type, title_fr, body_html)
WHERE NOT EXISTS (
  SELECT 1 FROM app.document_templates d
  WHERE d.cabinet_id = c.id AND d.doc_type = t.doc_type AND d.version = 2
);

-- ---------------------------------------------------------------------------
-- 3 · CONTRÔLES DE CATALOGUE — la migration échoue plutôt que de semer troué
-- ---------------------------------------------------------------------------
DO $ctl$
DECLARE
  v_n   integer;
  v_cab integer;
  v_bad text;
BEGIN
  SELECT count(*) INTO v_cab FROM app.cabinets;

  -- (a) Exactement 4 modèles ACTIFS par cabinet, tous en version 2. Semer à
  -- moitié serait pire que ne pas semer : l'écran promettrait quatre
  -- certificats dont deux seulement existent.
  SELECT count(*) INTO v_n FROM app.document_templates WHERE is_active AND version = 2;
  IF v_n <> v_cab * 4 THEN
    RAISE EXCEPTION '045 : % modeles v2 actifs pour % cabinet(s), attendu 4 par cabinet.', v_n, v_cab;
  END IF;

  SELECT count(*) INTO v_n FROM app.document_templates WHERE is_active AND version <> 2;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '045 : % modele(s) hors v2 encore actif(s) — le catalogue doit rester net.', v_n;
  END IF;

  -- (b) LE CONTRÔLE CENTRAL, hérité de 044 §3(b) et remis à jour. Chaque
  -- marqueur des modèles actifs est confronté à la liste EXHAUSTIVE des clés
  -- que `issue_document` met dans le contexte. Un marqueur hors liste ne lève
  -- RIEN à l'exécution — il s'imprime tel quel sur le papier. Il doit donc
  -- lever ICI.
  --
  -- ⚠️ MAINTENANCE : `vars.traitement` a disparu de cette liste,
  -- `vars.traitement_1` / `vars.traitement_2` l'ont remplacée, en accord avec
  -- le §1. Toute clé ajoutée au contexte se répercute ici ET dans
  -- scripts/checkpoint-v8-documents.sh, qui rejoue le même contrôle.
  SELECT string_agg(DISTINCT m[1], ', ' ORDER BY m[1]) INTO v_bad
    FROM app.document_templates t,
         LATERAL regexp_matches(
           coalesce(t.header_html, '') || coalesce(t.body_html, '') || coalesce(t.footer_html, ''),
           '\{\{([^{}]*)\}\}', 'g') AS m
   WHERE t.is_active
     AND btrim(m[1]) NOT IN (
       'patient.first_name', 'patient.last_name', 'patient.record_number',
       'patient.birth_date', 'patient.birth_date_fr', 'patient.id_document_number',
       'patient.civilite', 'patient.age',
       'praticien.full_name', 'praticien.full_name_ar', 'praticien.title',
       'praticien.speciality_fr', 'praticien.speciality_ar',
       'praticien.order_number', 'praticien.phone',
       'cabinet.name', 'cabinet.address', 'cabinet.phone',
       'vars.date_affichee', 'vars.id_document_number', 'vars.mairie',
       'vars.jours', 'vars.jours_lettres', 'vars.date_debut',
       'vars.traitement_1', 'vars.traitement_2', 'vars.date_consultation');

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '045 : marqueur(s) sans source dans le contexte de rendu : %.', v_bad
      USING HINT = 'Un marqueur sans valeur ne leve pas — il s imprime tel quel sur le certificat.';
  END IF;

  -- (c) Les clés `vars` employées par chaque modèle doivent appartenir au jeu
  -- que `issue_document` valide POUR CE TYPE. Hors du jeu, l'émission est
  -- impossible (clé refusée) ou le marqueur reste littéral.
  SELECT string_agg(DISTINCT t.doc_type || ' → ' || m[1], ', ') INTO v_bad
    FROM app.document_templates t,
         LATERAL regexp_matches(coalesce(t.body_html, '') || coalesce(t.header_html, ''),
                                '\{\{(vars\.[a-z0-9_]+)\}\}', 'g') AS m
   WHERE t.is_active
     AND m[1] <> 'vars.date_affichee'          -- ajoutée par 043 pour les 4 types
     AND btrim(m[1]) NOT IN (
       SELECT 'vars.' || k
         FROM unnest(CASE t.doc_type
                WHEN 'bonne_sante_mentale' THEN ARRAY['id_document_number','mairie']
                WHEN 'suivi_medical'       THEN ARRAY['jours','jours_lettres','date_debut']
                WHEN 'certificat_medical'  THEN ARRAY['date_naissance','traitement_1','traitement_2']
                WHEN 'justification'       THEN ARRAY['date_consultation']
              END) AS k);

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '045 : cle(s) vars hors du jeu valide par issue_document : %.', v_bad
      USING HINT = 'C est le modele qui se conforme au jeu, jamais l inverse.';
  END IF;

  -- (d) LA PUCE FACULTATIVE, contrôlée sur le texte du modèle. `li:empty` ne
  -- masque que des éléments RIGOUREUSEMENT vides : une espace entre les deux
  -- balises et une puce blanche s'imprime. Le défaut serait invisible en
  -- relecture SQL, et visible seulement sur le papier d'une patiente.
  SELECT count(*) INTO v_n
    FROM app.document_templates
   WHERE is_active AND doc_type = 'certificat_medical'
     AND body_html LIKE '%<li>{{vars.traitement_2}}</li>%';
  IF v_n <> v_cab THEN
    RAISE EXCEPTION '045 : la puce facultative n est pas collee a ses balises dans % modele(s).', v_cab - v_n
      USING HINT = 'Ecrire <li>{{vars.traitement_2}}</li> sans aucune espace : li:empty en depend.';
  END IF;
END $ctl$;

-- ---------------------------------------------------------------------------
-- 4 · LA CLOISON — vérifiée, pas supposée (motif de 043 §7)
-- ---------------------------------------------------------------------------
-- Un `CREATE OR REPLACE` qui aurait, pour une raison quelconque, réattribué la
-- fonction laisserait la migration VERTE et la cloison OUVERTE. On regarde.
DO $cloison$
DECLARE
  v_owner text;
  v_def   boolean;
BEGIN
  SELECT pg_get_userbyid(p.proowner), p.prosecdef
    INTO v_owner, v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname = 'issue_document';

  IF v_owner <> 'app_gatekeeper' THEN
    RAISE EXCEPTION 'CLOISON ROUVERTE — issue_document appartient a %, pas a app_gatekeeper.', v_owner;
  END IF;
  IF NOT v_def THEN
    RAISE EXCEPTION 'CLOISON ROUVERTE — issue_document n est plus SECURITY DEFINER.';
  END IF;
  IF NOT has_function_privilege('authenticated',
        'app.issue_document(uuid, app.doc_type, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANT EXECUTE perdu pour authenticated sur issue_document.';
  END IF;
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_gatekeeper') THEN
    RAISE EXCEPTION 'CLOISON ROUVERTE — app_gatekeeper a recu BYPASSRLS.';
  END IF;

  -- Le garde d'enum de 030, relu : sans lui, une 5e valeur d'enum passerait
  -- SANS AUCUNE validation de champs.
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app' AND p.proname = 'issue_document'
      AND p.prosrc LIKE '%v_attendues IS NULL%';
  IF NOT FOUND THEN
    RAISE EXCEPTION '045 : le garde d enum de 030 a disparu de issue_document.';
  END IF;
END $cloison$;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('045_document_templates_v2')
  ON CONFLICT DO NOTHING;

COMMIT;
