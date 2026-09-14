# Contrat — recherche et lecture patient (CURRENT)

> Source de vérité : migrations + code ci-dessous. En cas de doute, ils gagnent.

## INPUT
Recherche : chaîne libre (nom normalisé côté base, `051`). Lecture : `p_id uuid`.

## OUTPUT
Lignes patient du cabinet connecté, jamais d'un autre cabinet.

## AUTHORIZATION
RLS décide (`004` : `cabinet_id = app.current_cabinet()` + `can_see_clinical`).
Aucun `if (role)` en JS n'autorise quoi que ce soit (affichage seul).

## DB GATE (portes, pas de SELECT direct — SELECT clinique révoqué)
- `app.search_patients` — redéfinie en `066` (âge), porte d'origine `020:195`.
- `app.get_patient(p_id)` — `020:172`.
- Création : `app.create_patient` (`052`), doublons : `app.find_similar_patients` (`051:124`).
- Signatures exactes : lire la migration, pas ce fichier.

## SIDE EFFECTS
Recherche/lecture : `audit.log_read` dans la même transaction (portes `017+`).
Création : `is_synthetic := app.is_cloud_dev()` (`052`), compteur `record_number`.

## ERRORS
Enveloppe `{ ok, data | error }` via `services/db/http.ts`. Pas de PII dans les messages.

## TESTS
- `tests/e2e/patients.spec.ts`, `patients-fiche.spec.ts`, `patients-nouveau.spec.ts`
- `scripts/checkpoint-patients-v3.sql` (référence RLS, pas vitest)

## DO NOT LOAD
Finance, Jarvis, documents, agenda, `fr.ts` entier, historique des migrations,
`STATE.md`, design-system. Index ADR : chercher `search_patients` dans
`docs/00-DECISIONS.md` uniquement si la décision produit l'exige.
