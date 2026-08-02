-- 015_seed_data — §14 de 01-SCHEMA.md.
--
-- ⚠️ DONNÉES SYNTHÉTIQUES DE DÉVELOPPEMENT. Phase cloud (ADR-016) : aucune
-- donnée patient réelle n'entre ici. La migration 016 marque rétroactivement
-- tout ce fichier `is_synthetic = true`.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DEUX ÉCARTS DÉLIBÉRÉS AU §14, tous deux dans le sens de la prudence :
--
-- 1. AUCUN MÉDICAMENT n'est semé. Le §14 en demande ~60 ; la liste réelle des
--    psychotropes prescrits par la praticienne n'a pas été fournie. Inventer
--    des molécules et des posologies vraisemblables dans une base clinique est
--    plus dangereux qu'une table vide : personne ne relit une donnée qui a
--    l'air juste. Un état vide est honnête (I19). BLOQUÉ, attente humaine.
--
-- 2. LES ÉCHELLES sont semées SANS barème et `is_active = false`. PHQ-9, GAD-7,
--    HDRS et YMRS sont de vrais instruments : inventer leurs seuils
--    d'interprétation produirait des scores faux sur de vrais patients. Les
--    identités sont posées, `items`/`scoring` restent vides jusqu'à saisie
--    vérifiée. Une échelle inactive ne peut pas être administrée par erreur.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Comptes de développement. Le hash de mot de passe est volontairement invalide :
-- CES COMPTES NE PEUVENT PAS SE CONNECTER. C'est exactement ce qu'exige la
-- condition 1 d'ADR-016 (aucun accès praticien sur l'instance cloud). Ils ne
-- servent qu'à porter les `profiles` que les tests RLS empruntent via
-- `request.jwt.claim.sub`.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'owner.dev@invalid.local', 'CONNEXION-IMPOSSIBLE', now(), now()),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'praticien2.dev@invalid.local', 'CONNEXION-IMPOSSIBLE', now(), now()),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'assistante.dev@invalid.local', 'CONNEXION-IMPOSSIBLE', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.cabinets (id, name, address, phone)
VALUES ('00000000-0000-0000-0000-000000000001', 'Cabinet Dr. Larbi N.', 'Alger', '0554813911')
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.profiles (id, cabinet_id, role, full_name, title, speciality_fr,
                          speciality_ar, order_number, phone)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001',
   'owner', 'Larbi N.', 'Dr.',
   'Médecin Spécialiste en Psychiatrie et Psychothérapie',
   'طبيب أخصائي في الطب النفسي والعلاج النفسي', '16/16780', '0554813911'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001',
   'practitioner', 'Praticienne 2 (données de test)', 'Dr.',
   'Médecin Spécialiste en Psychiatrie', NULL, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001',
   'assistant', 'Assistante (données de test)', NULL, NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- Compteurs à 0 (I17 : jamais de SEQUENCE).
INSERT INTO app.counters (cabinet_id, scope, period, current_value)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'patient_record', 'ALL',  0),
  ('00000000-0000-0000-0000-000000000001', 'document',       '2026', 0),
  ('00000000-0000-0000-0000-000000000001', 'payment',        '2026', 0)
ON CONFLICT DO NOTHING;

-- Échelles : identités seulement. Cf. écart n°2 en tête de fichier.
INSERT INTO app.scales (code, name_fr, name_ar, items, scoring, is_active)
VALUES
  ('PHQ9', 'PHQ-9 — dépression',  NULL, '{}'::jsonb, '{}'::jsonb, false),
  ('GAD7', 'GAD-7 — anxiété',     NULL, '{}'::jsonb, '{}'::jsonb, false),
  ('HDRS', 'HDRS — Hamilton dépression', NULL, '{}'::jsonb, '{}'::jsonb, false),
  ('YMRS', 'YMRS — Young manie',  NULL, '{}'::jsonb, '{}'::jsonb, false)
ON CONFLICT (code) DO NOTHING;

-- Patients de test, un par praticien : les tests T1–T8 du §15 en ont besoin
-- pour éprouver la CLOISON. Noms manifestement fictifs, jamais vraisemblables.
INSERT INTO app.patients (id, cabinet_id, practitioner_id, record_number,
                          first_name, last_name, phone, created_by)
VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a1', 'TEST-0001',
   'Patient', 'DE TEST UN', '0555000001', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a2', 'TEST-0002',
   'Patient', 'DE TEST DEUX', '0555000002', '00000000-0000-0000-0000-0000000000a2')
ON CONFLICT (id) DO NOTHING;

-- Une note SIGNÉE ET VERROUILLÉE : sans elle, le test T3 (immuabilité) ne peut
-- rien prouver et le checkpoint rougit honnêtement. `lock_after` est daté dans
-- le passé pour que le verrou soit déjà fermé.
INSERT INTO app.clinical_notes (id, cabinet_id, practitioner_id, patient_id,
                                status, subjective, signed_at, signed_by, lock_after)
VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
   'signed', 'Note de test, signée et verrouillée.',
   now() - interval '1 day', '00000000-0000-0000-0000-0000000000a1',
   now() - interval '1 day' + interval '15 minutes')
ON CONFLICT (id) DO NOTHING;

-- Un RDV et son motif : le test T7 (ADR-017) doit pouvoir constater que
-- l'assistante ne voit AUCUNE ligne de motif — pas seulement une table vide.
INSERT INTO app.appointments (id, cabinet_id, practitioner_id, patient_id,
                              starts_at, ends_at, status, source)
VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
   now() + interval '1 day', now() + interval '1 day 30 minutes', 'confirmed', 'assistant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.appointment_reasons (appointment_id, reason)
VALUES ('00000000-0000-0000-0000-0000000000d1', 'Motif de test — invisible à l''assistante.')
ON CONFLICT (appointment_id) DO NOTHING;

INSERT INTO app.schema_migrations (version) VALUES ('015_seed_data')
    ON CONFLICT DO NOTHING;

COMMIT;
