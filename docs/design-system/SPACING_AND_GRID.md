# SPACING_AND_GRID — MindCare V2

## 1. Échelle 4pt (unique source `tokens.css:469`)

```
--s-1  4px   --s-4 16px  --s-8  32px  --s-16 64px
--s-2  8px   --s-5 20px  --s-10 40px
--s-3 12px   --s-6 24px  --s-12 48px
```

Tailwind `p-1..16` → `var(--s-*)`, `m-*` idem, `gap-*` idem. Aucun `13px/17px/27px` sans justification. `0` universel sans token.

## 2. Usages verrouillés (PC)

| Contexte | Valeur | Token | Règle |
|---|---|---|---|
| Page gutters | `px-6` 24px + `py-8` 32px | `px-6 py-8` sur `<main max-w-main>` | centre `1120px` max |
| Section gap | `gap-5` 20px / `gap-6` 24px | `gap-5/6` | entre blocs majeurs |
| Card padding | `p-4` 16px compact, `p-6` 24px confort | `p-4/6` | jamais `p-3` aléatoire |
| Component gap intra | `gap-3` 12px / `gap-4` 16px | | boutons côte à côte |
| Texte bloc | `gap-2` 8px titre+meta, `leading 1.55` | | 14px body |
| Form field stack | `gap-4` 16px champ, `gap-2` label+input | | `target 36/44` |
| Table row | `py-3 px-4` | | `min-h-target 36` |
| Modal | `p-8` 32px + `gap-4` header/corps | | `shadow-lift3` |
| Nav rail | `px-3 py-5 gap-5` (compact 72), `px-4` desktop | | `min-h-target` items |

## 3. Densités (sessions longues)

| Mode | Carte | Ligne table | Gutter | Quand |
|---|---|---|---|---|
| **Comfortable** | `p-6` | `py-4 16px` | `gap-6` | consultation notes, lecture 15px 1.7 |
| **Standard** (défaut) | `p-4/6` | `py-3 12px` | `gap-4` | patients, agenda, finance |
| **Compact** | `p-3` | `py-2 8px + 12px text` | `gap-3` | agenda semaine dense, tables >50 lignes |

Compact ne descend jamais sous `12px` corps (lisibilité), conserve `36px` hit target via `min-h-target`.

## 4. Grille PC

```
--grid-nav-width 248px          — rail fixe desktop
--grid-nav-compact 72px         — rail icônes <1024
--grid-main-max 1120px          — contenu centré
--grid-context-width 340px      — contexte repliable (futur)
--grid-day-min 132px            — colonne jour agenda min (mesuré, avant 7458px haut)
--card-column-min 240px         — colonne fiche min
--chart-min-width 480px         — graphique financier min (31 barres ≥3px)
```

Tailwind `grid-cols-*` sont **remplacés** (pas étendus) : `app`, `app-compact`, `fiche auto-fit`, `finance 40/32/28fr`, `pouls×5`, `cockpit 2:1`, `reception 1.35/0.85/0.8fr`, `receptionMiddle 1.85:1`, `receptionBottom 1:1.45:1`. `minmax(0,1fr)` partout pour autoriser compression sans overflow. Classe `grid-cols-3` Tailwind natif **n'existe pas** — utiliser `grid-trois`.

## 5. Radius & bordures

```
--r-sm 6px   bouton secondaire
--r-md 10px  input/select
--r-lg 14px  carte
--r-xl 20px  hero/empty disc
--r-full 999px pill/nav-active
--rule-width 1px unique trait; --kind-accent-width 3px liseré catégorie
```

Shape lock : carte 14, input 10, pill full — pas de mélange.

## 6. Breakpoints (PC-first)

- `tablet 1024` — rail replie 248→72, contenu reste bento.
- `desktop 1280` — gutters max, grilles larges.
- Pas de `sm/mobile` first — 1920 cible, 1366 min vérifié. Pas de hamburger, pas de bottom nav.

## 7. Test respiration

Chaque page doit *respirer* : au moins `gap-5` entre sections, `card p-6` sur fonds neutres, pas de bordure supplémentaire si carte déjà détachée par `layer-ambient`.

## 8. Implémentation

Toutes valeurs via `var(--s-*)` / Tailwind spacing. `style={{padding:13}}` = rejet.
