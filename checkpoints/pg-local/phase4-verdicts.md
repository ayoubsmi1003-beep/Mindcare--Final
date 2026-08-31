# Phase 4 — la frontière HTTP et le durcissement de la surface

Base : PostgreSQL 17 (`mc-p3`, 127.0.0.1:55441), reconstruite depuis zéro en
phase 3. Serveur : `next start` sur 127.0.0.1:3210, build de production.

## Verdicts

| # | Propriété | Moyen | Verdict |
|---|---|---|---|
| 1 | `src/services/**` inchangé hors `db/` | git diff | ✅ (voir réserve) |
| 2 | Allowlist ENGENDRÉE : 60 fonctions, 3 relations | AST walk | ✅ |
| 3 | Un `db().rpc()` à nom non littéral fait ÉCHOUER le générateur | par construction | ✅ |
| 4 | Allowlist cohérente avec `pg_proc` (contrôle de démarrage) | test intégration | ✅ |
| 5 | Le contrôle de démarrage MORD sur une fonction absente | mutation en test | ✅ |
| 6 | Fonction hors allowlist → 404, indistinguable d'une inexistante | HTTP | ✅ |
| 7 | `app.patients` non lisible en direct, même connectée | HTTP | ✅ |
| 8 | Colonnes de `filters`/`order` bornées comme `columns` | test | ✅ |
| 9 | Clé d'argument malformée → 400 ; `limit` hors borne → 400 | HTTP | ✅ |
| 10 | Injection dans un identifiant : table intacte | test sur base | ✅ |
| 11 | Sans session : `/api/db/*` → 401 | HTTP | ✅ |
| 12 | Cookie `HttpOnly` + `SameSite=Lax`, jeton absent du corps | HTTP | ✅ |
| 13 | Cookie INVISIBLE à `document.cookie` | navigateur | ✅ |
| 14 | Jeton révoqué REJOUÉ → 401 | HTTP | ✅ |
| 15 | Arguments non conformes → 422, pas 500 | HTTP | ✅ |
| 16 | **Cloison ADR-003 : Dr B ne voit pas la patiente de Dr A** | HTTP, 2 comptes | ✅ |
| 17 | **Audit des lectures : 10 traces, acteur exact, 0 orpheline** | SQL | ✅ |
| 18 | 7 écrans du §37 parcourus dans Chromium | navigateur | ✅ 31/31 |
| 19 | Sans cookie, aucune donnée patient à l'écran | navigateur | ✅ |
| 20 | `grep SUPABASE .next/static/` | build | ✅ **0** |
| 21 | 106 tests · typecheck · lint · preflight · build | outillage | ✅ |

## Les deux invariants qui comptent, mesurés et non déduits

**La cloison tient à travers la nouvelle pile.** Deux praticiennes réelles, deux
sessions HTTP distinctes, une patiente appartenant à la première :

```
f1 (propriétaire) -> {"ok":true,"data":[{... "record_number":"TEST-CLOISON-1" ...}]}
f2 (autre)        -> {"ok":true,"data":[]}
```

f2 est authentifiée et légitime. La RLS décide, exactement comme avant : ni
l'allowlist, ni la route, ni `withCaller` ne prennent cette décision.

**L'audit attribue correctement, malgré le pool.** C'était le risque propre à
cette architecture — une trace écrite sous l'identité de la requête précédente :

```
drb@invalid.local        ->  1 lecture
http.test@invalid.local  ->  7 lectures
owner.dev@invalid.local  ->  2 lectures
traces select sans acteur : 0
```

## Ce qui a été trouvé en cours de route

1. **`classify()` ne comprend pas les `AppErrorCode`.** Faire passer « interdit »
   par le classificateur de SQLSTATE rendait « inattendu » : l'écran aurait
   affiché « erreur inattendue » là où il fallait lire « vous n'avez pas accès ».
   Corrigé dans `http.ts`, qui construit l'`AppError` directement.
2. **Un appel d'arité incorrecte rendait 500.** SQLSTATE 42883 tombait dans
   `inattendu`. L'allowlist borne les NOMS, pas les signatures : c'est une erreur
   de requête. Rendu en 422.
3. **Le premier checkpoint HTTP était faux**, pas le code : il appelait
   `dashboard_today` sans son `p_day` obligatoire.
4. **Un serveur périmé a fait échouer un contrôle correct** — `next start` avait
   démarré avant la fin du build. Le correctif était présent dans `.next` mais
   pas dans le processus. Vérifié par `grep 42883 .next/server/`.
5. **Deux ROUGES de preflight, tous deux les miens** : un octet NUL dans le
   fichier de preuves de la phase 3 (dans la phrase qui DÉCRIT le bug NUL), et
   « inattendu » écrit comme code dans `http.ts`, interdit par le contrôle V1.1.

## Réserve sur le critère 1

Le critère du plan est `git diff --stat src/services/ | grep -v db/` vide. Il
rend une ligne : `src/services/finance.ts`. Cette modification est ANTÉRIEURE à
la migration — c'est le travail V8 déjà présent au premier `git status` de la
session (séparateur de milliers U+202F → U+00A0, sans glyphe dans Plus Jakarta
Sans). Elle n'a pas été touchée, et ne doit pas l'être.

Le critère est donc tenu au sens où il compte : **la phase 4 n'a modifié que
`src/services/db/`** (`index.ts` bascule le port, `http.ts` est nouveau).

## Ce qui est HORS SERVICE à la fin de cette phase, délibérément

**Jarvis, la dictée et la voix.** `httpDbPort.invokeFunction` vise
`/api/jarvis/<nom>`, qui n'existe pas encore : les cinq fonctions Deno sont
portées en phase 5. L'alternative — garder le client Supabase pour ce seul
chemin — aurait laissé la clé `anon` dans le paquet navigateur, c'est-à-dire
exactement ce que cette phase doit supprimer.

⚠️ Nuance à ne pas confondre avec un succès : l'écran `/jarvis` CHARGE sans
erreur, parce qu'il n'appelle la passerelle qu'à l'interaction. Son verdict vert
ci-dessus signifie « la page se rend », pas « Jarvis fonctionne ».

## Non prouvé à ce stade

* Les écrans de détail (`/patients/[id]`, `/consultation/[id]`, `/agenda/[id]`)
  ne sont pas parcourus : la base ne contient pas de dossier assez complet.
* Aucune écriture clinique réelle (création de consultation, signature de note,
  émission de document) n'a été exercée par la frontière — seulement des
  lectures et l'authentification.
* Le rôle `assistant` n'a pas été éprouvé de bout en bout.
