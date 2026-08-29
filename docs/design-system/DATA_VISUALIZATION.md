# DATA_VISUALIZATION — MindCare V2

> Un chart qui ne répond pas à une question n'existe pas. Dashboard opérationnel ≠ mur de stats.

## 1. Principe décisionnel

Chaque graphique doit améliorer une décision :

| Surface | Question | Viz | Si non, retrait |
|---|---|---|---|
| Dashboard timeline | Où en suis-je dans la journée ? | frise/mini-gantt `FilDeLaJournee` | texte seul |
| Finance évolution | Recette du jour vs. 30j tendance ? | area/line 480min + tooltip tabular | table suffit |
| Finance anatomie | Parts par praticien/heure ? | donut/Bar 1–2 max | chiffres |
| Échelles | PHQ9/GAD7 séance après séance | sparkline sous onglet Clinique | table |
| Attente | Qui attend depuis combien ? | pas de chart — liste | — |

**Règle V2 :** dashboard max 1–2 micro-charts ; finance jusqu'à 3 ; jamais 4+ décoratifs égaux.

## 2. Langage visuel (implémentation)

- **Librairie :** Chart.js ou Recharts (construire; pas inventer). `chart-min-width 480` conteneur scroll, jamais écrasé <3px/bar.
- **Axes :** `ink-500 12 500 0.02` label, `rule #E4EAE8 1px`, gridlines hairline `rule` seulement horizontale, pas verticale lourde.
- **Couleurs séries :** brand-600 primary, azure-600 secondary, amber (attention) tertiary **via accent-bg + ink légende** (jamais `attention` seul 3.34), coral+positive supplémentaires. Jamais sémantique critique/positive détournée pour série.
- **Tooltip :** `card lift2 p2 bg-card + border-rule`, titre `label 12 500`, valeur `num tabular 14 500`, flèche 6px, pas de glass.
- **Légende :** pill point 8px + libellé 12, `gap-3`, sous chart, jamais sur chart.
- **Grid :** `lift1` sur conteneur, `p6` padding chart.

## 3. États

- `loading` → skeleton `h48 bg-sunken respire`
- `insufficient data` → "Données insuffisantes — 3 séances minimum pour tendance" + `grad-empty` disque
- `empty` → `EtatPanneau` "Aucun encaissement aujourd'hui — tarifs fin séance apparaissent ici"
- `error` → banner critical-bg + "Impossible de charger" + Réessayer
- `offline` → chart grisé `opacity-disabled` + bandeau attention, données last-known restent

## 4. Trend clinique spécifique

Sous `PanneauClinique` échelles : sparklines comparatives séance→séance, index `scale_administrations (patient, scale, administered_at)` ; seuil interprétation `scoring jsonb`. Pas de prédiction, pas de seuillage IA.

## 5. Accessibilité viz

- Pas d'encodage couleur seule : ligne + symbole + libellé.
- Contraste série sur blanc : azur-600 6.12, brand-600 5.10, ai-600 6.46 tous AA ; azure-400/coral-400 interdits comme ligne fine (3.26/2.58 fail).
- Tableau alternatif sous chart (sr-only ou toggle).
- `prefers-reduced-motion` : pas d'animation tracé 1000ms.

## 6. Anti-patterns

- Donut 3D, gradient sur série, ombre portée lourde, axe sans unité, sparkline partout, pourcentage sans base.
- Gradient derrière chart (contrast drift).
- Échelle non zéro tronquée pour exagérer tendance.

## 7. Implémentation tokens

```tsx
<div className="min-w-chart bg-card border border-rule rounded-lg p-6 shadow-lift1">
  <h3 className="text-heading font-semibold text-ink-900">Évolution</h3>
  <Line data={...} options={{ borderColor: 'var(--brand-600)', backgroundColor: 'var(--brand-050)' }} />
</div>
```
