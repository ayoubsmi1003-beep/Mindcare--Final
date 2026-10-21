-- 005_scales_fixed_ids — identifiants déterministes du référentiel (échelles + 8 médicaments).
--
-- POURQUOI CE FICHIER EXISTE (trouvé par échec réel au premier provisionnement
-- packagé, 2026-10-06) : `015_seed_data.sql` insère les échelles SANS identifiant
-- fixe (UUID engendrés), mais `090_curated_synthetic_cohort.sql` référence en
-- dur les UUID observés sur la base de développement (PHQ9 96ef797e…, GAD7
-- 2e793f37…, HDRS d6e184e1…, YMRS 827d5b42…). Même cause pour 5 médicaments du
-- catalogue 073 (Sertraline, Alprazolam, Fluoxetine, Paroxetine, Olanzapine).
-- Sur un cluster FRAIS, les UUID engendrés diffèrent et 090 échoue
-- (`scale_administrations_scale_id_fkey` 090:306, puis
-- `patient_treatments_medication_id_fkey` 090:347) — le provisionnement d'une
-- installation neuve était impossible.
--
-- Les migrations appliquées ne sont jamais éditées : ce bootstrap (comme 000)
-- est rejoué par `provisionnement.ts` AVANT 015, dont les `ON CONFLICT DO
-- NOTHING` respectent alors ces lignes. Les empreintes 073 sont posées par
-- `005b_medications_fingerprints.sql` (la colonne naît en 073). Idempotent,
-- sans effet sur une base qui possède déjà ces lignes. Aucune donnée patient.

BEGIN;

INSERT INTO app.scales (id, code, name_fr, name_ar, items, scoring, is_active)
VALUES
  ('96ef797e-55c7-44e8-bb97-8a53e975d535', 'PHQ9', 'PHQ-9 — dépression',  NULL, '{}'::jsonb, '{}'::jsonb, false),
  ('2e793f37-2080-4637-b09d-287c86f1a901', 'GAD7', 'GAD-7 — anxiété',     NULL, '{}'::jsonb, '{}'::jsonb, false),
  ('d6e184e1-4efa-4870-98f4-1627193302fd', 'HDRS', 'HDRS — Hamilton dépression', NULL, '{}'::jsonb, '{}'::jsonb, false),
  ('827d5b42-d73a-442d-81d5-b7d678b0eba6', 'YMRS', 'YMRS — Young manie',  NULL, '{}'::jsonb, '{}'::jsonb, false)
ON CONFLICT (code) DO NOTHING;

-- 5 médicaments du catalogue 073 (Sertraline, Alprazolam, Fluoxetine,
-- Paroxetine, Olanzapine, Escitalopram, Quetiapine, Venlafaxine), colonnes de
-- 009 uniquement (les colonnes 073 n'existent pas encore à ce stade). Mêmes
-- valeurs que la base canonique.
INSERT INTO app.medications (id, cabinet_id, inn, brand_name, atc_class, form, strength, default_posology, notes, source, is_active)
VALUES
  ('0a7eeb3f-61ba-4a2b-abb8-4ea4bb442088', NULL, 'ALPRAZOLAM ARROW', 'ALPRAZOLAM ARROW', NULL, 'cp séc', '0,25 mg', NULL, NULL, 'vidal', true),
  ('2008839f-a73f-4bd6-a56b-4398512be770', NULL, 'FLUOXETINE ACCORD', 'FLUOXETINE ACCORD', NULL, 'gél', '20 mg', NULL, NULL, 'vidal', true),
  ('41fa0d84-2c48-4881-9444-bc433b74bab1', NULL, 'OLANZAPINE ACCORD', 'OLANZAPINE ACCORD', NULL, 'cp', '10 mg', NULL, NULL, 'vidal', true),
  ('3ab17df5-a401-4348-98ab-978f461f16eb', NULL, 'PAROXETINE ALMUS', 'PAROXETINE ALMUS', NULL, 'cp pellic', '20 mg', NULL, NULL, 'vidal', true),
  ('276c77f4-ed6c-49d7-a4a0-8e12977c093e', NULL, 'SERTRALINE ALMUS', 'SERTRALINE ALMUS', NULL, 'gél', '50 mg', NULL, NULL, 'vidal', true),
  ('c2dd6bb7-00be-4121-a2e6-cc394ca1d167', NULL, 'ESCITALOPRAM ALMUS', 'ESCITALOPRAM ALMUS', NULL, 'cp pellic', '10 mg', NULL, NULL, 'vidal', true),
  ('f8ba9790-fad0-4fc2-b070-73c208e0ddfa', NULL, 'QUETIAPINE ACCORD LP', 'QUETIAPINE ACCORD LP', NULL, 'cp', '50 mg', NULL, NULL, 'vidal', true),
  ('d41a0628-9cd6-4f9a-92ac-928cea2e69a8', NULL, 'VENLAFAXIN MEDICAL VALLEY', 'VENLAFAXIN MEDICAL VALLEY', NULL, 'gélule', '75 mg', NULL, NULL, 'vidal', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
