-- 010_counters_documents_templates — §9 de 01-SCHEMA.md.
-- I17 / P7 : numérotation SANS TROU par table compteur. JAMAIS de SEQUENCE —
-- une séquence consomme son numéro même en cas de rollback, donc elle crée des
-- trous, et un trou dans une numérotation médico-légale est une suspicion.

BEGIN;

CREATE TABLE app.counters (
    cabinet_id     uuid NOT NULL REFERENCES app.cabinets(id),
    scope          text NOT NULL,     -- 'patient_record','document','payment'
    period         text NOT NULL,     -- '2026' ou 'ALL'
    current_value  bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (cabinet_id, scope, period)
);

-- `ON CONFLICT DO UPDATE` verrouille la ligne : aucun trou même sous forte
-- concurrence. Éprouvé par le test T5 du §15 (100 appels en parallèle).
CREATE OR REPLACE FUNCTION app.next_number(p_cabinet uuid, p_scope text, p_period text)
RETURNS bigint LANGUAGE plpgsql SET search_path = app, pg_catalog AS $$
DECLARE v bigint;
BEGIN
    INSERT INTO app.counters (cabinet_id, scope, period, current_value)
    VALUES (p_cabinet, p_scope, p_period, 1)
    ON CONFLICT (cabinet_id, scope, period)
    DO UPDATE SET current_value = app.counters.current_value + 1
    RETURNING current_value INTO v;
    RETURN v;
END $$;

-- `rendered_html` est figé à l'impression. Si le modèle change en 2027, le
-- document de 2026 reste RIGOUREUSEMENT ce qui a été remis au patient.
-- Exigence médico-légale : ne jamais le régénérer à la volée.
CREATE TABLE app.documents (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id       uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id  uuid NOT NULL REFERENCES app.profiles(id),
    patient_id       uuid NOT NULL REFERENCES app.patients(id),
    consultation_id  uuid REFERENCES app.consultations(id),
    doc_type         app.doc_type NOT NULL,
    doc_number       text NOT NULL,
    variables        jsonb NOT NULL,   -- {jours:30, mairie:'Alger-Centre', ...}
    rendered_html    text NOT NULL,
    issued_at        timestamptz NOT NULL DEFAULT now(),
    printed_count    integer NOT NULL DEFAULT 0,
    UNIQUE (cabinet_id, doc_number)
);

CREATE TABLE app.document_templates (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id   uuid NOT NULL REFERENCES app.cabinets(id),
    doc_type     app.doc_type NOT NULL,
    version      integer NOT NULL DEFAULT 1,
    title_fr     text NOT NULL,
    header_html  text NOT NULL,
    body_html    text NOT NULL,       -- {{patient.first_name}}, {{vars.jours}}
    footer_html  text,
    is_active    boolean NOT NULL DEFAULT true,
    UNIQUE (cabinet_id, doc_type, version)
);

ALTER TABLE app.counters           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.counters           FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.documents          FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.document_templates FORCE  ROW LEVEL SECURITY;

-- Le compteur se manipule par `next_number` (SECURITY INVOKER), pas à la main.
CREATE POLICY counters_cabinet ON app.counters
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet())
    WITH CHECK (cabinet_id = app.current_cabinet());

-- Un document EST une pièce clinique : cloison praticien, pas d'assistante.
CREATE POLICY documents_clinical ON app.documents
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id));

CREATE POLICY templates_read ON app.document_templates
    FOR SELECT TO authenticated
    USING (cabinet_id = app.current_cabinet());

INSERT INTO app.schema_migrations (version) VALUES ('010_counters_documents_templates')
    ON CONFLICT DO NOTHING;

COMMIT;
