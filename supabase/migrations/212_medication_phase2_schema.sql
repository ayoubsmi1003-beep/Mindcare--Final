-- 212_medication_phase2_schema — Phase 2 du domaine médicament.
--
-- ⚠️ CE QUE CETTE MIGRATION AJOUTE, ET CE QU'ELLE REFUSE D'INVENTER.
--
-- Cinq familles de faits cliniques, toutes APPEND-ONLY :
--   · allergies / contre-indications (événement daté : déclarée, résolue, infirmée) ;
--   · effets indésirables (événement daté, éventuellement relié à un traitement) ;
--   · mesures de surveillance (poids, tension, biologie — valeur + unité) ;
--   · observance RAPPORTÉE (jamais un pourcentage calculé) ;
--   · revue d'interaction ATTESTÉE par la praticienne (aucun moteur automatique).
--   · liens de renouvellement entre deux ordonnances réelles.
--
-- Aucune ligne n'est modifiable ni supprimable : une correction est un nouvel
-- événement. Aucune table n'est visible par l'assistante (RLS clinique stricte).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Types fermés
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE app.allergy_event_kind AS ENUM ('noted','resolved','refuted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.allergy_severity AS ENUM ('legere','moderee','severe','anaphylaxie');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.adverse_severity AS ENUM ('leger','modere','severe','grave');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.adherence_status AS ENUM ('observant','partiel','non_observant','inconnu');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.adherence_source AS ENUM ('patient','entourage','pharmacie','observation_clinique');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.measurement_source AS ENUM ('consultation','laboratoire','auto_declare');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.interaction_conclusion AS ENUM (
    'aucune_interaction_retenue','interaction_possible','interaction_majeure','non_conclu'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2 · Allergies / contre-indications — événements immuables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.patient_allergy_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id       uuid NOT NULL REFERENCES app.cabinets(id),
  patient_id       uuid NOT NULL REFERENCES app.patients(id) ON DELETE RESTRICT,
  practitioner_id  uuid NOT NULL REFERENCES app.profiles(id),
  consultation_id  uuid REFERENCES app.consultations(id) ON DELETE SET NULL,
  substance        text NOT NULL CHECK (btrim(substance) <> '' AND length(substance) <= 200),
  substance_key    text NOT NULL CHECK (btrim(substance_key) <> ''),
  reaction         text,
  severity         app.allergy_severity,
  event_kind       app.allergy_event_kind NOT NULL,
  notes            text,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  is_synthetic     boolean NOT NULL DEFAULT false,
  CONSTRAINT chk_allergy_severity CHECK (
    (event_kind = 'noted' AND severity IS NOT NULL)
    OR (event_kind <> 'noted' AND severity IS NULL)
  )
);

COMMENT ON TABLE app.patient_allergy_events IS
  'Phase 2 — allergies/contre-indications append-only. L''état courant se déduit du dernier événement par substance.';
COMMENT ON COLUMN app.patient_allergy_events.substance_key IS
  'Clé normalisée (app.nom_recherche) pour regrouper les événements d''une même substance.';

CREATE INDEX IF NOT EXISTS allergy_events_patient_time
  ON app.patient_allergy_events (patient_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS allergy_events_patient_key
  ON app.patient_allergy_events (patient_id, substance_key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS allergy_events_cabinet
  ON app.patient_allergy_events (cabinet_id);

-- ---------------------------------------------------------------------------
-- 3 · Effets indésirables — événements immuables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.patient_adverse_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id       uuid NOT NULL REFERENCES app.cabinets(id),
  patient_id       uuid NOT NULL REFERENCES app.patients(id) ON DELETE RESTRICT,
  practitioner_id  uuid NOT NULL REFERENCES app.profiles(id),
  consultation_id  uuid REFERENCES app.consultations(id) ON DELETE SET NULL,
  treatment_id     uuid REFERENCES app.patient_treatments(id) ON DELETE RESTRICT,
  medication_id    uuid REFERENCES app.medications(id),
  symptom          text NOT NULL CHECK (btrim(symptom) <> '' AND length(symptom) <= 200),
  severity         app.adverse_severity NOT NULL,
  onset_date       date,
  resolved_date    date,
  action_taken     text,
  description      text,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  is_synthetic     boolean NOT NULL DEFAULT false,
  CONSTRAINT chk_adverse_dates CHECK (
    resolved_date IS NULL OR onset_date IS NULL OR resolved_date >= onset_date
  )
);

COMMENT ON TABLE app.patient_adverse_events IS
  'Phase 2 — effets indésirables append-only, reliés au traitement quand il est connu.';

CREATE INDEX IF NOT EXISTS adverse_events_patient_time
  ON app.patient_adverse_events (patient_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS adverse_events_treatment
  ON app.patient_adverse_events (treatment_id) WHERE treatment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS adverse_events_cabinet
  ON app.patient_adverse_events (cabinet_id);

-- ---------------------------------------------------------------------------
-- 4 · Mesures de surveillance — événements immuables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.patient_measurements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id       uuid NOT NULL REFERENCES app.cabinets(id),
  patient_id       uuid NOT NULL REFERENCES app.patients(id) ON DELETE RESTRICT,
  practitioner_id  uuid NOT NULL REFERENCES app.profiles(id),
  consultation_id  uuid REFERENCES app.consultations(id) ON DELETE SET NULL,
  kind             text NOT NULL CHECK (kind ~ '^[a-z0-9_]{2,40}$'),
  value            numeric NOT NULL CHECK (value >= 0),
  unit             text NOT NULL CHECK (btrim(unit) <> '' AND length(unit) <= 20),
  measured_at      timestamptz NOT NULL,
  source           app.measurement_source NOT NULL DEFAULT 'consultation',
  reference_low    numeric,
  reference_high   numeric,
  notes            text,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  is_synthetic     boolean NOT NULL DEFAULT false,
  CONSTRAINT chk_measurement_reference CHECK (
    reference_low IS NULL OR reference_high IS NULL OR reference_low <= reference_high
  )
);

COMMENT ON TABLE app.patient_measurements IS
  'Phase 2 — mesures de surveillance (poids, tension, biologie) : valeur, unité et date réelles. Aucune valeur déduite.';

CREATE INDEX IF NOT EXISTS measurements_patient_time
  ON app.patient_measurements (patient_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS measurements_patient_kind
  ON app.patient_measurements (patient_id, kind, measured_at DESC);
CREATE INDEX IF NOT EXISTS measurements_cabinet
  ON app.patient_measurements (cabinet_id);

-- ---------------------------------------------------------------------------
-- 5 · Observance rapportée — événements immuables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.treatment_adherence_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id       uuid NOT NULL REFERENCES app.cabinets(id),
  patient_id       uuid NOT NULL REFERENCES app.patients(id) ON DELETE RESTRICT,
  practitioner_id  uuid NOT NULL REFERENCES app.profiles(id),
  consultation_id  uuid REFERENCES app.consultations(id) ON DELETE SET NULL,
  treatment_id     uuid NOT NULL REFERENCES app.patient_treatments(id) ON DELETE RESTRICT,
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  status           app.adherence_status NOT NULL,
  source           app.adherence_source NOT NULL,
  notes            text,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  is_synthetic     boolean NOT NULL DEFAULT false,
  CONSTRAINT chk_adherence_period CHECK (period_end >= period_start)
);

COMMENT ON TABLE app.treatment_adherence_reports IS
  'Phase 2 — observance RAPPORTÉE par période. Aucun pourcentage, aucun score calculé, aucune prise inventée.';

CREATE INDEX IF NOT EXISTS adherence_patient_time
  ON app.treatment_adherence_reports (patient_id, period_end DESC);
CREATE INDEX IF NOT EXISTS adherence_treatment_time
  ON app.treatment_adherence_reports (treatment_id, period_end DESC);
CREATE INDEX IF NOT EXISTS adherence_cabinet
  ON app.treatment_adherence_reports (cabinet_id);

-- ---------------------------------------------------------------------------
-- 6 · Revue d'interaction attestée — aucun moteur automatique
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.treatment_interaction_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id       uuid NOT NULL REFERENCES app.cabinets(id),
  patient_id       uuid NOT NULL REFERENCES app.patients(id) ON DELETE RESTRICT,
  practitioner_id  uuid NOT NULL REFERENCES app.profiles(id),
  consultation_id  uuid REFERENCES app.consultations(id) ON DELETE SET NULL,
  source           text NOT NULL CHECK (btrim(source) <> '' AND length(source) <= 200),
  conclusion       app.interaction_conclusion NOT NULL,
  notes            text,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  is_synthetic     boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE app.treatment_interaction_reviews IS
  'Phase 2 — revue d''interaction ATTESTÉE par la praticienne, avec sa source. MindCare ne calcule aucune interaction.';

CREATE TABLE IF NOT EXISTS app.interaction_review_treatments (
  review_id     uuid NOT NULL REFERENCES app.treatment_interaction_reviews(id) ON DELETE CASCADE,
  treatment_id  uuid NOT NULL REFERENCES app.patient_treatments(id) ON DELETE RESTRICT,
  PRIMARY KEY (review_id, treatment_id)
);

CREATE INDEX IF NOT EXISTS interaction_reviews_patient_time
  ON app.treatment_interaction_reviews (patient_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS interaction_reviews_cabinet
  ON app.treatment_interaction_reviews (cabinet_id);
CREATE INDEX IF NOT EXISTS interaction_review_items_treatment
  ON app.interaction_review_treatments (treatment_id);

-- ---------------------------------------------------------------------------
-- 7 · Liens de renouvellement entre deux ordonnances réelles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.prescription_renewal_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id            uuid NOT NULL REFERENCES app.cabinets(id),
  patient_id            uuid NOT NULL REFERENCES app.patients(id) ON DELETE RESTRICT,
  practitioner_id       uuid NOT NULL REFERENCES app.profiles(id),
  new_document_id       uuid NOT NULL REFERENCES app.documents(id) ON DELETE RESTRICT,
  previous_document_id  uuid NOT NULL REFERENCES app.documents(id) ON DELETE RESTRICT,
  notes                 text,
  linked_at             timestamptz NOT NULL DEFAULT now(),
  is_synthetic          boolean NOT NULL DEFAULT false,
  CONSTRAINT chk_renewal_distinct CHECK (new_document_id <> previous_document_id),
  CONSTRAINT uq_renewal_new_document UNIQUE (new_document_id)
);

COMMENT ON TABLE app.prescription_renewal_links IS
  'Phase 2 — renouvellement = lien documenté entre deux ordonnances émises. Ce n''est pas une autorisation de renouveler.';

CREATE INDEX IF NOT EXISTS renewal_links_patient
  ON app.prescription_renewal_links (patient_id, linked_at DESC);
CREATE INDEX IF NOT EXISTS renewal_links_previous
  ON app.prescription_renewal_links (previous_document_id);
CREATE INDEX IF NOT EXISTS renewal_links_cabinet
  ON app.prescription_renewal_links (cabinet_id);

-- ---------------------------------------------------------------------------
-- 8 · Immutabilité append-only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.forbid_phase2_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% est append-only : % refuse', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END; $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patient_allergy_events',
    'patient_adverse_events',
    'patient_measurements',
    'treatment_adherence_reports',
    'treatment_interaction_reviews',
    'interaction_review_treatments',
    'prescription_renewal_links'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS forbid_phase2_mutation ON app.%I', t);
    EXECUTE format(
      'CREATE TRIGGER forbid_phase2_mutation BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.forbid_phase2_mutation()', t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 9 · RLS clinique stricte — aucune policy assistant
-- ---------------------------------------------------------------------------
ALTER TABLE app.patient_allergy_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.patient_allergy_events FORCE ROW LEVEL SECURITY;
ALTER TABLE app.patient_adverse_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.patient_adverse_events FORCE ROW LEVEL SECURITY;
ALTER TABLE app.patient_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.patient_measurements FORCE ROW LEVEL SECURITY;
ALTER TABLE app.treatment_adherence_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.treatment_adherence_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE app.treatment_interaction_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.treatment_interaction_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE app.interaction_review_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.interaction_review_treatments FORCE ROW LEVEL SECURITY;
ALTER TABLE app.prescription_renewal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.prescription_renewal_links FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phase2_allergy_clinical ON app.patient_allergy_events;
CREATE POLICY phase2_allergy_clinical ON app.patient_allergy_events
  FOR ALL TO authenticated
  USING (
    cabinet_id = app.current_cabinet()
    AND EXISTS (
      SELECT 1 FROM app.patients p
      WHERE p.id = patient_id AND app.can_see_clinical(p.practitioner_id)
    )
  )
  WITH CHECK (
    cabinet_id = app.current_cabinet()
    AND EXISTS (
      SELECT 1 FROM app.patients p
      WHERE p.id = patient_id AND app.can_see_clinical(p.practitioner_id)
    )
  );

DROP POLICY IF EXISTS phase2_adverse_clinical ON app.patient_adverse_events;
CREATE POLICY phase2_adverse_clinical ON app.patient_adverse_events
  FOR ALL TO authenticated
  USING (
    cabinet_id = app.current_cabinet()
    AND EXISTS (
      SELECT 1 FROM app.patients p
      WHERE p.id = patient_id AND app.can_see_clinical(p.practitioner_id)
    )
  )
  WITH CHECK (
    cabinet_id = app.current_cabinet()
    AND EXISTS (
      SELECT 1 FROM app.patients p
      WHERE p.id = patient_id AND app.can_see_clinical(p.practitioner_id)
    )
  );

DROP POLICY IF EXISTS phase2_measurement_clinical ON app.patient_measurements;
CREATE POLICY phase2_measurement_clinical ON app.patient_measurements
  FOR ALL TO authenticated
  USING (
    cabinet_id = app.current_cabinet()
    AND EXISTS (
      SELECT 1 FROM app.patients p
      WHERE p.id = patient_id AND app.can_see_clinical(p.practitioner_id)
    )
  )
  WITH CHECK (
    cabinet_id = app.current_cabinet()
    AND EXISTS (
      SELECT 1 FROM app.patients p
      WHERE p.id = patient_id AND app.can_see_clinical(p.practitioner_id)
    )
  );

DROP POLICY IF EXISTS phase2_adherence_clinical ON app.treatment_adherence_reports;
CREATE POLICY phase2_adherence_clinical ON app.treatment_adherence_reports
  FOR ALL TO authenticated
  USING (
    cabinet_id = app.current_cabinet()
    AND EXISTS (
      SELECT 1 FROM app.patients p
      WHERE p.id = patient_id AND app.can_see_clinical(p.practitioner_id)
    )
  )
  WITH CHECK (
    cabinet_id = app.current_cabinet()
    AND EXISTS (
      SELECT 1 FROM app.patients p
      WHERE p.id = patient_id AND app.can_see_clinical(p.practitioner_id)
    )
  );

DROP POLICY IF EXISTS phase2_interaction_clinical ON app.treatment_interaction_reviews;
CREATE POLICY phase2_interaction_clinical ON app.treatment_interaction_reviews
  FOR ALL TO authenticated
  USING (
    cabinet_id = app.current_cabinet()
    AND EXISTS (
      SELECT 1 FROM app.patients p
      WHERE p.id = patient_id AND app.can_see_clinical(p.practitioner_id)
    )
  )
  WITH CHECK (
    cabinet_id = app.current_cabinet()
    AND EXISTS (
      SELECT 1 FROM app.patients p
      WHERE p.id = patient_id AND app.can_see_clinical(p.practitioner_id)
    )
  );

DROP POLICY IF EXISTS phase2_interaction_items_clinical ON app.interaction_review_treatments;
CREATE POLICY phase2_interaction_items_clinical ON app.interaction_review_treatments
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app.treatment_interaction_reviews r
      WHERE r.id = review_id
        AND r.cabinet_id = app.current_cabinet()
        AND EXISTS (
          SELECT 1 FROM app.patients p
          WHERE p.id = r.patient_id AND app.can_see_clinical(p.practitioner_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app.treatment_interaction_reviews r
      WHERE r.id = review_id
        AND r.cabinet_id = app.current_cabinet()
        AND EXISTS (
          SELECT 1 FROM app.patients p
          WHERE p.id = r.patient_id AND app.can_see_clinical(p.practitioner_id)
        )
    )
  );

DROP POLICY IF EXISTS phase2_renewal_clinical ON app.prescription_renewal_links;
CREATE POLICY phase2_renewal_clinical ON app.prescription_renewal_links
  FOR ALL TO authenticated
  USING (
    cabinet_id = app.current_cabinet()
    AND EXISTS (
      SELECT 1 FROM app.patients p
      WHERE p.id = patient_id AND app.can_see_clinical(p.practitioner_id)
    )
  )
  WITH CHECK (
    cabinet_id = app.current_cabinet()
    AND EXISTS (
      SELECT 1 FROM app.patients p
      WHERE p.id = patient_id AND app.can_see_clinical(p.practitioner_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 10 · Droits nommés
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON app.patient_allergy_events TO authenticated;
GRANT SELECT, INSERT ON app.patient_adverse_events TO authenticated;
GRANT SELECT, INSERT ON app.patient_measurements TO authenticated;
GRANT SELECT, INSERT ON app.treatment_adherence_reports TO authenticated;
GRANT SELECT, INSERT ON app.treatment_interaction_reviews TO authenticated;
GRANT SELECT, INSERT ON app.interaction_review_treatments TO authenticated;
GRANT SELECT, INSERT ON app.prescription_renewal_links TO authenticated;

GRANT SELECT ON app.patient_allergy_events TO app_gatekeeper;
GRANT SELECT ON app.patient_adverse_events TO app_gatekeeper;
GRANT SELECT ON app.patient_measurements TO app_gatekeeper;
GRANT SELECT ON app.treatment_adherence_reports TO app_gatekeeper;
GRANT SELECT ON app.treatment_interaction_reviews TO app_gatekeeper;
GRANT SELECT ON app.interaction_review_treatments TO app_gatekeeper;
GRANT SELECT ON app.prescription_renewal_links TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 11 · Audit et garde synthétique
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patient_allergy_events',
    'patient_adverse_events',
    'patient_measurements',
    'treatment_adherence_reports',
    'treatment_interaction_reviews',
    'prescription_renewal_links'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_audit' AND tgrelid = format('app.%I', t)::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION audit.track()', t
      );
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS assert_synthetic ON app.%I', t);
    EXECUTE format(
      'CREATE TRIGGER assert_synthetic BEFORE INSERT OR UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.assert_synthetic_when_cloud()', t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 12 · Version
-- ---------------------------------------------------------------------------
INSERT INTO app.schema_migrations (version)
VALUES ('212_medication_phase2_schema')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
