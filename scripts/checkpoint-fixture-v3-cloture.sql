-- ═══════════════════════════════════════════════════════════════════════════
-- checkpoint-fixture-v3-cloture.sql — dossier synthétique porteur pour la
-- passerelle `jarvis-resume-cas` et le contrôle « bandeau Aujourd'hui ».
--
-- ⚠️ CONTRAT DE CLÔTURE V3 (session dédiée, périmètre gelé) :
--   - AUCUNE migration, AUCUN schéma : uniquement des LIGNES de données
--     synthétiques (ADR-016 : cloud-dev uniquement).
--   - REJOIGNABLE : identifiants FIXES (`c1000000-…`) + garde d'existence
--     sémantique. Un second passage n'écrit RIEN et ne duplique RIEN.
--   - AUCUN DELETE : les lignes subsistent ; elles sont is_synthetic=true,
--     rattachées au dossier SEMÉ par 015 (…b2 · TEST-0002, praticienne …a2).
--     Enrichissement 2026-09-05 : 3 patients supplémentaires (b003-b005)
--     avec timeline complète + résumés, mêmes garanties (fixes, idempotents).
--   - La transaction N'EST PAS annulée : la passerelle lit dans SA PROPRE
--     connexion, elle a besoin de lignes validées. C'est l'exception explicite
--     du protocole de clôture (fixtures annulées = checkpoints SQL seuls).
--
-- Exécution :
--   node --input-type=module via scripts/lib/dburl.mjs (psql postgres:15)
--   psql "$DATABASE_URL" -qtAX -v ON_ERROR_STOP=1 -f scripts/checkpoint-fixture-v3-cloture.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Garde ADR-016 : exactement une ligne de déploiement, cloud-dev. Sinon STOP.
DO $$
DECLARE n int; env text;
BEGIN
  SELECT count(*), min(environment::text) INTO n, env FROM app.deployment;
  IF n <> 1 OR env <> 'cloud-dev' THEN
    RAISE EXCEPTION 'garde ADR-016 : deployment=% environment=% — fixture refusée', n, coalesce(env,'NULL');
  END IF;
END $$;

-- ── Diagnostic déterministe sur le dossier …b2 (praticienne …a2) ────────────
INSERT INTO app.diagnoses (id, cabinet_id, practitioner_id, patient_id,
                           code, label, is_primary, onset_date, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000d001',
       p.cabinet_id, p.practitioner_id, p.id,
       'F32.1', 'Épisode dépressif moyen (fixture V3-CLÔTURE)', true, DATE '2026-01-10', true
  FROM app.patients p
 WHERE p.id = '00000000-0000-0000-0000-0000000000b2'
   AND p.is_synthetic
   AND NOT EXISTS (SELECT 1 FROM app.diagnoses d
                    WHERE d.patient_id = p.id
                      AND d.label = 'Épisode dépressif moyen (fixture V3-CLÔTURE)');

-- ── Deux mesures de la MÊME échelle (le delta fait le signal du résumé) ─────
INSERT INTO app.scale_administrations (id, cabinet_id, practitioner_id, patient_id,
                                       scale_id, responses, total_score,
                                       administered_at, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000f001',
       p.cabinet_id, p.practitioner_id, p.id,
       s.id, '{}'::jsonb, 14, now() - interval '40 days', true
  FROM app.patients p CROSS JOIN (SELECT id FROM app.scales ORDER BY code LIMIT 1) s
 WHERE p.id = '00000000-0000-0000-0000-0000000000b2'
   AND NOT EXISTS (SELECT 1 FROM app.scale_administrations x
                    WHERE x.id = 'c1000000-0000-4000-8000-00000000f001');

INSERT INTO app.scale_administrations (id, cabinet_id, practitioner_id, patient_id,
                                       scale_id, responses, total_score,
                                       administered_at, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000f002',
       p.cabinet_id, p.practitioner_id, p.id,
       s.id, '{}'::jsonb, 9, now() - interval '5 days', true
  FROM app.patients p CROSS JOIN (SELECT id FROM app.scales ORDER BY code LIMIT 1) s
 WHERE p.id = '00000000-0000-0000-0000-0000000000b2'
   AND NOT EXISTS (SELECT 1 FROM app.scale_administrations x
                    WHERE x.id = 'c1000000-0000-4000-8000-00000000f002');

-- ── Rendez-vous AUJOURD'HUI (contrôle 3 : action dominante Démarrer) ────────
-- Bornes Africa/Algiers : 10:00→10:30 heure locale du jour, quel que soit l'UTC.
INSERT INTO app.appointments (id, cabinet_id, practitioner_id, patient_id,
                              starts_at, ends_at, status, source, created_by,
                              is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000a201',
       p.cabinet_id, p.practitioner_id, p.id,
       ((date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') + interval '10 hours')
          AT TIME ZONE 'Africa/Algiers'),
       ((date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') + interval '10 hours 30 minutes')
          AT TIME ZONE 'Africa/Algiers'),
       'confirmed', 'doctor', p.practitioner_id, true
  FROM app.patients p
 WHERE p.id = '00000000-0000-0000-0000-0000000000b2'
   AND NOT EXISTS (
     SELECT 1 FROM app.appointments a
      WHERE a.patient_id = p.id
        AND a.starts_at >= ((date_trunc('day', now() AT TIME ZONE 'Africa/Algiers')) AT TIME ZONE 'Africa/Algiers')
        AND a.starts_at <  ((date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') + interval '1 day') AT TIME ZONE 'Africa/Algiers'));

-- ═══════════════════════════════════════════════════════════════════════════
-- ENRICHISSEMENT 2026-09-05 — noms réalistes + timeline clinique + résumés
-- Noms algériens avec marqueur (test) : Yasmine AMRANI, Jilali MOKRANE,
-- Karima OUALI. Chaque patient porte une timeline complète (diagnostic,
-- échelles, notes, consultation, RDV) et un résumé du cas citant ses sources.
-- Tous les IDs sont fixes c1000000-… + is_synthetic=true, idempotents.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 3 patients synthétiques enrichis (rattachés à la praticienne …a2) ─────
INSERT INTO app.patients (id, cabinet_id, practitioner_id, record_number,
                          first_name, last_name, phone, birth_date, sex,
                          is_synthetic, created_by)
SELECT 'c1000000-0000-4000-8000-00000000b003',
       p.cabinet_id, p.practitioner_id, 'TEST-0003',
       'Yasmine', 'AMRANI (test)', '0555000003', DATE '1992-06-14', 'F', true, p.practitioner_id
  FROM app.patients p WHERE p.id = '00000000-0000-0000-0000-0000000000b2'
   AND NOT EXISTS (SELECT 1 FROM app.patients x WHERE x.id = 'c1000000-0000-4000-8000-00000000b003');

INSERT INTO app.patients (id, cabinet_id, practitioner_id, record_number,
                          first_name, last_name, phone, birth_date, sex,
                          is_synthetic, created_by)
SELECT 'c1000000-0000-4000-8000-00000000b004',
       p.cabinet_id, p.practitioner_id, 'TEST-0004',
       'Jilali', 'MOKRANE (test)', '0555000004', DATE '1978-11-02', 'M', true, p.practitioner_id
  FROM app.patients p WHERE p.id = '00000000-0000-0000-0000-0000000000b2'
   AND NOT EXISTS (SELECT 1 FROM app.patients x WHERE x.id = 'c1000000-0000-4000-8000-00000000b004');

INSERT INTO app.patients (id, cabinet_id, practitioner_id, record_number,
                          first_name, last_name, phone, birth_date, sex,
                          is_synthetic, created_by)
SELECT 'c1000000-0000-4000-8000-00000000b005',
       p.cabinet_id, p.practitioner_id, 'TEST-0005',
       'Karima', 'OUALI (test)', '0555000005', DATE '1985-03-21', 'F', true, p.practitioner_id
  FROM app.patients p WHERE p.id = '00000000-0000-0000-0000-0000000000b2'
   AND NOT EXISTS (SELECT 1 FROM app.patients x WHERE x.id = 'c1000000-0000-4000-8000-00000000b005');

-- ── Diagnostics (ICD-10) — un par nouveau patient ─────────────────────────
INSERT INTO app.diagnoses (id, cabinet_id, practitioner_id, patient_id,
                           code, label, is_primary, onset_date, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000d002',
       p.cabinet_id, p.practitioner_id, p.id,
       'F41.1', 'Anxiété généralisée (fixture enrichie — Yasmine)', true, DATE '2025-09-10', true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b003'
   AND NOT EXISTS (SELECT 1 FROM app.diagnoses d WHERE d.id = 'c1000000-0000-4000-8000-00000000d002');

INSERT INTO app.diagnoses (id, cabinet_id, practitioner_id, patient_id,
                           code, label, is_primary, onset_date, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000d003',
       p.cabinet_id, p.practitioner_id, p.id,
       'F32.1', 'Épisode dépressif moyen (fixture enrichie — Jilali)', true, DATE '2025-11-20', true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b004'
   AND NOT EXISTS (SELECT 1 FROM app.diagnoses d WHERE d.id = 'c1000000-0000-4000-8000-00000000d003');

INSERT INTO app.diagnoses (id, cabinet_id, practitioner_id, patient_id,
                           code, label, is_primary, onset_date, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000d004',
       p.cabinet_id, p.practitioner_id, p.id,
       'F33.0', 'Trouble dépressif récurrent, épisode actuel léger (fixture — Karima)', true, DATE '2025-10-05', true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b005'
   AND NOT EXISTS (SELECT 1 FROM app.diagnoses d WHERE d.id = 'c1000000-0000-4000-8000-00000000d004');

-- ── Échelles — deux mesures par patient (le delta nourrit le résumé) ─────
INSERT INTO app.scale_administrations (id, cabinet_id, practitioner_id, patient_id,
                                       scale_id, responses, total_score,
                                       administered_at, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000f003',
       p.cabinet_id, p.practitioner_id, p.id, s.id, '{}'::jsonb, 18, now() - interval '42 days', true
  FROM app.patients p CROSS JOIN (SELECT id FROM app.scales ORDER BY code LIMIT 1) s
 WHERE p.id = 'c1000000-0000-4000-8000-00000000b003'
   AND NOT EXISTS (SELECT 1 FROM app.scale_administrations x WHERE x.id = 'c1000000-0000-4000-8000-00000000f003');

INSERT INTO app.scale_administrations (id, cabinet_id, practitioner_id, patient_id,
                                       scale_id, responses, total_score,
                                       administered_at, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000f004',
       p.cabinet_id, p.practitioner_id, p.id, s.id, '{}'::jsonb, 11, now() - interval '6 days', true
  FROM app.patients p CROSS JOIN (SELECT id FROM app.scales ORDER BY code LIMIT 1) s
 WHERE p.id = 'c1000000-0000-4000-8000-00000000b003'
   AND NOT EXISTS (SELECT 1 FROM app.scale_administrations x WHERE x.id = 'c1000000-0000-4000-8000-00000000f004');

INSERT INTO app.scale_administrations (id, cabinet_id, practitioner_id, patient_id,
                                       scale_id, responses, total_score,
                                       administered_at, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000f005',
       p.cabinet_id, p.practitioner_id, p.id, s.id, '{}'::jsonb, 16, now() - interval '38 days', true
  FROM app.patients p CROSS JOIN (SELECT id FROM app.scales ORDER BY code LIMIT 1) s
 WHERE p.id = 'c1000000-0000-4000-8000-00000000b004'
   AND NOT EXISTS (SELECT 1 FROM app.scale_administrations x WHERE x.id = 'c1000000-0000-4000-8000-00000000f005');

INSERT INTO app.scale_administrations (id, cabinet_id, practitioner_id, patient_id,
                                       scale_id, responses, total_score,
                                       administered_at, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000f006',
       p.cabinet_id, p.practitioner_id, p.id, s.id, '{}'::jsonb, 12, now() - interval '7 days', true
  FROM app.patients p CROSS JOIN (SELECT id FROM app.scales ORDER BY code LIMIT 1) s
 WHERE p.id = 'c1000000-0000-4000-8000-00000000b004'
   AND NOT EXISTS (SELECT 1 FROM app.scale_administrations x WHERE x.id = 'c1000000-0000-4000-8000-00000000f006');

INSERT INTO app.scale_administrations (id, cabinet_id, practitioner_id, patient_id,
                                       scale_id, responses, total_score,
                                       administered_at, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000f007',
       p.cabinet_id, p.practitioner_id, p.id, s.id, '{}'::jsonb, 14, now() - interval '35 days', true
  FROM app.patients p CROSS JOIN (SELECT id FROM app.scales ORDER BY code LIMIT 1) s
 WHERE p.id = 'c1000000-0000-4000-8000-00000000b005'
   AND NOT EXISTS (SELECT 1 FROM app.scale_administrations x WHERE x.id = 'c1000000-0000-4000-8000-00000000f007');

INSERT INTO app.scale_administrations (id, cabinet_id, practitioner_id, patient_id,
                                       scale_id, responses, total_score,
                                       administered_at, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000f008',
       p.cabinet_id, p.practitioner_id, p.id, s.id, '{}'::jsonb, 8, now() - interval '4 days', true
  FROM app.patients p CROSS JOIN (SELECT id FROM app.scales ORDER BY code LIMIT 1) s
 WHERE p.id = 'c1000000-0000-4000-8000-00000000b005'
   AND NOT EXISTS (SELECT 1 FROM app.scale_administrations x WHERE x.id = 'c1000000-0000-4000-8000-00000000f008');

-- ── Consultations fermées — une par nouveau patient (alimente la timeline) ─
INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id,
                               started_at, ended_at, status, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000c101',
       p.cabinet_id, p.practitioner_id, p.id,
       now() - interval '12 days', now() - interval '12 days' + interval '40 minutes', 'closed', true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b003'
   AND NOT EXISTS (SELECT 1 FROM app.consultations x WHERE x.id = 'c1000000-0000-4000-8000-00000000c101');

INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id,
                               started_at, ended_at, status, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000c102',
       p.cabinet_id, p.practitioner_id, p.id,
       now() - interval '10 days', now() - interval '10 days' + interval '35 minutes', 'closed', true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b004'
   AND NOT EXISTS (SELECT 1 FROM app.consultations x WHERE x.id = 'c1000000-0000-4000-8000-00000000c102');

INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id,
                               started_at, ended_at, status, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000c103',
       p.cabinet_id, p.practitioner_id, p.id,
       now() - interval '8 days', now() - interval '8 days' + interval '45 minutes', 'closed', true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b005'
   AND NOT EXISTS (SELECT 1 FROM app.consultations x WHERE x.id = 'c1000000-0000-4000-8000-00000000c103');

-- ── Notes cliniques — deux par nouveau patient (une brouillon, une signée) ─
-- Yasmine
INSERT INTO app.clinical_notes (id, cabinet_id, practitioner_id, patient_id, consultation_id,
                                status, subjective, objective, assessment, plan, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000e002',
       p.cabinet_id, p.practitioner_id, p.id, 'c1000000-0000-4000-8000-00000000c101',
       'draft', 'Patiente 32 ans, anxiété généralisée depuis septembre. Plaintes : ruminations nocturnes, tension musculaire, irritabilité. Sommeil morcelé. Appétit conservé. Pas d''idéation suicidaire. Contexte : reprise professionnelle après congé maternité. (note synthétique — fixture enrichie)', NULL, NULL, NULL, true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b003'
   AND NOT EXISTS (SELECT 1 FROM app.clinical_notes x WHERE x.id = 'c1000000-0000-4000-8000-00000000e002');

INSERT INTO app.clinical_notes (id, cabinet_id, practitioner_id, patient_id, consultation_id,
                                status, subjective, signed_at, signed_by, lock_after, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000e003',
       p.cabinet_id, p.practitioner_id, p.id, 'c1000000-0000-4000-8000-00000000c101',
       'signed', 'Réévaluation à J+30 : patiente rapporte amélioration du sommeil sous hygiène + relaxation. Score échelle passé de 18 à 11. Ruminations moins envahissantes. Maintien du suivi hebdomadaire. (note synthétique signée)', now() - interval '6 days', p.practitioner_id, now() - interval '6 days' + interval '15 minutes', true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b003'
   AND NOT EXISTS (SELECT 1 FROM app.clinical_notes x WHERE x.id = 'c1000000-0000-4000-8000-00000000e003');

-- Jilali
INSERT INTO app.clinical_notes (id, cabinet_id, practitioner_id, patient_id, consultation_id,
                                status, subjective, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000e004',
       p.cabinet_id, p.practitioner_id, p.id, 'c1000000-0000-4000-8000-00000000c102',
       'draft', 'Patient 46 ans, épisode dépressif moyen. Tristesse, anhédonie, ralentissement. Sommeil : réveils précoces 5h. Appétit diminué. Pas de projet suicidaire, idées noires passives. Arrêt de travail en cours. Antécédent : épisode similaire 2019. (note synthétique — fixture enrichie)', true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b004'
   AND NOT EXISTS (SELECT 1 FROM app.clinical_notes x WHERE x.id = 'c1000000-0000-4000-8000-00000000e004');

INSERT INTO app.clinical_notes (id, cabinet_id, practitioner_id, patient_id, consultation_id,
                                status, subjective, signed_at, signed_by, lock_after, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000e005',
       p.cabinet_id, p.practitioner_id, p.id, 'c1000000-0000-4000-8000-00000000c102',
       'signed', 'J+31 : score 16→12, humeur en légère amélioration. Sommeil encore fragile. Observance bonne. Poursuite prise en charge, envisager activation comportementale. (note synthétique signée)', now() - interval '7 days', p.practitioner_id, now() - interval '7 days' + interval '15 minutes', true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b004'
   AND NOT EXISTS (SELECT 1 FROM app.clinical_notes x WHERE x.id = 'c1000000-0000-4000-8000-00000000e005');

-- Karima
INSERT INTO app.clinical_notes (id, cabinet_id, practitioner_id, patient_id, consultation_id,
                                status, subjective, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000e006',
       p.cabinet_id, p.practitioner_id, p.id, 'c1000000-0000-4000-8000-00000000c103',
       'draft', 'Patiente 39 ans, trouble dépressif récurrent. Fatigue persistante, culpabilité, difficultés de concentration. Retentissement professionnel. Soutien familial présent. Pas d''idée suicidaire structurée. (note synthétique — fixture enrichie)', true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b005'
   AND NOT EXISTS (SELECT 1 FROM app.clinical_notes x WHERE x.id = 'c1000000-0000-4000-8000-00000000e006');

INSERT INTO app.clinical_notes (id, cabinet_id, practitioner_id, patient_id, consultation_id,
                                status, subjective, signed_at, signed_by, lock_after, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000e007',
       p.cabinet_id, p.practitioner_id, p.id, 'c1000000-0000-4000-8000-00000000c103',
       'signed', 'J+31 : évolution favorable, score 14→8. Patiente décrit regain d''énergie, reprise d''activités. Sommeil normalisé. Maintien rendez-vous mensuel. (note synthétique signée)', now() - interval '4 days', p.practitioner_id, now() - interval '4 days' + interval '15 minutes', true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b005'
   AND NOT EXISTS (SELECT 1 FROM app.clinical_notes x WHERE x.id = 'c1000000-0000-4000-8000-00000000e007');

-- ── RDV futurs pour les nouveaux patients (alimente « À venir ») ────────
INSERT INTO app.appointments (id, cabinet_id, practitioner_id, patient_id,
                              starts_at, ends_at, status, source, created_by, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000a202',
       p.cabinet_id, p.practitioner_id, p.id,
       ((date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') + interval '2 days 09 hours') AT TIME ZONE 'Africa/Algiers'),
       ((date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') + interval '2 days 09 hours 30 minutes') AT TIME ZONE 'Africa/Algiers'),
       'confirmed', 'doctor', p.practitioner_id, true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b003'
   AND NOT EXISTS (SELECT 1 FROM app.appointments x WHERE x.id = 'c1000000-0000-4000-8000-00000000a202');

INSERT INTO app.appointments (id, cabinet_id, practitioner_id, patient_id,
                              starts_at, ends_at, status, source, created_by, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000a203',
       p.cabinet_id, p.practitioner_id, p.id,
       ((date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') + interval '3 days 14 hours') AT TIME ZONE 'Africa/Algiers'),
       ((date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') + interval '3 days 14 hours 30 minutes') AT TIME ZONE 'Africa/Algiers'),
       'confirmed', 'doctor', p.practitioner_id, true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b004'
   AND NOT EXISTS (SELECT 1 FROM app.appointments x WHERE x.id = 'c1000000-0000-4000-8000-00000000a203');

INSERT INTO app.appointments (id, cabinet_id, practitioner_id, patient_id,
                              starts_at, ends_at, status, source, created_by, is_synthetic)
SELECT 'c1000000-0000-4000-8000-00000000a204',
       p.cabinet_id, p.practitioner_id, p.id,
       ((date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') + interval '5 days 10 hours') AT TIME ZONE 'Africa/Algiers'),
       ((date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') + interval '5 days 10 hours 30 minutes') AT TIME ZONE 'Africa/Algiers'),
       'confirmed', 'doctor', p.practitioner_id, true
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b005'
   AND NOT EXISTS (SELECT 1 FROM app.appointments x WHERE x.id = 'c1000000-0000-4000-8000-00000000a204');

-- ── Résumés du cas (patient_case_summaries) — un par nouveau patient ────
-- Insertion directe en tant que postgres (bypass RLS FORCE). Contenu citant
-- les diagnostics et échelles réels du patient — la porte save_case_summary
-- vérifierait les mêmes citations ; ici on les pose déjà valides.
INSERT INTO app.patient_case_summaries (id, cabinet_id, patient_id, practitioner_id, patient_practitioner_id,
                                        version, content, source_state, model, prompt_version, prompt_hash)
SELECT gen_random_uuid(), p.cabinet_id, p.id, p.practitioner_id, p.practitioner_id, 1,
       jsonb_build_object('schema', 1,
         'en_bref', jsonb_build_array(jsonb_build_object('texte', 'Patiente suivie pour anxiété généralisée. Amélioration nette : score 18→11 en 5 semaines. Sommeil et ruminations en voie d''amélioration.',
           'sources', jsonb_build_array(jsonb_build_object('t','diagnostic','id','c1000000-0000-4000-8000-00000000d002'::uuid), jsonb_build_object('t','scale_administration','id','c1000000-0000-4000-8000-00000000f004'::uuid)))),
         'evolution_recente', jsonb_build_array(jsonb_build_object('texte','Tendance favorable sur l''échelle principale, delta -7.','sources', jsonb_build_array(jsonb_build_object('t','scale_administration','id','c1000000-0000-4000-8000-00000000f003'::uuid), jsonb_build_object('t','scale_administration','id','c1000000-0000-4000-8000-00000000f004'::uuid)))),
         'a_discuter', jsonb_build_array(jsonb_build_object('texte','Consolider hygiène de sommeil et techniques de relaxation.','sources','[]'::jsonb)),
         'dernier_etat', NULL::jsonb,
         'traitements_documentes', '[]'::jsonb,
         'points_attention', '[]'::jsonb)::text::jsonb,
       '{}'::jsonb, 'fixture-enrichie', 'resume-v1.0', 'enrichie-yasmine-v1'
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b003'
   AND NOT EXISTS (SELECT 1 FROM app.patient_case_summaries s WHERE s.patient_id = 'c1000000-0000-4000-8000-00000000b003'::uuid);

INSERT INTO app.patient_case_summaries (id, cabinet_id, patient_id, practitioner_id, patient_practitioner_id,
                                        version, content, source_state, model, prompt_version, prompt_hash)
SELECT gen_random_uuid(), p.cabinet_id, p.id, p.practitioner_id, p.practitioner_id, 1,
       jsonb_build_object('schema', 1,
         'en_bref', jsonb_build_array(jsonb_build_object('texte','Patient suivi pour épisode dépressif moyen. Légère amélioration : score 16→12, sommeil encore fragile. Observance bonne.',
           'sources', jsonb_build_array(jsonb_build_object('t','diagnostic','id','c1000000-0000-4000-8000-00000000d003'::uuid), jsonb_build_object('t','scale_administration','id','c1000000-0000-4000-8000-00000000f006'::uuid)))),
         'evolution_recente', jsonb_build_array(jsonb_build_object('texte','Delta -4 sur l''échelle principale en un mois.','sources', jsonb_build_array(jsonb_build_object('t','scale_administration','id','c1000000-0000-4000-8000-00000000f005'::uuid), jsonb_build_object('t','scale_administration','id','c1000000-0000-4000-8000-00000000f006'::uuid)))),
         'a_discuter', jsonb_build_array(jsonb_build_object('texte','Activation comportementale et suivi rapproché.','sources','[]'::jsonb)),
         'dernier_etat', NULL::jsonb,
         'traitements_documentes', '[]'::jsonb,
         'points_attention', '[]'::jsonb)::text::jsonb,
       '{}'::jsonb, 'fixture-enrichie', 'resume-v1.0', 'enrichie-jilali-v1'
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b004'
   AND NOT EXISTS (SELECT 1 FROM app.patient_case_summaries s WHERE s.patient_id = 'c1000000-0000-4000-8000-00000000b004'::uuid);

INSERT INTO app.patient_case_summaries (id, cabinet_id, patient_id, practitioner_id, patient_practitioner_id,
                                        version, content, source_state, model, prompt_version, prompt_hash)
SELECT gen_random_uuid(), p.cabinet_id, p.id, p.practitioner_id, p.practitioner_id, 1,
       jsonb_build_object('schema', 1,
         'en_bref', jsonb_build_array(jsonb_build_object('texte','Patiente suivie pour trouble dépressif récurrent. Évolution favorable : score 14→8, reprise d''activités et sommeil normalisé.',
           'sources', jsonb_build_array(jsonb_build_object('t','diagnostic','id','c1000000-0000-4000-8000-00000000d004'::uuid), jsonb_build_object('t','scale_administration','id','c1000000-0000-4000-8000-00000000f008'::uuid)))),
         'evolution_recente', jsonb_build_array(jsonb_build_object('texte','Delta -6, tendance soutenue sur 4 semaines.','sources', jsonb_build_array(jsonb_build_object('t','scale_administration','id','c1000000-0000-4000-8000-00000000f007'::uuid), jsonb_build_object('t','scale_administration','id','c1000000-0000-4000-8000-00000000f008'::uuid)))),
         'a_discuter', jsonb_build_array(jsonb_build_object('texte','Espacer les rendez-vous, maintenir vigilance rechute.','sources','[]'::jsonb)),
         'dernier_etat', NULL::jsonb,
         'traitements_documentes', '[]'::jsonb,
         'points_attention', '[]'::jsonb)::text::jsonb,
       '{}'::jsonb, 'fixture-enrichie', 'resume-v1.0', 'enrichie-karima-v1'
  FROM app.patients p WHERE p.id = 'c1000000-0000-4000-8000-00000000b005'
   AND NOT EXISTS (SELECT 1 FROM app.patient_case_summaries s WHERE s.patient_id = 'c1000000-0000-4000-8000-00000000b005'::uuid);

-- Résumés pour Smail KARIM (b1) et Ayoub SALMI (b2) — vides mais présents
-- pour que le workspace affiche le bandeau résumé même sans historique riche.
INSERT INTO app.patient_case_summaries (id, cabinet_id, patient_id, practitioner_id, patient_practitioner_id,
                                        version, content, source_state, model, prompt_version, prompt_hash)
SELECT gen_random_uuid(), p.cabinet_id, p.id, p.practitioner_id, p.practitioner_id, 1,
       jsonb_build_object('schema',1,'en_bref','[]'::jsonb,'evolution_recente','[]'::jsonb,'a_discuter','[]'::jsonb,'dernier_etat',NULL::jsonb,'traitements_documentes','[]'::jsonb,'points_attention','[]'::jsonb)::text::jsonb,
       '{}'::jsonb, 'fixture-enrichie', 'resume-v1.0', 'enrichie-smail-v1'
  FROM app.patients p WHERE p.id = '00000000-0000-0000-0000-0000000000b1'
   AND NOT EXISTS (SELECT 1 FROM app.patient_case_summaries s WHERE s.patient_id = '00000000-0000-0000-0000-0000000000b1'::uuid);

INSERT INTO app.patient_case_summaries (id, cabinet_id, patient_id, practitioner_id, patient_practitioner_id,
                                        version, content, source_state, model, prompt_version, prompt_hash)
SELECT gen_random_uuid(), p.cabinet_id, p.id, p.practitioner_id, p.practitioner_id, 1,
       jsonb_build_object('schema',1,'en_bref','[]'::jsonb,'evolution_recente','[]'::jsonb,'a_discuter','[]'::jsonb,'dernier_etat',NULL::jsonb,'traitements_documentes','[]'::jsonb,'points_attention','[]'::jsonb)::text::jsonb,
       '{}'::jsonb, 'fixture-enrichie', 'resume-v1.0', 'enrichie-ayoub-v1'
  FROM app.patients p WHERE p.id = '00000000-0000-0000-0000-0000000000b2'
   AND NOT EXISTS (SELECT 1 FROM app.patient_case_summaries s WHERE s.patient_id = '00000000-0000-0000-0000-0000000000b2'::uuid);

-- ── Vérifications (agrégats sûrs uniquement) ─────────────────────────────────
SELECT 'fixture_diag',
       count(*)::text
FROM app.diagnoses
WHERE id = 'c1000000-0000-4000-8000-00000000d001';
SELECT 'fixture_mesures',
       count(*)::text
FROM app.scale_administrations
WHERE id IN ('c1000000-0000-4000-8000-00000000f001','c1000000-0000-4000-8000-00000000f002');
SELECT 'fixture_rdv_jour_b2',
       count(*)::text
FROM app.appointments
WHERE patient_id = '00000000-0000-0000-0000-0000000000b2'
  AND starts_at >= ((date_trunc('day', now() AT TIME ZONE 'Africa/Algiers')) AT TIME ZONE 'Africa/Algiers')
  AND starts_at <  ((date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') + interval '1 day') AT TIME ZONE 'Africa/Algiers');
SELECT 'patients_total_apres_fixture', count(*) FILTER (WHERE is_synthetic)::text || '/' || count(*)::text FROM app.patients;
SELECT 'fixture_enrichie_patients', count(*)::text FROM app.patients WHERE id IN ('c1000000-0000-4000-8000-00000000b003','c1000000-0000-4000-8000-00000000b004','c1000000-0000-4000-8000-00000000b005');
SELECT 'fixture_enrichie_diags', count(*)::text FROM app.diagnoses WHERE id IN ('c1000000-0000-4000-8000-00000000d002','c1000000-0000-4000-8000-00000000d003','c1000000-0000-4000-8000-00000000d004');
SELECT 'fixture_enrichie_echelles', count(*)::text FROM app.scale_administrations WHERE id IN ('c1000000-0000-4000-8000-00000000f003','c1000000-0000-4000-8000-00000000f004','c1000000-0000-4000-8000-00000000f005','c1000000-0000-4000-8000-00000000f006','c1000000-0000-4000-8000-00000000f007','c1000000-0000-4000-8000-00000000f008');
SELECT 'fixture_enrichie_notes', count(*)::text FROM app.clinical_notes WHERE id IN ('c1000000-0000-4000-8000-00000000e002','c1000000-0000-4000-8000-00000000e003','c1000000-0000-4000-8000-00000000e004','c1000000-0000-4000-8000-00000000e005','c1000000-0000-4000-8000-00000000e006','c1000000-0000-4000-8000-00000000e007');
SELECT 'fixture_enrichie_resumes', count(*)::text FROM app.patient_case_summaries WHERE patient_id IN ('c1000000-0000-4000-8000-00000000b003','c1000000-0000-4000-8000-00000000b004','c1000000-0000-4000-8000-00000000b005','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2');
