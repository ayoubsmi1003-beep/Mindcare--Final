# Tester Alexa voix sur le laptop (micro) — 2026-10-25

But : tester la chaîne vocale **entièrement locale** : transcription Whisper
large-v3-turbo, lecture Kokoro `ff_siwis`, mot de réveil Vosk « Alexa ».
Aucun Gemini, Groq, ElevenLabs ou service cloud n'est utilisé pour la voix.

## 1. Récupérer le dépôt

```powershell
git clone https://github.com/ayoubsmi1003-beep/Mindcare--Final.git
cd Mindcare--Final
git checkout codex/voice-kokoro-large-v3-turbo
git lfs pull   # modèles Whisper/Kokoro/Vosk si le dépôt les stocke en LFS
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

- STT : `ggml-large-v3-turbo-q5_0.bin` (574 041 195 o)
- TTS : `kokoro-v1.0.fp16.onnx` + `voices-v1.0.bin`, voix `ff_siwis`
- Réveil : `vosk-model-small-fr-0.22` (Apache-2.0)
- Runtime : CPython 3.12.14 embarqué, `pywhispercpp 1.5.1`, `kokoro-onnx 0.6.1`,
  `vosk 0.3.45`

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
2. Cliquer **« Parler à Alexa »** : la première préparation peut prendre
   plusieurs minutes sur un CPU lent (chargement du grand modèle + test réel).
3. Parler, faire une pause → transcription locale → réponse Kokoro.
4. Cliquer **« Mains-libres »** : dire « Alexa » → Vosk détecte → capture →
   Whisper → réponse Kokoro.
5. Le bouton de lecture reste explicite ; les réponses sont lues à voix haute
   par défaut.

## 5. Pannes connues

| Symptôme | Cause | Action |
|---|---|---|
| Préparation très longue | grand modèle sur CPU lent | attendre ; ne pas cliquer plusieurs fois |
| `configuration: modele` | modèle absent/corrompu | `node scripts/preparer-voix-native.mjs --repair` puis vérifier |
| `La voix locale est indisponible` | worker non initialisé, chemin packaged ou asset invalide | consulter `jarvis-voice-session` action `status` et les logs locaux |
| Le mot de réveil ne part pas | micro refusé/débranché, Vosk absent | vérifier la confidentialité Windows, le statut Mains-libres, relancer |
| Réponse arabe non lue | Kokoro v1.0 n'a pas de voix arabe | le texte reste affiché ; aucune voix française ne doit lire l'arabe |

Aucune transcription ni audio patient n'est journalisé. Base jetable
uniquement sur le laptop (AGENTS.md §9).
