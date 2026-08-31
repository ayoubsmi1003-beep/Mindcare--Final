# Phase 2 — l'adaptateur PostgreSQL et l'étanchéité de l'identité

Base d'épreuve : PostgreSQL 17, conteneur jetable `mc-p2`, port 127.0.0.1:55440,
ICU `fr-DZ`. Chaîne rejouée depuis zéro : `000_platform_compat.sql` → 68
migrations → `010_app_role.sql`.

## Ce qui est prouvé

| # | Propriété | Moyen | Verdict |
|---|---|---|---|
| 1 | Le bootstrap `010` s'applique et ses 4 assertions passent | psql | ✅ |
| 2 | `auth.uid()` rend l'identité posée par l'enveloppe | test d'intégration | ✅ |
| 3 | Sans identité, `auth.uid()` rend NULL et le rôle est `anon` | test | ✅ |
| 4 | L'identité ne survit pas à sa transaction (pool à 1 connexion) | test | ✅ |
| 5 | Une transaction qui ÉCHOUE ne laisse pas son identité | test | ✅ |
| 6 | 5 appels entrelacés A/B/A/B/A rendent chacun leur propre identité | test | ✅ |
| 7 | Hors enveloppe (`RESET ROLE`), `mindcare_app` n'a AUCUN droit | test | ✅ |
| 8 | ADR-019 tient : pas de `SELECT` direct sur `app.patients` | test | ✅ |
| 9 | `pnpm typecheck` | tsc | ✅ |
| 10 | `pnpm lint` | eslint | ✅ 0 erreur |
| 11 | Suite complète 67 tests (60 existants + 7 nouveaux) | vitest | ✅ |

## Ce que la mesure a CONTREDIT — à lire avant de toucher au dispositif

Les 7 tests d'intégration ont d'abord été relancés après avoir REMPLACÉ
`SET LOCAL ROLE` par `SET ROLE` et `set_config(…, true)` par `false` — c'est-à-dire
en réintroduisant exactement la fuite d'identité que la phase 2 doit empêcher.

**Les 7 tests sont restés VERTS.**

Cause : le `DISCARD ALL` du `finally` efface aussi les réglages de portée
SESSION avant de rendre la connexion au pool. Le comportement observable est
donc identique avec ou sans `SET LOCAL`, et AUCUN test de bout en bout ne peut
distinguer le verrou 1 du verrou 3.

Conséquence retenue, et c'est la seule qui compte : sans contrôle
supplémentaire, la sécurité pourrait glisser vers une dépendance totale à
`DISCARD ALL` sans que personne ne le décide ni ne s'en aperçoive.

D'où le **contrôle 11 de `scripts/preflight.sh`**, qui lit le TEXTE de
`withCaller.ts` — le seul endroit où la différence existe. Il a été éprouvé dans
les deux sens :

* code correct → `fail=0` ;
* mutation réintroduite → 🔴 sur les deux lignes fautives (`SET ROLE` et
  `set_config(…, false)`).

Ne pas retirer le contrôle 11 en le croyant couvert par les tests. Il ne l'est pas.

## Non prouvé à ce stade

* Aucun service n'est encore branché sur `pgPort` — la frontière HTTP est la phase 4.
* `construireSelect` / `construireRpc` ne sont éprouvés qu'indirectement ; leurs
  cas limites (filtre `null`, tri multiple, paramètres nommés) méritent des tests
  dédiés en phase 4, quand l'allowlist des relations existera.
* L'instance PostgreSQL 18 native de ce poste écoute sur `0.0.0.0:5432` — hors
  périmètre phase 2, à traiter en phase 7 (SELF-HOST-SETUP §2.3 exige `127.0.0.1`).
