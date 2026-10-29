# MindCare — configuration locale de référence

État du code vérifié le 21 octobre 2026. Ce document contient des pointeurs, jamais des secrets. Les observations d’installation plus anciennes ne prouvent pas l’état actuel du poste.

Sur le PC de développement, les identifiants existants se trouvent dans `G:\Final mindcare\.env`. Charger explicitement ses variables côté serveur sans afficher son contenu. Ne jamais rechercher de clés dans les historiques, les captures, le navigateur ou les sources.

La configuration de développement désigne la base du cabinet `127.0.0.1:55441/mindcare`. Ne pas la remplacer, la réinitialiser ni y injecter des fixtures. Aucune base Alexa d’évaluation n’est conservée comme environnement actif. Toute campagne future doit préparer une base jetable neuve et prouver sa séparation de la base du cabinet avant le premier accès en écriture. Le nettoyage du 21 octobre 2026 a supprimé l’unique patient de démonstration non relié à l’import historique et ses données liées ; les 1 558 identités reliées à l’import ont été conservées. Les deux profils actifs restent le praticien et l’assistant. Ne pas créer d’historique, de note, de traitement ou de rendez-vous clinique pour combler des données absentes.

Le pool serveur accepte l’option facultative `MINDCARE_DATABASE_CONNECT_TIMEOUT_MS`, entre 5 000 et 60 000 ms au démarrage ; une valeur absente ou invalide conserve 5 000 ms. Les lanceurs de la copie d’évaluation isolée positionnent 30 000 ms pour supporter la charge du modèle local sur un PC lent. Ils ne modifient ni `.env`, ni la configuration installée, ni la taille du pool ou les contrôles d’accès.

| Usage Alexa | Définition dans `src/server/alexa/model-policy.ts` |
|---|---|
| Raisonnement et orchestration texte | `ALEXA_CONVERSATION_MODEL = MiniCPM-V-4_7-1B-Q4_K_M.gguf`, local uniquement |
| Transcription | `ALEXA_STT_MODEL = faster-whisper-small-int8`, worker local faster-whisper small CTranslate2 `int8` uniquement |
| Synthèse vocale | `ALEXA_TTS_MODEL = kokoro-82m-v1.0-ff_siwis`, Kokoro local, voix française `ff_siwis` |
| Transport Live historique | retiré (`geminiLiveAutorise()` = `false`) |

Les modèles vocaux actifs et leurs empreintes sont dans
`resources/voix/manifest.json` (schéma 2, qui porte l'empreinte
`inventorySha256`) et `resources/voix/inventory.json`. Le worker local est décrit
dans `resources/voix/README.md` ; les dépendances Python sont épinglées dans
`resources/voix/requirements.txt`, installées dans `resources/voix/packages` par
`pnpm voix:preparer` et journalisées dans `resources/voix/lock.json`. Aucun
fournisseur vocal cloud, aucune clé Gemini/Groq/ElevenLabs et aucun repli
automatique ne sont utilisés pour la parole. Kokoro v1.0 ne fournit pas de voix
arabe : la synthèse arabe n'est pas revendiquée et reste du texte affiché.

MiniCPM est rétabli sur demande de l’utilisateur avec l’artefact exact de la campagne historique : SHA-256 `588c6c94c82f756b86dba35c42ed9ba9ec187d65824eb52f039c347df563e63d`, llama.cpp `b11429`. Les essais Llama 3.2 1B Q4 et Q8 n’ont pas validé la qualité clinique française et ne sont pas sélectionnés. Le cache `.cache/alexa/minicpm`, l’inférence locale sérialisée et le contexte de 4 096 tokens sont conservés ; le modèle actif vient de `src/server/alexa/model-policy.ts`. Les vérifications SHA-256, les permissions des fichiers et l’authentification locale restent actives. Le nombre exact de tokens est vérifié avant génération ; les résumés complets paginent les consultations et passent par des synthèses intermédiaires lorsque nécessaire. La réussite de la campagne historique ne remplace pas l’acceptation clinique réelle de la version actuelle.

En développement uniquement, `ALEXA_LOCAL_MODEL_ROOT` peut désigner un cache sur SSD avec un chemin local absolu (lettre de lecteur obligatoire, aucun chemin réseau). Les mêmes ACL et SHA-256 restent vérifiés. Une application empaquetée ignore cette option et utilise toujours ses ressources installées protégées.

`ALEXA_NATIVE_AGENT_ENABLED=1` active la boucle native sur `/api/alexa/turn`. Une valeur différente conserve le parcours compatible précédent. Le contrôle de démarrage exige les migrations natives lorsque ce commutateur est activé. L’activation, les migrations et l’artefact installé doivent être vérifiés ensemble ; un test direct du modèle ne prouve pas l’activation du poste installé. Le commutateur est reconnu par la configuration serveur privée du paquet bureau.

Le paramètre historique `ALEXA_DIRECT_MODEL = gemini-3.5-flash` demeure réservé aux parcours de qualification cloud existants. Il ne constitue pas un repli automatique pour le texte patient. Les anciennes variables de modèles et le pool gratuit ne remplacent pas les épingles de livraison. La qualification actuelle porte uniquement sur le français ; les connaissances générales restent hors acceptation à la demande de l’utilisateur.

**Modèle d’embedding BGE-M3 (connaissance).** Recette épinglée `r2-2026-09-16` : `BAAI/bge-m3`, révision `5617a9f61b028005a4858fdac845db406aefb181`, 1024 dimensions, cosinus, normalisation L2 native, exécution CPU locale, troncature 512 tokens. Les trois artefacts (`model.onnx` 724 923 o, `model.onnx_data` 2 266 820 608 o, `tokenizer.json` 17 082 821 o) sont vérifiés par SHA-256 avant tout usage ; le `tokenizer.json` doit provenir de `onnx/tokenizer.json` (variante ONNX), la variante racine du dépôt HuggingFace a un SHA différent et ne correspond pas à la recette. Le runtime cherche le modèle dans `MINDCARE_BGE_M3_DIR` (variable serveur, jamais `NEXT_PUBLIC_*`), puis dans `resources/models/bge-m3/<revision>/` (emplacement de paquetage, hors Git). En développement, le cache documenté par la recette est `%TEMP%\opencode\r2bench-hf\models--BAAI--bge-m3\snapshots\<revision>\onnx` ; les scripts de la connaissance le résolvent seuls. **Le modèle est absent par défaut** : son absence n’est pas une panne, le service bascule alors en lexical seul (`vecteurRequeteProduction` → `null`, repli nommé, jamais d’exception). Un premier chargement à froid coûte environ 17 s et ~1 Go de mémoire vive : le chemin de requête ne doit pas être traversé à froid dans un test à délai court.

La configuration privée du bureau est séparée : `%ProgramData%\MindCare\mindcare.env` pour la base et `%ProgramData%\MindCare\private\runtime.env` pour les paramètres serveur autorisés. Ces fichiers doivent garder leurs permissions protégées. Ne jamais y copier aveuglément une URL de développement. Une impossibilité de lecture depuis un compte non administrateur ne prouve pas l’absence d’un fichier. Toute mise à niveau conserve les données et l’historique du cabinet.

**Index vectoriel secondaire 768 (e5-base).** Recette `knowledge/recette-embedding-secondaire-768.json` : `intfloat/multilingual-e5-base`, révision `d128750597153bb5987e10b1c3493a34e5a4502a`, 768 dimensions, préfixes `query: ` / `passage: `, troncature 128, cosinus, CPU local. Les artefacts sont vérifiés par SHA-256 avant chargement (`84a4d426…` pour `model.onnx`, `62c24cdc…` pour `tokenizer.json`) dans `%LOCALAPPDATA%\MindCare\modeles\e5-base`. Table `app.knowledge_chunk_vectors_768`, porte `app.search_knowledge_vector_v2_768`, plancher de similarité 0,83 pour ce triplet exact. **État vérifié le 2026-10-28** : 25 235 vecteurs (DSM-5 12 815, Maudsley 9 344, Stahl 3 076), 0 dimension erronée, 0 chunk inactif, 0 hors périmètre ; une seconde exécution du remplissage rend `restants: 0`. L’index n’est lu que si `KNOWLEDGE_VECTOR=1` **et** `KNOWLEDGE_VECTOR_RECETTE=e5-base` ; les deux sont absents par défaut.

**Reranker.** Par défaut, `HeuristiqueBaseline` (`local-v1`) : couverture lexicale 55 %, similarité 45 %, bonus de titre. Le cross-encoder `mmarco-mMiniLMv2` est un opt-in (`KNOWLEDGE_RERANK=mmarco`) ; son modèle local est réellement chargé et discriminant (mesure directe : 0,634 vs 0,414 sur une paire mécanisme/posologie, 0,854 vs 0,414 sur la paire inverse). Sur le golden livres v4, son activation **dégrade** le rappel@5 (0,613 contre 0,742 sans lui) et coûte ~2,2 s de p50 (10,8 s de p95) : il reste désactivé. Aucun reranker externe.

**Dégradation nommée (2026-10-28).** Le modèle BGE-M3 n’est présent ni dans `MINDCARE_BGE_M3_DIR` ni dans `resources/models/bge-m3/<revision>` sur ce poste : `vecteurRequeteProduction` rend `null` et la recherche de production est **lexicale seule** (rappel@5 0,710 sur les 34 cas du golden v4). Ce n’est pas une panne silencieuse (statut `indisponible` + motif), mais une réponse ne doit pas être présentée comme « sémantique » tant que l’artefact n’est pas restauré ou que l’index 768 n’est pas activé.

Les lectures patient restent auditées et soumises aux permissions en base. Les écritures métier suivent proposition, confirmation, exécution, vérification et audit. Le modèle local n’accorde aucun droit supplémentaire. Les données identifiantes restent locales ; la voix cloud est retirée et aucun transport audio externe n’est possible. La présence d’une clé ne prouve ni une autorisation d’export, ni un quota, ni la qualité de la voix naturelle.
