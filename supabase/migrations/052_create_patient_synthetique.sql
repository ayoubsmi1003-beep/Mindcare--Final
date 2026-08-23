-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- 052_create_patient_synthetique â€” le garde ADR-016 que la porte doit porter.
--
-- LA SONDE D'INTÃ‰GRATION L'A TROUVÃ‰, PAS UNE RELICTURE. Premier appel rÃ©el de
-- `app.create_patient` sur l'instance cloud-dev : `assert_synthetic_when_cloud`
-- (016) a refusÃ© l'INSERT â€” la porte n'alimentait pas `is_synthetic`, colonne
-- NOT NULL posÃ©e par dÃ©couverte sur toute table Tier 0/1 (016 Â§dÃ©couverte).
--
-- LE CORRECTIF EST CELUI TRANCHÃ‰ PAR 023 POUR LES MÃŠMES RAISONS : la PORTE
-- pose `is_synthetic := app.is_cloud_dev()`. Vrai en dÃ©veloppement nuageux â€”
-- oÃ¹ toute crÃ©ation est synthÃ©tique par construction â€” et faux au cabinet une
-- fois l'auto-hÃ©bergÃ© atteint, sans qu'aucun Ã©cran ne change.
--
-- âš ï¸ RÃˆGLE 9 : 050 est appliquÃ©e sur l'instance, elle n'est pas retouchÃ©e â€”
-- pas mÃªme d'une ligne. Ce fichier est un CREATE OR REPLACE du corps
-- RECOPIÃ‰ DEPUIS pg_proc.prosrc (miroir exact de ce qui tourne, mÃ©thode 048),
-- avec exactement deux ajouts : la colonne `is_synthetic` dans la liste des
-- colonnes insÃ©rÃ©es, et sa valeur `app.is_cloud_dev()` dans les valeurs.
-- Le diff est vÃ©rifiable ligne Ã  ligne : rien d'autre n'a bougÃ©.
--
-- Retour arriÃ¨re (documentation, jamais exÃ©cutÃ© automatiquement) :
--   DROP FUNCTION IF EXISTS app.create_patient(text);
--   puis rÃ©application du corps 050. OpÃ©ration humaine seulement.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE OR REPLACE FUNCTION app.create_patient(p_charge text)
RETURNS SETOF app.patients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$

DECLARE
  k          text;
  allowed    constant text[] := ARRAY[
    'first_name','last_name','phone','birth_date','sex','phone_alt',
    'address','id_document_number','id_document_issuer',
    'emergency_contact','notes_admin','practitioner_id'];

  v_charge   jsonb;
  v_prenom   text;
  v_nom      text;
  v_tel      text;
  v_tel_chiffres text;
  v_naissance date;
  v_sexe     app.sex;
  v_praticien uuid;
  v_numero   bigint;
BEGIN
  -- ÔöÇÔöÇ 0 ┬À Charge pr├®sente, objet JSON, forme s├®rialis├®e accept├®e ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  IF p_charge IS NULL OR btrim(p_charge) = '' THEN
    RAISE EXCEPTION 'Charge de cr├®ation manquante : un objet JSON est attendu.';
  END IF;

  BEGIN
    v_charge := p_charge::jsonb;
  EXCEPTION
    WHEN invalid_text_representation OR invalid_parameter_value THEN
      RAISE EXCEPTION 'Charge de cr├®ation invalide : un objet JSON est attendu.';
  END;
  -- Double encodage (le├ºon 049) : une cha├«ne qui CONTIENT encore du JSON est
  -- d├®ball├®e une fois. Deux formes pour un seul contrat.
  IF jsonb_typeof(v_charge) = 'string' THEN
    v_charge := (v_charge #>> '{}')::jsonb;
  END IF;
  IF jsonb_typeof(v_charge) <> 'object' THEN
    RAISE EXCEPTION 'Charge de cr├®ation invalide : un objet JSON est attendu.';
  END IF;

  -- Cl├® inconnue = refus. Ignorer ferait croire ├á l'appelant que son champ a
  -- ├®t├® pris en compte.
  FOREACH k IN ARRAY ARRAY(SELECT jsonb_object_keys(v_charge)) LOOP
    IF NOT (k = ANY (allowed)) THEN
      RAISE EXCEPTION 'Champ non cr├®able par cette porte : %.', k
        USING HINT = 'record_number, cabinet_id et is_active sont exclus par conception.';
    END IF;
  END LOOP;

  -- ÔöÇÔöÇ 1 ┬À Champs requis ÔÇö pr├®nom, nom, t├®l├®phone ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  v_prenom := btrim(coalesce(v_charge->>'first_name', ''));
  v_nom    := btrim(coalesce(v_charge->>'last_name', ''));
  v_tel    := btrim(coalesce(v_charge->>'phone', ''));

  IF v_prenom = '' OR v_nom = '' OR v_tel = '' THEN
    RAISE EXCEPTION 'Cr├®ation incompl├¿te : pr├®nom, nom et t├®l├®phone sont obligatoires.';
  END IF;

  -- Miroir EXACT de la contrainte `patients_phone_format` (004). La base reste
  -- l'autorit├® ; ce test donne un refus imm├®diat et pr├®visible.
  IF v_tel !~ '^[0-9+ ]{8,20}$' THEN
    RAISE EXCEPTION 'T├®l├®phone invalide : 8 ├á 20 caract├¿res, chiffres, espaces et ┬½ + ┬╗ uniquement.';
  END IF;
  v_tel_chiffres := regexp_replace(v_tel, '[^0-9]', '', 'g');

  -- ÔöÇÔöÇ 2 ┬À Champs facultatifs typ├®s ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  IF v_charge->>'birth_date' IS NOT NULL AND btrim(v_charge->>'birth_date') <> '' THEN
    BEGIN
      v_naissance := (v_charge->>'birth_date')::date;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'Date de naissance invalide : format AAAA-MM-JJ attendu.';
    END;
  END IF;

  IF v_charge->>'sex' IS NOT NULL AND btrim(v_charge->>'sex') <> '' THEN
    IF v_charge->>'sex' IN ('M','F') THEN
      v_sexe := (v_charge->>'sex')::app.sex;
    ELSE
      RAISE EXCEPTION 'Sexe invalide : M ou F attendu.';
    END IF;
  END IF;

  -- Un JSON `null` explicite vaut ┬½ pas de contact ┬╗ (le client efface), pas
  -- une charge invalide : seul un NON-objet non nul est refus├®.
  IF v_charge ? 'emergency_contact'
     AND jsonb_typeof(v_charge->'emergency_contact') <> 'object'
     AND jsonb_typeof(v_charge->'emergency_contact') <> 'null' THEN
    RAISE EXCEPTION 'Contact d''urgence invalide : un objet {name, relation, phone} est attendu.';
  END IF;

  -- ÔöÇÔöÇ 3 ┬À Praticien responsable ÔÇö r├¿gle unique de validation de donn├®e ÔöÇÔöÇÔöÇÔöÇ
  -- Aucune lecture du r├┤le de l'appelant : la r├¿gle porte sur le PROFIL CIBLE.
  -- Absent ÔçÆ auth.uid() (le praticien se cr├®e ses propres dossiers). Pr├®sent ÔçÆ
  -- il doit ├¬tre un profil clinique actif DU CABINET de l'appelant.
  BEGIN
    v_praticien := coalesce(
      nullif(btrim(coalesce(v_charge->>'practitioner_id','')), ''),
      auth.uid()::text
    )::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Identifiant de praticien invalide.';
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM app.profiles pr
    WHERE pr.id = v_praticien
      AND pr.cabinet_id = app.current_cabinet()
      AND pr.role IN ('owner','practitioner')
      AND pr.is_active
  ) THEN
    RAISE EXCEPTION 'Praticien responsable introuvable dans ce cabinet.'
      USING HINT = 'L''assistante d├®signe le praticien responsable ; un praticien '
                   'est responsable par d├®faut de ses propres cr├®ations.';
  END IF;

  -- ÔöÇÔöÇ 4 ┬À Garde de doublon dure ÔÇö 01-SCHEMA ┬º3.1, ERRCODE 23505 ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  -- Conjonction stricte : m├¬mes chiffres de t├®l├®phone + m├¬me naissance NON
  -- NULLE + m├¬me nom d├®saccentu├®. La RLS borne d├®j├á ce SELECT au p├®rim├¿tre de
  -- l'appelant (gatekeeper h├®rite des policies 004) ÔÇö aucun oracle nouveau.
  IF EXISTS (
    SELECT 1
    FROM app.patients p
    WHERE regexp_replace(p.phone, '[^0-9]', '', 'g') = v_tel_chiffres
      AND v_naissance IS NOT NULL
      AND p.birth_date = v_naissance
      AND app.immutable_unaccent(lower(p.last_name))
          = app.immutable_unaccent(lower(v_nom))
  ) THEN
    RAISE EXCEPTION 'Un dossier avec ces m├¬mes coordonn├®es existe d├®j├á.'
      USING ERRCODE = '23505',
            HINT    = 'Consultez les patients similaires propos├®s par l''├®cran avant de cr├®er.';
  END IF;

  -- ÔöÇÔöÇ 5 ┬À Num├®ro sans trou, puis ├®criture trac├®e ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  -- `next_number` verrouille sa ligne compteur (010) : le num├®ro consomm├® est
  -- rendu si la transaction avorte, quel que soit le point d'├®chec aval.
  v_numero := app.next_number(app.current_cabinet(), 'patient_record', 'ALL');

  -- `trg_audit` (013) journalise l'INSERT dans la m├¬me transaction (I4).
  RETURN QUERY
  INSERT INTO app.patients (
    cabinet_id, practitioner_id, record_number,
    first_name, last_name, birth_date, sex, phone, phone_alt, address,
    id_document_number, id_document_issuer, emergency_contact, notes_admin,
    created_by, is_synthetic
  ) VALUES (
    app.current_cabinet(),
    v_praticien,
    'P-' || lpad(v_numero::text, 4, '0'),
    v_prenom,
    v_nom,
    v_naissance,
    v_sexe,
    v_tel,
    nullif(btrim(coalesce(v_charge->>'phone_alt','')), ''),
    CASE WHEN v_charge ? 'address' THEN nullif(btrim(v_charge->>'address'),'') END,
    CASE WHEN v_charge ? 'id_document_number'
         THEN nullif(btrim(v_charge->>'id_document_number'),'') END,
    CASE WHEN v_charge ? 'id_document_issuer'
         THEN nullif(btrim(v_charge->>'id_document_issuer'),'') END,
    CASE WHEN v_charge ? 'emergency_contact'
          AND jsonb_typeof(v_charge->'emergency_contact') = 'object'
         THEN v_charge->'emergency_contact' END,
    CASE WHEN v_charge ? 'notes_admin' THEN nullif(btrim(v_charge->>'notes_admin'),'') END,
    auth.uid(), app.is_cloud_dev()
  )
  RETURNING *;
END;

$$;

ALTER FUNCTION app.create_patient(text) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.create_patient(text) IS
  'Patients V3 (052). Identique Ã  050 : numÃ©rotation sans trou via '
  'next_number(''patient_record'',''ALL''), garde de doublon dure '
  '(tÃ©lÃ©phone+naissance+nom) au pÃ©rimÃ¨tre RLS de l''appelant, praticien '
  'responsable validÃ© contre app.profiles du mÃªme cabinet, audit par '
  'trg_audit. Ajout 052 : is_synthetic := app.is_cloud_dev(), motif 023, pour '
  'satisfaire assert_synthetic_when_cloud en cloud-dev et rester juste au '
  'cabinet.';

REVOKE ALL ON FUNCTION app.create_patient(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_patient(text) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('052_create_patient_synthetique')
  ON CONFLICT DO NOTHING;

COMMIT;

