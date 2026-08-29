# MOTION — MindCare V2

> Le mouvement communique l'état, ne décore jamais.

## 1. Échelle (tokens `tokens.css:583`)

```
--e-out  cubic(0.16,1,0.3,1)  — entrée (rapide puis freine) — par défaut
--e-soft cubic(0.4,0,0.2,1)   — doux UI
--e-in   cubic(0.4,0,1,1)    — sortie
--e-spring cubic(0.34,1.56,0.64,1) — orb seul

--d-instant 90ms   — micro feedback (hover)
--d-quick  160ms   — états, focus, bouton
--d-normal 240ms   — drawer léger
--d-slow   380ms   — modal/drawer plein
--d-scene  600ms   — skeleton respire
```

Tailwind `duration-instant/quick/normal/slow/scene` + `ease-out/soft/in/spring`.

## 2. Usages

| Élément | Durée | Easing | Props autorisées | Note |
|---|---|---|---|---|
| Hover/focus | 160 | soft | `transform, opacity, background, border` | jamais `width/height` (layout anim) |
| Active press | 90 | out | `transform scale-[0.98]` | — |
| Drawer Jarvis | 380 | out | `transform translate-x` `opacity` | overlay voile 240 |
| Modal | 240 | out | `transform scale.98→1` `opacity` | `prefers-reduced → 0` |
| Squelette | 600 | soft | `opacity .5→1` `respire` | seule anim infinie |
| Nav active | 160 | soft | `background, shadow` | `glow-nav` composition |
| Skeleton chart | 600 | soft | `opacity` | — |
| Orbe | spring | spring | `transform` | seul spring autorisé |

## 3. Règles strictes

- **Donnée affichée ne bouge jamais** (`05-UX §8`) : montant, posologie, score, note — changement sec, pas de fade.
- **Carte confirmation ne s'anime pas** pendant lecture contenu.
- **Pas de** bounce, confetti, parallax, glow perpétuel, marquee.
- **GPU only** : `transform/opacity` uniquement ; jamais `top/left/width/height` anim.
- `will-change` seulement sur drawer/orb pendant anim, retiré après.

## 4. Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```
(`tokens.css:939`) — toutes transitions coupées, lisible sans anim.

## 5. Orchestration

- Panel Jarvis : `translate-x` + voile opacity, 380 out. Fermeture `Esc` sauf `proposed`.
- Command palette : `scale .98→1` 240 out.
- Stagger liste : pas de stagger — une liste clinique staggerée = risque de rater une ligne. Seule onboarding peut stagger 40ms max, réduit-motion annule.

## 6. Test

- Chrono perf : `duration-*` ne dépasse jamais budget.
- Tab au clavier : focus anneau 160 soft, pas instantané agressif.
