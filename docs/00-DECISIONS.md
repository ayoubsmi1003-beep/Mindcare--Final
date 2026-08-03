# 00 — DECISIONS
**MindCare OS — Cabinet Dr. Larbi N. (Alger)**
Statut : **VERROUILLÉ** — aucune ligne de code avant lecture complète de ce document.
Version 1.0 — 2026-07-28

> Ce fichier est la source de vérité. Toute session Claude Code doit le lire en premier.
> Si un choix technique contredit ce document, **le document gagne**. Toute dérogation = nouvel ADR ajouté ici.

---

## 1. CONTEXTE & CONTRAINTES

### 1.1 Le cabinet
- Praticienne principale : **Dr. LARBI N.**, psychiatre / psychothérapeute, N° d'Ordre **16/16780**
- **Deuxième praticienne** (arrivée future) : patientèle séparée, médicaments séparés, revenus séparés
- **Assistante** : 1 personne, poste dédié sur le même LAN
- Localisation : Alger, Algérie. Loi **18-07** (protection des données personnelles) applicable.

### 1.2 Matériel — état des lieux (Mois 1)
| Composant | Spec actuelle | Verdict |
|---|---|---|
| CPU | Intel i7 | ✅ suffisant |
| RAM | 16 GB | ⚠️ limite — Supabase Docker ≈ 5–6 GB |
| GPU | Intel iGPU | ❌ **aucune inférence locale possible** |
| Disque | 256 GB SSD | 🔴 **insuffisant** |
| OS | Windows 10 Pro | ⚠️ EOL — non patché |
| Réseau | Wi-Fi, modem cabinet, pas d'IP fixe | ⚠️ |
| PC assistante | Même LAN, **compte Windows séparé** | ✅ |

### 1.3 Actions matérielles obligatoires
| # | Action | Délai | Coût estimé |
|---|---|---|---|
| H1 | **NVMe 1 TB** (le 256 GB sature avant M3 : Windows 60 GB + Docker 25 GB + Postgres + WAL + backups) | Avant J1 si possible | ~8 000 DZD |
| H2 | **Disque externe USB 1 TB** dédié backups (jamais monté en permanence) | Semaine 1 | ~6 000 DZD |
| H3 | Upgrade **Windows 11 Pro** (gratuit si hardware compatible) | Semaine 2 | 0 |
| H4 | **Nouveau PC + GPU** (RTX 3090 24 GB ou 4090) → bascule 100 % locale | Mois 2 | à budgéter |
| H5 | Passage **Ethernet** (Wi-Fi = coupures = perte de session en cours) | Semaine 1 | ~2 000 DZD |

---

## 2. LES 6 RÈGLES DE FER

Non négociables. Elles priment sur la vitesse, sur le confort, sur la deadline.

**R1 — Localité des données.**
Toute donnée identifiante patient (Tier 0) reste sur le PC du cabinet. Aucune sortie vers un cloud, jamais, sous aucun prétexte.

**R2 — Passerelle de pseudonymisation.**
Tout appel vers une API externe (OpenRouter, Groq) passe **obligatoirement** par une fonction serveur unique qui retire nom, prénom, date de naissance, téléphone, adresse, N° pièce d'identité, et les remplace par des jetons (`PT_4471`). Ré-hydratation locale au retour. Aucun appel direct depuis le client.

**R3 — Clés API serveur uniquement.**
Aucune clé dans le code client, dans le repo, dans le `.env` versionné, ni dans un message de chat. Variables d'environnement serveur uniquement, `.env` dans `.gitignore` dès le commit initial.

**R4 — Propose → Confirme → Exécute → Journalise.**
Jarvis ne réalise **aucune** action d'écriture (créer, modifier, supprimer, envoyer, imprimer) sans confirmation explicite de l'utilisateur affichée à l'écran. Chaque action exécutée est journalisée.

**R5 — Note clinique immuable.**
Voir ADR-004. Signature → gel. Correction = amendement visible, jamais écrasement.

**R6 — Journal d'audit dès J1.**
Toute lecture et écriture de donnée clinique est tracée : qui, quoi, quand, depuis où. Non rétro-installable — donc fait maintenant.

---

## 3. ARCHITECTURE DECISION RECORDS

### ADR-001 — Supabase auto-hébergé dès J1 (jamais Supabase Cloud)
> ⚠️ **SUSPENDUE le 2026-08-02 par ADR-016**, le temps de la phase de développement, et sous les
> trois conditions qui y sont écrites. **Redevient applicable de plein droit à la migration.**
> Ne pas lire cet ADR sans ADR-016, ni ADR-016 sans celui-ci.

**Décision.** Supabase self-hosted en Docker (WSL2) sur le PC du cabinet, dès la première ligne.
**Pourquoi.** Supabase Cloud stocke en Europe/Asie → viole R1 et Loi 18-07 dès le jour 1. Le SDK, le Postgres, les RLS, l'Auth sont **identiques**. Le coût est ~3 h de setup une seule fois.
**Rejeté.** « Cloud maintenant, migration plus tard » — la migration d'un Postgres en production avec données cliniques réelles = 2 semaines de risque, à payer deux fois.
**Conséquence.** Setup WSL2 + Docker Desktop en tâche J0, avant toute autre chose.

### ADR-002 — STT cloud pendant le Mois 1, bascule locale par flag
**Décision.** Transcription via **Groq `whisper-large-v3-turbo`**, en streaming par segments, à travers la passerelle de pseudonymisation.
**Pourquoi.** L'iGPU Intel ne permet aucune inférence. Whisper large-v3 sur CPU tourne à ~0,3× temps réel — 10 min d'audio = 30 min de traitement. Le temps réel est impossible. Groq est ~10× plus rapide qu'un routage OpenRouter et moins cher.
**Garde-fous.**
- Audio streamé en mémoire, **jamais écrit sur disque**, purgé après transcription
- Aucun identifiant patient transmis — uniquement un `session_token` éphémère
- Consentement écrit signé par la patiente, archivé (modèle à produire)
- Variable `STT_PROVIDER=groq` → `local_whisper` : **une ligne** le jour du GPU
**Révision.** À l'arrivée du GPU (Mois 2).

### ADR-003 — Scoping multi-praticien dès le schéma initial
**Décision.** `practitioner_id` sur toute ligne clinique et financière. `cabinet_id` présent partout (valeur unique aujourd'hui).
**Pourquoi.** La 2ᵉ praticienne est déjà annoncée. Ajouter une colonne de scoping après mise en production = réécriture de toutes les policies RLS et de toutes les requêtes.
**Coût aujourd'hui.** ~0. **Coût plus tard.** ~1 semaine.

### ADR-004 — Notes cliniques append-only
**Décision.** États : `draft` → `signed` → (immuable). Fenêtre de brouillon **15 minutes** après signature. Après gel, toute correction crée une ligne `clinical_note_amendment` liée, horodatée, visible.
**Pourquoi.** Un dossier modifiable a une valeur probatoire **nulle** devant un tribunal ou une expertise. Un dossier append-only avec audit trail est une preuve.
**Coût UX.** Elle ne peut pas « corriger une faute de frappe » après gel — elle produit un amendement visible. Accepté.
**Coût technique.** 2 tables, ~40 lignes. Rétro-installation = réécriture de toutes les requêtes cliniques.

### ADR-005 — Modèle de permissions à 4 rôles
| Rôle | Voit | Ne voit pas |
|---|---|---|
| `owner` (Dr. Larbi) | Tout le cabinet, tous praticiens, finances globales | — |
| `practitioner` (Dr. #2) | Ses patients, ses notes, ses ordonnances, **ses seuls revenus** | Patients et revenus des autres |
| `assistant` | Identité, contact, RDV, statut & montant de paiement — **tous praticiens** | **Aucune** note clinique, transcription, diagnostic, ordonnance |
| `patient` | Ses propres données via portail aftercare | Tout le reste |

Appliqué par **RLS Postgres**, pas par le front-end. Le front-end n'est jamais une frontière de sécurité.

### ADR-006 — Le QR est statique ; le téléphone est la clé
**Décision.** Un QR unique affiché en salle d'attente → formulaire web → le patient saisit **son numéro de téléphone** comme identifiant.
**Logique.**
- Téléphone existant → réponses rattachées au dossier existant, marquées `pre_consultation`
- Téléphone inconnu → création dans `pending_patients` → **validation obligatoire** par le médecin ou l'assistante avant de devenir un dossier réel
**Pourquoi la validation.** Sans elle, un QR public = n'importe qui pollue la base. Le fossé de validation est la protection.
**Anti-abus.** Rate-limit par numéro (3 soumissions / 24 h), champ honeypot, expiration de session 30 min.

### ADR-007 — OpenRouter comme passerelle LLM unique
**Décision.** Une clé OpenRouter, un seul module `llm_gateway` côté serveur. Aucun SDK fournisseur en direct.
**Pourquoi.** Changer de modèle = changement de config, jamais de code. Prépare la bascule vers un modèle local (LiteLLM parle le même protocole OpenAI).
**Note.** STT passe par Groq en direct (OpenRouter ne route pas l'audio efficacement) — même passerelle de pseudonymisation.

### ADR-008 — Langue
- **Interface** : français intégral
- **Sortie de transcription** : arabe (fidèle au parlé)
- **Jarvis** : répond en français ou en arabe selon la langue d'entrée
- **Formulaire d'accueil patient** : FR / AR / Darija
- Aucune chaîne de texte codée en dur — tout en fichier de traduction dès J1

### ADR-009 — Aucun audio conservé
**Décision.** L'audio n'est jamais persisté. Transcription → note structurée → l'audio disparaît.
**Pourquoi.** L'audio psychiatrique est le passif juridique le plus lourd d'un cabinet. Ce qui n'existe pas ne peut pas fuiter, être saisi, ni être réclamé.

### ADR-010 — Finance : cash uniquement, pas de facture
**Décision.** Le médecin saisit le prix manuellement en fin de séance. Aucune facture légale émise. Journal interne des paiements uniquement.
**Conséquence.** Pas de numérotation légale requise → mais on implémente quand même une **numérotation sans trou** via table compteur (pas de séquence Postgres) pour la cohérence interne et la traçabilité.
**Notification.** Prix saisi → événement → notification temps réel sur le poste assistante (montant + patient suivant).

### ADR-011 — Documents : moteur à templates
**Décision.** Un moteur unique, en-tête/pied de page partagés, corps variable par type.

**En-tête commun (extrait des documents existants) :**
```
[FR]  Dr. LARBI . N
      Médecin Spécialiste en Psychiatrie et Psychothérapie
[AR]  الدكتورة العربي . ن
      طبيبة مختصة في الأمراض النفسية العقلية والعصبية
      N° d'Ordre : 16/16780
      Tel : 0554813911
[LOGO] arbre/cerveau + main, teal
[BLOC DROITE] Date / Nom / Prénom / Age
Police : Times New Roman 14
```

**Types identifiés :**
| Code | Titre | Champs variables |
|---|---|---|
| `bonne_sante_mentale` | Certificat de bonne santé mentale | n° pièce identité, mairie de délivrance |
| `suivi_medical` | Certificat de suivi médical | nombre de jours d'arrêt (chiffres + lettres), date de début |
| `certificat_medical` | Certificat médical | date de naissance, traitement |
| `justification` | Justification | date de consultation |
| `ordonnance` | **⚠️ MODÈLE MANQUANT** | à fournir |

**Questions ouvertes à trancher avec la praticienne :**
- ⚠️ L'en-tête actuel écrit « **Pychiaterie** » (faute) — corriger en « Psychiatrie » ou reproduire à l'identique ?
- ⚠️ Numérotation des certificats (n° d'ordre par document) : souhaitée ou non ?

### ADR-012 — Vidal : intégration différée, schéma prêt maintenant
**Décision.** Le PDF Vidal est **scanné (images)** → extraction OCR non triviale. Les tables `medications` et `medication_forms` sont créées à J1 avec un jeu de départ saisi manuellement (les ~60 molécules psychotropes qu'elle prescrit réellement). Extraction Vidal complète en tâche de fond, Semaine 2–3.
**Pourquoi.** Une psychiatre prescrit dans un périmètre étroit. 60 molécules couvrent >95 % de sa pratique. Attendre le Vidal complet bloquerait la mise en service pour un gain marginal.

### ADR-013 — Comptes Windows séparés
**Décision.** Session Windows distincte pour l'assistante. Chiffrement BitLocker sur le disque système.
**Pourquoi.** Une RLS applicative avec un compte Windows partagé est du théâtre : l'assistante accède au conteneur Docker et lit la base directement.

### ADR-014 — Sauvegardes
- `pg_dump` chiffré **toutes les 4 h** → disque interne
- Copie quotidienne → **disque externe USB**, débranché après copie (protection ransomware)
- Test de restauration **hebdomadaire**, obligatoire, tracé
- WAL archiving activé → PITR
- **Règle : une sauvegarde jamais restaurée n'est pas une sauvegarde.**

### ADR-015 — Aftercare : chat simple, sans engagement de garde
**Décision.** Messagerie asynchrone médecin↔patient. Bandeau permanent : *« Ce service n'est pas une urgence. En cas d'urgence, contactez le 14 ou rendez-vous aux urgences les plus proches. »*
**Pas de** détection de risque automatisée, **pas d'**engagement de délai de réponse en Mois 1.
**Note.** Décision prise sciemment pour tenir le délai. À revisiter avant montée en charge.

### ADR-016 — Phase cloud encadrée : ADR-001 **suspendue**, pas annulée
**Date.** 2026-08-02. **Statut.** Active jusqu'à l'achat du serveur du cabinet.

**Décision.** Développer sur Supabase Cloud, migrer vers l'auto-hébergé à l'achat d'une machine 16–32 Go. ADR-001 reste la décision applicable ; elle est **suspendue pour la phase de développement**, et **redevient applicable de plein droit** à la migration.

**Pourquoi maintenant.** Le PC serveur n'existe pas. Le poste de développement (i3 bicœur, 7,9 Go) ne peut pas héberger la pile — `scripts/s0-provision.sh` le refuse par construction. Le projet était à l'arrêt sur du matériel.

**Pourquoi ce n'est pas une violation de R1.** R1 protège la **donnée**, pas le serveur. Un Postgres cloud sans aucune donnée patient réelle ne viole ni R1 ni la Loi 18-07. Le motif de rejet d'ADR-001 — « la migration d'un Postgres en production **avec données cliniques réelles** = 2 semaines de risque » — porte précisément sur des données réelles.

**Les trois conditions. Elles ne sont pas des recommandations.**
1. **Accès développeur seul.** Aucun compte pour la Dr. Larbi sur cette instance, aucune démo dessus. Lever cette condition exige de rouvrir cet ADR.
2. **Données synthétiques uniquement**, appliqué par la base (migration `016`), pas par une convention : colonne `is_synthetic`, trigger sur toute table Tier 0/1, et test de couverture qui échoue si une table y échappe.
3. **Migration avant tout patient réel.** Déclencheur double — achat du serveur **ou** premier patient réel, la première condition atteinte l'emportant.

**Ce qui rend la condition 2 tenable.** `app.deployment.environment` est effectivement immuable : écriture directe refusée pour `anon`, `authenticated` **et** `service_role` (un trigger ne se contourne pas avec `service_role`, contrairement à la RLS), voie unique par `app.set_deployment_environment()`, transitions journalisées en ajout seul dans `audit.deployment_transitions`. Un superutilisateur Postgres peut toujours désactiver un trigger : c'est « effectivement immuable », pas inviolable, et c'est écrit tel quel dans la migration.

**Ce qui répond au « 2 semaines de risque ».** La migration est **répétée à blanc** dès que le cloud porte des données synthétiques (`scripts/migrate-to-selfhosted.sh` + `checkpoint-j1a.sh` sur la base restaurée), pas improvisée le jour J. Une restauration jamais testée n'est pas une restauration.

**Conséquence.** `docs/SELF-HOST-SETUP.md` cesse d'être la tâche S0 et devient la **procédure de migration** ; `s0-provision.sh` et `checkpoint-s0.sh` sont conservés inchangés pour ce jour-là.

#### Amendement du 2026-08-03 — un compte **développeur** connectable, la condition 1 intacte

**Ce qui change.** Un seul compte de l'instance cloud devient connectable : `…a1` (`owner.dev@invalid.local`), posé par la migration `015`. Les comptes `…a2` (praticien 2) et `…a3` (assistante) gardent leur hash volontairement invalide et **restent inconnectables**.

**Pourquoi c'est nécessaire, et pas un confort.** Le client Supabase utilise la clé `anon` avec session. Sans session, `auth.uid()` est NULL, la RLS ne rend rien, et **tout écran affiche un vide permanent sans le moindre message**. On ne peut donc ni construire ni éprouver un écran clinique. Le jalon S3 était bloqué là, pas ailleurs.

**Pourquoi la condition 1 n'est pas levée.** Elle interdit un accès **praticien** — « aucun compte pour la Dr. Larbi sur cette instance, aucune démo dessus ». Ce compte n'est pas le sien : il porte une identité de cabinet synthétique (la migration `015` a été expurgée de son nom, de son téléphone et de son numéro d'ordre le 2026-08-02, précisément pour que rien de réel ne subsiste). Il ouvre des dossiers fictifs, sur une base que le trigger `assert_synthetic_when_cloud` empêche de recevoir autre chose. La condition 1 protège la donnée réelle et la praticienne, pas le mécanisme d'authentification.

**Ce qui l'encadre.**
- Le mot de passe **n'entre jamais dans une migration** : il vivrait dans le dépôt, donc partagé et irrévocable (I1). Il est lu depuis `.env` par `scripts/dev-account.sh` à l'exécution.
- Le script **refuse de s'exécuter** si `app.deployment` ne confirme pas exactement une ligne `cloud-dev` — et refuse aussi en cas de doute : lecture impossible, table absente, plusieurs lignes.
- **Ce compte disparaît à la migration ADR-001.** La procédure de bascule doit le supprimer, au même titre que le reste des données synthétiques. Un compte de développement survivant sur la machine du cabinet serait un accès `owner` sur des dossiers réels.

**Limite écrite, à ne pas enjoliver.** Quiconque a accès au démon Docker de ce poste peut lire le mot de passe pendant la vie du conteneur éphémère (`docker inspect`). Acceptable sur une machine de développement portant des données synthétiques ; inacceptable sur le serveur du cabinet — et c'est une raison de plus pour que ce script n'y tourne jamais.

### ADR-017 — `reason` sort de `app.appointments` (résout Q-A)
**Date.** 2026-08-02. **Remplace** la « solution » du §5.1 de `01-SCHEMA.md`.

**Le problème.** Le §5.1 protégeait le motif de consultation par une **vue** `appointments_admin` et une règle de revue de code. Ce n'en est pas une protection : la policy `appt_assistant` accorde `FOR ALL` sur `app.appointments`, donc l'assistante peut lire `reason` en interrogeant la table via PostgREST. Une convention n'est pas un contrôle — c'est exactement ce que R4 et la règle 4 de `CLAUDE.md` refusent.

**Décision.** `reason` quitte `app.appointments` pour `app.appointment_reasons` (1-1, `appointment_id` en PK), **sans aucune policy `assistant`** — donc invisible pour elle même en SQL brut, au même titre que les notes cliniques.

**Pourquoi ça marche, alors que la vue non.** La RLS filtre des **lignes**, pas des colonnes. La seule façon de rendre une donnée invisible par RLS est de lui donner sa propre ligne. `app.appointments_admin` reste pour le confort de lecture, mais ne porte plus aucune responsabilité de sécurité.

**Conséquence.** Le test T7 du §15 devient vérifiable : l'assistante interrogeant directement `app.appointment_reasons` doit obtenir **zéro ligne**. Auparavant, il ne constatait que l'absence d'une colonne dans une vue — il ne testait pas le vecteur réel. Coût : une jointure côté praticien.

### ADR-018 — Montants en dinars entiers (résout Q-C)
**Date.** 2026-08-02. **Remplace** `numeric(10,2) amount_dzd` au §10 de `01-SCHEMA.md`.

**Décision.** `integer amount_dzd`, `CHECK (amount_dzd >= 0)`.

**Pourquoi.** Le cabinet encaisse en espèces, en dinars entiers, et n'émet **aucune facture légale** (ADR-010). Il n'y a pas de centimes à stocker. `numeric(10,2)` invitait des décimales qui n'existent pas et imposait une politique d'arrondi à l'affichage partout dans l'interface.

**Rejeté.** Stocker des centimes en entier — robuste en général, inutile ici, et ajoute une conversion à chaque lecture et écriture pour représenter une précision qui n'existe pas.

### ADR-019 — Audit des lectures par fonction, `pgaudit` rejeté en cloud (résout Q-B)
**Date.** 2026-08-02. **Résout** le dernier litige ouvert du §7 de `WORKING-CONTEXT.md`. **Complète** le §12 de `01-SCHEMA.md`.

**Le problème.** I4 exige l'audit des **lectures** de dossier patient. Aucun déclencheur Postgres ne voit un `SELECT` : la migration `013` couvre les écritures et le dit explicitement dans son en-tête. La dette était datée, pas comblée.

**`pgaudit` est rejeté pour la phase cloud.** L'extension est disponible sur Supabase, mais elle journalise le **texte de la requête** dans le log Postgres, lequel part vers l'ingestion de logs de Supabase. Un `SELECT … WHERE id = '<patient_id>'` dans ce flux est une donnée identifiante qui quitte la machine : règle 1 de `CLAUDE.md` et **I5**. S'y ajoutent trois défauts moindres — non joignable à `audit.log`, non *append-only* au sens d'I4, rétention non maîtrisée. Le remède aurait fabriqué exactement la fuite qu'il prétend surveiller.

**Décision.** L'accès en lecture au dossier patient passe par deux fonctions qui journalisent avant de retourner, dans la même transaction, et le chemin direct est **fermé** :

```sql
REVOKE SELECT ON app.patients FROM authenticated, service_role;
app.search_patients(q, p_limit, p_offset)   -- SECURITY INVOKER
app.get_patient(p_id)                       -- SECURITY INVOKER
```

**Pourquoi `SECURITY INVOKER`.** La RLS de `004` s'applique inchangée et aucun privilège n'est élargi. Ce qui disparaît, c'est le chemin non audité — rien d'autre.

**Pourquoi pas un appel applicatif discipliné.** C'était la première rédaction de ce plan : chaque service appelle `log_read()` à la main. Elle portait sa propre faille, écrite noir sur blanc — *un appel oublié n'est pas tracé*. Même raisonnement qu'ADR-017 : on ferme le chemin, on ne discipline pas l'usage. Lire un dossier sans laisser de trace n'est plus une question de rigueur du développeur, **c'est un `permission denied`**.

**Charge journalisée.** `patient_id`, acteur, rôle, horodatage, libellé de contexte. **Jamais un nom, jamais un contenu de colonne** (I5).

**Limite, et elle est réelle.** Un superutilisateur Postgres lit toujours la table en direct. Même portée qu'ADR-016 §3 : *effectivement* fermé pour l'application, PostgREST, les edge functions et Jarvis ; pas *inviolable*. Ne pas présenter cette couverture comme totale.

**Coût assumé.** Les filtres et la pagination PostgREST ne s'appliquent plus à `app.patients` — ils deviennent des paramètres de fonction. Toute jointure future ayant besoin de l'identité patient devra passer par ces deux portes. C'est une contrainte, et c'est le but.

**Réévaluation.** À la migration auto-hébergée (ADR-001), le log Postgres ne quitte plus le PC du cabinet : `pgaudit` redevient pertinent — en **second filet sous** ces fonctions, jamais à leur place.

### ADR-020 — L'accès aux données passe par un port, pas par un client Supabase
**Date.** 2026-08-02. **Condition de faisabilité d'ADR-001.**

**Le problème.** ADR-016 promet que le retour à l'auto-hébergé sera « un changement de configuration, pas une reconstruction ». Cette promesse est vide si chaque service importe `@supabase/supabase-js` et parle le dialecte PostgREST : le jour du basculement, il faudrait réécrire toute la couche d'accès.

**Décision.** `src/services/*` ne dépend que d'une interface `DbPort` (`query`, `rpc`, `paginate`). Un unique adaptateur, `src/services/db/supabase.ts`, est le **seul fichier du dépôt autorisé à importer `@supabase/supabase-js`** — garanti par `no-restricted-imports` et par le préflight, donc par une erreur de compilation et non par une consigne.

**Ce que ça achète.** Postgres local (ADR-001), Electron, mode hors-ligne, agents IA locaux et tests sans réseau se branchent par un second adaptateur, sans toucher un service. C'est le point d'extension qui rend I3 utile au-delà du rangement de fichiers.

**Rejeté — un dépôt (*repository*) par table.** Vingt-neuf classes pour envelopper vingt-neuf tables ajoute une couche sans rien fermer. `DbPort` suffit ; une abstraction qui ne supprime pas une dépendance n'en est pas une.

**Rejeté — un assistant de transaction.** PostgREST n'expose pas de transaction multi-requêtes : un tel assistant donnerait une garantie d'atomicité **fausse**, ce qui est pire que son absence. Quand l'atomicité sera requise, elle sera écrite en fonction Postgres — comme `app.set_deployment_environment()` et `app.get_patient()` le font déjà.

---

## 4. PÉRIMÈTRE DES 2 JOURS

### 4.1 Doit fonctionner réellement — J+2
| Module | Contenu |
|---|---|
| **Auth & rôles** | Connexion, 4 rôles, RLS active et testée |
| **Patients** | Liste, fiche, création, édition, recherche, historique |
| **Diary / Agenda** | Vue jour/semaine, création RDV, statuts, file d'attente |
| **Consultation** | Démarrer séance, timer, transcription live, analyse live, note structurée, signature |
| **Traitements / Ordonnance** | Sélection médicament, posologie, durée, impression |
| **Documents** | 4 certificats + ordonnance, génération et impression |
| **Finance (minimal)** | Saisie prix, notification assistante, journal des paiements |
| **Vue assistante** | Agenda, ajout patient, confirmation RDV web, prix, sans accès clinique |
| **Accueil QR** | Formulaire multilingue, file `pending_patients`, validation |
| **Jarvis (texte)** | Commandes texte, allowlist d'outils, garde-fou de confirmation visible |
| **Journal d'activité** | Audit trail lisible |

### 4.2 Coquilles fonctionnelles — écran réel, logique différée
Communications · Aftercare Follow-up · Reports & Analytics · AI Agents · Settings (partiel)

> Ces écrans existent, sont navigables, affichent un état vide honnête. Ils **ne mentent pas** avec de fausses données.

### 4.3 Explicitement hors périmètre — Mois 1
Jarvis vocal (wake word, TTS) · agents marketing/externes · WhatsApp · site public · app mobile native · inférence locale

### 4.4 Ce que je refuse de promettre
Jarvis **vocal** en 2 jours. Le pipeline wake-word → STT → intention → outil → TTS est un sous-système entier. Le forcer sur J2 fait tomber tout le reste. **Jarvis texte J2 → Jarvis vocal J4–J6.**

---

## 5. SÉQUENCE DE CONSTRUCTION

```
J0  (préparation, avant les 2 jours)
    Setup WSL2 + Docker + Supabase self-hosted
    Comptes Windows séparés, BitLocker
    Repo Git, .gitignore, secrets serveur
    → si J0 n'est pas fait, les 2 jours ne tiennent pas

J1  matin   Schéma + RLS + audit + seed
    aprèm   Auth, rôles, shell applicatif, Patients, Diary
J2  matin   Consultation + transcription + analyse live + note
    aprèm   Ordonnance/Vidal, Documents, Finance, vue assistante, QR, Jarvis texte
J3  tampon  Tests réels, corrections, sauvegardes, formation
```

**Règle de checkpoint.** Chaque étape se termine par un test vert/rouge copiable-collable. Aucun passage à l'étape suivante sur un checkpoint rouge. Commit Git après chaque validation.

---

## 6. RISQUES OUVERTS

| # | Risque | Gravité | Mitigation |
|---|---|---|---|
| RSK-1 | Disque 256 GB saturé | 🔴 | H1 avant J1 |
| RSK-2 | Coupure Wi-Fi pendant séance | 🟠 | Ethernet + buffer local de transcription |
| RSK-3 | Windows 10 EOL non patché | 🟠 | H3 semaine 2 |
| RSK-4 | Panne disque unique = perte totale | 🔴 | ADR-014 appliqué semaine 1 |
| RSK-5 | 16 GB RAM insuffisants sous charge | 🟠 | Surveiller ; sinon 32 GB (~15 000 DZD) |
| RSK-6 | Qualité STT sur darija mixte | 🟠 | Toujours éditable par le médecin ; jamais auto-validé |
| RSK-7 | Modèle d'ordonnance manquant | 🟡 | **À fournir avant J2** |
| RSK-8 | Pas d'IP fixe → accès externe | 🟡 | Tailscale (Mois 1) au lieu d'un port ouvert |

---

## 7. À FOURNIR PAR AYOUB

- [ ] **Modèle d'ordonnance** (photo/scan) — bloquant J2
- [ ] Logo en vectoriel ou PNG haute résolution
- [ ] Arbitrage sur la faute « Pychiaterie »
- [ ] Liste des ~60 médicaments réellement prescrits
- [ ] Tarifs pratiqués (fourchette)
- [ ] Confirmation : NVMe 1 TB commandé ?

---

## 8. DÉCISIONS EN ATTENTE

| # | Sujet | Nécessaire pour |
|---|---|---|
| P-1 | Numérotation des certificats | 01-SCHEMA |
| P-2 | Durée de rétention des dossiers (DZ : à confirmer) | 01-SCHEMA |
| P-3 | L'assistante voit-elle le motif de consultation ? *(recommandation : non)* | RLS |
| P-4 | Accès de la Dr. #2 aux patients partagés ? *(recommandation : non, cloison stricte)* | RLS |

---

*Fin du document. Prochain livrable : `01-SCHEMA.md`.*
