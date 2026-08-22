-- 043_document_render_context — V7 Documents. Le contexte de rendu, complété.
--
-- ═══ POURQUOI CETTE MIGRATION EXISTE ═══════════════════════════════════════
--
-- `030` a livré la mécanique et refusé de semer le moindre modèle — « le texte
-- d'un certificat médical engage la responsabilité de la praticienne, et
-- l'inventer produirait un faux ». Les modèles sont arrivés depuis
-- (docs/DOCUMENT-TEMPLATES.md, arbitrages A1→A10 tranchés le 2026-08-09), et
-- ils réclament quatre valeurs que le contexte de 030 NE CONTIENT PAS :
--
--   · la CIVILITÉ    « Certifie avoir reçu et examiné Mme … »
--   · l'ÂGE          « âgé(e) de 34 ans »
--   · la DATE        le bloc d'en-tête porte une date sur les quatre documents
--   · le NOM ARABE   « الدكتورة … », deuxième ligne de l'en-tête
--
-- Ce n'est pas un manque cosmétique. `app.render_template` laisse LITTÉRAL tout
-- marqueur dont la clé est absente du contexte — délibérément, « un trou
-- invisible dans un certificat est pire qu'un marqueur visible » (030 §1quater).
-- Semer les modèles sans cette migration ferait donc sortir un certificat
-- destiné à un notaire avec « {{patient.civilite}} » imprimé dessus. C'est ce
-- que cette migration ferme, AVANT que 044 ne sème quoi que ce soit.
--
-- ═══ CE QU'ELLE NE FAIT PAS, ET C'EST L'ESSENTIEL ══════════════════════════
--
-- ⚠️ ELLE NE TOUCHE PAS `app.render_template`. Pas une ligne. La tentation
-- naturelle était d'ajouter un préfixe `document.` à l'allowlist pour y loger
-- la date. 030 §1quater a écrit d'avance pourquoi c'est le mauvais chemin :
-- « chaque capacité ajoutée ici serait une capacité offerte à qui écrirait un
-- modèle ». Passer par `vars` — que le moteur sait déjà lire — obtient
-- exactement le même résultat en laissant intacte la fonction la plus critique
-- du module. Le §3 le VÉRIFIE plutôt que de le promettre.
--
-- ⚠️ AUCUN `DROP FUNCTION`, ICI NI AILLEURS. `CREATE OR REPLACE` préserve le
-- propriétaire ET les GRANT ; `DROP` les emporte et réattribue la fonction à
-- `postgres`, qui a `rolbypassrls` — la cloison d'ADR-019 tombe pendant que la
-- migration reste VERTE (défaut de 018, redit par 030:640). La signature de
-- `issue_document` ne change pas, donc aucun `DROP` n'est nécessaire. Le §3
-- refuse la migration si le propriétaire a malgré tout bougé.
--
-- ⚠️ LE CORPS DE LA FONCTION EST CELUI DE 030, TRANSFORMÉ, PAS RÉÉCRIT. Le
-- verrou `FOR UPDATE`, la lecture en deux temps, `audit.log_read` avant toute
-- identité, le refus explicite pour l'owner et le NULL silencieux pour
-- l'assistante, l'allocation du numéro EN DERNIER, les champs dérivés de
-- l'INSERT : tout est mot pour mot ce que 030 a écrit et fait revoir trois
-- fois. Cinq ajouts, énumérés ci-dessous, et rien d'autre.
--
-- ═══ LES CINQ AJOUTS ═══════════════════════════════════════════════════════
--
--   (1) la lecture nominative prend `p.sex` ;
--   (2) un refus explicite si `sex` ou `birth_date` manque au dossier — sans
--       lui, les clés dérivées vaudraient NULL et le marqueur resterait
--       littéral, c'est-à-dire le défaut qu'on corrige, déplacé ;
--   (3) `patient` gagne `civilite`, `age`, `birth_date_fr` ;
--   (4) `praticien` gagne `full_name_ar`, lu dans `signature_block` ;
--   (5) `vars` gagne `date_affichee`, et `jours_lettres` est RECALCULÉE par
--       `app.nombre_en_lettres` (042) — pour le RENDU seulement : la colonne
--       `variables` continue de stocker ce que l'appelante a soumis.
--
-- Plus un garde de forme sur `jours` (entier, 1 à 365), qui évite qu'un cast
-- lève un 22P02 illisible portant la valeur saisie.
--
-- ═══ CE QUE LES CLÉS AJOUTÉES NE DISENT PAS ════════════════════════════════
--
-- `civilite` ne connaît que « Mr » et « Mme » : `app.sex` (002) est un enum à
-- deux valeurs et « Mlle » n'en dérive pas. Les documents Word d'origine
-- offraient les trois. C'est une PERTE FONCTIONNELLE, acquittée par la
-- praticienne le 2026-08-21, pas un oubli à réparer discrètement plus tard.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0 · Privilège nécessaire au transfert de propriété, retiré au §4
-- ---------------------------------------------------------------------------
-- Symétrie obligatoire DANS CE FICHIER, motif de 026 §3 / 029 §0 / 030 §0 :
-- `ALTER FUNCTION … OWNER TO app_gatekeeper` exige que le NOUVEAU propriétaire
-- possède CREATE sur le schéma. Une migration qui l'oublie hérite d'un rôle
-- déjà refermé et échoue en 42501, loin de la cause.
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 1 · Empreinte de `render_template` AVANT — pour prouver qu'elle ne bouge pas
-- ---------------------------------------------------------------------------
-- Un contrôle qui se contenterait de dire « je n'ai pas touché au moteur »
-- serait une promesse. Celui-ci relève l'empreinte maintenant et la compare au
-- §3 : si une ligne de ce fichier venait un jour à redéfinir `render_template`
-- par mégarde — un copier-coller de 030, par exemple — la migration échoue.
CREATE TEMP TABLE _avant_043 (fonction text PRIMARY KEY, empreinte text) ON COMMIT DROP;

INSERT INTO _avant_043 (fonction, empreinte)
SELECT p.proname, md5(p.prosrc)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'app'
   AND p.proname IN ('render_template', 'html_escape', 'get_document',
                     'list_patient_documents', 'mark_document_printed');

-- ---------------------------------------------------------------------------
-- 2 · `app.issue_document` — le corps de 030, plus les cinq ajouts
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
    WHEN 'certificat_medical'  THEN ARRAY['date_naissance','traitement']
    WHEN 'justification'       THEN ARRAY['date_consultation']
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
      IF v_vars -> v_cle IS NULL OR jsonb_typeof(v_vars -> v_cle) = 'null' THEN
        RAISE EXCEPTION 'Champ « % » vide : un certificat ne part pas avec un blanc.', v_cle;
      END IF;
      IF jsonb_typeof(v_vars -> v_cle) NOT IN ('string', 'number', 'boolean') THEN
        RAISE EXCEPTION 'Champ « % » invalide : une valeur simple est attendue, pas une structure.', v_cle;
      END IF;
      IF jsonb_typeof(v_vars -> v_cle) = 'string' AND btrim(v_vars ->> v_cle) = '' THEN
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
-- ⚠️ `OWNER TO` POSÉ IMMÉDIATEMENT APRÈS LA FONCTION, motif de 030:640.
-- `CREATE OR REPLACE` conserve normalement le propriétaire ; on le repose
-- quand même, parce que « normalement » n'est pas un contrôle et que le §3 en
-- fait un.
ALTER FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) IS
  'V7 (043) — le corps de 030, plus le contexte que les modeles reclament. '
  'AJOUTS : patient.civilite (derivee de app.sex, donc Mr/Mme seulement, '
  'jamais Mlle), patient.age (calcule a l emission, Africa/Algiers), '
  'patient.birth_date_fr (JJ/MM/AAAA — la cle brute reste exposee), '
  'praticien.full_name_ar (profiles.signature_block, aucune colonne ajoutee), '
  'vars.date_affichee (date de la consultation pour justification, date du '
  'jour sinon) et vars.jours_lettres RECALCULEE par app.nombre_en_lettres. '
  'INCHANGE : verrou FOR UPDATE, lecture en deux temps, audit.log_read avant '
  'toute identite, owner refuse explicitement / assistante NULL, numero alloue '
  'en dernier sur l annee du cabinet, champs derives de l INSERT. La colonne '
  'variables stocke TOUJOURS ce que l appelante a soumis, pas les cles '
  'serveur : elle est la trace de la saisie, rendered_html est la piece. '
  'app.render_template n est pas touchee — verifie par empreinte au §3.';

REVOKE ALL ON FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · CONTRÔLE DE CLOISON — la migration échoue plutôt que de rester verte
-- ---------------------------------------------------------------------------
-- C'est le contrôle que 018 n'avait pas, et que STATE.md rappelle : une
-- migration peut être verte ET avoir rouvert la cloison. Quatre propriétés,
-- vérifiées SUR LA BASE, pas sur le texte du fichier.
DO $ctl$
DECLARE
  v_owner    name;
  v_secdef   boolean;
  v_execute  boolean;
  v_bypass   boolean;
  v_ecart    text;
BEGIN
  -- (a) Le moteur de rendu et les portes de lecture n'ont PAS bougé.
  SELECT string_agg(a.fonction, ', ') INTO v_ecart
    FROM _avant_043 a
    JOIN pg_proc p   ON p.proname = a.fonction
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'app'
   WHERE md5(p.prosrc) IS DISTINCT FROM a.empreinte;

  IF v_ecart IS NOT NULL THEN
    RAISE EXCEPTION '043 : cette migration ne doit redefinir QUE issue_document, or % a change.', v_ecart;
  END IF;

  -- (b) Le propriétaire. Un DROP l'aurait rendu a postgres, qui a BYPASSRLS :
  -- la RLS cesserait alors de s'appliquer SOUS la porte, et la cloison entre
  -- praticiennes tomberait sans qu'aucun test fonctionnel ne le voie.
  SELECT pg_get_userbyid(p.proowner), p.prosecdef
    INTO v_owner, v_secdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname = 'issue_document';

  IF v_owner IS DISTINCT FROM 'app_gatekeeper' THEN
    RAISE EXCEPTION 'CLOISON ROUVERTE — issue_document appartient a « % », attendu app_gatekeeper.', v_owner;
  END IF;

  IF NOT v_secdef THEN
    RAISE EXCEPTION 'CLOISON ROUVERTE — issue_document n est plus SECURITY DEFINER.';
  END IF;

  -- (c) Le GRANT. Perdu, l'ecran renvoie « permission denied » a chaque
  -- emission, et le diagnostic part chercher du cote de la RLS.
  SELECT has_function_privilege('authenticated',
           'app.issue_document(uuid, app.doc_type, text, uuid)', 'EXECUTE')
    INTO v_execute;

  IF NOT v_execute THEN
    RAISE EXCEPTION 'GRANT EXECUTE perdu pour authenticated sur issue_document.';
  END IF;

  -- (d) Le rôle lui-même. `app_gatekeeper` sans BYPASSRLS est LA raison pour
  -- laquelle une porte DEFINER reste sûre ici (020, 021). Le jour où il
  -- l'acquiert, toutes les portes du dépôt cessent silencieusement de filtrer.
  SELECT rolbypassrls INTO v_bypass FROM pg_roles WHERE rolname = 'app_gatekeeper';

  IF v_bypass IS NULL THEN
    RAISE EXCEPTION 'Le role app_gatekeeper est introuvable.';
  END IF;

  IF v_bypass THEN
    RAISE EXCEPTION 'CLOISON ROUVERTE — app_gatekeeper a acquis BYPASSRLS : la RLS ne s applique plus sous les portes.';
  END IF;

  -- (e) Le garde d'enum de 030 est toujours là. Il ne sert à rien aujourd'hui
  -- — les 4 valeurs sont couvertes — et il sera tout ce qui protège le jour où
  -- une 5e arrive (`recu`, annoncé pour la phase suivante). Sans lui,
  -- `v_attendues` vaudrait NULL, la condition de validation vaudrait NULL au
  -- lieu de FALSE, et un document partirait SANS aucun controle de champs.
  PERFORM 1
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app' AND p.proname = 'issue_document'
      AND p.prosrc LIKE '%v_attendues IS NULL%';

  IF NOT FOUND THEN
    RAISE EXCEPTION '043 : le garde d enum de 030 a disparu de issue_document.';
  END IF;
END $ctl$;

-- ---------------------------------------------------------------------------
-- 4 · Refermer
-- ---------------------------------------------------------------------------
-- Symétrique du §0. Un rôle qui peut créer des objets dans `app` pourrait y
-- planter une fonction masquant une fonction du catalogue dans le `search_path`
-- figé des portes.
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('043_document_render_context')
  ON CONFLICT DO NOTHING;

COMMIT;
