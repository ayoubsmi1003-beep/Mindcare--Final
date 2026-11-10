# Chemins d'exécution — premières traces statiques

**Statut : partiel.** Ces chemins ont été lus dans le dépôt ; ils ne sont pas des traces d'exécution sur l'installation du cabinet. Les détails manquants doivent être vérifiés avant de concevoir ou d'implémenter la refonte.

## 1. Navigateur vers PostgreSQL

`src/app/api/db/rpc/route.ts`, `POST`, appelle `preparer`, valide le corps avec `EntreeRpc`, contrôle le nom avec `rpcAutorise`, puis exécute `faireePgPort(...).rpc` dans `withCaller(ctx.userId, ...)`. Deux fonctions d'analyse bénéficient d'un délai de requête spécifique. Les erreurs sont traduites en codes HTTP ; une erreur de transaction produit 503. Les permissions effectives dépendent ensuite des fonctions, droits et politiques de la base ; elles n'ont pas été vérifiées ici.

`src/app/api/db/select/route.ts`, `POST`, valide la spécification et l'allowlist de relation/colonnes avec `selectAutorise`, puis appelle le port sous `withCaller`. Le commentaire de route nomme trois relations directes ; pour affirmer la liste effective il faut encore lire l'allowlist générée. `src/server/alexa/db.ts`, `alexaDb`, utilise également `withCaller` et une transaction authentifiée par porte ; aucune connexion n'est conservée pendant l'inférence selon son contrat.

## 2. Tour Alexa natif

`src/services/alexa-turn.ts`, `envoyerTourAlexa`, transmet le tour et consomme un flux d'événements. `src/app/api/alexa/turn/route.ts`, `POST`, choisit le parcours historique ou natif selon `ALEXA_NATIVE_AGENT_ENABLED`. Sur le chemin natif : refus clinique, origine, identité, validation Zod ; récupération du contexte et validation d'une continuation ; acquisition idempotente du tour via `claim_alexa_turn` ; appel de `runAlexa` avec identité, port SQL, connaissance et signal d'annulation ; émission SSE ; persistance via `complete_jarvis_turn`. Les issues incluent réponses partielles, interruption et reprise avec jeton lié au contexte. Les fonctions SQL et le comportement du chemin historique doivent encore être audités.

`src/server/alexa/orchestrator.ts`, `runAlexa`, contient des parcours directs et une orchestration de demandes composées. `src/server/alexa/agent-loop.ts`, `runAgentLoop`, utilise les limites de `src/shared/alexa/agent.ts`. Le contrat `validateLedger` impose des identifiants uniques et des dépendances vers des parties déjà déclarées ; chaque partie conserve un état et les références de résultat. Il ne faut pas confondre cette décomposition avec une preuve de bon routage sur tous les exemples demandés.

## 3. Connaissance : chemin effectivement câblé

`src/server/knowledge/ingestion.ts`, `validerSource`, est un validateur pur : il vérifie notamment catégorie, provenance, empreinte, approbation et revue et refuse une fixture ; il ne fait pas lui-même l'écriture ou l'activation. Les extracteurs réels, l'OCR, les sources présentes et la couverture en base restent à vérifier.

`src/server/alexa/knowledge-adapter.ts`, `dependancesReadKnowledge` et `readKnowledge` :

1. Choisit une recette figée ; l'accès vectoriel dépend du drapeau explicite et d'une recette connue ; `mmarco` est opt-in.
2. `planKnowledgeQuery` construit le plan de recherche. Si aucun plan n'est possible, le résultat est `sans-preuve`.
3. Démarre l'embedding de la question en parallèle des appels lexicaux quand le vecteur est activé ; jusqu'à quatre appels lexicaux simultanés via `mapLimite` et `search_knowledge_lexical`.
4. Valide et filtre les lignes ; certains titres, index, bibliographies et tableaux sont refusés selon la question. Un passage de plus de 8 192 octets UTF-8 est omis en entier dans ce chemin.
5. Si les dépendances le permettent, cherche les candidats vectoriels et combine les résultats ; la trace distingue la configuration, les appels, lignes, erreurs et repli. Le fonctionnement exact de toutes les recettes et leur état en production restent à mesurer.

`src/server/alexa/knowledge-synthesis.ts`, `synthesizeKnowledge`, applique plusieurs contrôles : preuve, forme de langue, citation, nombres, contenu non sûr et couverture. Le code publie des citations autorisées plutôt que la prose brute du modèle. Une erreur ou absence de preuve peut produire une réponse limitée ou un repli extractif. Les contrôles ne prouvent pas à eux seuls que les passages choisis répondent correctement à une question médicale, ou que la traduction FR/EN préserve le sens.

**Expériences nécessaires :** mêmes questions et même corpus approuvé, exécuter lexical seul puis recettes vectorielles disponibles, avec et sans reranker ; conserver identifiants de preuves, rappel@K et qualité par langue, passage rejeté et motif de repli, durée de chaque étape. Ne pas changer de recette de production pendant ces essais. Utiliser des questions synthétiques et ne pas exporter de contenu patient.

## 4. Voix locale : entrée observée

`src/app/api/jarvis/jarvis-voice-in/route.ts`, `POST`, vérifie même origine, droit d'accès à l'IA clinique, identité, configuration vocale, taille, schéma et session. L'entrée est un PCM 16 kHz en base64 lié à `runId` et `utteranceId` ; `demanderVoixNative` envoie le travail au moteur résident local avec signal d'annulation. Les erreurs sont classées en configuration, silence/confiance, volume ou indisponibilité. `src/server/voice/modeles.ts` épingle les artefacts de reconnaissance `faster-whisper-small-int8`, de synthèse Kokoro et l'actif de réveil Vosk ; les fonctions de vérification contrôlent taille et empreinte pour les artefacts concernés.

L'intégralité du cycle audio, le flux TTS, les interruptions réelles, les chemins de calcul et la qualité FR/arabe/darija ne sont pas encore tracés ni mesurés. Les noms de modèle dans une constante ne démontrent pas la présence ni l'exécution des actifs sur le poste installé.

## 5. Priorités d'exploration

1. Tracer chaque écran jusqu'à son service et à la dernière définition SQL, y compris autorisations et statut des migrations.
2. Construire un tableau capacité application → outil Alexa → porte → champs → rôle → tests, et noter les absences au lieu de les déduire.
3. Reconstituer le pipeline réel de préparation des livres sans charger les corpus interdits par le manifeste ; identifier les expériences nécessitant une décision sur cette restriction.
4. Établir des mesures reproductibles sur une base explicitement synthétique, puis écrire la conception et le handoff seulement à partir des preuves obtenues.
