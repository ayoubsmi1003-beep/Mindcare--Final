-- 007_consultations_transcripts_insights — §6 de 01-SCHEMA.md.
-- Ces trois tables n'ont AUCUNE policy assistant : elles lui sont invisibles,
-- même en SQL brut. C'est la cloison, pas un masquage d'interface.

BEGIN;

CREATE TABLE app.consultations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id        uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id   uuid NOT NULL REFERENCES app.profiles(id),
    patient_id        uuid NOT NULL REFERENCES app.patients(id),
    appointment_id    uuid REFERENCES app.appointments(id),
    started_at        timestamptz NOT NULL DEFAULT now(),
    ended_at          timestamptz,
    duration_seconds  integer GENERATED ALWAYS AS
                      (EXTRACT(EPOCH FROM (ended_at - started_at))::integer) STORED,
    status            app.consult_status NOT NULL DEFAULT 'open',
    -- ADR-002 : SEUL jeton transmis à Groq. Jamais l'ID patient, jamais un nom.
    -- Aucune corrélation possible côté fournisseur.
    session_token     uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.consultations (patient_id, started_at DESC);
CREATE UNIQUE INDEX one_open_consult ON app.consultations (practitioner_id)
    WHERE status = 'open';

-- AUCUNE colonne audio. AUCUN chemin de fichier. ADR-009 / I14 : l'audio vit en
-- RAM, part à Groq, revient en texte, et est libéré. Il n'existe jamais sur disque.
CREATE TABLE app.transcript_segments (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id  uuid NOT NULL REFERENCES app.consultations(id) ON DELETE CASCADE,
    seq              integer NOT NULL,
    speaker          text,               -- 'patient' | 'praticien' | NULL
    offset_ms        integer NOT NULL,
    text_ar          text NOT NULL,      -- ADR-008 : sortie en arabe
    text_fr          text,               -- traduction à la demande
    confidence       real,
    is_edited        boolean NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (consultation_id, seq)
);
CREATE INDEX ON app.transcript_segments (consultation_id, seq);

-- ⚕️ SUGGESTIONS, jamais des conclusions (I7). N'entrent au dossier que si la
-- praticienne les reprend explicitement dans sa note.
CREATE TABLE app.live_insights (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id  uuid NOT NULL REFERENCES app.consultations(id) ON DELETE CASCADE,
    emitted_at       timestamptz NOT NULL DEFAULT now(),
    kind             text NOT NULL,   -- suggested_question|risk_flag|theme|dsm_hint|summary_delta
    payload          jsonb NOT NULL,
    model            text,
    was_useful       boolean
);
CREATE INDEX ON app.live_insights (consultation_id, emitted_at DESC);

ALTER TABLE app.consultations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.consultations       FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.transcript_segments FORCE  ROW LEVEL SECURITY;
ALTER TABLE app.live_insights       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.live_insights       FORCE  ROW LEVEL SECURITY;

CREATE POLICY consultations_clinical ON app.consultations
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id));

CREATE POLICY transcripts_clinical ON app.transcript_segments
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM app.consultations c
                   WHERE c.id = consultation_id
                     AND c.cabinet_id = app.current_cabinet()
                     AND app.can_see_clinical(c.practitioner_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM app.consultations c
                   WHERE c.id = consultation_id
                     AND c.cabinet_id = app.current_cabinet()
                     AND app.can_see_clinical(c.practitioner_id)));

CREATE POLICY insights_clinical ON app.live_insights
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM app.consultations c
                   WHERE c.id = consultation_id
                     AND c.cabinet_id = app.current_cabinet()
                     AND app.can_see_clinical(c.practitioner_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM app.consultations c
                   WHERE c.id = consultation_id
                     AND c.cabinet_id = app.current_cabinet()
                     AND app.can_see_clinical(c.practitioner_id)));

INSERT INTO app.schema_migrations (version) VALUES ('007_consultations_transcripts_insights')
    ON CONFLICT DO NOTHING;

COMMIT;
