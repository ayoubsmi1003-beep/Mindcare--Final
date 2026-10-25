# Audit visuel et clinique — écran Consultation

**Date :** 2026-10-25
**Périmètre :** `/consultation/[id]`, composants `src/components/consultation/**`, i18n du cockpit, tests unitaires associés.
**Méthode :** inspection du code, build de production isolé, captures réelles avant/après, vérification Playwright des flux protégés.

---

## 1. Environnement de preuve

- **Base :** cluster PostgreSQL 16 **jetable** sur `127.0.0.1:55442`, construit depuis
  `supabase/bootstrap/000_platform_compat.sql`, les bootstraps 005/005b/010 et les
  162 migrations du dépôt. Aucune écriture sur la base du cabinet.
- **Patiente de capture :** `Nadia Belkacem` (`a1000000-…-1016`), ligne
  `is_synthetic = true` posée par la migration 091. Aucune donnée patient réelle
  n'a été ouverte, lue ou capturée.
- **Avant :** build de production déjà en écoute sur `127.0.0.1:3100`.
- **Après :** build de production isolé (`MINDCARE_LIVE_CHECK=1` → `.next-live-check`)
  sur `127.0.0.1:3102`. Le `.next` du poste et le serveur `3001` n'ont pas été
  touchés.
- **Viewports :** 1920×1080, 1440×900, 1366×768, 1024×768.
- **Captures :**
  - `checkpoints/consultation-audit-2026-10-25/avant/`
  - `checkpoints/consultation-audit-2026-10-25/apres/final-prod/`
  - `checkpoints/consultation-audit-2026-10-25/apres/prod-workflow/`
  - `checkpoints/consultation-audit-2026-10-25/apres/cloture-prod/`

> La base de développement du cabinet `3001` contenait une **séance ouverte pour
> une patiente réelle**. Elle n'a pas été ouverte. Les captures ont été prises
> sur la base jetable, avec une patiente explicitement synthétique.

---

## 2. Verdict

La cause du problème « les échelles sont absentes » n'était **pas** un défaut
CSS : le référentiel était délibérément vide et inactif, et **aucune porte
d'écriture** n'existait. Le reste de l'écran souffrait de défauts vérifiés de
hiérarchie, de largeur, de doublons et d'accessibilité.

**14 défauts vérifiés dans le périmètre : 14 corrigés.** La saisie PHQ-9 et
GAD-7 est livrée avec les versions françaises standard, un calcul **en base**,
des portes auditées et une feuille de saisie testée. HDRS et YMRS restent
inactifs (instruments cotés par le clinicien, revue dédiée à faire). S'y
ajoutent 5 défauts pré-existants hors périmètre (T1-T5), documentés mais non
corrigés.

---

## 3. Cause racine des échelles — critique

`supabase/migrations/015_seed_data.sql` (lignes 16-19 et 80-85) :

> « LES ÉCHELLES sont semées SANS barème et `is_active = false` […] inventer
> leurs seuils serait une faute clinique ; `items`/`scoring` restent vides
> jusqu'à saisie. »

Vérifications complémentaires :

- `supabase/bootstrap/005_scales_fixed_ids.sql` : les quatre échelles
  (PHQ-9, GAD-7, HDRS, YMRS) sont insérées avec `'{}'::jsonb` et
  `is_active = false`.
- Aucune fonction `app.*scale*` n'existe dans `supabase/migrations` ni dans
  `supabase/bootstrap`.
- Aucun service de `src/services/*` n'écrit dans `app.scale_administrations`.
- `get_patient_workspace` (076/078) ne rend que les **deux dernières**
  administrations par échelle ; le référentiel n'est jamais lu par l'UI.
- L'ancien `EtatClinique` était donc un affichage **en lecture seule** : aucun
  bouton ne permettait de compléter une échelle, et le bouton « Inscrire »
  recopiait un score **sans sa date**.

**Ce qui a été livré pour fermer C1 :**

- `184_scale_administration.sql` : quatre portes (`list_scales`,
  `preview_scale_score`, `record_scale_administration`,
  `get_scale_history`), calcul `app.score_scale` **en base**, `FOR UPDATE`,
  périmètre par `app.get_patient`, audit, retrait du `SELECT` direct accordé à
  `authenticated` sur `scale_administrations` (défaut trouvé par le checkpoint).
- `185_seed_phq9_gad7.sql` : contenu français standard du PHQ-9 et du GAD-7,
  bandes d'origine, item 9 marqué `risque` avec alerte factuelle. Aucun seuil
  n'a été inventé. HDRS/YMRS restent inactifs.
- `src/services/scales.ts` : lecture, aperçu, enregistrement, historique ;
  aucun calcul en JavaScript.
- `FeuilleEchelle.tsx` : feuille de saisie native, progression, validation,
  revue, alerte item 9, erreur conservant les réponses.
- `scripts/checkpoint-scales.sql` : **12 vérifications vertes** (référentiel,
  scores 0/27, GAD 21, réponses invalides, HDRS inactif, écriture, historique,
  séance close, hors périmètre, assistante, lecture directe refusée).
- Playwright : **8/8** (PHQ-9 17, GAD-7 0, validation, enregistrement,
  rechargement, inscription datée, alerte item 9).
- Migration appliquée à la base de développement `mc-p3` (PostgreSQL 16,
  conteneur local) ; vérification réelle : `list_scales` = 2, PHQ-9 27 =
  « sévère », `authenticated` ne peut ni lire ni insérer directement la table.

Le processus `3001` qui servait l'ancien build n'a **pas** été redémarré : une
séance réelle y était ouverte. La base est prête, le nouveau build est vérifié
sur `3103`, le redémarrage se fait à un moment sûr.

---

## 4. Défauts vérifiés

| ID | Sévérité | Emplacement | Preuve | Cause | Correction | État |
|---|---|---|---|---|---|---|
| C1 | **Critique** | Section Échelles | 015:16-19 ; 005 ; aucune porte ; `workspace` ne rendait que 2 résultats | Référentiel vide/inactif, aucune écriture | Contenu standard PHQ-9/GAD-7, portes 184, calcul en base, feuille de saisie, audit, `REVOKE` direct | **Corrigé** — 12/12 SQL, 8/8 UI |
| H1 | Haute | Grille du cockpit | `grid-cols-cockpit-consultation` = 15rem / 1fr / 21rem ; colonne de travail ≈ 500-577 px à 1366/1440 | Colonne patient de 240 px + rail 336 px | Deux colonnes `espace-travail`, `max-w-clinique` (960 px), bandeau patient compact | Corrigé |
| H2 | Haute | Ordre vertical | `État clinique` + `Repères` avant la note ; premier champ ≈ y 630 à 1440, hors écran à 1366 | Le contexte précédait le travail | Note en premier ; `BandeauPatient` compact ; contexte dans le rail | Corrigé |
| H3 | Haute | Barre + topbar | Deux boutons verts « Appeler la secrétaire » | Composant monté deux fois | Retiré de `BarreConsultation`, conservé dans la topbar | Corrigé |
| H4 | Haute | `MesuresSeance` / `SelecteurEchelle` | « Anxiété / Sommeil / Humeur » à côté d'« Échelles » ; `+` depuis « non mesuré » donnait 6 ; curseur à 5 sans valeur | Vocabulaire et composant confondus | Renommé « Repères de séance (1–10, non validés) » ; groupe radio natif ; aucun pouce implicite | Corrigé |
| H5 | Haute | `Inscrire` | `phraseEchelle` = `PHQ-9 : 12 (…)` sans date | Score historique recopié comme mesure du jour | `phraseEchelleDatee` + test unitaire ; date affichée et recopiée | Corrigé |
| H6 | Haute | Rail / « Depuis la dernière » | « Séance précédente 25/10/2026 » (séance en cours) ; « aucun nouvel élément depuis 25/10 » | `derniereConsultation` inclut la séance ouverte | Rail « Séances précédentes » (liste des closes) ; mini-chronologie retirée ; bloc « Depuis » retiré du rail | Corrigé |
| H7 | Haute | Barre de séance | Puces 3/4 SOAP, signature dans la note, clôture dans la barre | Trois grammaires de progression/action | `Note n/4`, `Échelles n`, `Signature`, un seul geste primaire | Corrigé |
| H8 | Haute | i18n + a11y | `EtatClinique` “Échelles du dossier — …” en dur ; `Bouton aria-label` ignoré (API = `etiquette`) | Chaînes hors i18n ; prop non transmise | Textes i18n ; `etiquette` sur les boutons concernés | Corrigé |
| M1 | Moyenne | Onglets SOAP | `role=tab` sans `aria-controls`, sans roving tabindex, sans flèches | Tablist incomplet | `id`/`aria-controls`/`tabIndex`/flèches/Home/End | Corrigé |
| M2 | Moyenne | Colonne patient / rail | `RaccourcisDossier` + onglets + rail = 3 chemins ; `DepuisDerniere` empilait 3 blocs ; mini-chronologie | Doublons d'information | Raccourcis supprimés ; rail réduit aux points à vérifier ; mini-chronologie retirée | Corrigé |
| M3 | Moyenne | `TarifInline` | « 5 000 DZD DA » | `formaterDzd` inclut déjà DZD, suffixe DA ajouté | Affichage unique | Corrigé |
| M4 | Moyenne | Séance close | « CORRECTION POSSIBLE ENCORE 14:59 » alors que les champs sont désactivés ; pastille d'action vide | Le bandeau de verrou ignore `seanceClose` | Message « Séance terminée — note en lecture seule » ; actions masquées | Corrigé |
| M5 | Basse | `NotesStructurees` | Champ « Mes formules » toujours visible | Densité | Replié dans `<details>` | Corrigé |

### Défauts pré-existants, non corrigés (hors périmètre)

- **T1 — e2e consultation obsolète.** `tests/e2e/consultation-cockpit.spec.ts`
  remplit `/E-mail/i` alors que le libellé est « Nom d’utilisateur », utilise un
  mot de passe de dev codé en dur, et K2 capture un dossier choisi sans filtre
  `is_synthetic`. La suite n'a pas été exécutée ; la vérification ciblée a été
  faite par script Playwright dédié.
- **T2 — 5 tests Alexa en échec** (`alexa-agent-budget`,
  `alexa-first-appointment`, `alexa-read-argument-binding`,
  `alexa-request-domain`). Ces fichiers sont modifiés dans l'arbre de travail
  par le chantier Alexa en cours ; ils ne touchent pas la consultation.
- **T3 — `Bouton` n'expose pas `aria-label`.** L'API est `etiquette` ; les
  usages fautifs de la consultation ont été corrigés, mais le composant reste
  fermé. Une généralisation demanderait une décision de design system.
- **T4 — Lecteur d'écran réel non testé** (NVDA/VoiceOver). Les rôles et
  libellés sont posés et testés au clavier Playwright, pas validés à l'usage.
- **T5 — Clés mortes dans `fr.ts`.** `cockpit.mesuresAide` affirme encore que la
  valeur « s'inscrit dans Subjectif » (faux), et `derniereTitre`/`etatVide` ne
  sont plus lues. `fr.ts` est gelé (Phase 6) : non modifié ici, à supprimer à
  la découpe.

---

## 5. Avant / après

| Critère | Avant | Après |
|---|---|---|
| Colonne de travail à 1440 | ≈ 577 px | ≈ 810 px (max 960) |
| Colonne de travail à 1366 | ≈ 503 px | ≈ 737 px |
| Premier champ éditable à 1440 | sous le pli | visible, y ≈ 616 |
| Boutons verts concurrents | 2 × « Appeler la secrétaire » + actions | 1 appel (topbar) + 1 primaire de séance |
| Progression | 3 puces sur 4 SOAP, 1/3 faux | Note 2/4, Échelles 2, Signature |
| Échelles | carte en lecture seule, score sans date | section datée + `Compléter PHQ-9 / GAD-7`, feuille de saisie, score calculé en base, « Inscrire » daté, historique et marqueur de séance |
| Repères 1–10 | confondus avec les échelles, `+` = 6 depuis vide | « non validés », radios 1–10, aucun état implicite |
| Contexte | colonne patient + raccourcis + mini-chronologie | bandeau compact + rail « Séances précédentes » |
| Séance close | « correction possible » + action vide | « lecture seule » + actions masquées |
| i18n | 3 chaînes en dur | 0 dans les fichiers touchés |
| Accessibilité tabs | role=tab sans contrôle clavier | flèches, Home/End, `aria-controls`, focus |

Les captures `avant/` et `apres/final-prod/` aux quatre largeurs permettent de
vérifier ces points à l'œil, pas seulement dans le code.

---

## 6. Vérification exécutée

| Commande | Résultat |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` (application) | **PASS** |
| `tsc -p tsconfig.test.json` | **FAIL** sur `tests/unit/alexa-agent-loop.test.ts:147` — fichier Alexa modifié dans l'arbre, hors périmètre. Le typecheck applicatif est vert. |
| `pnpm exec eslint src/app/consultation/[id]/page.tsx src/components/consultation/cockpit src/i18n/consultation-cockpit.ts tests/unit/modele-cockpit.test.ts` | **PASS** |
| `pnpm exec vitest run tests/unit/modele-cockpit.test.ts tests/unit/consultation-mesures-notes.test.ts tests/unit/consultation-reperes.test.ts` | **PASS** — 20/20 |
| `MINDCARE_LIVE_CHECK=1 node node_modules/next/dist/bin/next build` | **PASS** (build isolé `.next-live-check`) |
| Playwright ciblé (login API, 3102, base jetable) | **PASS 9/9** : note au-dessus du pli, raccourci Échelles, `Inscrire` daté, autosave + reload, repère Humeur 6 + reload, flèches d'onglets, signature, clôture, `Enregistrer` désactivé |
| `scripts/checkpoint-scales.sql` (base jetable) | **PASS 12/12** : référentiel, 0/27, GAD 21, réponses invalides, HDRS inactif, écriture, historique, séance close, hors périmètre, assistante, lecture directe refusée |
| Playwright échelles (3102, base jetable) | **PASS 8/8** : PHQ-9 17 + alerte item 9, GAD-7 0, validation, enregistrement, rechargement, inscription datée, alerte dans Évaluation |
| Migration réelle `mc-p3` + RPC réelles (3103) | **PASS** : 184/185 enregistrées, `list_scales` = 2 (GAD7/PHQ9), PHQ-9 27 = « sévère », `authenticated` sans SELECT/INSERT direct sur `scale_administrations` |
| `pnpm test` (suite complète) | **4203 PASS / 10 FAIL** avant mise à jour du test de composition. Après mise à jour : le test `consultation-reperes` passe ; **5 FAIL restent, tous Alexa**, pré-existants et hors périmètre. |
| E2E `tests/e2e/consultation-*` | **NOT RUN** — helper de connexion obsolète, fixtures non isolées, K2 non filtré `is_synthetic`. |

### Ce qui n'a pas été exercé

- `analyserSeance` : le bouton et le disclaimer sont en place, mais la base
  jetable n'a pas de fournisseur de modèle. **NOT RUN** (échec attendu et
  honnête, pas une régression).
- Lecteur d'écran réel, zoom 200 %, contraste mesuré au colorimètre.
- La séance réelle ouverte sur `3001` n'a pas été ouverte. La base réelle a
  reçu 184/185 et les RPC ont été vérifiées en lecture sur `3103` ; le processus
  `3001` n'a pas été redémarré pour ne pas interrompre la séance en cours.
- Les états visuels « référentiel vide » et « référentiel en erreur » sont
  codés (`BlocErreur` / message d'activation) mais n'ont pas été capturés :
  la base de preuve a deux échelles actives et la lecture a réussi.

---

## 7. Échelles — ce qui est livré, ce qui reste

**Livré et testé :** PHQ-9 et GAD-7, versions françaises standard, contenu
exact dans `185_seed_phq9_gad7.sql` et
`docs/contracts/scales.md` ; calcul SQL ; portes 184 ; feuille de saisie ;
revue ; alerte item 9 ; historique ; séance close ; cloison ; audit ;
`REVOKE` direct. 12/12 SQL et 8/8 UI.

**Reste explicitement hors de cette version :**

1. **HDRS et YMRS** — instruments cotés par le clinicien, avec des items et
   des pondérations (0–2 / 0–4) qui demandent une revue dédiée. Ils restent
   `is_active = false` ; le moteur les acceptera quand leur contenu sera validé.
2. **Validation clinique formelle** — les versions françaises semées sont les
   versions publiées citées, pas une traduction improvisée. La praticienne doit
   confirmer qu'elles correspondent à son usage ; toute modification de wording
   ou de seuil passera par une nouvelle migration, pas par l'écran.
3. **États visuels non capturés** — référentiel vide et référentiel en erreur
   (chemins codés, non photographiés).
4. **Lecteur d'écran réel** — NVDA/VoiceOver non exécuté.

---

## 8. Fichiers touchés par l'audit

- `src/app/consultation/[id]/page.tsx`
- `src/components/consultation/cockpit/{BarreConsultation,BandeauPatient,SectionEchelles,FeuilleEchelle,SelecteurNote,MesuresSeance,NotesStructurees,RailContexte,DepuisDerniere,CourbeEchelles,TarifInline,modele-cockpit}.tsx|ts`
- `src/services/scales.ts`
- `src/i18n/consultation-cockpit.ts`
- `src/server/db/allowlist.generated.ts` (régénérée : 4 RPC)
- `src/components/patients/PanneauTraitements.tsx` (un `etiquette`)
- `tailwind.config.ts` (`maxWidth.clinique`)
- `supabase/migrations/184_scale_administration.sql`
- `supabase/migrations/185_seed_phq9_gad7.sql`
- `scripts/checkpoint-scales.sql`
- `docs/contracts/scales.md`
- `tests/unit/{modele-cockpit,consultation-reperes}.test.ts`
- `checkpoints/consultation-audit-2026-10-25/**`
- Ce document et `docs/consultation-redesign-report.md`
