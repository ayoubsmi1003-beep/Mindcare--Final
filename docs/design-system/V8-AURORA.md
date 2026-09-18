# V8 « Aurora » — ce qui a été livré

> Ce document décrit **ce qui est dans le dépôt**, pas ce qui était prévu. Il a
> été écrit APRÈS la refonte et après deux passes de critique visuelle sur
> captures réelles. Les captures qui l'attestent :
> `checkpoints/v7-preuves/v8-passe1|passe2|passe3|v8-final/`.
>
> En cas d'écart entre ce fichier et `src/styles/tokens.css`, **c'est
> `tokens.css` qui gagne** : il reste la source unique, ce document en est la
> lecture.

---

## 1. Le diagnostic de V7, et ce qu'il a coûté

V7 avait corrigé l'hygiène — échelles Tailwind complètes, zéro classe morte,
bordures qui n'étaient plus en `currentColor`, coquille chrome, Mode Séance.
Le squelette visuel, lui, n'avait pas bougé : rail sombre en aplat, cartes
blanches bordées sur un sol gris, chiffres en `text-title`, aucun graphique
hors de l'écran Finances.

La cause n'était pas technique. Une doctrine de retenue avait été appliquée à
un produit qui souffrait de l'inverse, et quatre versions successives ont
livré « propre et vide ».

**V8 renverse cela sur les leviers visuels, et sur eux seuls.** Sécurité, RLS,
portes SQL, contrats de données, authentification, logique métier et
l'interdiction de données fictives (règle 8 — c'est de l'intégrité de donnée,
pas du goût) sont inchangés. Aucune migration n'a été écrite.

---

## 2. Typographie

| Rôle | Fonte | Où |
|---|---|---|
| Interface, titres, **métriques** | **Plus Jakarta Sans** 400–800 | tout l'écran |
| Éditorial | Fraunces (`font-editorial`) | salutation du tableau de bord, titres d'états vides, en-tête d'Alexa |
| Données techniques | Geist Mono (`font-num`) | n° de dossier, n° de reçu, heures, chrono |
| Document imprimé | Newsreader (`font-doc`) | aperçus de certificats — **inchangé, statut légal** |
| Arabe | IBM Plex Sans Arabic | inchangé |

**Geist et Inter quittent l'interface.** `--font-inter` survit comme ALIAS de
`--font-ui` : une trentaine de composants écrivent `font-inter`, un alias vaut
mieux que trente remplacements dont un manquerait.

Échelle retendue : display 34px/800/−0.03em · title 22px · **metric 44px/800/
−0.035em** · **chiffre 28px** (nouveau palier, pour une rangée de quatre
tuiles) · eyebrow 11px/0.12em.

`font-editorial` est nouvelle : Fraunces était émise depuis V3 et **aucune
classe ne pouvait la consommer**.

### Le défaut typographique trouvé en capture

`formaterDzd` séparait les milliers par U+202F (espace fine insécable).
**Plus Jakarta Sans n'a pas de glyphe pour U+202F** : « 90 000 DZD »
s'affichait « 90000 DZD » dans toutes les tuiles de Finances. Le séparateur
est passé à **U+00A0**, standard en typographie française, présent dans toutes
les fontes du dépôt, toujours insécable. Corrigé dans `services/finance.ts`,
donc aussi dans les documents imprimés.

---

## 3. Couleur, matériaux, profondeur

**Six familles complètes** (700→050) : `emeraude` `aqua` `azure` `violet`
`ambre` `corail`. Elles nomment une TEINTE, pas un rôle — c'est la palette de
SÉRIE et de TUILE. `action.*`, `ai.*` et `info.*` restent la couche de rôle
pour les surfaces. Aucun ton 400 ou plus clair ne porte de texte sur blanc.

**Le sol vit.** `--voile-aurore` : quatre lavages radiaux à très basse opacité,
posés sur la racine (`background-attachment: fixed`), donc immobiles sous les
yeux — le défilement appartient à `<main>`. Le maillage traverse quatre
teintes et non la seule marque : c'est ce qui corrige le défaut d'`--atmosphere`
retirée en V7, qui teintait toute l'application en marque et rendait la couleur
de marque insignifiante là où elle désigne vraiment quelque chose.

**Deux familles de dégradé, et la distinction est ce qui les empêche de
redevenir de la décoration :**

- `bg-tuile-*` — **claires**, trois arrêts pastel avec dérive de teinte, encre
  `ink-900`. Surface d'un **agrégat**. *Une tuile compte, elle ne décrit
  personne.*
- `bg-vedette-*` — **profondes**, encre blanche pure. **Mobilier** uniquement :
  bandeau d'accueil, panneau d'Alexa, en-tête d'identité, rail actif.

Plus `bg-reflet` (source de lumière posée sur une vedette), `bg-rail`,
`bg-rail-halo`, `bg-rail-actif`, `bg-orbe-aurore`.

**Ombres teintées** — `shadow-douce` `carte` `elevee` `vedette` `tuile`
`filet`. `lift1/2/3` (gris neutres) sont remplacés partout où une surface a été
redessinée : une ombre grise sur un sol coloré se lit comme de la saleté.

**Rayons** — md 12 · lg 16 · xl 20 · 2xl 26 · **3xl 34** (réservé aux vedettes).

---

## 4. §4.2 — la frontière, et pourquoi elle n'a pas bougé

> Aucun dégradé, aucune lueur, aucun verre derrière une posologie, une dose, un
> score, un montant en ligne de tableau, une note clinique ou **un nom de
> patient**.

Ce n'est pas une règle de style : un fond qui varie fait varier le contraste du
texte qu'il porte, et « 25 mg » contre « 250 mg » ne se lit pas au conditionnel.

Trois endroits où V8 a dû composer avec elle, et comment :

| Surface | Résolution |
|---|---|
| **Barre supérieure** | Reste un **aplat opaque**. Elle porte des noms de patient sur les écrans de personne, et elle est le composant unique et partagé qui garantit la règle par la structure. |
| **En-tête du dossier patient** | Bandeau `vedette-aube` + **plaque d'identité opaque** posée dessus. Le nom, le n° de dossier et le téléphone sont sur du blanc franc ; le dégradé ne porte que les actions et les dates de rendez-vous, qui ne nomment personne. |
| **Carte Alexa du tableau de bord** | **Vide → vedette IA** (elle n'annonce qu'un outil). **Pleine → opaque** : une proposition porte `userUtterance`, la phrase réellement dictée, qui contient souvent un nom, une date ou un montant. Les deux surfaces diffèrent parce que leur CONTENU diffère — c'est la règle, pas une exception à la règle. |

---

## 5. Les primitives construites

### `components/ui/Graphes.tsx` — SVG écrit à la main, zéro dépendance

Pas de recharts : le dépôt tient 5 dépendances d'exécution, le budget se mesure
au build, et une librairie apporte SA palette, SES rayons et SA typographie —
il en reste toujours un morceau qui trahit qu'une partie de l'écran vient
d'ailleurs.

`Aire` · `Etincelle` · `BarresGroupees` · `Anneau` · `Jauge` · `FriseHeures`,
plus `Legende` et le tableau équivalent partagé.

**Deux géométries, et elles diffèrent pour une raison :**
- formes **étirables** (aire, barres, étincelle, frise) → `preserveAspectRatio="none"`,
  aucun texte ni cercle dedans, traits en `vectorEffect="non-scaling-stroke"`,
  libellés et points en HTML par-dessus ;
- formes **circulaires** (anneau, jauge) → carré + `xMidYMid meet`. Un cercle
  étiré est un ovale, et un ovale se lit comme un défaut de rendu.

**Ce qui a migré depuis `PanneauEvolution`** — l'échelle signée qui honore les
négatifs, la marge ajoutée au PLAFOND et non à l'étendue, l'axe UNIQUE pour
deux séries d'argent, le tableau équivalent masqué visuellement sur un `<div>`
enveloppe (jamais sur le `<table>` : `height` y est un minimum, incident
mesuré à 761 px de défilement fantôme).

### `components/ui/Tuile.tsx`

`Tuile` (pastel, six tons) et `TuileVedette` (profonde, une par écran).

**Garde-fou trouvé en capture :** l'étincelle ne s'affiche plus qu'à partir de
4 points ET 2 valeurs non nulles. Sur la série journalière réelle du cabinet —
un jour encaissé, les autres à zéro — elle rendait un triangle plein de la
hauteur de la tuile, qui remontait sous le montant. La place reste **vide**
quand la série ne qualifie pas : on ne remplace pas une tendance absente par
une courbe fabriquée (règle 8).

### `components/ui/Illustrations.tsx`

Quatre scènes duotone géométriques : `agendaVide` `dossierVide` `documentVide`
`assistanteAuRepos`. Socle commun (disque + arc d'horizon) qui les fait lire
comme une famille. **Aucun personnage** — une silhouette humaine dans un
logiciel de psychiatrie finit toujours par ressembler à un patient.

`05-UX-CONTRACT` §3 interdisait les illustrations. **La règle qui survit est la
seconde, pas la première :** une illustration n'excuse jamais une phrase
absente. Chaque scène est posée à côté d'un texte qui dit pourquoi c'est vide
et propose un geste. `aria-hidden` sans exception.

Tons remontés après capture (socle 200, formes 400) : en 100/200 le dessin se
lisait comme une tache.

`EtatVide` gagne `scene` (grands vides) et un **médaillon** en matériau pour le
cas courant — ce qui lift tous les états vides du produit sans toucher un seul
appelant.

---

## 6. Écrans recomposés

| Écran | Ce qui a changé |
|---|---|
| **Coquille** | Rail en matériau (`bg-rail` + halo), entrée active en dégradé + lueur + filet, marque avec sous-titre, compte en carte de chrome. Barre supérieure 68 px, champ de commande en pastille avec orbe d'assistante. |
| **Tableau de bord** | Bandeau d'accueil en vedette (salutation Fraunces, chrono de séance, actions) · 4 tuiles dont une vedette · grille asymétrique : fil de la journée + **charge horaire** + **anneau de répartition** à gauche, contexte patient et Alexa à droite. |
| **Finances** | 5 tuiles · **aire journalière** en dominante (remplace la bande de 31 cases qui disait « plus/moins » sans dire combien) · **barres groupées** 6 mois · **deux anneaux** de composition · attention. Tous les panneaux partagent la grammaire du tableau de bord. |
| **Dossier patient** | En-tête bandeau + plaque d'identité opaque, contexte en pastilles sur le matériau. |
| **Agenda** | Les trois chiffres de la semaine deviennent des tuiles. Blocs colorés par type conservés. |
| **Alexa** | En-tête vedette IA avec orbe et mention d'aide à la décision ; fil opaque ; amorces en pastilles IA. |
| **Documents** | Les trois volets deviennent des surfaces cartonnées ; aperçu vide illustré. |

### Ce qui n'a **pas** été ajouté, et pourquoi

Aucune porte SQL ne les calcule, et les inventer serait une donnée fictive :

- courbe de score d'échelle — `048:113` plafonne à 2 administrations,
  délibérément (« une seule observation ne fait pas une tendance ») ;
- taux d'occupation, durée moyenne de consultation, prévalence des diagnostics ;
- « +2 vs hier », « +12,5 % vs mois dernier » — `dashboard_today` ne rend
  qu'UNE journée ;
- revenu par praticienne — n'existe que dans la porte dormante 036, en
  comptabilité d'engagement ; deux définitions du revenu sur un écran serait
  pire que l'absence.

La charge horaire et la répartition par statut sont des **regroupements** de la
liste déjà chargée, pas des calculs métier — la même donnée, lue autrement.

---

## 7. Vérification

| Porte | Résultat |
|---|---|
| `pnpm typecheck` | **0 erreur** |
| `pnpm lint` (hex, `rgb()`, valeurs arbitraires, jetons) | **0 erreur** |
| `pnpm build` | **vert** |
| `node scripts/audit-classes-mortes.mjs` | **AUCUNE CLASSE MORTE** — 677 classes émises |
| Fontes auto-hébergées | **28 `.woff2`** émis, aucune URL `fonts.gstatic.com` |
| `node scripts/qa-visuelle-v7.mjs` | 11 écrans × 1920/1366/1024, connexion réelle — **aucun débordement horizontal, aucune erreur console** |
| Migrations | **aucune écrite** — V8 est entièrement front |

**Deux passes de critique visuelle menées, captures à l'appui**, et ce sont
elles qui ont trouvé ce qu'aucune porte automatique ne pouvait voir : le
séparateur de milliers invisible, l'étincelle en triangle, le libellé d'anneau
tronqué par-dessus l'arc, le titre « À votre attention » affiché deux fois, les
amorces d'Alexa dupliquées, les illustrations trop pâles, l'aire de 192 px pour
un pic isolé.

---

## 8. Reste ouvert

- `app/documents/page.tsx` porte des chaînes françaises **en dur**
  (« Documents récents », « Choisir un dossier », « Aucun document pour le
  moment ») — violation d'ADR-008 antérieure à V8, non corrigée ici pour ne pas
  dépasser le périmètre. À reprendre.
- Le Mode Séance et le cockpit de réception n'ont **pas** été recomposés : ils
  héritent des jetons, des ombres et des primitives V8 (donc changent
  visiblement), mais leur composition est celle de V7.
- Perf mesurée au `build` seulement — pas de médiane de 3 `next start` chronométrée.
