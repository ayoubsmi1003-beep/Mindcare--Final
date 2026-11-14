# Conservation de la version documentaire finale dans le futur paquet

Sources de référence : `C:\MindCare\alexa-v8-final`, branche `v8-alexa-final`.
Les corrections fonctionnelles sont enregistrées dans `7c674594`, `d56d9633`
et `4d984730`. Le présent complément sécurise leur livraison ; il ne construit
aucun paquet et ne configure aucune installation.

## Contrôles exécutés automatiquement lors du futur build

- Le préparateur existant reconstruit Next depuis les sources courantes ; la
  provenance lie le résultat au commit et aux empreintes des sources, dont les
  formulaires, l'éditeur, le catalogue, les diagnostics et l'identité approuvée.
- `stageDocumentAssets` conserve aussi dans le serveur livré la référence
  professionnelle publique `resources/documents/cabinet-letterhead.json`.
- Le préparateur puis le vérificateur du paquet comparent les octets des
  ressources livrées aux sources : rendus v1 et v2, CSS, fontes, trois SVG,
  référence d'identité et migrations 222–225. Fichier manquant ou différent :
  refus, sans accepter silencieusement une ancienne version.
- Le dossier serveur complet est livré par `electron-builder.yml`. Les
  ressources ne dépendent ni de Downloads ni d'un chemin du poste de développement.

## Conditions de livraison ultérieure

1. Construire depuis ce checkout et les commits courants, avec le parcours
   `build:desktop` existant, après autorisation de cette étape. Ne pas réutiliser
   un ancien installeur au seul motif que son nom porte la même version.
2. Vérifier le paquet réellement produit et décompressé. Les tests synthétiques
   du contrôle d'intégrité ne constituent pas cette vérification.
3. Préparer la base cible par la procédure contrôlée : schéma compatible et
   identité de la praticienne complète, avec les deux libellés sociaux. Le
   fichier de référence livré n'est pas un remplacement automatique de la base.
   Utiliser `document-identity-transfer.md` avec les UUID explicitement vérifiés ;
   un conflit est refusé. Ne jamais restaurer une base sur un cabinet existant.
4. Vérifier après décompression et relancement : identité exacte, remplissage
   du patient sélectionné, ordonnance, édition, catalogue paginé, diagnostic,
   impression/PDF court et multipage. Les essais synthétiques restent isolés.
5. Conserver les assets des versions déjà émises. Une évolution graphique future
   utilise une nouvelle version ; les documents historiques gardent leur snapshot.

## Preuves disponibles sans build

`pnpm exec vitest run tests/unit/document-package-assets.test.ts tests/unit/alexa-package-integrity.test.ts --maxWorkers=1 --no-file-parallelism`
: **PASS, 14 tests**, sur fichiers synthétiques temporaires, sans base ni application installée.
Le contrôle détecte notamment une fonte, un SVG, une migration ou la référence
d'identité manquants, ainsi qu'un CSS ancien. Le changement de la référence
d'identité invalide aussi l'empreinte de provenance.

**PASS** : lint ciblé, syntaxe des scripts par `node --check`, TypeScript des tests
sans émission. **NOT RUN** : build, préparation réelle du paquet, décompression,
transfert d'identité et validation de l'application empaquetée.
