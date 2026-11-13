# Tester Alexa voix sur le laptop (micro) — 2026-10-27

But : tester la chaîne vocale **entièrement locale** : transcription faster-whisper
small `int8`, lecture Kokoro `ff_siwis`, mot de réveil Vosk « Alexa ». Aucun
Gemini, Groq, ElevenLabs ou service cloud n'est utilisé pour la voix.

## 1. Récupérer le dépôt

```powershell
git clone https://github.com/ayoubsmi1003-beep/Mindcare--Final.git
cd Mindcare--Final
git checkout v8-alexa-final
git lfs pull   # faster-whisper small, Kokoro et Vosk sont stockés en LFS
```

Les modèles et les paquets Python peuvent ensuite être préparés avec :

```powershell
pnpm voix:preparer
```

Cette commande (`node scripts/preparer-voix-native.mjs --repair --packages`)
vérifie les tailles et SHA-256 avant d'activer un fichier, répare/télécharge les
modèles, puis installe les roues épinglées dans `resources/voix/packages/` avec
l'interpréteur embarqué. Un téléchargement interrompu reste en `.part` et n'est
jamais considéré comme installé.

**Prérequis : le runtime Python embarqué doit déjà être provisionné.**
`pnpm voix:preparer` n'installe **pas** l'interpréteur et ne le crée pas :
`resources/voix/python/python.exe` (CPython 3.12.14, avec ses DLL et sa
bibliothèque standard) doit être présent **avant** la commande. Sans lui, la
commande s'arrête sur :

```text
runtime Python absent : resources/voix/python/python.exe
```

`resources/voix/python/` et `resources/voix/packages/` sont **git-ignorés** : un
clone neuf ne les contient pas. Copiez le runtime embarqué depuis le bundle de
build (ou provisionnez l'interpréteur embarqué), puis lancez
`pnpm voix:preparer` pour installer les paquets. `--packages` reste la seule
étape qui écrit `resources/voix/packages/` ; `--check` ne modifie rien et ne va
pas sur le réseau.

## 2. Installer et vérifier

```powershell
pnpm install
node scripts/preparer-voix-native.mjs --check
node scripts/verifier-voix-locale.mjs
```

Preuve automatisée en **une commande**, sans microphone et sans base :

```powershell
pnpm voix:preuve
```

Elle exécute, dans l'ordre, `preparer-voix-native.mjs --check`,
`verifier-voix-locale.mjs --json`, le test réel faster-whisper/Kokoro
(`tests/integration/alexa-voice-final.test.ts`) et le test réel Vosk
(`tests/integration/alexa-wake-real.test.ts`, 5 cycles + variantes + négatif
« Bonjour » + JSON invalide). La base est une URL synthétique injoignable :
aucune connexion, migration ou écriture cabinet. Le rapport est écrit dans
`artifacts/voix-finale.json` (git-ignoré). Attendu :

```json
{"verdict":"PASS","stt":"faster-whisper-small-int8","tts":"kokoro-82m-v1.0-ff_siwis","wake":"vosk-fr-FR-small","repeatCycles":5}
```

Modèles actifs :

- STT : `faster-whisper-small/` (CTranslate2 `int8`) — `model.bin` 483 546 902 o,
  `config.json` 2 370 o, `tokenizer.json` 2 203 239 o, `vocabulary.txt` 459 861 o ;
  identifiant runtime `faster-whisper-small-int8`
- TTS : `kokoro-v1.0.fp16.onnx` (163 527 961 o) + `voices-v1.0.bin`
  (28 214 398 o), voix `ff_siwis` ; identifiant runtime
  `kokoro-82m-v1.0-ff_siwis`
- Réveil : `vosk-model-small-fr-0.22` (Apache-2.0) ; identifiant runtime
  `vosk-fr-FR-small`
- Runtime : CPython 3.12.14 embarqué, `faster-whisper 1.2.1`, `ctranslate2 4.8.4`,
  `av 19.0.2`, `tokenizers 0.23.3`, `huggingface-hub 2.3.0`,
  `onnxruntime 1.30.0`, `kokoro-onnx 0.6.1`, `vosk 0.3.45`

Budget runtime côté worker : **180 s** pour être prêt (chargement à froid),
puis **60 s** par transcription et **120 s** par synthèse. Le test d'intégration
réel est borné à 240 s, sous le timeout Vitest de 300 s ; la mesure de référence
à priorité normale est 208,9 s (~31 s de marge). Sur un PC lent, laisser la
commande aller au bout sans changer la priorité du processus.

Les empreintes exactes sont dans `resources/voix/manifest.json` et
`resources/voix/inventory.json`.

## 3. Configurer (serveur uniquement, aucun secret voix)

```powershell
$env:ALEXA_LOCAL_VOICE="true"
$env:MINDCARE_DATABASE_URL="postgres://..."   # base jetable uniquement
```

Ne copiez jamais le `.env` du poste principal. Aucune clé voix n'est requise.

## 4. Lancer et tester au micro

```powershell
pnpm dev
# http://localhost:3000/jarvis
```

La première préparation à froid charge le modèle : compter environ 40 s mesuré
sur le PC de développement i3 ; à revalider sur le laptop, ainsi que 80–120 s
pour le premier essai réel complet. Les démarrages suivants sont plus courts.

Comportement à vérifier (refonte voix du 2026-11-12) :

- **« Alexa » ouvre une conversation.** L'accusé « Oui Docteur, je vous
  écoute. » est joué **depuis un cache** (synthétisé une fois à l'armement du
  mains-libres) : il doit partir sans délai perceptible. Le micro est déjà
  ouvert ; on peut parler par-dessus l'accusé, il s'arrête.
- **Texte en direct.** Pendant qu'on parle, une bulle provisoire (pointillés,
  italique) affiche les mots reconnus (Vosk, en flux). À la pause, elle est
  remplacée par le texte final (Faster-Whisper) ; les mots ne doivent ni se
  dupliquer ni disparaître.
- **Toute réponse est dite par Kokoro**, qu'elle ait été dite ou **tapée**,
  phrase par phrase (la suivante se synthétise pendant que la première joue).
- **STOP.** Un bouton « Arrêter la voix d'Alexa » est visible **exactement**
  pendant que le son sort (panneau ouvert : sous la saisie ; fermé : au-dessus
  du lanceur). Un clic coupe tout ; le texte de la réponse reste affiché.
- **Relance sans clic.** Après la réponse, la conversation écoute de nouveau ;
  « Et les doses ? » est pris sans redire « Alexa ». Après **20 s** sans parole,
  retour en veille du mot de réveil.
- **Interruption à la voix (barge-in).** Parler nettement pendant une réponse
  la coupe et capture la nouvelle question. La voix d'Alexa seule (écho du
  haut-parleur) ne doit **jamais** la couper ni déclencher une question.
- **Veille permanente.** Le mains-libres ne s'éteint plus après 15 min : il
  reste armé jusqu'à ce qu'on le coupe.
- **Diagnostic des latences** : dans la console développeur,
  `window.__mindcareVoiceTraces.rapport()` donne P50/P95/max par étape
  (premiers mots, texte final, Alexa, premier son Kokoro, interruption).
  Aucun texte n'y figure.

### Premier test réel au micro — checklist 12 étapes — statut : **NOT RUN**

Aucun microphone n'est disponible sur ce PC de développement : cette checklist
n'a **pas** été exécutée et ne doit jamais être présentée comme PASS. Faire
d'abord le test **au casque** (aucun écho possible), puis **sur haut-parleurs**.

| # | Étape | Attendu | Statut |
|---|---|---|---|
| 1 | Démarrer l'app, se connecter, cliquer **Mains-libres**, autoriser le micro ; attendre ~1 min | Statut « Mains-libres en veille » | **NOT RUN** |
| 2 | Dire « Alexa » | Accusé immédiat (< 0,5 s ressenti), état « Oui Docteur… » puis « Je vous écoute » | **NOT RUN** |
| 3 | Dire « Quels sont les rendez-vous de demain ? » lentement | Mots visibles **pendant** la phrase ; bulle finale juste ; aucun doublon | **NOT RUN** |
| 4 | Écouter la réponse | Kokoro la lit ; STOP visible pendant le son seulement | **NOT RUN** |
| 5 | Juste après, dire « Et les doses ? » sans « Alexa » | Capturée, réponse dans le même contexte | **NOT RUN** |
| 6 | Poser une question longue, cliquer STOP au milieu de la réponse | Silence immédiat, texte complet visible, retour à l'écoute | **NOT RUN** |
| 7 | Pendant une longue réponse, parler fort et nettement | La réponse se coupe, la nouvelle question est prise | **NOT RUN** |
| 8 | **Sur haut-parleurs**, laisser une longue réponse aller au bout sans parler | Aucune auto-interruption, aucune question fantôme | **NOT RUN** |
| 9 | Rester 20 s silencieuse | Retour en veille ; « Alexa » fonctionne de nouveau | **NOT RUN** |
| 10 | Taper une question dans le panneau | Réponse affichée **et** lue | **NOT RUN** |
| 11 | Débrancher puis rebrancher le micro | Erreur visible, puis réarmement | **NOT RUN** |
| 12 | Une heure plus tard, sans avoir touché l'app : « Alexa » | Répond toujours | **NOT RUN** |
| 13 | Consultation : ouvrir un dossier, cliquer le micro d'un champ de note, dicter **plus de 30 s** puis arrêter | Texte complet inséré au curseur, dans l'ordre, sans écraser l'existant | **NOT RUN** |
| 14 | Consultation : première dictée juste après l'ouverture de l'écran | Pas d'attente de chargement du modèle (Whisper préparé à l'ouverture) | **NOT RUN** |

Relever ensuite `window.__mindcareVoiceTraces.rapport()` et le consigner dans
`ALEXA_STT_BENCHMARK.md`. Si l'étape 8 échoue (écho qui coupe Alexa), noter
le type de haut-parleur : le seuil d'interruption (2,5× l'écho) est le premier
réglage à calibrer, dans `src/shared/alexa/voice-loop.ts`.

État de la preuve : `pnpm voix:preuve` et
`tests/integration/alexa-voice-pipeline-real.test.ts` (moteurs réels, micro et
haut-parleur simulés) ne remplacent pas cette réception. L'installateur
final sera produit plus tard ; l'artefact de build actuel est une preuve non
signée, pas une release.

## 5. Pannes connues

| Symptôme | Cause | Action |
|---|---|---|
| `runtime Python absent` | `resources/voix/python/python.exe` non provisionné | copier/provisionner le runtime embarqué, puis `pnpm voix:preparer` |
| Première préparation longue | chargement à froid du modèle sur CPU | attendre ; ne pas cliquer plusieurs fois |
| `configuration: modele` | modèle absent/corrompu | `pnpm voix:preparer` puis vérifier |
| `La voix locale est indisponible` | worker non initialisé, chemin packaged ou asset invalide | consulter `jarvis-voice-session` action `status` et les logs locaux |
| Le mot de réveil ne part pas | micro refusé/débranché, Vosk absent | vérifier la confidentialité Windows, le statut Mains-libres, relancer |
| Réponse arabe non lue | Kokoro v1.0 n'a pas de voix arabe | le texte reste affiché ; aucune voix française ne doit lire l'arabe |
| Première phrase > 8 s | modèle froid ou machine chargée | refaire un tour chaud ; si le dépassement persiste, le consigner comme échec de qualification |

Aucune transcription ni audio patient n'est journalisé. Base jetable
uniquement sur le laptop (AGENTS.md §9).

## 6. Journal de qualification

| Date | Poste | Résultat | Preuve / raison |
|---|---|---|---|
| 2026-10-27 | PC de développement i3-4150 / 8 Go | **NOT RUN** | Checklist 10 étapes non exécutée : aucun microphone disponible ici. La preuve `pnpm voix:preuve` (STT/TTS/Vosk, sans micro) est PASS et ne remplace pas cette réception. |
