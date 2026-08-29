# Ruptures, et l'état honnête du RTL

## Les ruptures

| Nom | Largeur | Effet |
|---|---|---|
| `md` | 768 px | déclaré, peu employé |
| `tablet` / `lg` | 1024 px | **plancher supporté** |
| `desktop` / `xl` | 1280 px | **le rail reprend ses libellés** |
| `2xl` | 1600 px | réserve |

Cible principale : **1920 × 1080**, le poste du cabinet. Secondaire :
1366 × 768.

> `lg` / `xl` / `md` n'existaient pas avant V7 : `theme.screens` étant remplacé,
> huit variantes `lg:` du dépôt tombaient dans le vide, dont `lg:p-8` sur
> l'en-tête et `lg:grid-cols-2` sur Documents.

## Comportement

- **1280 et au-delà** : rail complet à 244 px.
- **1024 → 1279** : rail replié en icônes (68 px). Les libellés sortent du flux
  visuel et **restent dans l'arbre d'accessibilité**.
- **Sous 1024** : non supporté. Pas de mobile-first — l'application est un
  instrument de bureau.

Le contenu large (grille d'agenda, tableaux) **défile dans son conteneur**,
jamais en poussant la page.

> ⚠️ **Ne pas mesurer un débordement avec `documentElement.scrollWidth`.**
> `getBoundingClientRect` et `scrollWidth` ignorent le clipping d'un ancêtre :
> une grille qui défile correctement dans sa boîte est annoncée comme un
> débordement du document. `scripts/qa-visuelle-v7.mjs` teste le
> **comportement** — la page défile-t-elle vraiment.

## RTL et localisation — l'état réel

**Ce qui existe :**

- `--font-ar` (IBM Plex Sans Arabic) est **réellement chargée**, sous-ensemble
  arabe compris.
- `[dir="rtl"], .ar` bascule la famille et l'interligne (1.8) dans `tokens.css`.
- L'en-tête du certificat A5 rend son bloc arabe avec sa propre métrique.

**Ce qui n'existe pas, et qu'il ne faut pas croire acquis :**

- `<html lang="fr">` est **en dur** dans `src/app/layout.tsx`.
- **Aucun attribut `dir` n'est posé nulle part** dans `src/`.
- Il n'y a **qu'un seul catalogue**, `src/i18n/fr.ts`. Pas de `en.ts`, pas de
  `ar.ts`, aucun mécanisme de bascule.
- Les compositions n'ont **jamais été rendues en miroir**.

En clair : le produit est **francophone, LTR**, avec le support typographique
d'un bloc arabe **dans un document imprimé**. Le multilingue et le RTL
d'interface sont un chantier à part entière — catalogue, `dir` dynamique au
routeur, miroir des grilles, relecture des icônes directionnelles — et
prétendre le contraire coûterait une session de reprise.

Ce que V7 n'a **pas** fait : ajouter du RTL décoratif non testé. Ce que V7 a
fait : ne rien poser qui le rende plus difficile — les compositions sont en
flex/grid logiques, sans marges gauche/droite codées en dur.
