# La langue visuelle — V7

## 1. Le principe : deux mondes, pas un

Jusqu'en V6, l'application n'avait **qu'un seul monde neutre**. Un lavage clair
teinté de marque allait du bord gauche au bord droit, et le rail n'était que ce
même lavage en dégradé. Rien ne distinguait **l'outil** de **la matière**.

V7 sépare deux neutres :

| Monde | Rôle | Jetons |
|---|---|---|
| **Chrome** | Le cadre : rail, barre supérieure, panneaux d'outil | `--chrome-*` |
| **Contenu** | La matière : dossiers, notes, montants, agenda | `--canevas`, `--card`, `--ink-*` |

Le cadre recule, la matière avance. C'est cette séparation — et non un choix de
teinte — qui fait qu'un instrument professionnel se lit comme un instrument.

**Conséquence pratique :** la couleur de marque ne teinte plus le fond de
l'application. Elle est donc redevenue *signifiante* : `--action-600` désigne
une action, une sélection ou un état, et rien d'autre.

## 2. L'atmosphère a été retirée

`--atmosphere` (trois lavages radiaux de 8 / 5 / 4 %) peignait le sol de toute
l'application en marque. Une couleur présente partout ne désigne plus rien. Le
sol est désormais `--canevas` (`#f4f7f6`), neutre-froid et uni.

Le jeton `--atmosphere` existe encore dans `tokens.css` mais n'est plus consommé
par la racine.

## 3. La couleur

Hiérarchie d'emploi, du plus fréquent au plus rare :

1. **Neutre** — la très grande majorité de la surface (`--canevas`, `--card`,
   `--sunken`, la rampe `--ink-*`).
2. **Chrome** — le cadre (`--chrome-*`), une seule zone, toujours la même.
3. **Marque** — action, sélection, état actif (`--action-*`). Jamais décorative.
4. **Sémantique** — `--attention`, `--critical`, `--positive`. Réservée au sens.
5. **IA** — `--ai-*`, la seule famille qui appartient à Alexa.

### Le rouge est un budget

`--critical` est réservé à la perte de donnée et au risque clinique. **Un
rendez-vous annulé, un impayé ou un statut « non présenté » ne sont pas des
erreurs** : ils utilisent `--attention` ou l'atténuation. Cette règle vient de
`04-DESIGN-SYSTEM.md` §3.1 et survit telle quelle.

### Les dégradés

Autorisés, mais ce ne sont pas le système. Emplois retenus en V7 :

- l'écran de connexion (`--grad-auth`) ;
- l'orbe d'Alexa (`--grad-orb`) ;
- l'en-tête du panneau Alexa (`--grad-tile-ai`) — l'identité de l'assistant.

**Interdit derrière** : une posologie, une dose, un score, une note clinique,
une transcription, un montant, une date de rendez-vous, un nom de patient.
Le contraste d'un dégradé varie d'un bout à l'autre ; sur « 25 mg » contre
« 250 mg », le coût d'une lecture ambiguë n'est pas esthétique.

> **Retirés en V7 :** le héros `--grad-brand` en tête de chaque écran, le
> dégradé du rail, le dégradé du bouton principal, `--grad-tile-brand` sur les
> tuiles financières. Voir `DESIGN_DECISIONS.md`.

## 4. La profondeur

`--lift-0` à `--lift-3`. Des ombres **vertes froides**, jamais grises : une
ombre neutre sur un fond légèrement teinté se lit comme de la saleté.

Chaque ombre porte **un décalage et un flou**, parce qu'elle vient d'une
lumière. **Un halo coloré à décalage nul n'est pas de la profondeur, c'est de
la décoration** — c'est la raison pour laquelle `hover:shadow-glow-brand` a
quitté le bouton principal.

### La lueur est une liste fermée

`--glow-brand` / `--glow-ai` ont **trois** emplois, et pas un de plus :

1. l'orbe d'Alexa ;
2. la carte de confirmation d'une écriture ;
3. — *(l'entrée de navigation active l'a quittée en V7 : le rail chrome n'en a
   plus besoin, l'aplat suffit).*

Si tout brille, plus rien n'est signalé.

## 5. Le verre

`--glass-panel` + `--glass-blur` habillent **le mobilier flottant uniquement** :
le panneau Alexa, la carte de confirmation. Jamais une surface qui porte une
valeur.

## 6. La géométrie

Une seule grammaire de forme sur tout l'écran : `--r-lg` (14 px) pour les
commandes et les entrées de rail, `--r-xl` (20 px) pour les cartes,
`--r-full` réservé aux pastilles et aux avatars.

> Les boutons étaient `rounded-full`. La pastille pleine est une forme de
> produit grand public ; l'outil professionnel partage la géométrie de ses
> cartes et de ses champs.

## 7. Le mouvement

Durées : `--d-instant` 90 ms · `--d-quick` 160 ms · `--d-normal` 240 ms ·
`--d-slow` 380 ms · `--d-scene` 600 ms.

- La transition ordinaire est `--d-quick`, sur la couleur et l'ombre.
- **Un seul moment orchestré dans tout le produit** : le Mode Séance
  (`MODE_SEANCE.md`). Le plancher de craft n'en tolère qu'un, et c'est celui-là.
- **Ce qui ne bouge jamais** : une valeur clinique affichée, un montant, le
  contenu d'une carte de confirmation, un aperçu de document.
- `prefers-reduced-motion: reduce` ramène toute animation à 0.01 ms
  (`tokens.css`, couche de base).

## 8. Les surfaces du navigateur

Sélection, curseur de saisie et barres de défilement sont habillés
(`::selection`, `caret-color`, `::-webkit-scrollbar`). Le chrome sombre et le
Mode Séance ont leur propre teinte de barre.

C'est le signal le moins cher qu'un écran a été **dessiné** plutôt
qu'assemblé — et celui qu'on oublie le plus systématiquement.
