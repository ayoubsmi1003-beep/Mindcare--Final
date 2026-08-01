# MODULE 01 — TABLEAU DE BORD
### MindCare OS · Doctor Desktop · Navigation group: MENU · Position 1 of 13

> **Consolidation notice.** This module supersedes and unifies the fragmented dashboard material in Ch. 13.5 (Mission Control Panel), Ch. 23.16–23.20 + CTO Enhancements (Mission Control 2.0), Ch. 31.6 (Dashboard), and Ch. 42.4 (Today's Dashboard). Those four sections described the same surface four times, with contradictions and with multi-doctor assumptions that do not apply to a solo cabinet. This document is now canonical. Where a prior chapter conflicts, this one wins.

---

## 1. MODULE OVERVIEW

### 1.1 Purpose

The Tableau de bord exists to answer one question in under five seconds, without a single click:

> **"What do I need to know, and what do I need to do, right now?"**

It is not a statistics page. Statistics live in *Rapports & Analytics* (Module 10). The dashboard is an **operational surface** — it exists to be acted upon, not admired. Every element on it is either something the doctor must *see*, or something she must *do*. Anything that is merely interesting is not on this screen.

A psychiatrist's day has a specific shape that no generic medical dashboard respects:

- She arrives with **no memory of yesterday's loose ends** — a lab result she was waiting for, a patient who cancelled and never rebooked, a certificate she promised.
- Between patients she has **90 to 240 seconds**, standing, often while the next patient is already at the door.
- She finishes the day with **an unknown number of unfinished notes**, and that uncertainty is the single largest source of end-of-day stress in outpatient psychiatry.
- She carries **three or four patients in her head at all times** — the ones at risk. She will think about them in the car. The software should be the one holding them, not her.

The dashboard is designed around those four realities.

### 1.2 Design mandate

| Mandate | Consequence |
| --- | --- |
| Zero-click comprehension | All critical state visible without scroll on a 1440×900 laptop |
| Attention is finite | Never more than **9 actionable items** surfaced at once (3 clinical + 3 operational + 3 administrative) |
| No dead metrics | Every number is clickable and navigates to the underlying list |
| Calm by default | No red unless clinically or financially real. Red must mean *red*. |
| Truthful emptiness | An empty state says "nothing to do" explicitly, not a blank panel |
| One reload per day, max | Everything is live; no refresh button exists anywhere on this screen |

### 1.3 Target users

| Role | Access | Notes |
| --- | --- | --- |
| **Docteur (Dr. Larbi)** | Full | Primary and, in the current deployment, only daily user |
| **Assistant / Secrétaire** | Restricted variant | Sees queue, arrivals, payments, messages. **Never** sees risk scores, diagnoses, mood trends, clinical alerts, or note content. Renders a structurally different dashboard, not a hidden-fields version of the same one. |
| **Admin (Ayoub)** | Full + system band | Adds a system health strip (sync, backup, GPU, agent errors) hidden from the doctor |
| **Future: second practitioner** | Scoped | Own timeline, own patients, own finances. Architecture reserves the seam; the UI does not expose it in v1. |

### 1.4 Navigation position

First item under **MENU**. It is the application's landing route (`/`). It is the only screen reachable by `Échap` from anywhere in the app, and the only screen with no back action.

### 1.5 Relationships with other modules

| Module | Direction | Nature of the relationship |
| --- | --- | --- |
| **02 Patients** | Read | Patient identity, photo, tags, risk level for cards and search |
| **03 Agenda** | Read + Write | Source of the Timeline; dashboard can mark arrival, start, no-show |
| **04 Communications** | Read + Write | Unread count, message triage widget, one-click templated replies |
| **05 Jarvis** | Bidirectional | Jarvis owns the Morning Brief and the Attention Engine; the dashboard is Jarvis's primary output surface |
| **06 Dossiers & Notes** | Read + Write | Unfinished-notes counter, "reprendre la note" action, signature queue |
| **07 Traitements** | Read | Renewal-due list, adherence alerts, interaction warnings |
| **08 Suivi Aftercare** | Read | Check-in compliance, mood deltas, missed streaks, escalation flags |
| **09 Finances** | Read | Today's takings, unpaid balances, cash reconciliation prompt |
| **10 Rapports & Analytics** | Read | Sparklines only. All deep analysis is a navigation away, never inline. |
| **11 Agents IA** | Read | Agent health chip; failures surface as an operational item, not silently |
| **12 Journal d'activité** | Write | Every dashboard action emits an audit event |
| **13 Paramètres** | Read | Layout preset, widget visibility, thresholds, quiet hours |

---

## 2. PAGE ARCHITECTURE

The dashboard is **one page, four bands**, top to bottom. The bands never reorder. Their *contents* adapt to the phase of day (§2.6).

```
┌──────────────────────────────────────────────────────────────────────┐
│  BAND A — BARRE DE CONTEXTE                       (fixed, 56px)      │
│  Now · Current patient · Waiting · Next · Jarvis orb · Search        │
├──────────────────────────────────────────────────────────────────────┤
│  BAND B — LE BRIEFING                             (collapsible)      │
│  Jarvis Morning Brief · Attention Engine (3+3+3)                     │
├───────────────────────────────┬──────────────────────────────────────┤
│  BAND C — CHRONOLOGIE DU JOUR │  BAND C' — PANNEAU LATÉRAL           │
│  Today's timeline, vertical   │  Stacked contextual widgets          │
│  ~62% width                   │  ~38% width                          │
├───────────────────────────────┴──────────────────────────────────────┤
│  BAND D — BANDE DE CLÔTURE                        (appears ≥16h00)   │
│  Unfinished notes · Unpaid · Unsent · Tomorrow preview               │
└──────────────────────────────────────────────────────────────────────┘
```

---

### 2.1 BAND A — « Barre de contexte »

Always visible. Never scrolls. This is the strip the doctor glances at while a patient is talking.

**Contents, left to right:**

1. **Horloge de séance** — not a wall clock. Shows *elapsed time in the current consultation* and *variance against the scheduled slot*: `24 min · +4`. Turns amber at +10, and at +15 quietly whispers to the timeline that the rest of the day is now sliding (see §2.3 Drift).
2. **Patient en cours** — avatar, first name + last initial, consultation number (`Séance 12`), and a single risk pip. Clicking opens the patient workspace.
3. **Salle d'attente** — count of physically arrived patients + longest wait duration. `2 · 18 min`. Turns amber at 20 min, red at 35. This is the number that protects the practice's reputation.
4. **Prochain patient** — name + scheduled time + a **preparedness dot**: green if the clinical brief is generated and the intake is complete, amber if intake is partial, grey if the patient is new with nothing on file.
5. **Orbe Jarvis** — the persistent voice affordance. Four states (idle / listening / thinking / speaking). Mic-reactive. Always in the same pixel position across the entire application.
6. **Recherche universelle** — `Ctrl+K`. Not a search box; a command bar. Accepts patient names, phone numbers, dates in natural language ("mardi prochain"), commands ("nouvelle ordonnance"), and free questions routed to Jarvis.

**What is deliberately absent from Band A:** revenue. Money must not sit in the doctor's peripheral vision while she is with a patient. It lives in Band C' and Band D only.

---

### 2.2 BAND B — « Le briefing »

Renders fully on first load of the day. Collapses to a single summary line after first acknowledgement, and stays collapsed until tomorrow. It is a *morning ritual*, not a permanent panel.

#### 2.2.1 Le Brief du matin (Jarvis)

A short prose paragraph, French, spoken aloud if voice is enabled, written always. Generated once, at first launch, from the overnight agent run.

Structure — five sentences maximum, in this fixed order:

1. **Volume** — how many consultations, which types, expected end time.
2. **Ce qui a changé pendant la nuit** — aftercare check-ins, patient messages, cancellations, new bookings.
3. **Attention clinique** — the patients who moved in the wrong direction.
4. **Reste d'hier** — unfinished business the doctor may have forgotten.
5. **État du système** — only if something is wrong. Silence otherwise.

Example:

> « Bonjour Docteur. Onze consultations aujourd'hui, dont deux premières, fin prévue vers 17h40. Cette nuit : sept check-ins, un désistement à 14h00 — le créneau est libre. Deux patients demandent votre attention : Nadia B. a signalé une aggravation du sommeil trois soirs de suite, et Karim M. n'a pas confirmé sa prise de traitement depuis quatre jours. Il reste deux comptes rendus d'hier à signer. »

**Rules for the brief:**
- Never more than five sentences. If there is more to say, it belongs in the Attention Engine below, not in prose.
- Never invents concern. If nothing changed, it says so: « Rien de particulier cette nuit. »
- Never states a clinical conclusion. It reports *observations and deltas*, never « Nadia est en rechute ».
- Each named patient in the brief is a link.
- The brief is generated from a **pseudonymised** payload if any cloud model is in the loop; names are re-hydrated locally at render time.

**Actions:** `Écouter` (replay TTS) · `Ouvrir tout` (opens every mentioned item as tabs) · `Compris` (collapses the band) · `Pourquoi ?` (opens the evidence trail for each claim).

#### 2.2.2 Le Moteur d'attention — 3 + 3 + 3

Below the prose, exactly nine chips, in three labelled columns. Never eight, never ten. If fewer than three qualify in a column, the empty slots render as a calm "rien à signaler" tile rather than shrinking the layout — the doctor learns the shape of the screen and reads it geometrically.

| Column | Contains | Examples |
| --- | --- | --- |
| **Clinique** | Patients whose data moved adversely | risk-score rise, mood slope inversion, sleep collapse, adherence break, self-harm keyword in a check-in, missed follow-up after a medication change |
| **Opérationnel** | Today's friction | patient waiting >20 min, double-booked slot, unconfirmed appointments for tomorrow, a no-show needing a call, an agent failure |
| **Administratif** | Owed work | unsigned notes, certificates promised, unpaid balances, expiring prescriptions, an unanswered patient message older than 24h |

Each chip: icon · patient or object · one-line reason · a **primary verb button**. Never "voir" — always the actual action: `Appeler`, `Signer`, `Renouveler`, `Reprogrammer`, `Répondre`.

**Ranking logic** (implemented in the Attention agent, transparent on hover):
```
score = clinical_severity × recency_weight × actionability
      + doctor_behavioural_prior      (does she usually act on this class?)
      − snooze_penalty                 (dismissed today = suppressed today)
```
Every chip exposes `Pourquoi ce patient ?` which prints the three data points that produced the score. No opaque ranking is permitted anywhere in MindCare OS.

---

### 2.3 BAND C — « Chronologie du jour »

The spine of the screen. A vertical timeline, not a table, not a calendar grid. A grid forces the eye to compute; a vertical list is read.

#### 2.3.1 Anatomy of a consultation card

Cards are **three-tier progressive disclosure**: collapsed, hovered, expanded.

**Collapsed (default, ~64px):**
- Time · patient name · consultation type badge (`Suivi` / `1ère` / `Urgence` / `Contrôle traitement` / `Téléconsultation`)
- Status pip: `Prévu` → `Arrivé` → `En cours` → `Terminé` → `Absent` → `Annulé`
- Waiting duration if arrived
- Payment pip (paid / due / partial) — a small dot, never a figure
- **Preparedness dot** and **risk pip**

**Hovered (no click, ~140px):**
Expands in place to reveal the *clinical micro-brief*: last session's one-line summary, current medication in one line, mood/sleep sparkline (last 14 days), homework completion, and the single most important thing to raise today. This is the widget that saves the most time in the entire product — it lets the doctor prepare during the four seconds it takes the previous patient to gather their coat.

**Expanded (click):**
Full pre-consultation brief inline, plus action row.

#### 2.3.2 The "Dérive" indicator

Unique to MindCare. A thin vertical rail on the left of the timeline shows the **live schedule drift**: where the day actually is versus where it was planned. If the current consultation runs +12 min, every downstream card visually slides and the rail turns amber, and the last card of the day displays its *projected* end time in italics next to the planned one.

Consequences the psychiatrist actually cares about:
- Jarvis proposes (never executes) an SMS to the 16h00 patient: « Le Dr Larbi a environ 15 minutes de retard. »
- If drift exceeds 25 minutes, Jarvis proposes shortening the administrative buffer, or flags the specific consultation likely to be compressed — and asks whether that patient is one who must *not* be compressed (recent bereavement, active risk, first session).

#### 2.3.3 Timeline actions

Per card: `Marquer arrivé` · `Démarrer la consultation` · `Reporter` · `Marquer absent` · `Appeler` · `Ouvrir le dossier` · `Encaisser`.

Right-click context menu adds: `Dupliquer le rendez-vous` · `Créer une récurrence` · `Ajouter une note interne` · `Envoyer un rappel` · `Marquer prioritaire` · `Copier le numéro`.

Drag a card to reorder → triggers a **propose-confirm** dialog listing exactly which patients will be notified and what the message says. Nothing sends without that confirmation. (Constitution §3.3.)

#### 2.3.4 Gaps and holes

Empty slots are not blank. Each gap renders as a **soft opportunity tile**:
- « 45 min libres — 3 patients sur liste d'attente correspondent » → `Proposer`
- « 30 min libres — 4 comptes rendus en attente » → `Rattraper`
- « Pause déjeuner protégée » → not fillable without an explicit override

This is how a solo cabinet recovers revenue and reduces backlog without the doctor ever doing arithmetic.

---

### 2.4 BAND C' — « Panneau latéral »

Stacked widgets, vertically ordered by the phase of day. Each is collapsible; the layout persists per doctor.

#### W1 — File d'attente
Live list of physically present patients: name, arrival time, waiting duration, appointment time, and whether the tablet intake is complete. Colour escalates with wait. Actions: `Faire entrer` · `Prévenir du retard` · `Voir l'intake`.

#### W2 — Alertes cliniques
Not a duplicate of the Attention Engine. This widget holds **standing** clinical alerts that persist across days until resolved: an active risk flag, a titration in progress requiring review, a patient in a post-discharge window, a treatment started less than 14 days ago (the high-vigilance window). Each has an explicit resolution action, and the alert cannot be dismissed — only *resolved with a reason*, which is logged.

#### W3 — Traitements à renouveler
Prescriptions expiring within 7 days, sorted by expiry. Shows patient, molecule, days remaining, last renewal date, and whether the patient has been seen since. **A renewal for a patient not seen in >90 days is visually distinct** and requires an extra confirmation — this is a real clinical safety issue in psychiatry, not a UI nicety.

#### W4 — Messages
Triage-oriented, not an inbox. Three buckets only: `Nécessite le médecin` · `Réponse type possible` · `Traité par agent`. The middle bucket offers one-click French templated replies with a preview. The third bucket is transparency — the doctor can always see what an agent said in her name.

#### W5 — Aftercare · signaux
Compact heat strip of the last 7 days across all active aftercare patients. Only deviations are labelled. Clicking a cell opens that patient's aftercare timeline. This is the widget that converts aftercare from a data-collection exercise into a clinical instrument.

#### W6 — Finances du jour
Today's collected, today's outstanding, method split (espèces / virement / autre), and a single reconciliation prompt at close. DZD, no decimals. Collapsed by default during consultation hours.

#### W7 — Veille scientifique
Maximum **two** items per day, and only if genuinely matched to a diagnosis on today's schedule. Each shows title, source, and one sentence on why it was surfaced. If nothing matches, the widget hides itself entirely rather than showing filler. A research widget that shows irrelevant papers gets ignored within a week, and then gets ignored forever.

#### W8 — État du système *(Admin only)*
Sync status, last backup + integrity check, model gateway health, agent error count, storage headroom, GPU status when local. Hidden from the doctor's view entirely.

---

### 2.5 BAND D — « Bande de clôture »

Appears automatically at the earlier of: 16h00, or the completion of the last scheduled consultation. This band is the product's answer to end-of-day anxiety.

It shows exactly four counters, each with a direct action:

| Counter | Action | Why it matters |
| --- | --- | --- |
| **Comptes rendus non signés** | `Reprendre` — opens them in sequence, not as a list | Unfinished notes are the #1 evening stressor |
| **Encaissements en attente** | `Régulariser` | Cash reconciliation while memory is fresh |
| **Messages sans réponse** | `Traiter` | Prevents 48h silences that erode trust |
| **Demain** | `Voir` | Count, first appointment time, unconfirmed count, and any patient needing preparation |

When all four reach zero, the band collapses into a single line: **« Journée clôturée. Rien en attente. »** with the day's summary offered as an optional read. That sentence is the emotional payload of the entire product.

**Rituel de clôture** (optional, one click): Jarvis proposes a bundle — send tomorrow's confirmations, run the backup, generate the day's financial summary, archive the day. Propose → confirm → execute → log. Never automatic.

---

### 2.6 Adaptive phases

The bands are fixed; their emphasis is not.

| Phase | Trigger | Emphasis |
| --- | --- | --- |
| **Matin** | Launch → first consultation | Brief expanded, timeline dominant, preparation actions |
| **Consultation** | Any consultation `En cours` | Band B collapses, W6/W7 collapse, notifications suppressed except clinical-urgent, timeline dims to current + next only |
| **Entre-deux** | Between consultations | Next-patient brief promoted, unfinished note from the previous patient surfaces immediately |
| **Après-midi** | Post-lunch | Waiting room and drift promoted |
| **Clôture** | ≥16h00 or last consultation done | Band D appears, timeline recedes |
| **Hors horaires** | Outside configured hours | Read-only calm view: tomorrow, unresolved items, no live counters |

**Mode Concentration** (`F11` or automatic on consultation start): everything except Band A and the current patient's brief fades to 20% opacity. Notifications below `Urgent clinique` are queued, not shown. This is enforced at the notification bus level, not by CSS.

---

## 3. SEARCH & FILTERS

### 3.1 Barre de commande (`Ctrl+K`)

One input, four intents, auto-detected:

| Input pattern | Interpreted as | Result |
| --- | --- | --- |
| Letters | Patient search (name, phonetic, incl. Arabic transliteration variants) | Ranked patients with last-visit date |
| Digits (≥6) | Phone / patient number | Direct match |
| Natural date | Calendar navigation | Jumps the timeline |
| Verb-first ("créer", "imprimer", "envoyer") | Command | Executes via Jarvis with confirmation |
| Question | Jarvis query | Answered inline with sources |

**Phonetic matching is mandatory** and must handle Algerian naming reality: `Mohamed / Mohammed / M'hamed`, `Belkacem / Bel Kacem`, French and Arabic spellings of the same person. A search that fails on a legitimate spelling variant creates a duplicate patient record, and duplicates in psychiatry are a safety hazard.

### 3.2 Timeline filters

`Tous` · `À venir` · `Arrivés` · `Terminés` · `Absents` · `Non payés` · `Nouveaux patients` · `Risque élevé` · `Non préparés`

Filters are chips, multi-select, and persist only for the session.

---

## 4. AI FEATURES

| Feature | Description | Guardrail |
| --- | --- | --- |
| **Brief du matin** | Overnight synthesis across agenda, aftercare, messages, finance | Observations only; never a clinical conclusion |
| **Moteur d'attention** | Ranks and caps surfaced items at 9 | Fully explainable; `Pourquoi ?` on every item |
| **Brief pré-consultation** | One-page preparation per patient, pre-generated | Generated ahead of time so it is never a loading state |
| **Détection de dérive** | Live schedule slippage + downstream impact | Proposes notifications; never sends |
| **Signaux aftercare** | Slope detection on mood, sleep, adherence, engagement | Flags deviation, does not interpret it |
| **Détection de risque** | Keyword + pattern analysis on check-ins and messages | **Independent pathway** — never suppressed by any other agent, never gated behind a summary, always surfaces even in Concentration mode |
| **Récupération de créneau** | Matches gaps to waiting list | Proposes; doctor confirms every contact |
| **Veille contextuelle** | Literature matched to today's diagnoses | Max 2/day, or silence |
| **Prédiction d'absence** | Flags likely no-shows from history | Proposes a reminder; never marks a patient as unreliable in any visible label |

**Absolute constraints inherited from the Constitution:**
- AI never diagnoses, never prescribes, never issues a document.
- Every write action on this screen follows **propose → confirm → execute → log**, without exception.
- Patient-identifiable data (Tier 0) never leaves the local boundary un-pseudonymised.
- Risk detection is an independent pathway with its own execution path and its own audit trail.

---

## 5. JARVIS INTEGRATION

Voice commands available from the dashboard (French, with Darija tolerance in the recogniser):

- « Qui est le prochain ? »
- « Ouvre le dossier de Nadia. »
- « Combien de patients aujourd'hui ? »
- « Résume-moi la journée. »
- « Préviens le patient de 16h que j'ai du retard. » → proposes the message, shows it, waits
- « Signe les comptes rendus en attente. » → lists them, one confirmation each
- « Qu'est-ce qui a changé pour Karim ? »
- « Bloque une heure demain matin. »
- « Clôture la journée. »

**The confirmation gate is visible, always.** Every write command renders a card showing: the action, the affected records, the exact text of anything to be sent, and two buttons — `Confirmer` / `Annuler`. It is never a spoken-only confirmation. This is both a safety mechanism and, in the client demo, the single most persuasive element in the product.

---

## 6. AUTOMATIONS

| Automation | Trigger | Human gate |
| --- | --- | --- |
| Morning brief generation | 05:00 local | None (read-only output) |
| Pre-consultation briefs | T−30 min per patient | None (read-only output) |
| Tomorrow's confirmations | 18:00 | **Confirm required** |
| Waiting-time escalation | 20 min / 35 min | Alert only |
| Drift notification | Drift >15 min | **Confirm required** |
| Renewal surfacing | 7 days before expiry | Alert only |
| Aftercare deviation flag | On check-in ingestion | Alert only |
| Risk escalation | On detection | **Immediate, unsuppressable alert** |
| Day archive + backup | On closure ritual | **Confirm required** |
| No-show marking | 20 min past slot with no arrival | **Confirm required** |

---

## 7. NOTIFICATIONS

Five tiers. The tier determines whether a consultation may be interrupted.

| Tier | Interrupts consultation? | Examples |
| --- | --- | --- |
| **Urgence clinique** | Yes, always, full-screen | Risk signal, patient in crisis contacting the cabinet |
| **Clinique** | No — queued, badge only | Adherence break, aftercare deviation |
| **Opérationnel** | No | Arrival, wait threshold, cancellation |
| **Administratif** | No, batched to Band D | Unsigned notes, unpaid balances |
| **Système** | Admin only | Sync failure, agent error, backup status |

Quiet hours configurable in Module 13. Nothing except Tier 1 is delivered outside working hours.

---

## 8. PERMISSIONS

| Element | Docteur | Assistant | Admin |
| --- | --- | --- | --- |
| Band A context | Full | Queue + next only, no risk pip | Full |
| Morning brief | Full | Hidden | Full |
| Attention engine | Full | Operational column only | Full |
| Timeline cards | Full | No clinical micro-brief, no risk, no diagnosis | Full |
| Clinical alerts | Full | Hidden | Full |
| Renewals | Full | Count only, no molecule names | Full |
| Messages | Full | Non-clinical only | Full |
| Aftercare signals | Full | Hidden | Full |
| Finances | Full | Collection only, no totals | Full |
| System band | Hidden | Hidden | Full |
| Voice write actions | Full | Blocked | Full |

The assistant dashboard is a **separate composition**, not the doctor's dashboard with fields removed. Field-level hiding leaks through hover states, tooltips, and print. Separate composition does not.

---

## 9. USE CASES

**9.1 — 08h20, arrival.** She opens the laptop. Before she has taken off her coat, the brief has been spoken. She knows: eleven patients, one cancellation at 14h00, two patients to watch, two notes to sign. She signs the two notes before the first patient arrives. Cost: 90 seconds. Previously: forgotten until 21h00.

**9.2 — 09h58, between patients.** The 10h00 patient is at the door. She hovers his card. Three seconds: last session was about his brother's illness, he started sertraline 12 days ago, sleep improved, homework not done. She walks in already oriented. No file was opened.

**9.3 — 11h40, drift.** Running 18 minutes late. The rail is amber. Jarvis proposes an SMS to the 12h00 patient. She glances at the wording, taps `Confirmer`. One tap. The patient is not left standing.

**9.4 — 14h00, recovered gap.** The cancellation leaves 45 minutes. The gap tile shows three waiting-list matches. She picks one; Jarvis drafts the call script and the confirmation SMS. The slot is filled in under a minute, and the revenue is not lost.

**9.5 — Risk signal, mid-consultation.** A patient's overnight check-in contained explicit self-harm language, ingested at 14h12. Concentration mode is active — every other notification is suppressed. This one is not. It takes the full screen. She finishes the current consultation, then acts. The pathway is independent by design; no summarisation agent stands between the signal and the doctor.

**9.6 — New patient with tablet intake.** The patient completed intake in the waiting room in Darija. Her card's preparedness dot is green. Hovering shows the structured intake summary and the auto-selected psychometric scale with its score. She has never met this patient and already knows more than a 20-minute history would have given her.

**9.7 — 17h50, closure.** Band D: two notes, one payment, zero messages. She clears them in four minutes. « Journée clôturée. Rien en attente. » She closes the laptop and does not think about work again until tomorrow. **This is the product.**

**9.8 — Missed appointment.** 10h20, the 10h00 patient has not arrived. The card offers `Appeler`. Two rings, no answer. She marks `Absent`; the system proposes a re-booking SMS and — if this is the patient's second consecutive absence — flags it as a clinical signal, not an administrative one. Disengagement in psychiatry is a symptom.

**9.9 — Renewal for a lapsed patient.** W3 shows a renewal due for a patient last seen 5 months ago. It is visually distinct and requires a second confirmation stating that no consultation has occurred. She calls him instead of renewing.

**9.10 — Assistant's morning.** The assistant opens her own dashboard: queue, arrivals, payments, non-clinical messages. She sees names and times. She sees no diagnosis, no risk, no medication, no note. She cannot see them because they were never rendered.

---

## 10. WOW FEATURES

1. **La phrase de clôture.** « Journée clôturée. Rien en attente. » A single sentence, engineered as the emotional endpoint of the day. No competitor ships an explicit "you are done" state.
2. **Le survol qui prépare.** Full clinical preparation on hover, zero clicks, zero loading. Saves ~20 seconds × 11 patients × 250 days ≈ **15 hours a year**.
3. **Le rail de dérive.** The only psychiatric dashboard that shows the *downstream consequence* of running late, and proposes the fix.
4. **Le moteur d'attention plafonné.** A hard cap of nine items. Refusing to show more is the feature.
5. **Le désistement rentabilisé.** Cancellations become filled slots automatically-proposed.
6. **La fenêtre de vigilance.** Any patient <14 days into a new psychotropic is permanently flagged during that window — the period where initiation risk is highest.
7. **L'absence comme symptôme.** Two consecutive no-shows escalate to the clinical column, not the administrative one.
8. **Le renouvellement à l'aveugle bloqué.** Refuses friction-free renewal for patients not seen in 90 days.
9. **Le « Pourquoi ? » universel.** Every AI-surfaced item explains itself in three data points.
10. **La transparence des agents.** The doctor can always read what was said in her name.
11. **Le silence comme fonctionnalité.** Widgets with nothing useful hide themselves rather than show filler.
12. **La préparation visible.** The preparedness dot tells her, before the patient walks in, whether she is walking in blind.

---

## 11. FEATURE COMPLETENESS CHECKLIST

**Clinical workflow coverage** — ✅ Preparation, in-session context, risk surfacing, longitudinal signals, medication vigilance, disengagement detection, post-session continuity.
⚠️ *Gap:* no emergency/crisis protocol surface. Deferred to a dedicated **Module 06-bis — Triage & Urgence**, which is not currently in the sidebar and should be.

**Administrative workflow coverage** — ✅ Arrivals, queue, no-shows, rescheduling, confirmations, note completion, renewals, closure ritual, gap recovery.

**AI workflow coverage** — ✅ Brief, attention ranking, pre-consultation briefs, drift, risk, aftercare signals, waiting-list matching, contextual literature. All explainable, all gated.

**Automation coverage** — ✅ Ten automations defined, each with an explicit human gate.
⚠️ *Gap:* no defined behaviour when an automation fails silently. Requires a "dernière exécution" indicator per automation in Module 11.

**Security considerations** — ✅ Separate assistant composition, Tier 0 locality, pseudonymisation before any cloud call, audit event on every action, no PHI in notification payloads, screen-lock on idle.
⚠️ *Gap:* screenshot/print behaviour of the dashboard is undefined. A printed dashboard is a PHI leak.

**Future scalability** — ✅ Multi-practitioner seam reserved, widget system pluggable, layout presets, adaptive phases configurable.

**Missing ideas identified during this pass**
- A **"patients dans ma tête"** pin: let the doctor manually pin 1–3 patients she is worried about, independent of any algorithm. Clinical intuition should have a first-class slot.
- **Retour de la veille**: a one-line "hier vous avez dit que vous rappelleriez X" — promises made verbally, captured from consultation transcripts.
- **Charge cognitive du jour**: a computed indicator of how heavy today is (number of first sessions, high-risk patients, crisis follow-ups) shown in the morning — so she can protect herself.

---

## 12. CROSS-MODULE DEPENDENCIES

| Module | What the dashboard consumes | What the dashboard emits |
| --- | --- | --- |
| 02 Patients | Identity, tags, risk level, last visit | Navigation events |
| 03 Agenda | Appointments, statuses, gaps | Arrival, start, no-show, reschedule |
| 04 Communications | Unread, triage buckets, templates | Sent messages (post-confirmation) |
| 05 Jarvis | Brief, attention ranking, command results | Voice commands, confirmations |
| 06 Dossiers & Notes | Unsigned count, last-session summary | Signature events |
| 07 Traitements | Expiries, adherence, initiation windows | Renewal intents |
| 08 Aftercare | Check-ins, deltas, risk keywords | Escalation acknowledgements |
| 09 Finances | Collected, outstanding | Payment records |
| 10 Analytics | Sparkline series | — |
| 11 Agents IA | Health, failures, agent-authored messages | Agent-disable requests |
| 12 Journal | — | Every action, with actor, timestamp, before/after |
| 13 Paramètres | Thresholds, layout, quiet hours, working hours | Layout persistence |

---

## 13. SUGGESTIONS FOR IMPROVEMENT — challenging this design

**Where this design is likely wrong:**

1. **Nine items may still be too many.** With eleven consultations a day, a solo psychiatrist may only ever act on two or three. Proposal: ship with 3+3+3, instrument which chips are actually clicked, and cut to 2+2+2 if usage confirms it. Measure before assuming.

2. **The morning brief risks becoming wallpaper.** Every product with a daily digest sees engagement collapse by week three. Mitigation: the brief must *vary in length with actual news*. A quiet night produces one sentence. If it is always five sentences, it will always be ignored.

3. **The drift rail could induce anxiety rather than relieve it.** A permanent visual reminder of lateness may be experienced as reproach. Proposal: make it appear only past a threshold, and never colour it red — amber maximum. The software must never scold the doctor.

4. **W7 Veille scientifique probably should not ship in v1.** It is the widget most likely to be ignored and the most expensive to make genuinely good. Recommend deferring to a later phase and reclaiming the screen space.

5. **Band D at a fixed 16h00 is naive.** Some days end at 14h, some at 20h. It should trigger on *schedule completion*, with 16h00 only as a fallback.

6. **The risk pip on the timeline card is ethically delicate.** A persistent visible risk marker on a patient's card, in a room a patient may glance into, is a confidentiality and stigma concern. Proposal: risk is visible on hover and in the brief, but the collapsed card shows only a neutral "attention" marker with no severity gradient.

7. **A missing module.** The sidebar has no **Urgence / Triage** surface. In psychiatry that is the highest-stakes workflow in the practice. It is currently distributed across alerts and notifications, which is not a design — it is an absence. This should be raised before we proceed to Module 02.

---

*End of Module 01. Next in sidebar order: **Module 02 — Patients**.*
