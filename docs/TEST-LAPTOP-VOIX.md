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

Les modèles peuvent aussi être préparés avec :

```powershell
node scripts/preparer-voix-native.mjs --repair
```

Cette commande vérifie les tailles et SHA-256 avant d'activer un fichier. Un
téléchargement interrompu reste en `.part` et n'est jamais considéré comme
installé.

## 2. Installer

```powershell
pnpm install
node scripts/preparer-voix-native.mjs --check
node scripts/verifier-voix-locale.mjs
```

Modèles actifs :

- STT : `faster-whisper-small/` (CTranslate2 `int8`) — `model.bin` 483 546 902 o,
  `config.json` 2 370 o, `tokenizer.json` 2 203 239 o, `vocabulary.txt` 459 861 o
- TTS : `kokoro-v1.0.fp16.onnx` (163 527 961 o) + `voices-v1.0.bin`
  (28 214 398 o), voix `ff_siwis`
- Réveil : `vosk-model-small-fr-0.22` (Apache-2.0)
- Runtime : CPython 3.12.14 embarqué, `faster-whisper 1.2.1`, `ctranslate2 4.8.4`,
  `av 19.0.2`, `tokenizers 0.23.3`, `huggingface-hub 2.3.0`,
  `onnxruntime 1.30.0`, `kokoro-onnx 0.6.1`, `vosk 0.3.45`

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

1. Autoriser le micro.
2. Cliquer **« Parler à Alexa »**. La première préparation à froid charge le
   modèle : compter environ 40 s sur le laptop, et 80–120 s pour le premier
   essai réel complet. Les démarrages suivants sont plus courts.
3. Parler, faire une pause → transcription locale → réponse Kokoro.
4. **Suivi à 8 s** : enchaîner immédiatement une seconde question. La première
   phrase audio de la réponse doit démarrer en **8 s ou moins** ; mesurer le
   délai avec un chronomètre, pas à l'impression. Si le seuil est dépassé,
   noter le temps observé sans le présenter comme qualifié.
5. Cliquer **« Mains-libres »** : dire « Alexa » → Vosk détecte → capture →
   faster-whisper → réponse Kokoro.
6. Le bouton de lecture reste explicite ; les réponses sont lues à voix haute
   par défaut.

## 5. Pannes connues

| Symptôme | Cause | Action |
|---|---|---|
| Première préparation longue | chargement à froid du modèle sur CPU | attendre ; ne pas cliquer plusieurs fois |
| `configuration: modele` | modèle absent/corrompu | `node scripts/preparer-voix-native.mjs --repair` puis vérifier |
| `La voix locale est indisponible` | worker non initialisé, chemin packaged ou asset invalide | consulter `jarvis-voice-session` action `status` et les logs locaux |
| Le mot de réveil ne part pas | micro refusé/débranché, Vosk absent | vérifier la confidentialité Windows, le statut Mains-libres, relancer |
| Réponse arabe non lue | Kokoro v1.0 n'a pas de voix arabe | le texte reste affiché ; aucune voix française ne doit lire l'arabe |
| Première phrase > 8 s | modèle froid ou machine chargée | refaire un tour chaud ; si le dépassement persiste, le consigner comme échec de qualification |

Aucune transcription ni audio patient n'est journalisé. Base jetable
uniquement sur le laptop (AGENTS.md §9).
