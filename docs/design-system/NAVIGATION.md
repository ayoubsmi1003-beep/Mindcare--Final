# Navigation

## Le rail — `src/components/coquille/Rail.tsx`

Fond `--chrome-900`. 244 px, replié à 68 px sous la rupture `desktop` (1280).

| État | Traitement |
|---|---|
| Actif | aplat `--chrome-actif-bg` + `--chrome-ink` semibold (6.81:1) |
| Inactif | `--chrome-ink-soft` (9.00:1), survol `--chrome-survol-bg` |
| Non construit | `--chrome-ink-faint` (4.72:1) + mention « bientôt », inerte |

L'entrée active est **un aplat, pas une lueur** : la lueur est une liste fermée
de trois usages, et une entrée de navigation présente sur tous les écrans en
ferait le motif le plus fréquent du produit.

### Ce qui a changé

- Fond : `--grad-auth` → `--chrome-900`.
- Deux décors sans information retirés (voile `--grad-hero-reflet`, filet blanc).
- La pastille « OS » retirée.
- Titres de groupe : CAPITALES + interlettrage → casse de phrase, `--chrome-ink-faint`.
- Trois encres au lieu d'une : sur un fond UNI et mesuré, la hiérarchie
  redevient une affaire de valeur. Sur l'ancien dégradé, aucun blanc atténué ne
  passait 4.5:1, d'où la règle « blanc pur partout » et une hiérarchie tenue à
  la seule graisse.
- Le repli passe de `tablet` (1024) à `desktop` (1280) : le rail reprenait sa
  largeur pleine **à partir de** la largeur où il devait se replier.

### Composition par rôle — I12

`NAVIGATION_PRATICIENNE` et `NAVIGATION_ASSISTANTE` sont deux listes distinctes.
Pour l'assistante, le groupe clinique **n'est jamais construit** — pas masqué en
CSS, pas retiré par une condition sur un `<a>` déjà rendu.

> **Ce choix est COSMÉTIQUE et ne protège RIEN.** Seule la RLS Postgres protège
> la donnée (CLAUDE.md règle 4). Il est légitime précisément parce qu'il ne
> prétend rien protéger : on ne choisit qu'une liste d'entrées de menu.

### Le repli garde les libellés lisibles

`LIBELLE_REPLIABLE` sort le texte du **flux visuel** sans le retirer de l'arbre
d'accessibilité. Ce n'est pas `hidden` : un rail d'icônes muet pour un lecteur
d'écran serait un écran de moins, pas un écran plus compact.

## La barre supérieure — `coquille/Topbar.tsx`

60 px, opaque (`--card`), un filet en bas.

`[ titre · sousTitre ]  …  [ champ de commande ⌘K ]  [ actions ]  [ orbe ]`

- **Le champ de commande ouvre Alexa.** Il dit « Demander à Alexa », pas
  « Rechercher » — voir `DESIGN_DECISIONS.md` D-V7-3.
- **L'orbe renseigne, il n'ouvre pas.** Deux commandes pour la même chose, côte
  à côte, feraient hésiter sans rien ajouter.
- Le titre `truncate` et le bloc d'identité `min-w-0` : un titre long rétrécit
  avant de pousser la commande hors de la barre.

## Clavier

⌘K / Ctrl-K ouvre et ferme l'assistant. `Échap` ferme — **sauf si une carte de
confirmation attend une décision** : refermer sur une proposition en attente la
laisserait `proposed` sans que personne ne sache qu'elle existe.
