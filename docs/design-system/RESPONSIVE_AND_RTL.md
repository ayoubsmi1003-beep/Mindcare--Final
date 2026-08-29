# RESPONSIVE_AND_RTL — MindCare V2 (PC)

> MindCare est un OS de poste fixe, pas une app mobile. PC first, pas mobile first.

## 1. Breakpoints (seuls)

```
tablet  1024px  — rail 248 → 72 icônes, contenu reste bento max 1120
desktop 1280px  — gutters max, grilles larges contexte 340 possible
```

Pas de `sm`/`xs` mobile. `tailwind.screens` lit `1024/1280` littéraux (`var()` inopérant).

## 2. Comportements PC

| Largeur | Rail | Grille | Notes |
|---|---|---|---|
| ≥1920 (cible) | 248 | 4 colonnes `fiche`, 3 finance 40/32/28, pouls×5 | poste cabinet, optimal |
| 1366 min | 248 | 2-3 cols auto-fit, pouls wraps 5→3+2 | vérifié |
| 1280 | 248 | idem, contexte 340 possible | — |
| 1024 | **72** compact icônes | 2 cols, cartes `min 240` | `LIBELLE_REPLIABLE` a11y |
| <1024 | reste 72 (pas overlay) | 1 col, charts scroll `min 480`, agenda scroll `day-min 132` | page **ne** scrolle pas horizontal |

**Règle :** page jamais `overflow-x: auto` — chaque tableau/chart porte son propre scroll. `min-h-0` + `overflow-hidden` sur grille isole.

## 3. Dégradation mesurée

- 1280 aucun scroll horizontal `scrollWidth ≤ clientWidth` (contrôle C8a 0px).
- Agenda semaine >132px/col → scroll horizontal conteneur, header sticky, temps vertical fixe.
- Finance chart <480 → scroll, `h2 track` visible.

## 4. RTL — FR/AR/Darija/EN (règle 4 locale)

- `[dir="rtl"], .ar { font-family: var(--font-ar); line-height: 1.8 }` (`tokens 901`).
- `IBM Plex Sans Arabic` subset `arabic` obligatoire (glyphes réels), pas fallback.
- Layout logique : `gap`, `padding-inline`, pas `left/right`. Nav rail miroir droite si `dir=rtl` futur (actuellement `lang=fr` `layout 162` — prévoir `dir` dynamique au routeur).
- Dates/heures : `timestamptz` + bornes `Africa/Algiers` en base, affichage via `Intl` avec locale, chiffres `tabular-nums` restent `Geist Mono` LTR même en RTL (`[dir=rtl] .num` override si besoin).
- Bidirectionnel : noms patients FR/AR mixtes → `unicode-bidi: plaintext` sur identity blocks.
- Nombres/monnaie : `amount_dzd` integer DZD — `1 234 DA`, groupement espace fine, pas virgule US en AR.
- Patient name long : `truncate` + `title`, RTL truncate `direction: rtl`.

## 5. Localisation strings

Aucune chaîne en dur (`i18n/fr.ts` source). Clés `fr.nav.groupes.*`, `fr.coquille.*`, `fr.actions.*`. Vide/erreur confirmés FR, fallback `texteAbsent`.

## 6. Tests RTL

- [ ] Passer `html lang="ar" dir="rtl"` → rail droite, timeline miroir, chiffres restent lisibles.
- [ ] `0` arabe-indic optionnel `font-feature-settings:"locl"` — désactivé V1 (chiffres européens conservés pour DZD).
