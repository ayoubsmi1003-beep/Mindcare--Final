# Corrections sources — 14 novembre 2026

Périmètre : checkout `alexa-v8-final`. Le HEAD observé à la préparation était `905040e` ;
le parent effectif des trois commits de livraison est `46a9d91e`. Les autres commits Alexa
présents dans cet intervalle sont conservés et ne font pas partie de cette mission. Aucun build, paquet,
déploiement ni modification de l’installation ou de la base du cabinet.

## Changements et preuves

| Exigence | Correction livrée | Vérification |
|---|---|---|
| Identité | Lecture distincte d’une absence/panne, transfert administratif complet et conservateur ; référence professionnelle publique explicitement approuvée centralisée | Tests de frontière et vraie porte SQL sur base jetable ; conflits et permissions vérifiés |
| Pied de page | Adresse sur deux lignes, deux libellés sociaux configurés, SVG fournis, bande basse réservée | Géométrie navigateur une/cinq pages et PDF synthétique |
| En-tête et filigrane | Rendu A5 v2, identité FR/AR, numéro professionnel distinct du numéro documentaire, assets locaux | Émission SQL v2, snapshot immuable, régressions v1 et aperçu avec l’identité approuvée |
| Traitements | Deux champs simples, horaires certains seulement, conservation des instructions particulières et confirmation explicite, initialisation unique du brouillon | Tests du dossier partagé UI/Alexa ; navigateur sur les deux sélecteurs |
| Édition | Classe inline distincte des champs de formulaire ; collage contrôlé, variables et formats conservés | Tiptap réel : paragraphe continu, champs, collage, annuler/rétablir |
| Catalogue | 15 661 lignes source, 15 645 désignations canoniques, migration préservatrice, pagination existante corrigée | Vraie recherche PostgreSQL : deuxième page, variantes, accents/casse, épuisement ; navigateur : réponses désordonnées et panne |
| Diagnostics | Un sélecteur explicite, métadonnées dérivées, date inconnue à null, rôle existant conservé et historique intact | Tests unitaires, portes SQL et navigateur : clavier, annulation, changement de patient et erreur |

## Commandes exécutées

- `pnpm exec vitest run tests/unit/document- tests/unit/diagnostic-selection.test.ts tests/unit/diagnoses-gates.test.ts tests/unit/medications-search-page.test.ts tests/unit/cabinet-identity-read.test.ts tests/unit/catalogue-reference.test.ts tests/unit/alexa-document-draft.test.ts --maxWorkers=1 --no-file-parallelism` : **PASS, 99 tests / 16 fichiers**.
- `node scripts/checkpoint-sourcefix.mjs` : **PASS**, PostgreSQL 16 neuf avec pgvector, 202 migrations et contrôles documents v1/v2, catalogue, identité, diagnostics. Conteneur sans montage du cabinet, fixtures annulées, conteneur et volume supprimés.
- `node tests/visual/check-document-renderer.mjs` : **PASS**, composants réels, aperçu SQL synthétique, édition et pagination/PDF.
- `node tests/visual/check-document-renderer.mjs .cache/document-reference-preview.json --reference` : **PASS**, aperçu de l’identité professionnelle approuvée avec champs patient non renseignés ; aucun accès à un dossier réel.
- `node tests/visual/check-diagnosis.mjs` : **PASS**, composant et adaptateur réels, réponses RPC simulées ; la preuve SQL est séparée.
- `node tests/visual/check-medications.mjs` : **PASS**, deux sélecteurs réels, RPC simulées, 52 résultats paginés, réponses désordonnées et panne.
- `pnpm exec tsc --noEmit --incremental false` et `pnpm exec tsc -p tsconfig.test.json --noEmit --incremental false` : **PASS**, contrôle sans émission.
- **PASS** : ESLint sur tous les fichiers TypeScript/TSX/MJS modifiés ou ajoutés ; `git diff --check`.
- Comparaison raster des SVG recadrés avec les originaux : transparence et apparence conservées. Le canevas original est conservé dans un SVG externe recadré pour éviter le rognage des masques.

## Limites et suite

Les essais navigateur avec RPC simulées ne prouvent pas le fonctionnement du futur paquet.
La police exacte de la référence n’est pas identifiée ; Arial et Traditional Arabic locaux
ont été retenus, avec fontes arabes embarquées de secours. Aucune qualification sur imprimante physique.

Le moteur lit toujours l’identité configurée en base et la fige à l’émission. Aucun repli
ne masque une identité incomplète. La préparation/importation administrative de l’identité
approuvée sur la future cible reste une opération ultérieure, décrite dans
`docs/contracts/document-identity-transfer.md` ; elle n’a pas été exécutée sur le cabinet.
Les migrations 222–225 n’ont été appliquées qu’à des bases de test jetables. Les valeurs
existantes contradictoires sont refusées, jamais remplacées silencieusement.

**NOT RUN** : build, empaquetage, futur paquet, installation réelle, transfert sur le cabinet,
suite complète non ciblée et essais matériels. Les sorties visuelles et PDF restent dans
`.cache`, hors Git. Aucun document historique émis ni asset v1 modifié.
