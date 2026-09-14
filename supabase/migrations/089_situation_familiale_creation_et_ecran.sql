-- 089_situation_familiale_creation_et_ecran — la seconde moitié de 088
--
-- 088 a posé la donnée, le résolveur de civilité et les gabarits. Il restait
-- deux trous, l'un et l'autre visibles pour la praticienne :
--
--   1 · `create_patient` a sa PROPRE allowlist de clés et REFUSE toute clé
--       inconnue (« Champ non autorisé »). La situation familiale ne pouvait
--       donc pas être saisie à l'ouverture d'un dossier — seulement après coup,
--       par « Modifier ». Un dossier neuf partait à NULL, donc « Mme ».
--
--   2 · `get_patient_workspace` rend un CONTRAT jsonb explicite, colonne par
--       colonne : une colonne absente du contrat n'existe pas pour l'écran.
--       La fiche patient ne pouvait donc pas AFFICHER ce qu'elle venait
--       d'enregistrer. `getPatient` (SETOF app.patients) le rendait déjà, d'où
--       le formulaire qui savait la lire — mais pas la vue 360.
--
-- ⚠️ LES DEUX FONCTIONS SONT RECOPIÉES DE LEUR SIGNATURE VIVANTE, trouvée en
-- cherchant le NOM DE LA FONCTION et non un mot de son corps :
--   · `create_patient`        → 052 (et non 050) ;
--   · `get_patient_workspace` → 081 (et non 047, 048, 053, 056, 057, 076, 078,
--     080, qui l'ont toutes redéfinie entre-temps).
--
-- C'est la leçon coûteuse de 088 : une migration peut changer une fonction par
-- un simple `ALTER FUNCTION` sans écrire un mot de son corps, et une recherche
-- thématique ne la voit pas. `CREATE OR REPLACE` réécrit TOUS les attributs.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · create_patient — recopié de 052, deux ajouts
-- ---------------------------------------------------------------------------
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
    'emergency_contact','notes_admin','practitioner_id','marital_status'];

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
    marital_status,
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
    -- ⚠️ MÊME PRUDENCE QUE POUR `sex` CI-DESSUS : une valeur inconnue vaut
    -- « non renseignée », elle ne fait pas ÉCHOUER la création. Un cast nu
    -- lèverait un 22P02 dont le message porte la valeur reçue — donc une
    -- donnée de saisie dans un message d'erreur (règle 1, I5).
    CASE WHEN (v_charge->>'marital_status') IN
              ('celibataire','en_couple','marie','divorce','veuf')
         THEN (v_charge->>'marital_status')::app.marital_status END,
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

-- ---------------------------------------------------------------------------
-- 2 · get_patient_workspace — recopié de 081, un champ ajouté au contrat
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.get_patient_workspace(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = app, audit, pg_catalog AS $$
DECLARE v_pat app.patients%ROWTYPE; v_clinique boolean; v_resultat jsonb;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  PERFORM audit.log_read(p_id, 'fiche');
  SELECT * INTO v_pat FROM app.patients WHERE id = p_id; IF NOT FOUND THEN RETURN NULL; END IF;
  v_clinique := app.can_see_clinical(v_pat.practitioner_id);
  SELECT jsonb_build_object(
    'contrat', 1, 'genere_a', now(),
    'identite', jsonb_build_object('id', v_pat.id, 'record_number', v_pat.record_number, 'first_name', v_pat.first_name, 'last_name', v_pat.last_name, 'birth_date', v_pat.birth_date, 'age', CASE WHEN v_pat.birth_date IS NULL THEN NULL ELSE extract(year FROM age(v_pat.birth_date))::int END, 'sex', v_pat.sex, 'marital_status', v_pat.marital_status, 'is_active', v_pat.is_active),
    'contact', jsonb_build_object('phone', v_pat.phone, 'phone_alt', v_pat.phone_alt, 'address', v_pat.address, 'emergency_contact', v_pat.emergency_contact),
    'identification', jsonb_build_object('id_document_number', v_pat.id_document_number, 'id_document_issuer', v_pat.id_document_issuer),
    'admin', jsonb_build_object('notes_admin', v_pat.notes_admin),
    'clinique', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE jsonb_build_object(
      'diagnostics', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'code_system', d.code_system, 'code', d.code, 'label', d.label, 'is_primary', d.is_primary, 'onset_date', d.onset_date, 'resolved_at', d.resolved_at) ORDER BY d.is_primary DESC, d.onset_date DESC NULLS LAST, d.created_at DESC) FROM app.diagnoses d WHERE d.patient_id = p_id), '[]'::jsonb),
      'echelles', COALESCE((SELECT jsonb_agg(jsonb_build_object('scale_code', e.code, 'scale_name', e.name_fr, 'dernier', jsonb_build_object('score', e.d_score, 'date', e.d_date, 'interpretation', e.d_interp), 'precedent', CASE WHEN e.p_date IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('score', e.p_score, 'date', e.p_date) END, 'delta', CASE WHEN e.p_score IS NULL OR e.d_score IS NULL THEN NULL ELSE e.d_score - e.p_score END) ORDER BY e.d_date DESC) FROM (SELECT r.code, r.name_fr, max(r.total_score) FILTER (WHERE r.rang=1) AS d_score, max(r.administered_at) FILTER (WHERE r.rang=1) AS d_date, max(r.interpretation) FILTER (WHERE r.rang=1) AS d_interp, max(r.total_score) FILTER (WHERE r.rang=2) AS p_score, max(r.administered_at) FILTER (WHERE r.rang=2) AS p_date FROM (SELECT s.code, s.name_fr, sa.total_score, sa.interpretation, sa.administered_at, row_number() OVER (PARTITION BY sa.scale_id ORDER BY sa.administered_at DESC) AS rang FROM app.scale_administrations sa JOIN app.scales s ON s.id=sa.scale_id WHERE sa.patient_id=p_id) r WHERE r.rang<=2 GROUP BY r.code, r.name_fr) e), '[]'::jsonb),
      'derniere_consultation', (SELECT jsonb_build_object('id', c.id, 'started_at', c.started_at, 'ended_at', c.ended_at, 'status', c.status, 'kind', a.kind, 'practitioner_name', pr.full_name) FROM app.consultations c LEFT JOIN app.profiles pr ON pr.id=c.practitioner_id LEFT JOIN app.appointments a ON a.id=c.appointment_id WHERE c.patient_id=p_id ORDER BY c.started_at DESC LIMIT 1),
      'nombre_consultations', (SELECT count(*) FROM app.consultations c WHERE c.patient_id=p_id)
    ) END,
    'traitements', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE jsonb_build_object('derniere_prescription', (SELECT jsonb_build_object('id', px.id, 'prescribed_at', px.prescribed_at, 'is_handwritten', px.is_handwritten, 'practitioner_name', pr.full_name, 'lignes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pl.id, 'designation', COALESCE(m.inn, pl.free_text), 'brand_name', m.brand_name, 'dose', pl.dose, 'frequency_per_day', pl.frequency_per_day, 'duration_days', pl.duration_days, 'instructions', pl.instructions) ORDER BY pl.position) FROM app.prescription_lines pl LEFT JOIN app.medications m ON m.id=pl.medication_id WHERE pl.prescription_id=px.id), '[]'::jsonb)) FROM app.prescriptions px LEFT JOIN app.profiles pr ON pr.id=px.practitioner_id WHERE px.patient_id=p_id ORDER BY px.prescribed_at DESC LIMIT 1), 'nombre_prescriptions', (SELECT count(*) FROM app.prescriptions px WHERE px.patient_id=p_id)) END,
    -- CORRECTIF 081 (repris de 080) — `en_pause`/`arretes_recents` rendent le
    -- même jeu de colonnes que `actifs` : la jointure sur `app.medications`
    -- existait déjà pour les deux, seul l'objet JSON en omettait la moitié.
    -- `medication_id` n'est pas cosmétique : la sélection d'un autre dosage
    -- du même médicament en dépend.
    'traitements_v2', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE (SELECT jsonb_build_object(
      'actifs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pt.id, 'status', pt.status, 'dose', pt.dose, 'dose_unit', pt.dose_unit, 'frequency', pt.frequency, 'timing', pt.timing, 'instructions', pt.instructions, 'start_date', pt.start_date, 'end_date', pt.end_date, 'stopped_at', pt.stopped_at, 'stopped_reason', pt.stopped_reason, 'current_version', pt.current_version, 'created_at', pt.created_at, 'updated_at', pt.updated_at, 'medication_id', pt.medication_id, 'medication_raw', m.source_raw_value, 'brand_name', m.brand_name, 'form', m.form, 'strength', m.strength, 'inn', m.inn) ORDER BY pt.start_date DESC, pt.created_at DESC) FROM app.patient_treatments pt JOIN app.medications m ON m.id=pt.medication_id WHERE pt.patient_id=p_id AND pt.status='active'), '[]'::jsonb),
      'en_pause', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pt.id, 'status', pt.status, 'dose', pt.dose, 'dose_unit', pt.dose_unit, 'frequency', pt.frequency, 'timing', pt.timing, 'instructions', pt.instructions, 'start_date', pt.start_date, 'end_date', pt.end_date, 'stopped_at', pt.stopped_at, 'stopped_reason', pt.stopped_reason, 'current_version', pt.current_version, 'created_at', pt.created_at, 'updated_at', pt.updated_at, 'medication_id', pt.medication_id, 'medication_raw', m.source_raw_value, 'brand_name', m.brand_name, 'form', m.form, 'strength', m.strength, 'inn', m.inn) ORDER BY pt.updated_at DESC) FROM app.patient_treatments pt JOIN app.medications m ON m.id=pt.medication_id WHERE pt.patient_id=p_id AND pt.status='paused'), '[]'::jsonb),
      'arretes_recents', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pt.id, 'status', pt.status, 'dose', pt.dose, 'dose_unit', pt.dose_unit, 'frequency', pt.frequency, 'timing', pt.timing, 'instructions', pt.instructions, 'start_date', pt.start_date, 'end_date', pt.end_date, 'stopped_at', pt.stopped_at, 'stopped_reason', pt.stopped_reason, 'current_version', pt.current_version, 'created_at', pt.created_at, 'updated_at', pt.updated_at, 'medication_id', pt.medication_id, 'medication_raw', m.source_raw_value, 'brand_name', m.brand_name, 'form', m.form, 'strength', m.strength, 'inn', m.inn) ORDER BY pt.stopped_at DESC) FROM app.patient_treatments pt JOIN app.medications m ON m.id=pt.medication_id WHERE pt.patient_id=p_id AND pt.status='stopped' AND pt.stopped_at > now() - interval '90 days' LIMIT 20), '[]'::jsonb),
      'total_actifs', (SELECT count(*) FROM app.patient_treatments WHERE patient_id=p_id AND status='active'),
      'total', (SELECT count(*) FROM app.patient_treatments WHERE patient_id=p_id))) END,
    'agenda', jsonb_build_object('prochain_rendez_vous', (SELECT jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status, 'kind', a.kind, 'practitioner_name', pr.full_name) FROM app.appointments a LEFT JOIN app.profiles pr ON pr.id=a.practitioner_id WHERE a.patient_id=p_id AND a.starts_at >= now() AND a.status NOT IN ('cancelled','no_show') ORDER BY a.starts_at ASC LIMIT 1), 'dernier_rendez_vous', (SELECT jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status, 'kind', a.kind, 'practitioner_name', pr.full_name) FROM app.appointments a LEFT JOIN app.profiles pr ON pr.id=a.practitioner_id WHERE a.patient_id=p_id AND a.starts_at < now() ORDER BY a.starts_at DESC LIMIT 1), 'nombre_rendez_vous', (SELECT count(*) FROM app.appointments a WHERE a.patient_id=p_id)),
    'documents', jsonb_build_object('nombre', (SELECT count(*) FROM app.documents dc WHERE dc.patient_id=p_id), 'dernier_emis_le', (SELECT max(dc.issued_at) FROM app.documents dc WHERE dc.patient_id=p_id))
  ) INTO v_resultat;
  RETURN v_resultat;
END;
$$;
ALTER FUNCTION app.get_patient_workspace(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_patient_workspace(uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION app.get_patient_workspace(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Vérification — la migration se refuse si le contrat n'a pas bougé
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname = 'create_patient';
  IF v_def NOT LIKE '%marital_status%' THEN
    RAISE EXCEPTION '089 : create_patient n''accepte toujours pas marital_status.';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname = 'get_patient_workspace';
  IF v_def NOT LIKE '%marital_status%' THEN
    RAISE EXCEPTION '089 : le contrat d''ecran ne porte toujours pas marital_status.';
  END IF;

  -- La cloison de 081 doit survivre a la recopie : sans ce controle, une
  -- version future qui oublierait `can_see_clinical` passerait au vert.
  IF v_def NOT LIKE '%can_see_clinical%' THEN
    RAISE EXCEPTION '089 : get_patient_workspace a perdu can_see_clinical.';
  END IF;
END $mig$;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version)
VALUES ('089_situation_familiale_creation_et_ecran')
  ON CONFLICT DO NOTHING;

COMMIT;
