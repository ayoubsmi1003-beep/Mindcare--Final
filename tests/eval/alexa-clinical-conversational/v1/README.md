# C200 — campagne d'évaluation d'Alexa (200 questions, français)

Campagne **nouvelle et séparée** de la campagne historique de 300 cas (`tests/eval/alexa-v9-adversarial-300.cjs`), qui reste une
référence de régression intacte. Français uniquement ; aucune question de livre ne nomme un ouvrage (le médecin ne le fait jamais).

| Domaine | Cas | Fichier |
|---|---:|---|
| Patients (informations, résumés, historique, traitements, dates) | 55 | `cases-patient.mjs` |
| Identité et contexte (pronoms, bascule, homonymes, écran consultation, patient suivant) | 45 | `cases-context.mjs` |
| Agenda | 30 | `cases-agenda.mjs` |
| Finance et activité | 25 | `cases-finance.mjs` |
| Livres (questions sans nom de livre) | 35 | `cases-books.mjs` |
| Variation de formulation | 10 | `cases-variation.mjs` |

## Principes

- **Les énoncés ont été écrits avant tout correctif ciblé.** Les correctifs portent sur des classes (concepts, périodes, vocabulaire), pas sur des phrases.
- **Vérité terrain indépendante** : `generate-oracles.mjs` interroge les bases synthétiques jetables **par SQL** (finance : la porte
  `app.get_finance_overview`, base de caisse ; prochain patient : `app.dashboard_today`). Le fichier d'oracles contient des identités
  synthétiques : il reste dans `.eval-out/alexa-c200/` (ignoré par git). Seuls les hashes sont versionnés (`manifest.json`).
- **Évaluateur indépendant** (`evaluate.mjs`, testé par `tests/unit/alexa-c200-evaluator.test.ts`) : un PASS exige le bon patient, la bonne
  donnée, une réponse écrite, aucune contamination ; pour un livre : passage présenté, **mot pour mot** (vérifié par SQL contre les chunks
  approuvés), pertinent (source/section/texte), cité. « J'ai trouvé des passages » sans passage = FAIL.
- Verdicts : PASS / FAIL / NOT VERIFIED / BLOCKED. Un cas non exécuté n'est jamais un PASS. Pas de revue clinique : les attentes ne sont **pas** approuvées par un clinicien.
- Règles appliquées par l'évaluateur (définitions de l'application, jamais inventées) : semaines lundi→dimanche, jours civils `Africa/Algiers`,
  « rendez-vous » = non annulé, une consultation compte clôturée et datée par son début.

## Corrections de l'évaluateur après la première exécution (écrites ici, jamais pour gonfler un score)
1. Dates écrites en forme courte par l'application (« 18 oct. 2026 ») et relatives dans l'agenda (« aujourd'hui », « dans 3 jours ») : acceptées.
   Les premiers FAIL concernés (C012, C046–C049) étaient des défauts de l'oracle, pas d'Alexa.

## Exécution

```bash
# Docker + conteneur mindcare-v8-intelligence-20261027 démarrés ; pnpm install fait
bash tests/eval/alexa-clinical-conversational/v1/run-c200.sh <etiquette> [C001,C002 | domain:agenda]
```
Le script reconstruit `cases.json`, régénère les oracles, puis lance le pilote (`tests/integration/alexa-c200.live.test.ts`) sur le vrai
pipeline (`runAlexa`, vraies portes sous RLS, vrai MiniCPM, retrieval réel, réseau externe bloqué, tour limité à 600 s) pour la base
principale puis la base fixture (finance, patient suivant). Résultats, réponses comprises, dans `.eval-out/alexa-c200/results-<etiquette>.jsonl`.
`node tests/eval/alexa-clinical-conversational/v1/report-c200.mjs <etiquette>` produit le résumé masqué (sans réponses ni identités).
Variable `MINDCARE_C200_RESUME=1` pour reprendre un lot.
