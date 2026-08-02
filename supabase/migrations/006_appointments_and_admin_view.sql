-- 006_appointments_and_admin_view — §5 de 01-SCHEMA.md, AMENDÉ PAR ADR-017.
--
-- ⚠️ ÉCART ASSUMÉ AVEC LE §5.1, qui est périmé. Le §5.1 protégeait `reason` par
-- une VUE plus une règle de revue de code. Ça ne protège rien : la policy
-- `appt_assistant` accorde FOR ALL sur la table, donc l'assistante lit le motif
-- en interrogeant `app.appointments` au lieu de `app.appointments_admin`.
-- La RLS filtre des LIGNES, pas des colonnes — la seule façon de rendre une
-- donnée invisible par RLS est de lui donner sa propre ligne.
--
-- → `reason` vit dans `app.appointment_reasons`, SANS policy assistant, au même
--   titre que les notes cliniques. La vue reste, mais ne porte plus aucune
--   responsabilité de sécurité.

BEGIN;

CREATE TABLE app.appointments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id     uuid NOT NULL REFERENCES app.profiles(id),
    patient_id          uuid REFERENCES app.patients(id),   -- NULL si demande web non validée
    pending_patient_id  uuid REFERENCES app.pending_patients(id),
    starts_at           timestamptz NOT NULL,
    ends_at             timestamptz NOT NULL,
    status              app.appt_status NOT NULL DEFAULT 'requested',
    source              app.appt_source NOT NULL DEFAULT 'assistant',
    -- `reason` : VOLONTAIREMENT ABSENT. Voir app.appointment_reasons (ADR-017).
    notes_admin         text,               -- visible assistante
    arrived_at          timestamptz,
    created_by          uuid REFERENCES app.profiles(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT appt_time_valid   CHECK (ends_at > starts_at),
    CONSTRAINT appt_has_subject  CHECK (patient_id IS NOT NULL OR pending_patient_id IS NOT NULL)
);
CREATE INDEX ON app.appointments (practitioner_id, starts_at);
CREATE INDEX ON app.appointments (cabinet_id, starts_at) WHERE status <> 'cancelled';

-- Anti double-réservation
CREATE UNIQUE INDEX appt_no_overlap ON app.appointments (practitioner_id, starts_at)
    WHERE status IN ('confirmed','arrived','in_session');

ALTER TABLE app.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.appointments FORCE  ROW LEVEL SECURITY;

CREATE POLICY appt_clinical ON app.appointments
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id));

-- L'assistante gère l'agenda de tous les praticiens. Sans le motif : il n'est
-- plus dans cette table.
CREATE POLICY appt_assistant ON app.appointments
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet() AND app.current_role() = 'assistant')
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.current_role() = 'assistant');

-- ---------------------------------------------------------------------------
-- Le motif — ADR-017
-- ---------------------------------------------------------------------------
-- 1-1 avec le RDV. AUCUNE policy assistant : pas de policy = pas de ligne
-- visible, y compris en SQL brut via PostgREST. C'est le mécanisme, pas une
-- convention de code.

CREATE TABLE app.appointment_reasons (
    appointment_id  uuid PRIMARY KEY REFERENCES app.appointments(id) ON DELETE CASCADE,
    reason          text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.appointment_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.appointment_reasons FORCE  ROW LEVEL SECURITY;

-- Une seule policy, et elle passe par le RDV parent pour retrouver le
-- praticien : `can_see_clinical` renvoie false pour l'assistante, toujours.
CREATE POLICY appt_reason_clinical ON app.appointment_reasons
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM app.appointments a
                   WHERE a.id = appointment_id
                     AND a.cabinet_id = app.current_cabinet()
                     AND app.can_see_clinical(a.practitioner_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM app.appointments a
                   WHERE a.id = appointment_id
                     AND a.cabinet_id = app.current_cabinet()
                     AND app.can_see_clinical(a.practitioner_id)));

-- ---------------------------------------------------------------------------
-- Vue administrative — confort de lecture, PAS un garde-fou
-- ---------------------------------------------------------------------------
-- Conservée parce que le front assistante s'en sert, mais elle ne protège plus
-- rien : `reason` n'est plus dans `app.appointments`. Ne pas réintroduire l'idée
-- qu'interroger la vue « est » la sécurité — c'était l'erreur du §5.1.
CREATE VIEW app.appointments_admin WITH (security_invoker = true) AS
SELECT id, cabinet_id, practitioner_id, patient_id, pending_patient_id,
       starts_at, ends_at, status, source, notes_admin, arrived_at, created_at
FROM app.appointments;

INSERT INTO app.schema_migrations (version) VALUES ('006_appointments_and_admin_view')
    ON CONFLICT DO NOTHING;

COMMIT;
