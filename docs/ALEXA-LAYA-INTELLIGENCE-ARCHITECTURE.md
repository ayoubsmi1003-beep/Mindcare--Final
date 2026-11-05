# Alexa V8 · Cartographie et qualification Laya

Base inspectée `b4bd811`. Le parcours mixte de `496c586` fait déjà partie de cette base.

## Parcours

1. `/api/alexa/turn` authentifie le tour, réclame sa clé idempotente et restaure les références et tâches par les portes de conversation. Les routes `/api/jarvis/jarvis-voice-*` et `jarvis-wake` assurent le transport vocal.
2. `orchestrator.runAlexa` détermine le contexte effectif. Le commutateur natif sélectionne la boucle d’agent. Le parcours compatible garde son propre routage.
3. `agent-loop.runAgentLoop` traite les restrictions, le tour en attente, les références et les plans directs. L’admission textuelle et les constructeurs de plans directs se partagent la reconnaissance. MiniCPM local intervient dans la planification générique.
4. `conversation-state` lie les références à l’acteur et à la conversation. `agentExecutor` contrôle les arguments, revalide la portée patient et appelle les lecteurs gouvernés via DbPort. Les écritures passent par la préparation puis la confirmation existante.
5. `readKnowledge` récupère les preuves. `synthesizeKnowledge` valide la synthèse et `knowledgeResponseEvents` compose les extraits et citations. Les résultats mixtes conservent leur provenance par volet.
6. `model-policy.ts` fixe MiniCPM. `local-model.ts` supervise llama.cpp sur boucle locale et `local-model-slot.ts` sérialise l’inférence. `scripts/preparer-paquet.mjs` prépare les actifs du paquet.

## Catalogue natif

Les schémas complets, y compris les paramètres facultatifs et les dépendances, sont définis dans `agentSchemas`. Les budgets globaux de la boucle sont définis par `ALEXA_NATIVE_BUDGET` et `ALEXA_NATIVE_DEADLINE_MS`. Le contrat `AgentResult` distingue notamment l’erreur, le résultat partiel et la reprise.

| Identifiant | Entrée et usage | Autorité et provenance |
| --- | --- | --- |
| declare_request | Parties, conditions et dépendances | Plan validé, aucune lecture |
| query_patients | Mode, population, recherche, filtres et métriques | Recherche et agrégation gouvernées |
| get_patient_context | Section, référence et curseurs | Patient revalidé, preuves dossier |
| query_consultations | Période, état, vue ou référence | Lectures gouvernées, provenance consultation |
| query_agenda | Fenêtre ou identifiant, états et pagination | Lectures gouvernées, provenance rendez-vous |
| query_documents | Période, type, portée ou référence | Lectures gouvernées, provenance document |
| query_finance | Mode et filtres compatibles avec la portée | Portes financières, provenance paiements ou agrégats |
| query_app | Vue fermée et paramètres propres à la vue | Lectures gouvernées, provenance selon la vue |
| answer_general | Question bornée | Réponse publique, aucune preuve clinique |
| search_knowledge | Requête bornée | Preuves indépendantes, sources et citations |
| prepare_action | Action fermée et paramètres spécifiques | Proposition soumise à confirmation |
| navigate | Destination fermée et référence selon la destination | Navigation, patient revalidé si nécessaire |
| ask_doctor | Question de clarification | Aucune lecture |

## Diagnostic et état

Les formulations hors couverture des plans directs dépendent de l’admission et de la planification générique. La fréquence des erreurs de paraphrase reste à mesurer par famille. L’[audit des réponses mixtes](ALEXA-MIXED-SYNTHESIS-AUDIT.md) documente des lectures dossier réussies avec un volet connaissances dégradé. Le benchmark doit donc mesurer séparément la décision, l’appel, la preuve et la réponse.

Le checkpoint multilingue est le premier candidat français. Les checkpoints général et typed-decisions servent de comparateurs. [Fiche des modèles](https://huggingface.co/convaiinnovations/laya), [runtime officiel](https://github.com/NandhaKishorM/laya).

- **PASS** · contrôles du corpus, exécution du prototype CPU multilingue et rapport par cas.
- **NOT RUN** · tests de bout en bout, parité ONNX et paquet Windows.
- **Pilote inactif** · seuil de gain ciblé de dix points, absence de faux positif dangereux et absence de régression à démontrer avant intégration.

## Méthode et relevé déterministe

`tests/eval/alexa-laya-fr-v1.json` contient 320 formulations synthétiques, regroupées en 32 familles. La calibration contient 150 cas et le test final 170. Les familles de paraphrases restent indivisibles. Le contrôle `py -3.11 scripts/eval-alexa-laya.py --check-corpus` vérifie les quotas, les routes et les identifiants.

`tests/unit/alexa-laya-baseline.test.ts` exécute la vraie boucle avec inférence désactivée et exécuteur d'observation. Il vérifie les schémas des appels attendus. Pour reproduire le relevé par cas, définir `ALEXA_LAYA_BASELINE_REPORT` vers un nouveau chemin local puis lancer `pnpm exec vitest run tests/unit/alexa-laya-baseline.test.ts`.

| Catégorie | Cas | Arrivent à la planification générique | Appel observé |
| --- | ---: | ---: | ---: |
| A · Conversation | 30 | 23 | 7 |
| B · Identification et navigation | 30 | 22 | 8 |
| C · Dossier clinique | 40 | 18 | 22 |
| D · Administration et agenda | 30 | 12 | 17 |
| E · Connaissances | 40 | 16 | 24 |
| F · Mixte | 40 | 14 | 26 |
| G · Actions | 30 | 29 | 0 |
| H · Suivis | 40 | 31 | 6 |
| I · Ambigu ou adversarial | 40 | 33 | 3 |

Les résultats du double de test n'évaluent ni l'autorisation ni la réponse. Les suivis avec historique réel et les deuxièmes étapes dépendantes restent à jouer. Trois cas ambigus ont atteint un exécuteur factice. L'un d'eux, « Affiche l’agenda de ce jour », peut légitimement viser aujourd'hui et mérite une adjudication avant d'être utilisé comme critère de qualification.

## Exécution CPU

Le prototype lit le corpus local, vérifie le SHA-256 du fichier de poids et charge le modèle depuis un répertoire local. Il utilise `laya==0.3.20`, `torch==2.8.0`, `transformers==4.57.6` et `psutil==7.1.0` sous Python 3.11.15. L'inférence utilise les modes hors ligne de Hugging Face et Transformers. Les téléchargements publics d'artefacts se font séparément.

| Checkpoint | Révision Hugging Face | Poids en octets |
| --- | --- | ---: |
| laya-multilingual | `1720e3e3357cfe1e281542e223f8273b0890ca34` | 643 835 514 |
| laya | `7b928d828b7b0e022f929d9bd2e44165aa270148` | 842 609 210 |
| laya-typed-decisions | `e929ae5cf69bc34259cd2f95c9e91145b818b1f0` | 842 609 220 |

Utiliser les fichiers `config.json`, `encoder/config.json`, `rl_agent_config.json`, `tokenizer/tokenizer.json`, `tokenizer/tokenizer_config.json` et `model.safetensors` de la révision correspondante. Le script enregistre les probabilités et temps par cas, le temps de démarrage avec vérification des poids, le pic RSS échantillonné, la médiane et le p95. Le checkpoint multilingue épinglé configure 1 024 tokens de contexte et 256 tokens pour l'en-tête de décision.

```powershell
python scripts/eval-alexa-laya.py --checkpoint laya-multilingual --model-dir <checkpoint-local> --output <nouveau-rapport.json>
```

## Vérification logicielle

| Contrôle | Résultat |
| --- | --- |
| Corpus français | **PASS**, 320 cas, 32 familles |
| Vitest ciblé, boucle, connaissances directes et relevé | **PASS**, 266 tests |
| `pnpm typecheck` | **PASS** |
| `pnpm build` | **PASS** |
| `pnpm build:electron` | **PASS**, compilation TypeScript Electron |
| `pnpm exec vitest run tests/unit --maxWorkers=4` | **FAIL**, 5 774 passés, 3 échoués, 1 ignoré, 1 suite sans fixture Stahl, 1 délai de worker |
| PostgreSQL synthétique, egress réseau, E2E et paquet Windows | **NOT RUN** |

L'échec `lecture-auto.test.ts` se reproduit isolément sur le code de départ. Deux vérifications d'empreinte échouent dans le worktree créé avec `core.autocrlf=true`. La normalisation LF restitue l'empreinte attendue du manifeste adversarial. Elle ne résout pas l'écart d'inventaire vocal. Le fichier Stahl absent est ignoré par Git. Aucune de ces surfaces n'a été modifiée par le prototype.

[Fiche praticienne](ALEXA-LAYA-FICHE-PRATICIENNE.md).

## Résultat multilingue et décision de pilote

Le premier lancement a échoué sur le contrat Python de `laya==0.3.20`. Cette version attend `criteria` pour une question de type `choice`. Le second lancement a produit les 320 décisions, après vérification du poids.

| Catégorie | Route exacte |
| --- | ---: |
| A · Conversation | 0 / 30 |
| B · Identification et navigation | 19 / 30 |
| C · Dossier clinique | 24 / 40 |
| D · Administration et agenda | 27 / 30 |
| E · Connaissances | 0 / 40 |
| F · Mixte | 0 / 40 |
| G · Actions | 17 / 30 |
| H · Suivis | 19 / 40 |
| I · Ambigu ou adversarial | 2 / 40 |
| **Total** | **108 / 320 (33,8 %)** |

Calibration 46/150. Test final 62/170. Aucun cas mixte proposé, rappel 0/40 et précision indéfinie. Sur 60 cas annotés clarification ou refus, 57 ont reçu une autre catégorie. Parmi ces 57, 36 proposent une ouverture de dossier et 10 une préparation d'action. Certaines erreurs ont une probabilité affichée de 1,0. Aucun outil ni aucune action réelle n'a été invoqué.

Sur ce poste Windows, quatre threads configurés, démarrage de 94,4 s avec vérification de l'empreinte. Latence par question de 1,34 s en médiane et de 7,40 s au p95. Pic RSS échantillonné de 1,33 Go. La suite unitaire et le build ont tourné en parallèle sur une partie de la campagne. Ces temps décrivent les conditions de l'essai.

L'ablation exploratoire sur les 130 cas de test final hors suivis et demandes mixtes donne 35/130 pour A, 53/130 pour B et 68/130 pour C. A dérive la catégorie des appels directs ou du statut de clarification, C conserve la catégorie A quand elle existe et utilise B ailleurs. Sur les cas de clarification ou refus, C propose une autre catégorie 28 fois, contre une fois pour A. Aucune de ces mesures ne constitue une validation de paramètres ou de permissions.

Pour explorer D, chaque catégorie candidate devait avoir au moins cinq vraies décisions au-dessus de tous ses faux positifs sur la calibration des cas non couverts par A. Ce filtre a retenu zéro catégorie parmi conversation, connaissances, traitement actif, agenda du jour et agenda du lendemain. Le résultat exploratoire de 54/130 vient entièrement de l'ajout d'une clarification par défaut. Il ne mesure aucun gain dû à Laya. La comparaison D de bout en bout et le gain face à MiniCPM réel restent **NOT RUN**.

**Décision** · le checkpoint multilingue et ce contrat de décision ne franchissent pas les conditions du pilote. Le prototype reste isolé. Les paramètres exacts, les preuves, les réponses et les lectures réellement autorisées exigent un scénario synthétique de bout en bout. L'intégration native, ONNX et la distribution Windows restent hors livraison de ce prototype.
