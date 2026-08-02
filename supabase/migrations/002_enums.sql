-- 002_enums — §1.2 de 01-SCHEMA.md. Aucun type inventé, aucune valeur ajoutée.

BEGIN;

CREATE TYPE app.user_role      AS ENUM ('owner','practitioner','assistant','patient');
CREATE TYPE app.sex            AS ENUM ('M','F');
CREATE TYPE app.appt_status    AS ENUM ('requested','confirmed','arrived','in_session','completed','no_show','cancelled');
CREATE TYPE app.appt_source    AS ENUM ('phone','walk_in','web','assistant','doctor');
CREATE TYPE app.note_status    AS ENUM ('draft','signed');
CREATE TYPE app.consult_status AS ENUM ('open','closed');
CREATE TYPE app.payment_method AS ENUM ('cash');   -- ADR-010 : espèces uniquement
CREATE TYPE app.doc_type       AS ENUM ('bonne_sante_mentale','suivi_medical','certificat_medical','justification');
CREATE TYPE app.intake_lang    AS ENUM ('fr','ar','darija');   -- ADR-008
CREATE TYPE app.pending_status AS ENUM ('awaiting','validated','rejected','merged');
CREATE TYPE app.jarvis_state   AS ENUM ('proposed','confirmed','executed','rejected','failed');
CREATE TYPE app.audit_op       AS ENUM ('select','insert','update','delete');

INSERT INTO app.schema_migrations (version) VALUES ('002_enums') ON CONFLICT DO NOTHING;

COMMIT;
