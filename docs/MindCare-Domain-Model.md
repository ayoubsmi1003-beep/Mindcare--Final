# MindCare-Domain-Model.md
### Modèle de domaine · MindCare OS · v2
**Statut : contraignant.** Ce document décrit *pourquoi* le système est structuré ainsi. Il remplace `MindCare-Domain-Model-Phase1.md`.

**Séparation des rôles documentaires**

| Document | Répond à | Nature |
|---|---|---|
| **Ce document** | Pourquoi ? Quelles règles ? | Écrit à la main |
| `MindCare-Schema-Reference.md` | Quoi, physiquement ? | **Généré** depuis la base |
| `MindCare-Domain-Events.md` | Que se passe-t-il ensuite ? | Écrit à la main |
| `MindCare-Permissions-Matrix.md` | Qui a le droit ? | Écrit à la main |
| `001/002/003_*.sql` | **Source de vérité** | Exécutable, testé |

Si ce document et le SQL divergent, **le SQL a raison** et ce document est corrigé.

---

## 1. Contextes délimités

Huit contextes en Phase 1. Chacun possède ses données ; aucun n'écrit dans les tables d'un autre.

```
┌─────────────┐   ┌─────────────┐   ┌──────────────┐
│  Identité   │   │   Patient   │   │    Agenda    │
│  & Accès    │   │             │   │  (+ tampon)  │
└─────────────┘   └─────────────┘   └──────────────┘
┌─────────────┐   ┌─────────────┐   ┌──────────────┐
│Consultation │   │ Traitement  │   │ Facturation  │
│  & Notes    │   │             │   │              │
└─────────────┘   └─────────────┘   └──────────────┘
┌─────────────┐   ┌──────────────────────────────┐
│Communication│   │  Système                     │
│  sortante   │   │  audit · événements · config │
└─────────────┘   └──────────────────────────────┘
```

**Réservés, non implémentés** : Aftercare · Intake · Consentement · Connaissance · AgentOS · Analytique.

**Règle de communication** : un contexte lit les données d'un autre par son interface de service, jamais par requête SQL directe sur ses tables. Les effets asynchrones passent par les événements de domaine.

---

## 2. Agrégats

Un agrégat est une frontière de cohérence : ce qui doit être vrai **dans la même transaction**.

| Agrégat | Racine | Contient | Frontière |
|---|---|---|---|
| **Patient** | `patients` | contacts, étiquettes, fusions | Un patient et ses moyens de contact sont cohérents ensemble |
| **DemandeRDV** | `appointment_requests` | — | Vit et meurt sans jamais toucher l'agenda |
| **RendezVous** | `appointments` | historique de statut | Un statut et sa trace changent ensemble |
| **Consultation** | `consultations` | note, amendements | Une consultation possède **une** note |
| **Ordonnance** | `prescriptions` | lignes | Les lignes n'existent pas sans l'ordonnance |
| **Facture** | `invoices` | paiements | Le statut découle de la somme des paiements |
| **PieceJointe** | `attachments` | liens | Un fichier, plusieurs rattachements |

**Deux agrégats ne se modifient jamais dans la même transaction.** Le lien passe par un événement.

---

## 3. Invariants

Vérités qui ne peuvent **jamais** être fausses. Chacune est appliquée par la base, pas par le code.

| # | Invariant | Mécanisme |
|---|---|---|
| I-1 | Une note signée ne change plus | Déclencheur `guard_signed_note` |
| I-2 | Une note n'est jamais supprimée | Déclencheur `forbid_delete` |
| I-3 | `status='signed'` implique `locked_at` et `signed_by` | Contrainte `note_signed_consistency` |
| I-4 | Le journal d'audit est en ajout seul | Déclencheur `forbid_audit_mutation` |
| I-5 | Les événements de domaine sont en ajout seul | Même déclencheur |
| I-6 | Numérotation sans trou | `document_counters` + verrou transactionnel |
| I-7 | Un message sortant a un approbateur | `approved_by NOT NULL` |
| I-8 | Une consultation appartient à un rendez-vous | Index unique |
| I-9 | Une consultation a au plus une note | Index unique |
| I-10 | `ends_at > starts_at` | Contrainte `appt_time_order` |
| I-11 | Un patient ne fusionne pas avec lui-même | Contrainte `merge_not_self` |
| I-12 | Une notification a une cible | Contrainte `notif_has_target` |
| I-13 | Deux écritures concurrentes ne s'écrasent pas | `lock_version` + déclencheur |
| I-14 | Sans contexte de rôle, aucune donnée clinique n'est lisible | RLS, échec fermé |

> **Principe** : un invariant appliqué uniquement en code applicatif n'est pas un invariant. C'est une intention.

---

## 4. Machines à états

### 4.1 Patient
```
prospect ──valider──► actif ──inactivité──► inactif
   │                    ▲                      │
   └──rejeter──►archivé └──────réactiver───────┘
```
`prospect` — créé par une demande en ligne ou un QR, non validé
`actif` — patient réel ; **seul état autorisant une ordonnance**
`inactif` — automatique après `patient_inactive_months` (défaut 12, configurable)
`archivé` — prospect non converti

### 4.2 Demande de rendez-vous *(zone tampon)*
```
recue ──prendre en charge──► en_cours_appel
                                   │
        ┌──────────────────────────┼──────────────────────┐
        ▼                          ▼                      ▼
    confirmee                  refusee              injoignable
        │                                                 │
   crée un RendezVous                        (3 tentatives) → abandonnee
```
**Règle structurelle** : la zone tampon est une **table séparée**, pas un statut de `appointments`. Il est donc *impossible* qu'une demande non confirmée apparaisse dans l'agenda du médecin. On ne dépend pas d'un filtre qu'un développeur pourrait oublier.

### 4.3 Rendez-vous
```
planifie ──arrivée──► en_attente ──démarrer──► en_cours ──terminer──► termine
   │                       │                                              │
   ├──reporter──►reporte   └──20 min sans arrivée──► absent    crée une Consultation
   └──annuler───►annule
```

| Transition | Autorisée à |
|---|---|
| arrivée | assistante, médecin |
| démarrer, terminer | **médecin seul** |
| annuler, reporter | assistante, médecin |
| absent | assistante, médecin — **jamais automatique** |

### 4.4 Note clinique
```
brouillon ──signer──► signee  ⛔ verrouillée définitivement
    │                    │
librement modifiable  toute correction → amendement
```

### 4.5 Ordonnance
```
brouillon ──émettre──► emise ──imprimer──► imprimee
                          │                    │
                          └───annuler───► annulee
                              (motif obligatoire)
```
Le numéro consommé n'est **jamais** réutilisé.

### 4.6 Facture
```
brouillon ──émettre──► emise ──paiement total──► payee
                         │
                         ├──paiement partiel──► partiellement_payee ──► payee
                         └──annuler──► annulee   (avoir, jamais suppression)
```

### 4.7 Livraison d'événement
```
pending ──► processing ──► done
    ▲            │
    │            └──échec──► failed ──recul──► pending
    │                            │
    └────rejeu manuel────── (5 tentatives) ──► dead
```

---

## 5. Règles métier

Numérotées pour référence dans le code et les revues.

### Clinique
- **BR-1** Seul un patient `actif` peut recevoir une ordonnance.
- **BR-2** Un renouvellement pour un patient non vu depuis `renewal_review_days` (90) exige une confirmation renforcée.
- **BR-3** Une note ne se signe qu'après `ConsultationEnded`.
- **BR-4** Un diagnostic n'est pas supprimé — il est résolu avec une date.
- **BR-5** Deux absences consécutives sont un **signal clinique**, pas administratif.
- **BR-6** Un patient <14 jours après une nouvelle molécule est en fenêtre de vigilance.

### Documentaire et légal
- **BR-7** Après signature, seul un amendement motivé corrige une note.
- **BR-8** Ordonnances et factures : numérotation annuelle sans trou.
- **BR-9** Annulation = avoir visible, jamais suppression.
- **BR-10** Toute écriture produit une entrée d'audit **et** un événement de domaine, dans la même transaction.

### Accès
- **BR-11** L'assistante n'accède ni aux notes, ni aux diagnostics, ni au contenu des ordonnances.
- **BR-12** L'admin n'accède à aucune donnée clinique.
- **BR-13** Sans contexte de rôle, la base renvoie zéro ligne. Échec fermé.

### Communication
- **BR-14** Aucun message sans `approved_by`.
- **BR-15** Aucun contenu clinique dans un message patient.
- **BR-16** Le médecin peut toujours relire ce qui a été envoyé en son nom.

### IA *(applicable dès la Phase 3)*
- **BR-17** Un agent n'a jamais plus de droits que l'acteur qui l'a déclenché.
- **BR-18** Une instruction contenue dans un contenu lu ne confère aucune autorité.
- **BR-19** Aucun agent ne signe, ne prescrit, ni n'émet un document.
- **BR-20** Aucun appel externe ne porte de donnée identifiable non pseudonymisée.
- **BR-21** `RiskSignalDetected` emprunte un chemin indépendant, non supprimable.

---

## 6. Décisions transversales

### 6.1 Concurrence — verrouillage optimiste
`lock_version` sur les tables à écriture concurrente. Le client renvoie la version lue ; si elle a changé, l'écriture est **rejetée** avec un message exploitable, pas écrasée silencieusement.

Choix de l'optimiste plutôt que du pessimiste : dans un cabinet solo, les conflits sont rares mais les verrous oubliés seraient fréquents et paralysants.

### 6.2 Suppression — jamais physique
`deleted_at` partout. Deux raisons : obligation légale de conservation, et un dossier effacé par erreur est irrécupérable. Les notes cliniques ont en plus un déclencheur de refus de `DELETE`.

### 6.3 Temps
`timestamptz` exclusivement. Serveur en `Africa/Algiers`. Aucune date en texte.

Distinction stricte : `starts_at` est le **prévu**, `started_at` le **réel**. Confondre les deux rend toute analyse d'activité fausse.

### 6.4 Numérotation
Table compteur avec verrou, **pas de séquence Postgres**. Une séquence saute des numéros en cas de rollback ; une facture manquante est un problème fiscal.

### 6.5 Recherche
`search_key` est une colonne **générée** : minuscules, sans accent, sans espace ni tiret. Impossible d'oublier de la mettre à jour.

Elle traite la réalité onomastique algérienne : `Bel Kacem` / `Belkacem` / `bel-kacem` produisent la même clé. Un échec de recherche crée un doublon, et un doublon en psychiatrie est un risque de sécurité.

### 6.6 Fusion de doublons
Le doublon n'est pas supprimé : `merged_into_id` pointe vers le patient conservé, et `patient_merges` conserve le motif et l'auteur.

`PatientMerged` a une contrainte d'ordonnancement forte — tout consommateur doit le traiter avant tout événement ultérieur concernant l'identifiant fusionné.

### 6.7 Configuration
Table `settings`, pas de constantes en code. Seuils d'inactivité, de renouvellement, d'attente, d'expiration de session. Dr. Larbi les ajuste sans redéploiement.

**Une seule table de configuration.** Pas de table `feature_flags` séparée — ce serait un second endroit où chercher.

### 6.8 Chronologie
`patient_timeline` est une **vue**, jamais une table. Une table dupliquerait les données et créerait une seconde vérité qui divergerait.

Extension future = un `UNION ALL` de plus. Zéro migration.

---

## 7. Coutures d'extension

Comment chaque module futur s'attache sans toucher aux tables existantes.

| Module | Rattachement | Impact |
|---|---|---|
| **Intake tablette** | `intake_submissions.patient_id` | Nouvelles tables + branche de vue |
| **Échelles psychométriques** | `scale_administrations.consultation_id` | Idem |
| **Aftercare** | `checkins.patient_id` | Idem |
| **Consentement** | `consents.patient_id` | Vérifié par la couche application |
| **Mémoire agents** | `agent_memory` avec `scope` + `owner_id` | Table isolée |
| **Exécutions agents** | `agent_runs` | Table isolée |
| **Portail patient** | Vues restreintes | Aucune table nouvelle |
| **Multi-praticien** | `appointments.practitioner_id` | Colonne, non une refonte |
| **Multi-cabinet** | `clinic_id` déjà présent partout | Politiques RLS à ajouter |
| **Notes structurées** | `note_sections.note_id` | `content` reste du texte libre |

**La raison pour laquelle ça marche** : toutes les clés étrangères futures pointeront vers `patients`, `consultations` et `appointments`, qui sont les trois tables les plus stables du système.

**Ce qui n'est pas créé aujourd'hui** : aucune table vide. Une table vide créée maintenant serait redessinée dans six semaines. La stabilité des points d'ancrage suffit.

---

## 8. Réserve clinique — les notes

`clinical_notes.content` est du **texte libre**, délibérément.

Le format SOAP est *un* style. Beaucoup de psychiatres écrivent en narratif continu. Imposer une structure qui n'est pas celle de Dr. Larbi garantit qu'elle contournera l'outil dès la deuxième semaine.

La structuration viendra par une table `note_sections` **optionnelle**, quand on saura comment elle écrit réellement. Le narratif ne doit jamais devenir impossible.

Même logique pour l'enrichissement clinique du patient — antécédents, allergies, histoire familiale, traumatismes, consommations, sommeil, soutien social, facteurs protecteurs. Ce sont des **modules cliniques séparés**, jamais des colonnes ajoutées à `patients`. Une table `patients` obèse devient illisible et impossible à sécuriser finement.

---

## 9. Ce que ce modèle interdit

- Écrire dans les tables d'un autre contexte
- Modifier deux agrégats dans la même transaction
- Appliquer un invariant uniquement en code applicatif
- Supprimer physiquement une donnée clinique
- Créer une table dupliquant une information existante
- Ajouter une colonne clinique à `patients`
- Créer une seconde table de configuration
- Déployer un agent sans fiche dans la matrice de permissions

---

*Version 2. Aligné sur les migrations 001, 002, 003. Toute modification exige une entrée ADR.*
