-- 088_situation_familiale_et_civilite — la civilité cesse d'être un littéral
--
-- CE QUE CETTE MIGRATION CORRIGE, ET POURQUOI CE N'ÉTAIT PAS UN OUBLI.
--
-- Les certificats impriment aujourd'hui « Mr/Mme/Mlle NOM Prénom » — les trois
-- formes, littéralement, sur un document remis à un patient. Ce n'est pas une
-- inattention : 044 utilisait `{{patient.civilite}}`, et 045 §85-88 est REVENUE
-- au littéral pour retrouver le texte Word d'origine, « perte acquittée le
-- 2026-08-21 ». La perte, c'est celle-ci.
--
-- Elle n'a pas été réparée plus tôt parce qu'elle ne POUVAIT pas l'être seule :
-- `civilite` dérive de `app.sex` (043:396, redéfini 061:381), un enum à deux
-- valeurs. « Mlle » exige une donnée que le dossier ne portait pas. C'est
-- pourquoi situation familiale et civilité arrivent ensemble : deux moitiés
-- d'un seul geste.
--
-- RÈGLE DE CIVILITÉ (arbitrage praticienne, 2026-09-08) :
--     homme                        → Mr
--     femme célibataire            → Mlle
--     femme, autre ou non renseigné → Mme
--
-- ⚠️ LE DÉFAUT EST « Mme », ET C'EST DÉLIBÉRÉ. `marital_status` est NULL sur
-- tous les dossiers existants ; faire dépendre « Mlle » d'une donnée absente
-- imprimerait « Mlle » sur des dossiers dont personne n'a rien dit. Le défaut
-- doit être la forme qui n'affirme rien de plus que ce que le dossier sait.
--
-- ⚠️ LES DEUX FONCTIONS CI-DESSOUS SONT RECOPIÉES DE LEUR DÉFINITION VIVANTE,
-- PAS DE CELLE QUI LES A CRÉÉES. `issue_document` vient de 061 (ni 043 ni 045),
-- `update_patient` de 049 (ni 018 ni 020). Chacune est reprise à l'octet près,
-- avec les seules modifications énumérées ici — c'est la seule façon de ne pas
-- faire régresser en silence ce que les migrations intermédiaires ont corrigé.
--
--   · `issue_document` : lit `marital_status`, délègue la civilité, ET GARDE
--     `extensions` dans son `search_path` — c'est 064 qui l'y avait mis, et le
--     recopier depuis 061 l'avait fait disparaître (voir l'encadré §3).
--   · `update_patient` : `marital_status` entre dans l'allowlist de colonnes.
--
-- `CREATE OR REPLACE`, JAMAIS `DROP` : un DROP emporterait le propriétaire
-- `app_gatekeeper` et rouvrirait la cloison d'ADR-019, migration verte. Les
-- `ALTER ... OWNER` et `GRANT` sont malgré tout reposés dans la même
-- transaction — une signature identique ne garantit pas le reste.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · La donnée
-- ---------------------------------------------------------------------------
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'app' AND t.typname = 'marital_status') THEN
    CREATE TYPE app.marital_status AS ENUM
      ('celibataire', 'en_couple', 'marie', 'divorce', 'veuf');
  END IF;
END $mig$;

-- NULLABLE, sans valeur par défaut : un dossier ouvert avant aujourd'hui n'a
-- jamais été interrogé là-dessus, et lui prêter une situation serait inventer
-- une donnée patient (règle 8).
ALTER TABLE app.patients ADD COLUMN IF NOT EXISTS marital_status app.marital_status;

COMMENT ON COLUMN app.patients.marital_status IS
  '088. Situation familiale. NULL = non renseignee, jamais « celibataire » par '
  'defaut. Sert la civilite imprimee (app.civilite) et la lecture clinique.';

-- ---------------------------------------------------------------------------
-- 2 · LE résolveur de civilité — un seul, pour tout le dépôt
-- ---------------------------------------------------------------------------
-- Il existait TROIS copies du `CASE` (043, 045, 061) : c'est la raison de fond
-- pour laquelle la règle pouvait diverger d'un document à l'autre. À partir
-- d'ici il n'y en a qu'une, et `issue_document` l'appelle.
CREATE OR REPLACE FUNCTION app.civilite(p_sex app.sex, p_marital app.marital_status)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = app, pg_catalog
AS $civ$
  SELECT CASE
    WHEN p_sex = 'M' THEN 'Mr'
    WHEN p_sex = 'F' AND p_marital = 'celibataire' THEN 'Mlle'
    WHEN p_sex = 'F' THEN 'Mme'
  END;
$civ$;

COMMENT ON FUNCTION app.civilite(app.sex, app.marital_status) IS
  '088. Seul resolveur de civilite du depot. NULL si le sexe est inconnu — '
  'issue_document refuse deja d''emettre dans ce cas, il n''y a pas de repli.';

GRANT EXECUTE ON FUNCTION app.civilite(app.sex, app.marital_status) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · issue_document — recopié de 061, deux lignes changées
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.issue_document(
  p_patient_id      uuid,
  p_doc_type        app.doc_type,
  p_variables       text,
  p_consultation_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
-- ⚠️ `extensions` EST DANS CE CHEMIN PARCE QUE 064 L'Y A MIS. NE PAS L'ÔTER.
-- `digest()` (pgcrypto) vit dans le schéma `extensions` ; sans lui, le calcul
-- du `content_hash` échoue par « function digest(text, unknown) does not exist »
-- et PLUS AUCUN certificat ne s'émet. 064 avait corrigé cela par un
-- `ALTER FUNCTION ... SET search_path`, sans retoucher le corps : un
-- `CREATE OR REPLACE` qui recopie la clause de 061 ANNULE ce correctif en
-- silence — la migration passe au vert, et l'émission tombe à l'exécution.
SET search_path = app, audit, pg_catalog, extensions
AS $$
DECLARE
  v_vars      jsonb;
  v_vars_rendu jsonb;
  v_jours     integer;
  v_attendues text[];
  v_facultatives text[];
  v_recues    text[];
  v_prat      uuid;
  v_pat_id    uuid;
  v_pat       record;
  v_moi       record;
  v_cab       record;
  v_tpl       record;
  v_ctx       jsonb;
  v_html      text;
  v_hash      text;
  v_missing   text[];
  v_header    jsonb;
  v_num       bigint;
  v_numero    text;
  v_id        uuid;
  v_c_prat    uuid;
  v_c_pat     uuid;
BEGIN
  IF p_patient_id IS NULL OR p_doc_type IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_vars := COALESCE(p_variables, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Variables illisibles : le document n''a pas été émis.'
      USING HINT = 'p_variables doit être un objet JSON sérialisé (ADR-020).';
  END;

  IF jsonb_typeof(v_vars) <> 'object' THEN
    RAISE EXCEPTION 'Variables invalides : un objet JSON est attendu.';
  END IF;

  v_attendues := CASE p_doc_type
    WHEN 'bonne_sante_mentale' THEN ARRAY['id_document_number','mairie']
    WHEN 'suivi_medical'       THEN ARRAY['jours','jours_lettres','date_debut']
    WHEN 'certificat_medical'  THEN ARRAY['date_naissance','traitement_1','traitement_2']
    WHEN 'justification'       THEN ARRAY['date_consultation']
  END;

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
      IF jsonb_typeof(v_vars -> v_cle) = 'string' AND btrim(v_vars ->> v_cle) = ''
         AND NOT (v_cle = ANY (v_facultatives)) THEN
        RAISE EXCEPTION 'Champ « % » vide : un certificat ne part pas avec un blanc.', v_cle;
      END IF;
    END LOOP;
  END;

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

  SELECT p.id, p.practitioner_id
    INTO v_pat_id, v_prat
    FROM app.patients p
   WHERE p.id = p_patient_id
     FOR UPDATE;

  IF v_pat_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_prat <> auth.uid() THEN
    IF app.current_role() = 'owner' THEN
      RAISE EXCEPTION 'Ce dossier n''est pas le vôtre : un certificat est signé par la praticienne qui suit le patient.';
    END IF;
    RETURN NULL;
  END IF;

  IF p_consultation_id IS NOT NULL THEN
    SELECT c.practitioner_id, c.patient_id INTO v_c_prat, v_c_pat
      FROM app.consultations c
     WHERE c.id = p_consultation_id;

    IF v_c_prat IS NULL OR v_c_prat <> auth.uid() OR v_c_pat <> p_patient_id THEN
      RAISE EXCEPTION 'Séance introuvable, hors de votre périmètre, ou d''un autre patient : document non émis.';
    END IF;
  END IF;

  -- Validation en-tête AVANT trace, et AVANT numéro (règle: ne jamais brûler un numéro)
  v_missing := app._document_header_missing(app.current_cabinet(), auth.uid());
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'En-tête du cabinet incomplet : %.', array_to_string(v_missing, ', ')
      USING HINT = 'Complétez les paramètres du cabinet/praticienne avant d''émettre.',
            ERRCODE = 'P0001';
  END IF;

  PERFORM audit.log_read(p_patient_id, 'fiche');

  SELECT p.first_name, p.last_name, p.record_number, p.birth_date,
         p.id_document_number, p.sex, p.marital_status
    INTO v_pat
    FROM app.patients p
   WHERE p.id = p_patient_id;

  IF v_pat.sex IS NULL OR v_pat.birth_date IS NULL THEN
    RAISE EXCEPTION 'Dossier incomplet : le certificat n''a pas ete emis.'
      USING HINT = 'Renseignez le sexe et la date de naissance dans le dossier, puis reessayez.';
  END IF;

  SELECT t.id, t.title_fr, t.header_html, t.body_html, t.footer_html, t.version
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

  v_vars_rendu := v_vars || jsonb_build_object(
    'date_affichee',
    CASE p_doc_type
      WHEN 'justification' THEN v_vars ->> 'date_consultation'
      ELSE to_char(now() AT TIME ZONE 'Africa/Algiers', 'DD/MM/YYYY')
    END);

  IF p_doc_type = 'suivi_medical' THEN
    v_vars_rendu := v_vars_rendu
      || jsonb_build_object('jours_lettres', app.nombre_en_lettres(v_jours));
  END IF;

  v_ctx := jsonb_build_object(
    'patient', jsonb_build_object(
        'first_name',         v_pat.first_name,
        'last_name',          v_pat.last_name,
        'record_number',      v_pat.record_number,
        'birth_date',         v_pat.birth_date,
        'id_document_number', v_pat.id_document_number,
        'civilite',      app.civilite(v_pat.sex, v_pat.marital_status),
        'age',           extract(year FROM age(
                           (now() AT TIME ZONE 'Africa/Algiers')::date,
                           v_pat.birth_date))::int::text,
        'birth_date_fr', to_char(v_pat.birth_date, 'DD/MM/YYYY')),
    'praticien', jsonb_build_object(
        'full_name',     v_moi.full_name,
        'title',         v_moi.title,
        'speciality_fr', v_moi.speciality_fr,
        'speciality_ar', v_moi.speciality_ar,
        'order_number',  v_moi.order_number,
        'phone',         v_moi.phone,
        'full_name_ar',  v_moi.signature_block ->> 'full_name_ar'),
    'cabinet', jsonb_build_object(
        'name',    v_cab.name,
        'address', v_cab.address,
        'phone',   v_cab.phone),
    'vars', v_vars_rendu);

  v_html := app.render_template(v_tpl.header_html, v_ctx)
         || app.render_template(v_tpl.body_html,   v_ctx)
         || COALESCE(app.render_template(v_tpl.footer_html, v_ctx), '');

  v_hash := encode(digest(v_html, 'sha256'), 'hex');

  v_header := jsonb_build_object(
    'cabinet', jsonb_build_object('name', v_cab.name, 'address', v_cab.address, 'phone', v_cab.phone),
    'praticien', jsonb_build_object('full_name', v_moi.full_name, 'title', v_moi.title, 'speciality_fr', v_moi.speciality_fr, 'speciality_ar', v_moi.speciality_ar, 'order_number', v_moi.order_number, 'phone', v_moi.phone, 'full_name_ar', v_moi.signature_block->>'full_name_ar'),
    'patient', jsonb_build_object('first_name', v_pat.first_name, 'last_name', v_pat.last_name, 'record_number', v_pat.record_number, 'birth_date', v_pat.birth_date, 'sex', v_pat.sex)
  );

  v_num    := app.next_number(app.current_cabinet(), 'document',
                               to_char(now() AT TIME ZONE 'Africa/Algiers', 'YYYY'));
  v_numero := 'DOC-' || to_char(now() AT TIME ZONE 'Africa/Algiers', 'YYYY')
                     || '-' || lpad(v_num::text, 5, '0');

  INSERT INTO app.documents (cabinet_id, practitioner_id, patient_id,
                             consultation_id, doc_type, doc_number,
                             variables, rendered_html, is_synthetic,
                             template_id, template_version, schema_version, content_hash, snapshot_header, status)
  VALUES (app.current_cabinet(), auth.uid(), p_patient_id,
          p_consultation_id, p_doc_type, v_numero,
          v_vars, v_html, app.is_cloud_dev(),
          v_tpl.id, v_tpl.version, '1', v_hash, v_header, 'issued')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
ALTER FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · update_patient — recopié de 049, deux ajouts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.update_patient(p_id uuid, p_changes jsonb)
RETURNS SETOF app.patients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  k text;
  v_changes jsonb := p_changes;
  allowed constant text[] := ARRAY[
    'first_name','last_name','birth_date','sex','phone','phone_alt',
    'address','id_document_number','id_document_issuer',
    'emergency_contact','notes_admin','is_active','marital_status'];
BEGIN
  -- LE CORRECTIF, ET IL TIENT EN CINQ LIGNES. Une charge arrivée sous forme de
  -- chaîne JSON est DÉSÉRIALISÉE UNE FOIS, puis retombe dans le contrôle
  -- d'origine ci-dessous — une chaîne qui ne contient pas un objet reste
  -- refusée exactement comme avant. On ne déballe pas en boucle : une chaîne
  -- doublement encodée est une erreur d'appelant, pas un cas à rattraper.
  IF jsonb_typeof(v_changes) = 'string' THEN
    BEGIN
      v_changes := (v_changes #>> '{}')::jsonb;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Charge de modification invalide : un objet JSON est attendu.'
        USING HINT = 'p_changes accepte un objet jsonb ou ce même objet sérialisé (ADR-020).';
    END;
  END IF;

  IF v_changes IS NULL OR jsonb_typeof(v_changes) <> 'object' THEN
    RAISE EXCEPTION 'Charge de modification invalide : un objet JSON est attendu.'
      USING HINT = 'p_changes accepte un objet jsonb ou ce même objet sérialisé (ADR-020).';
  END IF;

  -- On refuse la clé inconnue au lieu de l'ignorer. Ignorer silencieusement
  -- ferait croire à l'appelant que sa modification a été prise en compte.
  FOREACH k IN ARRAY ARRAY(SELECT jsonb_object_keys(v_changes)) LOOP
    IF NOT (k = ANY (allowed)) THEN
      RAISE EXCEPTION 'Champ non modifiable par cette porte : %.', k
        USING HINT = 'cabinet_id, practitioner_id et record_number sont exclus par conception.';
    END IF;
  END LOOP;

  -- Le déclencheur `trg_audit` de 013 journalise la modification : l'audit des
  -- écritures n'est pas réimplémenté ici, il est hérité.
  RETURN QUERY
  UPDATE app.patients p SET
    first_name         = coalesce(v_changes->>'first_name', p.first_name),
    last_name          = coalesce(v_changes->>'last_name',  p.last_name),
    birth_date         = CASE WHEN v_changes ? 'birth_date'
                         THEN (v_changes->>'birth_date')::date ELSE p.birth_date END,
    sex                = CASE WHEN v_changes ? 'sex'
                         THEN (v_changes->>'sex')::app.sex ELSE p.sex END,
    phone              = coalesce(v_changes->>'phone', p.phone),
    phone_alt          = CASE WHEN v_changes ? 'phone_alt'
                         THEN v_changes->>'phone_alt' ELSE p.phone_alt END,
    address            = CASE WHEN v_changes ? 'address'
                         THEN v_changes->>'address' ELSE p.address END,
    id_document_number = CASE WHEN v_changes ? 'id_document_number'
                         THEN v_changes->>'id_document_number' ELSE p.id_document_number END,
    id_document_issuer = CASE WHEN v_changes ? 'id_document_issuer'
                         THEN v_changes->>'id_document_issuer' ELSE p.id_document_issuer END,
    emergency_contact  = CASE WHEN v_changes ? 'emergency_contact'
                         THEN v_changes->'emergency_contact' ELSE p.emergency_contact END,
    notes_admin        = CASE WHEN v_changes ? 'notes_admin'
                         THEN v_changes->>'notes_admin' ELSE p.notes_admin END,
    is_active          = coalesce((v_changes->>'is_active')::boolean, p.is_active),
    marital_status     = CASE WHEN v_changes ? 'marital_status'
                         THEN (v_changes->>'marital_status')::app.marital_status
                         ELSE p.marital_status END,
    updated_at         = now()
  WHERE p.id = p_id
  RETURNING p.*;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5 · Les gabarits — version 3, dérivée de la 2
-- ---------------------------------------------------------------------------
-- ⚠️ ON N'ÉCRASE PAS LA VERSION 2, ON EN POSE UNE TROISIÈME. La table est
-- versionnée (`UNIQUE (cabinet_id, doc_type, version)`) et `issue_document`
-- prend « le modèle ACTIF de version la plus haute ». Un `UPDATE` du corps
-- réécrirait le modèle sous les documents déjà émis, qui le référencent par
-- `template_id`/`template_version` : leur instantané mentirait.
--
-- Les corps ne sont pas retapés — la v3 est DÉRIVÉE de la v2 par substitution,
-- pour que rien d'autre que la civilité ne bouge. Trois gabarits sur quatre
-- portent le littéral (`suivi_medical` n'en a pas).
INSERT INTO app.document_templates
       (cabinet_id, doc_type, version, title_fr, header_html, body_html, footer_html, is_active)
SELECT t.cabinet_id, t.doc_type, 3, t.title_fr, t.header_html,
       replace(t.body_html, 'Mr/Mme/Mlle', '{{patient.civilite}}'),
       t.footer_html, true
  FROM app.document_templates t
 WHERE t.version = 2
   AND NOT EXISTS (SELECT 1 FROM app.document_templates x
                    WHERE x.cabinet_id = t.cabinet_id AND x.doc_type = t.doc_type
                      AND x.version = 3);

UPDATE app.document_templates SET is_active = false WHERE version < 3;

-- ---------------------------------------------------------------------------
-- 6 · Vérification — la migration se refuse si elle n'a pas tenu sa promesse
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM app.document_templates
   WHERE is_active AND body_html LIKE '%Mr/Mme/Mlle%';
  IF v_n > 0 THEN
    RAISE EXCEPTION '088 : % gabarit(s) actif(s) portent encore le litteral Mr/Mme/Mlle.', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM app.document_templates WHERE is_active AND version <> 3;
  IF v_n > 0 THEN
    RAISE EXCEPTION '088 : % gabarit(s) actif(s) hors version 3.', v_n;
  END IF;

  IF app.civilite('M', NULL)          IS DISTINCT FROM 'Mr'   THEN RAISE EXCEPTION '088 : civilite(M) faux.'; END IF;
  IF app.civilite('F', 'celibataire') IS DISTINCT FROM 'Mlle' THEN RAISE EXCEPTION '088 : civilite(F,celibataire) faux.'; END IF;
  IF app.civilite('F', 'marie')       IS DISTINCT FROM 'Mme'  THEN RAISE EXCEPTION '088 : civilite(F,marie) faux.'; END IF;
  IF app.civilite('F', NULL)          IS DISTINCT FROM 'Mme'  THEN RAISE EXCEPTION '088 : civilite(F,NULL) doit valoir Mme.'; END IF;
END $mig$;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('088_situation_familiale_et_civilite')
  ON CONFLICT DO NOTHING;

COMMIT;
