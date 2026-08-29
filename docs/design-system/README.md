# MindCare OS — Design System V2 : Vibrant Instrument

**Statut : verrouillé 2026-08-29 — remplace tout système antérieur.**
**Cible : PC 1920×1080 (min 1366×768), tablette 1024 icône-rail. Pas de dark mode. Pas de mobile-first.**

## Pourquoi un nouveau système

Le système précédent livrait des cartes blanches sur fond blanc, sans état actif, densité indifférenciée et couleur utilisée comme décoration. La pratique exige 6–8h d'usage continu sur données réelles, sous loi 18-07 — la décoration qui fatigue est un défaut clinique.

V2 s'articule autour de **Quiet Intelligence devenue Vibrant Instrument** :

> Fondation neutre extrêmement raffinée + surfaces structurées discrètes + typographie qui porte 70% de la hiérarchie + couleur sémantique parcimonieuse + marque orientante + **moments vibrants rares** (dégradé / illustration / effet IA sur hero / tuile d'identité seulement).

Si retirer 30% de la décoration améliore la hiérarchie, l'élément n'aurait jamais dû exister.

## Lecture

```
README.md               — ce fichier, carte et build
DESIGN_PHILOSOPHY.md    — principes, 6 niveaux, anti-slop
DESIGN_TOKENS.md        — implémentation tokens.css ↔ Tailwind
COLOR_SYSTEM.md         — hiérarchie 70/15/10, ramps, WCAG
TYPOGRAPHY.md           — Inter 400-800 + Fraunces display + mono
SPACING_AND_GRID.md     — échelle 4pt + grille PC + densité
LAYOUT_SYSTEM.md        — shell, max 1120, cockpit bento
NAVIGATION.md            — rail 248→72, groupes par rôle
COMPONENTS.md           — taxonomie complète + anatomie
COMPONENT_STATES.md     — 15 états obligatoires
DATA_VISUALIZATION.md   — charts décisionnels seulement
MOTION.md               — durées, easing, reduced-motion
ACCESSIBILITY.md        — WCAG AA, focus, clavier, cibles
RESPONSIVE_AND_RTL.md   — PC-first, 1024/1280, RTL Arabe
JARVIS_UI.md            — couche ambiante, 10 états, carte confirmation
HEALTHCARE_PATTERNS.md  — blocs identité, chronologie, posologie, sécurité
UX_PRINCIPLES.md        — 10 principes + contract 5 états
DESIGN_DECISIONS.md     — ADR design, alternatives rejetées, migration
```

## Source unique

`src/styles/tokens.css` — seule source de couleur/espacement/rayon/durée/typo/grille (I10). `tailwind.config.ts` consomme en `var(--*)`, ne définit jamais de littéral hors `screens`/`outline`/`min 0`. Violer = rejet revue.

## Build & vérification

```
pnpm typecheck   — 0 erreur (strict, noUncheckedIndexedAccess)
pnpm lint        — 0 erreur (no-restricted-imports porte DbPort)
pnpm build && pnpm start  — mesure perf §06-PERF-BUDGET
grep -r "gradient(" src/ — 0 hors tokens.css (hors tuiles autorisées)
grep -r "#[0-9a-fA-F]\{3,6\}" src/components — 0 hex hors tokens
```

## Rôles

- `owner`/`practitioner` — navigation complète, RLS cloisonne lignes (patients/revenus).
- `assistant` — rail réduit (Tableau + Agenda uniquement), jamais clinique.
- Jarvis hérite des permissions humaines, jamais d'élévation.

## Environnements

Light-only. `--night-*` déclarés mais non mappés Tailwind — poser `class="dark"` ne produit rien (volontaire, § ACCESSIBILITY).
