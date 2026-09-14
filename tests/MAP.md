# tests/MAP.md — quoi prouve quoi (index, pas de duplication)

> Règle : un vert sans sa base est un dispositif FAIL, pas un PASS.
> Intégration/E2E exigent leur prérequis (base de test, `pnpm start`+`/api/health`) ;
> sinon NOT RUN — jamais PASS silencieux.

## Unit (`tests/unit/`, vitest, node, 26 fichiers)
- `jarvis-routage-multilingue` · `jarvis-proposition-enveloppe` · `jarvis-alias-phase1` :
  intention/normalisation/enveloppe (corpus : `eval-jarvis-routage.mjs`).
- `jarvis-boucle-verbalisation` · `jarvis-contexte-phase3` · `jarvis-phase2` :
  machine à états, broker, cycle.
- `jarvis-capacites-description` · `jarvis-parefeu-mots` · `jarvis-prompt-connaissance` ·
  `jarvis-analyse-seance-log` · `jarvis-reference-nue` : registre, pare-feu, prompts.
- `dictee-chaine` · `regles-dictee` · `insertion-dictee` : dictée SOAP.
- `apres-seance` · `apres-seance-chaine` · `analyse-session-run` · `resume-chronologie` ·
  `contexte-seance-dates` · `contrat-workspace` : post-séance et résumés.
- `http-classification` : enveloppes d'erreur frontalières.
- `electron-chemins` · `electron-etat-demarrage` · `electron-pg-cluster` : runtime bureau.
- `traitements-liste-patient-id` · `verifier-base` : domaine traitements, garde démarrage.

## Intégration (`tests/integration/`, 4 — exigent `MINDCARE_TEST_DATABASE_URL`)
- `auth-locale` · `frontiere-donnees` · `identite-pool` · `demarrage-sante` :
  sessions, frontière, pool, santé au démarrage. Sautées sans base → NOT RUN.

## E2E (`tests/e2e/`, Playwright, 11 — exigent app démarrée)
`connexion` · `tableauDeBord` · `patients` · `patients-fiche` · `patients-nouveau` ·
`agenda` · `consultation-sans-notes` · `critical-chain` (chaîne clinique critique) ·
`finances` · `documents` · `jarvis`. Séquentiels (`workers:1`) — lents, ciblés seulement.

## Checkpoints SQL (`scripts/checkpoint-*.sql` — référence RLS/portes, pas vitest)
`patients-v3` · `v6-finance` · `v4-tableaudebord` · `v2`/`v2-rls` · `reception` ·
`fixture-v3-cloture` · `jeu-dore` · `longitudinal` · `migrations-etat` · `test-chemin-ecriture-finance`.

## Checkpoints shell (`scripts/checkpoint-*.sh`)
`s0` (provision) · `j1a` (T10, base déjà écrite) · `v1`/`v2`/`v3` · `s2`/`s4`/`s5`/`s7`/`s7b` ·
`v6-finance` · `v8-documents` · `pg-local` · `jarvis*` · `clinique-http` · `frontiere-http` · `jarvis-http`.

## Evals Jarvis (`scripts/eval-*.mjs` — hors-ligne, `.eval-out/`, sans clé)
`routage` (corpus 106) · `boucle` · `chaine` (déterministe) · `ecritures` (échec honnête) ·
`frontiere` · `injection` · `registre` · `reveil` · `briefs` · `contexte-seance` · `resume-cas` ·
`registre-sans-suppression` · `micro-partage` · `machine-voix`/`lecture-voix`/`endpointage`/`reveil-pipeline`.

## Mesures (`scripts/mesure-*.mjs` — périssables : arbre + HEAD + heure)
Par domaine (`v2/v3/v4/v6/v8`, `reception`, `finances-caisse`, `a5-documents`,
`jarvis-*`, `voix-*`, `patients-v3`, `age-patients`, `alexa-repro`, `modele-openrouter`…).
Un résultat commité = un souvenir, pas une preuve (voir `scripts/README.md`).
