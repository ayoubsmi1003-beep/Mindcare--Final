# V9 — Plan de transformation MindCare OS

> **Contrat d'exécution.** Écrit après inspection du dépôt réel, pas de la documentation.
> Chaque constat est sourcé par un fichier et une ligne.
> Hiérarchie respectée : migrations appliquées > CLAUDE.md > ADR > design-system > STATE.

---

## 0. Pourquoi ce plan existe

La demande : rendre l'application beaucoup meilleure, sans en faire un autre produit.
Hors périmètre explicite : Aftercare, module crise/triage, refonte du domaine Documents,
mode sombre, système de raccourcis clavier.

Le constat central de l'inspection change tout le plan :

> Presque tout ce que la demande réclame pour la Consultation **existe déjà** — mais vit
> uniquement dans l'écran Patient. La transformation phare est un travail de
> **composition et de réemploi**, pas de construction. **Zéro migration.**

---

## 1. Constats de l'état actuel

### 1.1 Consultation — l'écran phare est le plus pauvre

| Constat | Preuve |
|---|---|
| Un seul fichier client de **1498 lignes** | `src/app/consultation/[id]/page.tsx` |
| Deux colonnes, **aucun onglet**, défilement long | JSX 1365-1498, `EspaceTravail` (`src/components/ui/Espaces.tsx:45`) |
| Aucune information patient au-delà du nom et du n° de dossier | colonne contexte, `GrilleChamps` |
| Aucun historique, aucun traitement, aucun document, aucun rendez-vous | la page n'importe que 4 services : `consultations`, `apres-seance`, `insertion-dictee`, `jarvis` |
| « Fil de séance » = `EtatVide` honnête, non implémenté | colonne contexte |
| 3 appels au chargement, budget = **2** | `getConsultation` + `chargerAnalyse` + `listAmendments`, `docs/06-PERF-BUDGET.md` §2 |

### 1.2 Tout le matériel manquant existe déjà, ailleurs

| Composant réutilisable | Fichier | Lignes |
|---|---|---|
| Résumé du cas | `src/components/patients/CarteResumeCas.tsx` | 441 |
| Chronologie, curseur keyset | `src/components/patients/ChronologiePatient.tsx` | 308 |
| Traitements V2 (ADR-028) | `src/components/patients/PanneauTraitements.tsx` | 823 |
| Rendez-vous | `src/components/patients/PanneauRendezVous.tsx` | 131 |
| Documents du patient | `src/components/documents/SectionDocumentsPatient.tsx` | 105 |
| Diagnostics et échelles | `src/components/patients/PanneauClinique.tsx` | 305 |
| Sections déterministes, zéro IA | `src/components/patients/SectionsDeterministes.tsx` | 210 |
| **Onglets ARIA complets + clavier** | `src/components/ui/Onglets.tsx` | 170 |

### 1.3 Aucune migration n'est nécessaire pour la Consultation

Toutes les portes requises sont déjà dans l'allowlist des 71
(`src/server/db/allowlist.generated.ts`) : `get_patient_workspace`,
`list_patient_timeline`, `get_consultation`, `get_consultation_analysis`,
`get_patient_treatments`, `get_treatment_history`, `list_patient_documents`,
`list_agenda`, `get_appointment`.

`list_patient_timeline` (047) rend `event_id` = l'id de la consultation pour les
événements de type `consultation`. **Cliquer une date passée se résout donc avec
`get_consultation(event_id)` + `get_consultation_analysis(event_id)`, sans schéma neuf.**

Porte morte trouvée : `app.get_previous_note` (migration 027) existe en base mais n'est
appelée par aucun service — absente de l'allowlist, qui est générée depuis les sites
d'appel réels (`scripts/gen-db-allowlist.mjs`).

### 1.4 Le bug de civilité — cause racine trouvée

Ce n'est pas un oubli, c'est une régression volontaire et documentée :

- `043_document_render_context.sql:396` — `civilite` dérive de `app.sex` : `M` donne `Mr`,
  `F` donne `Mme`. Pas de « Mlle », l'enum `app.sex` (002) n'ayant que deux valeurs.
- `044_seed_document_templates.sql:137` — les gabarits utilisaient `{{patient.civilite}}`.
- **`045_document_templates_v2.sql:85-88`** — « Mr/Mme/Mlle REDEVIENT LITTÉRAL, les trois…
  perte acquittée le 2026-08-21 ». Retour au texte Word d'origine.
  Donc `045:580`, `633`, `657` impriment littéralement `Mr/Mme/Mlle NOM Prénom`.

Le résolveur `civilite` est par ailleurs recopié dans trois migrations : 043, 045, 061.
La signature vivante est **061** (`061_documents_snapshot_and_lifecycle.sql:381`).

Conséquence : rendre « Mlle » possible exige une donnée que le dossier ne porte pas.
C'est exactement pourquoi la demande §36 (Célibataire / En couple) et §37 (bug civilité)
sont une seule et même fonctionnalité. **Décision humaine requise, règle 9.**

### 1.5 Le bug de rôle — corrigé en surface, latent en profondeur

L'incident « owner voit Réception » a déjà été instruit : migrations 086/087 non
appliquées, contrôle de démarrage en échec, **503 sur chaque `/api/db/*`**,
`getCurrentUser()` échoue, `utilisateur = null`, puis `?? "assistant"`.
Verrouillé par `tests/e2e/role-resolution.spec.ts` (R1 à R6).

Le défaut de conception, lui, est toujours là :

```ts
// src/components/useSessionEcran.ts
setUtilisateur(profil.ok ? profil.data : null);   // erreur donne null
// src/app/tableauDeBord/page.tsx:91
const role = utilisateur?.role ?? "assistant";    // null donne Réception
```

`getCurrentUser()` rend `null` pour **quatre causes distinctes** — pas de session, pas de
ligne, rôle invalide, échec de transport — et l'écran les traite toutes comme
« assistante ». N'importe quelle panne réseau future rejoue le symptôme. La RLS tient,
aucune donnée ne fuit, mais l'écran affirme un rôle qu'il n'a pas vérifié — ce que
`authz.ts` interdit explicitement dans son propre en-tête.

### 1.6 Graphiques

Aucune bibliothèque de graphiques, et c'est une décision mesurée
(`src/components/ui/Graphes.tsx`, en-tête : budget de bundle, fidélité aux jetons, a11y).
Six familles de teintes complètes existent déjà — `emeraude`, `azure`, `violet`, `ambre`,
`corail`, `aqua` (`Graphes.tsx:99-128`).
**Aucun graphique n'est rendu sur Consultation ni sur Patient.**

### 1.7 Alexa

- La bulle flottante a été retirée volontairement en V7 ; le lanceur est la pastille de
  commande de la Topbar et `⌘K` (`AppShell.tsx` §4, `PanneauJarvis.tsx:44-50, 95`).
- L'ancre de conversation existe déjà : `conversation.ts:226`, TTL 15 minutes
  (`jarvis-contexte.ts:77`), invalidée par écran occupé, cible existante ou expiration.
- 5 outils gelés (contrainte SQL `jarvis_tool_allowlist`, migration 033), 24 capacités de
  lecture, 7 écritures avec `verifier` obligatoire.
- **10 suites d'évaluation existent mais ne sont dans aucun script `package.json`** :
  elles ne tournent que via `scripts/checkpoint-jarvis-couche.sh`.

### 1.8 Écrans annoncés mais inexistants

`statistiques`, `messages`, `traitements`, `suivi`, `agents`, `journalActivite` figurent
dans `NAVIGATION_PRATICIENNE` mais pas dans `ECRANS_CONSTRUITS` (`Rail.tsx:83-91`) : ils
s'affichent en « bientôt ». **Il n'y a pas d'écran Analytics.**

---

## 2. Ordre d'exécution

Chaque lot est livrable seul, vérifiable seul, réversible seul.

| Lot | Contenu | Migration | Décision humaine |
|---|---|---|---|
| **A** | Consultation vers cockpit à sous-navigation | non | non |
| **B** | « Depuis la dernière fois », déterministe | non | non |
| **C** | Durcissement rôle et session | non | non |
| **D** | Alexa : entrée flottante, style de réponse, évals câblées | non | **oui** (§22) |
| **E** | Graphiques et polissage visuel | non | non |
| **F** | Civilité et situation familiale | **oui** | **oui** (règle 9) |

---

## 3. Lot A — Consultation, écran phare

### A.1 Sous-navigation compacte

`Séance · Résumé · Historique · Traitement · Documents · Rendez-vous`

Réemploi de `Onglets` et `PanneauOnglet` (`src/components/ui/Onglets.tsx`) : déjà ARIA
complet, déjà navigable au clavier, déjà utilisé par l'écran Patient.
**Aucune primitive nouvelle.**

Règle de chargement : `Séance` monte seul à l'ouverture. Chaque autre onglet lit à sa
première ouverture, jamais avant — patron exact de l'écran Patient, où chronologie et
documents sont déjà paresseux. Le budget d'ouverture reste donc à 2 appels.

### A.2 En-tête patient persistant et compact

Une seule bande, opaque (§4.2 de `V8-AURORA.md` : aucun dégradé derrière un nom de
patient) : nom, âge, n° de dossier, état de la séance, chrono, indicateur de traitement en
cours, dernière consultation. **Pas de seconde carte d'identité ailleurs** (demande §64).

### A.3 Historique — le geste central

`list_patient_timeline` filtré sur les événements de consultation donne une frise de
dates. Clic sur une date : panneau de détail focalisé **dans l'écran**, alimenté par
`get_consultation(event_id)` et `get_consultation_analysis(event_id)`.
**La séance en cours n'est jamais démontée** : la saisie clinique reste intacte.

### A.4 Fichiers touchés

- `src/app/consultation/[id]/page.tsx` devient une coquille ; la logique de séance part
  dans `src/components/consultation/PanneauSeance.tsx`.
- Nouveaux, dans `src/components/consultation/` : `EnTeteConsultation.tsx`,
  `OngletsConsultation.tsx`, `PanneauHistorique.tsx`, `DetailConsultationPassee.tsx`.
- `src/i18n/fr.ts` pour tous les libellés (ADR-008, aucune chaîne en dur).

---

## 4. Lot B — « Depuis la dernière fois »

Diff déterministe, calculé en TypeScript pur depuis des données déjà lues : traitement
modifié, nouvelle note signée, nouveau document, rendez-vous changé.
**Aucun appel LLM, aucune conclusion clinique.** L'écran énonce le fait et sa date, jamais
son interprétation. Réemploi de `SectionDepuisDerniere` (`SectionsDeterministes.tsx`).

---

## 5. Lot C — Rôle et session

1. `useSessionEcran` expose un état `profilIllisible` distinct de `null`.
2. Les écrans qui composent par rôle n'appliquent plus `?? "assistant"` sur un profil
   illisible : ils rendent une coquille neutre et un `BlocErreur` avec « réessayer ».
   Composer la vue la plus étroite reste correct pour un rôle **inconnu** ; ce ne l'est pas
   pour une lecture **en panne**, qui doit se dire.
3. Test de régression du **mode de panne**, et non plus seulement de l'état de la base :
   interception de `/api/db/select` sur `profiles`, réponse 503, l'écran ne doit jamais
   afficher « Poste d'accueil » à un owner.

Aucune conséquence sur la sécurité des données : la RLS reste l'unique frontière (règle 4).

---

## 6. Lot D — Alexa (bloqué sur une décision)

- Entrée flottante bas-droite : contredit le retrait volontaire de V7. Demande §22 contre
  décision V7, **arbitrage humain**.
- Style de réponse : réponse courte, puis détails, puis source, puis actions. En voix :
  phrases courtes, aucun identifiant technique, aucune énumération de base.
- Évals : câbler les 10 suites existantes dans `package.json`, puis ajouter les familles
  réclamées — suivi contextuel, « l'autre Karim », injection par note patient, mauvais
  patient, action non autorisée.

Les frontières ne bougent pas : 5 outils gelés, pseudonymisation avant sortie,
proposer, confirmer, exécuter, vérifier, journaliser.

---

## 7. Lot E — Graphiques et polissage

Pas de bibliothèque : la décision mesurée est conservée. Étendre `Graphes.tsx` et donner
un sens aux six familles — recette, types de séance, terminé, en attente, annulé.
Interdits maintenus : aucun graphique décoratif (règle 8), aucun dégradé derrière une
valeur clinique (§4.2).

---

## 8. Lot F — Civilité (bloqué sur une décision, règle 9)

Deux gestes indissociables :

1. un résolveur `civilite` unique — la signature vivante, 061 — consommé par les gabarits
   via `{{patient.civilite}}`, ce qui met fin au littéral `Mr/Mme/Mlle` de 045 ;
2. la donnée qui permet « Mlle » : situation familiale sur `app.patients`.

Migration neuve `0NN_`, jamais d'édition de 045 (règle 9).

---

## 9. Vérification

| Niveau | Commande |
|---|---|
| Types | `pnpm typecheck` (deux passes) |
| Lint | `pnpm lint` |
| Unitaires | `pnpm test` |
| Base | `node scripts/verifier-base.mjs` |
| E2E | `pnpm exec playwright test` (serveur déjà debout, `reuseExistingServer`) |
| Alexa | `bash scripts/checkpoint-jarvis-couche.sh` |
| Perf | `next build && next start`, jamais `next dev` (`06-PERF-BUDGET.md` §1) |

Parcours Playwright à faire passer : connexion praticienne, dossier, consultation, onglets
sans quitter l'écran, clic sur une date passée, lecture de la note et de l'analyse, retour
au travail en cours **sans perte de saisie**, traitement, documents, Alexa contextuelle,
enregistrement, rechargement, persistance vérifiée.

---

## 10. Risques

| Risque | Parade |
|---|---|
| Découper 1498 lignes casse la séance | Extraire sans réécrire la logique ; `consultation-sans-notes.spec.ts` et `critical-chain.spec.ts` restent la garde |
| Les onglets font exploser le budget d'appels | Lecture paresseuse par onglet, mesurée en build |
| Réemployer les panneaux Patient les couple à deux écrans | Ils prennent déjà `patientId` en entrée ; aucun état global ajouté |
| Perte de contexte au clic sur une date passée | Panneau de détail superposé ; la séance n'est jamais démontée |
