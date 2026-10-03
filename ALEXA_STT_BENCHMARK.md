# Alexa 2.0 — benchmark voix

**NOT RUN : aucun corpus audio naturel de qualification fourni ; poste de la praticienne non mesuré.** Les tests du scoreur ne prouvent pas la qualité acoustique.

Le 2 octobre, l'utilisateur confirme ne pas avoir de microphone. Aucun résultat acoustique ne peut être présenté comme « parfait ». Réveil implémenté : clic puis conversation continue VAD, sans ouverture automatique ou écoute de mot-clé.

Cible : i7 quatrième génération, 16 Go, CPU ; aucun GPU présumé. Le 1 octobre 2026, l'utilisateur confirme que le poste courant est un i3 quatrième génération avec 8 Go, et que le poste de la praticienne est l'i7/16 Go cible. Ces caractéristiques déclarées ne sont pas des mesures de performance. Le poste courant ne remplace pas la qualification sur le poste de la praticienne.

Corpus :240 phrases naturelles +60 silence/bruit/ambiguïté, plusieurs locuteurs ; FR/AR/Darija/mixte ; médicaments et noms artificiels ; jeux de réglage et qualification distincts. JSONL documenté dans le script : `id,synthetic:true,language,kind,reference,audio,medicationNames?,patientNames?`. Les WAV de référence sont mono16kHz PCM16, restent locaux, ne sont jamais téléchargés pendant une consultation.

Commandes :

```powershell
node scripts/benchmark-alexa-voice.mjs --corpus C:\corpus\qualification.jsonl --runtime resources/voix --out C:\evaluations\whisper-base.json
node scripts/benchmark-alexa-voice.mjs --corpus C:\corpus\qualification.jsonl --results C:\evaluations\mesures-small.json --out C:\evaluations\score-small.json
```

Le runner natif vérifie les empreintes des ressources et mesure le moteur installé. Le mode `--results` calcule les scores de transcriptions déjà mesurées ; il ne prouve pas leur origine ni une chaîne audio réelle. Les rapports n'incluent pas les transcriptions ni noms.

| Mesure | Seuil de qualification | Résultat |
|---|---|---|
|WER FR / AR / Darija-mixte|12% /18% /25% maximum|NOT RUN|
|Noms médicaments|98% minimum|NOT RUN|
|Sélection erronée/silence halluciné|0|NOT RUN|
|STT final P95|2.5s maximum|NOT RUN|
|Première phrase audio P95|8s maximum|NOT RUN|
|Interruption P95|200ms maximum|NOT RUN|
|Naturel TTS médian|4/5 minimum|NOT RUN|
|RAM moteurs cumulés|4Go maximum|NOT RUN|

Whisper.cpp base et Piper existants sont disponibles, sans statut de gagnant. Faster-whisper int8, Whisper officiel base/small, modèle Darija Hadra et Chatterbox Multilingual restent à installer dans un environnement de benchmark après vérification des licences moteur/poids, puis à comparer sur le même jeu tenu à part. Aucune qualification Darija parfaite annoncée.

Smoke des véritables moteurs épinglés sur i3-4150 / 7,864 Gio : Piper français/arabe → resampling RAM → Whisper local PASS pour présence de transcription ; silence numérique rejeté PASS. Français : premier TTS 12,252s avec démarrage (moteur 6,203s), STT 4,281s. Arabe : TTS 4,884s, STT 3,687s. Mesures uniques de parole synthétisée, pas WER/CER, P95, naturel vocal ou preuve microphone. Aucun audio/transcript enregistré. Trace locale : `.cache/alexa/voice-engine-smoke.json`.

Les tests de cycle de capture reproduisent puis corrigent la rétention de ressources pendant une préparation annulée : arrêt immédiat des pistes/contexte, aucune installation après permission/module tardifs. Ils prouvent le contrat de nettoyage, pas la latence matérielle de barge-in ni la reconnaissance de la darija.
