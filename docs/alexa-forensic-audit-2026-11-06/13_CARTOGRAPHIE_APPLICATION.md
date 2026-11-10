# Cartographie de l'application — inventaire initial

**Statut : inventaire statique partiel, non recette des écrans.** Révision de référence : arbre de travail à `b4bd811`, avec modifications locales préexistantes. Les noms ci-dessous décrivent les chemins et composants présents ; ils ne prouvent ni les données installées ni le bon fonctionnement en production. Aucun dossier réel n'a été consulté. Le travail détaillé écran par écran et porte SQL par porte SQL reste à faire.

## 1. Structure et parcours commun

`package.json` déclare Next.js 15, React 19, Electron 33, PostgreSQL via `pg`, Zod et ONNX Runtime. `src/app/layout.tsx` fournit la racine graphique et `src/app/page.tsx` redirige `/` vers `/patients`. Les pages métier composent généralement `src/components/AppShell.tsx`, qui installe rail, barre supérieure, palette, panneau Alexa et gestion vocale ; l'assistante ne reçoit pas la bulle Alexa dans cette composition. Cette condition d'interface ne constitue pas une frontière de sécurité.

Schéma conceptuel à confirmer par des traces complètes : écran React → service dans `src/services` → `DbPort`/routes internes → adaptateur PostgreSQL → porte SQL et politiques. Les appels Alexa suivent leurs propres contrats et ne deviennent pas automatiquement capables d'accéder à toute fonction d'écran.

## 2. Routes et contenu identifié dans le code

| Route | Contenu ou fonction identifié | Entrées principales à examiner | État de preuve |
|---|---|---|---|
| `/` | Redirection vers l'annuaire patients | `src/app/page.tsx` | Code lu |
| `/connexion` | Formulaire de connexion et contrôle de l'installation | `src/app/connexion/page.tsx`, `src/services/auth.ts`, `src/services/onboarding.ts` | Imports et entrée lus |
| `/premiere-configuration` | Première configuration de l'installation | `src/app/premiere-configuration/page.tsx`, `src/services/onboarding.ts` | Route et imports ; étapes détaillées à tracer |
| `/tableauDeBord` | Composition distincte réception/praticienne : `CockpitReception` et `TableauDeBordPraticienne` | `src/app/tableauDeBord/page.tsx`, `src/services/reception.ts`, `src/services/dashboard.ts` | Portes et permissions effectives à vérifier |
| `/patients` | Annuaire, recherche et pagination ; délai de saisie 140 ms, minimum deux caractères, page de 50 | `src/app/patients/page.tsx`, `src/services/patients.ts`, `searchPatients` | Code d'entrée lu ; règles SQL actuelles à tracer |
| `/patients/nouveau` | Création d'un dossier et recherche de candidats similaires | `src/app/patients/nouveau/page.tsx`, `FormulaireCreation`, `PanneauSimilaires`, `creerPatient` | Imports et services identifiés |
| `/patients/[id]` | Fiche avec identité, contexte clinique, chronologie, séances, traitements, résumé de cas ; des composants de rendez-vous et documents sont associés au parcours patient | `src/app/patients/[id]/page.tsx`, `src/components/patients/`, `getPatientWorkspace`, `listPatientTimeline` | Composition partielle lue ; champs et droits par rôle à détailler |
| `/agenda` | Agenda et grille hebdomadaire ; plage graphique déclarée 8 h–19 h, sept jours | `src/app/agenda/page.tsx`, `GrilleSemaine`, `listAgenda` | Code d'entrée lu ; comportements à tracer |
| `/agenda/nouveau` | Création d'un rendez-vous ; durée par défaut déclarée de 30 minutes | `src/app/agenda/nouveau/page.tsx`, `createAppointment` | Code d'entrée lu |
| `/agenda/[id]` | Détail d'un rendez-vous, opérations associées et démarrage possible d'une consultation | `src/app/agenda/[id]/page.tsx`, `src/services/appointments.ts`, `startConsultation` | Imports lus ; transitions exactes à tracer |
| `/consultation/[id]` | Cockpit de séance : notes structurées, mesures, échelles, contexte, historique, documents, traitements, rendez-vous, synthèse et tarif | `src/app/consultation/[id]/page.tsx`, `src/components/consultation/`, `src/services/consultations.ts` | Composants identifiés ; cycle complet et permissions à tracer |
| `/documents` | Espace de documents et brouillons | `src/app/documents/page.tsx`, `DocumentWorkspace`, `src/services/documents.ts`, `src/services/document-drafts.ts` | Entrée identifiée ; types et cycle juridique à détailler |
| `/finances` | Période, panneaux de caisse, séances et charges ; période initiale mois | `src/app/finances/page.tsx`, `src/services/finance-cash.ts`, `src/services/finance.ts` | Composants et services identifiés ; définitions de chaque indicateur à vérifier |
| `/statistiques` | Activité, rythme, nouveaux et retours, statuts RDV, diagnostics documentés, échelles, traitements, qualité du dossier et autres panneaux | `src/app/statistiques/page.tsx`, `src/services/analyse.ts`, `src/components/analyse/` | La page appelle `getAnalyseOverview` ; limites et calculs SQL à vérifier |
| `/traitements` | Vue de charge liée aux traitements | `src/app/traitements/page.tsx`, `ChargeTraitements`, `src/services/medication-workspace.ts` | Route et composant identifiés ; contenu et accès à détailler |
| `/messages` | Conversations, messages, routage, rapprochement patient, consentement et connexions | `src/app/messages/page.tsx`, `src/services/communication/` | Code d'entrée lu ; fonctionnement des canaux et envois NON VÉRIFIÉ |
| `/jarvis` | Conversation Alexa/Jarvis, saisie et carte de confirmation | `src/app/jarvis/page.tsx`, `FilJarvis`, `SaisieAlexaLune`, `CarteConfirmation` | Composants identifiés ; parcours complet à tracer |
| `/observabilite` | Panneau d'observabilité | `src/app/observabilite/page.tsx`, `PanneauObservabilite`, `src/services/observabilite-lecture.ts` | Route et composant identifiés ; permissions et contenu à vérifier |
| `/parametres` | Index des paramètres | `src/app/parametres/page.tsx` | Route identifiée |
| `/parametres/cabinet` | Paramètres du cabinet | `src/app/parametres/cabinet/page.tsx`, `src/services/cabinet.ts` | Route identifiée ; actions à tracer |
| `/parametres/documents` | Paramètres documentaires et numéro professionnel | `src/app/parametres/documents/page.tsx`, `updateDocumentOrderNumber` | Imports lus |

L'inventaire provient de `rg --files src/app` sur les fichiers `page.tsx` et `layout.tsx`. `27_ECRANS_INVENTAIRE_JSX.md` complète cet index avec les composants JSX et 187 attributs d'événements détectés dans les 21 pages par analyse TypeScript. Il ne recense pas encore les contrôles des composants imbriqués, chaque état vide, boîte de dialogue, rôle et service interne.

## 3. Capacités métier repérées dans les services

- Patients : recherche, lecture, espace patient, chronologie, modification, recherche de doublons, création et signalement de résumé (`src/services/patients.ts`).
- Rendez-vous : liste, détail, création, modification, confirmation, annulation (`src/services/appointments.ts`). Accueil : tableau, arrivée et absence (`src/services/reception.ts`).
- Séances : ouverture, lecture, détails, notes libres, fermeture, notes structurées, signature et amendement (`src/services/consultations.ts`). Une fonction présente ne prouve pas qu'une opération soit permise à tous.
- Finances : prix, paiement, encaissement, recette et liste du jour (`src/services/finance.ts`) ; vue de caisse, charges, séances et opérations de charges (`src/services/finance-cash.ts`). Le nom `deleteCharge` ne suffit pas à déterminer le comportement SQL réel.
- Documents : émission, lecture, listes, marquage d'impression, annulation et contrôle d'empreinte (`src/services/documents.ts`).
- Médicaments et traitements : recherche du catalogue et variantes (`src/services/medications.ts`), états et historique de traitement (`src/services/patient-treatments.ts`) ; allergies, événements indésirables, mesures, observance, interactions et liens de renouvellement sont représentés par des services dédiés (`src/services/medication-phase2.ts`). Leur exposition réelle dans chaque écran et à Alexa reste à confirmer.
- Analyse : vue d'ensemble et détail (`src/services/analyse.ts`). Les définitions et autorisations sont à vérifier dans les portes SQL, pas déduites des titres des graphiques.

## 4. Application et Alexa : premier raccordement

`src/shared/alexa/agent.ts` définit les contrats natifs `query_patients`, `get_patient_context`, `query_consultations`, `query_agenda`, `query_documents`, `query_finance`, `query_app`, `search_knowledge`, `prepare_action`, `navigate`, `ask_doctor` et `answer_general`. Les vues `query_app` comprennent cabinet, praticienne, notifications, système, brouillon de message, réception et catalogue de médicaments. `src/server/alexa/agent-tools.ts` contient les branches d'exécution et des refus explicites. Cette liste n'est pas une matrice complète de permissions ni une preuve que chaque bouton ou donnée de l'application est accessible à Alexa.

Pour les finances, les schémas distinguent les vues du cabinet (`overview`, `charges`, `composition`, `evolution`, `calendar`, `attention`) des lignes de paiements (`list`, `totals`, `group`). Cette distinction doit être conservée pour éviter de confondre chiffre d'affaires et encaissements ; la définition SQL précise reste à auditer.

## 5. API et données

Les routes découvertes couvrent authentification, `db/select` et `db/rpc`, santé, Alexa, Jarvis/voix, collaboration LAN et communication. Leur inventaire et leurs permissions sont à établir route par route. Voir `14_DONNEES_ET_PREUVES.md` pour les familles de tables relevées dans les migrations.

## 6. À faire avant une cartographie exhaustive

Lire les composants et services de chaque écran, tracer leurs appels et portes SQL jusqu'aux politiques et aux champs retournés, puis distinguer interface présente, capacité raccordée, fonctionnalité expérimentale et disponibilité installée. Vérifier les migrations effectivement appliquées uniquement sur un environnement identifié et autorisé, sans afficher les données patients. La liste des écrans ici ne remplace pas une inspection visuelle ou des tests de rôle.
