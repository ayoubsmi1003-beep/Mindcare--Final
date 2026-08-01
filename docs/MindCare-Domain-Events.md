# MindCare-Domain-Events.md
### Catalogue canonique des événements de domaine · MindCare OS
**Statut : contraignant.** Aucun code ne peut émettre un événement absent de ce document.

**Documents liés**
- Infrastructure : `002_domain_events.sql` (tables `domain_events`, `event_outbox`, `event_subscriptions`, fonction `emit_event`)
- Modèle : `MindCare-Domain-Model-Phase1.md`
- Règles : `MindCare_OS_Engineering_Constitution_v1_0.md` §20, ADR-003

---

## 1. Principes

### 1.1 Ce qu'est un événement
Un fait **passé, immuable, métier**. Pas une commande, pas une intention, pas un appel de fonction.

`AppointmentConfirmed` ✅ — un fait
`ConfirmAppointment` ❌ — une commande
`AppointmentTableUpdated` ❌ — un détail technique

### 1.2 La règle transactionnelle
L'événement est écrit **dans la même transaction** que le changement d'état. Pas après, pas via un trigger.

```
BEGIN
  UPDATE appointments SET status = 'planifie' ...
  INSERT INTO audit_log ...
  SELECT emit_event('AppointmentConfirmed', ...)
COMMIT
```

Conséquence : si la transaction échoue, aucun événement fantôme. Si elle réussit, aucun événement perdu. C'est la seule garantie qui compte.

### 1.3 Où l'événement est émis
**Dans la couche `application` (cas d'usage), jamais dans un trigger PostgreSQL.**

Justification : un trigger n'a pas accès à l'intention métier. Il voit `status` passer de `recue` à `confirmee`, mais il ne sait pas si c'est une confirmation d'assistante, une reprise après incident, ou un import. Le cas d'usage le sait.

### 1.4 Nommage
`PascalCase`, **passé**, préfixé par l'agrégat quand il y a ambiguïté.
Un événement n'est **jamais renommé**. Une évolution incompatible crée `EventNameV2`.

### 1.5 Charge utile
Contient **ce qui est nécessaire pour agir**, pas l'entité entière.

| Règle | Raison |
|---|---|
| Toujours les identifiants | Le consommateur relit s'il a besoin de plus |
| Jamais de contenu clinique | Un événement traverse potentiellement la passerelle de sortie |
| Jamais de mot de passe, jeton, secret | Le journal est immuable — une fuite y est permanente |
| Valeurs dénormalisées seulement si stables | Un nom de patient dans la charge utile devient faux après une fusion |

> **Règle absolue** : `domain_events.payload` ne contient jamais de texte clinique. Ni note, ni diagnostic rédigé, ni transcription. Les identifiants suffisent.

---

## 2. Catalogue

Format : **Déclencheur · Charge utile · Producteur · Consommateurs · Effets · Ordonnancement · Audit · Consommateurs IA futurs**

Tous les événements sont : **idempotents côté consommateur** (clé `event_id` + `subscriber`, contrainte `outbox_once`), **rejouables**, et **audités** par construction — le journal `domain_events` est lui-même immuable.

---

### 2.1 Domaine PATIENT

#### `PatientCreated`
- **Agrégat** : Patient
- **Déclencheur** : création d'une fiche, quelle que soit la source
- **Charge** : `{ patient_id, file_number, status, source }` — `source` ∈ `manual` · `request` · `qr_intake` · `import`
- **Producteur** : `PatientService.create`
- **Consommateurs** : `dashboard`, `audit`
- **Effets** : compteur de nouveaux patients ; si `status = prospect`, apparition dans la file de validation
- **Ordonnancement** : aucun prérequis
- **IA futur** : initialisation du Digital Twin ; **jamais** de traitement clinique sur un `prospect`

#### `PatientStatusChanged`
- **Déclencheur** : `prospect → actif`, `actif → inactif`, `→ archive`
- **Charge** : `{ patient_id, from_status, to_status, reason }`
- **Consommateurs** : `dashboard`, `audit`, `reminders`
- **Effets** : `→ inactif` annule les rappels programmés ; `→ actif` autorise l'émission d'ordonnances
- **IA futur** : `actif → inactif` alimente la détection de désengagement — **en psychiatrie, l'inactivité est un signal clinique, pas administratif**

#### `PatientMerged`
- **Déclencheur** : fusion de doublons
- **Charge** : `{ kept_patient_id, merged_patient_id, reason, merged_by }`
- **Consommateurs** : `dashboard`, `audit`, **tout consommateur cachant un nom de patient**
- **Effets** : invalidation de tous les caches ; réattribution des rendez-vous, consultations, factures
- **Ordonnancement** : ⚠️ **critique** — doit être traité avant tout événement ultérieur concernant `merged_patient_id`
- **Réessai** : jusqu'à succès. Un échec laisse des données orphelines. **Ne meurt jamais en DLQ sans alerte immédiate.**
- **IA futur** : fusion des mémoires ; toute mémoire agent référençant l'ancien identifiant doit être réécrite ou invalidée

---

### 2.2 Domaine AGENDA

#### `AppointmentRequested`
- **Agrégat** : AppointmentRequest *(zone tampon)*
- **Déclencheur** : demande via WhatsApp, site, téléphone, ou présentation spontanée
- **Charge** : `{ request_id, source, raw_name, raw_phone_masked, requested_slot, patient_id? }`
- **Consommateurs** : `dashboard` *(assistante uniquement)*
- **Effets** : incrémente le compteur de demandes ; **n'apparaît jamais dans l'agenda du médecin**
- **Audit** : le numéro est **masqué** dans la charge (`+2136•••••42`) — le numéro complet reste en base
- **IA futur** : proposition de créneau ; l'agent **propose**, l'assistante confirme

#### `AppointmentConfirmed` ⭐
- **Déclencheur** : validation par l'assistante ou le médecin
- **Charge** : `{ appointment_id, patient_id, request_id?, starts_at, ends_at, type, confirmed_by }`
- **Consommateurs** : `dashboard`, `reminders`, `audit`
- **Effets en cascade** :
  ```
  AppointmentConfirmed
    ├─ dashboard  → chronologie rafraîchie, créneau occupé
    ├─ reminders  → rappel J-1 programmé  → OutboundMessageQueued
    ├─ audit      → trace
    └─ (futur) jarvis → brief pré-consultation généré à T−30 min
  ```
- **Ordonnancement** : après `PatientCreated`
- **IA futur** : préparation du dossier ; ajustement de la liste d'attente

#### `AppointmentRescheduled`
- **Charge** : `{ appointment_id, old_starts_at, new_starts_at, reason, rescheduled_by }`
- **Effets** : ancien rappel annulé, nouveau programmé ; créneau libéré → vérification de la liste d'attente

#### `AppointmentCancelled`
- **Charge** : `{ appointment_id, patient_id, starts_at, reason, cancelled_by }`
- **Effets** : rappels annulés ; créneau libéré ; **proposition** de patients en attente
- **IA futur** : les annulations répétées d'un même patient alimentent la détection de désengagement

#### `PatientArrived`
- **Charge** : `{ appointment_id, patient_id, arrived_at, minutes_early_or_late }`
- **Consommateurs** : `dashboard`
- **Effets** : entrée en salle d'attente ; démarrage du chronomètre d'attente
- **IA futur** : déclenchement du brief pré-consultation si absent

#### `AppointmentMarkedAbsent`
- **Charge** : `{ appointment_id, patient_id, consecutive_absences }`
- **Effets** : proposition de reprise de contact
- **Règle clinique** : à partir de `consecutive_absences ≥ 2`, l'événement est routé vers la **colonne clinique** du tableau de bord, pas administrative. En psychiatrie, l'absence répétée est un symptôme.
- **Ordonnancement** : **jamais émis automatiquement.** Une action humaine est requise.

---

### 2.3 Domaine CONSULTATION

#### `ConsultationStarted`
- **Charge** : `{ consultation_id, appointment_id, patient_id, session_number, started_at }`
- **Consommateurs** : `dashboard`
- **Effets** : « patient en cours » ; passage en mode Concentration — les notifications sous `urgence_clinique` sont mises en file
- **IA futur** : démarrage de la transcription **si le consentement est en état `granted`**

#### `ConsultationEnded`
- **Charge** : `{ consultation_id, patient_id, duration_minutes }`
- **Effets** : note en attente de signature ; proposition de facture ; sortie du mode Concentration
- **IA futur** : génération du résumé — **en brouillon, jamais signé automatiquement**

#### `ClinicalNoteSigned` ⭐
- **Charge** : `{ note_id, consultation_id, patient_id, signed_by, locked_at }` — **jamais le contenu**
- **Consommateurs** : `dashboard`, `audit`
- **Effets** : décrémente les notes dues ; **la note devient immuable** (garanti par trigger, pas par l'événement)
- **Ordonnancement** : après `ConsultationEnded`
- **Audit** : ⚖️ **valeur légale** — cet événement est une preuve. Rétention permanente.
- **IA futur** : la mémoire des agents ne peut indexer une note qu'**après** signature. Un brouillon n'est pas un fait clinique.

#### `NoteAmended`
- **Charge** : `{ note_id, amendment_id, reason, amended_by }`
- **Audit** : ⚖️ valeur légale. Un amendement sans motif est un défaut de conformité.

#### `DiagnosisRecorded` / `DiagnosisResolved`
- **Charge** : `{ diagnosis_id, patient_id, code?, is_primary }` — **le libellé n'est pas dans la charge**
- **IA futur** : sélection des échelles psychométriques ; ciblage de la veille documentaire

---

### 2.4 Domaine TRAITEMENT

#### `PrescriptionIssued` ⭐
- **Charge** : `{ prescription_id, patient_id, number, consultation_id?, valid_until, line_count }` — **pas les molécules**
- **Consommateurs** : `dashboard`, `audit`
- **Effets** : programmation de la surveillance d'expiration ; **fenêtre de vigilance de 14 jours** si nouvelle molécule
- **Audit** : ⚖️ valeur légale
- **Réessai** : jusqu'à succès
- **IA futur** : suivi d'observance ; **jamais de proposition posologique autonome**

#### `PrescriptionCancelled`
- **Charge** : `{ prescription_id, number, reason, cancelled_by }`
- **Règle** : le numéro n'est **jamais réutilisé**. L'annulation est visible, pas effacée.

#### `PrescriptionRenewalDue`
- **Producteur** : tâche planifiée, J−7
- **Effets** : apparition dans le widget de renouvellement
- **Règle clinique** : si `days_since_last_consultation > 90`, l'événement porte `requires_review: true` — l'interface impose une confirmation supplémentaire

---

### 2.5 Domaine FACTURATION

#### `InvoiceIssued`
- **Charge** : `{ invoice_id, number, patient_id, amount_cents, consultation_id? }`
- **Règle** : numérotation sans trou, garantie par `document_counters` avec verrou transactionnel

#### `PaymentReceived`
- **Charge** : `{ payment_id, invoice_id, amount_cents, method, received_by }`
- **Effets** : recalcul du statut de facture ; encaissements du jour ; caisse
- **Idempotence** : ⚠️ **critique** — un double traitement crée un double encaissement. Contrôle par `payment_id`.

#### `InvoiceCancelled`
- **Règle** : avoir, jamais suppression. Le numéro reste consommé.

---

### 2.6 Domaine COMMUNICATION

#### `OutboundMessageQueued`
- **Charge** : `{ message_id, patient_id?, channel, to_masked, approved_by }`
- **Règle** : `approved_by` est **obligatoire** (contrainte `NOT NULL`). Traduction en base de *propose → confirme → exécute → journalise*.

#### `OutboundMessageSent` / `OutboundMessageFailed`
- **Effets sur échec** : notification à l'assistante après épuisement des tentatives ; **jamais de réessai silencieux illimité** — un patient recevant sept fois le même rappel est un incident

---

### 2.7 Domaine SYSTÈME

#### `BackupCompleted` / `BackupFailed`
- **Consommateurs** : `dashboard` *(admin uniquement)*
- **Effets sur échec** : notification `tier = systeme`, **escalade si deux échecs consécutifs**

#### `RestoreTestPerformed`
- **Charge** : `{ backup_id, outcome, duration_seconds, rows_verified }`
- **Raison d'exister** : une sauvegarde jamais restaurée n'est pas une sauvegarde. Cet événement est la preuve que le test a eu lieu.

---

### 2.8 Réservés — Phase 3+ *(nommés maintenant, non implémentés)*

Nommer maintenant empêche Claude Code d'inventer des variantes plus tard.

`IntakeSubmitted` · `IntakeSummarized` · `ScaleAdministered` · `ScaleScoreChanged` · `CheckInRecorded` · `MoodTrendDeviated` · `SleepTrendDeviated` · `AdherenceBroken` · `RiskSignalDetected` ⚠️ · `ConsentGranted` · `ConsentRevoked` · `AgentRunStarted` · `AgentRunCompleted` · `AgentRunFailed` · `ToolInvoked` · `MemoryWritten` · `TranscriptionFailed`

> ⚠️ **`RiskSignalDetected` est une exception architecturale.** Il ne transite **pas** par l'outbox. Chemin synchrone, indépendant, non supprimable, avec sa propre trace d'audit. Aucun agent ne peut s'interposer entre le signal et le médecin. Aucun mode Concentration ne le met en file.

---

## 3. Architecture de l'outbox

### 3.1 Le worker

Boucle unique, dans le processus applicatif. Pas de service séparé en Phase 1.

```
toutes les 2 s
  ├─ SELECT ... FROM event_outbox
  │    WHERE status IN ('pending','failed') AND next_retry_at <= now()
  │    ORDER BY id
  │    LIMIT 50
  │    FOR UPDATE SKIP LOCKED        ← plusieurs workers sans collision
  ├─ marquer 'processing'
  ├─ pour chaque ligne
  │    ├─ succès → 'done', processed_at = now()
  │    └─ échec  → attempts +1
  │         ├─ attempts < max → 'failed', next_retry_at = now() + backoff
  │         └─ attempts ≥ max → 'dead'  + notification tier=systeme
  └─ recommencer
```

`FOR UPDATE SKIP LOCKED` est la clé : deux workers peuvent tourner sans traiter la même ligne.

### 3.2 Recul exponentiel

| Tentative | Délai |
|---|---|
| 1 | 5 s |
| 2 | 30 s |
| 3 | 2 min |
| 4 | 10 min |
| 5 | 1 h |
| 6 | `dead` |

`next_retry_at = now() + interval '5 seconds' * power(6, attempts)`

### 3.3 File morte

Une ligne `dead` n'est **jamais supprimée automatiquement**. Elle génère une notification `tier = systeme`.

Actions disponibles à l'admin : **rejouer** (remet `pending`, `attempts = 0`) · **abandonner** (motif obligatoire, tracé) · **inspecter** (charge complète + dernière erreur).

### 3.4 Rejeu

Le journal `domain_events` étant immuable et complet, tout événement est rejouable :

```sql
INSERT INTO event_outbox (event_id, subscriber)
SELECT id, 'dashboard'
  FROM domain_events
 WHERE occurred_at >= '2026-07-01'
   AND event_type = 'AppointmentConfirmed'
ON CONFLICT (event_id, subscriber) DO NOTHING;
```

Cas d'usage : nouveau consommateur qui doit rattraper l'historique ; correction d'un bug de consommateur ; reconstruction d'une projection.

**La contrainte `outbox_once` rend le rejeu sûr par défaut** — un événement déjà livré n'est pas redélivré.

### 3.5 Exactement-une-fois

**Impossible à garantir.** Ce qui est garanti :

| Garantie | Mécanisme |
|---|---|
| **Au moins une fois** en livraison | Outbox + réessai |
| **Exactement une fois** en effet | Idempotence du consommateur |

Chaque consommateur doit être écrit pour supporter d'être appelé deux fois avec le même `event_id` sans effet double. Ce n'est pas optionnel : `PaymentReceived` traité deux fois crée un double encaissement.

### 3.6 Ordonnancement

Garanti **par agrégat** (`id` croissant, traitement séquentiel par `aggregate_id`).
**Non garanti globalement.** Un consommateur qui dépend de l'ordre entre deux agrégats différents est mal conçu.

---

## 4. La chronologie patient

**Une vue, pas une table.** Une table dupliquerait les données et créerait une seconde vérité qui divergerait.

`patient_timeline` (migration 003) unifie déjà : rendez-vous, consultations, ordonnances, factures, diagnostics, messages.

**Extension future** = un `UNION ALL` supplémentaire, **zéro migration** :

```sql
UNION ALL
  SELECT patient_id, 'checkin', id, recorded_at, mood_label, NULL
    FROM aftercare_checkins
```

C'est ce qui rend l'architecture extensible : chaque module futur ajoute une branche à la vue, sans toucher aux tables existantes.

---

## 5. Comment ajouter un consommateur

Quatre étapes. Aucune n'est une migration de schéma.

1. `INSERT INTO event_subscriptions (subscriber, event_type, description)`
2. Écrire le gestionnaire, **idempotent**
3. Rejouer l'historique si nécessaire (§3.4)
4. Documenter ici, dans la section de l'événement concerné

Ajouter Jarvis en Phase 5 = une douzaine de lignes `INSERT`. C'est tout l'intérêt.

---

## 6. Ce que ce document n'autorise pas

- Émettre un événement absent de ce catalogue
- Mettre du contenu clinique dans une charge utile
- Émettre depuis un trigger PostgreSQL
- Renommer un événement existant
- Faire transiter `RiskSignalDetected` par l'outbox
- Supprimer une ligne `dead` sans motif tracé
- Écrire un consommateur non idempotent

---

*Version 1. Toute modification exige une entrée ADR.*
