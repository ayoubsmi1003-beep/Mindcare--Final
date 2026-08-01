# MindCare OS — Architecture, base de données et roadmap
### Document de référence pour le build · v1

---

## 1. LA BASE DE DONNÉES — comprendre la logique

Avant les tables, comprends les cinq principes. Si tu comprends ça, tu peux relire n'importe quel schéma et voir s'il est juste.

### Principe 1 — Une seule source de vérité
Un patient existe **une fois**. Son numéro de téléphone existe une fois. Un rendez-vous existe une fois. Tout le reste pointe vers ça par une clé étrangère. Si tu vois la même information stockée à deux endroits, c'est un bug en attente.

### Principe 2 — On n'efface jamais
Pas de `DELETE` sur les données cliniques. Jamais. On met `deleted_at` et l'enregistrement disparaît de l'interface mais reste en base. Raison légale : Loi 18-07 impose une durée de conservation. Raison clinique : un dossier effacé par erreur est irrécupérable.

### Principe 3 — Une note signée ne se modifie plus
Quand Dr. Larbi signe un compte rendu, on écrit `locked_at`. À partir de là, toute correction crée un **amendement** lié à la note d'origine. On ne fait jamais `UPDATE` sur le texte. C'est ce qui donne au dossier sa valeur légale.

### Principe 4 — Tout est horodaté en `timestamptz`
Jamais `timestamp` sans fuseau. Jamais de date stockée en texte. Fuseau du serveur : `Africa/Algiers`.

### Principe 5 — Tout est tracé
Chaque écriture émet une ligne dans `audit_log` : qui, quoi, quand, valeur avant, valeur après. Y compris les actions des agents IA. C'est non négociable et c'est ce qui te protège juridiquement.

---

### 1.1 Les tables du socle (v0.1)

**Identité et accès**
| Table | Rôle |
|---|---|
| `users` | Médecin, assistante, admin. Mot de passe haché, jamais en clair. |
| `roles` / `permissions` | Ce que chaque rôle peut voir et faire |
| `sessions` | Sessions actives, expiration, déconnexion forcée |

**Patients**
| Table | Rôle |
|---|---|
| `patients` | Identité, contact, date de naissance, statut (`prospect` / `actif` / `inactif`) |
| `patient_identifiers` | Numéro de dossier, pièce d'identité. Séparé pour pouvoir chiffrer plus tard. |
| `patient_contacts` | Téléphones, WhatsApp, email. Plusieurs par patient. |
| `patient_tags` | Étiquettes libres du médecin |
| `patient_merges` | Historique des fusions de doublons — jamais de suppression |

**Agenda**
| Table | Rôle |
|---|---|
| `appointment_requests` | La zone tampon. Demandes non confirmées. |
| `appointments` | Rendez-vous confirmés uniquement |
| `appointment_status_history` | Chaque changement de statut, horodaté |
| `availability_rules` | Horaires d'ouverture, pauses, congés |
| `waiting_list` | Patients en attente d'un créneau |

**Clinique**
| Table | Rôle |
|---|---|
| `consultations` | Une par séance. Lien vers le rendez-vous. |
| `clinical_notes` | Le texte. `locked_at`, `signed_by`. |
| `note_amendments` | Corrections post-signature |
| `diagnoses` | Diagnostics, avec date de pose et de révision |
| `intake_submissions` | Réponses du questionnaire tablette |
| `intake_summaries` | Résumé généré par l'agent, avec le modèle utilisé |
| `psychometric_scales` | Échelles administrées et scores |

**Traitements**
| Table | Rôle |
|---|---|
| `medications` | Référentiel des molécules |
| `prescriptions` | Ordonnance émise. Immuable une fois imprimée. |
| `prescription_lines` | Molécule, posologie, durée |
| `prescription_renewals` | Historique des renouvellements |

**Finances**
| Table | Rôle |
|---|---|
| `invoices` | Numérotation **sans trou**, via table compteur — pas une séquence Postgres |
| `invoice_counter` | Le compteur. Verrou transactionnel. |
| `payments` | Encaissements, mode, montant DZD |
| `cash_sessions` | Journal de caisse par jour |

**Système**
| Table | Rôle |
|---|---|
| `audit_log` | Append-only. Jamais de modification. |
| `schema_migrations` | Suivi des migrations appliquées |
| `agent_runs` | Chaque exécution d'agent : entrée, sortie, modèle, coût, durée |
| `outbound_messages` | Tout message sortant, avec son statut et son contenu exact |

> **Note importante** : `clinic_id` est présent sur chaque table métier et vaut toujours `1`. Ça ne sert à rien aujourd'hui. Ça t'évitera une migration douloureuse le jour où un deuxième praticien arrive.

---

## 2. LA MÉMOIRE DE JARVIS ET DES AGENTS

Ta question 7. Il y a quatre types de mémoire, et les confondre est l'erreur classique.

| Type | Contenu | Où | Durée |
|---|---|---|---|
| **Mémoire de travail** | La conversation en cours | RAM | Minutes |
| **Mémoire épisodique** | « Le 12 mars, Dr. Larbi a demandé X » | `agent_runs` + table `memories` | Années |
| **Mémoire sémantique** | Faits stables : préférences, habitudes, modèles de documents | Table `memories`, typée | Permanent, révisable |
| **Mémoire documentaire** | Le dossier patient lui-même | Les tables cliniques | Légale |

**La règle qui évite le désastre** : Jarvis ne « se souvient » jamais d'un fait clinique. Il **relit la base**. Si tu laisses un agent mémoriser « Karim prend de la sertraline », tu auras un jour un agent qui affirme une posologie périmée. Le dossier est la vérité ; la mémoire de l'agent ne contient que des préférences de travail et de l'historique d'interaction.

**Pour « many persons future »** : chaque enregistrement de mémoire porte un `scope` (`user` / `patient` / `clinic`) et un `owner_id`. Un agent qui travaille sur le patient A ne peut pas lire la mémoire du patient B. Ça se met en place maintenant en trois colonnes ; ça se rattrape très mal plus tard.

---

## 3. AGENTS : DANS L'APP OU DANS n8n ?

| Critère | Backend de l'app | n8n |
|---|---|---|
| Synchrone, l'utilisateur attend | ✅ | ❌ |
| Doit tourner app fermée | ❌ | ✅ |
| Touche des données cliniques | ✅ | ⚠️ via API seulement |
| Modifiable sans redéploiement | ❌ | ✅ |
| Intégration externe (WhatsApp) | ❌ | ✅ |
| Audit transactionnel | ✅ | Partiel |

**Répartition recommandée :**

*Backend* — résumé d'intake, brief de consultation, brief du matin, détection de risque, recherche documentaire, moteur d'attention.

*n8n* — réception WhatsApp, rappels J-1, relances de patients inactifs, sauvegardes, veille scientifique nocturne, notifications.

**Deux règles absolues :**
1. n8n n'écrit jamais directement dans PostgreSQL. Il appelle l'API de l'app.
2. La détection de risque ne passe jamais par n8n. Chemin indépendant, dans le backend, avec sa propre trace d'audit.

---

## 4. STRATÉGIE DE TOKENS ET DE BUILD

Ta question 4. Comment construire vite, bien, sans brûler ton quota.

### Le principe central
**Le modèle cher décide, le modèle bon marché exécute.** Tu ne dois jamais demander à un modèle premium de taper du CRUD.

| Tâche | Modèle | Pourquoi |
|---|---|---|
| Architecture, schéma SQL, décisions | Opus / Fable | Une erreur ici coûte des jours |
| Découpage en tâches, plan de checkpoints | Opus / Fable | Idem |
| Implémentation CRUD, formulaires, composants | DeepSeek V4 Flash / GLM-5.2 | Volume, faible risque |
| Débogage | GLM-5.2, escalade si bloqué | Itératif, beaucoup de tokens |
| Revue de sécurité, revue du schéma | Opus / Fable | Le coût d'une faille est infini |

### Les six règles qui économisent le plus

1. **`CLAUDE.md` est ton meilleur investissement.** Chaque règle écrite dedans est une règle que tu ne réexpliqueras jamais. Chaque réexplication coûte des tokens et introduit de la variance.

2. **Plan mode d'abord, toujours.** Faire produire le plan, le relire, le corriger, *puis* exécuter. Corriger un plan coûte 500 tokens. Corriger du code coûte 20 000.

3. **Une tâche = un contexte propre.** Ne laisse jamais une session Claude Code grossir sur dix tâches. Contexte long = coût qui explose et qualité qui baisse. Nouvelle tâche, nouvelle session, `CLAUDE.md` recharge tout ce qui compte.

4. **Sous-agents pour les tâches indépendantes seulement.** Les 8 modules du socle ne sont pas indépendants — ils partagent le schéma. Fais le schéma une fois, en séquentiel, puis parallélise les modules qui ne se touchent pas (Finances et Traitements peuvent aller en parallèle ; Patients et Agenda non).

5. **Checkpoints verts/rouges avec commande de test copiable.** Ne jamais avancer sur un rouge. Un checkpoint rouge ignoré coûte trois checkpoints de débogage plus tard.

6. **Commit après chaque checkpoint validé.** Ça te donne un point de retour. Sans ça, une session qui part en vrille te fait perdre une journée.

### L'anti-pattern à éviter absolument
Demander « construis-moi l'application ». Le modèle va halluciner une architecture, inventer des tables, et tu passeras trois jours à défaire. Tu donnes le schéma, tu donnes la structure de dossiers, tu donnes une tâche à la fois.

---

## 5. ROADMAP

### Phase 0 — Préparation *(avant de coder — 2 à 3 jours)*
Serveur installé, réseau configuré, onduleur en place, les 11 artefacts prêts, restauration de sauvegarde testée sur machine vierge.
**Critère de sortie** : tu peux restaurer une base vide sur un PC neuf en moins de 20 minutes.

### Phase 1 — Le socle *(3 jours)*
Auth · Patients · Agenda · Consultations & notes · Traitements · Encaissements · Audit · Sauvegarde.
**Critère de sortie** : Dr. Larbi peut faire une journée complète de consultations sans papier.

### Phase 2 — Le tampon assistante *(1 semaine)*
Demandes de rendez-vous, tableau de confirmation, saisie téléphonique, liste d'attente, rappels J-1.
**Critère de sortie** : l'agenda du médecin ne contient que du confirmé.

### Phase 3 — Intake QR *(1 à 2 semaines)*
Questionnaire multilingue AR / Darija / FR, échelles psychométriques auto-sélectionnées, résumé par agent, création automatique du prospect.
**Critère de sortie** : un nouveau patient est documenté avant d'entrer dans le bureau. *Règle clinique : aucune suggestion d'effets secondaires.*

### Phase 4 — WhatsApp et site *(2 à 3 semaines)*
Numéro dédié, Evolution API, chatbot du site, réservation en ligne alimentant la zone tampon.
**Critère de sortie** : un patient réserve seul, l'assistante confirme, personne n'a rien tapé deux fois.

### Phase 5 — Jarvis et agents *(3 à 4 semaines)*
Voix, orbe, brief du matin, moteur d'attention, mémoire, propose-confirme-exécute-journalise sur toutes les écritures.
**Critère de sortie** : Dr. Larbi commence sa journée sans ouvrir un seul écran.

### Phase 6 — Aftercare patient *(3 à 4 semaines)*
Portail patient, check-ins, suivi humeur/sommeil/observance, détection de dérive, escalade au médecin.

### Phase 7 — Bureau natif et GPU local *(2 semaines)*
Enveloppe Tauri, accès PC réel, migration vers modèles locaux par changement de configuration — pas de reconstruction.

---

## 6. SÉCURITÉ — ce qui est non négociable dès la Phase 1

| Mesure | Pourquoi |
|---|---|
| Aucune redirection de port sur le routeur | Le système n'est pas joignable depuis internet. Meilleure protection, coût zéro. |
| Disque serveur chiffré | Un PC volé ne doit pas être un dossier médical volé |
| Onduleur | Coupure pendant une écriture = corruption de base |
| Sauvegarde 3-2-1 | 3 copies, 2 supports, 1 hors site. Chiffrée. |
| Restauration testée | Une sauvegarde jamais restaurée n'est pas une sauvegarde |
| Composition séparée par rôle | Masquer des champs fuit par les tooltips, l'impression, le code source |
| Aucune clé en dur | Variables d'environnement côté serveur uniquement |
| Pseudonymisation avant tout appel externe | Loi 18-07 |
| Verrouillage de session à l'inactivité | Le poste de l'assistante est dans un lieu de passage |
| Audit sur chaque écriture | Protection juridique de Dr. Larbi |

---

## 7. LES DÉCISIONS QUI RESTENT À PRENDRE

1. **OS du serveur** — Windows ou Linux ? Change docker-compose, la sauvegarde, le chiffrement.
2. **Reprise de données** — patients existants sur Excel, papier, autre logiciel ? Si oui, c'est une journée dédiée, hors des 3 jours.
3. **Numéro WhatsApp dédié** — à obtenir avant la Phase 4. Jamais le numéro personnel de Dr. Larbi.
4. **Nom de domaine et hébergement du site** — le site public est la seule partie exposée à internet. Il ne doit avoir aucun accès direct à la base du cabinet.
5. **Qui est joignable en cas de panne un vendredi soir ?** À définir avant la mise en production, pas après.

---

*Fin du document. Prochain livrable recommandé : le schéma SQL complet, à relire ligne par ligne ensemble.*
