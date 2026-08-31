# Phase 3 — authentification locale

Base d'épreuve : PostgreSQL 17, conteneur jetable `mc-p3`, 127.0.0.1:55441, ICU
`fr-DZ`. **Reconstruite DEPUIS ZÉRO** après les mutations, dans l'ordre exact de
l'installateur : `000_platform_compat` → 68 migrations (070 incluse) →
`010_app_role` → mot de passe applicatif.

## Verdicts

| # | Propriété | Moyen | Verdict |
|---|---|---|---|
| 1 | 070 s'applique sur base neuve ; ses 6 assertions passent | psql | ✅ |
| 2 | 070 est rejouable (idempotente) | psql ×5 | ✅ |
| 3 | Mot de passe correct → identité | test | ✅ |
| 4 | Mot de passe faux / compte inconnu / désactivé → même refus | test | ✅ |
| 5 | Hachage hérité (semis 015) → refus sans lever | test | ✅ |
| 6 | Hachage DES → REFUSÉ (faille réelle, voir plus bas) | test | ✅ |
| 7 | Mot de passe > 72 octets → refusé, pas tronqué | test | ✅ |
| 8 | Jeton valide → identité ; jeton inventé → NULL | test | ✅ |
| 9 | Session révoquée → refus immédiat | test | ✅ |
| 10 | La base stocke EXACTEMENT le SHA-256, aucun préfixe du jeton | test | ✅ |
| 11 | Deux connexions → deux jetons, tous deux valides | test | ✅ |
| 12 | `authenticated` NE PEUT PAS appeler verify_password / create_session | test | ✅ |
| 13 | `auth.users` et `auth.sessions` illisibles depuis l'application | test | ✅ |
| 14 | `withAuthGate` : rôle `mindcare_app`, `auth.uid()` NULL | test | ✅ |
| 15 | `withAuthGate` ne peut RIEN lire du cabinet | test | ✅ |
| 16 | Cookie : httpOnly, sameSite lax, secure piloté par MC_HTTPS | test | ✅ |
| 17 | Refus de cookie en clair hors boucle locale | test | ✅ |
| 18 | Suite complète 87 tests (60 unitaires + 27 intégration) | vitest | ✅ |
| 19 | `pnpm typecheck` · `pnpm lint` | tsc / eslint | ✅ 0 erreur |
| 20 | `pnpm preflight` (contrôles 11 et 12 inclus) | bash | ✅ |

## Les tests MORDENT — quatre mutations, quatre rouges

Leçon de la phase 2 appliquée : un test qui n'a jamais échoué ne prouve rien.

| Mutation | Effet attendu | Résultat |
|---|---|---|
| A · `GRANT EXECUTE … TO authenticated` | 070 §5 tombe | 🔴 test 12 **et** 070 refuse de s'appliquer |
| B · filtre de forme bcrypt retiré | DES accepté | 🔴 test 6 |
| C · contrôle `profiles.is_active` retiré | compte désactivé passe | 🔴 test 4 |
| D · jeton stocké en clair | fuite rejouable | 🔴 test 10 |

Deux de ces tests ont dû être **réécrits** parce que leur première version ne
mordait pas :

* **test 6** vérifiait le compte de 015 ; il restait vert sans le filtre, le
  refus venant d'ailleurs. Réécrit sur un compte au hachage DES réel.
* **test 10** cherchait le jeton entier par `LIKE` ; il restait vert quand on
  stockait ses 32 premiers caractères. Réécrit pour exiger l'égalité exacte avec
  le SHA-256 calculé indépendamment, et pour balayer les préfixes.

## Ce que la mesure a CONTREDIT

### 1. `crypt()` ne lève PAS sur un sel malformé — il retombe sur DES

Le commentaire de 070 affirmait d'abord que `crypt(mdp, 'CONNEXION-IMPOSSIBLE')`
lève. **C'est faux** : l'appel rend `COUYyeobcZg..`. pgcrypto retombe
silencieusement sur DES, l'algorithme d'Unix de 1979.

Mesuré sur la base :

```
sel DES accepte  : qa
hash DES longueur: 13
DES se reverifie : true
mdp different accepte (8 car.) : true      <-- la faille
```

DES n'utilise que les **8 premiers caractères**. `motdepasse-ABCDEF` et
`motdepasse-ZZZZZZ` sont tous deux acceptés contre le même hachage. Sans le
filtre de forme bcrypt, un compte au hachage hérité s'ouvrirait donc à n'importe
quel mot de passe partageant ses huit premiers caractères.

Le filtre était juste ; **la raison écrite était fausse**. Corrigée dans 070 §4a.

### 2. Vert incrémental ≠ vert intégré — l'installation neuve était CASSÉE

Les 20 tests étaient verts sur la base construite au fil de l'eau. Reconstruite
depuis zéro, **13 ont échoué** : `permission denied for schema auth`.

Cause : 070 accorde `USAGE`/`EXECUTE` à `mindcare_app` dans un bloc
`IF EXISTS (… rolname = 'mindcare_app')`. Sur une base neuve, l'ordre est
migrations **puis** bootstrap 010 — le rôle n'existe pas encore, le bloc est
sauté en silence. Et `010_app_role.sql` ne faisait pas le geste symétrique, alors
qu'un commentaire de 070 affirmait qu'il le faisait.

Conséquence réelle : **aucune connexion n'aurait été possible sur une
installation neuve chez la médecin.** Corrigé dans 010 (geste symétrique + une
assertion qui refuse l'installation si les portes sont injoignables).

C'est exactement le piège que le dépôt connaît déjà — « vert statique n'est pas
vert intégré ». Seule la reconstruction depuis zéro l'a montré.

### 3. Un octet NUL dans un fichier source, écrit par mégarde

`preflight.sh` (contrôle « fichier source contenant des octets NUL ») a refusé
`src/server/auth/limite-debit.ts` : la clé du compteur s'écrivait
`` `${ip}<octet NUL>${email}` `` au lieu de `` `${ip} ${email}` ``. Le fichier
compilait, passait le lint et les tests — mais `file` le classait `data`, et un
octet NUL en source casse une partie de l'outillage.

Aucun autre fichier de la phase n'est touché (vérifié un par un). Corrigé.
C'est un contrôle du dépôt, antérieur à cette migration, qui l'a trouvé — ni la
compilation, ni les tests, ni la relecture.

## Décision de conception à relire

`auth_gatekeeper` reçoit `SELECT` sur `app.profiles` (070 §3bis) — il SORT donc
de son schéma. Motif : `verify_password` consulte `profiles.is_active`, sans quoi
désactiver une assistante dans l'application ne lui fermerait pas la porte.
Bornes : lecture seule, une table nommée, aucune donnée patient, et la policy
`profiles_read` de 003 ouvre déjà cet annuaire à tout utilisateur authentifié.
Une assertion vérifie qu'il n'a ni `app.patients`, ni UPDATE/DELETE sur profiles.

## Non prouvé à ce stade

* **Les trois routes `/api/auth/*` ne sont pas éprouvées de bout en bout.** Elles
  sont écrites, typées et lintées, mais aucun test ne les exerce par HTTP : cela
  demande un serveur Next en marche, ce qui relève de la phase 4. Ce qu'elles
  appellent (`session.ts`) est, lui, entièrement couvert.
* `DbPort.signIn/getSession/signOut` n'est pas encore rebranché sur ces routes —
  phase 4, conformément au plan. L'écran de connexion parle toujours à Supabase.
* La temporisation anti-oracle (`pg_sleep(0.25)`) n'est pas mesurée
  statistiquement ; elle est présente, pas caractérisée.
* La limitation de débit est en mémoire et couverte par aucun test.
