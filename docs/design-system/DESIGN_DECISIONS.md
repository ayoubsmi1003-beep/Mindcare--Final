# DESIGN_DECISIONS — Rationale & migration

## 1. Décisions majeures

### Décision : hiérarchie couleur 70/15/10 + neutres dominants
**Pourquoi :** premium gagné par neutres, pas accent (7 critiques). Test retrait 30% : tout coloré échoue.
**Alternative rejetée :** 5-6 familles également saturées, gradients partout (Vibrant Instrument mal interprété → SaaS slop bruyant).
**Conséquence :** `COLOR_SYSTEM.md` discipline, `atmosphere` subtile 8/5/4%, tiles neutres + vibrant rare L6.

### Décision : Inter 400/500/600/700/800 avec contraste, pas 600–800 partout
**Pourquoi :** corps 400 lisible 6-8h, hiérarchie taille+graisse+espace. Tout bold = fatigue + moins premium (rejet #1).
**Rejeté :** 600/700/800 sans regular (fatigue 14px).
**Implé :** `layout.tsx` Inter added 700,800 + Fraunces 700,800 + `tokens --weight-bold/extrabold` + Tailwind `bold/extrabold`. Body reste 400 obligatoire.

### Décision : zéro oval, pas slashé, tabular partout
**Pourquoi :** `0` vs `Ø` ambigu dossiers/montants. Désactiver OT `zero`/`ss02`.
**Rejeté :** défaut Inter slashé activé via `zero`.
**Implé :** `tokens.css html,body,.num { font-feature-settings:"tnum"1,"zero"0,"ss02"0 }`.

### Décision : gradients moments, pas environnement
**Pourquoi :** canvas quiet nécessaire pour que vibrant parle ; contraste drift sur dégradé (tokens 244 calc 2.11/4.18 fail).
**Rejeté :** gradient sur chaque card/section/métrique (rejet #2, fatigue).
**Implé :** catalogue `grad-brand/auth/orb/tile-*/avatar/empty/reflet` seulement en L6, §4.2 clinique jamais dégradé conservé — formalisé ADR-028 au lieu de "skip ADRs" (rejet #7).

### Décision : charts décisionnels, pas décoratifs
**Pourquoi :** dashboard opérationnel spec (timeline/now/next/attention/waiting/unfinished avant stats).
**Rejeté :** 4 charts dashboard + 5 finance décoratifs (rejet #3).
**Implé :** `DATA_VISUALIZATION.md` max 1-2 micro dashboard, finance jusqu'à 3, `chart-min 480`.

### Décision : icônes comme IA, pas décoration
**Pourquoi :** reconnaissance/scannabilité.
**Rejeté :** icône fill par carte par réflexe (rejet #4).
**Implé :** étendre `Icones.tsx` seulement où aide voisinage, pas remplissage vide.

### Décision : illustrations rétrécies editorial/duotone
**Pourquoi :** empty/onboarding seulement, pas workspace clinique (rejet #5).
**Implé :** `grad-empty` disque, spot A5, pas 3D clay.

### Décision : PC-first, pas mobile-first
**Pourquoi :** poste fixe 1920×1080 principal, patient devant. Mobile hamburger = anti-productif.
**Implé :** breakpoints 1024/1280 seuls, rail 248→72.

### Décision : WCAG corrections appliquées
**Pourquoi :** audit 2026-08-29 : coral600 4.38 fail → ink, azure400 3.26 fail jamais texte, psych #2b7a9b 4.24→#247095 4.83.
**Implé :** `tokens.css` bloc ACCENTS documenté + `kind-psych` corrigé.

### Décision : dark mode non implémenté maintenu
**Pourquoi :** 4 jetons nuit sans rampe = thème à moitié armé pire qu'absent (lisibilité 6h).
**Implé :** `darkMode` absent, `night-*` non exposés — volontaire.

## 2. Alternatives explorées & rejetées

- Editorial Clinical Luxury (Newsreader hero + halftone fort) — trop fragile tables denses.
- Modern Quiet pur (trop plat post ADR-025).
- Sélectionnée : Sophisticated Intelligent Workspace, VARIANCE 3 MOTION 2 DENSITY 5.

## 3. Migration depuis ancien système

| Ancien | Nouveau | Action |
|---|---|---|
| `teal-*` | `brand-*` pipetté #7CB5AC | déjà fait — vérif 0 occurrences |
| `--teal-600 #1B6B63` estimé | `brand-600 #2A7A70 5.10:1` | alias supprimés |
| gradients partout (ouvert) | L6 seulement | retirer `bg-grad-*` hors tuiles/nav/orb/empty |
| 4 KPI saturés | 70 neutral + 1 primaire + accent parcimonieux | re-token cards → `layer-surface` + `liseré` |
| Inter 400/500/600 seul | +700/800 | build vérif woff2 + fallback Geist |
| zéro par défaut Inter | oval forcé | CSS zero 0 |
| tables sans hint | tabular + sticky | `.num` |

## 4. ADR design

- **ADR-028 (nouveau, à numéroter 0NN)** — *V2 Vibrant Instrument restreint* — étend ADR-022/025 : catalogue dégradés ouvert intra-famille pour L6, maintient §4.2 clinique opaque, lock hiérarchie 70/15/10, 6 niveaux, charts décisionnels. Remplace phrase "no other gradient" par "intra-family L6 catalogue".
- Ne jamais éditer migration appliquée — créer `0NN_v2_design_system.sql` si schema impact (pas prévu — visuel seul).

## 5. Checklist livraison V2

- [ ] tokens.css seule source, grep hex 0
- [ ] Inter 700/800 chargés, woff2 ≥28, zero oval inspecté
- [ ] contrasts AA pass list §COLOR, fail list jamais texte
- [ ] 5 états déclenchables tous écrans
- [ ] perf 1 call/400ms dashboard/patients, 2 calls/500ms fiche
- [ ] C8a 0px scroll, C8b focus Anneau blanc, reduced-motion 0
- [ ] Jarvis carte 400ms + allowlist 7
- [ ] docs 18 fichiers présents
