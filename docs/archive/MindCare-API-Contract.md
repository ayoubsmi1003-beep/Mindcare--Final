# MindCare-API-Contract.md
### Contrat d'API · Phase 1 · v1
**Statut : contraignant.** Aucune route absente de ce document ne doit être créée. Si une route manque : **arrête-toi et demande.**

**Documents liés** — `CLAUDE.md` · `MindCare-Domain-Model.md` (BR-1…21, I-1…14) · `MindCare-Domain-Events.md` · `MindCare-Permissions-Matrix.md` · `MindCare-Schema-Reference.md`

En cas de contradiction entre ce document et le SQL : **le SQL a raison.**

---

## 1. Règles générales

### 1.1 Forme
- Préfixe : `/v1`. Noms de ressources au **pluriel**.
- Corps en JSON. `Content-Type: application/json`.
- Toute entrée validée par **Zod** dans `routes.ts`. Aucune entrée non validée n'atteint le service.
- Toute date en sortie : **ISO 8601 avec fuseau**. Jamais de date nue.
- Tout montant : **entier en centimes DZD** (`amount_cents`). Jamais de flottant, jamais de chaîne.

### 1.2 Réponse de succès
```json
{ "data": { ... } }
```
Pour une liste :
```json
{ "data": [ ... ], "page": { "limit": 50, "offset": 0, "total": 217 } }
```
Défaut : `limit=50`, maximum `200`.

### 1.3 Réponse d'erreur
Forme unique, conforme à `CLAUDE.md` §6 :
```json
{ "code": "NOTE_LOCKED",
  "message": "Cette note est signée et ne peut plus être modifiée.",
  "details": [], "correlationId": "…" }
```
`message` toujours en **français**, destiné à l'utilisateur. Jamais de SQL, de trace de pile, ni de donnée patient.

### 1.4 Verrouillage optimiste
Toute route `PUT` / `PATCH` sur une table portant `lock_version` **exige** le champ `lock_version` dans le corps.
Version obsolète → `409 VERSION_CONFLICT`, message : « Rechargez la fiche ».

Tables concernées : `patients`, `appointment_requests`, `appointments`, `clinical_notes`, `prescriptions`, `invoices`.

### 1.5 Idempotence
Les routes marquées **⚡ idempotente** acceptent l'en-tête `Idempotency-Key: <uuid>`, **obligatoire**.
Même clé rejouée → la réponse d'origine est renvoyée, **aucun second enregistrement**.

> 🔴 **Migration 004 requise.** La table `payments` ne possède aujourd'hui aucune colonne d'idempotence. Le checkpoint 2.5 est **impossible** sans elle.
> ```sql
> ALTER TABLE payments ADD COLUMN idempotency_key uuid;
> CREATE UNIQUE INDEX payments_idem_once ON payments(idempotency_key)
>   WHERE idempotency_key IS NOT NULL;
> ```
> À appliquer **avant** le checkpoint 2.5.

### 1.6 Authentification
JWT court en cookie `httpOnly`, `SameSite=Strict`, `Secure=false` (réseau local, pas de TLS en Phase 1).
Absence ou expiration → `401`. Rôle insuffisant → `403 PERMISSION_DENIED`.

### 1.7 Ce que chaque écriture fait, sans exception
Une seule transaction : **contexte · transition · permission · audit · événement** (`CLAUDE.md` §5).
La colonne « Événement » de chaque tableau ci-dessous est **contraignante** — nom exact du catalogue.

### 1.8 Lecture de la colonne « Rôles »
`D` docteur · `A` assistante · `S` admin. Un rôle absent → `403`. Aucune exception implicite.

---

## 2. Authentification — `/v1/auth`

| Méthode | Route | Rôles | Notes |
|---|---|---|---|
| `POST` | `/v1/auth/login` | public | `{ email, password }` → pose les cookies |
| `POST` | `/v1/auth/refresh` | authentifié | rotation du jeton |
| `POST` | `/v1/auth/logout` | authentifié | invalide la session |
| `GET` | `/v1/auth/me` | D A S | `{ id, full_name, role }` |

**Règles.** Argon2. 5 échecs → `locked_until` (`423 ACCOUNT_LOCKED`). Expiration 15 min, refresh 7 j.
Un mauvais mot de passe et un email inconnu renvoient **le même** `401` — ne pas révéler l'existence d'un compte.

---

## 3. Patients — `/v1/patients`

| Méthode | Route | Rôles | Événement |
|---|---|---|---|
| `GET` | `/v1/patients?q=&status=&limit=&offset=` | D A S | — |
| `GET` | `/v1/patients/:id` | D A S | — |
| `POST` | `/v1/patients` | D A | `PatientCreated` |
| `PUT` | `/v1/patients/:id` | D A | — |
| `PATCH` | `/v1/patients/:id/status` | D | `PatientStatusChanged` |
| `POST` | `/v1/patients/:id/merge` | D S | `PatientMerged` |
| `GET` | `/v1/patients/:id/timeline` | D A | vue distincte selon le rôle |
| `GET` | `/v1/patients/:id/contacts` | D A | — |
| `POST` | `/v1/patients/:id/contacts` | D A | — |
| `DELETE` | `/v1/patients/:id/contacts/:cid` | D A | logique (`deleted_at`) |
| `GET` | `/v1/patients/:id/tags` | D | — |
| `POST` | `/v1/patients/:id/tags` | D | — |

**Recherche.** `q` est comparé à `search_key` (colonne générée). « Bel Kacem », « Belkacem », « bel-kacem » doivent retourner le même patient. Un échec de recherche crée un doublon, et un doublon en psychiatrie est un risque de sécurité.

**Fusion.** Corps : `{ source_id, target_id, reason }`. Confirmation renforcée : le client renvoie `confirm_last_name` qui doit correspondre exactement au patient **conservé**. Le doublon n'est jamais supprimé — `merged_into_id` est posé.
`source_id = target_id` → `422` (I-11).

**Chronologie.** `GET /timeline` retourne la vue complète pour le docteur, la **projection restreinte** pour l'assistante. Deux vues SQL distinctes, **pas un filtre applicatif** (Permissions Matrix §2.3).

---

## 4. Demandes de rendez-vous — `/v1/appointment-requests`

**La zone tampon. Ces enregistrements n'apparaissent jamais dans `/v1/appointments`.**

| Méthode | Route | Rôles | Transition | Événement |
|---|---|---|---|---|
| `GET` | `/v1/appointment-requests?status=` | D A | — | — |
| `POST` | `/v1/appointment-requests` | D A | → `recue` | `AppointmentRequested` |
| `POST` | `/v1/appointment-requests/:id/claim` | D A | `recue → en_cours_appel` | — |
| `POST` | `/v1/appointment-requests/:id/confirm` | D A | `→ confirmee` | `AppointmentConfirmed` ⭐ |
| `POST` | `/v1/appointment-requests/:id/reject` | D A | `→ refusee` | — |
| `POST` | `/v1/appointment-requests/:id/unreachable` | D A | `→ injoignable` | — |

**Confirmation** — corps : `{ patient_id, starts_at, ends_at, type, lock_version }`.
Si `patient_id` est absent, le patient est créé en `prospect` dans **la même transaction** : `PatientCreated` puis `AppointmentConfirmed`.
Crée l'`appointment`. C'est la **seule** route qui fait passer une demande dans l'agenda.

**Injoignable** — incrémente `attempt_count`. À la **3ᵉ** tentative, statut `abandonnee` automatiquement.

**Interdits.** Aucune route ne permet de modifier `status` librement. Aucune route ne crée d'`appointment` depuis ce module hors `/confirm`.

---

## 5. Agenda — `/v1/appointments`

| Méthode | Route | Rôles | Transition | Événement |
|---|---|---|---|---|
| `GET` | `/v1/appointments?from=&to=&status=` | D A | — | — |
| `GET` | `/v1/appointments/:id` | D A | — | — |
| `POST` | `/v1/appointments` | D A | → `planifie` | `AppointmentConfirmed` |
| `POST` | `/v1/appointments/:id/arrive` | D A | `planifie → en_attente` | `PatientArrived` |
| `POST` | `/v1/appointments/:id/start` | **D** | `en_attente → en_cours` | `ConsultationStarted` |
| `POST` | `/v1/appointments/:id/end` | **D** | `en_cours → termine` | `ConsultationEnded` |
| `POST` | `/v1/appointments/:id/absent` | D A | `→ absent` | `AppointmentMarkedAbsent` |
| `POST` | `/v1/appointments/:id/reschedule` | D A | `→ reporte` | `AppointmentRescheduled` |
| `POST` | `/v1/appointments/:id/cancel` | D A | `→ annule` | `AppointmentCancelled` |
| `GET` | `/v1/availability?date=` | D A | — | créneaux libres calculés |
| `GET` | `/v1/waiting-list` | D A | — | — |
| `POST` | `/v1/waiting-list` | D A | — | — |

**Règles dures.**
- `start` et `end` sont **interdits à l'assistante** → `403`. C'est le point de contrôle le plus important de ce module.
- `absent` n'est **jamais automatique**. Aucune tâche planifiée ne le déclenche.
- Chevauchement de créneaux → `422 SLOT_OVERLAP`.
- `ends_at > starts_at` (I-10) → `422`.
- Toute transition écrit une ligne dans `appointment_status_history`, **dans la même transaction**.
- `starts_at` est le **prévu**, `started_at` le **réel**. Ne jamais confondre.

---

## 6. Consultations — `/v1/consultations`

| Méthode | Route | Rôles | Notes |
|---|---|---|---|
| `GET` | `/v1/consultations?patient_id=` | D **A (restreint)** | l'assistante voit date et durée, **pas le libellé de séance** |
| `GET` | `/v1/consultations/:id` | D | — |

**Pas de `POST`.** Une consultation naît **exclusivement** de `POST /v1/appointments/:id/start`. Une seule par rendez-vous (I-8).
`session_number` est calculé dans la transaction : rang du patient, consultations non supprimées.

---

## 7. Notes cliniques — `/v1/notes` ⭐

**Assistante et admin : aucun accès. `403` sur toutes les routes, y compris en lecture.**

| Méthode | Route | Rôles | Événement |
|---|---|---|---|
| `GET` | `/v1/consultations/:id/note` | **D** | — |
| `POST` | `/v1/consultations/:id/note` | **D** | — |
| `PUT` | `/v1/notes/:id` | **D** | — |
| `POST` | `/v1/notes/:id/sign` | **D** | `ClinicalNoteSigned` ⭐ |
| `POST` | `/v1/notes/:id/amendments` | **D** | `NoteAmended` |
| `GET` | `/v1/notes/:id/amendments` | **D** | — |

**Règles dures.**
- `PUT` sur une note dont `locked_at` n'est pas nul → **`409 NOTE_LOCKED`**. Refusé par déclencheur en base (I-1), pas seulement par le code.
- La signature n'est possible qu'après `ConsultationEnded` (BR-3) → sinon `422`.
- Un amendement **exige** `reason` non vide (BR-7) → sinon `422`.
- La charge de `ClinicalNoteSigned` ne contient **jamais** le texte. Identifiants seulement.
- `clinical_notes` n'a **pas** de `deleted_at`, volontairement (I-2). Ne pas « corriger » ce point.

**Test d'acceptation.** Session assistante → `GET /v1/consultations/:id/note` → `403`. Sans contexte de rôle en base → **0 ligne**, jamais toutes (I-14).

---

## 8. Diagnostics — `/v1/diagnoses`

| Méthode | Route | Rôles | Événement |
|---|---|---|---|
| `GET` | `/v1/patients/:id/diagnoses` | **D** | — |
| `POST` | `/v1/patients/:id/diagnoses` | **D** | `DiagnosisRecorded` |
| `POST` | `/v1/diagnoses/:id/resolve` | **D** | `DiagnosisResolved` |
| `PATCH` | `/v1/diagnoses/:id/primary` | **D** | — |

**Aucune route de suppression.** Un diagnostic se résout (`resolved_at`), il ne s'efface pas (BR-4).
Un seul `is_primary = true` actif par patient — géré en transaction.
Assistante → `403`, et RLS renvoie 0 ligne.

---

## 9. Traitements — `/v1/prescriptions`

| Méthode | Route | Rôles | Transition | Événement |
|---|---|---|---|---|
| `GET` | `/v1/medications?q=` | D | — | — |
| `GET` | `/v1/patients/:id/prescriptions` | D **A (en-tête seul)** | — | — |
| `GET` | `/v1/prescriptions/:id` | **D** | — | lignes incluses |
| `POST` | `/v1/prescriptions` | **D** | → `draft` | — |
| `POST` | `/v1/prescriptions/:id/lines` | **D** | — | — |
| `DELETE` | `/v1/prescriptions/:id/lines/:lid` | **D** | brouillon seul | — |
| `POST` | `/v1/prescriptions/:id/issue` | **D** | `draft → issued` | `PrescriptionIssued` ⭐ |
| `POST` | `/v1/prescriptions/:id/print` | D **A** | `issued → printed` | — |
| `POST` | `/v1/prescriptions/:id/cancel` | **D** | `→ cancelled` | `PrescriptionCancelled` |

**Règles dures.**
- Patient non `actif` → **`422 PATIENT_NOT_ACTIVE`** (BR-1). Vérifié à l'émission, pas à la création.
- Numérotation `2026-0001, 0002, 0003…` via `document_counters` avec **verrou transactionnel**, jamais une séquence Postgres (I-6). Aucun trou, même après rollback. Un numéro consommé n'est jamais réutilisé.
- Ordonnance `printed` → toute modification `409`.
- Annulation : `cancel_reason` obligatoire → sinon `422`.
- Renouvellement, patient non vu depuis `renewal_review_days` (90) → **`422 APPROVAL_REQUIRED`** tant que le corps ne porte pas `{ acknowledged: true, reason }` (BR-2).

**L'assistante voit le numéro, la date, le patient. Jamais les lignes, jamais une molécule.** Réponse structurellement différente selon le rôle — pas un champ masqué.

---

## 10. Facturation — `/v1/invoices`

| Méthode | Route | Rôles | Transition | Événement |
|---|---|---|---|---|
| `GET` | `/v1/invoices?patient_id=&status=` | D A S | — | — |
| `GET` | `/v1/invoices/:id` | D A S | — | — |
| `POST` | `/v1/invoices` | D A | → `draft` | — |
| `POST` | `/v1/invoices/:id/issue` | D A | `draft → issued` | `InvoiceIssued` |
| `POST` | `/v1/invoices/:id/payments` ⚡ | D A | → `partially_paid` / `paid` | `PaymentReceived` |
| `POST` | `/v1/invoices/:id/cancel` | D A | `→ cancelled` | `InvoiceCancelled` |
| `GET` | `/v1/cash-sessions/today` | D A | — | — |
| `POST` | `/v1/cash-sessions/close` | D A | — | écart enregistré |

**Règles dures.**
- Numérotation annuelle **sans trou**, même compteur verrouillé que les ordonnances (BR-8).
- Le statut **découle** de la somme des paiements. Jamais posé à la main.
- Somme des paiements > `amount_cents` → `422 OVERPAYMENT`.
- Annulation = **avoir**, jamais suppression (BR-9). `cancel_reason` obligatoire.
- `POST /payments` est ⚡ **idempotente** — `Idempotency-Key` obligatoire. Voir §1.5, migration 004.
- Clôture de caisse : l'écart entre compté et théorique est **enregistré**, jamais corrigé silencieusement.

---

## 11. Système

| Méthode | Route | Rôles | Notes |
|---|---|---|---|
| `GET` | `/v1/health` | public | `{ status, db, migrations }` |
| `GET` | `/v1/settings` | D S | clés cliniques pour D, système pour S |
| `PUT` | `/v1/settings/:key` | D S | selon la nature de la clé |
| `GET` | `/v1/notifications?tier=` | D A S | filtré par tier et rôle |
| `POST` | `/v1/notifications/:id/read` | D A S | — |
| `GET` | `/v1/audit-log?entity=&id=` | D S | **lecture seule, jamais d'écriture** (I-4) |

**Hors Phase 1** — `/v1/messages`, `/v1/agents`, `/v1/jarvis`, `/v1/intake`. Ne pas créer ces routes cette semaine.

---

## 12. Codes d'erreur — table complète

| Code | HTTP | Quand |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Zod rejette l'entrée |
| `UNAUTHENTICATED` | 401 | Jeton absent, invalide ou expiré |
| `PERMISSION_DENIED` | 403 | Rôle insuffisant |
| `NOT_FOUND` | 404 | Ressource inexistante ou supprimée |
| `NOTE_LOCKED` | 409 | Modification d'une note signée |
| `VERSION_CONFLICT` | 409 | `lock_version` obsolète |
| `ALREADY_PROCESSED` | 409 | Idempotence : clé déjà utilisée, corps différent |
| `INVALID_TRANSITION` | 422 | Transition d'état interdite |
| `PATIENT_NOT_ACTIVE` | 422 | Ordonnance sur patient non actif |
| `APPROVAL_REQUIRED` | 422 | Confirmation renforcée manquante |
| `SLOT_OVERLAP` | 422 | Chevauchement de rendez-vous |
| `OVERPAYMENT` | 422 | Paiement supérieur au solde |
| `ACCOUNT_LOCKED` | 423 | 5 échecs de connexion |
| `DB_UNAVAILABLE` | 503 | Base injoignable — **refuser, ne pas mettre en file** |

**`DB_UNAVAILABLE` est le cas le plus important.** Jamais de file locale sur une écriture clinique : la médecin croirait avoir enregistré.

---

## 13. Ce que ce contrat interdit

- Créer une route absente de ce document
- Exposer une route d'écriture sans permission, audit et événement
- Renvoyer une donnée clinique à l'assistante, même dans un champ inutilisé
- Masquer un champ côté client plutôt que de le retirer de la réponse serveur
- Écrire du SQL hors de `repository.ts`
- Renvoyer un message d'erreur en anglais

---

*Version 1. Toute modification exige une entrée ADR.*
