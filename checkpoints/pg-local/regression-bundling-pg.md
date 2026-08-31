# Régression bloquante — `pg` empaqueté par webpack via `instrumentation.ts`

Trouvée pendant l'acceptation finale, en lançant `pnpm dev`. Corrigée.

## Les quatre symptômes, et leur hiérarchie réelle

| | Symptôme | Nature |
|---|---|---|
| **A** | `Module not found: Can't resolve 'fs'` | **CAUSE RACINE** |
| **B** | `Can't resolve 'pg-native'` (en boucle) | conséquence de A |
| **C** | `base-injoignable` au démarrage | **cause racine INDÉPENDANTE** |
| **D** | cache `.next` corrompu | **écarté — pas en cause** |

D a été écarté par la mesure : `.next` a été supprimé et l'échec s'est reproduit
à l'identique sur un cache neuf.

## A · la cause racine

```
○ Compiling /instrumentation ...
⨯ pg-connection-string/index.js:88  Module not found: Can't resolve 'fs'
   trace : pg/esm/index.mjs → src/server/db/pool.ts → withCaller.ts
           → demarrage.ts → src/instrumentation.ts
```

**Next compile `instrumentation.ts` dans une unité de compilation SÉPARÉE, qui
n'applique pas `serverExternalPackages`.** `pg` y était donc empaqueté par
webpack — or `pg` n'est pas empaquetable :

* `pg-connection-string` fait `require('fs')` **à l'intérieur d'une condition**
  (« only try to load fs if we expect to read from the disk »). Webpack ne peut
  pas prouver que la branche est morte : il tente de résoudre `fs`, et échoue ;
* `pg/lib/native/index.js` fait `require('pg-native')`, liaison native
  **optionnelle**, dans un `try/catch`. Absente par conception — d'où B.

L'échec d'UNE unité de compilation empoisonnait tout le serveur : `/patients`,
`/meta.json`, `/api/auth/session` et `/api/db/rpc` répondaient tous 500.

⚠️ **A et B ont une seule cause.** B n'est pas un avertissement séparé à faire
taire : il disparaît dès que `pg` cesse d'être empaqueté. C'est pourquoi
installer `pg-native` aurait été un contresens.

## C · cause indépendante

`MINDCARE_DATABASE_URL` était absente de `.env`. Toutes mes vérifications des
phases 2 à 7 l'avaient passée **en ligne de commande** ; aucune n'était jamais
partie de `.env`. La variable est ajoutée (fichier ignoré par git, vérifié).

## Le correctif

**1. `next.config.ts` — `serverExternalPackages: ["pg"]`.** `pg` est requis à
l'exécution par Node, jamais assemblé par webpack. Preuve : les 10 références à
`pg-connection-string` sous `.next/server/` sont toutes des `.nft.json`, les
manifestes de TRAÇAGE de fichiers — pas du code empaqueté.

**2. `src/instrumentation.ts` SUPPRIMÉ ; contrôle déplacé dans
`scripts/verifier-base.mjs`, en Node pur, lancé avant `next` par `dev` et
`start`.**

C'est le cœur du correctif, et il est meilleur que ce qu'il remplace : un
contrôle de démarrage n'a rien à faire dans un graphe compilé par un bundler.
L'ancienne version ne pouvait qu'AVERTIR — Next était déjà lancé. Celle-ci
s'exécute avant et **refuse de démarrer**, ce que le plan demandait
(« sinon refus de démarrer sur schéma partiellement migré »).

### Ce qui a été écarté, et pourquoi

* `resolve.fallback.fs = false` **mentirait** : il prétendrait que `fs` n'existe
  pas, alors que `pg` s'en sert légitimement pour lire un certificat TLS. On
  casserait TLS sans le savoir ;
* installer `pg-native` ajouterait une compilation native sur le poste du
  cabinet pour une fonctionnalité dont on ne veut pas ;
* supprimer le contrôle ferait disparaître le symptôme en perdant le garde-fou.

## Deux défauts trouvés en déplaçant le contrôle

1. **`.env` n'est pas lu par Node.** Sorti de Next, le contrôle refusait de
   démarrer en annonçant « MINDCARE_DATABASE_URL est absente » alors qu'elle y
   était : c'est NEXT qui lit `.env`. Le script charge donc `.env` lui-même,
   l'environnement réel gardant la priorité.
2. **`42501` — permission denied.** `mindcare_app` est NOINHERIT : hors
   `SET ROLE`, il n'a aucun privilège, pas même sur `app.schema_migrations`.
   C'est exactement la propriété qui transforme une enveloppe oubliée en panne
   plutôt qu'en fuite — elle s'applique donc aussi à ce contrôle. Le script
   endosse `anon`, comme le fait l'application.

## Ce qui N'A PAS été touché

`pool.ts`, `withCaller.ts`, `pgPort.ts`, `demarrage.ts` sont **inchangés**.
`src/server/demarrage.ts` reste utilisé par `preparer()` : le contrôle par
requête garde la frontière même si la base se dégrade PENDANT que
l'application tourne. Les deux contrôles couvrent des instants différents.

## Vérification — codes de sortie réels

| Contrôle | Code |
|---|---|
| `pnpm typecheck` | **0** |
| `pnpm lint` | **0** |
| `pnpm test` (106 tests) | **0** |
| `pnpm preflight` | **0** |
| `pnpm build` | **0** |
| `scripts/verifier-base.mjs` | **0** |
| `checkpoint-frontiere-http` | **0** — 24/24 |
| `checkpoint-jarvis-http` | **0** — 22/22 |
| `checkpoint-clinique-http` | **0** — 15/15 |
| `checkpoint-ecrans-p4` | **0** — 31/31 |
| `sauvegarde.mjs` (restauration rejouée) | **0** — 8 tables |

Depuis un `.next` supprimé : `fs` **0 occurrence**, `pg-native` **0**,
`[demarrage] base joignable, 70 migrations a jour`, `/patients` **200**,
`/api/auth/session` **200**, `/meta.json` **404**.

⚠️ `/meta.json` rend 404 et c'est correct : ce fichier n'a **jamais** existé
dans le dépôt et rien ne le référence (sonde de navigateur). Son 500 venait
uniquement de la compilation empoisonnée.

## Preuve : `pg` absent du paquet navigateur

```
pg-connection-string : 0     PoolClient    : 0     postgresql:// : 0
pg-native            : 0     mindcare_app  : 0     5432          : 0
URL de connexion (recherche en aveugle sur la valeur de .env) : absente
```
