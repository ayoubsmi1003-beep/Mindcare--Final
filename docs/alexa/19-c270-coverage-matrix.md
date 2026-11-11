# 19 — C270 : matrice de couverture des campagnes précédentes

Écrit le 2026-11-11, avant toute écriture de question C270 et avant tout changement d'Alexa.
Source : `v1/cases.json` (C200), `v2/cases.json` + `v2/holdout.json` (C201), `v3/cases.json` (C202), soit **753 tours**, dont **90 conversations à plusieurs tours**.
Script : comptage par type de réponse attendue (`expect.k`), par écran et par formulation. Aucun nom de patient dans ce document.

## 1. Ce qui a déjà été testé (tours, toutes campagnes confondues)

| Type attendu | C200 | C201 | C201 réserve | C202 | Lecture |
|---|---:|---:|---:|---:|---|
| book (livres) | 35 | 35 | 6 | 35 | saturé en nombre ; ~105 sujets déjà pris |
| summary (synthèse) | 33 | 24 | 3 | 22 | **saturé** |
| treat (traitement en cours) | 30 | 20 | 3 | 18 | **saturé** |
| count (nombre de séances) | 19 | 19 | 2 | 19 | **saturé** |
| a_count (agenda, nombre) | 24 | 14 | 2 | 16 | **saturé** |
| lastdate (dernière venue) | 17 | 19 | 1 | 18 | **saturé** |
| a_list (agenda, liste) | 9 | 12 | 3 | 12 | bien couvert |
| f_revenue (recettes) | 8 | 10 | 4 | 9 | bien couvert |
| history / firstdate / lastnote / prev | 6–9 chacun | | | | couvert |
| clarify, n_consults, nextappt, a_daypart, nextpatient, who | 2–6 | | | | mince |
| f_expenses, documents, a_cancelled, scales, a_next, plain | 1–4 | | | | **mince** |
| prevtreat, evolution | 3 (C200 seulement) | 0 | 0 | 0 | **presque jamais** |
| diag (diagnostics) | 1 | 0 | 0 | 0 | **presque jamais** |
| a_free, f_net, f_compare, f_sessions, f_other_methods, n_new, n_busiest, n_compare, n_active_patients, n_overview, f_outstanding, f_cash, f_overview | 1 par campagne | | | | **un seul cas chacun** |

Écrans : global 544 · fiche patient 146 · consultation ouverte 63.
Formulations : direct 126 · conversationnel 73 · court 68 · familier 45 · formel 43 · ordre des mots 25 · période seule 22 · synonymes 20 · pronoms 20 · suites 20 · autre patient 15 · fautes de frappe 10 · sujet implicite 6 (260 tours de C200 sans étiquette).

## 2. Ce que l'application sait lire et qui n'a jamais (ou presque) été demandé

Relevé dans les schémas d'outils (`src/shared/alexa/agent.ts`) et le routeur (`src/shared/alexa/request-contract.ts`).
**À confirmer contre la base d'évaluation avant d'écrire la question** (étape 0) : une capacité sans donnée dans la base n'entre pas dans C270.

| Domaine | Capacité existante | Paramètres |
|---|---|---|
| Patient | sections `diagnoses` (actifs / résolus, principal / secondaire) | `diagnosisState`, `diagnosisRole` |
| Patient | `treatments` par état (actif, suspendu, arrêté) ; dose, unité, fréquence, moments, début, fin | `treatmentState` |
| Patient | `medication_timeline` (historique des changements) | — |
| Patient | `allergies`, `adverse_events`, `adherence`, `measurements` (poids, IMC, TA, lithiémie, glycémie) | — |
| Patient | `notes` par rubrique (subjectif, objectif, évaluation, plan, amendement) et recherche dans les notes | `area`, `query`, `status` |
| Patient | `scales` (scores d'échelles) ; `timeline` ; `current` (séance en cours) ; `case_summary_status` | — |
| Patient | `profile` (téléphone, naissance, âge, adresse, contact d'urgence…) | — |
| Patients | recherche / comptage avec conditions (téléphone manquant, CNI manquante, âge, jamais vus, non vus depuis 6 mois, solde dû) | `query_patients` |
| Consultations | comptage / liste par statut (ouvertes, closes, **non signées**), par axe de date | `query_consultations` |
| Agenda | statuts `no_show`, `cancelled`, `requested`, `arrived`… ; rendez-vous d'un patient nommé ; créneaux libres | `query_agenda` |
| Documents | par type (certificat, justification, ordonnance…) et par statut (émis, brouillon, annulé) | `query_documents` |
| Finance | `charges`, `composition`, `evolution`, `calendar`, `attention`, `totals`, `list`, `group`, état payé / en attente | `query_finance` |
| Application | accueil / file d'attente, statistiques, charge des traitements à revoir, catalogue des médicaments | `query_app` |

## 3. Formes conversationnelles peu ou pas testées

- Correction du patient (« non, l'autre », « je parlais de … »).
- Demande de réponse plus courte ou plus détaillée.
- Retour à un sujet antérieur après un changement de sujet.
- Patient nommé pendant une consultation ouverte d'un autre patient, puis suite par pronom.
- Passage dossier → livres sur la même molécule, et retour au dossier.
- Questions à deux demandes (deux outils) sans « puis ».
- Fautes de frappe et sujet implicite (16 tours seulement en tout).

## 4. Règle de répartition C270

Les 270 questions (Patients 55 · Identité et contexte 45 · Agenda 40 · Finance et activité 35 · Livres 80 · Variation 15) visent d'abord les cases **minces ou vides** des §1 à §3. Les types saturés n'apparaissent qu'en suite de conversation ou en variation, jamais comme simple reformulation.
Livres : 80 sujets **absents** des ~105 sujets de C200 à C202, choisis après lecture du corpus actif.
Garde-fous de construction : Jaccard ≥ 0,70 et similarité e5-base ≥ 0,92 contre les 753 tours précédents → refus.
