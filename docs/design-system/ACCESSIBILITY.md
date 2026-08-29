# ACCESSIBILITY — MindCare V2

> L'accessibilité est architecture, pas annexe conformité. Poste 8h, stress, patient devant.

## 1. Contraste — mesuré 2026-08-29, non estimé

| Couple | Ratio | Verdict | Règle |
|---|---|---|---|
| ink-900 / white | 18.44:1 | AAA | titres |
| ink-700 / white | 13.09:1 | AAA | corps |
| ink-500 / white | 5.70:1 | AA+ | discret légitime |
| ink-500 / brand-050 | 5.29:1 | AA | discret sur sol |
| brand-600 / white | 5.10:1 | AA | action repos |
| white / brand-600 | 5.10:1 | AA | texte sur brand |
| attention-ink / attention-bg | 5.67:1 | AA | bandeau fictif corrigé |
| attention / attention-bg | 3.34:1 | FAIL | jamais texte |
| positive / white 5.06, /bg 4.56 | AA | — |
| critical / white 6.54, /bg 5.74 | AA | — |
| ai-600 / white 6.46 | AA | — |
| azure-600 / white 6.12 | AA | — |
| coral-ink / white 6.10, /coral-bg 5.20 | AA | texte coral = ink |
| kind-psych #247095 / #E8F2F7 4.83 | AA | corrigé 2026-08-29 |
| kind-premiere #5B5BD6 / #EEEEFB 4.67 | AA | — |
| ink-300 / white 2.66 | FAIL | **jamais texte**, filets/placeholders seulement |

**Hiérarchie ne se fait jamais en baissant contraste** — taille/graisse/pastille seulement. Blanc atténué sur dégradé interdit (tokens 244 calc 2.11 à 4.18 fail).

## 2. Focus

- `outline 2px solid var(--action-600) offset 2` partout.
- Sur marque (rail `grad-auth`, hero, auth) : `sur-marque` → blanc pur 2px (brand disparaîtrait).
- Jamais `outline:none` sans remplaçant ≥ aussi visible.

## 3. Clavier

- Tab order = DOM order ; skip non ajouté (rail fixe seul, main scrolle).
- `Enter/Space` active, `Esc` ferme modal/drawer sauf carte `proposed` (bloque).
- `⌘K/Ctrl-K` ouvre palette/panneau Jarvis, `Esc` ferme si pas de carte.
- Tous contrôles `min-h-target 36` (comfort 44 QR), `min-w-target 36`.
- Rail compact 72 garde hit 40 pastille + 16 padding = 36+.

## 4. Lecteur d'écran

- `cache-visuellement` (`position absolute 1px clip`) — jamais `display:none` (retire arbre).
- `aria-current="page"` sur nav actif, pas couleur seule.
- `role="status/alert/dialog"` pour empty/error/confirmation.
- Libellés rail masqués visuellement restent annoncés.
- `alt` illustration empty disc, `aria-hidden` décor `atmosphere`/`grad-hero-reflet`.

## 5. Formulaires

- Label visible au-dessus, erreur `attention-ink` sous champ proche, `aria-describedby`.
- Placeholder ≠ label ; `ink-300` placeholder ok (non-texte), valeur `ink-900`.
- `is_synthetic` etc. jamais exposés.

## 6. Motion & préférences

- `prefers-reduced-motion` coupe à 0.01ms.
- Pas d'anim dépendante pour lisibilité.
- `prefers-contrast: more` → non géré (hors scope, light-only).

## 7. Cibles & densité

- ≥36px partout, 44px QR (WORKING-CONTEXT §4). Vérifiable `grep min-h-target`.
- Touch spacing ≥8px entre cibles.

## 8. Checklist livraison

- [ ] Axe contrast: tous couples AA (fail list respectée)
- [ ] Focus anneau visible sur grad (blanc) testé 1024 + 1920
- [ ] Tab 39 arrêts, 0 sans anneau (mesure C8b)
- [ ] Lecteur annonce nav actif + empty + error
- [ ] `0` oval non slashé inspecté
