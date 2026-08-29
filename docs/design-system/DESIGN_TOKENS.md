# Les jetons — et le piège qui a coûté quatre refontes

## 1. ⚠️ LE PIÈGE DU NO-OP SILENCIEUX

**À lire avant d'écrire une seule classe Tailwind dans ce dépôt.**

`tailwind.config.ts` **REMPLACE** chaque échelle au lieu de l'étendre
(`theme.colors`, `theme.spacing`, `theme.screens`… sont posés à la racine de
`theme`, pas dans `theme.extend`). C'est délibéré : la palette par défaut de
Tailwind est désactivée pour que toute valeur soit un alias de jeton (I10).

**Conséquence :** toute classe Tailwind dont la valeur n'est pas déclarée dans
ce fichier **n'émet aucun CSS — silencieusement, sans erreur de build, sans
avertissement**. La classe reste dans le `className`, le style n'existe pas.

C'est la cause technique principale des refontes précédentes. À l'ouverture de
V7, l'arbre contenait, entre autres :

| Famille morte | Occurrences | Effet réel |
|---|---|---|
| `gap-1.5`, `py-3.5`, `px-2.5`, `mt-0.5`… | 45 | aucun espacement |
| `h-9`, `h-11`, `h-14`, `h-20`, `w-9`… | 41 | aucune dimension |
| `bg-amber-50`, `text-amber-700`, `border-amber-100` | 9 | **bannière hors-ligne et bloc d'erreur sans fond** |
| `bg-white`, `text-white`, `bg-white/10` | 15 | aucune couleur |
| `rounded-2xl` | 12 | angle droit |
| `grid-cols-2`, `lg:`, `xl:` | 8+ | aucune grille, aucune rupture |
| `tracking-tight`, `leading-tight`, `leading-none` | 17 | aucun effet |
| `max-w-sm`, `max-w-md`, `opacity-60/70` | 7 | aucune contrainte |
| `text-metric` | — | jetons présents, **classe absente** |

### La procédure obligatoire

Avant de livrer une classe nouvelle, **vérifier qu'elle émet** :

```bash
echo 'export const P=()=><div className="ma-classe"/>;' > /tmp/probe.tsx
node node_modules/tailwindcss/lib/cli.js -i src/styles/tokens.css -o /tmp/out.css --content /tmp/probe.tsx
grep -c '\.ma-classe' /tmp/out.css   # 0 = la classe est morte
```

Un `pnpm typecheck` vert et un `pnpm lint` vert ne disent **rien** à ce sujet.

## 2. Où vit quoi

```
src/styles/tokens.css   la VALEUR      --chrome-900: #0e1a18;
tailwind.config.ts      le NOM         chrome: { 900: "var(--chrome-900)" }
un composant            l'USAGE        className="bg-chrome-900"
```

Aucune valeur littérale ne descend plus bas que `tokens.css`. `eslint.config.js`
interdit le hex, `rgb()/hsl()`, les valeurs Tailwind arbitraires (`w-[420px]`)
et les littéraux dimensionnels dans un `style={{}}`.

## 3. Les familles

### Chrome — V7
`--chrome-900/800/700/600`, `--chrome-rule`, `--chrome-ink`,
`--chrome-ink-soft`, `--chrome-ink-faint`, `--chrome-actif-bg`,
`--chrome-survol-bg`, `--chrome-voile`, `--chrome-voile-faible`.

> **Les surfaces translucides sont des jetons nommés, et c'est structurel.**
> Tailwind ne sait pas injecter d'alpha dans un `var()` : `bg-chrome-ink/10`
> ne fonctionnerait pas. C'est exactement pourquoi `bg-white/10` était mort
> dans 37 endroits du dépôt.

### Contenu
`--canevas` (le sol), `--card`, `--sunken`, `--rule`, rampe `--ink-900…100`.

### Marque et rôles
Rampe `--brand-900…050` (ADR-022, teal pipetté du logo réel `#7CB5AC`).
Couche de RÔLE par-dessus : `--action-*` (action), `--ai-*` (Alexa),
`--info-*`. **Un composant écrit `bg-action-600`, jamais `bg-brand-600`** : la
palette dit quelle couleur existe, le rôle dit à quoi elle sert.

### Sémantique
`--attention` / `--attention-bg` / `--attention-ink`, `--critical` /
`--critical-bg`, `--positive` / `--positive-bg`.

> `--attention` (3.69:1) est un **accent**, pas une encre de texte. Le texte sur
> `--attention-bg` utilise `--attention-ink` (5.67:1).

### Nuit — Mode Séance
`--night-bg`, `--night-card`, `--night-rule`, `--night-ink`,
`--night-ink-soft`. Voir `MODE_SEANCE.md`.

### Espacement
Échelle de 4 px indexée : `1`=4 … `6`=24, `7`=28, `8`=32, `9`=36, `10`=40,
`11`=44, `12`=48, `14`=56, `16`=64, `18`=72, `20`=80, `24`=96, `32`=128,
plus `px` et les demi-pas `0.5`/`1.5`/`2.5`/`3.5`.

### Rayons
`--r-sm` 6 · `--r-md` 10 · `--r-lg` 14 · `--r-xl` 20 · `--r-2xl` 24 ·
`--r-full`.

### Coquille — V7
`--rail-largeur` 244 · `--rail-compact` 68 · `--topbar-hauteur` 60 ·
`--gouttiere` 28 · `--rang-hauteur` 44 · `--tete-tableau-bg`.

## 4. Ce qui reste déclaré mais inutilisé

Honnêteté du répertoire : ces jetons existent encore dans `tokens.css` et ne
sont plus consommés par aucun composant.

| Jeton | Statut |
|---|---|
| `--atmosphere` | retiré de la racine en V7 |
| `--grad-brand`, `--grad-hero-reflet` | vivaient sur le héros, supprimé |
| `--grad-tile-brand/info/amber/positive/coral` | tuiles décoratives, retirées |
| `--glow-nav` | l'entrée active du rail est un aplat |
| `--grid-nav-width`, `--grid-main-max` | remplacés par `--rail-*` / pleine largeur |

Ils ne sont pas supprimés dans ce lot : un jeton retiré pendant qu'un composant
le référence encore rend une surface transparente sans erreur. Leur suppression
demande son propre passage, vérifié à l'écran.
