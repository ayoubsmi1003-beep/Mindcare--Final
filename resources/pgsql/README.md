# `resources/pgsql/` — binaires PostgreSQL 16 empaquetés

Ce dossier est **vide dans le dépôt** et **peuplé avant l'empaquetage**.

## Pourquoi vide ici

Les binaires EDB font ~200 Mio. Un dépôt git n'est pas un miroir de
distribution : versionner ces fichiers alourdirait chaque `clone` de l'équipe
pour un contenu qui n'est ni relu, ni modifié, ni fusionné, et dont
l'authenticité se vérifie chez l'éditeur, pas dans notre historique.

## Pourquoi le dossier existe quand même

`electron-builder.yml` déclare `extraResources: resources/pgsql → pgsql`.
Une entrée `from` qui pointe un dossier absent fait échouer l'empaquetage. Ce
README garde donc le dossier présent, et `scripts/verifier-paquet.mjs` refuse
un artefact où il ne resterait *que* ce README — c'est-à-dire un installateur
qui s'installerait sans jamais pouvoir démarrer sa base.

## Comment le peupler

1. Télécharger **PostgreSQL 16 pour Windows x86-64, format ZIP** (« binaries
   only ») depuis <https://www.enterprisedb.com/download-postgresql-binaries>.
   La version majeure **16** n'est pas négociable : `pg-cluster.ts` refuse de
   démarrer un cluster dont le `PG_VERSION` ne correspond pas au paquet, et
   une base créée par une autre majeure ne se lit pas sans `pg_upgrade`.
2. Dézipper, puis copier le **contenu** du dossier `pgsql/` de l'archive ici,
   de sorte que `resources/pgsql/bin/initdb.exe` existe — c'est exactement le
   chemin que `electron/main/pg-binaires.ts` construit.
3. Élaguer : `pnpm pgsql:elaguer` (ou automatiquement via `pnpm build:desktop`).
   Voir « Élagage » ci-dessous — ne pas passer cette étape.

Arbre attendu **après téléchargement, avant élagage** :

```
resources/pgsql/
  bin/initdb.exe  bin/pg_ctl.exe  bin/psql.exe  bin/postgres.exe
  lib/  share/  doc/  include/  StackBuilder/
```

## Élagage

Le zip EDB est la distribution COMPLÈTE : documentation HTML, en-têtes C
pour compiler des extensions, l'installateur graphique StackBuilder, les
outils de test internes de PostgreSQL — ~200 Mio dont MindCare n'exécute
qu'une fraction. Rien de tout ça ne doit atteindre le poste du cabinet :
`scripts/verifier-paquet.mjs` a d'ailleurs refusé un artefact contenant
`doc/postgresql/html/libpq-connect.html`, qui documente `postgresql://` avec
un exemple de mot de passe — indiscernable d'une vraie fuite pour un
contrôle qui ne doit JAMAIS apprendre à ignorer ce motif.

`pnpm pgsql:elaguer` (`scripts/elaguer-pgsql.mjs`) réduit `resources/pgsql/`
au runtime strict : les six exécutables que le code appelle réellement
(`initdb`, `pg_ctl`, `psql`, `postgres`, `pg_dump`, `pg_restore` — jamais
StackBuilder, `pgbench`, `pg_regress`…), les DLL qu'ils importent VRAIMENT
(lues dans leur table d'imports PE, résolues récursivement — jamais devinées
à l'œil), et les seules extensions que les migrations créent (`pgcrypto`,
`uuid-ossp`, `pg_trgm`, `unaccent`, `vector` (M07, § pgvector ci-dessous),
plus `plpgsql` et `dict_snowball` que
`initdb` charge lui-même, inconditionnellement). Le résultat est vérifié par
un VRAI cluster — `initdb`, démarrage, les cinq extensions, un appel réel
à `unaccent()`, `pg_dump` puis `pg_restore` — avant d'être accepté ; en cas
d'échec, rien n'est perdu : le script restaure ce qu'il avait mis de côté.

Environ 160 Mio → ~55 Mio. Ne JAMAIS repeupler ce dossier sans relancer
l'élagage avant `pnpm build:desktop`.

## pgvector (M07 — RAG gouvernée)

La migration `092_knowledge_rag.sql` exige `CREATE EXTENSION vector`.
Le zip EDB ne la fournit pas : l'artefact est donc ajouté ici **avant**
l'élagage, qui le conserve automatiquement (découverte par grep des
`CREATE EXTENSION`, fermeture PE, preuve par cluster réel incluant
`CREATE EXTENSION vector`).

Artefact épinglé (prouvé contre EDB 16.15 le 2026-09-15, Gate B Phase 1) :

- version : **0.8.6** (`share/extension/vector.control`, `default_version`)
- `lib/vector.dll` — SHA-256 :
  `57984F7662DFC1AF443884D4F9D79ED4D50D16C8143C817B1E96BCB6DCCA43EB`
- `share/extension/vector.control` + `vector--0.8.6.sql` + chaîne complète
  de montée en version `vector--0.1.0--…--0.8.6.sql`
- `scripts/verifier-paquet.mjs` §4 refuse tout paquet dont la DLL, le
  `.control`, le script de base ou la parité des scripts diffèrent.

Toute reconstruction volontaire de cet artefact met à jour ce pin —
et prouve le nouvel artefact avant (mission M07).
