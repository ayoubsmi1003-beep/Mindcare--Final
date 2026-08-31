-- 074_patient_treatments_state — ADR-028 domaine traitements (état courant + historique).
--
-- patient_treatments = état mutable via portes seules (current state).
-- patient_treatment_history = append-only immuable (preuve).
-- Ne touche PAS à prescriptions. Ne crée PAS d'ordonnance. RLS clinique stricte.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Types (idempotents)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE app.treatment_status AS ENUM ('active','paused','stopped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE app.treatment_action AS ENUM ('started','dose_changed','schedule_changed','paused','resumed','stopped','renewed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE app.stopped_reason AS ENUM ('inefficacite','effets_indesirables','amelioration','decision_clinique','autre');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2 · Table état courant
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.patient_treatments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id            uuid NOT NULL REFERENCES app.cabinets(id),
  practitioner_id       uuid NOT NULL REFERENCES app.profiles(id),
  patient_id            uuid NOT NULL REFERENCES app.patients(id) ON DELETE RESTRICT,
  medication_id         uuid NOT NULL REFERENCES app.medications(id),
  consultation_id       uuid REFERENCES app.consultations(id) ON DELETE SET NULL,
  previous_treatment_id uuid REFERENCES app.patient_treatments(id) ON DELETE SET NULL,
  status                app.treatment_status NOT NULL DEFAULT 'active',
  dose                  text,
  dose_unit             text,
  frequency             text,
  timing                jsonb NOT NULL DEFAULT '[]'::jsonb,
  instructions          text,
  start_date            date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Algiers')::date,
  end_date              date,
  stopped_at            timestamptz,
  stopped_reason        app.stopped_reason,
  current_version       integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  is_synthetic          boolean NOT NULL DEFAULT false,
  CONSTRAINT chk_treatment_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT chk_stopped_coherent CHECK (
    (status = 'stopped' AND stopped_at IS NOT NULL) OR (status <> 'stopped' AND stopped_at IS NULL)
  ),
  CONSTRAINT chk_stopped_reason CHECK (
    (stopped_reason IS NULL) OR (status = 'stopped')
  )
);

COMMENT ON TABLE app.patient_treatments IS 'ADR-028 état courant traitement — mutable uniquement via portes, versionné.';
COMMENT ON COLUMN app.patient_treatments.status IS 'active|paused|stopped — Décision 2 mission (pas de planned).';
COMMENT ON COLUMN app.patient_treatments.timing IS 'JSONB array ex: ["matin","soir"]';

CREATE INDEX IF NOT EXISTS patient_treatments_patient_status ON app.patient_treatments (patient_id, status);
CREATE INDEX IF NOT EXISTS patient_treatments_patient_start ON app.patient_treatments (patient_id, start_date DESC);
CREATE INDEX IF NOT EXISTS patient_treatments_medication ON app.patient_treatments (medication_id);
CREATE INDEX IF NOT EXISTS patient_treatments_cabinet ON app.patient_treatments (cabinet_id);
CREATE INDEX IF NOT EXISTS patient_treatments_practitioner ON app.patient_treatments (practitioner_id);
CREATE INDEX IF NOT EXISTS patient_treatments_consultation ON app.patient_treatments (consultation_id) WHERE consultation_id IS NOT NULL;

-- updated_at
CREATE OR REPLACE FUNCTION app.touch_patient_treatment_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_touch_treatment ON app.patient_treatments;
CREATE TRIGGER trg_touch_treatment BEFORE UPDATE ON app.patient_treatments
  FOR EACH ROW EXECUTE FUNCTION app.touch_patient_treatment_updated_at();

-- ---------------------------------------------------------------------------
-- 3 · Table historique append-only
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.patient_treatment_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id     uuid NOT NULL REFERENCES app.patient_treatments(id) ON DELETE CASCADE,
  version          integer NOT NULL CHECK (version >= 1),
  action           app.treatment_action NOT NULL,
  previous_values  jsonb,
  new_values       jsonb,
  actor_id         uuid NOT NULL REFERENCES app.profiles(id),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  consultation_id  uuid REFERENCES app.consultations(id) ON DELETE SET NULL,
  reason           text,
  notes            text,
  is_synthetic     boolean NOT NULL DEFAULT false,
  UNIQUE (treatment_id, version)
);

COMMENT ON TABLE app.patient_treatment_history IS 'ADR-028 historique append-only — une ligne par mutation, version strictement croissante.';

CREATE INDEX IF NOT EXISTS history_treatment_version ON app.patient_treatment_history (treatment_id, version DESC);
CREATE INDEX IF NOT EXISTS history_occurred ON app.patient_treatment_history (occurred_at DESC);
CREATE INDEX IF NOT EXISTS history_treatment_occurred ON app.patient_treatment_history (treatment_id, occurred_at DESC);

-- Immutabilité : aucun UPDATE/DELETE hors insertion par porte
CREATE OR REPLACE FUNCTION app.forbid_treatment_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'patient_treatment_history est append-only : % refusé', TG_OP USING ERRCODE='check_violation';
END; $$;
DROP TRIGGER IF EXISTS forbid_history_update ON app.patient_treatment_history;
CREATE TRIGGER forbid_history_update BEFORE UPDATE OR DELETE ON app.patient_treatment_history
  FOR EACH ROW EXECUTE FUNCTION app.forbid_treatment_history_mutation();

-- ---------------------------------------------------------------------------
-- 4 · RLS — clinique stricte, aucune policy assistant
-- ---------------------------------------------------------------------------
ALTER TABLE app.patient_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.patient_treatments FORCE ROW LEVEL SECURITY;
ALTER TABLE app.patient_treatment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.patient_treatment_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS treatments_clinical ON app.patient_treatments;
CREATE POLICY treatments_clinical ON app.patient_treatments
  FOR ALL TO authenticated
  USING (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id))
  WITH CHECK (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id));

DROP POLICY IF EXISTS history_clinical ON app.patient_treatment_history;
CREATE POLICY history_clinical ON app.patient_treatment_history
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM app.patient_treatments t
            WHERE t.id = treatment_id
              AND t.cabinet_id = app.current_cabinet()
              AND app.can_see_clinical(t.practitioner_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.patient_treatments t
            WHERE t.id = treatment_id
              AND t.cabinet_id = app.current_cabinet()
              AND app.can_see_clinical(t.practitioner_id))
  );

-- Grants : authenticated a deja les privilèges par defaut 001, mais on nomme
-- les SELECT pour app_gatekeeper (lectures DEFINDER).
GRANT SELECT, INSERT, UPDATE, DELETE ON app.patient_treatments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.patient_treatment_history TO authenticated;
GRANT SELECT ON app.patient_treatments TO app_gatekeeper;
GRANT SELECT ON app.patient_treatment_history TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 5 · Audit — étendre la boucle 013 à ces tables
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_audit' AND tgrelid='app.patient_treatments'::regclass) THEN
    CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.patient_treatments
      FOR EACH ROW EXECUTE FUNCTION audit.track();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_audit' AND tgrelid='app.patient_treatment_history'::regclass) THEN
    CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.patient_treatment_history
      FOR EACH ROW EXECUTE FUNCTION audit.track();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6 · Garde synthétique cloud-dev (ADR-016) — attachement manuel car tables post-016
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  -- patient_treatments
  EXECUTE 'DROP TRIGGER IF EXISTS assert_synthetic ON app.patient_treatments';
  EXECUTE 'CREATE TRIGGER assert_synthetic BEFORE INSERT OR UPDATE ON app.patient_treatments FOR EACH ROW EXECUTE FUNCTION app.assert_synthetic_when_cloud()';
  -- history (pas de patient_id direct mais clinique)
  EXECUTE 'DROP TRIGGER IF EXISTS assert_synthetic ON app.patient_treatment_history';
  EXECUTE 'CREATE TRIGGER assert_synthetic BEFORE INSERT OR UPDATE ON app.patient_treatment_history FOR EACH ROW EXECUTE FUNCTION app.assert_synthetic_when_cloud()';
END $$;

INSERT INTO app.schema_migrations (version) VALUES ('074_patient_treatments_state')
  ON CONFLICT DO NOTHING;

COMMIT;
