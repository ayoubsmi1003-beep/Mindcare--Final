# Phase 5 — portage des cinq fonctions Deno

Base `mc-p3` (PostgreSQL 17, 127.0.0.1:55441) + migration 071. Serveur
`next start` sur 127.0.0.1:3210, build de production, `VOICE_PROVIDER=cloud`.

## Verdicts

| # | Propriété | Moyen | Verdict |
|---|---|---|---|
| 1 | Migration 071 et ses 5 assertions | psql | ✅ |
| 2 | Les 5 routes existent et répondent | HTTP | ✅ |
| 3 | Sans session, les 5 refusent (`non-authentifie`) | HTTP | ✅ |
| 4 | Validation d'entrée (MIME, bornes, corps vide) | HTTP | ✅ |
| 5 | Les refus NOMMENT l'organe (jamais « base indisponible ») | HTTP | ✅ |
| 6 | Le chat atteint la base sous la bonne identité | HTTP | ✅ |
| 7 | SSE : `text/event-stream` + `no-transform` + `X-Accel-Buffering: no` | HTTP | ✅ |
| 8 | **Appel LLM réel : 2 franchissements OpenRouter, `outcome=ok`** | SQL | ✅ |
| 9 | Journal de franchissement écrit par la porte 071 | SQL | ✅ |
| 10 | `audit.boundary_crossings` reste ILLISIBLE par l'application | SQL | ✅ |
| 11 | Journal INFORGEABLE depuis `authenticated` | assertion 071 | ✅ |
| 12 | 7 écrans du §37, Jarvis compris | Chromium | ✅ 31/31 |
| 13 | 106 tests · typecheck · lint · preflight · build | outillage | ✅ |
| 14 | Point de sortie unique : règle ESLint + preflight, **éprouvés** | sondes | ✅ |

## Ce que le portage a RÉVÉLÉ — quatre défauts latents, invisibles sous Deno

`tsconfig.json` exclut `supabase/functions/`, et ESLint l'ignore globalement.
Ce code n'a donc **jamais** été type-vérifié ni linté. Le passage sous Node l'a
soumis aux règles du dépôt pour la première fois :

1. **`LlmRequest.purpose` mentait.** Déclaré `Extract<BoundaryPurpose, "jarvis">`
   avec le commentaire « toujours `jarvis` pour un appel de texte ». Or
   `jarvis-resume-cas` passe `"resume-cas"` depuis la migration 054. Le code
   déployé violait sa propre déclaration ; il tournait parce que les types
   s'effacent. Type élargi, l'autorité étant la contrainte SQL.
2. **`deduplique()` rendait `readonly string[]`** là où le type inféré de zod
   attend `string[]`. Copie explicite.
3. **Un rétrécissement de type ne survivait pas à une fermeture** dans
   `jarvis-chat` (`corps.contextePatientActif` dans un `.some()`). Liaison locale.
4. **`Array.isArray()` rétrécit vers `any[]`, pas `unknown[]`** — dans
   `resume-cas.ts` et `resume-chronologie.ts`, donc dans le code qui décide ce
   qui est CITABLE dans un résumé clinique. Six accès de membre sur `any` y
   passaient sans contrôle. Gardes de type ajoutés.

## Le défaut le plus grave, trouvé au typecheck

**`clientSql` aurait fait perdre TOUS les tours de conversation, en silence.**

PostgREST déplie les fonctions scalaires : `RETURNS boolean` rend `true`, pas
`[{...}]`. `app.append_jarvis_turn` et `app.complete_jarvis_turn` rendent
`boolean`, et leurs appelants écrivent `data === true`.

Un adaptateur rendant toujours des lignes aurait donc renvoyé `false` à chaque
fois. Ces deux portes **dégradent gracieusement par conception** (aucun échec de
carnet ne tue une bonne réponse) : il n'y aurait eu **aucune erreur**, seulement
`persiste:false` dans l'événement final, et plus aucun tour enregistré.

`deplierScalaire()` reproduit la règle de PostgREST. Le signal est fiable :
`SELECT * FROM app.fn(...)` sur une fonction scalaire rend une ligne d'une
colonne, nommée comme la fonction.

Deuxième écart du même ordre : `complete_jarvis_turn(p_outil jsonb)` reçoit un
OBJET, que PostgREST sérialisait et que `pg` refuse. `scalariser()` s'en charge.

## Deux garde-fous qui ne gardaient rien — mesuré

* **La règle ESLint du point de sortie était INERTE.** Un second bloc `rules:`
  dans le même objet de configuration écrasait le premier (sémantique JavaScript,
  aucune erreur). Une sonde `fetch("https://…")` déposée dans `src/services/`
  passait le lint **sans un mot**. Corrigé, puis éprouvé par sonde.
* **`pnpm lint` a « réussi » alors qu'ESLint PLANTAIT.** J'avais conclu au vert
  en filtrant la sortie au lieu de lire le code de sortie. Le fichier de
  configuration avait une regex cassée. Depuis, chaque verdict lit `$?`.

## Le contrôle 2 de preflight, remplacé et renforcé

Sa prémisse (« `src/` est du code navigateur ») est devenue fausse : la
passerelle vit maintenant dans `src/server/egress/`. Plutôt que de retirer
`src/server/` du grep — ce qui l'aurait affaibli — il devient :

* **2a** les noms de clés n'apparaissent que dans `src/server/**` ;
* **2b** le **paquet construit** ne contient ni les noms **ni les VALEURS** des
  secrets, lus depuis `.env` et comparés **en aveugle** (jamais affichés).

Les deux volets ont été éprouvés par sonde ; 2b détecte une valeur injectée dans
`.next/static/` sans jamais l'imprimer. C'est plus fort que ce qui existait.

## Les tests visaient l'ancien code

`tests/unit/contrat-workspace.test.ts` et `resume-chronologie.test.ts`
importaient `supabase/functions/_shared/` — les copies **Deno**. Après le
portage, l'application utilise `src/server/jarvis/`, et les deux jeux ont
divergé (gardes de type ajoutés). Les tests seraient restés verts en mesurant du
code qui n'est plus livré. Repointés, avec `tsconfig.test.json`.

## Non prouvé à ce stade

* **La dictée et la synthèse vocale n'ont pas transcrit ni parlé.** Les refus
  sont propres et nomment `configuration`, mais Groq et ElevenLabs n'ont pas été
  joints. Le LLM, lui, a réellement répondu (2 franchissements `ok`).
* `jarvis-analyze-session` et `jarvis-resume-cas` ne sont pas exercées sur un
  dossier réel : la base n'a pas de consultation assez complète.
* Le mot-clé de réveil et le micro restent non éprouvés — matériel absent, comme
  déjà noté dans STATE.md.
* `supabase/functions/` existe toujours : sa suppression est la phase 6.
