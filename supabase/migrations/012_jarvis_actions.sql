-- 012_jarvis_actions — §11 de 01-SCHEMA.md (R4, I16).
-- Propose → Confirme → Exécute → Journalise. La contrainte ci-dessous fait de
-- la boucle un FAIT DE LA BASE, pas une convention applicative : elle ne peut
-- pas être oubliée, contournée par un bug, ni « désactivée juste cette fois ».

BEGIN;

CREATE TABLE app.jarvis_actions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id       uuid NOT NULL REFERENCES app.cabinets(id),
    actor_id         uuid NOT NULL REFERENCES app.profiles(id),
    conversation_id  uuid NOT NULL,
    user_utterance   text NOT NULL,
    tool_name        text NOT NULL,
    tool_args        jsonb NOT NULL,
    state            app.jarvis_state NOT NULL DEFAULT 'proposed',
    proposed_at      timestamptz NOT NULL DEFAULT now(),
    confirmed_at     timestamptz,
    executed_at      timestamptz,
    result           jsonb,
    error            text,
    affected_table   text,
    affected_id      uuid
);
CREATE INDEX ON app.jarvis_actions (actor_id, proposed_at DESC);

-- I16 : `state='executed'` sans `confirmed_at` est une violation de contrainte,
-- PAR CONCEPTION. Ne jamais ajouter d'échappatoire.
ALTER TABLE app.jarvis_actions ADD CONSTRAINT jarvis_must_confirm
    CHECK (state <> 'executed' OR confirmed_at IS NOT NULL);

ALTER TABLE app.jarvis_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.jarvis_actions FORCE  ROW LEVEL SECURITY;

-- Chacun ne voit que ses propres échanges avec Jarvis : une conversation peut
-- citer un patient, donc elle suit la cloison.
CREATE POLICY jarvis_own ON app.jarvis_actions
    FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet() AND actor_id = auth.uid())
    WITH CHECK (cabinet_id = app.current_cabinet() AND actor_id = auth.uid());

INSERT INTO app.schema_migrations (version) VALUES ('012_jarvis_actions')
    ON CONFLICT DO NOTHING;

COMMIT;
