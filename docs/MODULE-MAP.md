# MODULE-MAP.md
**Où vit chaque module. Une ligne par module. C'est tout ce qu'un agent doit lire.**
v1 — 2026-08-02 · remplace `Features.md`

> Un agent lit **sa ligne**, pas le fichier entier.
> Statut : 🟢 livré · 🟡 sprint 4 jours · ⚪ semaine 2 · ⬜ mois 2+

---

## 1. LA CARTE

| # | Module | Statut | Route | Tables | Agent | Rôles |
|---|---|---|---|---|---|---|
| 00 | Jetons + i18n | 🟢 | — | — | — | — |
| 00b | Supabase auto-hébergé | 🟡 S0 | — | — | — | — |
| 01 | Auth & rôles | 🟡 S2 | `/connexion` | `profiles`, `cabinets` | feature-builder | tous |
| 02 | Coquille & nav | 🟡 S2 | `/` | — | ui-builder | tous |
| 03 | **Patients** | 🟡 S3 | `/patients` | `patients`, `patient_contacts`, `patient_merges` | feature-builder | owner, practitioner |
| 04 | **Agenda** | 🟡 S4 | `/agenda` | `appointments` | feature-builder | practitioner (front assistante → sem. 2, D-08) |
| 05 | **Consultation** | 🟡 S5 | `/consultation/[id]` | `consultations`, `clinical_notes` | feature-builder | practitioner seul |
| 06 | **Jarvis texte** | 🟡 S6 | overlay global | `jarvis_actions` | jarvis-tooler | owner, practitioner |
| 07 | **Documents** | 🟡 S7 (sacrifiable à 2 modèles) | `/documents` | `documents`, `document_templates`, `counters` | feature-builder | practitioner |
| 08 | Tableau de bord | ⚪ | `/` | vues d'agrégat | feature-builder | owner |
| 09 | Transcription | ⚪ | dans 05 | `transcript_segments` | jarvis-tooler | practitioner |
| 10 | Analyse en direct | ⚪ | dans 05 | `live_insights` | jarvis-tooler | practitioner |
| 11 | Accueil QR | ⚪ | app séparée | `pending_patients` | feature-builder | intake_writer |
| 12 | **Finance** | 🟡 S7 | `/finance` | `payments` | feature-builder | owner (D-09) |
| 13 | Traitements | ⬜ | `/traitements` | `prescriptions`, `medications` | — | practitioner |
| 14 | Échelles | ⬜ | dans 03 | `scales`, `scale_administrations` | — | practitioner |
| 15 | Aftercare | ⬜ | portail séparé | `checkins` | — | patient |
| 16 | Journal d'audit | ⬜ | `/journal` | `audit.log` | — | owner |

**Front assistante = semaine 2 (D-08).** Mais son rôle, ses policies RLS et la vue `appointments_admin`
sont créés **en base dès S1**. La sécurité s'installe maintenant ou jamais — l'écran peut attendre.

---

## 2. LES TROIS MURS — à vérifier dans chaque module

**Mur 1 — l'assistante.**
Ne voit jamais : notes cliniques · transcriptions · diagnostics · contenu d'ordonnance · **motif de consultation**.
⚠️ Le motif est une **colonne**, pas une ligne. La RLS ne le protège pas.
Le front assistante interroge **la vue `appointments_admin`**, jamais la table `appointments`.
C'est le piège n°1 du projet. Il se vérifie au module 04 et se re-vérifie à chaque revue.

**Mur 2 — entre praticiens.**
Aucun patient partagé. Dr #2 ne voit ni les patients, ni les notes, ni le chiffre d'affaires d'autrui.
Mis en place maintenant même s'il n'y a qu'une praticienne — se rattrape très mal plus tard.

**Mur 3 — Jarvis.**
Un agent n'a jamais plus de droits que l'humain qui l'a déclenché.
Aucune écriture sans `confirmed_at`. Aucun outil hors allowlist.

---

## 3. LES POINTS D'ANCRAGE — pourquoi l'extension future est facile

Toute clé étrangère future pointe vers l'une de ces trois tables :
```
patients · consultations · appointments
```
Ce sont les tables les plus stables du système. Elles ne bougent plus.

| Module futur | Se rattache par | Impact schéma |
|---|---|---|
| Transcription | `transcript_segments.consultation_id` | table nouvelle, zéro modification |
| Analyse en direct | `live_insights.consultation_id` | idem |
| Accueil QR | `pending_patients` → `patients` | idem |
| Échelles | `scale_administrations.consultation_id` | idem |
| Aftercare | `checkins.patient_id` | idem |
| Consentement | `consents.patient_id` | idem |
| Mémoire agents | `agent_memory` (`scope` + `owner_id`) | table isolée |
| 2ᵉ praticien | `appointments.practitioner_id` | **une colonne**, pas une refonte |
| 2ᵉ cabinet | `clinic_id` déjà présent partout | policies RLS à ajouter |
| Notes structurées | `note_sections.note_id` | `content` reste du texte libre |

**Aucune table vide n'est créée aujourd'hui.** Une table vide créée maintenant serait redessinée
dans six semaines. La stabilité des ancrages suffit.

---

## 4. CE QU'ON N'AJOUTE JAMAIS

- Une colonne clinique à `patients` (antécédents, allergies, sommeil, consommations…)
  → ce sont des **modules séparés**. Une table `patients` obèse devient impossible à sécuriser finement.
- Une seconde table de configuration. `settings` suffit. Pas de `feature_flags`.
- Une table qui duplique une information existante.
- `patient_timeline` en table → c'est une **vue**. Extension future = un `UNION ALL` de plus, zéro migration.
