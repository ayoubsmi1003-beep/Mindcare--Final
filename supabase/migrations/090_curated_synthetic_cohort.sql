-- 090_curated_synthetic_cohort — cohorte synthétique longitudinale réaliste (mission fixtures).
--
-- REMPLACE les 232 dossiers synthétiques dispersés (dont ~150 noms machine
-- SansNotes/Chain/Doc/Pat/Dup/Civilite/Cockpit) par 12 dossiers DENSES,
-- déterministes, is_synthetic=true, en cloud-dev uniquement.
-- Ne touche AUCUNE ligne non synthétique (production) : tous les DELETE
-- filtrent is_synthetic. N'ajoute aucune table, ne modifie aucune porte,
-- aucune RLS, aucun comportement applicatif.
--
-- COHORTE (12) :
--   Riches 5-6 séances : Karim Djilali, Sarah Benali, Yacine Haddad, Samir Meziane
--   Moyens 3-4 séances : Nadia Bensalem, Amel Cherif, Lina Khelifi
--   Épars 1-2 séances  : Sofiane Belkacem, Karim Djellali, Mohamed Bensaid/Ben Said/Belkacem
-- Variation traitements : actif (Karim, Sarah nouv., Yacine double, Amel, Samir nouv.),
--   pause (Nadia), arrêté/sans traitement (Lina, Sofiane, Karim Djellali, Mohamed trio),
--   changement (Sarah Escitalopram→Venlafaxine, Samir Olanzapine→Quetiapine).
-- Variation RDV : upcoming confirmés (Karim, Sarah, Nadia, Yacine, Amel, Lina) vs
--   sans upcoming (Samir, Sofiane, Karim Djellali, Mohameds).
-- Ambiguïté : "Karim" → Djilali/Djellali (2), "Mohamed" → trio Bensaid/Ben Said/Belkacem (3).
-- Chaque patient riche/moyen porte : diagnostics, échelles (PHQ9/GAD7), consultations,
--   notes SOAP signées, traitements_v2 + history, résumé du cas citant ses sources.
--
-- Exécution : psql -f 090_curated_synthetic_cohort.sql  (migration normale, COMMIT final)
-- Idempotent partiel : si les 12 IDs existent déjà, l'INSERT saute (NOT EXISTS).

BEGIN;

-- ── Garde ───────────────────────────────────────────────────────────────────
-- Ne s'exécute qu'en cloud-dev ; en self-hosted les DELETE filtrent 0 ligne
-- (is_synthetic=false sur le réel) donc sans effet destructeur, mais on évite
-- de poser des fixtures synthétiques sur une base de production.
DO $$
DECLARE env text;
BEGIN
  SELECT environment INTO env FROM app.deployment WHERE singleton;
  IF env IS DISTINCT FROM 'cloud-dev' THEN
    RAISE NOTICE '090_curated: environment=% — fixtures synthétiques ignorées (self-hosted).', COALESCE(env,'NULL');
  END IF;
END $$;

-- ── Purge des fixtures synthétiques existantes (ordre FK) ──────────────────
-- On supprime TOUT le synthétique pour repartir sur une cohorte propre
-- de 12 dossiers. Les tables sans is_synthetic (counters/charges non synth)
-- ne sont pas touchées. PROFILS/CABINET conservés.

ALTER TABLE app.clinical_notes DISABLE RULE no_delete_notes;
-- history immuable : on désactive temporairement le trigger d'interdiction
DROP TRIGGER IF EXISTS forbid_history_update ON app.patient_treatment_history;
-- audit reste, mais on ne le désactive pas

DELETE FROM app.patient_case_summaries
 WHERE patient_id IN (SELECT id FROM app.patients WHERE is_synthetic=true);

DELETE FROM app.case_summary_feedback
 WHERE summary_id IN (SELECT id FROM app.patient_case_summaries WHERE patient_id IN (SELECT id FROM app.patients WHERE is_synthetic=true));
-- (feedback vide en pratique)

DELETE FROM app.consultation_analyses
 WHERE patient_id IN (SELECT id FROM app.patients WHERE is_synthetic=true);

DELETE FROM app.clinical_note_amendments
 WHERE note_id IN (SELECT id FROM app.clinical_notes WHERE is_synthetic=true);

DELETE FROM app.clinical_notes WHERE is_synthetic=true;

DELETE FROM app.scale_administrations WHERE is_synthetic=true;

DELETE FROM app.diagnoses WHERE is_synthetic=true;

DELETE FROM app.prescription_lines
 WHERE prescription_id IN (SELECT id FROM app.prescriptions WHERE is_synthetic=true);
DELETE FROM app.prescriptions WHERE is_synthetic=true;

DELETE FROM app.patient_treatment_history WHERE is_synthetic=true;
DELETE FROM app.patient_treatments WHERE is_synthetic=true;

-- documents : désactive forbid_document_delete le temps de la purge
ALTER TABLE app.documents DISABLE TRIGGER ALL;
DELETE FROM app.documents WHERE is_synthetic=true;
ALTER TABLE app.documents ENABLE TRIGGER ALL;

DELETE FROM app.payments WHERE is_synthetic=true;

DELETE FROM app.transcript_segments
 WHERE consultation_id IN (SELECT id FROM app.consultations WHERE is_synthetic=true);
DELETE FROM app.live_insights
 WHERE consultation_id IN (SELECT id FROM app.consultations WHERE is_synthetic=true);
DELETE FROM app.consultations WHERE is_synthetic=true;

DELETE FROM app.appointment_reasons
 WHERE appointment_id IN (SELECT id FROM app.appointments WHERE is_synthetic=true);
DELETE FROM app.appointments WHERE is_synthetic=true;

DELETE FROM app.patients WHERE is_synthetic=true;

-- réactive
ALTER TABLE app.clinical_notes ENABLE RULE no_delete_notes;
-- recrée le trigger d'immutabilité history
CREATE TRIGGER forbid_history_update BEFORE UPDATE OR DELETE ON app.patient_treatment_history
  FOR EACH ROW EXECUTE FUNCTION app.forbid_treatment_history_mutation();

-- ── Constantes ──────────────────────────────────────────────────────────────
-- cabinet / owner fixes (015)
-- 00000000-0000-0000-0000-000000000001 / 00000000-0000-0000-0000-0000000000a1
-- meds (issus du catalogue 15645) – choisis psychiatrie
--   Sertraline 50mg  276c77f4-ed6c-49d7-a4a0-8e12977c093e
--   Escitalopram 10  c2dd6bb7-00be-4121-a2e6-cc394ca1d167
--   Venlafaxine 75   d41a0628-9cd6-4f9a-92ac-928cea2e69a8
--   Quetiapine 50    f8ba9790-fad0-4fc2-b070-73c208e0ddfa
--   Olanzapine 10    41fa0d84-2c48-4881-9444-bc433b74bab1
--   Fluoxetine 20    2008839f-a73f-4bd6-a56b-4398512be770
--   Alprazolam 0.25  0a7eeb3f-61ba-4a2b-abb8-4ea4bb442088
--   Paroxetine 20    3ab17df5-a401-4348-98ab-978f461f16eb
-- scales
--   PHQ9 96ef797e-55c7-44e8-bb97-8a53e975d535
--   GAD7 2e793f37-2080-4637-b09d-287c86f1a901

-- ── Patients (12) ───────────────────────────────────────────────────────────
INSERT INTO app.patients (id, cabinet_id, practitioner_id, record_number, first_name, last_name, birth_date, sex, phone, phone_alt, address, marital_status, notes_admin, is_synthetic, created_by)
VALUES
  ('a1000000-0000-4000-8000-000000001001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','P-1001','Karim','Djilali','1988-06-15','M','0555123456',NULL,'Alger Centre','marie','Préfère matin',true,'00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-4000-8000-000000001002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','P-1002','Sarah','Benali','1993-11-02','F','0555234567',NULL,'Hydra, Alger','celibataire',NULL,true,'00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-4000-8000-000000001003','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','P-1003','Nadia','Bensalem','1981-09-18','F','0555345678',NULL,'Kouba, Alger','marie',NULL,true,'00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-4000-8000-000000001004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','P-1004','Yacine','Haddad','1989-03-22','M','0555456789',NULL,'Bab Ezzouar','celibataire',NULL,true,'00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-4000-8000-000000001005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','P-1005','Amel','Cherif','1974-12-05','F','0555567890',NULL,'El Biar','marie',NULL,true,'00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-4000-8000-000000001006','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','P-1006','Samir','Meziane','1979-07-14','M','0555678901',NULL,'Cheraga','divorce',NULL,true,'00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-4000-8000-000000001007','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','P-1007','Lina','Khelifi','1997-04-30','F','0555789012',NULL,'Birkhadem','celibataire',NULL,true,'00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-4000-8000-000000001008','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','P-1008','Sofiane','Belkacem','1977-10-11','M','0555890123',NULL,'Draria','marie',NULL,true,'00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-4000-8000-000000001009','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','P-1009','Karim','Djellali','1988-09-03','M','0555901234',NULL,'Alger','celibataire',NULL,true,'00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-4000-8000-000000001010','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','P-1010','Mohamed','Bensaid','1985-02-20','M','0555011010',NULL,'Bouzareah','marie',NULL,true,'00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-4000-8000-000000001011','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','P-1011','Mohamed','Ben Said','1984-05-11','M','0555011011',NULL,'Baba Hassen','marie',NULL,true,'00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-4000-8000-000000001012','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','P-1012','Mohamed','Belkacem','1983-08-25','M','0555011012',NULL,'El Achour','divorce',NULL,true,'00000000-0000-0000-0000-0000000000a1')
ON CONFLICT (id) DO NOTHING;

-- ── Diagnostics (1 principal par patient riche/moyen + Lina) ────────────────
INSERT INTO app.diagnoses (id, cabinet_id, practitioner_id, patient_id, code_system, code, label, is_primary, onset_date, is_synthetic)
VALUES
  ('a1000000-0000-4000-8000-000000002001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','ICD-10','F41.1','Anxiété généralisée',true,'2026-02-10',true),
  ('a1000000-0000-4000-8000-000000002002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','ICD-10','F32.1','Épisode dépressif moyen',true,'2026-03-01',true),
  ('a1000000-0000-4000-8000-000000002003','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','ICD-10','F51.0','Insomnie non organique',true,'2026-04-12',true),
  ('a1000000-0000-4000-8000-000000002004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','ICD-10','F41.0','Trouble panique',true,'2026-03-20',true),
  ('a1000000-0000-4000-8000-000000002005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001005','ICD-10','F33.0','Trouble dépressif récurrent, épisode léger',true,'2025-11-15',true),
  ('a1000000-0000-4000-8000-000000002006','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','ICD-10','F25.0','Trouble schizo-affectif, type maniaque',true,'2026-01-08',true),
  ('a1000000-0000-4000-8000-000000002007','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001007','ICD-10','F41.1','Anxiété généralisée',true,'2026-05-20',true),
  ('a1000000-0000-4000-8000-000000002008','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001008','ICD-10','F32.0','Épisode dépressif léger',true,'2026-02-28',true)
ON CONFLICT (id) DO NOTHING;

-- ── Consultations ──────────────────────────────────────────────────────────
-- Karim 6
INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, started_at, ended_at, status, is_synthetic, raw_notes) VALUES
  ('a1000000-0000-4000-8000-000000003011','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','2026-05-15 10:00:00+01','2026-05-15 10:45:00+01','closed',true,'Motif: anxiété avec retentissement professionnel. Ruminations nocturnes, tension musculaire, irritabilité. Sommeil morcelé.'),
  ('a1000000-0000-4000-8000-000000003012','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','2026-06-05 10:00:00+01','2026-06-05 10:40:00+01','closed',true,'Suivi: observance bonne, sommeil partiellement amélioré, ruminations moins envahissantes.'),
  ('a1000000-0000-4000-8000-000000003013','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','2026-06-25 10:00:00+01','2026-06-25 10:30:00+01','closed',true,'Amélioration : diminution épisodes anxieux, reprise activité sportive. Tolérance traitement bonne.'),
  ('a1000000-0000-4000-8000-000000003014','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','2026-07-15 10:00:00+01','2026-07-15 10:35:00+01','closed',true,'Stable, sommeil normalisé 7h, poursuite relaxation.'),
  ('a1000000-0000-4000-8000-000000003015','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','2026-08-10 10:00:00+01','2026-08-10 10:30:00+01','closed',true,'Léger stress lié à reprise projet important, gestion par techniques vues.'),
  ('a1000000-0000-4000-8000-000000003016','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','2026-09-01 10:00:00+01','2026-09-01 10:40:00+01','closed',true,'Dernière séance : maintien amélioration, observance régulière, préparation consultation prochaine.')
ON CONFLICT (id) DO NOTHING;
-- Sarah 5
INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, started_at, ended_at, status, is_synthetic, raw_notes) VALUES
  ('a1000000-0000-4000-8000-000000003021','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','2026-04-15 11:00:00+01','2026-04-15 11:45:00+01','closed',true,'Épisode dépressif : tristesse, anhédonie, fatigue, ralentissement, réveils précoces.'),
  ('a1000000-0000-4000-8000-000000003022','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','2026-05-20 11:00:00+01','2026-05-20 11:35:00+01','closed',true,'Réponse partielle sous Escitalopram, effets digestifs légers, humeur encore basse.'),
  ('a1000000-0000-4000-8000-000000003023','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','2026-06-18 11:00:00+01','2026-06-18 11:30:00+01','closed',true,'Stagnation, score peu modifié, discussion changement traitement.'),
  ('a1000000-0000-4000-8000-000000003024','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','2026-07-22 11:00:00+01','2026-07-22 11:40:00+01','closed',true,'Arrêt Escitalopram, introduction Venlafaxine LP 75mg. Tolérance initiale bonne.'),
  ('a1000000-0000-4000-8000-000000003025','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','2026-08-28 11:00:00+01','2026-08-28 11:35:00+01','closed',true,'Amélioration progressive sous Venlafaxine, énergie en hausse, sommeil 6h30.')
ON CONFLICT (id) DO NOTHING;
-- Nadia 4
INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, started_at, ended_at, status, is_synthetic, raw_notes) VALUES
  ('a1000000-0000-4000-8000-000000003031','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','2026-06-02 09:30:00+01','2026-06-02 10:15:00+01','closed',true,'Insomnie d''endormissement depuis 3 mois, ruminations vespérales, retentissement diurne.'),
  ('a1000000-0000-4000-8000-000000003032','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','2026-06-28 09:30:00+01','2026-06-28 10:00:00+01','closed',true,'Amélioration sous hygiène + Alprazolam 0,25 mg au coucher, endormissement <30 min.'),
  ('a1000000-0000-4000-8000-000000003033','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','2026-07-25 09:30:00+01','2026-07-25 10:10:00+01','closed',true,'Sommeil consolidé 6-7h, discussion sevrage progressif.'),
  ('a1000000-0000-4000-8000-000000003034','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','2026-08-18 09:30:00+01','2026-08-18 10:00:00+01','closed',true,'Pause Alprazolam décidée, maintien hygiène, suivi rapproché.')
ON CONFLICT (id) DO NOTHING;
-- Yacine 5
INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, started_at, ended_at, status, is_synthetic, raw_notes) VALUES
  ('a1000000-0000-4000-8000-000000003041','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','2026-05-02 14:00:00+01','2026-05-02 14:50:00+01','closed',true,'Attaques panique hebdomadaires, évitement transports, hypervigilance.'),
  ('a1000000-0000-4000-8000-000000003042','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','2026-05-30 14:00:00+01','2026-05-30 14:40:00+01','closed',true,'Début Paroxetine 20mg, tolérance correcte, exercices respiration.'),
  ('a1000000-0000-4000-8000-000000003043','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','2026-06-29 14:00:00+01','2026-06-29 14:35:00+01','closed',true,'Frequence panique diminuee (1/2 semaines), ajout Alprazolam 0,25 PRN.'),
  ('a1000000-0000-4000-8000-000000003044','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','2026-07-28 14:00:00+01','2026-07-28 14:30:00+01','closed',true,'Poursuite amélioration, reprise métro accompagnée.'),
  ('a1000000-0000-4000-8000-000000003045','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','2026-08-30 14:00:00+01','2026-08-30 14:40:00+01','closed',true,'Stabilisation, 0 attaque ce mois, observance bonne.')
ON CONFLICT (id) DO NOTHING;
-- Amel 3
INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, started_at, ended_at, status, is_synthetic, raw_notes) VALUES
  ('a1000000-0000-4000-8000-000000003051','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001005','2026-04-10 15:30:00+01','2026-04-10 16:15:00+01','closed',true,'Suivi dépression récurrente, fatigue persistante mais humeur stable, soutien familial.'),
  ('a1000000-0000-4000-8000-000000003052','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001005','2026-06-12 15:30:00+01','2026-06-12 16:00:00+01','closed',true,'Légère amélioration, reprise activités manuelles, sommeil 7h.'),
  ('a1000000-0000-4000-8000-000000003053','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001005','2026-08-20 15:30:00+01','2026-08-20 16:05:00+01','closed',true,'Stable, poursuite Fluoxetine 20mg, pas d''effet indésirable.')
ON CONFLICT (id) DO NOTHING;
-- Samir 6
INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, started_at, ended_at, status, is_synthetic, raw_notes) VALUES
  ('a1000000-0000-4000-8000-000000003061','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','2026-03-05 09:00:00+01','2026-03-05 09:50:00+01','closed',true,'Rechute après amélioration : irritabilité, insomnie, idées de grandeur atténuées.'),
  ('a1000000-0000-4000-8000-000000003062','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','2026-04-02 09:00:00+01','2026-04-02 09:40:00+01','closed',true,'Début Olanzapine 10mg, sédation modérée, surveillance poids.'),
  ('a1000000-0000-4000-8000-000000003063','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','2026-05-08 09:00:00+01','2026-05-08 09:35:00+01','closed',true,'Amélioration nette, sommeil régulé, critique partielle.'),
  ('a1000000-0000-4000-8000-000000003064','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','2026-06-10 09:00:00+01','2026-06-10 09:30:00+01','closed',true,'Prise pondérale +4kg, discussion switch.'),
  ('a1000000-0000-4000-8000-000000003065','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','2026-06-18 09:00:00+01','2026-06-18 09:45:00+01','closed',true,'Arrêt Olanzapine, introduction Quetiapine 50mg LP.'),
  ('a1000000-0000-4000-8000-000000003066','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','2026-08-25 09:00:00+01','2026-08-25 09:40:00+01','closed',true,'Stabilisation sous Quetiapine, poids stable, observance bonne.')
ON CONFLICT (id) DO NOTHING;
-- Lina 3
INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, started_at, ended_at, status, is_synthetic, raw_notes) VALUES
  ('a1000000-0000-4000-8000-000000003071','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001007','2026-06-10 16:30:00+01','2026-06-10 17:15:00+01','closed',true,'Anxiété avec nausées sous Sertraline 25mg, observance hésitante.'),
  ('a1000000-0000-4000-8000-000000003072','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001007','2026-07-02 16:30:00+01','2026-07-02 17:00:00+01','closed',true,'Intolérance confirmée, arrêt Sertraline, passage psychothérapie seule.'),
  ('a1000000-0000-4000-8000-000000003073','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001007','2026-08-22 16:30:00+01','2026-08-22 17:05:00+01','closed',true,'Nausées résolues, anxiété modérée persistante, techniques respiration.')
ON CONFLICT (id) DO NOTHING;
-- Sofiane 1
INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, started_at, ended_at, status, is_synthetic, raw_notes) VALUES
  ('a1000000-0000-4000-8000-000000003081','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001008','2026-08-12 11:30:00+01','2026-08-12 12:15:00+01','closed',true,'Consultation unique : bilan anxiété légère, pas de traitement médicamenteux souhaité, psychoéducation.')
ON CONFLICT (id) DO NOTHING;
-- Karim Djellali 2
INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, started_at, ended_at, status, is_synthetic, raw_notes) VALUES
  ('a1000000-0000-4000-8000-000000003091','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001009','2026-07-10 10:30:00+01','2026-07-10 11:15:00+01','closed',true,'Bilan anxiété contextuelle liée au travail, sommeil correct, pas de dépression.'),
  ('a1000000-0000-4000-8000-000000003092','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001009','2026-08-14 10:30:00+01','2026-08-14 11:00:00+01','closed',true,'Amélioration, mise en place limites professionnelles, pas de médicament.')
ON CONFLICT (id) DO NOTHING;
-- Mohamed trio 2 chacun
INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, started_at, ended_at, status, is_synthetic, raw_notes) VALUES
  ('a1000000-0000-4000-8000-000000003101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001010','2026-06-15 09:00:00+01','2026-06-15 09:40:00+01','closed',true,'Consultation initiale : stress professionnel, irritabilité, pas de traitement.'),
  ('a1000000-0000-4000-8000-000000003102','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001010','2026-08-05 09:00:00+01','2026-08-05 09:30:00+01','closed',true,'Suivi : stress mieux géré, pas de plainte anxieuse marquée.'),
  ('a1000000-0000-4000-8000-000000003111','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001011','2026-06-18 09:30:00+01','2026-06-18 10:10:00+01','closed',true,'Première consultation : anxiété légère, troubles sommeil intermittents.'),
  ('a1000000-0000-4000-8000-000000003112','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001011','2026-08-07 09:30:00+01','2026-08-07 10:00:00+01','closed',true,'Suivi : sommeil amélioré, pas de traitement.'),
  ('a1000000-0000-4000-8000-000000003121','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001012','2026-07-01 09:15:00+01','2026-07-01 10:00:00+01','closed',true,'Bilan : humeur basse transitoire, pas de critère dépressif.'),
  ('a1000000-0000-4000-8000-000000003122','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001012','2026-08-10 09:15:00+01','2026-08-10 09:45:00+01','closed',true,'Suivi : humeur normalisée, pas de traitement.')
ON CONFLICT (id) DO NOTHING;

-- ── Notes cliniques (SOAP) ─────────────────────────────────────────────────
INSERT INTO app.clinical_notes (id, cabinet_id, practitioner_id, patient_id, consultation_id, status, subjective, objective, assessment, plan, signed_at, signed_by, lock_after, is_synthetic) VALUES
  -- Karim 6 notes signées
  ('a1000000-0000-4000-8000-000000004011','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','a1000000-0000-4000-8000-000000003011','signed','Anxiété généralisée depuis 3 mois, ruminations nocturnes, tension musculaire, irritabilité. Sommeil morcelé 5h.', 'Présentation anxieuse, discours cohérent, humeur base anxieuse.','F41.1 Anxiété généralisée, retentissement professionnel.','Introduire Sertraline 50mg matin, hygiène sommeil, relaxation, suivi à 3 semaines.','2026-05-15 11:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-05-15 11:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004012','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','a1000000-0000-4000-8000-000000003012','signed','Observance bonne, effets digestifs légers initiaux résolus, sommeil 6h, ruminations moins envahissantes.','Humeur améliorée, contact bon.','Évolution favorable précoce.','Poursuite Sertraline 50mg, consolidation relaxation.','2026-06-05 11:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-06-05 11:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004013','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','a1000000-0000-4000-8000-000000003013','signed','Diminution nette épisodes anxieux, reprise course à pied 2x/sem, sommeil 7h, confiance retrouvée.','Clinique rangée, euthymique.','Amélioration soutenue.','Maintien traitement, espacer suivi.','2026-06-25 11:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-06-25 11:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004014','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','a1000000-0000-4000-8000-000000003014','signed','Stable, sommeil maintenu, gestion stress au travail efficace.','Stable.','Rémission partielle.','Poursuite sans modification, RDV 4 semaines.','2026-07-15 11:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-07-15 11:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004015','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','a1000000-0000-4000-8000-000000003015','signed','Léger stress lié à échéance projet, a appliqué techniques, pas de recrudescence anxieuse.','Compensé.','Coping efficace.','Préparation prochaine séance, maintien.','2026-08-10 11:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-08-10 11:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004016','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','a1000000-0000-4000-8000-000000003016','signed','Maintien amélioration 4 mois, observance régulière, sommeil 7h, ruminations rares.','Euthymique, projet maintenu.','Évolution favorable durable, observance à surveiller.','Poursuite Sertraline, prochain RDV 18/09.','2026-09-01 11:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-09-01 11:15:00+01',true),
  -- Sarah 5
  ('a1000000-0000-4000-8000-000000004021','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','a1000000-0000-4000-8000-000000003021','signed','Tristesse, anhédonie, fatigue, ralentissement, réveils 5h, appétit diminué. Pas d''idée suicidaire structurée.','Ralentie, humeur dépressive.','F32.1 Épisode dépressif moyen.','Escitalopram 10mg matin, activation comportementale.','2026-04-15 12:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-04-15 12:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004022','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','a1000000-0000-4000-8000-000000003022','signed','Réponse partielle, humeur encore basse, nausées légères.','Amélioration minime.','Réponse insuffisante.','Poursuite Escitalopram, réévaluation.','2026-05-20 12:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-05-20 12:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004023','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','a1000000-0000-4000-8000-000000003023','signed','Stagnation, score inchangé, motivation basse.','Dépressive persistante.','Échec partiel.','Discussion switch Venlafaxine.','2026-06-18 12:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-06-18 12:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004024','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','a1000000-0000-4000-8000-000000003024','signed','Arrêt Escitalopram J-1, début Venlafaxine 75mg, tolérance OK.','Transition.','Switch pour inefficacité.','Venlafaxine LP 75mg matin, suivi 5 semaines.','2026-07-22 12:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-07-22 12:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004025','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','a1000000-0000-4000-8000-000000003025','signed','Amélioration progressive : énergie +30%, sommeil 6h30, reprise lecture.','Humeur en hausse.','Réponse favorable sous Venlafaxine.','Poursuite, prochain RDV 22/09.','2026-08-28 12:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-08-28 12:15:00+01',true),
  -- Nadia 4
  ('a1000000-0000-4000-8000-000000004031','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','a1000000-0000-4000-8000-000000003031','signed','Insomnie endormissement 60-90 min, ruminations, retentissement diurne.','Fatiguée, anxieuse.','F51.0 Insomnie.','Alprazolam 0,25 mg coucher 7j, hygiène sommeil.','2026-06-02 10:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-06-02 10:45:00+01',true),
  ('a1000000-0000-4000-8000-000000004032','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','a1000000-0000-4000-8000-000000003032','signed','Endormissement <30 min, sommeil 6h, observance bonne.','Améliorée.','Réponse bonne.','Poursuite ponctuelle, relaxation.','2026-06-28 10:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-06-28 10:45:00+01',true),
  ('a1000000-0000-4000-8000-000000004033','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','a1000000-0000-4000-8000-000000003033','signed','Sommeil 6-7h consolidé, discussion arrêt progressif.','Stable.','Amélioration maintenue.','Préparer sevrage.','2026-07-25 10:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-07-25 10:45:00+01',true),
  ('a1000000-0000-4000-8000-000000004034','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','a1000000-0000-4000-8000-000000003034','signed','Pause Alprazolam décidée, hygiène maintenue, sommeil 6h sans aide.','Sevrée.','Traitement en pause, surveillance.','Pause, suivi rapproché, RDV 20/09.','2026-08-18 10:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-08-18 10:45:00+01',true),
  -- Yacine 5
  ('a1000000-0000-4000-8000-000000004041','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','a1000000-0000-4000-8000-000000003041','signed','Attaques panique hebdo, palpitations, peur mourir, évitement bus/métro.','Anxieux, hypervigilant.','F41.0 Trouble panique.','Paroxetine 20mg, TCC respiration.','2026-05-02 15:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-05-02 15:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004042','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','a1000000-0000-4000-8000-000000003042','signed','Tolérance correcte, 2 attaques depuis, exposition graduée débutée.','En progrès.','Réponse initiale.','Poursuite Paroxetine, ajout Alprazolam PRN.','2026-05-30 15:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-05-30 15:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004043','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','a1000000-0000-4000-8000-000000003043','signed','Fréquence 1/2 sem, reprise métro 1 station, Alprazolam utilisé 1x.','Amélioration marquée.','Bonne réponse.','Maintien.','2026-06-29 15:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-06-29 15:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004044','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','a1000000-0000-4000-8000-000000003044','signed','0 attaque ce mois, trajet complet métro réussi.','Rémission.','Rémission panique.','Poursuite 3 mois puis dégression envisagée.','2026-07-28 15:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-07-28 15:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004045','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','a1000000-0000-4000-8000-000000003045','signed','Stabilisation, 0 attaque, autonomie retrouvée.','Stable.','Maintien.','Poursuite, RDV 19/09.','2026-08-30 15:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-08-30 15:15:00+01',true),
  -- Amel 3
  ('a1000000-0000-4000-8000-000000004051','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001005','a1000000-0000-4000-8000-000000003051','signed','Dépression récurrente, fatigue, anhédonie modérée, soutien familial.','Euthymique basse.','F33.0 Épisode léger.','Fluoxetine 20mg matin, suivi mensuel.','2026-04-10 16:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-04-10 16:45:00+01',true),
  ('a1000000-0000-4000-8000-000000004052','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001005','a1000000-0000-4000-8000-000000003052','signed','Reprise couture, sommeil 7h, humeur stable.','Améliorée.','Évolution favorable.','Poursuite.','2026-06-12 16:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-06-12 16:45:00+01',true),
  ('a1000000-0000-4000-8000-000000004053','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001005','a1000000-0000-4000-8000-000000003053','signed','Stable 4 mois, pas d''effet indésirable, observance excellente.','Stable.','Suivi stable.','Poursuite, RDV 15/10.','2026-08-20 16:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-08-20 16:45:00+01',true),
  -- Samir 6
  ('a1000000-0000-4000-8000-000000004061','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','a1000000-0000-4000-8000-000000003061','signed','Rechute : irritabilité, insomnie, idées grandeur atténuées, critique partielle.','Hypomaniaque léger.','F25.0 Schizo-affectif.','Olanzapine 10mg soir, surveillance.','2026-03-05 10:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-03-05 10:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004062','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','a1000000-0000-4000-8000-000000003062','signed','Sédation modérée, sommeil 8h, idées atténuées.','Amélioration.','Bonne réponse.','Maintien, contrôle poids.','2026-04-02 10:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-04-02 10:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004063','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','a1000000-0000-4000-8000-000000003063','signed','Sommeil régulé, critique meilleure, reprise travail mi-temps.','Nette amélioration.','Rémission partielle.','Poursuite.','2026-05-08 10:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-05-08 10:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004064','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','a1000000-0000-4000-8000-000000003064','signed','Prise pondérale +4kg, appétit augmenté, pré-diabète limite.','Effet métabolique.','Intolérance pondérale.','Discussion switch Quetiapine.','2026-06-10 10:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-06-10 10:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004065','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','a1000000-0000-4000-8000-000000003065','signed','Arrêt Olanzapine, début Quetiapine 50mg LP, tolérance initiale bonne.','Transition.','Switch pour effets indésirables.','Quetiapine 50mg soir.','2026-06-18 10:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-06-18 10:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004066','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','a1000000-0000-4000-8000-000000003066','signed','Poids stable, sommeil 7h, observance bonne, pas de rechute.','Stabilisé.','Stabilisation sous Quetiapine.','Poursuite, surveillance métabolique.','2026-08-25 10:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-08-25 10:15:00+01',true),
  -- Lina 3
  ('a1000000-0000-4000-8000-000000004071','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001007','a1000000-0000-4000-8000-000000003071','signed','Anxiété, nausées matinales sous Sertraline 25mg, observance hésitante.','Anxieuse, nauséeuse.','Intolérance digestive.','Poursuite courte puis réévaluation.','2026-06-10 17:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-06-10 17:45:00+01',true),
  ('a1000000-0000-4000-8000-000000004072','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001007','a1000000-0000-4000-8000-000000003072','signed','Nausées persistantes, arrêt Sertraline, anxiété modérée sans traitement.','Intolérance confirmée.','Arrêt pour effets indésirables.','Arrêt, psychothérapie seule.','2026-07-02 17:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-07-02 17:45:00+01',true),
  ('a1000000-0000-4000-8000-000000004073','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001007','a1000000-0000-4000-8000-000000003073','signed','Nausées résolues à l''arrêt, anxiété modérée, respiration efficace.','En amélioration sans molécule.','Évolution favorable sans traitement.','Pas de reprise médicamenteuse immédiate.','2026-08-22 17:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-08-22 17:45:00+01',true),
  -- Sofiane 1
  ('a1000000-0000-4000-8000-000000004081','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001008','a1000000-0000-4000-8000-000000003081','signed','Anxiété légère situationnelle, pas de trouble caractérisé, demande bilan.','Rassuré.','Pas de diagnostic posé, psychoéducation.','Pas de traitement, suivi à la demande.','2026-08-12 12:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-08-12 12:45:00+01',true),
  -- Karim Djellali 2
  ('a1000000-0000-4000-8000-000000004091','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001009','a1000000-0000-4000-8000-000000003091','signed','Anxiété contextuelle travail, charge mentale, sommeil conservé, pas de dépression.','Compensé.','Stress adaptatif.','Hygiène, limites, pas de molécule.','2026-07-10 11:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-07-10 11:45:00+01',true),
  ('a1000000-0000-4000-8000-000000004092','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001009','a1000000-0000-4000-8000-000000003092','signed','Amélioration, délégation mise en place, anxiété résiduelle faible.','Bonne évolution.','Amélioration contexte.','Pas de traitement.','2026-08-14 11:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-08-14 11:45:00+01',true),
  -- Mohameds 2 chacun (notes brèves, sans traitement)
  ('a1000000-0000-4000-8000-000000004101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001010','a1000000-0000-4000-8000-000000003101','signed','Stress professionnel, irritabilité passagère, sommeil 6h.','Tendu.','Stress léger.','Psychoéducation, pas de traitement.','2026-06-15 10:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-06-15 10:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004102','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001010','a1000000-0000-4000-8000-000000003102','signed','Mieux géré, pas deplainte marquée.','Stable.','Amélioration.','Pas de traitement.','2026-08-05 10:00:00+01','00000000-0000-0000-0000-0000000000a1','2026-08-05 10:15:00+01',true),
  ('a1000000-0000-4000-8000-000000004111','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001011','a1000000-0000-4000-8000-000000003111','signed','Anxiété légère, sommeil intermittent.','Légèrement anxieux.','Anxiété légère.','Hygiène sommeil.','2026-06-18 10:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-06-18 10:45:00+01',true),
  ('a1000000-0000-4000-8000-000000004112','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001011','a1000000-0000-4000-8000-000000003112','signed','Sommeil amélioré, anxiété faible.','Stable.','Amélioré.','Pas de traitement.','2026-08-07 10:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-08-07 10:45:00+01',true),
  ('a1000000-0000-4000-8000-000000004121','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001012','a1000000-0000-4000-8000-000000003121','signed','Humeur basse transitoire, contexte familial, pas de critère.','Compensé.','Pas de trouble caractérisé.','Soutien, pas de molécule.','2026-07-01 10:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-07-01 10:45:00+01',true),
  ('a1000000-0000-4000-8000-000000004122','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001012','a1000000-0000-4000-8000-000000003122','signed','Humeur normalisée, plus de plainte.','Stable.','Rémission.','Pas de traitement.','2026-08-10 10:30:00+01','00000000-0000-0000-0000-0000000000a1','2026-08-10 10:45:00+01',true)
ON CONFLICT (id) DO NOTHING;

-- ── Échelles ────────────────────────────────────────────────────────────────
INSERT INTO app.scale_administrations (id, cabinet_id, practitioner_id, patient_id, scale_id, responses, total_score, interpretation, administered_at, is_synthetic) VALUES
  -- Karim PHQ9 18→11 GAD7 15→9
  ('a1000000-0000-4000-8000-000000005011','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','96ef797e-55c7-44e8-bb97-8a53e975d535','{}'::jsonb,18,'Modéré','2026-05-15 10:00:00+01',true),
  ('a1000000-0000-4000-8000-000000005012','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','96ef797e-55c7-44e8-bb97-8a53e975d535','{}'::jsonb,11,'Léger','2026-07-15 10:00:00+01',true),
  ('a1000000-0000-4000-8000-000000005013','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','2e793f37-2080-4637-b09d-287c86f1a901','{}'::jsonb,15,'Modéré','2026-05-15 10:00:00+01',true),
  ('a1000000-0000-4000-8000-000000005014','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','2e793f37-2080-4637-b09d-287c86f1a901','{}'::jsonb,9,'Léger','2026-07-15 10:00:00+01',true),
  -- Sarah PHQ9 19→18→16→14→9 (avec switch)
  ('a1000000-0000-4000-8000-000000005021','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','96ef797e-55c7-44e8-bb97-8a53e975d535','{}'::jsonb,19,'Sévère','2026-04-15 11:00:00+01',true),
  ('a1000000-0000-4000-8000-000000005022','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','96ef797e-55c7-44e8-bb97-8a53e975d535','{}'::jsonb,18,'Modéré','2026-05-20 11:00:00+01',true),
  ('a1000000-0000-4000-8000-000000005023','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','96ef797e-55c7-44e8-bb97-8a53e975d535','{}'::jsonb,16,'Modéré','2026-06-18 11:00:00+01',true),
  ('a1000000-0000-4000-8000-000000005024','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','96ef797e-55c7-44e8-bb97-8a53e975d535','{}'::jsonb,9,'Léger','2026-08-28 11:00:00+01',true),
  -- Nadia GAD7 16→10 + ISI-like via PHQ
  ('a1000000-0000-4000-8000-000000005031','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','2e793f37-2080-4637-b09d-287c86f1a901','{}'::jsonb,16,'Modéré','2026-06-02 09:30:00+01',true),
  ('a1000000-0000-4000-8000-000000005032','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','2e793f37-2080-4637-b09d-287c86f1a901','{}'::jsonb,10,'Léger','2026-07-25 09:30:00+01',true),
  -- Yacine GAD7 17→12→7
  ('a1000000-0000-4000-8000-000000005041','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','2e793f37-2080-4637-b09d-287c86f1a901','{}'::jsonb,17,'Sévère','2026-05-02 14:00:00+01',true),
  ('a1000000-0000-4000-8000-000000005042','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','2e793f37-2080-4637-b09d-287c86f1a901','{}'::jsonb,12,'Modéré','2026-06-29 14:00:00+01',true),
  ('a1000000-0000-4000-8000-000000005043','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','2e793f37-2080-4637-b09d-287c86f1a901','{}'::jsonb,7,'Léger','2026-08-30 14:00:00+01',true),
  -- Amel PHQ9 14→10→7
  ('a1000000-0000-4000-8000-000000005051','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001005','96ef797e-55c7-44e8-bb97-8a53e975d535','{}'::jsonb,14,'Modéré','2026-04-10 15:30:00+01',true),
  ('a1000000-0000-4000-8000-000000005052','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001005','96ef797e-55c7-44e8-bb97-8a53e975d535','{}'::jsonb,10,'Léger','2026-06-12 15:30:00+01',true),
  ('a1000000-0000-4000-8000-000000005053','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001005','96ef797e-55c7-44e8-bb97-8a53e975d535','{}'::jsonb,7,'Minimal','2026-08-20 15:30:00+01',true),
  -- Samir PHQ9-like HDRS 22→18→12 puis stable
  ('a1000000-0000-4000-8000-000000005061','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','d6e184e1-4efa-4870-98f4-1627193302fd','{}'::jsonb,22,'Sévère','2026-03-05 09:00:00+01',true),
  ('a1000000-0000-4000-8000-000000005062','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','d6e184e1-4efa-4870-98f4-1627193302fd','{}'::jsonb,12,'Léger','2026-05-08 09:00:00+01',true),
  ('a1000000-0000-4000-8000-000000005063','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','d6e184e1-4efa-4870-98f4-1627193302fd','{}'::jsonb,10,'Léger','2026-08-25 09:00:00+01',true),
  -- Lina GAD7 13→9
  ('a1000000-0000-4000-8000-000000005071','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001007','2e793f37-2080-4637-b09d-287c86f1a901','{}'::jsonb,13,'Modéré','2026-06-10 16:30:00+01',true),
  ('a1000000-0000-4000-8000-000000005072','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001007','2e793f37-2080-4637-b09d-287c86f1a901','{}'::jsonb,9,'Léger','2026-08-22 16:30:00+01',true)
ON CONFLICT (id) DO NOTHING;

-- ── RDV ───────────────────────────────────────────────────────────────────
INSERT INTO app.appointments (id, cabinet_id, practitioner_id, patient_id, starts_at, ends_at, status, source, kind, created_by, is_synthetic) VALUES
  -- Karim : upcoming 2026-09-18 10:00 + past
  ('a1000000-0000-4000-8000-000000006011','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','2026-05-15 10:00:00+01','2026-05-15 10:45:00+01','completed','doctor','premiere_consultation','00000000-0000-0000-0000-0000000000a1',true),
  ('a1000000-0000-4000-8000-000000006012','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','2026-06-05 10:00:00+01','2026-06-05 10:40:00+01','completed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  ('a1000000-0000-4000-8000-000000006013','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','2026-09-18 10:00:00+01','2026-09-18 10:30:00+01','confirmed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  -- Sarah : upcoming 2026-09-22
  ('a1000000-0000-4000-8000-000000006021','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','2026-04-15 11:00:00+01','2026-04-15 11:45:00+01','completed','doctor','premiere_consultation','00000000-0000-0000-0000-0000000000a1',true),
  ('a1000000-0000-4000-8000-000000006022','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','2026-09-22 11:00:00+01','2026-09-22 11:30:00+01','confirmed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  -- Nadia : upcoming 2026-09-20
  ('a1000000-0000-4000-8000-000000006031','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','2026-06-02 09:30:00+01','2026-06-02 10:15:00+01','completed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  ('a1000000-0000-4000-8000-000000006032','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','2026-09-20 09:30:00+01','2026-09-20 10:00:00+01','confirmed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  -- Yacine : upcoming 2026-09-19
  ('a1000000-0000-4000-8000-000000006041','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','2026-05-02 14:00:00+01','2026-05-02 14:50:00+01','completed','doctor','premiere_consultation','00000000-0000-0000-0000-0000000000a1',true),
  ('a1000000-0000-4000-8000-000000006042','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','2026-09-19 14:00:00+01','2026-09-19 14:30:00+01','confirmed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  -- Amel : upcoming 2026-09-25
  ('a1000000-0000-4000-8000-000000006051','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001005','2026-04-10 15:30:00+01','2026-04-10 16:15:00+01','completed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  ('a1000000-0000-4000-8000-000000006052','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001005','2026-09-25 15:30:00+01','2026-09-25 16:00:00+01','confirmed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  -- Samir : pas d'upcoming (test null), seulement passés
  ('a1000000-0000-4000-8000-000000006061','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','2026-03-05 09:00:00+01','2026-03-05 09:50:00+01','completed','doctor','premiere_consultation','00000000-0000-0000-0000-0000000000a1',true),
  ('a1000000-0000-4000-8000-000000006062','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','2026-08-25 09:00:00+01','2026-08-25 09:40:00+01','completed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  -- Lina : upcoming 2026-09-17
  ('a1000000-0000-4000-8000-000000006071','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001007','2026-06-10 16:30:00+01','2026-06-10 17:15:00+01','completed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  ('a1000000-0000-4000-8000-000000006072','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001007','2026-09-17 16:30:00+01','2026-09-17 17:00:00+01','confirmed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  -- Sofiane : seulement passé 2026-08-12
  ('a1000000-0000-4000-8000-000000006081','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001008','2026-08-12 11:30:00+01','2026-08-12 12:15:00+01','completed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  -- Karim Djellali : passé uniquement
  ('a1000000-0000-4000-8000-000000006091','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001009','2026-07-10 10:30:00+01','2026-07-10 11:15:00+01','completed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  ('a1000000-0000-4000-8000-000000006092','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001009','2026-08-14 10:30:00+01','2026-08-14 11:00:00+01','completed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  -- Mohameds : passés uniquement (épars)
  ('a1000000-0000-4000-8000-000000006101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001010','2026-06-15 09:00:00+01','2026-06-15 09:40:00+01','completed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  ('a1000000-0000-4000-8000-000000006111','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001011','2026-06-18 09:30:00+01','2026-06-18 10:10:00+01','completed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true),
  ('a1000000-0000-4000-8000-000000006121','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001012','2026-07-01 09:15:00+01','2026-07-01 10:00:00+01','completed','doctor','suivi','00000000-0000-0000-0000-0000000000a1',true)
ON CONFLICT (id) DO NOTHING;

-- ── Traitements V2 ──────────────────────────────────────────────────────────
-- Karim : Sertraline 50mg active depuis 2026-05-15
INSERT INTO app.patient_treatments (id, cabinet_id, practitioner_id, patient_id, medication_id, consultation_id, status, dose, dose_unit, frequency, instructions, start_date, current_version, is_synthetic)
VALUES ('a1000000-0000-4000-8000-000000007011','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001001','276c77f4-ed6c-49d7-a4a0-8e12977c093e','a1000000-0000-4000-8000-000000003011','active','50','mg','1x/j','Poursuite','2026-05-15',1,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO app.patient_treatment_history (id, treatment_id, version, action, previous_values, new_values, actor_id, occurred_at, consultation_id, is_synthetic)
VALUES ('a1000000-0000-4000-8000-000000008011','a1000000-0000-4000-8000-000000007011',1,'started',NULL,'{"dose":"50 mg"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2026-05-15 11:00:00+01','a1000000-0000-4000-8000-000000003011',true)
ON CONFLICT (treatment_id, version) DO NOTHING;

-- Sarah : Escitalopram 10mg arrêté pour inefficacité, Venlafaxine 75mg active
INSERT INTO app.patient_treatments (id, cabinet_id, practitioner_id, patient_id, medication_id, consultation_id, status, dose, dose_unit, frequency, instructions, start_date, stopped_at, stopped_reason, current_version, is_synthetic) VALUES
  ('a1000000-0000-4000-8000-000000007021','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','c2dd6bb7-00be-4121-a2e6-cc394ca1d167','a1000000-0000-4000-8000-000000003021','stopped','10','mg','1x/j','Arret inefficacite','2026-04-15','2026-07-20 11:00:00+01','inefficacite',2,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO app.patient_treatments (id, cabinet_id, practitioner_id, patient_id, medication_id, consultation_id, status, dose, dose_unit, frequency, instructions, start_date, current_version, is_synthetic)
VALUES ('a1000000-0000-4000-8000-000000007022','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001002','d41a0628-9cd6-4f9a-92ac-928cea2e69a8','a1000000-0000-4000-8000-000000003024','active','75','mg','1x/j','Poursuite','2026-07-22',1,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO app.patient_treatment_history (id, treatment_id, version, action, previous_values, new_values, actor_id, occurred_at, consultation_id, is_synthetic) VALUES
  ('a1000000-0000-4000-8000-000000008021','a1000000-0000-4000-8000-000000007021',1,'started',NULL,'{"dose":"10 mg"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2026-04-15 12:00:00+01','a1000000-0000-4000-8000-000000003021',true),
  ('a1000000-0000-4000-8000-000000008022','a1000000-0000-4000-8000-000000007021',2,'stopped','{"status":"active"}'::jsonb,'{"status":"stopped"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2026-07-20 11:00:00+01','a1000000-0000-4000-8000-000000003024',true),
  ('a1000000-0000-4000-8000-000000008023','a1000000-0000-4000-8000-000000007022',1,'started',NULL,'{"dose":"75 mg"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2026-07-22 12:00:00+01','a1000000-0000-4000-8000-000000003024',true)
ON CONFLICT (treatment_id, version) DO NOTHING;

-- Nadia : Alprazolam 0,25 pause
INSERT INTO app.patient_treatments (id, cabinet_id, practitioner_id, patient_id, medication_id, consultation_id, status, dose, dose_unit, frequency, instructions, start_date, current_version, is_synthetic)
VALUES ('a1000000-0000-4000-8000-000000007031','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001003','0a7eeb3f-61ba-4a2b-abb8-4ea4bb442088','a1000000-0000-4000-8000-000000003031','paused','0,25','mg','1x/j','Au coucher 7j','2026-06-02',2,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO app.patient_treatment_history (id, treatment_id, version, action, previous_values, new_values, actor_id, occurred_at, consultation_id, is_synthetic) VALUES
  ('a1000000-0000-4000-8000-000000008031','a1000000-0000-4000-8000-000000007031',1,'started',NULL,'{"dose":"0,25 mg"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2026-06-02 10:30:00+01','a1000000-0000-4000-8000-000000003031',true),
  ('a1000000-0000-4000-8000-000000008032','a1000000-0000-4000-8000-000000007031',2,'paused','{"status":"active"}'::jsonb,'{"status":"paused"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2026-08-18 10:30:00+01','a1000000-0000-4000-8000-000000003034',true)
ON CONFLICT (treatment_id, version) DO NOTHING;

-- Yacine : Paroxetine 20 + Alprazolam PRN
INSERT INTO app.patient_treatments (id, cabinet_id, practitioner_id, patient_id, medication_id, consultation_id, status, dose, dose_unit, frequency, instructions, start_date, current_version, is_synthetic)
VALUES ('a1000000-0000-4000-8000-000000007041','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','3ab17df5-a401-4348-98ab-978f461f16eb','a1000000-0000-4000-8000-000000003042','active','20','mg','1x/j','Poursuite','2026-05-30',1,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO app.patient_treatments (id, cabinet_id, practitioner_id, patient_id, medication_id, consultation_id, status, dose, dose_unit, frequency, instructions, start_date, current_version, is_synthetic)
VALUES ('a1000000-0000-4000-8000-000000007042','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001004','0a7eeb3f-61ba-4a2b-abb8-4ea4bb442088','a1000000-0000-4000-8000-000000003043','active','0,25','mg','PRN','PRN attaques','2026-06-29',1,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO app.patient_treatment_history (id, treatment_id, version, action, previous_values, new_values, actor_id, occurred_at, consultation_id, is_synthetic) VALUES
  ('a1000000-0000-4000-8000-000000008041','a1000000-0000-4000-8000-000000007041',1,'started',NULL,'{"dose":"20 mg"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2026-05-30 15:00:00+01','a1000000-0000-4000-8000-000000003042',true),
  ('a1000000-0000-4000-8000-000000008042','a1000000-0000-4000-8000-000000007042',1,'started',NULL,'{"dose":"0,25 mg PRN"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2026-06-29 15:00:00+01','a1000000-0000-4000-8000-000000003043',true)
ON CONFLICT (treatment_id, version) DO NOTHING;

-- Amel : Fluoxetine 20 active
INSERT INTO app.patient_treatments (id, cabinet_id, practitioner_id, patient_id, medication_id, consultation_id, status, dose, dose_unit, frequency, instructions, start_date, current_version, is_synthetic)
VALUES ('a1000000-0000-4000-8000-000000007051','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001005','2008839f-a73f-4bd6-a56b-4398512be770','a1000000-0000-4000-8000-000000003051','active','20','mg','1x/j','Poursuite','2025-12-10',1,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO app.patient_treatment_history (id, treatment_id, version, action, previous_values, new_values, actor_id, occurred_at, consultation_id, is_synthetic)
VALUES ('a1000000-0000-4000-8000-000000008051','a1000000-0000-4000-8000-000000007051',1,'started',NULL,'{"dose":"20 mg"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2025-12-10 16:30:00+01','a1000000-0000-4000-8000-000000003051',true)
ON CONFLICT (treatment_id, version) DO NOTHING;

-- Samir : Olanzapine arrêté, Quetiapine active
INSERT INTO app.patient_treatments (id, cabinet_id, practitioner_id, patient_id, medication_id, consultation_id, status, dose, dose_unit, frequency, instructions, start_date, stopped_at, stopped_reason, current_version, is_synthetic)
VALUES ('a1000000-0000-4000-8000-000000007061','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','41fa0d84-2c48-4881-9444-bc433b74bab1','a1000000-0000-4000-8000-000000003062','stopped','10','mg','1x/j','Switch ponderal','2026-04-02','2026-06-15 10:00:00+01','effets_indesirables',2,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO app.patient_treatments (id, cabinet_id, practitioner_id, patient_id, medication_id, consultation_id, status, dose, dose_unit, frequency, instructions, start_date, current_version, is_synthetic)
VALUES ('a1000000-0000-4000-8000-000000007062','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001006','f8ba9790-fad0-4fc2-b070-73c208e0ddfa','a1000000-0000-4000-8000-000000003065','active','50','mg','1x/j','Poursuite','2026-06-18',1,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO app.patient_treatment_history (id, treatment_id, version, action, previous_values, new_values, actor_id, occurred_at, consultation_id, is_synthetic) VALUES
  ('a1000000-0000-4000-8000-000000008061','a1000000-0000-4000-8000-000000007061',1,'started',NULL,'{"dose":"10 mg"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2026-04-02 10:00:00+01','a1000000-0000-4000-8000-000000003062',true),
  ('a1000000-0000-4000-8000-000000008062','a1000000-0000-4000-8000-000000007061',2,'stopped','{"status":"active"}'::jsonb,'{"status":"stopped"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2026-06-15 10:00:00+01','a1000000-0000-4000-8000-000000003065',true),
  ('a1000000-0000-4000-8000-000000008063','a1000000-0000-4000-8000-000000007062',1,'started',NULL,'{"dose":"50 mg"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2026-06-18 10:00:00+01','a1000000-0000-4000-8000-000000003065',true)
ON CONFLICT (treatment_id, version) DO NOTHING;

-- Lina : Sertraline 25 arrêté intolérance
INSERT INTO app.patient_treatments (id, cabinet_id, practitioner_id, patient_id, medication_id, consultation_id, status, dose, dose_unit, frequency, instructions, start_date, stopped_at, stopped_reason, current_version, is_synthetic)
VALUES ('a1000000-0000-4000-8000-000000007071','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','a1000000-0000-4000-8000-000000001007','276c77f4-ed6c-49d7-a4a0-8e12977c093e','a1000000-0000-4000-8000-000000003071','stopped','25','mg','1x/j','Nausees','2026-06-10','2026-07-02 17:30:00+01','effets_indesirables',2,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO app.patient_treatment_history (id, treatment_id, version, action, previous_values, new_values, actor_id, occurred_at, consultation_id, is_synthetic) VALUES
  ('a1000000-0000-4000-8000-000000008071','a1000000-0000-4000-8000-000000007071',1,'started',NULL,'{"dose":"25 mg"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2026-06-10 17:30:00+01','a1000000-0000-4000-8000-000000003071',true),
  ('a1000000-0000-4000-8000-000000008072','a1000000-0000-4000-8000-000000007071',2,'stopped','{"status":"active"}'::jsonb,'{"status":"stopped"}'::jsonb,'00000000-0000-0000-0000-0000000000a1','2026-07-02 17:30:00+01','a1000000-0000-4000-8000-000000003072',true)
ON CONFLICT (treatment_id, version) DO NOTHING;

-- ── Résumés du cas (6 riches/moyens) ──────────────────────────────────────
-- Schéma 1 citant diagnostics/échelles/consultations réels du patient
INSERT INTO app.patient_case_summaries (id, cabinet_id, patient_id, practitioner_id, patient_practitioner_id, version, content, source_state, model, prompt_version, prompt_hash)
VALUES
  ('a1000000-0000-4000-8000-000000009011','00000000-0000-0000-0000-000000000001','a1000000-0000-4000-8000-000000001001','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1',1,
   '{"schema":"1","en_bref":[{"texte":"Patient suivi depuis mai 2026 pour anxiété généralisée avec retentissement professionnel initial. Évolution progressivement favorable sous prise en charge régulière, sommeil normalisé et ruminations rares.","sources":[{"t":"diagnostic","id":"a1000000-0000-4000-8000-000000002001"},{"t":"consultation","id":"a1000000-0000-4000-8000-000000003016"}]}],"evolution_recente":[{"texte":"Delta PHQ-9 -7 et GAD-7 -6 entre mai et juillet, tendance soutenue.","sources":[{"t":"echelle","id":"a1000000-0000-4000-8000-000000005011"},{"t":"echelle","id":"a1000000-0000-4000-8000-000000005012"}]}],"a_discuter":[{"texte":"Consolider techniques relaxation avant reprise projet majeur.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003015"}]}],"traitements_documentes":[{"texte":"Sertraline 50 mg matin poursuivi, bonne tolérance.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003011"}]}],"points_attention":[{"texte":"Vigilance observance lors charge pro accrue.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003015"}]}],"dernier_etat":null}'::jsonb,
   '{}'::jsonb,'synthetique-v090','resume-v1','090-karim'),
  ('a1000000-0000-4000-8000-000000009021','00000000-0000-0000-0000-000000000001','a1000000-0000-4000-8000-000000001002','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1',1,
   '{"schema":"1","en_bref":[{"texte":"Patiente suivie depuis avril 2026 pour épisode dépressif moyen. Réponse partielle sous Escitalopram, switch vers Venlafaxine 75 mg avec amélioration progressive.","sources":[{"t":"diagnostic","id":"a1000000-0000-4000-8000-000000002002"},{"t":"consultation","id":"a1000000-0000-4000-8000-000000003025"}]}],"evolution_recente":[{"texte":"Stagnation sous Escitalopram 19→16, puis Venlafaxine 16→9 en 5 semaines.","sources":[{"t":"echelle","id":"a1000000-0000-4000-8000-000000005023"},{"t":"echelle","id":"a1000000-0000-4000-8000-000000005024"}]}],"a_discuter":[{"texte":"Poursuivre activation comportementale, surveiller tolérance Venlafaxine.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003024"}]}],"traitements_documentes":[{"texte":"Escitalopram arrêté pour inefficacité, Venlafaxine 75 mg actif.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003024"}]}],"points_attention":[{"texte":"Risque rechute si arrêt précoce.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003023"}]}],"dernier_etat":null}'::jsonb,
   '{}'::jsonb,'synthetique-v090','resume-v1','090-sarah'),
  ('a1000000-0000-4000-8000-000000009031','00000000-0000-0000-0000-000000000001','a1000000-0000-4000-8000-000000001003','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1',1,
   '{"schema":"1","en_bref":[{"texte":"Patiente suivie pour insomnie non organique. Amélioration nette sous hygiène + Alprazolam ponctuel, puis sevrage et traitement en pause.","sources":[{"t":"diagnostic","id":"a1000000-0000-4000-8000-000000002003"},{"t":"consultation","id":"a1000000-0000-4000-8000-000000003034"}]}],"evolution_recente":[{"texte":"Endormissement 90→30 min, GAD-7 16→10.","sources":[{"t":"echelle","id":"a1000000-0000-4000-8000-000000005031"},{"t":"echelle","id":"a1000000-0000-4000-8000-000000005032"}]}],"a_discuter":[{"texte":"Maintenir hygiène, suivi sans molécule.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003033"}]}],"traitements_documentes":[{"texte":"Alprazolam en pause depuis 18/08.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003034"}]}],"points_attention":[{"texte":"Rebond insomnie possible à l''arrêt.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003033"}]}],"dernier_etat":null}'::jsonb,
   '{}'::jsonb,'synthetique-v090','resume-v1','090-nadia'),
  ('a1000000-0000-4000-8000-000000009041','00000000-0000-0000-0000-000000000001','a1000000-0000-4000-8000-000000001004','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1',1,
   '{"schema":"1","en_bref":[{"texte":"Patient suivi pour trouble panique. Réduction fréquence attaques sous Paroxetine 20 mg, adjonction Alprazolam PRN, rémission ce mois.","sources":[{"t":"diagnostic","id":"a1000000-0000-4000-8000-000000002004"},{"t":"consultation","id":"a1000000-0000-4000-8000-000000003045"}]}],"evolution_recente":[{"texte":"GAD-7 17→7 sur 3 mois, 0 attaque en août.","sources":[{"t":"echelle","id":"a1000000-0000-4000-8000-000000005041"},{"t":"echelle","id":"a1000000-0000-4000-8000-000000005043"}]}],"a_discuter":[{"texte":"Exposition métro, envisager dégression à 3 mois.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003044"}]}],"traitements_documentes":[{"texte":"Paroxetine 20 mg + Alprazolam PRN.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003043"}]}],"points_attention":[{"texte":"Évitement résiduel à surveiller.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003044"}]}],"dernier_etat":null}'::jsonb,
   '{}'::jsonb,'synthetique-v090','resume-v1','090-yacine'),
  ('a1000000-0000-4000-8000-000000009051','00000000-0000-0000-0000-000000000001','a1000000-0000-4000-8000-000000001005','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1',1,
   '{"schema":"1","en_bref":[{"texte":"Patiente 51 ans, trouble dépressif récurrent épisode léger. Évolution stable favorable sous Fluoxetine 20 mg, reprise activités, sommeil 7h.","sources":[{"t":"diagnostic","id":"a1000000-0000-4000-8000-000000002005"},{"t":"consultation","id":"a1000000-0000-4000-8000-000000003053"}]}],"evolution_recente":[{"texte":"PHQ-9 14→7 sur 4 mois.","sources":[{"t":"echelle","id":"a1000000-0000-4000-8000-000000005051"},{"t":"echelle","id":"a1000000-0000-4000-8000-000000005053"}]}],"a_discuter":[{"texte":"Espacer suivi, maintenir observance.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003053"}]}],"traitements_documentes":[{"texte":"Fluoxetine 20 mg matin stable.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003051"}]}],"points_attention":[{"texte":"Vigilance rechute saisonnière.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003052"}]}],"dernier_etat":null}'::jsonb,
   '{}'::jsonb,'synthetique-v090','resume-v1','090-amel'),
  ('a1000000-0000-4000-8000-000000009061','00000000-0000-0000-0000-000000000001','a1000000-0000-4000-8000-000000001006','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1',1,
   '{"schema":"1","en_bref":[{"texte":"Patient suivi pour trouble schizo-affectif. Amélioration sous Olanzapine puis switch pour prise pondérale vers Quetiapine 50 mg, stabilisation.","sources":[{"t":"diagnostic","id":"a1000000-0000-4000-8000-000000002006"},{"t":"consultation","id":"a1000000-0000-4000-8000-000000003066"}]}],"evolution_recente":[{"texte":"HDRS 22→10 en 5 mois, poids stabilisé après switch.","sources":[{"t":"echelle","id":"a1000000-0000-4000-8000-000000005061"},{"t":"echelle","id":"a1000000-0000-4000-8000-000000005063"}]}],"a_discuter":[{"texte":"Surveillance métabolique trimestrielle.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003065"}]}],"traitements_documentes":[{"texte":"Olanzapine arrêtée (effets métaboliques), Quetiapine 50 mg LP active.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003065"}]}],"points_attention":[{"texte":"Risque rechute si observance fléchit.","sources":[{"t":"consultation","id":"a1000000-0000-4000-8000-000000003064"}]}],"dernier_etat":null}'::jsonb,
   '{}'::jsonb,'synthetique-v090','resume-v1','090-samir')
ON CONFLICT (id) DO NOTHING;

-- ── Compteurs : avance le compteur patient pour éviter collision P-1001 ─────
INSERT INTO app.counters (cabinet_id, scope, period, current_value)
VALUES ('00000000-0000-0000-0000-000000000001','patient_record','ALL',1012)
ON CONFLICT (cabinet_id, scope, period) DO UPDATE SET current_value = GREATEST(app.counters.current_value, 1012);

INSERT INTO app.schema_migrations (version) VALUES ('090_curated_synthetic_cohort')
ON CONFLICT DO NOTHING;

COMMIT;
