# Les primitives — inventaire réel

Tout vient de `@/components/ui` (barrel `src/components/ui/index.ts`).
**52 fichiers l'importent** : une signature qui change ici change partout.

## Action — `Bouton.tsx`

```ts
type RangBouton = "principal" | "secondaire" | "discret"
Bouton({ children, rang?, retrait?, type?, onClick?, disabled?, pleineLargeur?, deploye? })
LienBouton({ href, children, rang?, retrait?, pleineLargeur? })
BarreActions({ children })
```

| Rang | Traitement |
|---|---|
| `principal` | aplat `--action-600`, blanc pur (5.10:1). **Un seul par vue.** |
| `secondaire` | `--card`, bordure `--rule` |
| `discret` | transparent, `--ink-500` |
| `retrait` | bordure `--attention` — un acte qu'on retire, pas qu'on détruit |

**Il n'existe pas de rang « destructif » rouge, et c'est délibéré** : le rouge
est un budget réservé à la perte de donnée.

Géométrie `rounded-lg`, cible `min-h-target`, `active:scale-95` (retour de
pression — la cible est déjà acquise, rien ne se déplace sous le curseur).

## Surfaces — `Surfaces.tsx`

```ts
type NiveauDecor   = "primaire" | "secondaire" | "action" | "ia"
type NiveauPorteur = "clinique" | "financier" | "document"
Carte({ children, niveau?, interactive?, lueur? })
```

> ⚠️ **L'union discriminée est le garde-fou.** `lueur` est `never` sur les
> niveaux PORTEURS (ceux qui portent une valeur clinique ou financière). Ne pas
> l'aplatir en `lueur?: boolean` : ce serait rendre au relecteur une
> responsabilité que le compilateur assume aujourd'hui.

`interactive` change **l'ombre et la bordure, jamais la position** : une carte
qui se soulève sous le curseur déplace la cible qu'on vise.

Aussi : `PastilleIcone`, `Section`, `PanneauInfo`, `GrilleChamps`.

> `EnTeteEcran`, `EnTetePage` et `MetaHeros` ont été **supprimés** en V7. Voir
> `DESIGN_DECISIONS.md` D-V7-1.

## Saisie — `Champs.tsx`

`ChampTexte` · `ChampSelection` · `ChampZoneTexte` (`clinique` → rôle `notes`) ·
`ChampRecherche`.

Socle commun : libellé au-dessus, aide et erreur en dessous, câblés par
`aria-describedby` / `aria-invalid`. Cible `min-h-target`.

## États — `Etats.tsx`

`BandeauHorsLigne` · `BlocErreur` · `EtatVide` · `Squelette` ·
`IndicateurEnregistrement` · `Champ` (lecture seule).

Contrat complet : `UX_CONTRACT.md`.

## Information

`Badge` (`neutre | attention | positif | information` — **pas de rouge**) ·
`Chiffre` · `Avatar` (**monogramme, jamais une photo**).

## Structure

`Onglets` / `PanneauOnglet` — contrat `role="tablist"` complet : tabindex
glissant, flèches avec bouclage, `Home`/`End`, activation automatique.

`EspaceTravail` (travail / contexte) · `SectionPliable` — le contenu replié est
**retiré du DOM**, pas masqué.

## Icônes — `Icones.tsx`

SVG écrits à la main, aucune dépendance. Trait 1.75, grille 24, capuchons
ronds. Tailles `16 | 20 | 24`. `aria-hidden` sauf si `titre` est fourni.

> ⚠️ `TRACES: Record<NomIcone, …>` est indexé sur `keyof fr.nav.ecrans` :
> **ajouter un écran sans son icône ne compile pas.**

## Ce qui n'existe toujours pas

`Tableau` et `Toast` restent différés. Les tableaux du produit (annuaire,
séances, charges) sont composés sur place. Une primitive de tableau reste le
manque le plus net de l'inventaire — l'application est de forme tabulaire, et
les jetons `--rang-hauteur` / `--tete-tableau-bg` l'attendent.
