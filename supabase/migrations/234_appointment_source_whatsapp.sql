-- 234_appointment_source_whatsapp — `whatsapp` joins app.appt_source.
--
-- Owner approval (règle 9): 2026-11-26, recorded in docs/integrations/APPOINTMENT-REQUESTS.md.
-- Numbered 234 because 231–233 are taken on the deployment branch (and 231 is applied
-- on the clinic database); a gap is harmless, a collision is not.
--
-- Own file and own transaction: a new enum value cannot be used inside the
-- transaction that adds it, and 235 uses it in a policy (pattern: 128).
BEGIN;
ALTER TYPE app.appt_source ADD VALUE IF NOT EXISTS 'whatsapp';
INSERT INTO app.schema_migrations (version) VALUES ('234_appointment_source_whatsapp')
    ON CONFLICT DO NOTHING;
COMMIT;
