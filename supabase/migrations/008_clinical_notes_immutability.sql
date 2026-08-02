-- 008_clinical_notes_immutability — §7 de 01-SCHEMA.md (ADR-004, I15).
--
-- ⚖️ C'est ici que se joue la valeur juridique du dossier. Le verrou est EN
-- BASE : même un bug applicatif, même un accès SQL direct ne peut réécrire une
-- note signée. Aucun bypass, aucun override admin, jamais — ne pas en ajouter.

BEGIN;

CREATE TABLE app.clinical_notes (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id       uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id  uuid NOT NULL REFERENCES app.profiles(id),
    patient_id       uuid NOT NULL REFERENCES app.patients(id),
    consultation_id  uuid REFERENCES app.consultations(id),
    status           app.note_status NOT NULL DEFAULT 'draft',
    subjective       text,     -- S
    objective        text,     -- O
    assessment       text,     -- A
    plan             text,     -- P
    structured       jsonb,    -- {humeur, sommeil, appetit, ideation, observance...}
    ai_draft         boolean NOT NULL DEFAULT false,
    signed_at        timestamptz,
    signed_by        uuid REFERENCES app.profiles(id),
    lock_after       timestamptz,   -- signed_at + 15 min : fenêtre de brouillon
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.clinical_notes (patient_id, created_at DESC);

-- Une correction est un AMENDEMENT VISIBLE, jamais un écrasement.
CREATE TABLE app.clinical_note_amendments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id     uuid NOT NULL REFERENCES app.clinical_notes(id),
    author_id   uuid NOT NULL REFERENCES app.profiles(id),
    reason      text NOT NULL,
    body        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.clinical_note_amendments (note_id, created_at);

-- ---------------------------------------------------------------------------
-- Le verrou
-- ---------------------------------------------------------------------------
-- L'ORDRE DE DÉCLENCHEMENT EST ALPHABÉTIQUE en Postgres : `trg_note_immutable`
-- s'exécute avant `trg_note_sign`. C'est le bon ordre — le contrôle
-- d'immuabilité doit voir l'état AVANT que la signature ne le modifie. Ne pas
-- renommer ces triggers sans revérifier ce point.

CREATE OR REPLACE FUNCTION app.enforce_note_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = app, pg_catalog AS $$
BEGIN
    IF OLD.status = 'signed' AND now() > OLD.lock_after THEN
        RAISE EXCEPTION 'Note % verrouillée depuis %. Utilisez un amendement.',
            OLD.id, OLD.lock_after
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'draft' AND OLD.status = 'signed' THEN
        RAISE EXCEPTION 'Une note signée ne peut pas repasser en brouillon.';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER trg_note_immutable
    BEFORE UPDATE ON app.clinical_notes
    FOR EACH ROW EXECUTE FUNCTION app.enforce_note_immutability();

CREATE OR REPLACE FUNCTION app.set_lock_window()
RETURNS trigger LANGUAGE plpgsql SET search_path = app, pg_catalog AS $$
BEGIN
    IF NEW.status = 'signed' AND OLD.status = 'draft' THEN
        NEW.signed_at  := now();
        NEW.signed_by  := auth.uid();
        NEW.lock_after := now() + interval '15 minutes';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_note_sign
    BEFORE UPDATE ON app.clinical_notes
    FOR EACH ROW EXECUTE FUNCTION app.set_lock_window();

-- Aucune suppression. Jamais. (`delete_clinical_note` est un outil INTERDIT.)
CREATE RULE no_delete_notes AS ON DELETE TO app.clinical_notes DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- RLS — cloison totale. Aucune policy assistant : table inexistante pour elle.
-- ---------------------------------------------------------------------------

ALTER TABLE app.clinical_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.clinical_notes FORCE  ROW LEVEL SECURITY;

CREATE POLICY notes_clinical ON app.clinical_notes
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id));

ALTER TABLE app.clinical_note_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.clinical_note_amendments FORCE  ROW LEVEL SECURITY;

CREATE POLICY amendments_clinical ON app.clinical_note_amendments
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM app.clinical_notes n
                   WHERE n.id = note_id
                     AND n.cabinet_id = app.current_cabinet()
                     AND app.can_see_clinical(n.practitioner_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM app.clinical_notes n
                   WHERE n.id = note_id
                     AND n.cabinet_id = app.current_cabinet()
                     AND app.can_see_clinical(n.practitioner_id)));

INSERT INTO app.schema_migrations (version) VALUES ('008_clinical_notes_immutability')
    ON CONFLICT DO NOTHING;

COMMIT;
