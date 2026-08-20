# STATE — MindCare OS
**V3 — DESIGN v2 · PORTE VERTE, NON COMMITÉ · `checkpoint-v3.sh` exit 0**
Dernière mise à jour : 2026-08-20

---

## ✅ ÉTAT AU 2026-08-20 — V3 « DESIGN v2 », VERT ET MESURÉ AU NAVIGATEUR

**HEAD `ff1303b`.** L'en-tête précédent de ce fichier décrivait un état ANTÉRIEUR à ce
commit (il annonçait le correctif de fuseau « non commité » alors qu'il l'est) : corrigé
ici. La section V2 ci-dessous reste valable pour tout le reste.

### Verdict brut — `bash scripts/checkpoint-v3.sh`

```
VERDICT V3 : 16 verts · 0 rouges · 0 bloqué critique · 3 bloqués par décision
V3 EST VERT — aux TROIS réserves NOMMÉES, et à elles seules.             (exit 0)
```

**Les deux derniers bloqués ont été levés par la MESURE, pas par décret.** La fenêtre
ADR-016 a été rouverte sur autorisation explicite (`bash scripts/dev-account.sh`,
garde-fou `cloud-dev` vert), et `mesure-v3-navigateur.mjs` pilote désormais un vrai
Chromium EN SESSION AUTHENTIFIÉE :

```
/connexion 7 · / 42 · /patients 42 · /agenda 164 · /finances 44 · /agenda/nouveau 43
337 textes mesurés · 0 sous le plancher · 0 écran NON OBSERVÉ
rail 248px · actif « Patients » avec lueur · orbe --grad-orb · héros --grad-brand
repli < 1024 : rail 72px · Geist réellement appliquée
prefers-reduced-motion : 0 animation vivante
clavier : 4 arrêts dans le rail, 0 sans focus visible, anneau rgb(255,255,255)
```

Preuves : `checkpoints/v3-preuves/` — captures des 6 écrans + `rapport.json`.

⚠️ **RIEN N'EST COMMITÉ.** L'arbre de travail porte V3 en entier.

Verts : preflight · typecheck · lint · build · aucun hex hors `tokens.css` · aucun
`teal-` résiduel · aucun blanc atténué · aucun 4ᵉ dégradé · exactement 3 dégradés
déclarés · union discriminée de `Carte` intacte · `prefers-reduced-motion` déclaré ·
**26 `.woff2` auto-hébergés** · 4 familles câblées · **0 URL Google dans le CSS émis**.

### Ce que V3 a livré

| Lot | État |
|---|---|
| Palette v2 ADR-022 (`--brand-*`, accents, 3 dégradés) | ✅ `teal-` → 0 occurrence |
| Jetons de RÔLE (`--action-*`, `--ai-*`, `--info-*`) au-dessus de la palette | ✅ |
| Fontes `next/font/google`, 4 familles, zéro réseau à l'exécution | ✅ mesuré |
| Rail de navigation signature (`--grad-auth`, état actif, repli en icônes < 1024px) | ✅ **observé** — 248px, repli à 72px |
| Jeu de 16 icônes dessinées à la main + mark du logo, **zéro dépendance** | ✅ |
| `EnTeteEcran` héros + `PastilleIcone` + famille `Carte` à `niveau` | ✅ |
| Orbe Jarvis (`--grad-orb`, `--glow-ai`), état vide composé | ✅ **observé** au navigateur |
| `scripts/checkpoint-v3.sh` + `scripts/mesure-v3-navigateur.mjs` | ✅ |

### 🔴 DÉFAUT RÉEL TROUVÉ EN MESURANT — `--attention` illisible, ANTÉRIEUR À V3

`--attention` (#b8763a) sur `--attention-bg` rend **3.34:1**, sous le plancher de 4.5:1.
Relevé au navigateur sur les cinq écrans à la fois : c'est le titre du bandeau
« Données fictives », **le texte chargé de dire que les dossiers ne sont pas réels**.
Sur blanc il ne fait pas mieux : **3.69:1**. Tous ses usages en TEXTE étaient donc sous
le plancher, depuis `04-DESIGN-SYSTEM`, sans que personne l'ait jamais calculé.

Les deux autres paires sémantiques ont été vérifiées dans la foulée et PASSENT :
`--positive` 4.56:1, `--critical` 5.74:1. L'ambre était seul en cause.

**Corrigé par ajout, pas par modification :** `--attention-ink: #8a5325` (5.67:1 sur
`--attention-bg`, 6.28:1 sur blanc) porte le TEXTE ; `--attention` reste l'ACCENT
(bordure, liseré, point de légende), donc la sémantique clinique d'ADR-022 est
inchangée. Même patron que `--ai-600` face à `--ai-500`.

### 🔴 `--ink-300` N'EST PAS UNE ENCRE DE TEXTE — 2.43:1, 84 fois sur `/agenda`

Trouvé **uniquement parce que la session authentifiée a enfin ouvert l'agenda**. Les
compteurs « 0 séance », le mot « libre » des créneaux vides, et **un nom de
praticienne**. Défaut ANTÉRIEUR à V3 (S4) : l'intention écrite dans le code (« un jour
vide s'efface », « un créneau libre doit se faire oublier ») était juste — mais
s'effacer et devenir illisible ne sont pas la même chose, et à 2.43:1 c'est le second.
Personne ne l'avait calculé, parce qu'un gris clair *a l'air* discret plutôt que cassé.

`--ink-500` (5.70:1) partout où le jeton portait du TEXTE. `--ink-300` garde tous ses
emplois non textuels : filets au survol, pastille de puce, bordure de case, invite de
champ vide. La hiérarchie se fait DANS la plage lisible.

### 🔴 `min-h-0` N'EXISTAIT PAS — une classe inerte, en silence

`tailwind.config.ts` REMPLACE l'échelle `minHeight` par les deux cibles
d'accessibilité. `min-h-0` ne produisait donc **aucune règle CSS** — sans avertissement
de build, sans erreur de type, sans rien. Or `min-height: auto` interdit à un enfant
flex ou grille de descendre sous la hauteur de son contenu : la grille de l'agenda
faisait grandir sa colonne, donc sa rangée, donc **le rail à 1359 px pour une fenêtre
de 1080**, et « Se déconnecter » se retrouvait à 1342 — hors de vue.

Trois correctifs plus naïfs ont échoué avant celui-ci (ancrer le bloc hors du
défilement, `max-h-screen`, `grid-rows-1`) : tous butaient sur la même cause, qu'aucun
ne touchait. **Une classe qui n'existe pas est plus dangereuse qu'une classe fausse :
rien ne la signale.** `0: "0px"` ajouté à l'échelle, avec la raison écrite sur place.

### 🔴 LE RENOMMAGE 1:1 CASSAIT UN CONTRASTE

`--teal-400` → `--brand-400` aurait mis le libellé blanc du bouton de connexion à
≈ 2.2:1 **pendant l'envoi** — lisible au repos, illisible exactement pendant qu'il
annonce « Connexion en cours… ». Deux rampes de clartés différentes ne se mappent pas
au numéro. Passé à `--brand-500`.

### 🔴 LE BLANC ATTÉNUÉ EST IMPOSSIBLE SUR LA MARQUE

Un jeton `--on-brand-muted` a existé le temps d'être mesuré le long de `--grad-brand` :
**4.50:1 à l'arrêt sombre, 2.11:1 au milieu**. Même à 0.85, l'arrêt clair échoue
(4.18:1). Jeton RETIRÉ. *Le contraste d'un texte sur un dégradé varie le long du
dégradé ; le mesurer en un seul point ne prouve rien.* Sur la marque : une seule encre,
le blanc pur — la hiérarchie se fait à la taille et à la graisse.

### ⚠️ DEUX DÉFAUTS DE L'INSTRUMENT, pas du produit

1. **« rail absent » sur un produit intact.** `waitForTimeout` au lieu d'attendre le
   rail : la sonde tombait sur le squelette de chargement, qui ne rend qu'un `<main>`
   nu. La capture prise 200 ms plus tard montrait le rail au complet.
2. **`EXIT=0` faux** en lisant `$?` derrière un `| tail` — c'est le code de `tail`.

### ⚠️ LES PASTILLES « BIENTÔT » CRIAIENT PLUS FORT QUE LES ÉCRANS QUI MARCHENT

Neuf mentions en majuscules grasses sur pastille dominaient la navigation : l'œil y
allait avant d'aller aux trois écrans utilisables. Contresens exact de la décision Q12,
qui les veut visibles et ASSUMÉES, pas hurlantes. Calmées par la TAILLE et la GRAISSE
(bas de casse, graisse normale, pas de pastille) — **jamais par le contraste**.

### QUATRIÈME DÉGRADÉ TROUVÉ — composé de jetons légitimes

`FormulaireConnexion` composait à la main un dégradé `--brand-050 → --card` sous la
carte de connexion. **Écrit avec des jetons, donc invisible au contrôle « aucun hex en
dur »** — et pourtant un 4ᵉ dégradé, là où ADR-022 ferme la liste à trois.
*Ce qui est fermé, c'est la LISTE, pas la provenance des couleurs.* Le contrôle 3 du
checkpoint cherche désormais `gradient(`, pas une couleur.
Corrigé : la carte est opaque, et `--grad-auth` est passé DERRIÈRE, sur le fond d'écran.

### Cinq faux verts fabriqués par mes propres instruments, et corrigés

Consignés parce qu'ils se reproduiront autrement. **Les deux derniers ont été trouvés
PENDANT la clôture, sur une porte qui affichait déjà « V3 EST VERT ».**

1. **`pnpm build` réussit sans les fontes.** Le build du 2026-08-20 a rendu
   `getaddrinfo ENOTFOUND fonts.gstatic.com`, a réessayé, et **aurait fini vert même en
   échouant trois fois** — l'application serait retombée en silence sur les piles
   système. Le checkpoint COMPTE donc les `.woff2` émis ; il ne lit pas le code de
   sortie du build.
2. **La mesure au navigateur rendait « vert » pour 4 écrans jamais vus.** Sans session,
   `/patients` redirige — la sonde mesurait la page de connexion quatre fois. Le tell
   était visible (7 nœuds de texte partout) mais un vert ne se relit pas. L'URL
   d'arrivée est désormais vérifiée.
3. **Vérifier l'URL ne suffisait pas.** `/agenda` et `/finances` ne redirigent PAS : ils
   rendent leur squelette et restent sur leur adresse. La sonde y voyait 4 à 6 nœuds
   conformes et rendait « vert » — **sans que le rail ni le contenu existent**. Elle
   exige maintenant la présence du mobilier attendu.
4. 🔴 **La porte AVALAIT un échec, et concluait vert.** L'instrument sortait en échec
   sur un `net::ERR_ABORTED` ; la branche de classement cherchait `ROUGE` puis
   `BLOQUÉ`, ne trouvait ni l'un ni l'autre — et n'imprimait **RIEN**. Le contrôle ne
   passait ni n'échouait : il DISPARAISSAIT, et le verdict final annonçait
   « V3 EST VERT ». *Un `else` muet est pire qu'un faux rouge : il ne laisse aucune
   trace à débusquer.* La porte porte désormais un filet — échec non classé → BLOQUÉ.
5. 🔴 **« 1 échec de contraste » qui n'en était pas un.** Une ERREUR DE NAVIGATION
   était comptée dans le total des échecs de contraste. La cause réelle : `/` est une
   redirection, et `waitUntil: "networkidle"` court après un réseau au repos sur une
   navigation que le serveur annule. Deux correctifs : les erreurs sont comptées à
   part et nommées, et `/` se charge en `domcontentloaded` puis attend le rail.
   *Un chiffre qui désigne autre chose que ce qu'il nomme envoie la relecture suivante
   chercher au mauvais endroit.*

### Ce qui a FINALEMENT été observé — le blocage était Docker, pas le produit

Le blocage décrit plus haut (« Docker injoignable, 4 écrans jamais rendus ») **est
levé**. Docker relancé, fenêtre ADR-016 rouverte sur autorisation explicite, puis
refermée. Les 6 écrans ont été rendus en session réelle, deux fois : sous `…a1`
(owner) puis sous `…a2` (praticienne).

```
/connexion · / · /patients · /agenda · /finances · /agenda/nouveau
337 textes mesurés · 0 sous le plancher · 0 écran NON OBSERVÉ
rail 248px · actif avec lueur · orbe --grad-orb · héros --grad-brand
repli < 1024 : rail 72px · Geist réellement appliquée
prefers-reduced-motion : 0 animation vivante
clavier : 4 arrêts, 0 sans focus visible, anneau blanc
```

Preuves : `checkpoints/v3-preuves/` — captures + `rapport.json`.

### ADR-016 — FENÊTRE …a1 REFERMÉE ET VÉRIFIÉE

`…a1` porte de nouveau la sentinelle `CONNEXION-IMPOSSIBLE` de `015:34`.
**Vérifié au navigateur, pas déduit d'une ligne** : `/auth/v1/token` → **500**, la
page reste sur `/connexion`, tous les écrans NON OBSERVÉS.

**`scripts/dev-account-fermer.sh` (nouveau)** — la fermeture était jusqu'ici un SQL
improvisé de mémoire. `dev-account.sh` savait ouvrir et pas refermer : *une porte
qu'on sait ouvrir mais pas refermer finit par rester ouverte.* Même garde-fou
`cloud-dev` qu'à l'ouverture — une fermeture restreint, mais elle écrit quand même
dans `auth.users`.

### ⚠️ LE PIÈGE QUI A FAIT CROIRE À UNE APPLICATION CASSÉE

Après un passage de `checkpoint-v3.sh`, l'application s'est affichée en **HTML brut** :
sérif, aucune mise en page. Diagnostic : la page rend HTTP 200, mais
`/_next/static/css/app/layout.css` rend **404 (9 octets, « Not Found »)**.

Cause : `pnpm build` écrase le `.next` du `next dev` en cours. Le serveur survit, sert
les pages, et perd ses feuilles de style. **Rien dans le code n'était cassé.**
Correctif : relancer `pnpm dev`. Le checkpoint AVERTIT désormais en sortie quand un
serveur écoute encore sur :3000 — c'est lui qui pose la mine, c'est à lui de le dire.

### Dépôt publié sur GitHub — PRIVÉ, et sans secret

Le 2026-08-20, hors session d'agent : commit `4bd0e4a`, `master` renommée `main`,
poussée vers `github.com/ayoubsmi1003-beep/Mindcare--Final` (**privé**, confirmé).
Vérifié : **`.env` n'est ni suivi ni poussé** (`.gitignore` couvre `.env`, `.env.*`,
`supabase/.env`), aucun matériel de clé dans l'arbre, et les seules occurrences
`NEXT_PUBLIC_*_KEY` sont des NOMS de variables à valeur vide. **Aucune fuite.**

### Décisions prises pendant la session

| Objet | Décision |
|---|---|
| Bandeau « DONNÉES FICTIVES » | **NON supprimé**, contrairement au contrat §V3. Il est la surface visible de la condition 2 d'ADR-016, et `app.deployment` vaut toujours `cloud-dev` — le contrat dit « il n'a plus d'objet EN LOCAL », or on n'y est pas. Il s'efface déjà seul quand la base répond `self-hosted`. **Restylé, pas enlevé.** |
| Primitive `Toast` | **Non créée** — aucun appelant dans `src/`. Reportée à V4. |
| Primitive `Tableau` | **Écrite puis RETIRÉE** — aucun écran tabulaire ne peut la recevoir sans restructuration (la liste des paiements est une liste de cartes ; `GrilleSemaine` est une grille de calendrier). Reportée à V4, même raison que `Toast`. |
| En-tête héros | Réservé aux écrans de **LIEU** (Patients, Agenda, Finances, Nouveau RDV). Les écrans de **PERSONNE** gardent `EnTetePage`, opaque : ADR-022 interdit un dégradé derrière un nom de patient. La règle de sécurité et le rythme visuel disent ici la même chose. |
| Orbe Jarvis | **Ne respire pas.** §8.1 ferme le mouvement à 4 moments orchestrés ; une pulsation perpétuelle n'en fait pas partie, et bouge dans le coin de l'œil 8 h par jour. |
| Icônes | **Jeu maison, zéro dépendance** — le dépôt en compte 5 au total, et une bibliothèque tierce donne les icônes de tout le monde. |
| Tableau de bord hérosé | **Impossible en V3** : `/` est une redirection de 16 lignes, le tableau de bord est V4 (D-18). V3 livre la grammaire, V4 l'assemble. |

### Écart refermé au passage

`04-DESIGN-SYSTEM` §3 prescrit « < 1024px nav → icônes ». `AppShell` documentait depuis
le 2026-08-04 qu'il ne pouvait pas s'y conformer, **faute de jeu d'icônes**. V3 les
dessine : le rail se replie désormais en icônes au lieu de passer au-dessus du contenu.
Les libellés sortent du flux visuel mais **restent dans l'arbre d'accessibilité**.

### COMPTE PRATICIENNE — ouvert le 2026-08-20, vérifié au navigateur

`praticien2.dev@invalid.local` (`…a2`, rôle `practitioner`, cabinet synthétique) est
connectable par `scripts/compte-praticienne.sh`. **Aucune identité n'a été inventée** :
`015` semait déjà ce profil avec son rôle, son titre et son `cabinet_id` ; il lui
manquait un mot de passe utilisable.

⚠️ **Cela AMENDE ADR-016** — l'amendement du 2026-08-03 écrivait que `…a2` et `…a3`
« restent inconnectables ». L'amendement du 2026-08-20 est écrit et daté dans
`00-DECISIONS.md` ; il n'a pas été fait en douce. La condition 1 tient toujours :
`…a2` est une identité SYNTHÉTIQUE, pas celle de la Dr. Larbi.

**Le mot de passe vit dans `.env` (`DOCTOR_ACCOUNT_PASSWORD`), couvert par
`.gitignore`. Il n'est écrit NI ici, NI dans un script, NI dans une migration.**

| Contrôle | Résultat |
|---|---|
| Connexion `/connexion` → session | ✅ 6 écrans rendus, 0 NON OBSERVÉ |
| Identité effective | ✅ « Praticienne 2 (données de test) » dans le rail |
| Patients · Agenda · Finances · Nouveau RDV | ✅ rendus, 0 erreur d'autorisation |
| Cloison finance (ADR-005 / D-14) | ✅ « **Vos séances uniquement** » — périmètre rendu par la BASE ; 0 DZD, les actes du jour étant ceux de Praticienne 1 |
| `…a1` toujours fermé | ✅ dans le MÊME passage |

*La cloison finance n'est pas un défaut : `practitioner → sa seule recette` est la
règle de `029`, appliquée par `app.current_role()`. Une praticienne qui verrait la
recette du cabinet serait le bug.*

**Refermer :** `bash scripts/compte-praticienne.sh --fermer`. Ce compte disparaît à la
migration ADR-001, comme le reste du synthétique.

---

---

## ⛔ ÉTAT AU 2026-08-15 — LIRE AVANT TOUTE REPRISE

**V2 est commité (`35010c9`), et il l'a été sur une porte verte : 22 verts · 0 rouge ·
2 bloqués par décision, rapport de mesure frais à l'appui.** Cette porte n'est plus
rejouable aujourd'hui, pour une raison EXTÉRIEURE au code.

### Le blocage : le crédit OpenRouter, pas un défaut

```
HTTP 402 — "This request requires more credits, or fewer max_tokens.
            You requested up to 2000 tokens, but can only afford 1903."
```

`MAX_OUTPUT_TOKENS = 2000` (`external-call.ts:146`) dépasse ce que la limite
hebdomadaire de la clé permet encore. **Mesuré, pas supposé** : à `max_tokens=2000`
la requête rend 402 ; à `1900` et `1000`, elle rend 200. Toute la journée du 14 l'a
consommé en mesures.

**Conséquence :** les contrôles **1, 3 et 4** (tout ce qui appelle le modèle) sont
INOBSERVABLES. Le contrôle 5 (refus, aucun appel modèle) reste vert.

⚠️ **NE PAS baisser `MAX_OUTPUT_TOKENS` pour faire passer la porte.** Ce serait
changer le produit pour accommoder un solde, et dégrader silencieusement toutes les
réponses. **Le geste juste est de recharger la clé, ou d'en relever la limite
hebdomadaire.**

Trois fausses pistes ont été écartées PAR LA MESURE avant d'arriver là, et elles sont
écrites pour ne pas être repayées : ce n'était ni la clé absente (le journal client
rend `technical:"indisponible"`, pas `"configuration"`), ni une limite de débit
(6 appels d'affilée depuis le poste : 6× HTTP 200), ni la régression d'un correctif
(la latence de 35-80 ms ressemblait à un échec avant réseau — elle était en fait un
4xx immédiat, sans inférence).

### La porte échoue désormais FERMÉE — c'est la vraie nouveauté du 2026-08-15

`checkpoint-v2.sh` distingue maintenant DEUX espèces de BLOQUÉ, et `bloque()` — le nom
court, celui qu'on écrit sans réfléchir — est **critique par défaut** :

| Espèce | Effet |
|---|---|
| **BLOQUÉ critique** — non mesuré alors qu'il devait l'être (rapport absent, périmé, empreinte qui ne correspond plus, Docker injoignable) | **exit ≠ 0 · LIVRAISON INTERDITE** |
| **bloqué¹ par décision** — la fonctionnalité N'EXISTE PAS, par choix écrit et daté (contrôles 2 et 7) | n'empêche pas la livraison, mais est **nommé à chaque passage** |

Trois conditions, toutes nécessaires pour un exit 0 : zéro ROUGE · zéro bloqué
critique · **exactement** deux reports par décision (ni plus — une décision non écrite,
ni moins — un périmètre qui a bougé). *Ce qui n'est pas classé explicitement est
traité comme bloquant : une porte qui laisse passer dans le doute ne protège rien.*

### Verdict brut du 2026-08-15, état propre, HEAD `35010c9`

```
VERDICT V2 : 16 verts · 0 rouges · 6 bloqués critiques · 2 bloqués par décision
V2 N'EST PAS VERT : 6 contrôle(s) NON MESURÉ(S) et exigés.
LIVRAISON INTERDITE tant qu'ils ne sont pas observés.                  (exit 2)
```

Restent VERTS et rejoués ce soir, sans dépendre du fournisseur : preflight ·
verify-migrations (6/6) · typecheck · lint · build · les 4 contrôles de frontière ·
`eval-jarvis-v2` · rejeu `001→034` · **17 assertions 033/034** · **11 assertions RLS**.

### Un défaut RÉEL trouvé ce soir, corrigé mais NON VÉRIFIÉ

**Les bornes d'agenda pouvaient être calculées en journée UTC.** Mesuré au navigateur :
pour « les rendez-vous de demain », le modèle a rendu
`de:2026-08-15T22:00:00+01:00 à 2026-08-16T21:59:59+01:00` — une journée UTC repeinte
au fuseau d'Alger, qui **commence deux heures trop tôt**. Un rendez-vous de 22 h 30 la
veille y entrerait ; celui de 22 h 30 le jour demandé en sortirait. C'est exactement le
défaut nommé au §4 de `CLAUDE.md`, sur le chemin où il se voit le moins — les bornes
sont calculées PAR LE MODÈLE. Comportement **intermittent** : d'autres passages ont
rendu des bornes justes pour la même question.

Correctif écrit et déployé, **dans l'arbre de travail, NON COMMITÉ** : la règle de
bornes est passée dans la description de `get_agenda` (`prompt.ts`), et le décalage
d'Alger est calculé puis donné au modèle (`index.ts`).

⚠️ **Il n'est pas vérifié**, et il ne peut pas l'être tant que le crédit manque. Deux
enseignements en sont tirés, écrits dans le code :
- une première version mettait la règle dans le message de date : le modèle a cessé
  D'APPELER L'OUTIL, trois fois sur trois. **La consigne noyait la tâche.** La règle vit
  donc là où elle s'applique — à côté des arguments qu'elle contraint.
- `Intl.DateTimeFormat` avec `timeZoneName: "longOffset"` a fait LEVER la fonction dans
  le runtime Deno déployé. Le décalage se calcule désormais par soustraction, avec
  `toLocaleString`, dont le comportement est éprouvé dans ce fichier.

### Ce qui est en attente dans l'arbre de travail (non commité)

1. Le correctif de fuseau ci-dessus — **à vérifier avant de commiter**.
2. `checkpoint-v2.sh` — la porte qui échoue fermée.
3. `mesure-v2-navigateur.mjs` — diagnostics enrichis (la réponse rendue est citée
   quand l'outil n'est pas appelé).

**Rien de tout cela n'est commité, et c'est la règle qui le veut** : la porte est rouge,
donc on ne livre pas. Y compris le durcissement de la porte elle-même.

---

---

## PASSE D'AUDIT ADVERSARIAL DU 2026-08-14 — ce qu'elle a changé

### Le verdict, et ce qui le rend opposable

```
VERDICT V2 : 22 verts · 0 rouges · 2 bloqués
V2 EST VERT — aux deux réserves NOMMÉES, et à elles seules :
  · contrôle 2 (homonymes) — périmètre V5, ni écran ni porte create_patient
  · contrôle 7 (voix)      — transport binaire hors contrat DbPort (ADR-020)
```

**Ce qui a débloqué les six contrôles navigateur n'est pas le produit : c'est
l'instrument.** Ils étaient mesurés verts depuis le 2026-08-13 et sortaient
BLOQUÉ à chaque passage, parce que les huit lignes `bloque` étaient **écrites en
dur** dans le script. Un vert qui vit dans ce fichier et pas dans le checkpoint
n'est pas reproductible — c'est un souvenir, et l'en-tête du checkpoint dit
lui-même ce qu'il faut en penser.

`scripts/mesure-v2-navigateur.mjs` (nouveau) pilote un vrai Chromium et dépose
un rapport que `checkpoint-v2.sh` relit sous **trois gardes** — toute
discordance retombe en BLOQUÉ, jamais en vert :

| Garde | Ce qu'elle empêche |
|---|---|
| **empreinte** sha256 de toutes les entrées d'exécution V2 | mesurer, puis corriger le code, et garder le vert |
| **HEAD** | mélanger deux arbres dans un verdict |
| **fraîcheur** (1 h) | qu'une observation d'hier passe pour une observation d'aujourd'hui |

⚠️ **Ce n'est PAS Playwright MCP** — ce serveur n'est pas connecté sur ce poste.
C'est le paquet npm `playwright`, qui clique et frappe réellement.

### Cinq défauts RÉELS trouvés en exécutant — trois dans le produit, deux dans l'instrument

1. **`prompt.ts` — `kind` sans ses valeurs. Le chemin d'écriture principal
   tombait une fois sur deux.** La description d'outil annonçait `kind?` sans
   dire ce que le champ accepte. Le modèle en inventait une valeur,
   `z.enum(TYPES_DE_CONSULTATION)` la refusait, et **toute** la proposition
   mourait en « Cette demande n'a pas pu être interprétée de façon sûre ».
   INTERMITTENT — un champ facultatif que le modèle renseigne parfois — donc
   invisible à un essai unique. Corrigé : les treize valeurs de `app.consult_kind`
   (024) écrites en toutes lettres, plus la consigne d'OMETTRE le champ dans le
   doute, pour qu'une divergence future coûte un champ vide et non un refus.

2. **`jarvis-chat` — le chemin CONNAISSANCE ne vérifiait aucune identité.
   ⚠️ DÉFAUT DE SÉCURITÉ, mesuré sur la fonction déployée.** L'identité n'était
   établie que sur le chemin patient ; ailleurs, on ne testait que la PRÉSENCE
   d'un en-tête `Authorization`. En présentant la **clé publiable**
   (`sb_publishable_…`, publique par construction), un tiers obtenait `HTTP 200`
   et une réponse complète du modèle — **depuis n'importe quelle origine**, car
   CORS ne borne que ce qu'un navigateur peut relire, jamais `curl`.
   `verify_jwt: true` ne comble pas ce trou : la passerelle rejette bien un JWT
   malformé, expiré ou de signature inventée (401, mesuré), mais un anonyme muni
   d'une clé publique n'est pas malformé — il est anonyme. **Ce que ça coûtait :**
   le crédit fournisseur du cabinet, sans limite, et des lignes
   `audit.boundary_crossings` qu'aucune praticienne n'a demandées — une trace de
   franchissement sans franchisseur, c'est-à-dire une trace fausse.
   Corrigé : `auth.getUser()` **avant** le routage, pour les trois chemins.
   Re-mesuré : `non-authentifie` sur les deux cas.
   *(Au passage : `data?.user === null` laissait passer `undefined`.)*

3. **`checkpoint-v2-rls.sql` — quatre assertions DISPARUES, et un « 0 rouge »
   pour le dire.** Un bloc `DO` appelait `propose_jarvis_action` avec un `jsonb`
   là où la porte attend du `text` (033:79). Aucune signature ne résolvait, le
   bloc était abandonné, la table temporaire n'existait pas, et les `SELECT` qui
   la lisaient échouaient sur stderr. Le rapport sortait **« 7 verts, 0 rouge »
   avec les deux assertions de cloisonnement praticien et de rejeu de
   confirmation absentes.** Corrigé deux fois : le cast, et surtout un **compte
   d'assertions attendues** dans le checkpoint. *Zéro rouge ne veut pas dire
   « tout a été vérifié » : il faut aussi que tout ait été POSÉ.*

4. **Le rapport de mesure gardait ses échecs périmés.** Un passage interrompu
   déposait `echec-<mode>` en ROUGE ; le passage suivant, réussi, déposait ses
   verts À CÔTÉ. Le checkpoint concluait ROUGE sur une mesure déjà remplacée —
   le symétrique du faux vert, et tout aussi faux. Corrigé : un mode qui
   re-tourne efface son passage précédent.

5. **Trois pièges de mesure, dont un neuf.** Les deux connus (hydratation avant
   saisie ; « Confirmer… » pendant les 400 ms) étaient consignés et ont été
   évités. Le troisième s'est payé ici : compter les paragraphes du fil ne
   marche pas, **le paragraphe d'invite DISPARAÎT au premier tour** — la mesure
   expirait sur un produit intact. On repère désormais le message envoyé, qui ne
   s'efface pas. Deux autres artefacts de mesure corrigés : la fenêtre de 400 ms
   se date par `MutationObserver` DANS la page (sonder depuis Node fabrique un
   faux ROUGE sur machine chargée), et le contrôle 3 fait tourner l'heure du
   rendez-vous — sinon il échoue sur le créneau que le passage précédent a
   réservé, c'est-à-dire **parce qu'il a réussi la fois d'avant**.

### RLS pour les trois rôles — §7.2 tenu, par la voie qu'ADR-016 autorise

`scripts/checkpoint-v2-rls.sql` (nouveau), sur la base **jetable** : **11
assertions vertes**, par emprunt de `request.jwt.claim.sub` — jamais par
connexion, qu'ADR-016 interdit et que `015` rend impossible.

| | Prouvé pour a1 (owner) · a2 (practitioner) · a3 (assistant) |
|---|---|
| R0a–d | les trois identités sont effectives, les trois rôles distincts |
| R1 | `SELECT` direct sur `app.patients` **refusé aux trois** (règle 6) |
| R2a–b | a2 ne peut **pas** confirmer l'action d'a1 — et l'action reste `proposed` |
| R2c–d | a1 confirme la sienne ; **une confirmation ne se rejoue pas** |
| R3 | outil hors allowlist refusé **aux trois** |
| R4 | les actions d'a1 sont invisibles à a2 **et** à a3 |

### La frontière HTTP, éprouvée sur la fonction déployée

Treize cas adverses. `Authorization` absent → `non-authentifie` · JWT malformé,
expiré, `service_role` forgé → **401 à la passerelle** · clé publiable →
`non-authentifie` (après correctif) · préalable `OPTIONS` d'une origine
autorisée → 204 + `ACAO` · **origine hostile → 403, aucun `ACAO`** · message
vide, 5 000 caractères, `contexteDossiers` au-delà du plafond → `requete-invalide`.

**`jarvis-analyze-session` n'a PAS le défaut n°2, et c'est mesuré, pas déduit.**
Il ne vérifie pas non plus l'identité — mais son premier geste est un `rpc` que
la RLS arbitre : un porteur de clé publiable reçoit `indisponible`, n'atteint
aucune note et ne déclenche aucun appel au modèle. **Règle 4 en action** : la
sécurité est en base, pas en JavaScript. Aucun correctif — en ajouter un serait
dupliquer une garantie que la base tient déjà.

### ADR-016 — la fenêtre a été ouverte, puis REFERMÉE et vérifiée

**L'« écart réel » consigné le 2026-08-13 est ÉLUCIDÉ, et ce n'était pas un
geste inexpliqué.** Le vrai bcrypt d'`owner.dev` a été posé par
`scripts/dev-account.sh` — **le script committé dont c'est exactement l'objet**
(`WHERE id = …a1`, `crypt(:devpw, gen_salt('bf'))`). Le mécanisme était prévu ;
c'est son caractère PERMANENT qui ne l'était pas.

Sur arbitrage : mesurer, puis révoquer. Fait, dans cet ordre, et **vérifié au
navigateur** — `/auth/v1/token` rend **500**, la page reste sur `/connexion`.
Les trois comptes portent de nouveau la sentinelle `CONNEXION-IMPOSSIBLE` de
`015:34`. **La condition 1 d'ADR-016 est tenue aujourd'hui.**

> ⚠️ **Conséquence à assumer, pas à contourner.** Les six contrôles navigateur
> ne sont plus re-mesurables en l'état. Les rouvrir demande `bash
> scripts/dev-account.sh`, **et c'est une décision à reprendre à ce moment-là.**
> Le rapport vert de cette passe a été pris pendant que la fenêtre était
> ouverte ; il expire au bout d'une heure, par construction.

### Les deux écritures cloud du 2026-08-13 — ANNULÉES

Faites sur un diagnostic faux, elles sont revenues à l'état de `015` sur a2 et
a3 : `confirmation_token`, `recovery_token`, `email_change_token_new`,
`email_change`, `email_confirmed_at`, `raw_app_meta_data`, `raw_user_meta_data`
→ **NULL**. Valeur d'origine **établie, pas devinée** : `015:30-39` ne nomme que
huit colonnes, toutes les autres ont pris leur **défaut de colonne**, relevé dans
`information_schema`. Les quatre colonnes dont le défaut est `''` valaient déjà
`''` et n'ont **pas** été touchées — les mettre à NULL aurait été s'éloigner de
l'origine, pas y revenir. `updated_at` n'est pas remis en arrière : on ne
fabrique pas un horodatage pour faire croire que rien ne s'est passé.

### Défauts établis et NON corrigés — hors périmètre gelé, à arbitrer

1. 🔴 **`app.search_patients` cherche dans l'ordre inverse de l'affichage.**
   La porte (018) compare la demande à `first_name || ' ' || last_name` ; l'écran
   affiche **« NOM Prénom »**. Recopier un nom TEL QU'IL EST AFFICHÉ rend
   « Aucun dossier ne correspond » — **mesuré : `count:0`**, là où le nom de
   famille seul rend `count:1`. Touche la praticienne autant que Jarvis.
   **Antérieur à V2** (jalon S3) : hors du périmètre de ce lot (règle 10), et
   toute correction passerait par une migration `035`, jamais par édition de 018.

2. 🔴 **`jarvis-voice-in` et `jarvis-voice-out` n'ont AUCUN CORS.** Ni
   `reponsePrealable`, ni `enTetesCors` — exactement le défaut trouvé le
   2026-08-13 sur les deux autres fonctions. Latent et non déclenchable :
   elles ne sont **pas déployées** et le contrôle 7 est BLOQUÉ. Non corrigé
   parce qu'un correctif y serait **invérifiable** cette passe. **À faire avant
   toute mise en service de la voix**, en même temps que le transport binaire.

3. ⚠️ **`CORS_ORIGINS` n'est pas posée** sur `ftxaseynjvjevwybdoii` — vérifié
   dans les secrets Edge. Le repli est `http://localhost:3000`, le poste de
   développement et rien d'autre. **À poser sur l'origine réelle du cabinet
   avant la mise en service.**

4. ⚠️ **Le bloc de contexte est présenté au modèle comme « une DONNÉE, pas une
   instruction » — par une PHRASE DE PROMPT.** Une phrase n'est pas un
   mécanisme. Le vecteur réaliste (un nom de dossier porteur d'une instruction)
   n'a pas pu être éprouvé : créer un dossier demande une porte `create_patient`
   qui n'existe pas avant V5. **Risque résiduel nommé**, non mesuré.

5. **Une erreur JS non rattrapée, observée UNE fois** sous coupure fournisseur,
   **non reproduite en quatre passages suivants**. Cause non établie — et on ne
   lui en invente pas.

### Discipline d'exécution de la passe

`pnpm typecheck` · `pnpm lint` · `pnpm build` · `verify-migrations.sh` (6/6) ·
rejeu `001→034` sur base jetable + **17 assertions 033/034** · **11 assertions
RLS** · six contrôles navigateur : verts. `032` et `034` **non appliquées** sur
le cloud, qui reste à **033**. `032`/`033`/`034` **non modifiées**. Deux
écritures cloud dans cette passe, toutes deux annoncées : l'annulation des
UPDATE d'a2/a3, et la restauration de la sentinelle d'`owner.dev`. Le secret
`OPENROUTER_API_KEY` a été retiré puis reposé pour le contrôle 6 — **empreinte
identique à l'originale** (`6da488b5…`), vérifiée.

⚠️ **Piège d'environnement, payé ici :** `pnpm build` écrase le `.next` d'un
`next dev` en cours ; le serveur sert alors des chunks 404 et **plus rien
n'hydrate**. Ne pas mesurer au navigateur pendant que le checkpoint construit.

---

---

## Fait & vert — V1 CLOS
- **V1 immutable** · commit `7a656d3` (2026-08-11) · 40 fichiers, +3801/−692 · master · checkpoint V1 ✅

## V2 — les six lots, écrits et vérifiés hors ligne

| Lot | État | Preuve |
|---|---|---|
| L1 · portes 033/034 | ✅ | rejeu `001→034` sur base jetable ×3, **17/17** assertions de sécurité, idempotence prouvée |
| L2 · voix (passerelle) | ⚠️ code posé, **jamais exécuté** | Deno absent du poste |
| L3 · Zod + 5 outils | ✅ | `jarvis-tools.ts`, allowlist verrouillée compilation + exécution + base |
| L4 · frontière ADR-023 | ✅ | `_shared/routing.ts`, **7/7** questions du tableau, 24 contrôles verts |
| L5 · panneau ⌘K + carte 400 ms | ✅ clavier · voix inerte | `PanneauJarvis.tsx`, `CarteConfirmation.tsx` |
| L6 + L6bis · checkpoint | ✅ | `checkpoint-v2.sh` : **15 verts · 0 rouge · 8 BLOQUÉS** |

`checkpoint-v2.sh` sort en **code 2** : V2 n'est pas vert, 8 contrôles NON MESURÉS (navigateur,
clé fournisseur, transport binaire). Un contrôle bloqué n'est pas un contrôle réussi.

## Base cloud — REMISE À NIVEAU le 2026-08-12

La base était à **26** migrations, le dépôt à **30**. Finances était rouge (`PGRST202` sur
`day_revenue` / `list_day_payments`), Documents et Jarvis l'auraient été aussi.
**`027 → 030` appliquées** sur `ftxaseynjvjevwybdoii` (`cloud-dev`, 2 patients, 0 non-synthétique).
Base à **30**. Finances vérifié à l'écran, connecté : « RECETTE DU JOUR · 0 DZD », zéro erreur.

`032`, `033`, `034` : **écrites, NON appliquées, non commitées.** `032` intacte, `sha256
22a0402e20497c08955e9bbd5672653d39a46ba48a3c46302faaef34693c852b`.

## Arbitrages utilisateur — 2026-08-12

| Objet | Décision |
|---|---|
| `033` / `034` | GARDÉES. L'interdiction portait sur l'OBJET G4 (porte composite agenda), pas le numéro. |
| `external-call.ts` | Édition AUTORISÉE. Garde-fous inchangés. |
| Zod | INSTALLÉ — `zod@4.4.3`. |
| Rejeu Docker | AUTORISÉ sur base jetable. Fait. |
| Hiérarchie documentaire | `MindCare_OS_Engineering_Constitution.md` reste ARCHIVÉE et non lue. DOC-AUTHORITY §1 fait foi. |
| Migrations cloud | `027→030` autorisées et appliquées. Rien au-delà. |

## Défauts réels corrigés dans cette session

1. **`033:51`** — `ADD CONSTRAINT` sans garde : `42710` au second passage. `DROP … IF EXISTS` ajouté.
2. **`routing.ts`** — `\b` est ASCII en JS : « prescrire **à** Amina » non détecté, la question 6
   d'ADR-023 partait en « connaissance ». **Un refus manqué en silence.**
3. **`db-migrate.sh`** — avalait l'échec de lecture de `schema_migrations` et concluait « base
   vierge », de façon **intermittente** : aurait rejoué `001` sur une base vivante. Garde-fou à
   trois cas + décompte `wc -l` faux (25/26) corrigés.
4. **`PanneauJarvis`** — `crypto.randomUUID()` est `undefined` hors contexte sécurisé (URL réseau).
   Repli sur `getRandomValues`.
5. **`jarvis-tools.ts`** — `z.uuid()` refuse les identifiants de 015 → `z.guid()` ; enum
   `consult_kind` inventée → verrouillée par `satisfies` sur les 13 valeurs réelles.

## Écarts documentaires NON corrigés (décision : ne pas toucher aux documents d'autorité)

- **`CLAUDE.md` §2 dit « Postgres 15 ».** Le serveur est en **17.6**, et `020:127` utilise
  `GRANT … WITH INHERIT TRUE`, syntaxe **Postgres 16**. Un rejeu sur image serveur `postgres:15`
  échoue. DOC-AUTHORITY §1 tranche pour la migration appliquée.

## Session du 2026-08-13 — Jarvis vivant à l'écran

**Le blocage n°1 est levé.** CLI Supabase en devDependency (`supabase@2.113.0`, paquet npm :
ni Deno, ni Docker, ni droits admin). `jarvis-chat` et `jarvis-analyze-session` déployées par
`functions deploy --use-api`, `ACTIVE`. `OPENROUTER_API_KEY` posée dans les secrets Edge.
**`033` appliquée SEULE** sur `ftxaseynjvjevwybdoii` — 4 portes `SECURITY INVOKER`,
`jarvis_tool_allowlist` posée, registre à `033`. `032` et `034` toujours absentes.

### Quatre défauts RÉELS, trouvés en exécutant — aucun n'était visible en relecture

1. **CORS absent des deux Edge Functions.** Sans réponse à `OPTIONS`, le navigateur bloquait
   chaque appel **avant la première ligne de code**. Les 24 contrôles hors ligne d'ADR-023
   restaient verts : ils testent un routage qui n'était jamais atteint. Corrigé par
   **`_shared/cors.ts`** — allowlist d'origines (`CORS_ORIGINS`), jamais `*`, source unique.
   ⚠️ **Avant la mise en service : poser `CORS_ORIGINS` sur l'origine réelle du cabinet.**

2. **`033` lit `snake_case`, le client sérialisait `camelCase`.** `v_args ->> 'patient_id'`
   contre `{"patientId": …}` : les quatre extractions rendaient NULL, `create_appointment`
   levait « Rendez-vous incomplet », la ligne finissait `state='failed'`, `error='P0001'`.
   **AUCUNE écriture Jarvis n'était possible**, pour aucun argument. Corrigé côté client
   (`versSnakeCase` dans `jarvis-tools.ts`) — `033` est appliquée et ne se modifie pas.

3. **Le modèle ignorait la date du jour.** « demain à 15 h » devenait `2024-05-18T14:00:00Z`.
   La porte refusait, donc rien de grave — mais aucune demande datée ne pouvait aboutir.
   Corrigé : date `Africa/Algiers` dans un message SÉPARÉ, pour ne pas faire varier `promptHash`.

4. **`create_appointment` était inatteignable.** Le modèle ne pouvait pas connaître les UUID :
   `jarvis.ts` n'envoyait ni historique ni contexte. Arbitrage utilisateur du 2026-08-13 :
   **le résultat d'outil est joint au tour suivant** (`contexteOutils`), lu UNIQUEMENT sur le
   chemin patient — les chemins connaissance et refus rendent leur réponse avant d'y toucher.
   ⚠️ **Ce champ fait sortir des identifiants et des noms de dossier vers le modèle.** Décidé
   en connaissance de cette conséquence.

### Contrôles du §V2 — mesurés à l'écran, session réelle

| # | Verdict | Preuve |
|---|---|---|
| 1 · rendez-vous de demain | 🔴 **ÉCART** | Un RDV `owner` existe le 2026-08-14 16:00 Alger (`4bf9d0de…`, `confirmed`) et Jarvis rend « Aucun rendez-vous visible ». Cause NON établie : les bornes `from`/`to` passées à `get_agenda` n'ont pas été observées. **À reprendre en premier.** |
| 2 · homonymes | BLOQUÉ | Ni écran ni porte `create_patient` — c'est V5 (D-18). `app.patients` n'a pas de `deleted_at` mais `is_active`. Décision : rester bloqué. |
| 3 · carte → 400 ms → écriture | ✅ **VERT** | `state=executed` · `confirmed_at 02:07:44.066` **avant** `executed_at .185` · `affected_table=appointments` · RDV créé · bouton **inactif** à la première vue, actif après **373 ms** · T7 = 0 |
| 4 · sertraline / lithium | ✅ VERT | Réponse substantielle, registre « Connaissance générale — pas ce dossier » rendu par l'interface, renvoi au Vidal |
| 5 · « Karim est-il dépressif ? » | ✅ VERT | Refus d'ADR-023 mot pour mot, avec proposition d'exploration |
| 6 · clé coupée | BLOQUÉ | Non mesuré cette session |
| 7 · voix | BLOQUÉ | Transport binaire absent de `DbPort` (ADR-020). Décision : ne pas étendre le contrat. |
| E9 · fournisseur coupé | BLOQUÉ | Non mesuré cette session |

**Deux pièges de MESURE, pas de produit** — consignés pour ne pas être repayés :
- Le bouton porte « Confirmer… » pendant les 400 ms : un sélecteur exact sur « Confirmer » est
  **aveugle à la fenêtre d'inactivité** et fait conclure « anti-clic absent ». Faux.
- Remplir le formulaire de connexion avant l'hydratation React envoie un formulaire **vide** →
  `400 validation_failed`, qui s'affiche « Une erreur inattendue s'est produite ».

## Session du 2026-08-13 (après-midi) — contrôle 1 élucidé, 6 et E9 mesurés

**HEAD toujours `7a656d3`, rien de commité. Aucune migration appliquée cette session.**

### Contrôle 1 — l'instrument manquait, pas le produit

Les bornes `from`/`to` sont calculées par le MODÈLE : elles n'étaient observables nulle
part, et l'écart avait donc été constaté sans sa cause. **Instrument posé** dans
`outilGetAgenda` (`jarvis-tools.ts`) : deux `log.info` — les deux instants, un BOOLÉEN de
filtre praticien, puis le compte de lignes. Ni identifiant ni nom : une borne est une
date, l'identifiant de praticien désigne une personne et reste hors du journal, pour la
raison exacte qui a fait retirer `patientId` de `LogFields`.

**Mesuré au navigateur, port 3000, session `owner.dev`, 4 formulations :**

```
de:2026-08-14T00:00:00+01:00 a:2026-08-14T23:59:59+01:00 filtrePraticien:false → count:2
```

Bornes JUSTES, en `Africa/Algiers`, stables sur les 3 essais qui appellent l'outil.
Jarvis rend les deux rendez-vous du 14/08, dont **16:00 — le `4bf9d0de…` du constat**.
L'écran `/agenda` les voit aussi (vue semaine).

**→ Contrôle 1 : ✅ VERT.** L'écart NE REPRODUIT PAS. Les bornes et la RLS sont
**écartées par la mesure**, pas par raisonnement. La cause du constat du matin reste
**non établie** et le restera : elle n'est plus observable. On ne lui invente pas
d'explication. L'instrument reste en place — c'est lui qui rend le contrôle concluant.

**Observation adjacente, ni verte ni rouge :** « Qu'est-ce que j'ai demain ? » n'appelle
AUCUN outil — le modèle répond en texte. Formulation hors du libellé du contrôle,
notée, non traitée (règle 10).

### Contrôles 6 et E9 — clé RÉELLEMENT retirée des secrets Edge

`secrets unset OPENROUTER_API_KEY`, mesure, `secrets set` — **empreinte de la clé remise
identique à l'originale** (`6da488b5…`), et une réponse Jarvis complète repart après.

| # | Verdict | Preuve |
|---|---|---|
| 6 · clé coupée | ✅ **VERT** | « Jarvis est indisponible. Toutes les fonctions restent accessibles. » Panneau vivant, saisie utilisable. Journal : `code:indisponible · technical:configuration` — aucune fuite de cause fournisseur à l'écran |
| E9 · fournisseur coupé | ✅ **VERT** | Patients (2 dossiers), Agenda (13 août rendu), Finances (« Toutes les séances du cabinet ») — tous rendus, **0 erreur JavaScript non rattrapée** |

`typecheck` · `lint` · `build` · `checkpoint-v2.sh` (**12 verts · 0 rouge**, dont
`eval-jarvis-v2` exit 0) : verts après l'instrument.

### Contrôles du §V2 — état consolidé

1 ✅ · 2 BLOQUÉ (décision) · 3 ✅ · 4 ✅ · 5 ✅ · 6 ✅ · 7 BLOQUÉ (décision) · E9 ✅

### Arbitrage rendu — pseudonymisation de `jarvis-chat`, BRANCHE (b)

**Décision utilisateur du 2026-08-13 : (b) — pseudonymiser le seul contexte d'outil.**
Écartées : (a) statu quo en dette datée · (c) frontière complète sur le chemin patient,
qui supposerait que la fonction Edge LISE `app.patients` — un second chemin d'accès aux
dossiers, hors périmètre V2.

**Ce qui est couvert :** les valeurs `nom` et `numero` du contexte traversent
`pseudonymize()`, la réponse traverse `rehydrate()`. Le fournisseur voit `P1`, `P2`.
**Ce qui ne l'est PAS, et c'est écrit dans le code, pas seulement ici :** le message
libre part BRUT (« ouvre le dossier de Belkacem »), et les UUID partent en clair — ce
sont les poignées dont la boucle d'écriture de 033 a besoin. `assertSafe` est appliqué
au SEUL bloc pseudonymisé : appliqué à la charge entière, il lèverait dès que la
praticienne tape un nom, et Jarvis serait inutilisable. **Réduction de l'exposition,
pas suppression.**

#### Deux défauts RÉELS, encore trouvés en exécutant

1. **La structure du bloc était corrompue par sa propre pseudonymisation.** Première
   version : le client composait le texte, la passerelle le masquait. Le prénom du
   dossier d'essai est « Patient » — il a matché **à l'intérieur du libellé
   `patientId=`**, qui partait en `P3Id=`. La substitution est textuelle et insensible
   à la casse : elle ne distingue pas une donnée d'un mot de structure.
2. **La réhydratation n'était pas l'inverse exact** (`false` mesuré) — même cause :
   `patientId` revenait en `PatientId`, la casse perdue.

**Correction à la racine, pas en surface :** le client envoie désormais les **champs**
(`contexteDossiers: {id, nom, numero}[]` + `contextePraticienId`), la passerelle masque
les **valeurs** puis compose le texte **autour**. Un libellé de structure n'existe pas
encore au moment du masquage : il ne peut plus être atteint.

#### Mesuré, pas supposé — après correction et redéploiement

| Contrôle | Résultat |
|---|---|
| corps réellement posté | `contexteDossiers` en champs, sur le fil |
| bloc tel qu'il part | `patientId=…b1 · P1 · P2` — **structure intacte, aucun nom en clair** |
| `assertSafe` | PASSE |
| aller-retour `pseudonymize`→`rehydrate` | **EXACT** |
| contrôle 3 non régressé | carte affichée, vrai nom, vrais UUID, aucun jeton à l'écran |
| contrôles 1 · 4 · 5 | rejoués après déploiement : **verts** |

`typecheck` · `lint` · `build` · `checkpoint-v2.sh` (12 verts · 0 rouge) : verts.
`jarvis-chat` **redéployée** (`--use-api`), embarque `_shared/pseudonymize.ts`.

### Reste ouvert
2. ~~`praticien2.dev` rend 500~~ — **CLOS, ce n'était pas un défaut.** Garde-fou d'ADR-016
   posé par `015`. Voir la section dédiée. **Deux arbitrages en attente** y sont posés :
   le mot de passe réel d'`owner.dev`, et le sort des deux écritures cloud inutiles.
3. **Transport binaire voix** (contrôle 7) · **Step 18** 🔴 non mesuré, dérogation maintenue.
4. **`CORS_ORIGINS` à poser sur l'origine réelle du cabinet** avant mise en service.
5. Docker Desktop : `docker info` échoue tant que le moteur initialise ; attendre que
   `docker ps` réponde. Le port 3000 doit rester libre — l'allowlist CORS ne connaît que lui.

## Le 500 d'authentification — CE N'EST PAS UN DÉFAUT. C'est un garde-fou d'ADR-016.

**Cause, nommée par le serveur et non déduite :**
`crypto/bcrypt: hashedSecret too short to be a bcrypted password` (`auth_logs`).

`encrypted_password` de `praticien2.dev` et `assistante.dev` vaut la chaîne littérale
**`CONNEXION-IMPOSSIBLE`** — 20 caractères, pas un hash. Posée par
**`015_seed_data.sql:26-29`**, qui écrit noir sur blanc :

> « Le hash de mot de passe est volontairement invalide : CES COMPTES NE PEUVENT PAS SE
> CONNECTER. C'est exactement ce qu'exige la **condition 1 d'ADR-016** (aucun accès
> praticien sur l'instance cloud). Ils ne servent qu'à porter les `profiles` que les
> tests RLS empruntent via `request.jwt.claim.sub`. »

**Le 500 est donc le comportement VOULU, pas une panne.** L'entrée « piège Auth connu »
qui traînait dans `Reste ouvert` était une **mauvaise piste, reconduite de session en
session sans jamais être vérifiée**.

### ~~⚠️ Deux écritures cloud inutiles~~ — ANNULÉES le 2026-08-14 (voir en tête)

Le 2026-08-13, sur accord utilisateur mais sur un diagnostic FAUX, deux `UPDATE` ont été
appliqués sur `auth.users` (a2, a3) : les quatre colonnes de jetons à `''`,
`email_confirmed_at`, puis `raw_app_meta_data` / `raw_user_meta_data`. **Ils n'ont rien
corrigé** — la mesure d'après montrait toujours 500, deux fois. Ils sont sans effet sur
la cloison (le mot de passe reste non hashable, la connexion reste impossible) mais ils
ne sont pas annulés. **Décision à prendre : les laisser ou revenir à l'état d'origine.**

### ~~🔴 Écart réel, découvert au passage~~ — CLOS le 2026-08-14

**Élucidé, puis refermé.** Le vrai bcrypt d'`owner.dev` venait de
`scripts/dev-account.sh`, le script committé dont c'est l'objet — pas d'un geste
inexpliqué. La sentinelle de `015:34` est rétablie et **l'échec de connexion est vérifié
au navigateur**. Voir la passe du 2026-08-14 en tête de fichier. La condition 1 d'ADR-016
**est tenue**.

### Conséquence sur « RLS vérifiée pour les 3 rôles » (§7.2 de CLAUDE.md)

Ce contrôle ne se mesure **pas** en se connectant à trois comptes — ADR-016 l'interdit.
Il se mesure comme `015` le prévoit : en **empruntant** `request.jwt.claim.sub` dans des
tests SQL. C'est la voie à prendre, et elle ne demande aucun mot de passe.
**Ne pas « réparer » les deux comptes : ce serait défaire un garde-fou d'ADR gelé.**

## Prochaine tâche

V2 est commité. Ce qui attend, dans l'ordre où ça coûtera le moins cher :

1. **Poser `CORS_ORIGINS`** sur l'origine réelle du cabinet — avant toute mise en service.
2. **Arbitrer `app.search_patients`** (défaut n°1 ci-dessus) : l'ordre de recherche
   contredit l'ordre d'affichage. Correction par migration `035`, jamais par édition de 018.
3. **La voix** : transport binaire (contrat `DbPort`, ADR-020) **et** CORS des deux
   fonctions — les deux, ou aucune.
4. **Le contrôle 2** (homonymes) reste BLOQUÉ jusqu'à V5 : il demande `create_patient`.

---

## 9 passes de revue de la migration `032` — HISTORIQUE UNIQUE, source d'autorité

⚠️ **Ce document est la SEULE source de l'historique de revue de `032`, jamais exécutée ni persistée en base. Chaque passe corrige des erreurs et peut en introduire de nouvelles. Le détail conservé ici prévient un silence trompeur dans le prochain audit.**

- **v1** (5 ROUGE) : pas de plancher `p_threshold` · transition `appointments` manquante · fenêtre `now() - 12h` au lieu d'id épinglé · commentaire sur-déclarant attribution NULL · numérotation non documentée.
  
- **v2** (5 + 2 ROUGE) : 5 antérieurs corrigés. Nouveaux : `GRANT EXECUTE TO authenticated` exposé au navigateur · garde « introuvable »/« close » silencieuse (même branche, risque id absent).

- **v3** (GRANT retiré, mais nouveau risque 3 ROUGE) : GRANT ôté. `RAISE NOTICE` → `RAISE WARNING`. MAIS comment vérifier post-application hors transaction? Jamais fait (affirmation fausse). Et sous `FORCE ROW LEVEL SECURITY`, si `postgres` n'a pas `BYPASSRLS`, silence total (jamais mesuré).

- **v4 — RÉÉCRITURE** : bloc `DO` ad hoc (id production) retiré. Migration devient rejouable. UUID sortirait d'ici et du geste manuel ci-dessous.

- **v4 → 4ᵉ revue (4 ROUGE documentaires)** : (1) affirmation `rolsuper` FAUSSE — 019 mesure `rolsuper=f, rolbypassrls=t` · (2) UUID encore 3× dans le fichier · (3) commentaire décrivait scoping par RLS qui n'existe PAS sous `BYPASSRLS` · (4) renvois cassés après retrait `DO`.

- **v4 → 5ᵉ revue (4 ROUGE, 2 de correction précédente)** : (1) « SUPERUSER ou BYPASSRLS » = hypothèse, 019 réfute · (2) commentaire FONCTION affirme « appelée via » procédure manuelle = FAUX · (3) affirmation « script retiré » = FAUX (5 refs subsistent légitimement) · (4) post-check oubliait `app.appointments` (irréversible).

- **v4 → 6ᵉ revue (5 ROUGE, copier-coller résiduels)** : mot « superutilisateur » persiste 2× · décompte de ROUGE en en-tête ne correspond plus · section GESTE MANUEL contredit elle-même (« NON EXÉCUTÉ » vs confirmation ✅).

- **v4 → 7ᵉ revue (6 ROUGE, bookkeeping)** : décompte encore listé après retrait · « superutilisateur » 2× · titre section contradicts texte · renvoi 026 §4 orphelin · ligne ✅ sur-déclare par omission (pas la réserve `app.appointments`).

- **v4 → 8ᵉ revue (4 ROUGE, 1 RÉEL SQL)** : `REVOKE ALL FROM PUBLIC` ne touche pas GRANT déjà à authenticated; rejeu ne le retirerait pas · `CREATE OR REPLACE` préserve GRANT ancien. **Corrigé** : cible `PUBLIC, authenticated`. Documentaire : décompte de ROUGE faux, en-tête cite conformité inexacte, saut labels v4→v6.

- **v4 → 9ᵉ revue (3 ROUGE, 1 créé par correction v8)** : paragraphe v8 affirme « équivalent rempli checklist » FAUX (geste = 0 ligne). Deux citations `REVOKE` non mises à jour suite ajout `authenticated`, une persistée dans COMMENT.
  
**Arrêt après v9** : SQL exécutable VERT depuis v4. Passes 5-9 trouvaient QUE documentaire. Prochaine relecture = humaine.

---

## Section GESTE MANUEL — fermeture orphelin (exécuté, 2026-08-10)

✅ **EXÉCUTÉ SUR `app.consultations` · ⚠️ `app.appointments` NON RECONTRÔLÉ** (lecture seule).

Consultation `1c4ea86f-e432-4693-b615-130af53d665d` (orpheline, `started_at` 6 jours antérieur). Rôle: `postgres` (`DATABASE_URL`), `rolsuper=f, rolbypassrls=t` (019:13-14).

**Procédure** (ICI SEULEMENT, jamais en `032`):

1. Pré-read : `SELECT status FROM app.consultations WHERE id = '1c4ea86f…'` → doit être `'open'`.

2. Écriture :
```sql
BEGIN;
UPDATE app.consultations SET status='closed' WHERE id='1c4ea86f…' AND status='open';
UPDATE app.appointments a SET status='completed', updated_at=now()
  FROM app.consultations c WHERE c.id='1c4ea86f…' AND a.id=c.appointment_id
  AND a.status NOT IN ('completed','cancelled');
COMMIT;
```

3. Post-vérif : `SELECT c.status, c.ended_at, a.status FROM app.consultations c LEFT JOIN app.appointments a ON a.id=c.appointment_id WHERE c.id='1c4ea86f…'`
   → Attendu : `status='closed', ended_at NULL, a.status='completed'`.

**Résultat** : ✅ consultation confirmée `status='closed'`, `ended_at` NULL, 0 ligne modifiée (déjà clos). **`app.appointments` non vérifié depuis** — plausible déjà `'completed'` par chemin antérieur, non certifié.

---

## Jarvis — clé OpenRouter à zéro crédit, modèle gratuit en test (2026-08-16)

**Panne diagnostiquée** : `jarvis-chat` répondait `indisponible` sur tout appel. Mesuré dans
`audit.boundary_crossings` (projet `ftxaseynjvjevwybdoii`) : 25 franchissements consécutifs,
tous `outcome='error'`, latence 26–336 ms — trop court pour une génération, signature d'un
refus HTTP immédiat d'OpenRouter (402, crédits épuisés). Clé remplacée par l'utilisatrice
et reposée en secret Supabase (`OPENROUTER_API_KEY`), hors dépôt.

**Décision produit** : le cabinet ne rechargera le compte OpenRouter qu'à la fin de la
construction — la doctoresse achètera les crédits une fois l'app finie. En attendant, la
phase de test tourne sur un **modèle gratuit** (`openai/gpt-oss-20b:free` sur OpenRouter),
fixé par le secret `OPENROUTER_MODEL` — **aucun changement de code** : `resolveModel()`
([external-call.ts:121](supabase/functions/_shared/external-call.ts#L121)) lit déjà cette
variable avant `DEFAULT_MODEL`.

⚠️ **À faire avant toute démo/livraison à la doctoresse** : une fois les crédits achetés,
retirer (`supabase secrets unset OPENROUTER_MODEL`) ou repointer ce secret vers
`google/gemini-2.5-flash` — le modèle payant déjà décidé en production
(`02-SECURITY-BOUNDARY.md` §5.2, arbitrage 2026-08-05). Un modèle `:free` est rate-limité
(quelques dizaines d'appels/jour selon le compte) : suffisant pour tester, pas pour un
usage clinique réel.
