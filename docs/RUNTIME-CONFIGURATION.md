# MindCare — configuration locale de référence

État du code vérifié le 21 octobre 2026. Ce document contient des pointeurs, jamais des secrets. Les observations d’installation plus anciennes ne prouvent pas l’état actuel du poste.

Sur le PC de développement, les identifiants existants se trouvent dans `G:\Final mindcare\.env`. Charger explicitement ses variables côté serveur sans afficher son contenu. Ne jamais rechercher de clés dans les historiques, les captures, le navigateur ou les sources.

La configuration de développement désigne la base du cabinet `127.0.0.1:55441/mindcare`. Ne pas la remplacer, la réinitialiser ni y injecter des fixtures. Aucune base Alexa d’évaluation n’est conservée comme environnement actif. Toute campagne future doit préparer une base jetable neuve et prouver sa séparation de la base du cabinet avant le premier accès en écriture. Le nettoyage du 21 octobre 2026 a supprimé l’unique patient de démonstration non relié à l’import historique et ses données liées ; les 1 558 identités reliées à l’import ont été conservées. Les deux profils actifs restent le praticien et l’assistant. Ne pas créer d’historique, de note, de traitement ou de rendez-vous clinique pour combler des données absentes.

| Usage Alexa | Définition dans `src/server/alexa/model-policy.ts` |
|---|---|
| Raisonnement et orchestration texte | `ALEXA_CONVERSATION_MODEL = MiniCPM-V-4_7-1B-Q4_K_M.gguf`, local uniquement |
| Transcription | `ALEXA_STT_MODEL = gemini-3.5-transcribe` |
| Synthèse vocale | `ALEXA_TTS_MODEL = gemini-3.8-flash-tts`, voix `Kore` |
| Transport Live historique | `ALEXA_LIVE_MODEL = gemini-3.8-live` |

MiniCPM-V 4.7 1B utilise des poids GGUF Q4_K_M épinglés par SHA-256, llama.cpp `b11429`, une seule inférence à la fois et un contexte de 4 096 tokens. Le chemin de cache historique `.cache/alexa/minicpm` est conservé pour compatibilité ; le modèle sélectionné vient de `src/server/alexa/model-policy.ts`. Les modules serveur d’un même processus partagent le processus local et son authentification. Le nombre exact de tokens est vérifié avant génération. Une synthèse trop longue retire des champs entiers et signale la couverture partielle.

En développement uniquement, `ALEXA_LOCAL_MODEL_ROOT` peut désigner un cache sur SSD avec un chemin local absolu (lettre de lecteur obligatoire, aucun chemin réseau). Les mêmes ACL et SHA-256 restent vérifiés. Une application empaquetée ignore cette option et utilise toujours ses ressources installées protégées.

`ALEXA_NATIVE_AGENT_ENABLED=1` active la boucle native sur `/api/alexa/turn`. Une valeur différente conserve le parcours compatible précédent. Le contrôle de démarrage exige les migrations natives lorsque ce commutateur est activé. L’activation, les migrations et l’artefact installé doivent être vérifiés ensemble ; un test direct du modèle ne prouve pas l’activation du poste installé. Le commutateur est reconnu par la configuration serveur privée du paquet bureau.

Le paramètre historique `ALEXA_DIRECT_MODEL = gemini-3.5-flash` demeure réservé aux parcours de qualification cloud existants. Il ne constitue pas un repli automatique pour le texte patient. Les anciennes variables de modèles et le pool gratuit ne remplacent pas les épingles de livraison. La qualification actuelle porte uniquement sur le français ; les connaissances générales restent hors acceptation à la demande de l’utilisateur.

**Modèle d’embedding BGE-M3 (connaissance).** Recette épinglée `r2-2026-09-16` : `BAAI/bge-m3`, révision `5617a9f61b028005a4858fdac845db406aefb181`, 1024 dimensions, cosinus, normalisation L2 native, exécution CPU locale, troncature 512 tokens. Les trois artefacts (`model.onnx` 724 923 o, `model.onnx_data` 2 266 820 608 o, `tokenizer.json` 17 082 821 o) sont vérifiés par SHA-256 avant tout usage ; le `tokenizer.json` doit provenir de `onnx/tokenizer.json` (variante ONNX), la variante racine du dépôt HuggingFace a un SHA différent et ne correspond pas à la recette. Le runtime cherche le modèle dans `MINDCARE_BGE_M3_DIR` (variable serveur, jamais `NEXT_PUBLIC_*`), puis dans `resources/models/bge-m3/<revision>/` (emplacement de paquetage, hors Git). En développement, le cache documenté par la recette est `%TEMP%\opencode\r2bench-hf\models--BAAI--bge-m3\snapshots\<revision>\onnx` ; les scripts de la connaissance le résolvent seuls. **Le modèle est absent par défaut** : son absence n’est pas une panne, le service bascule alors en lexical seul (`vecteurRequeteProduction` → `null`, repli nommé, jamais d’exception). Un premier chargement à froid coûte environ 17 s et ~1 Go de mémoire vive : le chemin de requête ne doit pas être traversé à froid dans un test à délai court.

La configuration privée du bureau est séparée : `%ProgramData%\MindCare\mindcare.env` pour la base et `%ProgramData%\MindCare\private\runtime.env` pour les paramètres serveur autorisés. Ces fichiers doivent garder leurs permissions protégées. Ne jamais y copier aveuglément une URL de développement. Une impossibilité de lecture depuis un compte non administrateur ne prouve pas l’absence d’un fichier. Toute mise à niveau conserve les données et l’historique du cabinet.

Les lectures patient restent auditées et soumises aux permissions en base. Les écritures métier suivent proposition, confirmation, exécution, vérification et audit. Le modèle local n’accorde aucun droit supplémentaire. Les données identifiantes restent locales ; Gemini voix conserve l’admission avant transport. La présence d’une clé ne prouve ni une autorisation d’export, ni un quota, ni la qualité de la voix naturelle.
