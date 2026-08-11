# DOCUMENT-TEMPLATES.md
**Les 4 modèles de certificats — transcription, variables, arbitrages**
v1 — 2026-08-09 · relevé sur les 4 documents Word fournis (photos du 14/07/2026)
Alimente : `document_templates` (migration de seed) · S7b · V6 de `SPRINT-V1.md`

> Ce document est une **transcription**, pas une réécriture. Chaque écart avec
> l'original est signalé au §4.
>
> ✅ **Arbitrages A1 → A10 tranchés « CORRIGER » par la praticienne le 2026-08-09.**
> Le contenu définitif vit désormais dans `supabase/migrations/031_seed_document_templates.sql`,
> qui fait foi. Ce fichier en garde la genèse et la trace des corrections.

---

## 1. L'EN-TÊTE COMMUN

Identique sur les 4 documents. Times New Roman 14, encre verte (`--brand-700`).

```
┌──────────────────────────────────────┬─────────────────────────────┐
│  Dr. LARBI . N                       │  Date : {{date_du_jour}}    │
│  Médecin Spécialiste en Psychiatrie  │  Nom : {{patient_nom}}      │
│  et Psychothérapie                   │  Prénom : {{patient_prenom}}│
│  ────────────────────                │  Age : {{patient_age}} ans  │
│  الدكتورة العربي . ن            [LOGO]│                             │
│  طبيبة مختصة في الأمراض النفسية        │                             │
│  العقلية والعصبية                     │                             │
│  ────────────────────                │                             │
│  N° d'Ordre : 16/16780               │                             │
│  Tel : 0554813911                    │                             │
└──────────────────────────────────────┴─────────────────────────────┘
```

**Points fixes, relevés sur les 4 documents :**
- Bloc gauche français, bloc arabe dessous, filets horizontaux au-dessus et au-dessous de l'arabe
- Logo à droite du bloc arabe, cercle vert, arbre/cerveau dans une main
- Bloc droite : Date / Nom / Prénom / Age — **la date du jour vit ici, pas dans le corps**
- Aucun « Fait à Alger le … » en bas. Aucun bloc de signature imprimé.
- **Aucun numéro de document sur le papier** → `doc_number` reste interne (ADR-010)

⚠️ Le logo du certificat **n'est pas** le fichier `MINDCARE CENTER` fourni (cerveau
à feuilles + texte). C'est un autre logo : cercle plein, arbre/cerveau dans une main.
**Fichier source ou scan à plat requis** — il ne peut pas être vectorisé depuis une
photo d'écran.

---

## 2. CATALOGUE DES VARIABLES

### 2.1 Remplies automatiquement — la praticienne ne saisit rien
| Variable | Source | Exemple |
|---|---|---|
| `{{patient_nom}}` | `app.patients` | BELKACEM |
| `{{patient_prenom}}` | `app.patients` | Karim |
| `{{patient_civilite}}` | dérivée du sexe | Mr / Mme / Mlle |
| `{{patient_age}}` | calculée à l'émission | 34 |
| `{{patient_date_naissance}}` | `app.patients` | 01/01/2022 |
| `{{date_du_jour}}` | serveur, `Africa/Algiers` | 14/07/2026 |
| `{{doc_number}}` | `app.next_number` | interne, non imprimé |

### 2.2 Saisies à l'émission — un formulaire court, par type
| Variable | Modèles concernés |
|---|---|
| `{{piece_identite_numero}}` · `{{mairie_delivrance}}` | bonne santé mentale |
| `{{arret_jours}}` · `{{arret_jours_lettres}}` · `{{arret_date_debut}}` | suivi médical |
| `{{traitement}}` | certificat médical |

> `{{arret_jours_lettres}}` est **calculée**, pas saisie : 30 → « trente ».
> Conversion française à écrire et tester (accords, 80 → « quatre-vingts »,
> 71 → « soixante et onze », 100 → « cent »).

---

## 3. LES 4 CORPS — transcription fidèle, variables insérées

### 3.1 `bonne_sante_mentale` — « Certificat de bonne santé mentale »
```
Je soussignée, Dr. LARBI .N, Medecin spécialiste en psychiatrie.

    Certifie avoir reçu et examiné {{patient_civilite}} {{patient_nom}} {{patient_prenom}},
agé(e) de {{patient_age}} ans

    Porteur de la piéce d'identité Numéro {{piece_identite_numero}} délivrée par la
mairie de {{mairie_delivrance}}

    Et déclare qu'il ne présente aucun trouble psychique patent a l'examen ce jour
et apte d'assurer ses responsabilités civiles .

certificat remis à l'intéressé en main propre en vu d'établissement d'un acte notarié.
```
> Original : « Mr/Mme/Mlle » écrit en dur, les trois. Remplacé par `{{patient_civilite}}`,
> qui choisit selon le dossier. C'est le seul changement fonctionnel de ce corps.

### 3.2 `suivi_medical` — « Certificat de suivie médical »
```
Je soussignée, Dr. LARBI .N, Medecin spécialiste en psychiatrie,

Déclare que le patient(e) {{patient_nom}} {{patient_prenom}}, agé(e) de {{patient_age}}
nécessite un arrêt de travail de {{arret_jours}} Jours ({{arret_jours_lettres}} jours)
dater du {{arret_date_debut}}
```
> ✅ Confirme la règle chiffres + lettres d'ADR-011 : l'original porte
> « 30 Jours (trente jours) ».

### 3.3 `certificat_medical` — « Certificat médical »
```
Je soussignée , Dr. LARBI.N, Medecin spécialiste en psychiatrie, certifie que
{{patient_civilite}} {{patient_nom}} {{patient_prenom}}, né le {{patient_date_naissance}}
présente une affection Psychique Chronique et Invalidante nécessitant le traitement par

{{traitement}}

Le présent certificat est établis pour servir et valoir ce que de droit.
```
> ⚠️ `{{traitement}}` est un **champ libre multiligne**. Il n'est pas relié au module
> Traitements (hors périmètre, mois 2). Elle le saisit à l'émission.

### 3.4 `justification` — « justification »
```
Je soussignée , Dr. LARBI .N, Medecin spécialiste en psychiatrie, certifie que
{{patient_civilite}} {{patient_nom}} {{patient_prenom}}, né le {{patient_date_naissance}}
a été présent à la date sus-citée à ma consultation.
```
> « à la date sus-citée » renvoie à la date du bloc d'en-tête. Donc pour ce modèle,
> `{{date_du_jour}}` doit pouvoir être **remplacée par la date de la consultation
> concernée** si elle est antérieure. Question ouverte, §5.

---

## 4. ARBITRAGES — à faire trancher par la praticienne, elle seule

Ce sont **ses** documents, sa signature, sa responsabilité devant un tiers.
Ni Ayoub ni un agent ne corrige un texte juridique sans son accord.

| # | Où | Tel qu'écrit | Correction proposée |
|---|---|---|---|
| A1 | En-tête | **Pychiaterie** (3 documents sur 4) · **Psychiatrie** (1 sur 4) | « Psychiatrie » partout |
| A2 | Titre 3.2 | Certificat de **suivie** médical | Certificat de **suivi** médical |
| A3 | Les 4 corps | **Medecin** | **Médecin** |
| A4 | 3.1, 3.2 | **agé(e)** | **âgé(e)** |
| A5 | 3.1 | **piéce** d'identité | **pièce** d'identité |
| A6 | 3.1 | trouble psychique patent **a** l'examen | **à** l'examen |
| A7 | 3.1 | en **vu** d'établissement | en **vue** de l'établissement |
| A8 | 3.2 | **dater du** 16/07/2026 | **à dater du** |
| A9 | 3.3 | certificat est **établis** | certificat est **établi** |
| A10 | Titre 3.4 | **justification** (minuscule) | **Justification** |

**✅ TRANCHÉ LE 2026-08-09 : tout corriger, mise en page strictement inchangée.**
La recommandation était : Un certificat qui part chez un notaire ou un employeur avec
des fautes affaiblit celle qui le signe. Et A1 n'est de toute façon pas reproductible
à l'identique, puisque ses propres fichiers ne s'accordent pas.

Elle a suivi. Les dix corrections sont appliquées dans `031`, chacune annotée du
numéro de son arbitrage — pour qu'aucune relecture future ne les « corrige » à
l'envers en croyant restaurer l'original.

---

## 5. QUESTIONS OUVERTES — bloquent le seed

```
[ ] A1 → A10 tranchés, un par un
[ ] Fichier source du logo du certificat (cercle vert, arbre/cerveau dans une main)
    OU scan à plat 600 dpi. Une photo d'écran ne se vectorise pas.
[ ] Scan à plat d'un certificat imprimé, pour caler les marges au millimètre
    (le checkpoint est « poser le papier à côté du sien » — une marge se voit)
[ ] Le doc_number s'imprime-t-il ? Recommandation : non, il reste interne (ADR-010)
[ ] Modèle 3.4 : la date affichée doit-elle pouvoir être celle d'une consultation
    passée, ou toujours celle du jour ?
[ ] Y a-t-il un 5e document — l'ORDONNANCE ? ADR-011 la marque « MODÈLE MANQUANT ».
    Elle n'est pas dans les 4 fournis.
```

---

## 6. CE QUI EST DÉJÀ CONSTRUIT ET N'ATTEND QUE CE CONTENU

`030_document_gates.sql` est en place et revu en trois passes adversariales :
`app.issue_document` (SECURITY DEFINER, lecture en deux temps), numérotation sans
trou par compteur, année calculée en `Africa/Algiers`, `assert_document_immutable`
et `forbid_document_delete` sur la table elle-même, `rendered_html` figé à l'émission.

**Conséquence pratique, à dire à la praticienne :** réimprimer en décembre un
certificat émis en août redonne **exactement** le papier d'août — même si le modèle
a été corrigé entre-temps. Un certificat émis ne se réécrit jamais.
