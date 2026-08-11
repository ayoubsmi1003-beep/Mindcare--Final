# STATE — MindCare OS
Dernière mise à jour : 2026-08-11 · **V1 (Vérité & Vitesse) EN COURS** — V1.1 ✅ · V1.3 ✅ ·
V1.4 ✅ · **V1.5 code livré / mesure DIFFÉRÉE par dérogation** · V1.2 ✅ (dans les limites de
l'arbitrage) · portes G1 et G3 franchies · **G4 NON FRANCHIE mais TRANCHÉE : aucune porte
composite en V1 ; les 5 écrans restent ROUGES, dette de mesure ouverte**

---

## ⏭️ REPRISE — À FAIRE À LA PROCHAINE SESSION

**Fait et prouvé (ne pas refaire) :**
| Lot | État | Preuve |
|---|---|---|
| V1.1 erreurs portent leur cause | ✅ | porte G1 : preflight + typecheck + lint + build verts, `grep "inattendu"` hors 2 fichiers → 0 |
| V1.3 séance qui ne finit jamais | ✅ | porte G3 : rejeu 001→032 (31 migrations), plancher/option C/règle 3/idempotence/audit mesurés, 3 rôles refusés |
| V1.4 erreur ≠ vide | ✅ | `EtatFinances` exclusif ; `erreur` remplace le contenu (retour anticipé) ; `vide` inatteignable sans double lecture réussie |
| Migration 032 | ✅ | 9 passes de revue adversariale, SQL exécutable VERT, **PAS ENCORE APPLIQUÉE en production** |
| `031` sorti de `migrations/` | ✅ | déplacé vers `docs/` (V6 le reprendra), 0 octet modifié |
| `verify-migrations.sh` | ✅ | faux positif du contrôle 3 corrigé → VERT 6/6 |

**⏭️ 2026-08-11 — CE QUI RESTE, EN UNE LIGNE : coller les 3 chiffres par écran (voir
§V1.5 plus bas), puis Steps 19 (G4) · 21-23 (checkpoint-v1.sh, security-reviewer, clôture).**
Les Steps 16-17 (V1.5 code) et 20 (V1.2) sont livrés et leurs portes statiques sont vertes ;
la liste numérotée ci-dessous est celle d'AVANT cette session, conservée pour le contexte —
les lots 1 et 2 y sont désormais **partiellement faits**, détail dans les sections dédiées.

**Reste à faire, dans cet ordre :**

1. **V1.5 — vitesse (Steps 16-19, porte G4).** Le gros morceau.
   ✅ **Steps 16-17 FAITS le 2026-08-11** (cascade de session cassée, squelettes, plafond 10 s).
   🔴 **Step 18 — NON MESURÉ, différé par dérogation utilisateur du 2026-08-11.** Les 5 écrans
   restent hors budget par défaut, dette de mesure ouverte. ⛔ **Step 19 / G4 : TRANCHÉE le
   même jour — aucune porte composite en V1, `/agenda` rouge reporté à V5.** Détail et
   raisonnement dans la section « V1.5 » plus bas. **Ne pas relancer la mesure sans le
   demander : c'est une décision humaine déjà prise, pas un oubli.**
   - Squelettes manquants ; `Promise.all` sur les appels indépendants (motif déjà validé
     `finances/page.tsx`) ; plafond 10 s → état « délai » (interdiction du spinner infini,
     `05-UX-CONTRACT.md` §2).
   - **Re-mesure en `pnpm build && pnpm start`, 3×, médiane**, et écrire les 3 chiffres par écran
     dans ce fichier. ⚠️ La mesure de référence du Step 01 est **PARTIELLE** (TTFB `curl` non
     authentifié seulement — pas de navigateur dans cet environnement). Un écran sans ses 3
     chiffres est **hors budget par défaut** (`06-PERF-BUDGET.md` §6).
   - **Porte G4** : RPC composite UNIQUEMENT si un écran reste hors budget ET que la cause est
     une dépendance réelle entre appels → alors arbitrage utilisateur, pas décision d'agent.
     Candidat unique connu : `/consultation/[id]` (`listAmendments` dépend de `note.id`).
   - ⛔ **Pas de TanStack Query** (décision utilisateur, dette datée V4).

2. **V1.2 — Jarvis (Step 20).** ✅ **FAIT le 2026-08-11** — arbitrage rendu (passerelle reste à
   10 s, aucun document d'autorité modifié), plafond client de 15 s posé. Reste la seule
   vérification à l'écran, bloquée par l'absence de navigateur. Détail en section « V1.2 ».
   *Texte d'origine conservé ci-dessous :* la frontière est **déjà correcte** (clé en Deno,
   pseudonymisation sur le chemin, franchissement audité 028). Il reste :
   - un **plafond client** sur `invokeFunction` (`AbortController`) pour qu'une Edge Function
     muette ne laisse pas tourner « Analyse en cours… » indéfiniment ;
   - vérifier le message honnête à l'expiration, à l'écran.
   - 🔴 **ARBITRAGE UTILISATEUR REQUIS AVANT DE TOUCHER AU FICHIER** : `SPRINT-V1.md` §V1.2 exige
     **30 s**, `03-JARVIS-TOOLS.md` §10 écrit « timeout > 10 s → annuler », et
     `external-call.ts` applique **10 s**. Par `DOC-AUTHORITY.md` §1 le rang 4 (03-JARVIS-TOOLS)
     bat le rang 5 (SPRINT-V1) : **un agent ne tranche pas seul entre deux documents
     d'autorité.** Demander, puis appliquer.

3. **Steps 21-23 — clôture.** `checkpoint-v1.sh` (à écrire), `security-reviewer` sur le diff
   entier, mise à jour finale de ce fichier.

**Deux dettes ouvertes, non bloquantes :**
- Relecture seule de `app.appointments` pour le geste manuel du 2026-08-10 (§GESTE MANUEL) —
  la requête est écrite, il suffit de la lancer et coller le résultat.
- `log.ts` n'émet rien en `NODE_ENV=production` et n'a aucune destination : V1.1 rend
  l'application diagnosable **en développement**, pas au cabinet. Dette datée porte de livraison.

**Migration 032 n'est PAS appliquée en production.** Elle est prouvée par rejeu Docker
uniquement. L'appliquer = `DATABASE_URL=… bash scripts/db-migrate.sh` (031 ne s'y trouve plus,
le corpus est VERT) — décision de la prochaine session, pas faite ici.

---

## V1.5 — vitesse (Steps 16-17 LIVRÉS · Step 18 EN ATTENTE DE MESURE · G4 NON FRANCHIE)

**Ce qui a été changé, et pourquoi.** Aucun écran n'a changé de forme ni de logique métier.

1. **La cascade de session est cassée — c'était le vrai coût, et il était partagé par
   TOUS les écrans.** `useSessionEcran` enchaînait `getSession()` **puis** `getCurrentUser()`,
   et chaque écran attendait `utilisateur !== undefined` avant sa première requête métier :
   **trois allers-retours en séquence avant le premier contenu**, soit ~540 ms à 180 ms le tour
   (`06-PERF-BUDGET.md` §5) avant même la donnée. Or `getCurrentUser` ne sert qu'à composer la
   navigation (I12) ; la donnée métier n'en dépend pas.
   → Nouveau signal `sessionTranchee` dans `useSessionEcran`, **distinct du profil**, posé dès
   la réponse de `getSession()`. Les 4 écrans démarrent leur lecture dessus ; `getCurrentUser`
   court désormais **en parallèle**. Coût attendu : `getSession + max(profil, donnée)` au lieu
   de `getSession + profil + donnée`.
   ⚠️ **La garantie d'I4 ne bouge pas, et c'est le point à relire** : aucune porte
   journalisante n'est appelée avant que la session soit tranchée — et c'est `getSession()`
   qui la tranche, pas le profil. Attendre le profil en plus n'ajoutait aucune garantie,
   seulement un aller-retour. `sessionTranchee` vaut `false` (jamais `true`) sur le chemin de
   redirection et sur une réponse indéterminée : aucune trace d'audit pour une consultation
   qui n'aura pas lieu.

   **🔴 UN DÉFAUT RÉEL INTRODUIT PAR CE CHANGEMENT, TROUVÉ ET CORRIGÉ DANS LA MÊME SESSION.**
   Le garde de RENDU des écrans teste `utilisateur === undefined` ; le nouveau garde d'EFFET
   teste `sessionTranchee !== true`. **Hors ligne, les deux divergent** : `getSession()` échoue
   → `sessionTranchee = false` **et** `utilisateur = null`. Le rendu passait le premier garde,
   l'effet ne partait jamais, et `chargement` restait à `true` : **squelette qui respire sans
   fin** — l'attente infinie que V1.5 existe précisément pour supprimer
   (`05-UX-CONTRACT.md` §2). Ironie utile à retenir : le lot qui ferme les attentes infinies en
   a ouvert une, sur le chemin le plus fréquent du cabinet (le Wi-Fi qui tombe).
   **`/finances` et `/consultation` n'ont jamais eu le défaut** — ils portaient déjà une branche
   `utilisateur === null` explicite. **`/agenda` et `/patients` ne l'avaient pas** : une branche
   de sortie leur a été ajoutée, sur `sessionTranchee === false`.
   ⚠️ **La condition est `sessionTranchee === false`, PAS `utilisateur === null`** — les deux ne
   disent pas la même chose : session lue mais **profil illisible** (`sessionTranchee === true`,
   `utilisateur === null`) doit continuer d'afficher l'écran avec la navigation la plus étroite.
   C'est le « défaut sûr » documenté dans ces deux écrans depuis S3 ; bloquer là-dessus
   cacherait un écran qui fonctionne.
   **Les 3 autres écrans (`agenda/[id]`, `agenda/nouveau`, `patients/[id]`) sont INCHANGÉS** :
   ils gardent l'ancien garde `utilisateur === undefined`, donc leur effet part et se résout
   hors ligne — vérifié par lecture, pas déduit de l'absence de modification. Ils ne gagnent pas
   la parallélisation ; les étendre serait hors périmètre (règle 10). **Écart connu et assumé :
   deux motifs de garde coexistent désormais dans `src/app/`.** À unifier en V5, pas en V1.

2. **Squelettes là où il y avait un mot d'attente** (`05-UX-CONTRACT.md` §2) :
   `/agenda` (garde de session : texte nu → `Squelette` en-tête + grille) et `/patients`
   (chargement de la liste : `<p>Chargement…</p>` → `Squelette lignes={6}`). Un mot d'une
   ligne remplacé par six lignes de résultats décale l'écran à l'instant du clic.

3. **Plafond de 10 s → état ERREUR avec le mot « délai »**, sur `/patients`, `/agenda` et
   `/consultation/[id]`. `/finances` l'avait déjà (V1.4) ; le motif est repris tel quel
   (minuteur + drapeau `annule` ou compteur de génération, `clearTimeout` au démontage ET à
   la réponse). `fr.delaiDepasse` existait déjà. **Aucune attente n'est plus infinie.**
   Sur `/consultation/[id]`, l'expiration passe par `echecLecture` et **ne touche pas
   `seance`** : une lenteur réseau pendant une séance ne fait pas disparaître la séance de
   l'écran (distinction V1.4 échec de lecture ≠ séance introuvable).

**Portes vertes sur ce lot :** `preflight` ✅ · `typecheck` ✅ · `lint` ✅ (0 erreur, 0 avertissement)
· `build` ✅ · `grep OPENROUTER|GROQ|ELEVENLABS .next/static/` → **0** · `grep '"inattendu"'`
hors `errors.ts`/`fr.ts` → **0**.

### 🔴 Step 18 — NON MESURÉ, ET DÉLIBÉRÉMENT DIFFÉRÉ (dérogation utilisateur, 2026-08-11)

**Statut : NON MESURÉ. Pas « vert », pas « acceptable », pas « probablement dans le budget ».**

**Décision utilisateur explicite du 2026-08-11 — dérogation, pas franchissement.**
La collecte manuelle des 15 relevés (onglet Réseau + chronomètre, 5 écrans × 3 grandeurs) est
**différée**, au motif que l'application a été **exercée manuellement** et que la réactivité
constatée à l'usage est jugée **acceptable en l'état**. Ce motif est un **jugement d'usage**,
et il est écrit ici comme tel.

**Ce que cette dérogation ne fait PAS, et qu'il faut lire avant de s'y appuyer :**
- ❌ Elle **n'affirme aucun chiffre de performance**. Aucune valeur n'est estimée, déduite,
  extrapolée d'un TTFB `curl`, ni reprise du Step 01 — les cases ci-dessous restent vides.
- ❌ Elle **ne modifie pas le contrat**. `06-PERF-BUDGET.md` est intact : §6 continue de dire
  qu'un écran sans ses trois chiffres est **hors budget par défaut**, et §2 que hors budget
  est **ROUGE au checkpoint, au même titre qu'un test RLS qui échoue**. Un agent ne modifie
  pas un document d'autorité, et amender le budget pour qu'il tombe juste serait exactement
  la façon de rendre cette dette invisible dans six mois.
- ❌ Elle **ne rend pas les écrans verts**. Ils restent **ROUGES**, par contrat, ci-dessous.
- ✅ Elle acte seulement que **la session continue malgré ce rouge**, par choix humain assumé.

**La preuve numérique de `06-PERF-BUDGET.md` reste donc une DETTE DE MESURE OUVERTE**, non
échue, à lever par un relevé en navigateur (`pnpm build && pnpm start`, jamais `dev`, 3
répétitions, médiane). Même nature que la dette de navigateur de S5/S6 et du Step 01.

| Écran | Appels (budget) | 1er contenu (budget) | Complet (budget) | Verdict |
|---|---|---|---|---|
| `/patients` | — (1) | — (100 ms) | — (400 ms) | 🔴 non mesuré · différé |
| `/agenda` (jour) | **2 constatés** (1) | — (100 ms) | — (400 ms) | 🔴 **hors budget en NOMBRE** (voir ci-dessous) |
| `/agenda` (semaine) | **2 constatés** (1) | — (100 ms) | — (600 ms) | 🔴 **hors budget en NOMBRE** |
| `/consultation/[id]` | — (2) | — (100 ms) | — (500 ms) | 🔴 non mesuré · différé |
| `/finances` | — (1) | — (100 ms) | — (400 ms) | 🔴 non mesuré · différé |

⚠️ Les « 2 constatés » de `/agenda` ne viennent PAS d'une mesure au navigateur : ils se
**comptent dans le code** (deux `listAgenda` distincts, voir ci-dessous). C'est la seule
grandeur du tableau qui soit établie sans instrument, et c'est pourquoi elle y figure alors que
tout le reste est vide. Les deux colonnes de temps de ces lignes restent, elles, non mesurées.

**Méthode à appliquer le jour où la dette est levée (`06-PERF-BUDGET.md` §1) :** build
uniquement, jamais `dev` · onglet Réseau pour compter les appels · chronomètre pour les deux
temps · **3 répétitions, on garde la médiane** · rechargement complet entre chaque essai (un
seul essai mesure le cache).

### ⚠️ Défaut de budget ÉTABLI SANS INSTRUMENT — `/agenda` fait 2 appels pour un budget de 1

`/agenda` lance **deux `listAgenda` distincts** : la grille (fenêtre affichée) et la file
d'attente d'approbation (fenêtre de 60 jours, volontairement plus large — une demande pour dans
trois semaines doit se voir aujourd'hui). Les deux partent **déjà en parallèle** (deux effets
React concurrents) : aucun `Promise.all` ne changerait quoi que ce soit au **nombre**, qui est
la grandeur que `06-PERF-BUDGET.md` §2 borne à 1.

**Ce n'est donc PAS une cascade évitable en TypeScript (cas 3a de la porte G4), c'est le cas
3b** : deux fenêtres temporelles différentes que seule une porte SQL composite réunirait en un
appel.

### ⛔ PORTE G4 — DÉCISION RENDUE le 2026-08-11 : AUCUNE PORTE COMPOSITE EN V1

**G4 n'est pas franchie. Elle est TRANCHÉE, ce qui n'est pas la même chose**, et la distinction
est écrite ici pour qu'aucune session ultérieure ne la lise à l'envers :

- **Non franchie** — sa preuve est « 3 chiffres par écran écrits dans STATE.md ». Ils n'y sont
  pas, et rien ne les remplace. Le volet « les écrans tiennent-ils leur budget de latence » est
  **indécidable en l'état**, et le reste.
- **Tranchée** — la porte a une seconde fonction : décider si une porte SQL composite s'écrit
  en V1. **Celle-là se décide sans instrument, et la réponse est NON.**

**Le raisonnement, en deux temps :**

1. **La règle du plan est explicite et joue en faveur du non-agir** : « Aucune porte composite
   n'est écrite sans ce chiffre en main » (plan §7, point 4). Pas de chiffre → pas de `033`.
   La règle a été écrite précisément pour ce cas de figure ; l'invoquer n'est pas un
   contournement de G4, c'est son application littérale.
2. **Le seul candidat réel ne devient pas plus urgent sans mesure.** `/agenda` est hors budget
   **en nombre d'appels** (2 pour 1), établi statiquement. Mais :
   - les deux appels sont **déjà concurrents**, pas en cascade : leur coût est celui du plus
     lent des deux, pas de leur somme ;
   - une porte composite est une **migration `033` sur la couche agenda**, avec revue
     `security-reviewer` obligatoire et rejeu — un chantier à risque non nul, engagé pour un
     gain **dont personne ne peut aujourd'hui écrire l'ampleur** ;
   - `06-PERF-BUDGET.md` §3 borne le nombre d'appels **parce que** les appels séquentiels
     coûtent ~180 ms chacun. Deux appels concurrents ne reproduisent pas ce coût-là. Le budget
     reste violé **à la lettre** — et c'est écrit rouge — mais la cause qu'il vise n'est pas
     démontrée présente ici.

**Conséquence, assumée et écrite comme telle** (plan §7, « Non corrigé en V1, et dit
franchement ») : `/agenda` **reste ROUGE**, reporté à **V5** (session Patients & Agenda), où la
porte composite se décidera avec une mesure en main. `/consultation/[id]` garde sa cascade
légitime (`listAmendments` dépend de `note.id`), déjà écrite en dette V5 — inchangée.

**Aucune migration `033` n'a été écrite. `supabase/migrations/` est inchangé cette session.**
La migration `032` n'a pas été touchée, n'a pas été appliquée, et aucun rejeu Docker n'a été
lancé : rien dans la séquence de portes de cette session ne l'exigeait.

## V1.2 — Jarvis (Step 20) : LIVRÉ, dans les limites de l'arbitrage

**Arbitrage utilisateur du 2026-08-11 — le timeout de la passerelle reste à 10 s.**
`03-JARVIS-TOOLS.md` §10 (« > 10 s → annuler », rang 4) bat `SPRINT-V1.md` §V1.2 (30 s, rang 5)
par `DOC-AUTHORITY.md` §1. **`_shared/external-call.ts` n'a pas été touché, et aucun document
d'autorité n'a été modifié.** La contradiction documentaire reste ouverte : c'est
`SPRINT-V1.md` qui devra être corrigé, par une main humaine.

**Ce qui a été ajouté :** un **plafond client de 15 s** sur `db/supabase.ts::invokeFunction`,
par `AbortController`. Il est délibérément **au-dessus** des 10 s de la passerelle : c'est un
filet contre une Edge Function qui ne répond **pas du tout** (processus tué, relais muet), pas
un concurrent de la passerelle — au même chiffre, le client abandonnerait parfois le premier et
remplacerait un message qui explique la panne par un message qui dit seulement « délai ».
C'est le défaut nommément constaté sur « Analyse en cours… », qui tournait indéfiniment.

**Un piège trouvé et évité, à ne pas rouvrir.** `@supabase/functions-js@2.110.9` expose une
option `timeout` native (`types.d.ts:115-120`, **lue dans `node_modules`, pas dans la
documentation** — [[verifier-la-lib-installee]]). Elle n'a **pas** été utilisée : son abandon
revient sous la forme d'un `FunctionsFetchError`, un nom absent de `NOMS_TRANSPORT`, que
`isNetworkFailure` ne reconnaît donc pas — le classement retomberait sur le code d'aveu que
V1.1 vient de fermer. Avec notre propre `signal`, c'est le code qui **nomme** l'expiration :
`indisponible` + `fr.delaiDepasse` + `technical: "client:delai-depasse"`.
**`indisponible` et non `hors-ligne`** : la connexion fonctionne, c'est la fonction qui n'a pas
répondu ; les confondre afficherait « Connexion perdue » à quelqu'un dont le réseau va très
bien, et l'enverrait chercher la panne du mauvais côté.

⚠️ **Reste à vérifier À L'ÉCRAN, non fait** : que l'expiration produit bien la phrase honnête
sur le panneau d'analyse de séance. Même dette de navigateur que ci-dessus.

## Step 22 — revue de sécurité du diff entier : **FAITE le 2026-08-12 · 0 ROUGE · 7 RÉSERVES**

**Historique, conservé délibérément.** Un premier lancement le 2026-08-11 (sous-agent
`security-reviewer`) s'est arrêté sur une limite de session de l'API **sans rendre le moindre
résultat, même partiel**. Il n'avait donc RIEN validé et RIEN infirmé. Cette phrase reste
écrite pour qu'aucune session suivante ne prenne l'absence de rouge pour un vert.

**Reprise le 2026-08-12, en relecture directe** (pas de sous-agent), sur le diff COMPLET :
30 fichiers modifiés, 2 scripts neufs, `032` non suivi. Périmètre couvert :
`db/supabase.ts` · frontière `external-call`/Jarvis · `useSessionEcran.ts` · les quatre écrans
· `errors.ts`/`log.ts` et tous les services · `checkpoint-v1.sh` · `verify-migrations.sh` ·
`preflight.sh`.

### VERT — vérifié, pas supposé

- **Règle 2.** Aucun `NEXT_PUBLIC_` hors URL + clé anon (`src/lib/env.ts`). Aucun
  `OPENROUTER|GROQ|ELEVENLABS` dans `src/`.
- **Règle 1, point de sortie unique.** `grep fetch("https` sur `src/` + `supabase/` ne rend que
  `_shared/external-call.ts`.
- **Règle 4.** Aucun `if (role === …)` dans un écran. `/agenda` et `/patients` rendent
  `utilisateur?.role ?? "assistant"` — défaut **fermé** vers la navigation la plus étroite quand
  le profil est illisible. La RLS décide toujours seule.
- **`AppError.cause` — le risque le plus élevé du diff, et il ne fuit pas.** `toAppError`
  attache désormais l'erreur Postgres brute, dont le `.message` peut porter
  `Key (phone)=(0554…)`. Vérifié qu'elle ne sort jamais : `grep "use server"` sur `src/` ne rend
  **rien** — aucun `AppError` ne traverse donc une frontière de sérialisation RSC ; les écrans
  ne lisent que `.message` (français, `fr.ts`) ; `logFieldsFor` n'émet que
  `code`/`technical`/`context`/`causeName`, et `causeName` est `.name`, jamais `.message`.
  `LogFields` reste fermée. **I5 et règle 1 tiennent.**
- **La classification hors-ligne survit à l'emballage V1.1.** Les `catch` de `db/supabase.ts`
  enveloppent en `new Error(…, { cause })` ; `unwrapCause` remonte à l'original AVANT
  `isNetworkFailure`/`classify`, avec un `Set` contre une chaîne cyclique. Un
  `TypeError: Failed to fetch` levé se classe toujours `hors-ligne`, pas `inattendu`.
- **La régression d'attente infinie est réellement fermée, sur les QUATRE écrans.** Les gardes
  d'effet sont `sessionTranchee !== true` ; chaque écran a une sortie pour
  `sessionTranchee === false` — `/agenda` et `/patients` la portent explicitement,
  `/finances:200` et `/consultation:637` sont couverts par leur branche `utilisateur === null`,
  que le même chemin hors ligne pose. Aucun écran ne peut atteindre un état où l'effet ne part
  pas et où `chargement` reste `true`.
- **Aucun écran n'interroge avant que la session soit établie.** Toute lecture métier est
  derrière `sessionTranchee === true`, donc derrière un `getSession()` qui a rendu une session.
  La garantie I4 est inchangée : le profil part en parallèle, et le profil n'a jamais conditionné
  l'audit.
- **AbortController.** Vérifié dans la bibliothèque INSTALLÉE, pas dans sa documentation :
  `@supabase/functions-js@2.110.9`, `dist/module/types.d.ts:113-115` déclare
  `signal?: AbortSignal`, et `FunctionsClient.js:238-262` le passe à `fetch`. Le commentaire du
  code dit vrai. À l'expiration, `expire` est testé DANS LES DEUX chemins (erreur de transport
  ET `catch`) : l'abandon est rendu `indisponible` + `fr.delaiDepasse`, jamais maquillé en
  `hors-ligne`.
- **Frontière Jarvis / délais.** Passerelle toujours `TIMEOUT_MS_DEFAUT = 10_000`
  (`external-call.ts:214`) ; plafond client 15 s, délibérément au-dessus. Arbitrage du
  2026-08-11 respecté, aucun document d'autorité modifié.
- **Migrations.** `git status supabase/` ne rend qu'une entrée : `032` non suivi. Pas de `033`,
  rien de modifié, pas de Docker, aucune écriture en production.

### RÉSERVES — non bloquantes, écrites ici et NON codées (règle 10)

1. Le second effet de `/agenda` (file d'approbation) n'a ni plafond de délai ni surface
   d'erreur : un appel qui pend laisse la file silencieusement absente. Ce n'est pas une attente
   infinie — c'est la grille principale qui gouverne l'état de l'écran.
2. **Un commentaire qui sur-déclare.** `/agenda:203` écrit que le motif est « repris de
   /finances et /consultation, qui portaient déjà leur branche ». Ces deux écrans ne portent
   AUCUNE branche `sessionTranchee` : ils sont couverts par accident, parce que le même chemin
   hors ligne pose aussi `utilisateur = null`. Résultat juste, mécanisme faux — et c'est le
   mécanisme que le prochain lecteur croira.
3. Sémantiques divergentes pour `sessionTranchee === true && utilisateur === null` : `/agenda`
   et `/patients` continuent avec la navigation la plus étroite ; `/finances` et
   `/consultation` affichent « non authentifié » + reconnexion. Les deux sont sûrs, les deux
   choix sont opposés.
4. `/finances` : un échec D'ACTION (`encaisser`) pose `etat = "erreur"`, ce qui REMPLACE
   désormais la liste des paiements. `/consultation` évite exactement cela pour les erreurs
   d'action. Défendable sous UX §1, mais les deux écrans se contredisent.
5. **Risque de faux positif au checkpoint.** Les contrôles 9/11/12/13 de `checkpoint-v1.sh`
   cherchent des NOMS (`DELAI_CHARGEMENT_MS`, `Squelette`, `type EtatFinances`,
   `echecLecture`). Une constante déclarée mais jamais câblée les laisse VERTS. L'en-tête du
   script est honnête sur sa nature statique ; la limite méritait d'être écrite.
6. Le `sed "s/'[^']*'//g"` neuf de `verify-migrations.sh` travaille LIGNE À LIGNE : un
   `COMMENT ON … IS '…'` sur plusieurs lignes ne serait pas dépouillé. Juste sur le corpus
   d'aujourd'hui (6/6), fragile au prochain commentaire multi-ligne.
7. Le chemin « aucune session » réelle affiche une image de « non authentifié » pendant que
   `router.replace("/connexion")` est en vol. Cosmétique.

**➜ Step 22 est CLOS. Aucun ROUGE, donc aucune correction avant commit.** Les 7 réserves
vivent ici, pas dans le code.

⚠️ **Ce que cette revue ne prouve pas** : le défaut réel de la session précédente (attente
infinie hors ligne sur `/agenda` et `/patients`) avait été trouvé par relecture directe, pas
par un sous-agent. Une revue verte ne prouve pas davantage l'absence d'un défaut qu'elle n'en
prouve la présence — elle prouve seulement que les chemins listés ci-dessus ont été suivis.

## Step 23 — état vérifié, portes rejouées le 2026-08-12

```
bash scripts/preflight.sh          →  ✅ preflight vert                    exit 0
pnpm typecheck                     →  tsc --noEmit, 0 erreur              exit 0
pnpm lint                          →  eslint ., 0 erreur / 0 avertissement exit 0
pnpm build                         →  ✓ compilé en 9.7 s, 9 pages         exit 0
bash scripts/verify-migrations.sh  →  VERT 6/6, SECURITY DEFINER 26/26    exit 0
bash scripts/checkpoint-v1.sh      →  BLOQUÉ — 14 VERT · 1 BLOQUÉ         exit 2
```

`exit 2` est l'état ATTENDU, pas un échec : le contrôle 15 (les 3 chiffres par écran) est
bloqué par construction tant que les 15 relevés en navigateur ne sont pas ici. Voir Step 18.

**Rien n'est commité.** `supabase/` ne contient qu'une entrée non suivie — `032`, inchangée.
Aucune migration ajoutée ni modifiée, aucun `033`, aucun fichier Docker, aucune écriture en
production.

**Dette ouverte, inchangée :** les 15 mesures navigateur du Step 18 (dérogation du
2026-08-11). **Décision close, non rouverte :** G4 / Step 19 — pas de porte SQL composite,
pas de migration `033`, `/agenda` reporté en V5.

## Step 21 — `scripts/checkpoint-v1.sh` écrit · verdict **BLOQUÉ (14 VERT · 1 BLOQUÉ)**

Nouveau, statique, **sans base et sans Docker** — V1.5 et V1.2 n'ont touché ni au schéma ni aux
données ; rendre ce checkpoint dépendant d'un conteneur l'aurait rendu injouable sans rien
prouver de plus. La preuve base de V1.3 reste dans son propre rejeu (Step 12).

```
1  aucun "inattendu" hors errors.ts / fr.ts                    VERT
2  AppError porte context + cause (V1.1)                       VERT
3  LogFields fermée : ni message, ni patientId, ni champ libre VERT
4  un seul fetch externe (external-call.ts), règle 1           VERT
5  aucun secret dans .next/static (règle 2)                    VERT
6  aucun if (role === …) dans les écrans (règle 4)             VERT
7  plafond client sur invokeFunction (AbortController)         VERT
8  passerelle 10 s (rang 4) · plafond client supérieur (15 s)  VERT
9  plafond de délai sur les 4 écrans (UX §2)                   VERT
10 fr.delaiDepasse existe et porte le mot « délai »            VERT
11 squelette de chargement sur les 4 écrans                    VERT
12 /finances : machine à états exclusive (V1.4)                VERT
13 /consultation : échec de lecture ≠ séance introuvable       VERT
14 verify-migrations.sh : corpus applicable                    VERT
15 3 chiffres par écran (06-PERF-BUDGET §6)                    BLOQUÉ  non mesuré
```

**Le contrôle 15 est BLOQUÉ PAR CONSTRUCTION, et c'est le cœur du fichier.** Il aurait été
facile de ne pas l'écrire du tout — le checkpoint serait « VERT 14/14 ». C'est exactement ce
que `06-PERF-BUDGET.md` §6 interdit : « une mesure absente n'est pas une mesure réussie ».
**Le script ne tient délibérément aucun compte de la dérogation du 2026-08-11** : un waiver qui
éteindrait son propre contrôle ne laisserait aucune trace exécutable de la dette. Code de
sortie **2** — ce n'est pas un vert, et aucune modification du script ne doit le rendre vert :
seuls les 15 relevés en navigateur le peuvent.

**Deux faux positifs trouvés et corrigés PENDANT l'écriture du script — dans les contrôles, pas
dans le code.** Les contrôles 3 et 6 sont d'abord sortis ROUGE en repérant de la **prose de
commentaire** : `log.ts` porte la ligne « Jamais un message » (qui contient le mot interdit
parce qu'elle l'interdit), et `agenda/nouveau/page.tsx:5` explique mot pour mot qu'il ne porte
aucun `if (role === …)`. Vérifié à la main avant toute correction : les champs réels de
`LogFields` sont `code · durationMs · count · technical · context · causeName`, et aucun écran
ne teste de rôle. **Les deux contrôles dépouillent désormais les commentaires** (même idiome
que `preflight.sh` §9d). C'est le troisième passage de ce piège dans le dépôt — un contrôle qui
punit le commentaire qui le respecte apprend à supprimer les commentaires.

---

## V1 — en cours

**Step 01 — mesure de référence, PARTIELLE.** `pnpm build` VERT (55s, 0 erreur typecheck/lint),
`pnpm start` lancé en arrière-plan (port 3000). Mesuré : TTFB serveur par `curl`, 3×, médiane,
non authentifié (redirige vers `/connexion` — HTML de coquille seul, pas la donnée) :
```
/                      médiane 0.021s
/agenda                médiane 0.029s
/finances              médiane 0.011s
/patients              médiane 0.005s
/consultation/[id]     médiane 0.030s (1er essai 0.62s = cold start Next, écarté)
```
⚠️ **Ce n'est PAS la mesure de `06-PERF-BUDGET.md` §1** (appels réseau au chargement + premier
contenu + complet, au navigateur, authentifié contre Supabase réel). Aucun navigateur dans cet
environnement — même dette que S5/S6 (« pas de navigateur dans cet environnement », voir
Historique S1-S6 plus bas). Ce qui est prouvé ici : la coquille HTML répond en <50ms, cohérent
avec l'exigence squelette <100ms de `05-UX-CONTRACT.md` §2. Ce qui reste NON mesuré : nombre
d'appels réseau réels vers Supabase, temps jusqu'au contenu utile, temps complet. **Dette
explicite, à lever avant de déclarer le checkpoint 7 de V1 vert.**

**Step 02 — `grep OPENROUTER .next/static/` → 0 occurrence.** VERT, sur le build de référence.

**Step 03-07 — V1.1 (erreurs) LIVRÉE, PORTE G1 VERTE.**
- `errors.ts` : `AppError` porte désormais `context` et `cause` (non affichés — réservés au
  journal). `toAppError(raw, context?)` remonte la chaîne `Error.cause` (`unwrapCause`) pour
  retrouver un objet porteur d'un `.code` PostgREST/SQLSTATE avant de classer, sans toucher
  `isNetworkFailure` ni `NOMS_TRANSPORT` (pièges déjà payés). Nouveau `causeName()` et
  `logFieldsFor()` — un seul point qui décide ce qu'un service journalise.
- `log.ts` : `LogFields` élargie de façon FERMÉE — `technical`, `context`, `causeName`. Toujours
  aucun `message`, toujours aucun `patientId` (I5 inchangée).
- `db/supabase.ts` : les 8 `catch` enveloppent désormais la cause (`new Error(…, {cause})`) et
  passent un `context` par appel (`select:<table>`, `rpc:<nom>`, `signIn`, `signOut`,
  `getSession`, `invokeFunction:<nom>`). Les deux `toAppError(undefined)` muets sont remplacés
  par des erreurs nommées (`"auth:session-vide"`, `"edge:enveloppe-absente"`).
- **~31 sites** (finance, auth, appointments, practitioners, documents, consultations, patients,
  jarvis, deployment) : `{ code: result.error.code }` → `logFieldsFor(result.error)` partout —
  le SQLSTATE et le contexte atteignent désormais le journal, plus seulement le code applicatif
  grossier. Un `42501` (cloison ADR-019 qui fonctionne) est maintenant distinguable d'un `23505`.
- `scripts/preflight.sh` §10 (nouveau) : `"inattendu"` interdit comme code EN CODE hors de
  `errors.ts`/`fr.ts` (commentaires dépouillés, même méthode que §9d). Deux faux positifs de
  prose vérifiés (`finance.ts:104`, `db/supabase.ts:226`) — ni l'un ni l'autre n'est du code.
- **PORTE G1 : preflight ✅ · typecheck ✅ · lint ✅ · build ✅ (21.8s, 0 erreur) · grep OPENROUTER
  sur ce build → 0.** V1.1 est verrouillée ; V1.3→V1.5 peuvent commencer.
- ⚠️ **Limite d'observabilité, non résolue et non dans le périmètre de V1** (voir plan §3.4bis) :
  `log.ts` n'émet toujours rien en `NODE_ENV=production` et n'a aucune destination. V1.1 rend
  l'application diagnosable EN DÉVELOPPEMENT, pas au cabinet. La cause voyage désormais dans
  `AppError` au lieu d'être détruite — le jour où une destination est choisie, il n'y a qu'un
  `emit()` à brancher. Dette datée, à trancher avant le premier patient réel (porte de livraison).

**Step 08 — inventaire lecture seule (base Supabase Cloud réelle, session pooler, aucune
écriture).** 1 seule consultation `status='open'` orpheline, `started_at` 2026-08-04 14:48:20
UTC, soit ~6 jours au moment de la mesure (2026-08-10 13:13 UTC) — cohérent avec le symptôme
`125:44:26` constaté le 09/08. Aucune contrainte SQL (`CHECK`, trigger) n'exige `ended_at NOT
NULL` sur une ligne `status='closed'` (007, 026 relus) : `duration_seconds` est une colonne
GÉNÉRÉE (`EXTRACT(EPOCH FROM (ended_at - started_at))`), elle devient simplement `NULL` si
`ended_at` l'est.

**Step 09 — PORTE G2 FRANCHIE.** Décision utilisateur explicite : **option C** —
`ended_at` reste `NULL`, seul `status` passe à `'closed'`. Aucune durée clinique inventée.
Complément identifié pendant l'arbitrage, non prévu par le plan initial : `chrono()`
(`consultation/[id]/page.tsx:931-934`) affiche `maintenant` tant que `endedAt===null` — sur une
séance close avec `ended_at NULL`, le chrono continuerait de tourner à l'écran et
reproduirait EXACTEMENT le symptôme corrigé. **Correctif ajouté au périmètre de V1.3e** : figer
l'affichage sur tout `status==='closed'`, avec la durée réelle si `endedAt` existe, sinon la
mention « durée inconnue » — jamais un chiffre qui continue de courir sur une séance fermée.

**Step 10-11 — migration 032, PLUSIEURS passes de revue security-reviewer, PAS ENCORE APPLIQUÉE.**
⚠️ Nombre de passes délibérément non compté ici en toutes lettres — un chiffre écrit à un
endroit et jamais mis à jour à un autre a déjà causé une contradiction interne détectée en
revue. Le détail complet, dans l'ordre, est ci-dessous ; c'est lui qui fait foi, pas un total.
⚠️ **Note sur l'étiquetage** : les labels `v1`…`v4` ci-dessous désignent des versions RÉÉCRITES
du fichier. À partir de `v4`, l'étiquetage change de nature : les entrées suivantes sont des
PASSES DE REVUE sur cette même v4 (« v4 → 4ᵉ revue », « v4 → 5ᵉ revue », etc.), pas de nouvelles
réécritures numérotées — il n'existe donc délibérément aucune entrée « v5 » : ce n'est pas un
trou, c'est un changement de convention à cet endroit précis, qui reste ainsi jusqu'à la fin.
- **v1** : 5 ROUGE trouvés — pas de plancher sur `p_threshold` (RPC exposé, fermait une
  séance vivante) · pas de transition `appointments.status='completed'` en miroir de
  `close_consultation` (l'agenda serait resté « En séance » indéfiniment) · fenêtre glissante
  `now() - 12h` au lieu d'une clôture datée sur l'id réel · commentaire sur-déclarant une trace
  d'audit attribuée alors que `actor_id`/`actor_role` sont NULL sous le rôle de migration ·
  numérotation 031/032 non documentée.
- **v2** : les 5 corrigés (plancher `GREATEST`, transition rendez-vous miroir de la fonction
  `app.close_consultation` de 026 — 026 n'a pas de sections numérotées, un renvoi antérieur
  « §4 » était orphelin et a été retiré partout, y compris dans la migration —, id
  épinglé `1c4ea86f-e432-4693-b615-130af53d665d` trouvé par l'inventaire Step 08, commentaire
  honnête sur l'attribution NULL, numérotation documentée). Re-revue : les 5 confirmés fermés,
  MAIS 2 NOUVEAUX ROUGE trouvés — `GRANT EXECUTE TO authenticated` sur une fonction qu'aucun
  service TypeScript n'appelle (chemin d'écriture irréversible exposé au navigateur pour rien) ·
  la garde « ligne introuvable » et la garde « déjà close » utilisaient la même branche
  silencieuse, un `id` absent (mauvaise base/faute de frappe) aurait inscrit `032` comme
  appliquée sans avoir rien corrigé.
- **v3** : GRANT à `authenticated` retiré (seul `REVOKE ALL FROM PUBLIC` reste — un script de
  maintenance futur se connecte par `DATABASE_URL`, décrit à ce stade comme « superutilisateur »
  — **FAUX, voir la mesure de 019 citée plus bas : `rolsuper=false`, `rolbypassrls=true`** —
  sans besoin du GRANT) ·
  `RAISE NOTICE` → `RAISE WARNING` sur « introuvable », avec commentaire explicite que le vert
  du checkpoint ne prouve PAS que la ligne cible a été corrigée sur la base réelle — cette
  preuve est une vérification externe, après application, hors de la transaction (`RAISE
  EXCEPTION` écarté : casserait le replay Docker sur toute base qui n'est pas exactement celle
  du 2026-08-10, y compris la future instance auto-hébergée). Troisième revue en cours.
- **v3 → 3ᵉ revue : 3 NOUVEAUX ROUGE**, tous dans la partie DEVENUE ad hoc du fichier — (1) le
  commentaire affirmait une vérification post-application « faite … (STATE.md, Step 12) » qui
  n'a JAMAIS eu lieu (`grep "Step 12" STATE.md` → 0) ; (2) `RAISE WARNING` est en pratique aussi
  invisible que le `NOTICE` qu'il remplaçait — le seul chemin d'application du dépôt
  (`scripts/db-migrate.sh:158-167`) capture toute la sortie `psql` et ne l'affiche QUE si le
  code de sortie est non nul, ce qu'un `WARNING` ne déclenche jamais ; (3) **sérieux** — sous
  `FORCE ROW LEVEL SECURITY` (007), aucune policy ne couvre un rôle sans `BYPASSRLS`/statut
  superutilisateur, hypothèse jamais vérifiée dans ce dépôt ; si fausse, le bloc `DO` aurait fait
  un `UPDATE` de 0 ligne SILENCIEUSEMENT puis `COMMIT`, inscrivant `032` comme appliquée sans
  avoir rien corrigé. Recommandation de la revue, retenue : **le geste ponctuel (id de
  production) n'a pas sa place dans un fichier dont le contrat est « rejouable sur n'importe
  quelle base » — le sortir entièrement résout les trois ROUGE ensemble.**
- **v4 — RÉÉCRITURE.** Le bloc `DO` ad hoc (fermeture de l'id `1c4ea86f-…`) est **retiré de la
  migration, IDENTIFIANT INCLUS** — une migration doit être rejouable sur n'importe quelle base ;
  un id de production n'y a plus sa place, portable ou non. `032` ne contient plus que le
  garde-fou portable (`app.close_stale_consultations`, `REVOKE`, `INSERT INTO schema_migrations`).
- **⚠️ Écart au plan initial, décision explicite prise en session (pas un contournement) :**
  automatiser le geste ponctuel par un script exécuté par l'agent (`scripts/close-orphan-*.sh`,
  prévu au plan) a été **refusé par le classificateur de permissions de la session** — une
  écriture non supervisée sur une donnée réelle de production. Décision saine, reprise plutôt que
  contournée (CLAUDE.md, « Exécuter des actions avec soin »). **Le geste devient MANUEL**, et sa
  procédure exacte vit **ICI, dans STATE.md, PAS dans la migration** — voir §"GESTE MANUEL" ci-dessous.
- **v4 → 4ᵉ revue : 4 NOUVEAUX ROUGE**, aucun dans le mécanisme lui-même — tous dans la
  cohérence documentaire du périmètre réduit : (1) le fichier affirmait `hors du problème FORCE
  RLS` pour le rôle `DATABASE_URL`, FAUX — `FORCE` soumet le PROPRIÉTAIRE aux policies mais pas
  un rôle `SUPERUSER`/`BYPASSRLS`, qui échappent à la RLS par définition ; (2) l'UUID de
  production restait présent 3× dans le fichier alors qu'une ligne affirmait juste au-dessus
  « aucun identifiant de production » ; (3) **sérieux** — le commentaire de
  `close_stale_consultations` décrivait un scoping par praticienne/cabinet via la RLS de 007
  « comme `close_consultation` », FAUX sous le SEUL chemin d'invocation documenté
  (`DATABASE_URL`, décrit à ce stade comme « superutilisateur » — **FAUX, même mesure de 019** :
  c'est `rolbypassrls=true`, pas `rolsuper`, qui échappe à la RLS) : ce rôle échappe à la RLS,
  donc la fonction balaie EN RÉALITÉ toutes les séances orphelines de TOUS les cabinets —
  comportement assumé, mais que le commentaire décrivait à l'envers ; (4) deux renvois de
  section cassés (`§2 ci-dessous` inexistant,
  `§1` = auto-référence circulaire) laissés par le retrait du bloc `DO`.
- **v4 → CORRIGÉ (partiellement — voir 5ᵉ revue ci-dessous)** : (2) l'UUID a été retiré du
  fichier ; (4) numérotation de section supprimée, renvois corrigés.
- **v4 → 5ᵉ revue : 4 NOUVEAUX ROUGE**, dont DEUX nés des corrections de la 4ᵉ passe elle-même —
  (1) **sérieux** : la reformulation « SUPERUSER ou BYPASSRLS » restait une hypothèse non
  vérifiée présentée comme un fait, alors que `019_revert_definer_doors.sql` a DÉJÀ MESURÉ, sur
  cette base, que `postgres` (le rôle de `DATABASE_URL`) a `rolsuper=false` MAIS
  `rolbypassrls=true` — la migration citait un statut « superutilisateur » que 019 réfute
  explicitement pour ce rôle ; (2) le `COMMENT ON FUNCTION` affirmait que la fonction est
  « appelée UNIQUEMENT via » la procédure manuelle de `STATE.md` — FAUX : cette procédure
  n'appelle jamais cette fonction, elle écrit directement sur un UUID unique ; les deux gestes
  n'ont aucun rapport d'exécution ; (3) l'affirmation « toute référence à un «script» a été
  retirée du fichier » (ligne 129 précédente, corrigée ci-dessous) était fausse : 5 occurrences
  subsistent, légitimement — elles décrivent un futur script de MAINTENANCE hypothétique qui
  pourrait un jour appeler `close_stale_consultations`, un concept distinct du script
  d'automatisation du geste ponctuel qui, lui, a bien été abandonné ; (4) le post-check de la
  procédure manuelle (étape 3) ne relisait que `app.consultations`, jamais `app.appointments` —
  or c'est la transition de CETTE dernière table qui est irréversible (`022`, `'completed'`
  terminal), pas celle de `consultations`.
- **v4 → CORRIGÉ à nouveau** : (1) le commentaire cite maintenant la mesure de 019
  (`rolsuper=f`, `rolbypassrls=t`) au lieu d'une hypothèse à deux branches ; (2) le
  `COMMENT ON FUNCTION` explicite qu'aucun appelant actuel n'existe (`grep` → 0) et distingue
  clairement cette fonction du geste manuel, sans lien d'exécution entre les deux ; (3) cette
  ligne (celle que tu lis) remplace l'affirmation fausse — les références à un script de
  maintenance FUTUR restent, à raison ; (4) le post-check de la procédure manuelle ci-dessous
  inclut désormais `app.appointments`.
- **v4 → 6ᵉ revue : 5 NOUVEAUX ROUGE**, tous des résidus de copier-coller laissés par la
  correction précédente — le mot « superutilisateur » réfuté dans un bloc restait présent, mot
  pour mot, dans deux autres blocs du même fichier (l'en-tête et le commentaire `REVOKE`) ; le
  décompte de ROUGE par passe, écrit dans l'en-tête de la migration, ne correspondait plus au
  détail réel documenté ici ; et CETTE section — « GESTE MANUEL » — affirmait encore
  « NON EXÉCUTÉ » et « superutilisateur » alors que la confirmation ✅ plus bas dans le même
  fichier disait l'inverse. **Corrigé : le mot erroné est purgé partout dans `032` (l'en-tête
  cite désormais 019 une seule fois, comme référence unique) ; l'en-tête de `032` ne porte plus
  de décompte de ROUGE par passe — ce fichier-ci (STATE.md) reste la seule source ; cette
  section reflète maintenant l'état réel : geste exécuté et confirmé.**
- **v4 → 7ᵉ revue : 6 NOUVEAUX ROUGE**, presque tous des résidus de bookkeeping documentaire —
  le décompte de ROUGE que la correction précédente disait avoir retiré de `032` s'y trouvait
  encore (l'en-tête l'annonçait retiré tout en le portant lui-même) ; le mot « superutilisateur »
  réfuté à un endroit survivait, non réfuté sur place, à deux autres (`032`, ligne de l'en-tête
  et du `REVOKE`) ; le titre de cette section STATE.md (« TROIS passes ») contredisait le
  décompte réel documenté juste en dessous ; un renvoi `026 §4` s'est révélé orphelin — 026 n'a
  aucune section numérotée ; et **la ligne « ✅ EXÉCUTÉ ET CONFIRMÉ » de la section GESTE MANUEL
  sur-déclarait par omission** : elle ne portait pas la réserve sur `app.appointments`, présente
  seulement 60 lignes plus bas.
- **CORRIGÉ** : `032` a été RÉÉCRIT pour ne plus porter de décompte de ROUGE par passe ni de
  label « ROUGE N de la Xᵉ revue » nulle part — y compris dans `COMMENT ON FUNCTION`, qui les
  aurait persistés dans `pg_description` au-delà de toute future correction de ce fichier
  source. Ce document (STATE.md) reste la SEULE source de l'historique de revue, précisément
  parce qu'il n'est ni exécuté ni persisté en base — voir `DOC-AUTHORITY.md` §1 : « STATE.md —
  périssable, jamais normatif ». Le renvoi `026 §4` est remplacé par une désignation de
  fonction. Le titre de cette section ci-dessus ne porte plus de nombre. La ligne
  « ✅ EXÉCUTÉ ET CONFIRMÉ » de GESTE MANUEL porte désormais sa réserve directement.
- **v4 → 8ᵉ revue : 4 NOUVEAUX ROUGE** — un RÉEL dans le SQL exécutable (`REVOKE ALL … FROM
  PUBLIC` ne révoque rien d'un GRANT déjà accordé à un autre rôle, et `CREATE OR REPLACE
  FUNCTION` préserve les GRANT existants : rejouer ce fichier sur une base ayant un jour reçu
  `GRANT EXECUTE TO authenticated` par une version antérieure n'aurait pas retiré ce GRANT) ;
  trois documentaires (l'en-tête citait `SPRINT-V1.md §V1.3` en laissant croire à une conformité
  totale du checklist alors qu'une ligne — la clôture par migration datée — n'est pas remplie
  littéralement ; la toute première ligne de CE document contredisait son propre corps 22 lignes
  plus bas ; la chaîne de labels de version sautait de « v4 » à « v6 » sans « v5 »).
  **CORRIGÉ** : `REVOKE` cible désormais explicitement `FROM PUBLIC, authenticated` ; un
  paragraphe honnête sur la portée réelle du checklist a été ajouté en tête de `032` ; l'en-tête
  de ce document reflète l'état réel ; les labels « v6 » ont été renommés « v4 → 6ᵉ/7ᵉ revue ».
- **v4 → 9ᵉ revue : 3 NOUVEAUX ROUGE**, tous des résidus — DONT UN INTRODUIT PAR LA CORRECTION DE
  LA 8ᵉ PASSE ELLE-MÊME (le paragraphe ajouté affirmait que le checklist était « rempli par un
  geste équivalent », alors que le geste manuel a rendu ZÉRO ligne modifiée : la consultation
  était déjà dans l'état visé, par une cause NON tracée — ce n'est pas un geste équivalent, c'est
  un état constaté sans preuve de origine) ; deux citations de `REVOKE ALL … FROM PUBLIC` dans
  des commentaires n'avaient pas suivi l'ajout de `authenticated` à l'instruction réelle, dont
  une persistée dans `COMMENT ON FUNCTION` — exactement le mécanisme que la refonte de la 8ᵉ
  passe prétendait avoir éliminé. **Corrigé** : le paragraphe ne prétend plus qu'un geste
  équivalent a rempli la case ; il dit que l'état constaté correspond au résultat visé SANS
  preuve de cause, et que la case reste non cochée à la lettre. Les deux citations de `REVOKE`
  suivent maintenant l'instruction réelle.
- **Constat après 9 passes** : le corps SQL exécutable de `032` est VERT depuis la 4ᵉ passe et
  reconfirmé indépendamment par les passes 8 et 9. Les passes 5 à 9 n'ont trouvé QUE des défauts
  de commentaire/documentation — dont plusieurs introduits par la correction de la passe
  précédente. Décision : ARRÊT de la boucle de revue automatique sur ce fichier après la 9ᵉ
  passe. Toute correction documentaire résiduelle future se fait à la prochaine relecture
  humaine, pas par une 10ᵉ passe automatisée.
- **🔴 BLOCAGE DÉCOUVERT AU STEP 12, porte G3 — `031` EST DANS `supabase/migrations/`.**
  En lançant `scripts/verify-migrations.sh` (statique, lecture seule) avant le replay Docker,
  contrôle 3 est sorti ROUGE : 29 `SECURITY DEFINER` pour 26 `search_path`. **Faux positif**,
  vérifié à la main : les 26 déclarations réelles portent toutes leur `search_path` ; les 3
  surnuméraires sont des occurrences du texte « SECURITY DEFINER » **à l'intérieur de littéraux
  SQL** dans les `COMMENT ON FUNCTION` de `030` (l. 647, 758, 824). C'est le piège que l'en-tête
  du script dit avoir fermé pour les commentaires `--`, rouvert par un autre chemin depuis S7b.
  **Corrigé** dans `scripts/verify-migrations.sh` : le contrôle 3 dépouille désormais aussi les
  littéraux, sur une copie séparée — surtout PAS globalement, le contrôle 6 cherche des NOMS qui
  vivent précisément dans les littéraux des `INSERT` de seed (c'est lui qui a trouvé l'identité
  réelle dans `015`). Contrôle 3 : VERT (26/26).
  **Ce faux positif en masquait un vrai** : le contrôle 5 sort maintenant ROUGE sur
  `031_seed_document_templates` — « n'enregistre pas sa version ». Vérification directe :
  ```
  ls supabase/migrations/ | grep 031  →  031_seed_document_templates.sql   (IL EST LÀ)
  ls docs/ | grep 031                 →  (rien)
  git status                          →  ?? supabase/migrations/031_...    (non suivi)
  git log (les deux chemins)          →  aucun commit
  ```
  L'en-tête de `032` affirmait exactement le contraire (« vit HORS de `supabase/migrations/` »),
  et **deux passes de revue adversariale l'ont "confirmé" en prétendant avoir exécuté ce `ls`**.
  Elles ne l'avaient pas fait. Corrigé dans `032`, avec la preuve rejouée.
  **Conséquence réelle, et c'est elle le blocage :** `031` est du périmètre **V6** (seed des 4
  modèles de certificats), porte `BEGIN;`/`COMMIT;` mais **n'inscrit pas sa version** et son
  `INSERT INTO app.document_templates` (031:61) **n'a aucun `ON CONFLICT`**. `db-migrate.sh`
  applique `ls migrations/*.sql | sort` en sautant ce qui est déjà inscrit → `031` serait
  **réappliqué à chaque exécution**, redéposant ses 4 modèles à chaque fois, et il se trie
  **AVANT** `032`. Lancer `db-migrate.sh` pour appliquer `032` entraînerait donc `031` avec lui.
  **➜ `db-migrate.sh` N'A PAS ÉTÉ LANCÉ tant que le blocage tenait.**
- **⚠️ 2026-08-11 — LE DÉPLACEMENT DE `031` A DÛ ÊTRE REFAIT. La ligne « BLOCAGE LEVÉ » du
  2026-08-10 ci-dessous décrivait un état que le disque ne portait plus.**
  En relançant `verify-migrations.sh` en fin de session V1.5 — par principe, pas sur un
  soupçon — le contrôle 5 est ressorti **ROUGE** (« `031_seed_document_templates` n'enregistre
  pas sa version »). Vérification directe, commandes réellement exécutées :
  ```
  ls supabase/migrations/ | grep 031  →  031_seed_document_templates.sql   (IL ÉTAIT REVENU)
  ls docs/ | grep 031                 →  (rien)
  ```
  Le fichier était **de retour dans `supabase/migrations/`** et absent de `docs/` : déplacement
  jamais abouti, ou défait depuis. La cause exacte n'est pas établie et n'a pas été cherchée
  (hors périmètre V1) ; seul le fait observable a été inscrit.
  **RÉTABLI le 2026-08-11 par l'utilisateur.** Contre-vérification par l'agent, commandes
  relancées et sorties lues, jamais supposées :
  ```
  ls supabase/migrations/ | grep 031  →  (rien)
  ls -l docs/ | grep 031              →  031_seed_document_templates.sql   10429 octets
  git status --porcelain | grep 031   →  ?? docs/031_seed_document_templates.sql
  bash scripts/verify-migrations.sh   →  VERT 6/6, contrôle 5 inclus
  ```
  **10429 octets, soit la taille exacte relevée au 2026-08-10 : aucun octet modifié.** Le
  fichier reste non suivi par git, avant comme après — c'est V6 qui le reprendra (inscription
  de version + `ON CONFLICT`).
  **➜ La leçon, et c'est elle qui vaut d'être relue :** un état de fichier écrit dans `STATE.md`
  n'est pas une garantie, c'est un relevé daté. Celui-ci a cessé d'être vrai entre deux
  sessions **sans que rien ne le signale**. La porte qui l'a rattrapé est
  `verify-migrations.sh`, lancée systématiquement — pas la relecture du document.
- **✅ BLOCAGE LEVÉ — arbitrage utilisateur, 2026-08-10 : `031` sorti de `supabase/migrations/`.**
  Déplacé vers `docs/031_seed_document_templates.sql` (emplacement que `032` croyait déjà être le
  sien), **sans modification d'un seul octet** (10429 avant et après), fichier non suivi par git
  avant comme après, aucun écrasement (la cible n'existait pas — vérifié avant le `mv`). V6 le
  reprendra et le corrigera (inscription de version + `ON CONFLICT`) ; ce n'est pas du travail V1.
  **`scripts/verify-migrations.sh` → VERT sur les 6 contrôles** : « le corpus peut être appliqué ».
  L'en-tête de `032` porte désormais l'histoire réelle (il a été dans `migrations/`, il a été
  déplacé, deux revues ont affirmé le contraire à tort), pas seulement l'état final.
**Step 12 — REPLAY DOCKER + VÉRIFICATION COMPORTEMENTALE : VERT.** Base `v1fresh` neuve et
dédiée, créée dans le conteneur de dev local (`supabase_db_Final_Mindcare`), schéma `auth`
recopié, **jamais la base de production, jamais la base `postgres` du conteneur** ; supprimée
après les tests. Rejeu **001→032 = 31 migrations, 0 erreur, 31 inscrites** dans
`app.schema_migrations`.

Contrôles de la fonction `app.close_stale_consultations`, **mesurés, pas déduits** :
```
prosecdef = f                          → SECURITY INVOKER confirmé (pas DEFINER)
ACL = postgres=X/postgres              → AUCUN grant à authenticated/anon/PUBLIC
SET ROLE anon         → appel         → ERROR: permission denied for function
SET ROLE authenticated→ appel         → ERROR: permission denied for function
SET ROLE service_role → appel         → ERROR: permission denied for function
```
`anon` et `service_role` sont refusés **alors que le `REVOKE` ne cite que `PUBLIC,
authenticated`** : ils n'avaient d'accès que PAR `PUBLIC`, révoqué. La réserve de la 9ᵉ revue
(« la convention du dépôt est `PUBLIC, anon, authenticated, service_role` ») est donc close
empiriquement : aucun trou.

Test comportemental sur 2 séances synthétiques (`is_synthetic=true`) — A orpheline
(`practitioner`, `started_at` = −5 jours), B vivante (`owner`, −2 minutes) :
```
APPEL HOSTILE close_stale_consultations(interval '0 seconds')
  → ferme A (0000c001) uniquement ; B reste 'open'     ← LE PLANCHER 12 h TIENT
  → A : status='closed', ended_at IS NULL              ← OPTION C, aucune durée inventée
  → 2 lignes avant, 2 lignes après                     ← RÈGLE 3, aucun DELETE
2ᵉ appel immédiat                → 0 ligne             ← IDEMPOTENTE
close_stale_consultations(NULL)  → 0 ligne             ← plancher tient sur NULL
close_stale_consultations('-99 days') → 0 ligne        ← plancher tient sur négatif
audit.log (table_name='consultations') → 3 lignes      ← RÈGLE 5, trg_audit a bien tracé
```
La séance vivante a survécu aux **trois** arguments hostiles. Le ROUGE 1 de la 1ʳᵉ revue
(plancher absent, fermait une séance vivante) est prouvé fermé — plus seulement affirmé.

**✅ PORTE G3 FRANCHIE** : corpus statique VERT (6/6), rejeu 001→032 VERT, RLS/ACL vérifiée aux
3 rôles Postgres, aucune suppression, migration rejouable sans effet second. Reste hors G3 et
non bloquant : la relecture seule de `app.appointments` pour le geste manuel (ci-dessous).

### GESTE MANUEL — fermeture de la consultation orpheline (2026-08-10)

**✅ EXÉCUTÉ ET CONFIRMÉ POUR `app.consultations`, 2026-08-10 — ⚠️ `app.appointments` NON
recontrôlé** (lecture seule, non bloquant, détail en fin de section : ne pas lire cette ligne
comme une confirmation des DEUX tables touchées par la procédure). Résultat complet du
post-check en fin de section. Procédure lancée par l'utilisateur contre Supabase Cloud (psql,
ou l'éditeur SQL du Dashboard),
connecté avec le rôle `postgres` (`DATABASE_URL`, comme `scripts/db-migrate.sh`) — propriétaire
du schéma, `rolsuper=false`, `rolbypassrls=true` (mesuré par `019_revert_definer_doors.sql:13-14`,
PAS superutilisateur). Ce geste vit ICI et seulement ici — `032_close_orphan_consultations.sql` n'en contient et n'en
connaît rien, par choix (revue adversariale, 3ᵉ passe, voir plus haut).

Cible : consultation `1c4ea86f-e432-4693-b615-130af53d665d`, trouvée par l'inventaire lecture
seule du Step 08 (`started_at` 2026-08-04 14:48:20 UTC, `status='open'`, `appointment_id` non
NULL) — la séance orpheline à l'origine du symptôme `125:44:26`.

**1. Pré-lecture** — confirmer l'état avant toute écriture :
```sql
SELECT status, appointment_id, started_at
  FROM app.consultations
 WHERE id = '1c4ea86f-e432-4693-b615-130af53d665d';
```
Attendu : `status = 'open'`. Si déjà `'closed'` → rien à faire, ne pas continuer. Si aucune ligne
→ mauvaise base, ne pas continuer.

**2. Écriture** — une seule transaction, `ended_at` délibérément absent (option C, porte G2 —
ne jamais inventer une durée clinique) :
```sql
BEGIN;

UPDATE app.consultations
   SET status = 'closed'
 WHERE id = '1c4ea86f-e432-4693-b615-130af53d665d'
   AND status = 'open';

UPDATE app.appointments a
   SET status = 'completed', updated_at = now()
  FROM app.consultations c
 WHERE c.id = '1c4ea86f-e432-4693-b615-130af53d665d'
   AND a.id = c.appointment_id
   AND a.status NOT IN ('completed', 'cancelled');

COMMIT;
```

**3. Post-vérification** — LA preuve, jamais une supposition. ⚠️ **Corrigée au 5ᵉ passage de
revue** : la version précédente ne relisait que `app.consultations` — or la SEULE écriture
IRRÉVERSIBLE de la transaction est celle sur `app.appointments` (`022`, `'completed'` est un
état TERMINAL, `trg_appt_transition` refuse tout retour arrière). Le post-check doit couvrir
les deux tables que l'étape 2 a touchées :
```sql
SELECT c.status AS consultation_status, c.ended_at,
       a.status AS appointment_status
  FROM app.consultations c
  LEFT JOIN app.appointments a ON a.id = c.appointment_id
 WHERE c.id = '1c4ea86f-e432-4693-b615-130af53d665d';
```
Attendu : `consultation_status = 'closed'`, `ended_at` NULL, `appointment_status = 'completed'`
(ou `'cancelled'` si déjà annulé avant ce geste — jamais `NULL` si un `appointment_id` existe).
Si `consultation_status` reste `'open'` : l'écriture n'a pas pris — vérifier que la connexion
est bien le rôle `postgres`/`DATABASE_URL` (`rolbypassrls=true`, mesuré par
`019_revert_definer_doors.sql`), pas une session `authenticated` (RLS `FORCE` sur
`app.consultations`, 007). Si `ended_at` est renseigné : une durée a été inventée quelque
part — ne PAS continuer, violation de la règle 8.

**Résultat du post-check : ✅ CONFIRMÉ, 2026-08-10, par l'utilisateur, POUR `app.consultations`.**
Sur Supabase Cloud, `status='closed'`, `ended_at` NULL, sur `1c4ea86f-e432-4693-b615-130af53d665d`.
**Étape 2 (écriture) n'a rendu AUCUNE ligne modifiée** : la consultation était déjà dans l'état
final attendu au moment de l'exécution — cohérent avec le branchement « déjà `'closed'` → ne
rien faire » prévu à l'étape 1 de cette procédure (une double exécution, ou une fermeture
antérieure hors de cette procédure, ne réécrit rien).
⚠️ **`app.appointments` non explicitement recontrôlé lors de cette confirmation** — la requête
ci-dessus (avec la jointure) n'a pas encore été relancée. Puisqu'aucune écriture n'a eu lieu sur
`app.consultations` (déjà `'closed'`), le rendez-vous associé était très probablement déjà
`'completed'`/`'cancelled'` par un chemin antérieur légitime (ex. `close_consultation` normal) —
mais ce n'est PAS vérifié, seulement plausible. Lecture seule, non bloquante, à faire dès que
commode : **ne referme pas cette ligne tant que le résultat n'est pas collé ici.**
**Le geste ponctuel (côté `consultations`) est clos.**

## Fait & vert
- S1-S4 (schéma 001→025, agenda, couche `DbPort`, suite complète) — VERT · checkpoint-s4 VERT 25, checkpoint-adr019 VERT 24
- S5 écran séance et note clinique sur migration 026 (9 portes) — build, typecheck, lint tous VERT · checkpoint-s5 VERT 11 · commit 07cc371 "fix(consultation): entrée visible" (2026-08-04)
- **S6 CLOS le 2026-08-05** — `analyze_session` fonctionnel de bout en bout, RLS vérifiée aux 3 rôles à chaque couche (SQL direct ET HTTP à travers la passerelle), `DEFAULT_MODEL = google/gemini-2.5-flash`. Trois défauts réels trouvés et corrigés en vérification locale Docker. Voir historique complet plus bas pour le détail.
- **S7a CLOS le 2026-08-08** — migration 029 (4 portes finances + `next_number`) + finance.ts + écran recettes · checkpoint-s7 VERT 32 contrôles (001→029 rejeu complet, 22 contrôles métier, 3 portes CLAUDE.md, 4 statiques) · 3 défauts réels trouvés et corrigés · 5 commits · 45814cd
- **S7b PHASE 1 livrée le 2026-08-09 — jalon NON CLOS.** Migration 030 (portes
  `issue_document`/`get_document`/`list_patient_documents`/`mark_document_printed`,
  moteur de rendu SQL + échappement, verrouillage de table par trigger) +
  `documents.ts` + `checkpoint-s7b.sh` · **VERT 30 contrôles** (001→030 rejeu
  complet, 19 contrôles du contrat gelé + 4 ajouts trouvés en revue, 3 portes
  CLAUDE.md, 4 statiques). **8 défauts réels trouvés et corrigés** sur trois
  passes de revue adversariale (voir « Défauts trouvés à l'implémentation »,
  `docs/S7B-DOCUMENTS.md`) : lecture non auditée de `app.patients`, RPC public
  exposant l'identité sans trace, table écrivable en direct malgré l'absence de
  portes update/delete, asymétrie owner/assistant manquante, séance d'un autre
  patient rattachable, valeurs de variables vides/nulles acceptées, fuseau
  horaire du numéro de document (UTC serveur au lieu d'Alger),
  `is_synthetic` absent des colonnes protégées par trigger. **Aucun modèle
  semé, aucune fonte câblée, aucun écran livré** — B1.1→B1.5 restent absents du
  disque. **Seul le contrôle papier (§B7) clôt S7b, et il reste inexécutable.**

## Décisions de session S7a (à verser au 00-DECISIONS.md)
12. **2026-08-08 : `checkpoint-s7.sh` accède à la base par `docker exec` sur le
    conteneur de `supabase start`**, pas par le conteneur jetable `postgres:15` de
    `scripts/lib/dburl.sh` (Docker Hub toujours injoignable sur ce réseau). Décision
    utilisateur explicite. Débloque aussi potentiellement checkpoint-s5/adr019/jarvis
    — non revérifiés cette session, à faire séparément.
13. **2026-08-08 : les contrôles de concurrence (19/20/21) sont joués pour de vrai**,
    deux sessions psql simultanées via FIFO/coproc, verrou mesuré par un délai
    bloquant — pas deux appels séquentiels. Décision utilisateur explicite.
14. **2026-08-08 : ajout au contrat gelé `docs/S7A-FINANCE.md`, remonté avant codage**
    (comme le contrat l'exige lui-même) : porte `app.get_consultation_payment`
    (029 §2bis), nécessaire pour que le bloc de tarif en fin de séance affiche un
    tarif déjà fixé sans journaliser une fausse lecture à chaque ouverture d'écran.
    Additive, INVOKER, ne nomme personne, aucune permission nouvelle.

## En cours
**S7b phase 2** reste bloquée sur les actifs B1.1→B1.5 (scan de l'en-tête, arbitrage
« Psychiatrie », logo SVG, 7 fontes `.woff2`, contenu des 4 modèles de certificat) —
inchangé. La phase 1 (mécanique) est livrée et vérifiée ; restent : câblage des
fontes, seed des modèles, aperçu A4, écran d'émission, liste au dossier patient, et
le contrôle papier qui seul clôt le jalon.

## Dette assumée, datée (inchangée depuis S6, reportée telle quelle)
- **🆕 2026-08-11 — preuve numérique de `06-PERF-BUDGET.md` : les 15 relevés (5 écrans × appels
  réseau / premier contenu / complet) ne sont pas faits.** Différés par décision utilisateur
  (réactivité jugée acceptable à l'usage). **Aucun chiffre n'est affirmé.** Sortie : un relevé
  en navigateur, `pnpm build && pnpm start`, 3×, médiane. Échéance : **porte de livraison**, au
  plus tard — un budget de performance jamais mesuré n'est pas un budget.
  ⚠️ `DOC-AUTHORITY.md` §4 dit « une dette non écrite ici n'existe pas », et cette dette n'y
  est PAS : elle est ici, dans un document de rang 6. **Y porter une ligne demande une main
  humaine** — un agent ne modifie pas un document d'autorité.
- S5 §7 on-screen matrix → avant 2026-08-10, toujours bloqué (pas de navigateur)
- `audit.boundary_crossings` non confirmé en écriture (réseau Docker local)
- `checkpoint-s5.sh`/`checkpoint-adr019.sh`/`checkpoint-jarvis.sh` — la décision 12
  ci-dessus (docker exec) les débloque potentiellement, à revérifier
- Vérification d'écran S6 — pas de navigateur dans cet environnement

## En litige — voir WORKING-CONTEXT.md §7
**Q-D CLOSE** (2026-08-03, ADR-019 opérationnelle). **Q-A/Q-B/Q-C** référencées §8 de WORKING-CONTEXT — toutes en ADRs, aucune nouvelle question ouverte.
**Nota:** WORKING-CONTEXT.md §0 mentionne docs 05-BUILD-PLAN et 06 (inexistants sur disque) — l'autorité est en retard.

---

## Trois défauts réels trouvés et corrigés en S7a

1. **UUID `E2` malformé dans checkpoint-s7.sh** — test data UUID avait 11 caractères
   hex au lieu de 12. Silencieusement rejeté par `INSERT`, cascadait sur 6 contrôles
   en aval (indisponibilité de consultation pour lecture de tarif). **Corrigé** : UUID
   régénéré `E2AABBCCDDEE`.

2. **Migration 029 — `app.list_day_payments` déclarait pas les variables `v_debut`/`v_fin`.**
   Contrairement à `app.day_revenue` (même porte, mêmes bornes de jour), `list_day_payments`
   utilisait ces variables sans les déclarer — plantait à l'exécution pour owner/practitioner,
   cassant l'écran recettes en production. **Corrigé** : déclaration + calcul ajoutés au
   §3 de 029, même frontière `Africa/Algiers` que `day_revenue`.

3. **Contrôles de concurrence (19/20/21) utilisaient `mkfifo` (named pipes).** Peu fiable
   sous Windows/MSYS + Docker Desktop : lecteur pouvait mourir avant l'écriture, causant
   SIGPIPE qui tuait le **script entier** (code 141) au lieu de faire échouer le seul contrôle.
   **Corrigé** : remplacé par `coproc` (pipes anonymes gérés par bash). Ajouté `trap '' PIPE`
   en filet de sécurité. Plus robuste et conforme à l'intention documentée en tête de script.

**Détail supplémentaire :** `scripts/preflight.sh` scannait `.kilo/node_modules/` (outil
local, gitignoré) et remontait faux positifs sur le contrôle « hex en dur hors tokens ».
Exclu du `find`, comme `node_modules/`/`.git/`/`.next/`.

---

## Historique S1-S6 détaillé (conservé pour référence)

### Trois défauts réels trouvés en vérification locale S6, tous corrigés
1. **Migration 027 — `ALTER FUNCTION ... OWNER TO app_gatekeeper` en 42501.**
   `ALTER ... OWNER TO` exige que le NOUVEAU propriétaire ait `CREATE` sur le
   schéma. 026 §3 accorde ce privilège PUIS le retire à son §8, dans SA PROPRE
   transaction. 027 est une migration séparée : sans son propre GRANT/REVOKE,
   elle hérite d'un rôle déjà refermé. **Corrigé : §0/§3 ajoutés à 027**, et le
   même motif a été appliqué dès l'écriture de 029 cette session (§0/§6).
2. **`external-call.ts` sans `max_tokens`** — corrigé, `MAX_OUTPUT_TOKENS = 2000`.
3. **`index.ts` — clôture Markdown non retirée avant `JSON.parse`** — corrigé,
   `retirerCloture()`.

### Preuve RLS — les 3 rôles, `app.get_previous_note`, en base réelle et via HTTP
owner a1 → accès complet ; practitioner a2 et assistant a3 → même refus générique,
indiscernable d'un `consultationId` inexistant. Prouvé en SQL direct ET à travers
`jarvis-analyze-session` en HTTP réel.

### Portes & regressions (dernière vérification directe S6)
`preflight` ✓ · `typecheck` ✓ · `lint` ✓ · `build` ✓. La couche sécurité est gelée :
ADR-019 tient sur `app_gatekeeper` sans `BYPASSRLS`, membre `authenticated` avec
`INHERIT TRUE`, propriétaire des portes 004/007/008/026/027/**029 (day_revenue,
list_day_payments)**. Y toucher casse la cloison.

### Décisions de session S1-S6 (récapitulatif, voir git log pour le détail complet)
1-11 : nom du fichier gateway, S6 = Edge Function Deno, scope S6 resserré à
`analyze_session` seul, Docker/psql redevenus disponibles (Docker Hub reste
injoignable), `DEFAULT_MODEL = gemini-2.5-flash`, S6 clos malgré 3 dettes, S7
découpé en S7a/S7b, l'assistante n'encaisse pas au mois 1, recette cloisonnée en
base, notification payment_due écrite dès S7a, 5 renforcements d'ingénierie
(transaction, verrous FOR UPDATE, trace financière via trg_audit, temps serveur,
contrat de performance).
