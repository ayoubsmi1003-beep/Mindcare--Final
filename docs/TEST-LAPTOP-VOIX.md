# Tester Alexa voix sur le laptop (micro) — 2026-10-25

But : récupérer ce dépôt sur le laptop et tester la voix complète :
mot de réveil « Alexa », réponse MiniCPM locale, transcription Whisper,
synthèse Piper/Cloud, lecture automatique des réponses.

## 1. Récupérer le dépôt

```powershell
git clone https://github.com/ayoubsmi1003-beep/Mindcare--Final.git
cd Mindcare--Final
git checkout v7-design
git lfs pull   # OBLIGATOIRE : Whisper (~148 Mo) + Piper FR/AR (~63 Mo x2)
```

Sans `git lfs pull`, `resources/voix/assets/` est vide et la voix locale
refuse de démarrer (`configuration: assets`) — c'est un garde-fou, pas une panne.

## 2. Installer

```powershell
pnpm install   # postinstall : runtime openWakeWord -> public/wakeword/ort/
node scripts/sync-wakeword-runtime.mjs   # repli si postinstall sauté
node scripts/preparer-voix-native.mjs --check   # vérifie SHA-256 du bundle
```

Modèles épinglés (ne jamais remplacer sans décision humaine) :
- Raisonnement : `MiniCPM-V-4_7-1B-Q4_K_M.gguf` (`src/server/alexa/model-policy.ts`)
- STT local : `ggml-base.bin` (Whisper, `resources/voix/assets/`)
- TTS local : `fr_FR-siwis-medium.onnx` + `ar_JO-kareem-low.onnx` (Piper)
- Réveil : openWakeWord `alexa` (`public/wakeword/`, régénéré par postinstall)
- Référence : `docs/RUNTIME-CONFIGURATION.md` (SHA-256, recettes)

## 3. Configurer (serveur uniquement, jamais `NEXT_PUBLIC_*`)

Ne copiez JAMAIS le `.env` du poste principal. Sur le laptop, base locale
vide ou jetable + clés personnelles uniquement :

```powershell
$env:MINDCARE_DATABASE_URL="postgres://..."
$env:ALEXA_LOCAL_VOICE="true"
$env:ALEXA_NATIVE_AGENT_ENABLED="1"
```

`ALEXA_LOCAL_VOICE=true` est aussi le défaut du code : l'omettre garde la
voix locale active. Détails : `.env.example`, `docs/RUNTIME-CONFIGURATION.md`.

## 4. Lancer et tester au micro

```powershell
pnpm dev
# ouvrir http://localhost:3000/jarvis
```

1. Autoriser le micro (icône navigateur) — sans geste, le navigateur bloque l'audio.
2. Cliquer **« Parler à Alexa »** : parler, faire une pause → transcription → réponse.
3. Cliquer **« Mains-libres »** : dire « Alexa » → accusé « Oui docteur… » →
   parler → envoi instantané → réponse lue à voix haute.
4. **Lecture automatique** : chaque réponse texte se lit seule (bouton
   « Couper la lecture automatique » en haut du fil pour muet persistant).
   Les réponses nommant un dossier ne sont JAMAIS lues via le cloud
   (bouton lecture par bulle = synthèse locale/refus, règle 18-07).
5. Nouvelle demande ou **Stop** coupe la lecture en cours.

## 5. Pannes connues (pas des bugs)

| Symptôme | Cause | Action |
|---|---|---|
| `configuration: assets/hash` | LFS non tiré | `git lfs pull` |
| Orbe « voix locale indisponible » | `ALEXA_VOICE_*` faux chemin | chemins absolus, lettre de lecteur, pas réseau |
| `lectureBloquee` / silence après clic | autoplay sans geste | cliquer une fois dans la page d'abord |
| Transcription vide | micro pris par une autre app | fermer l'autre app, réarmer |
| 15 min sans voix → arrêt | économie micro, normal | réactiver Mains-libres |

Aucune donnée patient réelle sur le laptop : base jetable uniquement
(voir `AGENTS.md` §9). Micro : témoin orbe + interrupteur OFF toujours visible.
