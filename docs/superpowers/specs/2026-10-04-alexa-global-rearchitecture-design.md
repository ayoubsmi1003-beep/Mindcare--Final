# Alexa globale — audit et spécification du 4 octobre 2026

Statut : **AUDIT EFFECTUÉ, SPÉCIFICATION À VALIDER, IMPLEMENTATION NON COMMENCÉE**.
Checkout audité : `v7-design`, HEAD `e7b2bbf`. Le fichier non suivi `pnpm` était présent avant l'audit ; il est conservé.
Demande : prompt maître de 50 sections joint à cette conversation. Ce document distingue le fonctionnement constaté, la cible demandée et les conditions de qualification.

## 1. Mission et limites

TASK : faire évoluer Alexa vers un assistant global capable de compréhension sémantique, de lectures et actions autorisées, de dialogue avec références explicites, de synthèses longitudinales et de connaissance sourcée.

SCOPE : Alexa/Jarvis, adaptateurs modèle et voix, outils autorisés, contexte clinique partagé, identité locale, artefacts de synthèse, retrieval existant et tests de ces parcours. Aucun remplacement des workflows du cabinet.

ENTRYPOINT : `src/services/alexa-turn.ts` → `/api/alexa/turn` → `src/server/alexa/orchestrator.ts`, avec les portes et registres existants.

STOP : critères produit du prompt vérifiés séparément en logiciel, PostgreSQL, fournisseur, navigateur et acoustique. Une partie non vérifiée reste NOT RUN ; un échec reste FAIL. Le présent audit ne termine pas cet objectif.

Les noms, numéros d'identité, téléphones, dates de naissance, contacts et autres identifiants directs restent locaux. Notes originales, langues originales, signatures, addenda et historique restent les sources faisant foi. La médecin confirme les changements métier ; PostgreSQL décide des permissions, transitions et traces.

## 2. Carte du chemin actuel

```text
AppShell / bulle / panneau / page Alexa
  → services/conversation.ts
      lecture : envoyerAlexaUnifie → services/alexa-turn.ts
      proposition reconnue : chemin Jarvis existant → carte de confirmation
  → /api/alexa/turn : identité, validation Zod, journal local du tour, SSE
  → server/alexa/orchestrator.ts
      planRequest : règles textuelles et intentions fermées
      resolvePatient : search_patients + get_patient, identité locale
      clinical-context : get_alexa_clinical_context, pages et revision
      branche locale : extraits/phrases déterministes
      branche modèle : projection clinique codée → external-call → sélection de faits
      knowledge-adapter : porte lexicale → fusion/rerank existant → extraits
      conversation-state : références bornées en RAM, acteur + patient + page
  → texte/source/navigation → Piper local

Microphone : capture/VAD → Whisper local → même tour Alexa → Piper local
Gemini Live : ancien transport serveur présent, entrée désactivée avant réseau
Résumé : /api/alexa/summary → contexte 20 consultations → constructeur local
         → save_alexa_case_summary → get_alexa_case_summary → CarteResumeCas
```

La bulle est montée dans `AppShell` : la visibilité globale existe déjà pour les surfaces qui utilisent cette coquille. Son absence côté assistante est une décision de présentation, pas une autorisation. La vérification navigateur de toutes les surfaces reste à faire.

## 3. Constat et causes

| Constat | Preuve actuelle | Conséquence |
|---|---|---|
| Compréhension fermée | `shared/alexa/request-plan.ts`, union `AlexaIntent`, règles FR/AR, fallback `clarify` | Une reformulation ou requête métier nouvelle peut sortir du vocabulaire reconnu. |
| Le modèle n'appelle pas les outils Alexa v2 | `orchestrator.ts` interdit explicitement cette sélection ; `tool-executor.ts` n'admet que `clinical_context` | La compréhension ne peut pas chercher une stratégie au-delà des branches codées. |
| Sous-utilisation des capacités existantes | 22 lectures et 7 écritures dans `jarvis-capacites.ts`/`jarvis-ecritures.ts` ; parcours Alexa v2 séparé | Agenda de période, salle d'attente et impayés existent comme capacités sans être tous accessibles par ce nouveau parcours. |
| Agenda v2 du jour seulement | `unsupportedAgendaPeriod`, adaptateur `dashboard_today` | « Demain » est clarifié, même si une capacité de période existe ailleurs. |
| Mémoire limitée | `WorkingReference` : intention, nombre, curseur, opération/focus ; `ConversationState` exige même patient et même page | Aucune liste ordonnée de patients pour « le deuxième » ; changement de page perd la référence. |
| Résumé peu longitudinal | `case-summary.ts` : quatre items diagnostics/traitements/dernier extrait/limites ; détails des notes courante + dernière terminée | Il ne synthétise pas les consultations successives ni leur trajectoire clinique. |
| Aucune synthèse individuelle préalable | `buildCaseSummary` construit des lignes chronologiques date/nombre de notes ; pas d'étape modèle par consultation | Le résumé n'est pas une synthèse de résumés sourcés. |
| Contexte externe trop pauvre pour raisonner | `privacy-boundary.ts` : consultations = rang/codes/présence de note ; traitements courants normalisés ; prose omise | Les observations, symptômes, réponse et risques décrits dans les notes ne sont pas compris par le modèle. |
| Prose modèle remplacée | `response-validator.ts` refuse `inference`/`knowledge`, puis `renderFact` reconstruit le texte | Une réponse clinique naturelle ne peut pas apparaître, même avec un bon modèle. |
| Modèle nominal différent de la cible | `model-policy.ts` : `qwen/qwen3.7-flash`, primary-only ; `model-gateway.ts` : aucune alternative nominale | La documentation du 2 octobre est partiellement périmée ; changer le nom du modèle ne résout pas les limites précédentes. |
| Live retiré par politique | `voixCloudAutorisee()` retourne `false` ; route Live retourne `retired` | Le microphone visible utilise actuellement le chemin local. |
| Ancien Live impropre à une réactivation simple | `live-tools.ts` retourne identité/date de naissance des patients synthétiques ; setup transmet UUID patient | Il faut remplacer ces projections par des références locales opaques avant toute réactivation. Cela n'est pas une fuite active : le chemin est désactivé. |
| RAG réel mais lexical et extractif | `knowledge-adapter.ts` appelle uniquement `search_knowledge_lexical` et fournit `[]` côté vecteur ; réponse = extraits | Le corpus existant est utilisé ; les exigences hybride et synthèse ne sont pas satisfaites. |
| Gel vectoriel motivé | `knowledge/gel-dsm-retrieval.json` consigne une régression hybride et interdit la réactivation sans calibration | Aucune activation vectorielle par simple flag ; les chiffres du gel sont historiques, non rejoués ici. |
| Métadonnées de consultation incomplètes | `clinicalConsultationSchema` n'expose pas `appointmentKind`, pourtant présent dans le service consultation | La synthèse doit recevoir le type enregistré ; un focus absent ne doit pas être inventé. |

Le problème principal est la restriction du trajet compréhension → outils → contexte → réponse. La couche de sûreté est à conserver ; ses garanties ne doivent pas être confondues avec l'interdiction de toute synthèse utile.

## 4. KEEP / REFACTOR / REPLACE / REMOVE / ADD

| Décision | Éléments |
|---|---|
| KEEP | AppShell et conversation visible ; identité/auth locale ; DbPort/withCaller ; search_patients/get_patient ; RLS/portes/audit ; registre d'écritures et carte ; contexte clinique et revision ; notes/SOAP/addenda ; stockage de résumé existant ; egress unique ; corpus/retrieval/rerank/provenance ; capture/annulation locales. |
| REFACTOR | Orchestrateur Alexa existant ; schémas d'outils et adaptateurs serveur ; état conversationnel ; projection privée ; validation de réponse ; modèle/gateway ; constructeur du résumé ; branche RAG. |
| REPLACE | Regex comme unique compréhension, prose générée remplacée systématiquement par des gabarits, résumé du cas réduit à la dernière visite. Garder les fast paths utiles pour les contrôles et lectures simples. |
| REMOVE | Les règles et chemins devenus sans consommateur, après vérification. Les anciens transports cloud ne seront retirés qu'après qualification de leur remplacement. Aucun fichier n'est supprimé dans cet audit. |
| ADD | Contrats typés pour choix d'outils borné, références de résultats, synthèse individuelle puis longitudinale, adaptateurs Gemini derrière la gateway, qualification hybride et traçage local minimal. |

Aucun framework d'agents, broker, nouveau service, seconde base, second corpus ou nouvelle mémoire persistante. Ne pas fusionner les registres Jarvis de la Phase 5.

## 5. Options et décision recommandée

1. Étendre les regex et garder les réponses gabarits : faible coût initial, mêmes limites sur les demandes nouvelles et composées. Insuffisant pour le prompt.
2. Faire évoluer l'orchestrateur Alexa existant avec choix sémantique d'outils validés : réutilise contexte, portes, données et UI. **Option recommandée.**
3. Remplacer Alexa/Jarvis par un nouveau framework : dédouble sécurité, outils et contexte ; complexité et risques de régression injustifiés. Écarté.

## 6. Architecture cible minimale

```text
Texte / transcription locale / Live autorisé
  → session Alexa locale (acteur, références, contexte UI, tâche active)
  → orchestrateur existant
      contrôles simples : fast path local
      demande ouverte : adaptateur modèle → plan/appels typés et bornés
  → validation déterministe : schéma, outil existant, portée, quota, revision
  → adaptateur de domaine sous withCaller → portes PostgreSQL/RLS
  → minimisation / identité locale / transformation de sortie approuvée
  → synthèse modèle des seuls résultats autorisés
  → validation des sources, nombres, états et identité → SSE / parole
      mutation : proposition → carte existante → confirmation → porte → vérification
```

Le modèle choisit une opération supportée ; il n'accorde aucune permission. Outils, bornes, critères de query et transitions restent déterministes. Aucun SQL, nom de table, chemin disque, URL ou commande shell libre dans les arguments. Les données de notes/résultats sont des données de faible autorité, isolées des instructions et incapables de déclencher une mutation.

Une requête explicite est reclassée à chaque tour. Seuls les suivis elliptiques peuvent utiliser la référence locale précédente. Les lectures indépendantes peuvent être parallèles ; les dépendances et mutations restent séquentielles. Une erreur d'identité ne réutilise jamais le précédent patient.

## 7. Outils et questions métier

Exposer les capacités de lecture existantes au nouveau parcours par leurs schémas et portes, sans importer le DbPort navigateur dans le serveur ni modifier un singleton partagé entre utilisateurs. Les adaptateurs reçoivent le DbPort de l'acteur courant. Garder le registre d'écritures séparé.

Regrouper seulement lorsque les opérations partagent réellement le même contrat : recherche patient, contexte/histoire clinique, consultation, traitements/historique, documents visibles, agenda/période, salle d'attente, finance autorisée, connaissance, synthèses dérivées et navigation. Les schémas sont la source de la description envoyée au modèle.

Les exemples du prompt deviennent des contrats de données, pas une liste de phrases reconnues. « Sans carte » correspond à `id_document_number` absent, champ existant de `01-SCHEMA`. Le filtrage doit être effectué par une porte auditée paginée, avec total et ordre ; ne pas aspirer le cabinet pour filtrer en JS. Idem pour nombre de consultations, dernière consultation ancienne, période et traitements récemment modifiés. Ajouter uniquement les fonctions de lecture SQL nécessaires ; aucune nouvelle table/colonne/enum n'est requise par principe. Vérifier leur contrat et leurs rôles avant migration additive. Aucune migration appliquée n'est éditée ou exécutée silencieusement.

Navigation et sélection de consultation transmettent une destination typée construite localement. Les préparations de documents et prescriptions restent des brouillons dans les capacités déjà autorisées. Un outil non disponible est nommé comme tel ; l'absence de capacité ne doit pas se présenter comme absence de données.

## 8. Mémoire de conversation

Étendre la RAM serveur actuelle : références opaques → UUID locaux, dernière liste ordonnée avec filtre/période et revision, patient sélectionné, consultation sélectionnée, sources de résultats, tâche active, UI courante. Pas de nom/phone/DOB dans l'enveloppe fournisseur ou les diagnostics.

Conserver TTL, plafonds et annulation des tours périmés. Séparer l'invalidation du tour en cours (navigation) de la mémoire de résultats terminés (conversation globale). « Le deuxième » ne fonctionne que sur une liste valide à ordre connu ; sinon clarification. « Avant celle-là » utilise la consultation sélectionnée et un curseur stable. Revalider get_patient et les portes de consultation au moment du drill-down. Isolation acteur/session stricte, réinitialisation à la déconnexion.

## 9. Identité et clinique : frontière utile et fermée

Le nouveau prompt autorise le contexte clinique dé-identifié ; il n'autorise pas l'identité ou les secrets externes. La projection actuelle `alexa-clinical-minimal-v1` ne couvre que les faits codés : elle ne doit pas être élargie silencieusement en réutilisant le même reçu.

Créer une nouvelle transformation versionnée et son schéma fermé, après validation de ce design. Identité locale issue des portes, noms/alias/contacts du dossier retirés, données directes et quasi-identifiants minimisés, preuves et références locales remplacées par jetons temporaires. La simple suppression des quatre champs démographiques ne suffit pas pour une note libre : tiers, adresses, profession rare et autres indices peuvent se trouver dans le texte. Un passage non certifiable reste local avec omission annoncée, ou passe par une revue locale explicite liée aux octets exacts ; ne pas prétendre qu'un filtre regex anonymise toute prose.

La transformation doit préserver négations, dates cliniques utiles, attributions, incertitudes, doses/unités, langue et statut brouillon/signé. Les faits, synthèses/inférences et manques sont distingués. Le validateur vérifie la lignée et les invariants de faits, sans remplacer toute la réponse naturelle. Il ne promet pas de prouver sémantiquement chaque phrase : l'artefact reste IA, révisable et relié à ses sources.

Aucun routage ou planning externe ne reçoit d'abord la demande brute contenant une identité. Résoudre les mentions locales avant le modèle ; inconnu/injection/forme non approuvée = zéro octet fournisseur. Les résultats locaux nominatifs sont rendus par l'application, après génération si nécessaire.

## 10. Résumés : consultation puis trajectoire

Chaque consultation : type enregistré, notes de travail + SOAP + addenda, traitements/évolutions consignés, diagnostics/hypothèses enregistrés, observations, risque documenté, décisions et suivi. Produire un petit artefact typé séparant faits, synthèse, manques, avec sources champ/note/version et langue d'origine. Un brouillon ouvert reste distinct d'une consultation terminée. L'absence de risque noté n'est pas une absence de risque.

Puis synthèse longitudinale : résumés de consultations + histoire structurée + trajectoire médicamenteuse + changements récents. Priorité au motif du suivi, évolution documentée, état récent, traitement, vigilance et points ouverts. Le paragraphe français de la page reste court ; le dialogue suit la langue de la médecin. Aucun état courant inféré d'un document ancien sans l'annoncer.

Lire par lots, conserver la couverture exacte, résumer sans gros dump de notes, puis condenser avec accès aux sources. Le compteur de consultations disponible doit être distingué de « notes présentes », « fenêtre couverte » et « dossier complet ». Le plafond courant de 100 consultations et 200 changements n'est jamais présenté comme toute l'histoire. Les dossiers plus longs nécessitent une progression bornée/resumable avec couverture visible.

Démarrer avec cache RAM borné des artefacts individuels, lié aux empreintes de sources/modèle/prompt/transform/langue. Réutiliser `patient_case_summaries` et les portes save/get existantes pour le résultat longitudinal ; représenter les artefacts individuels dans le contenu/les métadonnées compatibles, après vérification du validateur SQL. Pas de nouvelle table de synthèses par défaut. La relation au traitement et à l'historique garde les types de sources déjà autorisés ; les détails de lignée restent des métadonnées. Une édition ou un addendum invalide le cache et le résumé. La porte revérifie la revision avant et après sauvegarde.

## 11. Fournisseurs et voix

Gemini 3.8 Flash et Live sont documentés officiellement. Flash dispose d'appels de fonctions et de sorties structurées ; Live utilise une session audio et des appels d'outils, avec transcription de sortie pour le texte. Conserver l'interface interne et `external-call.ts` comme sortie unique. Les imports/SDK et transports fournisseur restent derrière cette frontière ; pas de clé permanente renderer.

Le routeur choisit un seul moteur suffisant : contrôle local ; Live simple → outil autorisé → Live ; Flash pour synthèse/plan complexe. Pas de passage systématique dans les deux modèles. Annulation, timeout, coupure partielle, quota et erreur de compte sont distincts. Aucun retry après publication ni rejeu de mutation inconnue.

**Condition réelle de confidentialité :** un flux microphone brut peut contenir un nom ou téléphone avant tout filtrage. Une clé éphémère protège la clé, pas cette identité. Le design conserve donc STT/TTS local pour dossiers réels ; native Live est limité à un déploiement intégralement synthétique vérifié. Il ne sera pas déclaré voix clinique acceptée. Si le produit exige native Live avec vrais patients, cette exigence doit être réconciliée explicitement avec la frontière identitaire ; ne pas réactiver l'ancien flag.

**Condition fournisseur :** les conditions Gemini Developer API consultées le 4 octobre restreignent l'usage en pratique clinique et interdisent les données sensibles dans les services non payants. Un projet facturé ne règle pas, à lui seul, la restriction d'usage clinique ou la rétention. La démonstration synthétique peut être développée ; l'activation réelle nécessite une offre/route contractuellement compatible, qualifiée séparément, ou un moteur local/compatible via la même interface. Ce point ne sera pas masqué par le mot « anonymisé ». Aucun compte ou paiement n'est modifié par l'agent.

Reprendre capture/partage du micro, VAD, arrêt parole lors d'une interruption, annulation du tour, nettoyage et états honnêtes existants. L'ancien Live nécessite en plus projection des outils sans identité/UUID, bornage et ordre PCM, appel de fonction avec ID exact, revalidation du périmètre, expiration et test acoustique. Aucun téléchargement de gros modèle ni ajout de TTS sans mesure.

## 12. RAG

Réutiliser M06/M07, RPC installées, embeddings locaux, fusion et rerank. Préserver source/version/section/chunk/langue/lignée et les états ok/faible/sans-preuve/panne. L'adaptateur actuel perd la langue au retour Alexa : la conserver dans le nouveau contrat. Les pages ne sont citées que si la provenance les fournit.

Créer une comparaison reproductible sur les goldens existants avec lexical comme baseline et hybride comme candidat, sans modifier les attentes pour rendre le test vert. DSM type I/II, négation, faux positif, étanchéité inter-livres et abstention sont des gates. Ne pas modifier corpus/OCR/ingestion ni le fichier de gel pour activer par défaut. Corriger/calibrer la récupération de requête et le rerank nécessaires, puis n'activer que si qualifié.

La réponse synthétise les preuves autorisées, les relie aux sources et distingue connaissance générale et fait du dossier. Les états faible/absent/panne ne permettent pas une conclusion médicale inventée. Les scores internes restent hors UI médecin. La démonstration ne sera pas déclarée « RAG hybride réel » avec uniquement une simulation.

## 13. Écritures et observabilité

La proposition passe par les cartes existantes, `confirm_jarvis_action`, `execute_jarvis_action`, allowlist et audit atomique. Ne pas donner à Live/Flash un endpoint qui confirme pour la médecin. Ne pas élargir les actions métiers sous couvert de synthèse. Les résumés dérivés utilisent leurs portes existantes sans réécrire les notes faisant foi.

Réutiliser les journaux et métadonnées de tour/egress : request/session, acteur local, modèle réel, prompt/transform, outils, arguments minimisés, état d'approbation, latences, limites et erreur. Un mode développeur montre les étapes et preuves, avec justification concise ; il n'enregistre pas un raisonnement interne caché, des transcriptions patient ou des dumps de dossiers. Les logs ne deviennent jamais un second dossier clinique.

## 14. Vérification initiale et gates futurs

**PASS : 66 tests, 8 fichiers**, exécutés sur le code existant : orchestration (17), résumé (8), politique modèle (4), validateur (6), confidentialité (10), portes connaissance (3), retraite voix cloud (10), tours progressifs (8). Durée rapportée 11,68 s. Ce sont des tests logiciels avec fixtures ; ils ne prouvent pas une RLS déployée, un fournisseur réel ou une voix réelle.

Commande : `node node_modules/vitest/vitest.mjs run` suivie des huit fichiers `tests/unit/alexa-v2-{orchestration,summary,model-policy,response-validator,privacy,progressive-turn}.test.ts`, `alexa-knowledge-gates.test.ts`, `alexa-cloud-voice-retired.test.ts`.

Le premier lanceur pnpm ne trouvait pas vitest. Le lancement direct sous sandbox était bloqué par `spawn EPERM` d'esbuild. Le rejeu indépendant autorisé hors sandbox a passé les 66 tests ; aucune dépendance installée.

**FAIL de précondition runtime :** `verifier-base.mjs` n'a pas obtenu de connexion à la cible locale de développement. Rejeu indépendant hors sandbox avec `MINDCARE_SKIP_DB_WAIT=1` : même refus, aucun démarrage Docker. Aucune migration n'est vérifiée comme appliquée dans ce tour. L'outil a rapporté un refus même si l'enveloppe shell affichait exit code 0 ; le texte de refus fait foi. Cause précise de non-connexion non établie.

**NOT RUN :** parcours authentifiés sur base, RLS des rôles, requêtes exemples, appel Live/Flash réel, RAG/hybride vivant, chaque surface navigateur, résumé longitudinal généré, microphone → réponse parlée, barge-in naturel, Darija naturel, packaging/Electron et validation praticienne. Aucun build/typecheck nécessaire à ce changement exclusivement documentaire.

Pour l'implémentation : tests de compréhension sémantique par paraphrases inédites FR/AR/darija/EN/mixte ; plan composé ; filtres métier et pagination ; liste→deuxième→dernière→précédente ; changement de page et isolement acteur ; injection en note/résultat ; refus zero-byte des identifiants, reçus falsifiés et outils/arguments inconnus ; refus des écritures non confirmées ; conservation langue/negation/doses/incertitudes ; synthèses individuelles et longitudinale avec revision/invalidation ; vrais checkpoints SQL en rollback sur données synthétiques ; qualification fournisseur sans PII ; corpus positif/abstention/citations réel ; navigateur et acoustic test avec parole humaine. Reprise réelle du scénario final du prompt depuis le dashboard.

## 15. Livraison et décisions de revue

Ordre de réalisation après validation : contrats + compréhension/outils/références ; frontière privée + adaptateurs ; synthèses individuelles/longitudinale ; RAG réel qualifié ; voix/surfaces/performance ; acceptation. Garder les changements en petits ensembles vérifiables, sans déployer une architecture concurrente. Les détails de tâches/fichiers et commandes seront dans le plan d'implémentation après revue de cette spécification.

Décision demandée : valider l'option 2 et cette spécification, notamment **local pour la voix de vrais dossiers / Live pour qualification synthétique**, et **activation clinique de Gemini conditionnée à une route compatible**. Cela préserve les frontières du prompt tout en permettant l'implémentation du cœur. La cible native Live sur de vrais dossiers reste une exigence non réconciliée, pas un succès annoncé.

## Références fournisseur consultées

- [Gemini 3.8 Flash : fonctions et sorties structurées](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash).
- [Gemini 3.8 Live : modèle et migration](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live).
- [Gemini Developer API : conditions d'utilisation et traitement des données](https://ai.google.dev/gemini-api/terms).

Les constats actuels viennent du checkout réinspecté. Les notes de mémoire ont seulement orienté l'audit ; leurs nombres historiques et ancienne politique free-only ne sont pas utilisés comme preuve de fonctionnement actuel.
