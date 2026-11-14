# Voix : parcours, limites et mesures nécessaires

**Statut : reconstruction statique ; microphone, locutrices, environnement sonore et performances NON TESTÉS.** Les limites de code ci-dessous ne sont pas des temps de réponse mesurés.

## Deux chemins identifiés

1. `src/services/alexa-local.ts` branche `creerBoucleVoixLocale` (`src/shared/alexa/voice-loop.ts`) sur capture locale, STT, `envoyerTourAlexa` et TTS. `SaisieJarvis.tsx` et `SaisieAlexaLune.tsx` exposent la bascule ; `BootVoix.tsx` et les abonnements d'identité contribuent à arrêter la boucle lors des changements de contexte.
2. `src/services/voix-mains-libres.ts`, `demarrerMainsLibres`, utilise le détecteur de réveil et `src/services/jarvis-reveil.ts`, puis `conversation.envoyer`. `src/services/endpointage-voix.ts` fournit une autre logique d'énergie pour le chemin de réveil. L'existence de deux chemins ne prouve pas qu'ils soient identiques, ni qu'un des deux soit mort ; les tester séparément.

## Capture, endpointage et interruption

Dans `voice-loop.ts`, la boucle directe conserve les trames en mémoire, considère une trame sonore à RMS ≥ 0,02, attend 60 ms pour démarrer et 700 ms de silence pour finir, exige 240 ms de parole et plafonne la capture à 20 s. À la nouvelle parole, `cut()` annule le travail et coupe l'audio ; des générations empêchent la publication d'un ancien tour. L'inactivité en écoute est bornée à 15 minutes, avec suspension du minuteur pendant un tour. Un délai global de 600 s borne le tour direct. Ces seuils ne prouvent pas leur adéquation à un vrai cabinet.

Le module `endpointage-voix.ts` du parcours de réveil utilise une autre combinaison : RMS 0,02, parole minimale 400 ms, silence 1 200 ms, plafond 15 s et attente initiale de 3 s par défaut. L'écart entre parcours est un fait de code ; son impact sur une locutrice algérienne est à mesurer, pas à supposer.

## STT et TTS

Les deux services de capture examinés (`src/services/alexa-local.ts` et `src/services/jarvis-voix.ts`) envoient `langue: 'fr'` à `/api/jarvis/jarvis-voice-in`, alors que le schéma de route accepte `fr`, `ar` et `auto`. **Limite confirmée du chemin client :** ces points d'entrée ne demandent pas le mode arabe ou automatique. Cela ne prouve pas que tous les mots arabes sont systématiquement mal reconnus ; mesurer sur des enregistrements consentis.

La synthèse `/api/jarvis/jarvis-voice-out` utilise Kokoro local `ff_siwis` et rejette les segments identifiés comme arabes. Le texte peut rester disponible à l'écran selon le chemin ; le résultat vocal arabe naturel n'est pas qualifié. Les actifs sont contrôlés par taille/empreinte avant le démarrage du travailleur (`src/server/voice/modeles.ts`, `runtime.ts`).

`runtime.ts` borne l'attente de préparation du worker à 180 s, la STT à 60 s et la TTS à 120 s. Ces plafonds ne sont ni des moyennes ni des garanties de réactivité.

## Diffusion de la réponse

Le protocole local utilise `stream: false` (`local-model-protocol.ts`). `envoyerTourAlexa` assemble les événements reçus et appelle son callback avec le texte combiné ; dans la boucle vocale directe, `ports.repondre` est appelé avec un callback de phrase vide, et le découpage pour la parole intervient après le résultat final. Les étapes et la progression peuvent être signalées plus tôt, mais ce chemin ne prouve pas une parole progressive pendant la génération. Ne pas publier des fragments non validés pour masquer cette attente.

## Mesures à effectuer

Sur le matériel réellement visé et avec consentement : corpus équilibré FR, arabe, darija et phrases mixtes, noms et termes médicaux fictifs, bruit de cabinet, interruptions et silences longs. Mesurer séparément erreur de mots et d'entités médicales, faux réveils, coupures, capture→transcription, transcription→premier résultat validé, outils/RAG, synthèse→premier son et réponse complète. Rapporter froid/chaud, p50/p95/p99, échantillons, échecs et annulations. Comparer les deux chemins et les modes STT possibles en environnement synthétique avant tout changement de réglage ; aucune métrique n'a été produite dans cet audit.

**Tests ciblés : PASS**, 54 tests dans sept fichiers de voix et de résultat d'action, dont `alexa-voice-rearm`, `alexa-voice-conversation`, `voice-endpointage` et `alexa-native-voice-routes`. Le détecteur est simulé dans plusieurs cas ; ces tests ne constituent pas une mesure sur voix humaine ou matériel réel.
