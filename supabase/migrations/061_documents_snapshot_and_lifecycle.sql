-- 061_documents_snapshot_and_lifecycle — Documents: snapshot, lifecycle, readiness
--
-- OBJECTIF (MASTER BUILD §§ PRIMARY OBJECTIVE, 1, 4, 5, MEDICO-LEGAL SNAPSHOT)
--   VIEW ≠ PRINT ≠ ISSUE. Le viewer ne doit plus bloquer sur un marqueur non résolu.
--   Le document émis est un snapshot immuable (rendered_html figé + métadonnées).
--   ISSUE ne consomme jamais un numéro si l'en-tête est incomplet.
--
-- CE QUE CE FICHIER FAIT (forward-only, 030-045 intouchés)
--   1. type app.doc_status ('issued','voided')
--   2. colonnes snapshot sur app.documents
--   3. trigger assert_document_immutable étendu (autorise issued→voided + printed_count)
--   4. issue_document v3 : validation en-tête AVANT next_number, snapshot + hash
--   5. void_document, document_readiness, list_documents, get_document/list enrichis
--   6. contrôles de cloison
--
-- CE QU'IL NE FAIT PAS
--   - ne touche pas render_template / html_escape
--   - ne crée pas de système d'événements parallèle : audit.log reste canonique (triggers 013)
--     DomainIssued/Voided/Printed sont tracés via audit.log INSERT/UPDATE

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 0 · pgcrypto pour digest/sha256 (déjà en 001, idempotent)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1 · Type lifecycle
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE app.doc_status AS ENUM ('issued','voided');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2 · Colonnes snapshot sur app.documents
-- ---------------------------------------------------------------------------
-- is_synthetic déjà présent depuis 016 (découverte patient_id)
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS status            app.doc_status NOT NULL DEFAULT 'issued';
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS voided_at        timestamptz;
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS void_reason      text;
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS template_id      uuid REFERENCES app.document_templates(id);
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS template_version integer;
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS schema_version   text NOT NULL DEFAULT '1';
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS content_hash     text;
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS snapshot_header  jsonb;

-- Index pour listing global cabinet + date
CREATE INDEX IF NOT EXISTS documents_cabinet_issued ON app.documents (cabinet_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS documents_patient_issued_status ON app.documents (patient_id, issued_at DESC) WHERE status = 'issued';

-- ---------------------------------------------------------------------------
-- 3 · Trigger immutabilité étendu — seule transition autorisée: issued→voided
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.assert_document_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  -- Transition void autorisée
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (OLD.status = 'issued' AND NEW.status = 'voided') THEN
      RAISE EXCEPTION 'Transition de statut non autorisée : % → %.', OLD.status, NEW.status;
    END IF;
    -- voided_at doit être posé, depuis NULL
    IF OLD.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'Document déjà annulé.';
    END IF;
    IF NEW.voided_at IS NULL THEN
      RAISE EXCEPTION 'Annulation sans date.';
    END IF;
    IF NEW.void_reason IS NULL OR btrim(NEW.void_reason) = '' THEN
      RAISE EXCEPTION 'Motif d''annulation obligatoire.';
    END IF;
    -- Le reste de la protection s'applique aussi
  END IF;

  -- Autoriser uniquement: printed_count, status/voided_at/void_reason (cas void), et content_hash/snapshot si NULL→rempli pour rattrapage ancien
  -- Mais after issue, tout le reste est gelé.
  -- On compare champ par champ; les 3 champs void + printed_count sont les seules différences permises hors transition.
  IF NEW.rendered_html    IS DISTINCT FROM OLD.rendered_html
     OR NEW.doc_number    IS DISTINCT FROM OLD.doc_number
     OR NEW.doc_type      IS DISTINCT FROM OLD.doc_type
     OR NEW.variables     IS DISTINCT FROM OLD.variables
     OR NEW.issued_at     IS DISTINCT FROM OLD.issued_at
     OR NEW.patient_id    IS DISTINCT FROM OLD.patient_id
     OR NEW.practitioner_id IS DISTINCT FROM OLD.practitioner_id
     OR NEW.cabinet_id    IS DISTINCT FROM OLD.cabinet_id
     OR NEW.consultation_id IS DISTINCT FROM OLD.consultation_id
     OR NEW.template_id   IS DISTINCT FROM OLD.template_id
     OR NEW.template_version IS DISTINCT FROM OLD.template_version
     OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
     OR NEW.content_hash  IS DISTINCT FROM OLD.content_hash
     OR NEW.snapshot_header IS DISTINCT FROM OLD.snapshot_header
     OR NEW.is_synthetic  IS DISTINCT FROM OLD.is_synthetic
  THEN
    RAISE EXCEPTION 'Document % verrouillé après émission : seul le compteur d''impression et l''annulation peuvent changer.', OLD.doc_number
      USING HINT = 'Un document émis ne se corrige pas — émettez-en un nouveau (ADR-004).';
  END IF;

  -- printed_count : seule colonne qui peut bouger librement (même voided, on le permet - compteur opérationnel)
  -- status/void* déjà validés ci-dessus
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_immutable_after_issue ON app.documents;
CREATE TRIGGER document_immutable_after_issue
  BEFORE UPDATE ON app.documents
  FOR EACH ROW EXECUTE FUNCTION app.assert_document_immutable();

-- forbid delete inchangé (030 §1bis-2)
-- Déjà présent, on le repose idempotent
CREATE OR REPLACE FUNCTION app.forbid_document_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Un document émis ne se supprime jamais (ADR-004, même principe que les notes signées).';
END;
$$;
DROP TRIGGER IF EXISTS document_no_delete ON app.documents;
CREATE TRIGGER document_no_delete
  BEFORE DELETE ON app.documents
  FOR EACH ROW EXECUTE FUNCTION app.forbid_document_delete();

-- ---------------------------------------------------------------------------
-- 4 · Helpers readiness — centralise la liste des champs requis pour l'en-tête
--    Utilisé par issue_document (bloquant) et document_readiness (lecture)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app._document_header_missing(p_cabinet uuid, p_practitioner uuid)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path = app, pg_catalog
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN btrim(COALESCE((SELECT name FROM app.cabinets WHERE id = p_cabinet), '')) = '' THEN 'cabinet.name' END,
    CASE WHEN btrim(COALESCE((SELECT address FROM app.cabinets WHERE id = p_cabinet), '')) = '' THEN 'cabinet.address' END,
    CASE WHEN btrim(COALESCE((SELECT phone FROM app.cabinets WHERE id = p_cabinet), '')) = '' THEN 'cabinet.phone' END,
    CASE WHEN btrim(COALESCE((SELECT full_name FROM app.profiles WHERE id = p_practitioner), '')) = '' THEN 'praticien.full_name' END,
    CASE WHEN btrim(COALESCE((SELECT title FROM app.profiles WHERE id = p_practitioner), '')) = '' THEN 'praticien.title' END,
    CASE WHEN btrim(COALESCE((SELECT speciality_fr FROM app.profiles WHERE id = p_practitioner), '')) = '' THEN 'praticien.speciality_fr' END,
    CASE WHEN btrim(COALESCE((SELECT order_number FROM app.profiles WHERE id = p_practitioner), '')) = '' THEN 'praticien.order_number' END,
    CASE WHEN btrim(COALESCE((SELECT phone FROM app.profiles WHERE id = p_practitioner), '')) = '' THEN 'praticien.phone' END,
    -- full_name_ar vit dans signature_block, exigé par les certificats
    CASE WHEN btrim(COALESCE((SELECT signature_block->>'full_name_ar' FROM app.profiles WHERE id = p_practitioner), '')) = '' THEN 'praticien.full_name_ar' END
  ], NULL);
$$;

-- ---------------------------------------------------------------------------
-- 5 · document_readiness — lecture seule, pour le CTA "Prêt à émettre"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.document_readiness()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_cab  uuid := app.current_cabinet();
  v_moi  uuid := auth.uid();
  v_missing text[];
  v_can boolean;
BEGIN
  IF v_cab IS NULL OR v_moi IS NULL THEN
    RETURN jsonb_build_object('canIssue', false, 'canPrint', false, 'missing', '[]'::jsonb);
  END IF;
  v_missing := app._document_header_missing(v_cab, v_moi);
  v_can := array_length(v_missing, 1) IS NULL;
  RETURN jsonb_build_object(
    'canIssue', v_can,
    'canPrint', v_can,
    'missing', COALESCE(to_jsonb(v_missing), '[]'::jsonb)
  );
END;
$$;
ALTER FUNCTION app.document_readiness() OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.document_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.document_readiness() TO authenticated;
COMMENT ON FUNCTION app.document_readiness() IS 'Readiness Documents: vérifie en-tête cabinet+praticien. canIssue/canPrint faux si un champ requis manque.';

-- ---------------------------------------------------------------------------
-- 6 · issue_document v3 — snapshot + hash + garde avant next_number
--     Signature inchangée (uuid, doc_type, text, uuid) → CREATE OR REPLACE ok
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
         p.id_document_number, p.sex
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
        'civilite',      CASE v_pat.sex WHEN 'M' THEN 'Mr' WHEN 'F' THEN 'Mme' END,
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

-- Rattrapage pour documents anciens sans snapshot (hash nul) — trigger désactivé le temps du rattrapage
ALTER TABLE app.documents DISABLE TRIGGER document_immutable_after_issue;
UPDATE app.documents
   SET content_hash = encode(digest(rendered_html, 'sha256'), 'hex'),
       schema_version = '1',
       status = COALESCE(status, 'issued')
 WHERE content_hash IS NULL;
ALTER TABLE app.documents ENABLE TRIGGER document_immutable_after_issue;

-- ---------------------------------------------------------------------------
-- 7 · void_document
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.void_document(p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE v_doc app.documents%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Document manquant.';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Motif d''annulation obligatoire.';
  END IF;

  SELECT * INTO v_doc FROM app.documents WHERE id = p_id FOR UPDATE;
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'Document introuvable.';
  END IF;
  IF v_doc.cabinet_id <> app.current_cabinet() OR NOT app.can_see_clinical(v_doc.practitioner_id) THEN
    RAISE EXCEPTION 'Document hors périmètre.';
  END IF;
  IF v_doc.status = 'voided' THEN
    RAISE EXCEPTION 'Document déjà annulé.';
  END IF;
  IF v_doc.practitioner_id <> auth.uid() AND app.current_role() <> 'owner' THEN
    RAISE EXCEPTION 'Seule la praticienne du document (ou owner) peut l''annuler.';
  END IF;

  -- Audit: la lecture nominative pour tracer qui annule quoi (patient_id)
  PERFORM audit.log_read(v_doc.patient_id, 'fiche');

  UPDATE app.documents
     SET status = 'voided',
         voided_at = now(),
         void_reason = btrim(p_reason)
   WHERE id = p_id;
END;
$$;
ALTER FUNCTION app.void_document(uuid, text) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.void_document(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.void_document(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8 · list_documents global paginé
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.list_documents(
  p_query text DEFAULT NULL,
  p_type  app.doc_type DEFAULT NULL,
  p_status app.doc_status DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0)
RETURNS TABLE (
  document_id        uuid,
  doc_type           app.doc_type,
  doc_number         text,
  issued_at          timestamptz,
  printed_count      integer,
  status             app.doc_status,
  voided_at          timestamptz,
  patient_id         uuid,
  patient_first_name text,
  patient_last_name  text,
  record_number      text,
  practitioner_name  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_limit  integer := least(greatest(COALESCE(p_limit,20),1), 50);
  v_offset integer := greatest(COALESCE(p_offset,0),0);
  v_needle text := nullif(btrim(COALESCE(p_query,'')), '');
BEGIN
  -- Une seule trace liste par affichage, patient_id NULL (patron dashboard_today/reception_board)
  PERFORM audit.log_read(NULL, 'liste');

  RETURN QUERY
  SELECT d.id, d.doc_type, d.doc_number, d.issued_at, d.printed_count, d.status, d.voided_at,
         d.patient_id, pt.first_name, pt.last_name, pt.record_number, pr.full_name
    FROM app.documents d
    LEFT JOIN app.patients pt ON pt.id = d.patient_id
    LEFT JOIN app.profiles pr ON pr.id = d.practitioner_id
   WHERE d.cabinet_id = app.current_cabinet()
     AND app.can_see_clinical(d.practitioner_id)
     AND (p_type IS NULL OR d.doc_type = p_type)
     AND (p_status IS NULL OR d.status = p_status)
     AND (v_needle IS NULL
          OR d.doc_number ILIKE '%' || v_needle || '%'
          OR pt.first_name ILIKE '%' || v_needle || '%'
          OR pt.last_name  ILIKE '%' || v_needle || '%'
          OR pt.record_number = v_needle)
   ORDER BY d.issued_at DESC
   LIMIT v_limit OFFSET v_offset;
END;
$$;
ALTER FUNCTION app.list_documents(text, app.doc_type, app.doc_status, integer, integer) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_documents(text, app.doc_type, app.doc_status, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_documents(text, app.doc_type, app.doc_status, integer, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9 · get_document enrichi (retourne nouvelles colonnes) — REDEFINI (DROP nécessaire: return type change)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS app.get_document(uuid);
CREATE FUNCTION app.get_document(p_id uuid)
RETURNS TABLE (
  document_id        uuid,
  doc_type           app.doc_type,
  doc_number         text,
  rendered_html      text,
  variables          jsonb,
  issued_at          timestamptz,
  printed_count      integer,
  consultation_id    uuid,
  patient_id         uuid,
  patient_first_name text,
  patient_last_name  text,
  record_number      text,
  practitioner_name  text,
  status             app.doc_status,
  voided_at          timestamptz,
  void_reason        text,
  template_id        uuid,
  template_version   integer,
  content_hash       text,
  snapshot_header    jsonb,
  schema_version     text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_pat uuid;
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  SELECT d.patient_id INTO v_pat
    FROM app.documents d
   WHERE d.id = p_id
     AND d.cabinet_id = app.current_cabinet()
     AND app.can_see_clinical(d.practitioner_id);
  IF v_pat IS NULL THEN RETURN; END IF;
  PERFORM audit.log_read(v_pat, 'fiche');
  RETURN QUERY
  SELECT d.id, d.doc_type, d.doc_number, d.rendered_html, d.variables,
         d.issued_at, d.printed_count, d.consultation_id, d.patient_id,
         pt.first_name, pt.last_name, pt.record_number, pr.full_name,
         d.status, d.voided_at, d.void_reason, d.template_id, d.template_version,
         d.content_hash, d.snapshot_header, d.schema_version
    FROM app.documents d
    LEFT JOIN app.patients pt ON pt.id = d.patient_id
    LEFT JOIN app.profiles pr ON pr.id = d.practitioner_id
   WHERE d.id = p_id
     AND d.cabinet_id = app.current_cabinet()
     AND app.can_see_clinical(d.practitioner_id);
END;
$$;
ALTER FUNCTION app.get_document(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_document(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10 · list_patient_documents enrichi (DROP nécessaire: return type change)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS app.list_patient_documents(uuid);
CREATE FUNCTION app.list_patient_documents(p_patient_id uuid)
RETURNS TABLE (
  document_id       uuid,
  doc_type          app.doc_type,
  doc_number        text,
  issued_at         timestamptz,
  printed_count     integer,
  consultation_id   uuid,
  practitioner_name text,
  status            app.doc_status,
  voided_at         timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE v_visible boolean;
BEGIN
  IF p_patient_id IS NULL THEN RETURN; END IF;
  SELECT EXISTS (
    SELECT 1 FROM app.patients p
     WHERE p.id = p_patient_id
       AND p.cabinet_id = app.current_cabinet()
       AND app.can_see_clinical(p.practitioner_id))
    INTO v_visible;
  IF NOT v_visible THEN RETURN; END IF;
  PERFORM audit.log_read(p_patient_id, 'liste');
  RETURN QUERY
  SELECT d.id, d.doc_type, d.doc_number, d.issued_at, d.printed_count,
         d.consultation_id, pr.full_name, d.status, d.voided_at
    FROM app.documents d
    LEFT JOIN app.profiles pr ON pr.id = d.practitioner_id
   WHERE d.patient_id = p_patient_id
     AND d.cabinet_id = app.current_cabinet()
     AND app.can_see_clinical(d.practitioner_id)
   ORDER BY d.issued_at DESC;
END;
$$;
ALTER FUNCTION app.list_patient_documents(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.list_patient_documents(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_patient_documents(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11 · Cloison checks
-- ---------------------------------------------------------------------------
DO $ctl$
DECLARE v_owner name; v_def boolean; v_bypass boolean;
BEGIN
  SELECT pg_get_userbyid(p.proowner), p.prosecdef INTO v_owner, v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='app' AND p.proname='issue_document';
  IF v_owner <> 'app_gatekeeper' THEN RAISE EXCEPTION 'issue_document owner %', v_owner; END IF;
  IF NOT v_def THEN RAISE EXCEPTION 'issue_document not definer'; END IF;
  SELECT rolbypassrls INTO v_bypass FROM pg_roles WHERE rolname='app_gatekeeper';
  IF v_bypass THEN RAISE EXCEPTION 'app_gatekeeper BYPASSRLS'; END IF;
END $ctl$;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;
NOTIFY pgrst, 'reload schema';
INSERT INTO app.schema_migrations (version) VALUES ('061_documents_snapshot_and_lifecycle') ON CONFLICT DO NOTHING;
COMMIT;
