# Domaine patients (CURRENT)

PURPOSE: Annuaire, espace 360°, création contrôlée (garde doublon), résumés du cas.
OWNER: `services/patients.ts` (54 Ko — lire par section, jamais entier).
ENTRYPOINTS: `src/app/patients/page.tsx` · `nouveau/page.tsx` · `[id]/page.tsx` ·
`src/components/patients/` (16 fichiers).
SERVICES: `patients.ts` · `patient-treatments.ts` · `patient-actif.ts` · `resume-cas.ts`.
DB GATES: `search_patients` (`066`) · `get_patient` (`020`) · `create_patient`
(`052`, `is_synthetic := is_cloud_dev()`) · `find_similar_patients` (`051`) ·
workspace (`076`) · résumés (`053`/`069`) · notes (`065`). Détail : contrat
`docs/contracts/patient-search.md`.
SECURITY: RLS (`cabinet_id` + `can_see_clinical`, `004`) ; lecture = portes
`search/get_patient` ; pas de DELETE ; fixtures `*.invalid.local` + `is_synthetic`.
DEPENDENCIES: agenda (RDV) · consultation (notes) · documents · finance (paiements).
TESTS: e2e `patients*.spec.ts` (3) · unit `traitements-liste-patient-id` ·
`scripts/checkpoint-patients-v3.sql` (référence) · `checkpoint-fixture-v3-cloture.sql`.
KNOWN RISKS: garde doublon (normaliseur `051`) · noms réalistes `(test)` + `is_synthetic`
(double garde, règle 8) · J2-E écritures non prouvées côté Jarvis.
FORBIDDEN: SELECT direct sur `patients` · `if (role)` comme autorisation ·
chaîne UI hors `fr.ts`.
