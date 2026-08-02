-- 005_pending_patients_and_intake — §4 de 01-SCHEMA.md.
-- Zone tampon : une soumission QR n'est PAS un dossier patient tant qu'un
-- humain ne l'a pas validée.

BEGIN;

CREATE TABLE app.pending_patients (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    submitted_phone     text NOT NULL,
    first_name          text,
    last_name           text,
    birth_date          date,
    sex                 app.sex,
    language            app.intake_lang NOT NULL DEFAULT 'fr',
    answers             jsonb NOT NULL DEFAULT '{}'::jsonb,
    ai_summary          text,       -- pré-analyse Jarvis, pseudonymisée à l'aller (R2)
    ai_flags            jsonb,      -- {urgence:false, themes:[...]}
    matched_patient_id  uuid REFERENCES app.patients(id),
    status              app.pending_status NOT NULL DEFAULT 'awaiting',
    reviewed_by         uuid REFERENCES app.profiles(id),
    reviewed_at         timestamptz,
    reject_reason       text,
    client_fingerprint  text,       -- anti-abus (ADR-006)
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- purge à 7 jours des soumissions non validées : protège le disque (RSK-1)
    expires_at          timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE INDEX ON app.pending_patients (cabinet_id, status, created_at DESC);
CREATE INDEX ON app.pending_patients (submitted_phone);

ALTER TABLE app.pending_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.pending_patients FORCE  ROW LEVEL SECURITY;

-- Accueil : l'assistante traite la file, le praticien la voit aussi.
CREATE POLICY pending_admin ON app.pending_patients
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet() AND app.can_see_admin())
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.can_see_admin());

-- ---------------------------------------------------------------------------
-- Questionnaire d'accueil
-- ---------------------------------------------------------------------------

CREATE TABLE app.intake_forms (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id  uuid NOT NULL REFERENCES app.cabinets(id),
    code        text NOT NULL,
    version     integer NOT NULL DEFAULT 1,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cabinet_id, code, version)
);

-- 🔴 RÈGLE CLINIQUE, imposée par la praticienne : aucune question ni option ne
-- doit SUGGÉRER UN EFFET SECONDAIRE — ça biaise l'auto-déclaration (I18).
-- Aucune contrainte SQL ne peut le vérifier : revue HUMAINE obligatoire de
-- chaque question ajoutée. Le dire ici plutôt que de laisser croire au contraire.
CREATE TABLE app.intake_questions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id        uuid NOT NULL REFERENCES app.intake_forms(id) ON DELETE CASCADE,
    position       integer NOT NULL,
    code           text NOT NULL,
    response_type  text NOT NULL,   -- text|number|single|multi|scale|boolean|date
    options        jsonb,           -- [{value, label_fr, label_ar, label_dz}]
    is_required    boolean NOT NULL DEFAULT false,
    label_fr       text NOT NULL,
    label_ar       text,
    label_dz       text,
    show_if        jsonb,
    UNIQUE (form_id, position)
);

ALTER TABLE app.intake_forms     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.intake_forms     FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.intake_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.intake_questions FORCE  ROW LEVEL SECURITY;

CREATE POLICY intake_forms_read ON app.intake_forms FOR SELECT TO authenticated
    USING (cabinet_id = app.current_cabinet());

CREATE POLICY intake_questions_read ON app.intake_questions FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM app.intake_forms f
                   WHERE f.id = form_id AND f.cabinet_id = app.current_cabinet()));

INSERT INTO app.schema_migrations (version) VALUES ('005_pending_patients_and_intake')
    ON CONFLICT DO NOTHING;

COMMIT;
