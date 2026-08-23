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
--     Aucun patient supplémentaire n'est créé par ce script.
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
