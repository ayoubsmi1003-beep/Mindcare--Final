# MindCare OS — Certificate Templates v2

**Status:** Approved by Dr. Larbi Nassiba
**Source:** Extracted from doctor's original Word templates (screenshots, 2026-07-14)
**Supersedes:** any earlier `DOCUMENT-TEMPLATES.md` versions with practitioner data hardcoded
**Related:** `031_seed_document_templates.sql`

---

## Shared header block (all four templates)

All four certificates use the same letterhead. This should be a single partial/component, not duplicated per template.

```
Dr. LARBI. N
Médecin Spécialiste en Psychiatrie et Psychothérapie
الدكتورة العربي-ن
طبيبة مختصة في الأمراض النفسية العقلية والعصبية
N° d'Ordre: 16 / 16780
Tel: 0554813911

Date: {{date}}
Nom: {{nom}}
Prénom: {{prenom}}
Age: {{age}}
```

> Note: original scans had "Pychiaterie" (typo) — corrected to "Psychiatrie" here, per doctor's approved correction list.

---

## Variable source classification

Every variable below is tagged so the doc-generation engine knows whether to auto-fill it from patient/consultation data or prompt the doctor.

| Variable | Source | Notes |
|---|---|---|
| `{{date}}` | **SYSTEM** | Consultation date / today |
| `{{nom}}` | **SYSTEM** | From patient record |
| `{{prenom}}` | **SYSTEM** | From patient record |
| `{{age}}` | **SYSTEM** | Computed from patient DOB at generation time |
| `{{date_naissance}}` | **SYSTEM** | From patient record |
| `{{date_consultation}}` | **SYSTEM** | From active/selected consultation |
| `{{numero_piece}}` | **DOCTOR INPUT** | ID card number — not part of core patient record, only needed for notarial certs |
| `{{lieu_delivrance}}` | **DOCTOR INPUT** | ID card issuing municipality |
| `{{duree}}` | **DOCTOR INPUT** | Sick-leave duration in days — clinical decision at time of visit |
| `{{date_debut}}` | **DOCTOR INPUT** | Sick-leave start date |
| `{{traitement_1}}` | **DOCTOR INPUT** | Free-text treatment line |
| `{{traitement_2}}` | **DOCTOR INPUT** | Free-text treatment line (optional, can be empty) |

**UX implication:** the certificate generation screen should pre-fill SYSTEM variables silently (patient already selected → all four resolve instantly) and only render input fields for the DOCTOR INPUT variables specific to whichever certificate type was picked. This keeps to the one-screen, low-friction pattern — the doctor never re-types name/age/date.

---

## Template 1 — Certificat de bonne santé mentale

**doc_type_id:** `bonne_sante_mentale`
**Doctor-input fields for this type:** `numero_piece`, `lieu_delivrance`

```
Certificat de bonne santé mentale

Je soussignée, Dr. LARBI N., Médecin spécialiste en Psychiatrie et
Psychothérapie, Certifie avoir reçu et examiné ce jour Mr/Mme/Mlle
{{nom}} {{prenom}}, âgé(e) de {{age}} ans, porteur(euse) de la pièce
d'identité n° {{numero_piece}}, délivrée par la mairie de
{{lieu_delivrance}}.

Et déclare qu'il/elle ne présente, à l'examen de ce jour, aucun trouble
psychique apparent et est apte à assurer ses responsabilités civiles.

Certificat établi à la demande de l'intéressé(e) et remis en main propre,
pour servir et valoir ce que de droit en vue de l'établissement d'un acte
notarié.
```

---

## Template 2 — Certificat de suivi médical

**doc_type_id:** `suivi_medical`
**Doctor-input fields for this type:** `duree`, `date_debut`
**Title correction applied:** "Certificat de **de** suivi médical" → "Certificat de suivi médical" (duplicate "de" in original export)

```
Certificat de suivi médical

Je soussignée, Dr. LARBI N., Médecin spécialiste en Psychiatrie et
Psychothérapie, Déclare que le/la patient(e) {{nom}} {{prenom}}, âgé(e)
de {{age}} ans, suivi(e) dans le cadre de sa prise en charge médicale,
nécessite un arrêt de travail de {{duree}} jours, à compter du
{{date_debut}}.

Certificat établi pour servir et valoir ce que de droit.
```

---

## Template 3 — Certificat médical

**doc_type_id:** `certificat_medical`
**Doctor-input fields for this type:** `traitement_1`, `traitement_2`

```
Certificat médical

Je soussignée, Dr. LARBI N., Médecin spécialiste en Psychiatrie et
Psychothérapie, Certifie que Mr/Mme/Mlle {{nom}} {{prenom}}, né(e) le
{{date_naissance}}, présente une affection psychique chronique et
invalidante nécessitant un traitement par :
  - {{traitement_1}}
  - {{traitement_2}}

Le présent certificat est établi pour servir et valoir ce que de droit.
```

> `{{traitement_2}}` should be allowed to render as an empty/omitted bullet if the doctor leaves it blank — don't force two lines.

---

## Template 4 — Justification

**doc_type_id:** `justification`
**Doctor-input fields for this type:** none — fully system-filled

```
Justification

Je soussignée, Dr. LARBI N., Médecin spécialiste en Psychiatrie et
Psychothérapie, Certifie que Mr/Mme/Mlle {{nom}} {{prenom}}, né(e) le
{{date_naissance}}, a été présent(e) à la date du {{date_consultation}}
à ma consultation.

Attestation établie à la demande de l'intéressé(e), pour servir et
valoir ce que de droit.
```

---

## Summary table — all four templates

| # | Title | doc_type_id | Doctor-input variables |
|---|---|---|---|
| 1 | Certificat de bonne santé mentale | `bonne_sante_mentale` | `numero_piece`, `lieu_delivrance` |
| 2 | Certificat de suivi médical | `suivi_medical` | `duree`, `date_debut` |
| 3 | Certificat médical | `certificat_medical` | `traitement_1`, `traitement_2` |
| 4 | Justification | `justification` | *(none)* |
