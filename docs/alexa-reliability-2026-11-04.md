# Alexa — fiabilité du 4 novembre 2026

Périmètre : lecture seule de la base du cabinet (`127.0.0.1:55441/mindcare`,
conteneur `mc-p3`), modèle local épinglé, aucun changement de schéma, aucune
écriture clinique. Ce document consigne des faits mesurés, pas des hypothèses.

## 1. Cause racine vérifiée — abstention alors que la preuve existe

Question de référence : « Quelles précautions pour la sertraline ? ».

La porte lexicale est un ET strict (`plainto_tsquery('simple', …)`, migration
`123_knowledge_lexical_reader.sql`) sur `document_tsv`, qui contient
`section || ' ' || texte`. Or PostgreSQL tokenise `Other Warnings/Precautions`
en **un seul lexème** `warnings/precautions` : ni `warnings` ni `precautions`
ne peuvent le matcher.

Mesures sur la base du cabinet (transaction `READ ONLY`, rôle
`authenticated`) :

| Requête | Lignes | Meilleur score |
|---|---:|---:|
| `precautions sertraline` | 0 | — |
| `warnings sertraline` | 0 | — |
| `warnings/precautions sertraline` | 2 | 0,3639 |
| `other warnings/precautions sertraline` | 2 | **0,7253** |
| `surveiller patient sous lithium` | 0 | — |
| `surveillance lithium` | 0 | — |
| `monitoring lithium` | 20 | 0,2757 |

Deux défauts distincts dans la couche de terminologie bilingue :

1. le concept `precautions` listait `precautions` **aussi en anglais**. Le garde
   « la question est déjà dans le vocabulaire du corpus » sautait donc
   l'expansion et laissait partir la requête française, qui ne peut pas
   matcher ;
2. le concept `surveillance` ne connaissait que le nom `surveillance`, pas le
   verbe `surveiller`. La question ne produisait qu'une seule requête en ET,
   donc zéro ligne.

## 2. Correctif appliqué

Fichier : `src/server/knowledge/terminologie-bilingue.ts`.

- `precautions` : `precautions` retiré des formes anglaises ; ajout de
  `other warnings/precautions` et `warnings/precautions`, qui sont les
  graphies réellement indexées ;
- `surveillance` : ajout de `surveiller`, `surveille`, `surveillons`.

Aucune migration, aucun seuil de sécurité abaissé, aucun filtre d'autorité
touché : la porte SQL continue d'exiger C4 + active + approuvée + revue à jour
+ non remplacée.

### Preuve après correctif

Chemin complet `readKnowledge()` sur la base du cabinet :

```
sertraline : etat=ok, 2 preuves, 431 ms, section « Sertraline › Dosing and Use › Other Warnings/Precautions »
lithium    : etat=ok, 5 preuves
hors corpus: etat=sans-preuve, 0 preuve   (l'abstention reste correcte)
```

Tour complet `runAlexa` avec le modèle épinglé :

```
54–57 s, 1 phrase, 487 caractères, 1 source de connaissance,
sertraline mentionnée, aucune abstention, status=partial (voir §5)
```

## 3. Modèle local — mesures sur ce poste

MiniCPM-V-4_7-1B-Q4_K_M.gguf, llama.cpp b11429, contexte 4 096, CPU seul.

| Mesure | Valeur |
|---|---:|
| Démarrage à froid (intégrité + spawn + génération 143 c) | 10,7 s |
| Deuxième appel à chaud (même prompt) | 2,9 s |
| Mémoire `llama-server` | 851 Mo |
| Mémoire du processus Node | 61 Mo |

Le modèle est déchargé après **60 s** d'inactivité : chaque question posée
après une pause repaie l'intégrité (SHA-256 du GGUF de 672 Mo + 50 fichiers du
runtime) et le chargement. C'est un coût fixe mesuré, pas une hypothèse.

## 4. Tests

- `pnpm typecheck` : PASS (code 0).
- `tests/unit` : **440 fichiers PASS, 1 fichier FAIL** —
  `alexa-package-integrity.test.ts` échoue sur deux cas parce que la machine
  n'a **aucun binaire `git`** ; ce n'est pas une régression du code.
- Suites « knowledge » : 253 tests PASS.
- Nouveaux tests d'intégration (ignorés sans variable d'environnement) :
  - `tests/integration/alexa-knowledge-trace.live.test.ts` — trace des requêtes
    planifiées, sans texte source ;
  - `tests/integration/alexa-knowledge-read.live.test.ts` — pipeline
    `readKnowledge()` complet + contrôle d'abstention ;
  - `tests/integration/alexa-answer-e2e.live.test.ts` — tour complet avec le
    modèle ;
  - `tests/integration/alexa-local-model-benchmark.live.test.ts` — mesures
    ci-dessus.

## 5. Limites connues (non corrigées)

1. `status=partial` sur une réponse pourtant ancrée : **c'est volontaire**. Le
   serveur publie des citations verbatim approuvées, jamais la prose du modèle ;
   `agent-tools.ts` ne certifie donc pas `complete`. Toute réponse de
   connaissance reste « partielle » par conception. Décision produit à assumer
   explicitement.
2. Recherche vectorielle désactivée : BGE-M3 est absent du poste. L'index
   768 d (e5-base, 25 235 vecteurs) existe mais n'est lu que si
   `KNOWLEDGE_VECTOR=1` **et** `KNOWLEDGE_VECTOR_RECETTE=e5-base`. Non activé
   ici : +1,1 Go de modèle sur 8 Go, décision à mesurer.
3. « Traitement de première intention du trouble bipolaire » rend 0 ligne : la
   formulation `première intention` n'a pas de concept bilingue. Le corpus
   répond pourtant à `first-line treatment bipolar` (20 lignes).
4. Classement : pour « surveiller sous lithium », les preuves remontées
   incluent « Drug Interactions » et « Pregnancy » avant « Tests ». La
   récupération n'est plus vide, mais l'ordre reste à améliorer.
5. La suite de 100 tests a été exécutée : 38 PASS, 7 FAIL, 55 NOT RUN. Les 55
   non exécutés exigent une session praticienne et 25 à 45 générations modèle.
6. **Qualité factuelle du modèle** : MiniCPM 1B répond faux avec assurance sur
   des faits publics simples (océan Indien, quatre continents,
   « Jean-François Martin » pour Hugo, symbole « C » pour l'or, « Terre » pour
   la planète la plus proche). Le pipeline transmet correctement ces réponses ;
   il ne fabrique pas le fait. Décision à prendre : restreindre les faits
   publics à `general-reference.ts` ou accepter un modèle plus fort.

## 6. Retour arrière

Le correctif tient en deux entrées de `terminologie-bilingue.ts` et trois
modules (`patient-mention.ts`, `model-gateway.ts`, `knowledge-synthesis.ts`).
Retour arrière : restaurer les listes `fr`/`en` d'origine, le garde
`patient` d'origine, le `classerCharge` local d'origine et le libellé
d'historique d'origine. Aucun schéma, aucune donnée, aucun index n'a été
modifié.

