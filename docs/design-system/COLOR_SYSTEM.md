# COLOR_SYSTEM — MindCare V2

## 1. Discipline

```
70–80% L1-L2 neutres   → canvas #F1F8F6 / paper #FBFCFB / card #FFF / sunken #F2F5F4 / rule #E4EAE8
10–15% L5 marque        → brand-600 #2A7A70 primary (5.10:1), brand-700 #1D5C54 hover, brand-900 #0F2E2A pressed
 5–10% L4 sémantique    → attention-ink, critical, positive
 <5%  L6 vibrant        → dégradés/containers identité seulement
```

Si tout est coloré, rien n'est important. La neutralité gagne les interfaces premium.

## 2. Ramps (lues dans `tokens.css:78`)

| Famille | Tons | Usage texte | Contrast |
|---|---|---|---|
| **ink** | 900 #0B1614, 700 #23342F, 500 #566B65, 300 #8FA39D (non-texte 2.66:1), 100 #D3DEDA | 900 titre, 700 corps, 500 discret 5.70:1 | AA |
| **brand** | 900 #0F2E2A, 800 #16443E, 700 #1D5C54, 600 #2A7A70, 500 #4A9A8E (fail 3.33), 400 #7CB5AC (fail 2.32), 200/100/050 | 600+ texte ok, 500/400 jamais texte | 5.10 |
| **action** | 900→600 alias brand | repos 600 / survol 700 / enfoncé 900 | idem |
| **azure/info** | 700 #1E4E85 8.46:1, 600 #2563A8 6.12:1, 400 #5B92CE 3.26 fail | 700/600 texte, 400 liseré seulement | ok |
| **violet/ai** | ai-700 #3B2F9E 10.07 white, ai-600 #5B4BC4 6.46, ai-500 #7C6BD8 4.24 fail, ai-300 #B3A8ED 2.16 fail | 600/700 texte, 500/300 fond seulement | ok |
| **ambre** | attention-ink #8A5325 6.28, attention #B8763A 3.69 fail, attention-bg #FBF2E9 | texte = **ink** 5.67:1, DEFAULT jamais | 5.67 |
| **coral** | coral-ink #A5432F 6.10, coral-600 #C1594A 4.38 fail, coral-400 #E08B7C 2.58 fail | texte = ink 6.10/5.20 | 6.10 |
| **positive** | #3E7A5E 5.06, bg #EDF5F1 4.56, 700 #2E5C47 7.67 | ok | AA |
| **critical** | #A33A32 6.54, bg #FBEC // 5.74 | budget rouge — disque/perte données seulement | AA |

**Règle V2 WCAG :** tons 400/500 clairs = accent graphique seulement (filet/point/fond). Jamais `text-azure-400` ou `text-coral-600`. Seules variantes `-ink`/`-600`/`-700` sombres portent du texte.

### Correctifs V2 appliqués

- `--kind-psychotherapie-accent` #2b7a9b → #247095 : 4.24→4.83 sur bg #E8F2F7 (AA), white 5.49.
- Documenté : `brand-400`, `brand-500`, `azure-400`, `ai-500`, `coral-400/600` jamais texte sur blanc.

## 3. Sémantique vs décoratif

- Sémantique (`attention-ink/critical/positive`) ne reçoit JAMAIS d'alias rôle — pas de `bg-ai-critical` détourné. Elles communiquent état clinique/attention.
- Décoratif AI (`ai-*`) = Jarvis uniquement, jamais alerte clinique.

## 4. Dégradés — L6 seulement

```
--grad-auth   160deg #0F2E2A→#1D5C54→#2A7A70  — rail nav sombre (white ≥10.88:1)
--grad-brand  135deg #16443E→#2A7A70→#3E8FA8  — hero lieu (une encre: blanc pur)
--grad-orb    radial 30% #7CB5AC→#2A7A70→#16443E — orb Jarvis
--grad-tile-* linear familles — agrégats identité/comptage seulement, blanc pur ≥5:1
--grad-avatar #DCEDE9→#B4D8D1 — monogramme identité (encre #0F2E2A)
--grad-empty  radial #DCEDE9 transparent — disque empty
--grad-hero-reflet radial white 13% — reflet décor sur grad-brand
--atmosphere triple radial 8/5/4% — sol uniquement, jamais sous texte nu
```

**Interdit :** dégradé derrière posologie/dose/score/montant/nom (contrast drift le long du dégradé, § tokens 244).

## 5. Check contrast (mesurés 2026-08-29)

```
ink500/white 5.70 PASS   brand600/white 5.10 PASS   attention-ink/bg 5.67 PASS
positive/white 5.06 PASS  critical/white 6.54 PASS  ai600/white 6.46 PASS
azure600/white 6.12 PASS  coral-ink/white 6.10 PASS white/amber700 6.28 PASS
kind-premiere #5B5BD6/#EEEEFB 4.67 PASS  kind-psych #247095/#E8F2F7 4.83 PASS
```

`--ink-300` 2.66 FAIL volontaire — filets/pastilles seulement.

## 6. Implémentation

- Une seule encre sur dégradé : blanc pur `#FFF`, hiérarchie par taille/graisse/pastille, jamais alpha <1 (tokens 244).
- Ombre teintée `--lift-color` avec `--shadow-color` par tuile, pas gris neutre.

## 7. ADR design

Gradients étendus d'ADR-022 (3 fixes) → ADR-028 : catalogue ouvert **intra-famille** pour tuiles/hero/orb, L4 §4.2 (pas derrière clinique) maintenu. Documenté dans `DESIGN_DECISIONS.md`.
