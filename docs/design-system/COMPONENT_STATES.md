# COMPONENT_STATES — 15 états obligatoires

> En santé, la clarté d'état est sécurité. Un état manquant = bug.

## 1. Matrice

| État | Signal visuel | Exemple bouton | Input | Card | Table |
|---|---|---|---|---|---|
| **default** | `bg-layer-surface / text-ink-900` | `action-600` | `border-rule` | `lift1` | `divide-y` |
| **hover** | `+4% darken 160ms soft` | `action-700` | `border-ink-300` | `lift2` | `bg-sunken` |
| **focus** | `outline 2px action-600 offset2` / `on-brand white` sur grad | idem hover + anneau | anneau | anneau | anneau ligne |
| **active** | `pressed` | `action-900` `scale-[0.98]` | — | `scale-[0.98]` | — |
| **selected** | `bg-action-050 border-action-600 text-action-600` | `ring 2px` | — | `ring` + `glow-brand` | row `bg-action-050` |
| **disabled** | `opacity-disabled .5` + `cursor-not-allowed` + no focus | `disabled` | `bg-sunken text-ink-300` | `opacity .5` | `aria-disabled` |
| **loading** | `squelette respire` + `aria-busy` | label→skeleton 60×16 | champ skeleton | card skeleton | 5 rows skeleton |
| **success** | `positive-bg + positive` tick | `bg-positive` | `border-positive` | bandeau | — |
| **warning** | `attention-bg + attention-ink` 5.67:1 | `attention-ink` | `border-attention` | bandeau | — |
| **error** | `critical-bg + critical 5.74` | `critical-bg` | `border-critical + msg below` | banner | row `critical-bg` |
| **empty** | `grad-empty` disque + phrase + CTA brand | — | placeholder `ink-300` (non-texte) | `EtatPanneau` | "Aucune donnée" + CTA |
| **offline** | `attention-bg` permanent bandeau | `disabled + raison` | lecture seule, écriture bloquée | lecture visible | même |
| **permission** | non construit (I12), jamais masqué | n'apparaît pas | n'apparaît pas | n'apparaît pas | 0 lignes (RLS) |
| **AI working** | `orb puls 600ms spring` + `thinking` | `disabled attentes` | — | bulle "..." | — |
| **pending confirmation** | `CarteConfirmation` flottante `lift3` + `glow-ai` | `Jauge 400ms` avant confirm | — | — | — |

## 2. Règles animation état

- `d-quick 160 soft` pour hover/focus, `d-slow 380` pour drawer/modal, `d-scene 600` pour skeleton only.
- Donnée affichée ne fade/bounce jamais (05-UX §8) — elle change.
- Carte confirmation ne s'anime pas pendant lecture de contenu.

## 3. États interdits

- Spinner infini >10s → bascule `error` avec mot « délai ».
- Erreur + vide superposés → jamais (remplace).
- Focus `outline:none` sans remplaçant.
- Couleur seule pour état (toujours libellé/icône/pastille).

## 4. A11y par état

- Chaque transition reste `prefers-reduced-motion: reduce → 0.01ms`.
- Erreur annoncée `role="alert"`, pending `role="dialog" aria-modal`, loading `aria-busy`, empty `role="status"`.

## 5. Checklist avant vert

- [ ] 15 états maquetés en Story/figma ou déclenchables via props.
- [ ] Contraste vérifié pour chaque couple texte/fond (table § COLOR_SYSTEM).
- [ ] Hit target ≥36 (≥44 QR) tous états sauf disabled.
- [ ] Focus visible sur grad (anneau blanc) testé clavier.
