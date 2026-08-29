# Design system MindCare — V7

**Statut : en vigueur, 2026-08-29. Remplace tout système antérieur.**

Ce répertoire décrit **ce qui est livré**, pas ce qui serait souhaitable. Chaque
règle ici correspond à du code que l'on peut ouvrir, et chaque valeur de
contraste a été mesurée, pas estimée. Une règle qu'aucun fichier n'applique n'a
rien à faire dans ce répertoire — c'est exactement ce qui a fait échouer les
quatre tentatives précédentes.

> ⚠️ **La leçon des quatre échecs.** La cinquième version de ce répertoire
> (18 fichiers, 1 177 lignes, écrits le 2026-08-29 à 01h49) décrivait un
> produit qui n'existait pas : la doctrine était bonne, l'application n'avait
> pas bougé. Une documentation de design ne vaut que par le diff qui
> l'accompagne. **Documenter après avoir implémenté, jamais l'inverse.**

---

## Autorité

Ce répertoire remplace `04-DESIGN-SYSTEM.md` (jetons visuels) et
`05-UX-CONTRACT.md` (états d'écran), supprimés du dépôt.

**Les règles de SÛRETÉ que ces deux documents portaient ne sont pas
abandonnées** : elles sont reprises ici, et pour deux d'entre elles rendues
structurelles plutôt que disciplinaires (voir `DESIGN_DECISIONS.md`).

La hiérarchie d'autorité de `DOC-AUTHORITY.md` §1 reste vraie ; ce répertoire y
prend la place des deux fichiers cités. En cas de conflit :

```
migration appliquée  >  CLAUDE.md  >  00-DECISIONS (ADR)  >  ce répertoire
```

---

## Les documents

| Fichier | Ce qu'il fixe |
|---|---|
| `VISUAL_LANGUAGE.md` | Les deux mondes (chrome / contenu), la couleur, la profondeur, le mouvement |
| `DESIGN_TOKENS.md` | Les jetons, leur mapping Tailwind, **et le piège du no-op silencieux** |
| `TYPOGRAPHY.md` | Les rôles typographiques et leur emploi |
| `LAYOUT_SYSTEM.md` | La coquille, les compositions par écran |
| `NAVIGATION.md` | Le rail, la barre supérieure, la composition par rôle |
| `COMPONENTS.md` | L'inventaire réel des primitives et leur API |
| `UX_CONTRACT.md` | **Les 5 états obligatoires** — repris de `05-UX-CONTRACT.md` |
| `ACCESSIBILITY.md` | Le plancher, avec les contrastes mesurés |
| `MODE_SEANCE.md` | Le seul moment orchestré du produit |
| `JARVIS_UI.md` | La langue visuelle de l'assistant |
| `RESPONSIVE_AND_RTL.md` | Les ruptures réelles, et l'état honnête du RTL |
| `DESIGN_DECISIONS.md` | Ce qui a été retiré en V7, et pourquoi |

---

## Cible

Poste du cabinet : **1920 × 1080**. Secondaire : 1366 × 768. Plancher
supporté : **1024** (rail replié en icônes).

**Pas de dark mode global** — `darkMode` est délibérément absent de
`tailwind.config.ts`. La seule surface sombre du produit est le **Mode Séance**,
et c'est un écran, pas un thème.

**Pas de mobile-first.** L'application est un instrument de bureau, utilisé
assise, six à huit heures par jour, sur un écran fixe.

---

## Les trois invariants d'implémentation

Ils ne sont pas des conseils : le lint ou le build les font respecter.

1. **`src/styles/tokens.css` est la seule feuille de style du dépôt.**
   `scripts/preflight.sh` §6ter rejette tout second `.css`.

2. **Aucune couleur ni dimension en dur dans `src/`.**
   `eslint.config.js` interdit les valeurs Tailwind arbitraires (`w-[420px]`),
   le hex, `rgb()/hsl()`, et les littéraux `px/ms/%` dans un `style={{}}`.
   Toute valeur visuelle existe d'abord comme jeton.

3. **Un écran = un appel serveur.** `docs/06-PERF-BUDGET.md` reste la
   référence ; la refonte V7 n'a ajouté aucun appel.
