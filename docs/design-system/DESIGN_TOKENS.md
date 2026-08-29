# DESIGN_TOKENS — Implémentation

**Fichier maître : `src/styles/tokens.css` (unique source). Consommateur : `tailwind.config.ts`.**

## 1. Architecture 3 couches

```
Primitif  (--brand-600 #2A7A70, --ink-900 #0B1614, --s-4 16px)
   ↓
Sémantique (--action-600 → brand-600, --attention-ink, --layer-ambient)
   ↓
Composant (--glow-nav, --grad-tile-brand, --kind-suivi-accent)
```

**Règle :** un composant référence le rôle, jamais le primitif. `text-action-600`, jamais `text-brand-600` hors navigation. `text-attention-ink`, jamais `text-attention` sur fond clair.

## 2. Mapping Tailwind

| Token CSS | Tailwind | Usage |
|---|---|---|
| `--ink-900/700/500/300/100` | `text-ink-*`, `bg-ink-*`, `border-ink-*` | encres + filets |
| `--brand-*` | `bg-brand-*`, `text-brand-*` | rampe marque seule, nav active |
| `--action-600/700/900` | `bg-action-*`, `text-action-*` | actions primaires (3 états repos/survol/enfoncé) |
| `--ai-600/700` | `bg-ai-*`, `text-ai-*` | Jarvis exclusivement |
| `--info-600` | `bg-info-600` | info secondaire |
| `--attention + --attention-ink` + `attention-bg` | `text-attention-ink`, `bg-attention-bg` | sémantique ambre — **texte toujours `ink`, jamais DEFAULT sur bg** |
| `--critical`, `critical-bg` | `bg-critical`, `bg-critical-bg` | disque, perte données — 6.54/5.74 ok |
| `--positive`, `positive-bg` | `bg-positive`, `bg-positive-bg` | succès — 5.06/4.56 ok |
| `--layer-ambient/surface/raised` | `bg-layer-*` | sols / cartes / élevé |
| `--glass-panel` | `bg-glass-panel` | panneau Jarvis seul |
| `--grad-*`, `--atmosphere` | `bg-grad-*`, `bg-atmosphere` | L6 moments seulement |
| `--s-1..16` | `p-1..16`, `gap-1..16`, `m-*` | espacement |
| `--r-sm..full` | `rounded-sm..full` | radius |
| `--text-*` | `text-display/title/heading/body/notes/label/eyebrow/num` | échelle typo |
| `--weight-*` | `font-regular/medium/semibold/bold/extrabold` | 400-800 mapping |
| `--e-*`, `--d-*` | `ease-*`, `duration-*` | motion |
| `--lift-1..3`, `--glow-*` | `shadow-lift*`, `shadow-glow-*` | élévation |

`darkMode` absent — volontaire. `night-*` déclarés mais non exposés.

## 3. Nouvelles règles V2

- `--weight-bold 700` / `--weight-extrabold 800` ajoutés pour hiérarchie 700 titres page / 800 metrics.
- Zéro oval : `font-variant-numeric: tabular-nums; font-feature-settings:"tnum"1,"zero"0,"ss02"0` sur `html,body,.num` — interdit `slashed-zero`.
- `--kind-psychotherapie-accent` corrigé `#2b7a9b → #247095` (4.24→4.83:1) WCAG AA.
- Tons 400 (`brand-400 2.32:1`, `azure-400 3.26:1`…) documentés comme **jamais texte sur blanc** — accent graphique seul.

## 4. Usage en composant

```tsx
// ✅ correct
<span className="text-ink-900">Nom patient</span>
<div className="bg-attention-bg text-attention-ink">Bandeau</div>
<button className="bg-action-600 hover:bg-action-700 active:bg-action-900 text-on-brand">
  Démarrer séance
</button>

// ❌ rejet
<div className="bg-[#b8763a] text-white"> // hex litéral
<span className="text-attention">Texte sur attention-bg // 3.34:1 fail
<span style={{ color: '#2a7a70' }}> // inline
```

## 5. Vérification

```bash
grep -rn "gradient(" src/          # 0 hors tokens.css (tuiles listées)
grep -rn "#[0-9a-fA-F]\{3,6\}" src/components  # 0
pnpm build | grep woff2            # 26+ fichiers, dont Inter 700/800 et Fraunces 700/800
```

## 6. Ajout futur

Un jeton ajouté → choisir couche, documenter usage + états, vérifier contraste, exposer alias Tailwind correspondant, nommer en `kebab` cohérent avec `--action-*` / `--kind-*`.
