-- ═══════════════════════════════════════════════════════════════════════════
-- 050_create_patient — LA porte de création de dossier patient.
--
-- ⚠️ C'EST LA « DÉCISION EXPLICITE » ANNONCÉE DEPUIS 020 §2.
--    020 refusait délibérément `GRANT INSERT ON app.patients TO app_gatekeeper`
--    (« la création de patient n'est pas dans ADR-019 et n'entrera ici que par
--    une décision explicite »). Patients V3 est cette décision : la migration
--    accorde le privilège ET pose la seule fonction qui l'exerce.
--
-- ═══ CE QUE CETTE PORTE GARANTIT ═══════════════════════════════════════════
--
--   1 · NUMÉROTATION SANS TROU (I17/P7). Le numéro vient d'UN appel à
--       `app.next_number(cabinet, 'patient_record', 'ALL')` — la portée semée
--       par 015 et restée vide jusqu'ici. `ON CONFLICT DO UPDATE` verrouille la
--       ligne du compteur : aucun trou même sous concurrence, un ROLLBACK rend
--       le numéro. Format `P-nnnn`, aligné sur le gabarit « #P-0147 » du
--       design system. La contrainte `patients_record_unique` (004) reste en
--       filet derrière le compteur.
--
--   2 · GARDE DE DOUBLON DURE — la règle écrite dans 01-SCHEMA §3.1 depuis
--       l'origine (« L'unicité se fait sur (practitioner_id, phone, birth_date)
--       — appliquée en logique métier, pas en contrainte », car deux enfants
--       partagent le téléphone de leur mère). Elle ne se déclenche que sur la
--       conjonction : mêmes chiffres de téléphone + même date de naissance NON
--       NULLE + même nom désaccentué. Tout le reste relève du conseil
--       (porte `find_similar_patients`, 051), jamais du refus.
--       ⚠️ PAS UN ORACLE NOUVEAU : ce SELECT s'exécute sous app_gatekeeper,
--       membre non-bypassrls de authenticated — la RLS de 004 le filtre au
--       périmètre de l'appelant. Quiconque peut créer peut déjà chercher ces
--       lignes ; le garde n'apprend rien à personne.
--       Le refus porte l'ERRCODE `23505` pour que la couche applicative le
--       distingue d'une règle métier générique — sans jamais afficher le texte
--       brut de l'exception, qui porterait la valeur fautive (I5).
--
--   3 · PRATICIEN RESPONSABLE — règle UNIQUE de validation de donnée, sans
--       aucun branchement sur le rôle de l'appelant (règle 4). Par défaut :
--       `auth.uid()` (un praticien crée pour elle-même). Un appelant peut en
--       désigner un autre — cas ADR-005 : l'assistante enregistre l'arrivée
--       d'un patient pour l'un des praticiens du cabinet. Dans tous les cas le
--       cible doit être un profil ACTIF du MÊME cabinet portant un rôle
--       clinique. La cloison reste entière : le WITH CHECK de `004` refuse de
--       toute façon à un praticien la ligne d'un autre.
--       → Arbitrage inscrit à l'ADR-025 (accepter et VALIDER
--         `practitioner_id`, plutôt que l'interdire).
--
--   4 · AUDIT HÉRITÉ, PAS RÉIMPLÉMENTÉ. `trg_audit` (013) est attaché à
--       `app.patients` : l'INSERT trace acteur, rôle et valeurs dans la MÊME
--       transaction (I4). Si la trace échoue, la création échoue avec elle.
--
-- ═══ CHARGE ════════════════════════════════════════════════════════════════
--
-- `p_charge` arrive en TEXTE (convention `RpcArgs` : scalaires uniquement,
-- ADR-021). Il accepte l'objet sérialisé PAR LE CLIENT — forme réelle du
-- chemin PostgREST — ET l'objet brut, leçon 049 : un checkpoint qui passe
-- `'…'::jsonb` pendant que la porte n'exerce que l'autre forme ne prouve rien.
--
-- ALLOWLIST FERMÉE, même discipline que `update_patient` : clé inconnue =
-- REFUS, pas ignorance silencieuse. `record_number`, `cabinet_id`,
-- `created_at`, `is_active` n'y figurent pas : le numéro se gagne par le
-- compteur, le cabinet vient de `app.current_cabinet()`, un dossier naît actif.
--
-- ═══ RETOUR ARRIÈRE (documentation, jamais exécuté automatiquement) ════════
--
--   DROP FUNCTION IF EXISTS app.create_patient(text);
--   REVOKE INSERT ON app.patients FROM app_gatekeeper;
--
-- Les deux gestes rendent la porte inexistante ; aucun objet de donnée n'est
-- détruit. À ne jouer qu'en décision humaine explicite.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Le privilège de création — la décision annoncée par 020 §2
-- ---------------------------------------------------------------------------
GRANT INSERT ON app.patients TO app_gatekeeper;

-- Transfert de propriété : le motif complet est documenté dans 020 §3 et
-- rappelé dans 030 §1. On accorde CREATE le temps du transfert, on le retire
-- en fin de fichier (§4).
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 2 · La porte
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
  -- ── 0 · Charge présente, objet JSON, forme sérialisée acceptée ──────────
  IF p_charge IS NULL OR btrim(p_charge) = '' THEN
    RAISE EXCEPTION 'Charge de création manquante : un objet JSON est attendu.';
  END IF;

  BEGIN
    v_charge := p_charge::jsonb;
  EXCEPTION
    WHEN invalid_text_representation OR invalid_parameter_value THEN
      RAISE EXCEPTION 'Charge de création invalide : un objet JSON est attendu.';
  END;
  -- Double encodage (leçon 049) : une chaîne qui CONTIENT encore du JSON est
  -- déballée une fois. Deux formes pour un seul contrat.
  IF jsonb_typeof(v_charge) = 'string' THEN
    v_charge := (v_charge #>> '{}')::jsonb;
  END IF;
  IF jsonb_typeof(v_charge) <> 'object' THEN
    RAISE EXCEPTION 'Charge de création invalide : un objet JSON est attendu.';
  END IF;

  -- Clé inconnue = refus. Ignorer ferait croire à l'appelant que son champ a
  -- été pris en compte.
  FOREACH k IN ARRAY ARRAY(SELECT jsonb_object_keys(v_charge)) LOOP
    IF NOT (k = ANY (allowed)) THEN
      RAISE EXCEPTION 'Champ non créable par cette porte : %.', k
        USING HINT = 'record_number, cabinet_id et is_active sont exclus par conception.';
    END IF;
  END LOOP;

  -- ── 1 · Champs requis — prénom, nom, téléphone ──────────────────────────
  v_prenom := btrim(coalesce(v_charge->>'first_name', ''));
  v_nom    := btrim(coalesce(v_charge->>'last_name', ''));
  v_tel    := btrim(coalesce(v_charge->>'phone', ''));

  IF v_prenom = '' OR v_nom = '' OR v_tel = '' THEN
    RAISE EXCEPTION 'Création incomplète : prénom, nom et téléphone sont obligatoires.';
  END IF;

  -- Miroir EXACT de la contrainte `patients_phone_format` (004). La base reste
  -- l'autorité ; ce test donne un refus immédiat et prévisible.
  IF v_tel !~ '^[0-9+ ]{8,20}$' THEN
    RAISE EXCEPTION 'Téléphone invalide : 8 à 20 caractères, chiffres, espaces et « + » uniquement.';
  END IF;
  v_tel_chiffres := regexp_replace(v_tel, '[^0-9]', '', 'g');

  -- ── 2 · Champs facultatifs typés ─────────────────────────────────────────
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

  -- Un JSON `null` explicite vaut « pas de contact » (le client efface), pas
  -- une charge invalide : seul un NON-objet non nul est refusé.
  IF v_charge ? 'emergency_contact'
     AND jsonb_typeof(v_charge->'emergency_contact') <> 'object'
     AND jsonb_typeof(v_charge->'emergency_contact') <> 'null' THEN
    RAISE EXCEPTION 'Contact d''urgence invalide : un objet {name, relation, phone} est attendu.';
  END IF;

  -- ── 3 · Praticien responsable — règle unique de validation de donnée ────
  -- Aucune lecture du rôle de l'appelant : la règle porte sur le PROFIL CIBLE.
  -- Absent ⇒ auth.uid() (le praticien se crée ses propres dossiers). Présent ⇒
  -- il doit être un profil clinique actif DU CABINET de l'appelant.
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
      USING HINT = 'L''assistante désigne le praticien responsable ; un praticien '
                   'est responsable par défaut de ses propres créations.';
  END IF;

  -- ── 4 · Garde de doublon dure — 01-SCHEMA §3.1, ERRCODE 23505 ───────────
  -- Conjonction stricte : mêmes chiffres de téléphone + même naissance NON
  -- NULLE + même nom désaccentué. La RLS borne déjà ce SELECT au périmètre de
  -- l'appelant (gatekeeper hérite des policies 004) — aucun oracle nouveau.
  IF EXISTS (
    SELECT 1
    FROM app.patients p
    WHERE regexp_replace(p.phone, '[^0-9]', '', 'g') = v_tel_chiffres
      AND v_naissance IS NOT NULL
      AND p.birth_date = v_naissance
      AND app.immutable_unaccent(lower(p.last_name))
          = app.immutable_unaccent(lower(v_nom))
  ) THEN
    RAISE EXCEPTION 'Un dossier avec ces mêmes coordonnées existe déjà.'
      USING ERRCODE = '23505',
            HINT    = 'Consultez les patients similaires proposés par l''écran avant de créer.';
  END IF;

  -- ── 5 · Numéro sans trou, puis écriture tracée ───────────────────────────
  -- `next_number` verrouille sa ligne compteur (010) : le numéro consommé est
  -- rendu si la transaction avorte, quel que soit le point d'échec aval.
  v_numero := app.next_number(app.current_cabinet(), 'patient_record', 'ALL');

  -- `trg_audit` (013) journalise l'INSERT dans la même transaction (I4).
  RETURN QUERY
  INSERT INTO app.patients (
    cabinet_id, practitioner_id, record_number,
    first_name, last_name, birth_date, sex, phone, phone_alt, address,
    id_document_number, id_document_issuer, emergency_contact, notes_admin,
    created_by
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
    auth.uid()
  )
  RETURNING *;
END;
$$;

ALTER FUNCTION app.create_patient(text) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.create_patient(text) IS
  'Patients V3. Seule porte de création d''un dossier patient. Numérotation sans '
  'trou via next_number(''patient_record'',''ALL''), garde de doublon dure '
  '(téléphone+naissance+nom) au périmètre RLS de l''appelant, praticien '
  'responsable validé contre app.profiles du même cabinet. Audit par trg_audit.';

-- ---------------------------------------------------------------------------
-- 3 · Qui peut franchir la porte
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION app.create_patient(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_patient(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · Retrait du privilège de transfert — même motif que 020 §5 / 030 §7
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('050_create_patient')
  ON CONFLICT DO NOTHING;

COMMIT;
