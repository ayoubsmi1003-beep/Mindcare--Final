# TASK: corriger-recherche-patient
DOMAIN: patients
OBJECTIVE: La recherche annuaire rend les bons patients du cabinet, sans fuite
inter-cabinet. Preuve : checkpoint-patients-v3 vert.
ALLOWED_FILES:
- `src/services/patients.ts` (section recherche)
- `src/app/patients/page.tsx`
- `src/components/patients/LignePatient.tsx`
REQUIRED_CONTEXT: AGENTS.md + `docs/domains/patients.md` +
`docs/contracts/patient-search.md` + fichiers ci-dessus (§ recherché).
FORBIDDEN_CONTEXT: finance, Jarvis, documents, agenda, `fr.ts` entier,
migrations hors `020`/`051`/`066`, `STATE.md`, design-system.
SECURITY_CONSTRAINTS: lecture via `app.search_patients` uniquement ; RLS décide ;
aucune PII dans les logs/erreurs.
VALIDATION: `scripts/checkpoint-patients-v3.sql` (ciblé) + `tsc --noEmit` si TS touché.
STOP_CONDITION: checkpoint vert + diff limité aux fichiers autorisés.
