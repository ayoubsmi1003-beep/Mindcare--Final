# tests/MAP.md — quoi prouve quoi (index, pas de duplication)

> Règle : un vert sans sa base est un dispositif FAIL, pas un PASS.
> Intégration/E2E exigent leur prérequis (base de test, `pnpm start`+`/api/health`) ;
> sinon NOT RUN — jamais PASS silencieux.
> Compte reverifié 2026-09-16 par exécution M08 (ne pas ajuster à la main).

## Unit (`tests/unit/`, vitest, node, 74 fichiers, 1041 tests PASS 2026-09-16)
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

## Intégration (`tests/integration/`, 5 — exigent `MINDCARE_TEST_DATABASE_URL`)
- `auth-locale` · `frontiere-donnees` · `identite-pool` · `demarrage-sante` ·
  `jarvis-approbation` :
  sessions, frontière, pool, santé au démarrage, approbation. Sautées sans base → NOT RUN.

## E2E (`tests/e2e/`, Playwright, 19 specs — exigent app démarrée)
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
`routage` (120) · `boucle` (42) · `chaine` (28) · `ecritures` (échec honnête, 26) ·
`frontiere` (49) · `injection` (11) · `registre` (26) · `reveil` (24) · `briefs` (44) ·
`contexte-seance` (STALE : source `supabase/functions/_shared/` absente → NOT RUN) ·
`resume-cas` (STALE : idem → NOT RUN) ·
`registre-sans-suppression` (7) · `micro-partage` (24) · `machine-voix` (28) /
`lecture-voix` (16) / `endpointage` (18) / `reveil-pipeline` (11/11, voix humaine NON MESURÉE) ·
`intentions` (47 cas golden) · `conversation` (15 scripts / 256 contrôles) ·
`knowledge-retrieval` (46 cas fixture : recall/precision/MRR/nDCG/reranker-gain/citation ;
portes SQL 092 + embeddings réels + cross-encoder : NOT RUN).

## Golden gate M08 (`pnpm eval:golden` → `scripts/eval-golden.mjs`, 42 suites)
Compiles ×3 · typecheck ×2 · lint scope M08 · vitest · 19 evals directes ·
`valider-golden.mjs` (`tests/eval/golden-schema.json`, m08-schema-v1) ·
6 gardes grep · intégrité validateur (5 négatifs + 1 positif) ·
preuve de mutation (M01-01 mutée → FAIL exigé) · scan PII ·
rapports `artifacts/m08-gate-<rev>.json/.txt`. Verdicts PASS/FAIL/NOT RUN, exit 0/1/2.
`pnpm eval:jarvis` reste l'autorité historique, inchangée.

## Mesures (`scripts/mesure-*.mjs` — périssables : arbre + HEAD + heure)
Par domaine (`v2/v3/v4/v6/v8`, `reception`, `finances-caisse`, `a5-documents`,
`jarvis-*`, `voix-*`, `patients-v3`, `age-patients`, `alexa-repro`, `modele-openrouter`…).
Un résultat commité = un souvenir, pas une preuve (voir `scripts/README.md`).
