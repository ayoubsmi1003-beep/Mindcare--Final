# TYPOGRAPHY — MindCare V2

## 1. Familles (chargées `next/font/google`, zéro réseau à l'exécution, 26 woff2 392KB)

| Rôle | Famille | Variable | Poids | Usage |
|---|---|---|---|---|
| **UI principal** | **Inter** | `--font-inter-emise` → `--font-ui` / `--font-inter` | 400,500,600,700,800 | toute interface. 400 corps, 500 label, 600 emphase, 700 page, 800 metrics |
| Fallback UI | Geist | `--font-ui-emise` | 400,500,600 | secours si Inter échoue (I20) |
| Num/data | Geist Mono | `--font-num-emise` → `--font-num` | 400,500 | heures/doses/montants/chrono tabular-nums |
| Display | Fraunces | `--font-display-emise` → `--font-display` | 500,600,700,800 | montants 30-36px uniquement, jamais corps |
| Document | Newsreader | `--font-doc-emise` → `--font-doc` | 400 | aperçus certificats imprimés seulement |
| Arabe | IBM Plex Sans Arabic | `--font-ar-emise` → `--font-ar` | 400,500,600 | RTL transcriptions, interligne 1.8 |

Pas de serif display OS (anti slop). Pas d'Inter 600+ systématique.

## 2. Échelle (définie `tokens.css:531` → consommée `tailwind.fontSize`)

| Nom | Taille / interligne | Graisse | Tracking | Usage |
|---|---|---|---|---|
| display | 30px / 1.15 | **700** | -0.02em | un par vue, titre de page |
| title | 21px / 1.25 | **600** | -0.01em | sections |
| heading | 16px / 1.35 | **600** | -0.005em | cartes/groupes |
| body | 14px / 1.55 | **400** | 0 | texte courant — **400 obligatoire**, ne jamais 600 |
| notes | 15px / 1.7 | **400** | 0 | notes cliniques — plus grand exprès |
| label | 12px / 1.3 | **500** | 0.02em | libellés UI |
| eyebrow | 11px / 1.2 | **600** | 0.09em | MAJUSCULES groupes, kicker |
| num | 14px / 1.4 | **500** | 0 | tabular-nums obligatoire |
| metric | 36px / 1.1 | **800** | -0.02em | `--text-metric-*` display exceptionnel |

**Hiérarchie V2 verrouillée :** 400 corps long-forme → 500 secondaire → 600 emphase/bouton/section → 700 page → 800 metrics hero. Augmenter identité par taille/espace, pas en grasissant le corps.

## 3. Zéro ovale (sans slash) — correction V2

Inter active `slashed-zero` via OT `zero`/`ss02`. Pour dossiers/montants, Ø barre = ambigu. On force ovale partout :

```css
html, body, .num, .tabular-nums, [class*="font-num"] {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "zero" 0, "ss02" 0;
}
.font-display { font-variant-numeric: tabular-nums lining-nums; font-feature-settings:"tnum"; }
```

Tailwind : `tabular-nums` classe conserve, `.num` appliqué colonnes doses/heures. Vérifiable inspect → computed ne contient pas `zero`.

## 4. Règles d'usage clinique

- **Noms patients** — heading 16 600, pas display. Poids distingue, pas taille seule.
- **Dates** — num 14 500 tabular, `Africa/Algiers` calculée en base, jamais JS locale.
- **Posologies** — num tabular, `15mg` sans espace fine ? espace normale, alignée droite en colonne.
- **Montants DZD** — integer, Fraunces 30-36 600/800 ou Inter num 500 tabular, jamais flottant (ADR-018).
- **Statuts** — label 12 500 + puce couleur, jamais couleur seule.
- **Table dense** — 14 body, `leading 1.35`, `tracking 0` — pas 12px body (illisibilité 8h).

## 5. Longueur de ligne & interligne

- Corps max 65ch, notes max 70ch.
- Arabe `1.8` obligatoire (`[dir=rtl]` règle).
- Document imprimé séparé : `--doc-texte 10.5pt / 1.5` en mm/pt, jamais px écran.

## 6. Anti-patterns

- Tout en bold (rejet critique 6.5/10).
- Double font décorative hors doc imprimé.
- Taille arbitraire `text-[13px]` hors échelle.
- Zéro barré dans numéro dossier/reçu (`P-0003` etc.).
