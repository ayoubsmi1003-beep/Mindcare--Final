# Alexa 2.0 — benchmark voix

## Mesures du 2026-11-12 — refonte voix (moteurs réels, parole SYNTHÉTIQUE)

Commande : `node scripts/mesure-voix-locale.mjs` (et `--reveil`). Poste : **i3-4150, 4 logiques, 7,9 Go**,
chargé à 40–90 % par d'autres processus pendant la mesure. Locuteurs : Kokoro `ff_siwis`, Kokoro +
bruit blanc 20 dB, Windows SAPI « Hortense » (débit -3 / 0 / +3). 7 questions × 5 locuteurs = 35
énoncés ; vérité terrain = texte source. **Ce n'est ni la voix de la praticienne, ni son i7.**

| Mesure | P50 | P95 | Max | Remarque |
|---|---:|---:|---:|---|
| Faster-Whisper small int8, texte final (2 threads) | 16 626 ms | 21 477 ms | 37 535 ms | fenêtre fixe de 30 s : le coût ne dépend presque pas de la durée de l'énoncé ; 2 ou 4 threads équivalents sur ce poste |
| WER Whisper (moyen) | 12,6 % | | | Kokoro 15,9 % · +bruit 19,7 % · SAPI 6,5 % · lent 5,0 % · rapide 16,1 % |
| Vosk, aperçu en flux, traitement d'un morceau de 200 ms | 98 ms | 1 345 ms | 2 998 ms | les pointes suivent la charge machine |
| Vosk, premiers mots visibles (position dans l'audio) | 1,2 s | 1,6 s | 2,0 s | dont 0,5 s de silence initial ajouté |
| WER aperçu Vosk | 9,5 % | | | aperçu seulement : jamais transmis à Alexa |
| Kokoro fp16, une phrase (premier son de la file) | 17 614 ms | 21 933 ms | 21 933 ms | WAV valides ; arabe refusé (`langue-non-supportee`) |
| Chargement à froid (en parallèle) | Vosk 9,6–26,6 s · Kokoro 36,7–61,2 s · Whisper 39,1–62,6 s | | | une fois par session, puis résidents |
| Silence numérique 2 s | refusé (`silence`) | | | |

Mot de réveil, worker Vosk réel, découpage 500 ms :

| Grammaire | Rappel | Faux réveils |
|---|---:|---:|
| avant (`alexa`, `alexia`, `eh lexa`) | 10 / 10 | **12 / 30** (« Alexandre », « à la caisse » à chaque fois, « Bonjour » 2×) |
| après (mêmes mots + leurres) | 14 / 15 | **0 / 40** |

Le seul raté après correction : « Alexa » Kokoro avec bruit 20 dB.

Interruption à la voix (barge-in), moteurs réels, haut-parleur simulé (fuite à 15 %) : la parole de la
praticienne coupe Alexa **~420 ms** après son début ; l'écho seul (jusqu'à 40 %, 8 s) ne la coupe jamais
(`tests/unit/alexa-barge-in-audio.test.ts`, `tests/integration/alexa-voice-pipeline-real.test.ts` F).
STOP : son coupé en < 50 ms (scénario E). Ces chiffres ne valent pas pour un vrai haut-parleur dans une
vraie pièce.

⚠️ Exécuter les suites réelles **une par une** (`--no-file-parallelism`) : en parallèle sur ce 2 cœurs,
trois processus Whisper/Kokoro se disputent le CPU et une transcription dépasse son délai de 60 s.

**Lecture honnête.** Les objectifs de la mission (aperçu ≤ 300 ms, texte final ≤ 800 ms) sont tenus
pour l'**aperçu** (≈ 100 ms par morceau, mots visibles pendant la phrase) et **pas** pour le **texte
final** ni pour la **première phrase Kokoro** sur ce poste : ~17 s chacun. Sur l'i7 4 cœurs / 8 logiques
au repos, un gain de 2 à 3× est plausible mais NON MESURÉ ; il ne suffirait pas à atteindre 800 ms avec
Whisper `small` ni ~1 s avec Kokoro `fp16`. Leviers identifiés, qui demandent un nouveau modèle (à
décider) : Whisper `base` int8 pour le texte final, Kokoro `int8`/`fp32` (hypothèse non mesurée : sur CPU,
onnxruntime exécute le fp16 en grande partie par conversions, ce qui le rend souvent plus lent que
le fp32).


**NOT RUN : aucun corpus audio naturel de qualification fourni ; poste de la praticienne non mesuré.** Les tests du scoreur ne prouvent pas la qualité acoustique.

Le 2 octobre, l'utilisateur confirme ne pas avoir de microphone. Aucun résultat acoustique ne peut être présenté comme « parfait ». Réveil implémenté : clic, conversation continue VAD, et détecteur Vosk local du mot « Alexa » en mains-libres.

Cible : i7 quatrième génération, 16 Go, CPU ; aucun GPU présumé. Le 1 octobre 2026, l'utilisateur confirme que le poste courant est un i3 quatrième génération avec 8 Go, et que le poste de la praticienne est l'i7/16 Go cible. Ces caractéristiques déclarées ne sont pas des mesures de performance. Le poste courant ne remplace pas la qualification sur le poste de la praticienne.

Corpus :240 phrases naturelles +60 silence/bruit/ambiguïté, plusieurs locuteurs ; FR/AR/Darija/mixte ; médicaments et noms artificiels ; jeux de réglage et qualification distincts. JSONL documenté dans le script : `id,synthetic:true,language,kind,reference,audio,medicationNames?,patientNames?`. Les WAV de référence sont mono16kHz PCM16, restent locaux, ne sont jamais téléchargés pendant une consultation.

Commandes :

```powershell
node scripts/benchmark-alexa-voice.mjs --corpus C:\corpus\qualification.jsonl --runtime resources/voix --out C:\evaluations\faster-whisper-small-int8.json
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

Le moteur installé et épinglé est **faster-whisper small CTranslate2 `int8`** (`resources/voix/assets/faster-whisper-small/`, `Systran/faster-whisper-small` révision `536b0662742c02347bc0e980a01041f333bce120`), exécuté par `scripts/benchmark-alexa-voice.mjs --runtime resources/voix`. Aucun autre moteur de transcription n'est livré. Whisper officiel small, modèle Darija Hadra et Chatterbox Multilingual restent à comparer dans un environnement de benchmark après vérification des licences moteur/poids, sur le même jeu tenu à part. Aucune qualification Darija parfaite annoncée.

Smoke historique du 2026-10-25 — **moteurs depuis retirés**, chiffres conservés pour la traçabilité — sur i3-4150 / 7,864 Gio : synthèse française/arabe → resampling RAM → STT local PASS pour présence de transcription ; silence numérique rejeté PASS. Français : premier TTS 12,252 s avec démarrage (moteur 6,203 s), STT 4,281 s. Arabe : TTS 4,884 s, STT 3,687 s. Mesures uniques de parole synthétisée, pas WER/CER, P95, naturel vocal ou preuve microphone. Aucun audio/transcript enregistré.

Les tests de cycle de capture reproduisent puis corrigent la rétention de ressources pendant une préparation annulée : arrêt immédiat des pistes/contexte, aucune installation après permission/module tardifs. Ils prouvent le contrat de nettoyage, pas la latence matérielle de barge-in ni la reconnaissance de la darija.
