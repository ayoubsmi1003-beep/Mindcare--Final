# MODULE-MAP.md
**Où vit chaque module. Une ligne par module.**
v2 — 2026-08-09 · réécrit autour des 6 écrans de la v1 · remplace v1 du 2026-08-02

> Un agent lit **sa ligne**, pas le fichier entier.
> Statut : 🟢 livré · 🔵 les 6 sessions v1 · ⚪ semaine 2 · ⬜ mois 2+

---

## 1. LES 6 ÉCRANS DE LA v1

Ce sont les seuls écrans qui doivent être **complets** avant que la Dr. Larbi saisisse
de vrais patients. Tout le reste attend.

| # | Écran | Session | Route | Tables / portes | Agent |
|---|---|---|---|---|---|
| 1 | **Tableau de bord** | 🔵 V4 | `/` | `app.dashboard_today()` | feature-builder |
| 2 | **Patients** | 🔵 V5 | `/patients` | `patients` · `search_patients` · `get_patient` | feature-builder |
| 3 | **Agenda** | 🔵 V5 | `/agenda` | `appointments` · portes `022` | feature-builder |
| 4 | **Jarvis** | 🔵 V2 | panneau global (⌘K) | `jarvis_actions` | jarvis-tooler |
| 5 | **Dossiers & Notes** | 🔵 V1/V6 | `/consultation/[id]` · `/documents` | `consultations` · `clinical_notes` · `documents` · portes `030` | feature-builder |
| 6 | **Finances** | 🔵 V6 | `/finance` | `payments` · portes `029` | feature-builder |

**Transversal, sans écran propre :** design system (V3) · états d'écran (`05-UX-CONTRACT.md`) ·
budget de performance (`06-PERF-BUDGET.md`).

---

## 2. LES ENTRÉES « BIENTÔT » — visibles, assumées

Décision de l'utilisateur (Q12) : **elles restent affichées**, pour que la praticienne
sache ce qui arrive. Elles ne sont pas grisées comme un défaut : elles portent une
pastille calme « bientôt ».

| Module | Quand | Pourquoi pas maintenant |
|---|---|---|
| Messages | ⚪ semaine 2 | Aftercare non ouvert ce mois-ci |
| Traitements | ⬜ mois 2 | Modèle d'ordonnance manquant (ADR-011) |
| Suivi | ⬜ mois 2 | Portail patient, ADR-015 |
| Statistiques | ⚪ semaine 2 | Sans valeur avant d'avoir un mois de données réelles |
| Agents | ⬜ mois 2 | Un seul agent existe : Jarvis |
| Journal d'activité | ⚪ semaine 2 | `audit.log` est rempli depuis S1, il lui manque un écran |
| Paramètres | ⚪ semaine 2 | Sauf la saisie du profil praticienne, requise en V6 |
| Transcription · Analyse en direct · Accueil QR | ⚪ semaine 2 | D-04, D-10, ADR-006 |

> ⚠️ Une entrée « bientôt » ne mène **jamais** à un écran cassé ni à une page blanche.
> Elle mène à une phrase qui dit ce que ce module fera et quand. Sinon elle ment.

---

## 3. LES TROIS MURS — à vérifier dans chaque module

**Mur 1 — l'assistante.**
Ne voit jamais : notes cliniques · transcriptions · diagnostics · contenu d'ordonnance ·
**motif de consultation**.
⚠️ Le motif a sa propre table `app.appointment_reasons`, **sans policy assistant**
(ADR-017). La RLS filtre des lignes, pas des colonnes — c'est pour ça que la vue seule
ne suffisait pas. C'est le piège n°1 du projet, et il est fermé en base.
**D-13 : l'assistante n'encaisse pas au mois 1.** `011` ne lui donne que `SELECT`.

**Mur 2 — entre praticiens.**
Aucun patient partagé. La Dr. #2 ne voit ni les patients, ni les notes, ni le chiffre
d'affaires d'autrui (ADR-003, D-14). En place depuis S1, même s'il n'y a qu'une
praticienne — ça se rattrape très mal plus tard.

**Mur 3 — Jarvis.**
Un agent n'a jamais plus de droits que l'humain qui l'a déclenché (L3).
Aucune écriture sans `confirmed_at`. Aucun outil hors allowlist.
**ADR-023 :** il répond sur la connaissance clinique, jamais sur un patient nommé.
**ADR-024 :** la voix passe par un flag, jamais par le navigateur.

---

## 4. LES POINTS D'ANCRAGE — pourquoi l'extension future reste facile

Toute clé étrangère future pointe vers l'une de ces trois tables :
```
patients · consultations · appointments
```

| Module futur | Se rattache par | Impact schéma |
|---|---|---|
| Transcription | `transcript_segments.consultation_id` | table nouvelle, zéro modification |
| Analyse en direct | `live_insights.consultation_id` | idem |
| Accueil QR | `pending_patients` → `patients` | idem |
| Échelles | `scale_administrations.consultation_id` | idem |
| Aftercare | `checkins.patient_id` | idem |
| Consentement | `consents.patient_id` | idem |
| Ordonnance | `+ 'ordonnance'` dans l'enum `app.doc_type` | une valeur d'enum, un modèle |
| 2ᵉ praticien | `appointments.practitioner_id` | **une colonne**, pas une refonte |
| 2ᵉ cabinet | `clinic_id` déjà présent partout | policies RLS à ajouter |
| Enveloppe Electron | second adaptateur de `DbPort` (ADR-020) | **aucun service touché** |
| Voix locale | `VOICE_PROVIDER=local` (ADR-024) | **une variable d'environnement** |

**Aucune table vide n'est créée aujourd'hui.** Une table vide créée maintenant serait
redessinée dans six semaines. La stabilité des ancrages suffit.

---

## 5. CE QU'ON N'AJOUTE JAMAIS

- Une colonne clinique à `patients` (antécédents, allergies, sommeil, consommations…)
  → ce sont des **modules séparés**. Une table `patients` obèse devient impossible à
  sécuriser finement.
- Une seconde table de configuration. `settings` suffit. Pas de `feature_flags`.
- Une table qui duplique une information existante.
- `patient_timeline` en table → c'est une **vue**. Extension future = un `UNION ALL`
  de plus, zéro migration.
- Un accès direct à `app.patients` : la lecture passe par `search_patients` et
  `get_patient`, qui journalisent (ADR-019). Le chemin non audité est **fermé**, pas
  déconseillé.
