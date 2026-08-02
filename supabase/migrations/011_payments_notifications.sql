-- 011_payments_notifications — §10 de 01-SCHEMA.md, AMENDÉ PAR ADR-018.
-- ADR-005 : cloison des revenus. La Dr. #2 ne voit JAMAIS le chiffre d'affaires
-- des autres, et l'assistante ne voit pas celui du cabinet.

BEGIN;

CREATE TABLE app.payments (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id       uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id  uuid NOT NULL REFERENCES app.profiles(id),
    patient_id       uuid NOT NULL REFERENCES app.patients(id),
    consultation_id  uuid REFERENCES app.consultations(id),
    receipt_number   text NOT NULL,
    -- ADR-018 : dinars ENTIERS. Espèces uniquement, aucune facture légale
    -- (ADR-010) : il n'y a pas de centimes à stocker.
    amount_dzd       integer NOT NULL CHECK (amount_dzd >= 0),
    method           app.payment_method NOT NULL DEFAULT 'cash',
    set_by           uuid NOT NULL REFERENCES app.profiles(id),
    collected_by     uuid REFERENCES app.profiles(id),
    collected_at     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cabinet_id, receipt_number)
);
CREATE INDEX ON app.payments (practitioner_id, created_at DESC);

ALTER TABLE app.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payments FORCE  ROW LEVEL SECURITY;

CREATE POLICY pay_owner ON app.payments FOR ALL TO authenticated
    USING (cabinet_id = app.current_cabinet() AND app.current_role() = 'owner');

CREATE POLICY pay_practitioner ON app.payments FOR ALL TO authenticated
    USING (cabinet_id = app.current_cabinet()
           AND app.current_role() = 'practitioner'
           AND practitioner_id = auth.uid());

-- La fenêtre 24 h donne à l'assistante les encaissements du jour, sans lui
-- ouvrir le chiffre d'affaires du cabinet.
--
-- ⚠️ CONSTAT, NON CORRIGÉ ICI : le §10.1 ne lui accorde que SELECT. Elle ne
-- peut donc pas renseigner `collected_by`/`collected_at` — l'encaissement reste
-- une écriture du praticien. C'est peut-être voulu, peut-être un oubli du
-- document. Élargir une permission de ma propre initiative serait exactement le
-- genre de décision qui ne m'appartient pas : signalé, pas comblé.
CREATE POLICY pay_assistant ON app.payments FOR SELECT TO authenticated
    USING (cabinet_id = app.current_cabinet()
           AND app.current_role() = 'assistant'
           AND created_at > now() - interval '24 hours');

-- `payload` ne contient JAMAIS de donnée clinique (I5). Diffusion par Realtime :
-- le médecin saisit le prix, le poste assistante est notifié instantanément.
CREATE TABLE app.notifications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id      uuid NOT NULL REFERENCES app.cabinets(id),
    recipient_role  app.user_role,
    recipient_id    uuid REFERENCES app.profiles(id),
    kind            text NOT NULL,   -- 'payment_due','patient_arrived','pending_intake'
    payload         jsonb NOT NULL,
    read_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.notifications (recipient_role, read_at, created_at DESC);

ALTER TABLE app.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notifications FORCE  ROW LEVEL SECURITY;

CREATE POLICY notifications_mine ON app.notifications
    FOR ALL TO authenticated
    USING (cabinet_id = app.current_cabinet()
           AND (recipient_id = auth.uid() OR recipient_role = app.current_role()))
    WITH CHECK (cabinet_id = app.current_cabinet());

INSERT INTO app.schema_migrations (version) VALUES ('011_payments_notifications')
    ON CONFLICT DO NOTHING;

COMMIT;
