-- 004_patients_and_rls — §3 de 01-SCHEMA.md.
-- L'assistante voit la LIGNE patient entière : c'est voulu, elle a besoin de
-- l'identité. Ce qu'elle ne voit jamais : consultations, notes, transcriptions,
-- diagnostics, échelles, motif. Ces tables n'ont AUCUNE policy assistant.

BEGIN;

CREATE TABLE app.patients (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id     uuid NOT NULL REFERENCES app.profiles(id),   -- ADR-003, cloison
    record_number       text NOT NULL,                               -- sans trou, §9
    first_name          text NOT NULL,
    last_name           text NOT NULL,
    birth_date          date,
    sex                 app.sex,
    phone               text NOT NULL,
    phone_alt           text,
    address             text,
    id_document_number  text,
    id_document_issuer  text,
    emergency_contact   jsonb,        -- {name, relation, phone}
    notes_admin         text,         -- non clinique : « préfère le matin »
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid REFERENCES app.profiles(id),

    CONSTRAINT patients_record_unique UNIQUE (cabinet_id, record_number),
    CONSTRAINT patients_phone_format  CHECK (phone ~ '^[0-9+ ]{8,20}$')
);

CREATE INDEX ON app.patients (practitioner_id) WHERE is_active;
CREATE INDEX ON app.patients (phone);

-- `phone` n'est PAS unique : deux enfants d'une même mère partagent son numéro.
-- L'unicité métier porte sur (practitioner_id, phone, birth_date) et reste en
-- logique applicative — délibérément pas une contrainte.
CREATE INDEX patients_name_trgm ON app.patients
    USING gin ((app.immutable_unaccent(lower(first_name || ' ' || last_name))) gin_trgm_ops);

ALTER TABLE app.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.patients FORCE  ROW LEVEL SECURITY;

-- owner + praticien propriétaire : accès complet
CREATE POLICY patients_clinical ON app.patients
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id));

-- assistante : identité, tous praticiens
CREATE POLICY patients_assistant_read ON app.patients
    FOR SELECT TO authenticated
    USING (cabinet_id = app.current_cabinet() AND app.current_role() = 'assistant');

CREATE POLICY patients_assistant_write ON app.patients
    FOR INSERT TO authenticated
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.current_role() = 'assistant');

CREATE POLICY patients_assistant_update ON app.patients
    FOR UPDATE TO authenticated
    USING      (cabinet_id = app.current_cabinet() AND app.current_role() = 'assistant')
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.current_role() = 'assistant');

INSERT INTO app.schema_migrations (version) VALUES ('004_patients_and_rls')
    ON CONFLICT DO NOTHING;

COMMIT;
