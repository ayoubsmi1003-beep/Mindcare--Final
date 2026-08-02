-- 009_diagnoses_scales_medications_prescriptions — §8 de 01-SCHEMA.md.
--
-- ⚠️ Ordonnance MANUSCRITE en Mois 1. Les tables existent quand même dès
-- maintenant : sans elles on perdrait un mois d'historique médicamenteux
-- impossible à reconstituer après coup.

BEGIN;

-- ICD-10 et non DSM-5 : c'est la référence administrative en Algérie.
-- `label` reste libre pour ne pas bloquer la praticienne si le code manque.
CREATE TABLE app.diagnoses (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id       uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id  uuid NOT NULL REFERENCES app.profiles(id),
    patient_id       uuid NOT NULL REFERENCES app.patients(id),
    code_system      text NOT NULL DEFAULT 'ICD-10',
    code             text,
    label            text NOT NULL,
    is_primary       boolean NOT NULL DEFAULT false,
    onset_date       date,
    resolved_at      date,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.diagnoses (patient_id) WHERE resolved_at IS NULL;

-- Référentiel : pas de donnée patient, pas de RLS patient.
CREATE TABLE app.scales (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code       text NOT NULL UNIQUE,   -- 'PHQ9','GAD7','HDRS','YMRS','MMSE'
    name_fr    text NOT NULL,
    name_ar    text,
    items      jsonb NOT NULL,         -- questions + barème
    scoring    jsonb NOT NULL,         -- seuils d'interprétation
    is_active  boolean NOT NULL DEFAULT true
);

CREATE TABLE app.scale_administrations (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id       uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id  uuid NOT NULL REFERENCES app.profiles(id),
    patient_id       uuid NOT NULL REFERENCES app.patients(id),
    consultation_id  uuid REFERENCES app.consultations(id),
    scale_id         uuid NOT NULL REFERENCES app.scales(id),
    responses        jsonb NOT NULL,
    total_score      numeric,
    interpretation   text,
    administered_at  timestamptz NOT NULL DEFAULT now()
);
-- Sert la comparaison séance après séance — le graphique d'évolution.
CREATE INDEX ON app.scale_administrations (patient_id, scale_id, administered_at DESC);

-- `cabinet_id` NULL = référentiel commun ; renseigné = extension du cabinet.
CREATE TABLE app.medications (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id        uuid REFERENCES app.cabinets(id),
    inn               text NOT NULL,      -- dénomination commune (molécule)
    brand_name        text,
    atc_class         text,
    form              text,               -- comprimé, gouttes, injectable
    strength          text,               -- '50 mg'
    default_posology  text,
    notes             text,
    source            text NOT NULL DEFAULT 'manual',   -- manual | vidal (ADR-012)
    is_active         boolean NOT NULL DEFAULT true
);
CREATE INDEX meds_search ON app.medications
    USING gin ((app.immutable_unaccent(lower(coalesce(brand_name,'') || ' ' || inn))) gin_trgm_ops);

CREATE TABLE app.prescriptions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id       uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id  uuid NOT NULL REFERENCES app.profiles(id),
    patient_id       uuid NOT NULL REFERENCES app.patients(id),
    consultation_id  uuid REFERENCES app.consultations(id),
    prescribed_at    timestamptz NOT NULL DEFAULT now(),
    is_handwritten   boolean NOT NULL DEFAULT true,    -- Mois 1
    notes            text
);

CREATE TABLE app.prescription_lines (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id    uuid NOT NULL REFERENCES app.prescriptions(id) ON DELETE CASCADE,
    medication_id      uuid REFERENCES app.medications(id),
    free_text          text,             -- si absente du référentiel
    dose               text,
    frequency_per_day  integer,
    timing             jsonb,            -- ['matin','soir']
    duration_days      integer,
    instructions       text,
    position           integer NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- RLS — même modèle clinique, aucune policy assistant
-- ---------------------------------------------------------------------------

ALTER TABLE app.diagnoses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.diagnoses              FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.scale_administrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.scale_administrations  FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.prescriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.prescriptions          FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.prescription_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.prescription_lines     FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.scales                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.scales                 FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.medications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.medications            FORCE  ROW LEVEL SECURITY;

CREATE POLICY diagnoses_clinical ON app.diagnoses
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id));

CREATE POLICY scale_admin_clinical ON app.scale_administrations
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id));

CREATE POLICY prescriptions_clinical ON app.prescriptions
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id));

CREATE POLICY prescription_lines_clinical ON app.prescription_lines
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM app.prescriptions p
                   WHERE p.id = prescription_id
                     AND p.cabinet_id = app.current_cabinet()
                     AND app.can_see_clinical(p.practitioner_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM app.prescriptions p
                   WHERE p.id = prescription_id
                     AND p.cabinet_id = app.current_cabinet()
                     AND app.can_see_clinical(p.practitioner_id)));

-- Référentiels : lisibles par tout le cabinet, ils ne portent aucune donnée
-- patient. RLS armée quand même — une table sans RLS fait rougir le checkpoint,
-- et c'est délibéré : l'exception se justifie, elle ne se présume pas.
CREATE POLICY scales_read ON app.scales FOR SELECT TO authenticated USING (true);
CREATE POLICY medications_read ON app.medications FOR SELECT TO authenticated
    USING (cabinet_id IS NULL OR cabinet_id = app.current_cabinet());

INSERT INTO app.schema_migrations (version) VALUES ('009_diagnoses_scales_medications_prescriptions')
    ON CONFLICT DO NOTHING;

COMMIT;
