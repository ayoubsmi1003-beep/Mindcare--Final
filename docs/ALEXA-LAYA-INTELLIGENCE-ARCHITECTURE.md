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

- **NOT RUN** · corpus versionné, inférence locale, comparaison A–D, calibration et mesures CPU.
- **NOT RUN** · tests de bout en bout, parité ONNX et paquet Windows.
- **Pilote inactif** · seuil de gain ciblé de dix points, absence de faux positif dangereux et absence de régression à démontrer avant intégration.

## Information pour la praticienne

Alexa conserve ses parcours existants pour le dossier, l’agenda et les connaissances. Les actions sensibles passent toujours par votre confirmation. La qualification des nouvelles formulations françaises reste à faire.
