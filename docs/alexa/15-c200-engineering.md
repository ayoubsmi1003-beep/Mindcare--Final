# 15 — Alexa C200 : rapport d'ingénierie (livrable D)

Branche `claude/alexa-clinical-conversational-ai-97e2d6`. Base : `claude/alexa-intelligence-transformation-9fc1d1` à 152e806 (avance rapide locale).
Commits locaux seulement, **rien n'est poussé ni fusionné**. Aucune application Windows construite, empaquetée ou distribuée.
Seules les bases synthétiques jetables ont été utilisées (≈ 1 558 patients / 8 143 consultations, et la base fixture) ; ni 5432 ni 55441.

## 1. Fichiers

Nouveaux : `src/server/alexa/consultation-context.ts`, `first-name-search.ts` ; `src/shared/alexa/patient-question.ts`, `agenda-frame.ts`, `practice-frame.ts`.
Modifiés : `orchestrator.ts` (cadres, contexte de consultation, patient suivant, suivis de période), `agent-tools.ts` (résumés sans modèle, bornes honnêtes),
`agent-loop.ts` (prochain RDV depuis l'horloge), `agenda-adapter.ts` (nom du patient suivant), `practice-reads.ts` + i18n (jours chargés, avis « espèces seulement »,
« quel patient ? »), `request-contract.ts`, `patient-mention.ts`, `request-plan.ts`, `agenda-plan.ts`, `knowledge-query.ts` (termes du manuel français),
`knowledge-adapter.ts`, `knowledge-references.ts`, `server/knowledge/recherche.ts` (passages longs jusqu'à 10 000 car.).
Campagne : `tests/eval/alexa-clinical-conversational/v1/*` (200 cas, oracles SQL, évaluateur indépendant, rapport masqué), `tests/integration/alexa-c200.live.test.ts`.
Tests unitaires ajoutés : consultation-context, patient-question, agenda-frame, practice-frame, next-patient-french, c200-evaluator, knowledge-query-manual-terms, plain-summary.

## 2. Requêtes / portes
Aucune requête nouvelle et aucune migration. Portes réutilisées, sous RLS de l'appelant : `search_patients`, `get_patient`, `get_consultation`, `query_alexa_records`,
`get_finance_overview` (base de caisse), `dashboard_today`, `get_analysis_overview`, `app.search_knowledge_lexical`. Les oracles de la campagne sont calculés par SQL
indépendant (lecture seule) dans `generate-oracles.mjs` ; le fichier d'oracles (identités synthétiques) reste dans `.eval-out/` (ignoré par git), seuls les hashes sont versionnés.

## 3. Commandes
```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec vitest run tests/unit --maxWorkers=2
bash tests/eval/alexa-clinical-conversational/v1/run-c200.sh <etiquette> [C001,C002 | domain:book]
node tests/eval/alexa-clinical-conversational/v1/report-c200.mjs <etiquette> [<etiquette>...]
```
Préparation : Docker démarré, conteneur `mindcare-v8-intelligence-20261027`, `pnpm install`. Une exécution complète dure ≈ 30 min sur ce PC.
**Piège d'exploitation** : des processus d'évaluation tués laissent des requêtes `knowledge_chunks` actives dans Postgres pendant des dizaines de minutes ; elles font dépasser
le délai de 15 s de la porte statistique (« La lecture a dépassé le délai autorisé »). Vérifier `pg_stat_activity` avant une campagne.

## 4. Défauts du produit trouvés et corrigés par la campagne
Écran consultation sans patient · résumé de dossier en ≈ 500 s (étape modèle) · « Combien de patients aujourd'hui ? » répondait par la population · préfixe `de` lu comme un nom
(« dépression majeure ») · noms de 4 mots · « Patient suivant » sans nom et patient non retenu (le schéma zod supprimait `first_name`/`last_name`) · « prochain rendez-vous » depuis le début de journée ·
prénom seul · questions financières du jour / de la semaine / de l'année et « impayés » laissées au modèle (240 s, résultat aléatoire) : désormais dates explicites + porte, en quelques ms.

## 5. Défauts de l'évaluateur (jamais pour gonfler un score) — voir `v1/README.md`
Dates courtes/relatives ; rôles SA/SB ; oracle NP1 ; preuve des livres (une paire de mots → trois paires voisines ; page comparée aux marqueurs du chunk de la section du passage).
Les résultats de l'évaluateur d'origine restent dans `.eval-out/alexa-c200/results-final.jsonl` ; ceux du corrigé dans `results-final2.jsonl`.

## 6. Risques et limites
- Modèle 1B local, français uniquement ; la médecin n'a pas validé les attentes (aucune revue clinique).
- Récupération des livres : le chunk des critères de « dépression majeure », ceux du bipolaire II et du syndrome sérotoninergique ne sont pas choisis (classement/fusion) ; la réponse montre alors des passages voisins, mot pour mot, avec leur page.
- Dossiers de plus de ~100 consultations : lus en partie, et la réponse le dit.
- « Créneaux libres » : aucun horaire d'ouverture n'existe → liste honnête. Mode de paiement : espèces seules (ADR-010) → avis.
- Comparaison d'activité mois contre mois : la « période précédente » de la porte statistique est une fenêtre de même durée, pas le mois civil (C151).
- « Séances payées » (C144) : aucune lecture ne compte les séances payées ; la réponse actuelle donne le nombre de consultations enregistrées, ce qui répond à côté.
- Suite unitaire : échecs d'environnement préexistants (fichiers privés ou gitignorés absents du worktree), voir le rapport de résultats.
- Idées hors périmètre (règle 10), à noter dans `STATE.md` : horaires d'ouverture, comptage des séances payées, comparaison au mois civil.
