# LAYOUT_SYSTEM — MindCare V2 (PC)

## 1. Shell applicatif (code `AppShell.tsx:209` + `layout.tsx:184`)

```
┌ SyntheticDataBanner (shrink-0, condition cloud-dev) ┐
├─ nav 248 (72 compact) │ main max1120 flex-1 overflow-y-auto ├
│  grad-auth sombre     │  layer-ambient + atmosphere washes    │
│  focus blanc on-brand │  px6 py8 gutters                      │
│  groups Menu/Clinique │  grille fiche/cockpit/finance/pouls   │
│  Gestion/Système      │  cartes layer-surface / layer-raised  │
│  account + deconnexion│                                       │
└───────────────────────┴───────────────────────────────────────┘
Jarvis overlay fixed 380px → z 50, glass-panel + blur 20px, N/A assistant
BandeauSeanceEnCours full-width au-dessus du main
```

- `body flex h-screen overflow-hidden` + `main overflow-y-auto` — seul contenu scrolle, rail sticky.
- `min-h-0` sur grille + colonne contenu — évite 1359px growth mesuré agenda.

## 2. Max widths

- `1120` contenu principal ; `420` carte, `960` scène auth (form+brand) ; `148mm×210mm` feuille doc A5.

## 3. Grilles bento (PC)

| Grille | Definition | Usage |
|---|---|---|
| `fiche` | `auto-fit minmax(240px,1fr)` | fiche patient, identités, docs |
| `cockpit` | `2fr 1fr` | tableau bord praticienne |
| `finance` | `40fr 32fr 28fr` | Évolution/Anatomie/Attention |
| `pouls` | `×5 equal` | tuiles pulse finances |
| `reception` | `1.35 /0.85/0.8fr` | poste assistant (agenda/attente/encaissement) |
| `receptionPulse` | `×4` | pulses reception |
| `receptionMiddle/Bottom` | `1.85:1` / `1:1.45:1` | étages reception |

Toutes `minmax(0, …)` pour compression sans débordement. Page ne scrolle jamais horizontalement ; graphique/agenda défile dans son conteneur (`chart-min 480`, `day-min 132`).

## 4. Dashboard composition (opérationnel, pas wall de stats)

Priorité fixe : timeline du jour → patient en cours (now) → patient suivant (next) → attention → salle d'attente → tâches inachevées. Une à deux micro-visualisations timeline/sparkline seules si aident décision ; finance reste chart-rich. Pas de 4 cartes égales décoratives.

## 5. Détail / split / master-detail

- Liste patients : colonne unique full width, recherche debounced 250ms.
- Fiche patient : 6 onglets, `get_patient_workspace` 1 call, reste lazy onglet.
- Consultation : timer + transcription + insights live, note SOAP append-only.
- Documents : preview A5 fixe `148mm` même rendu écran/impression.

## 6. Elevation L1→L3

```
L1 ambient --layer-ambient #F1F8F6 + atmosphere  — sol
L2 surface --layer-surface #FFF              — cartes
L3 raised  --layer-surface + sheen + lift2   — actif/interactif
```

Ombres froides vertes (`lift1-3`), jamais gris neutre. Ombre teintée `--lift-color` par tuile via `--shadow-color`.

## 7. Règles L6

Gradients (`grad-brand/auth/orb/tile-*`) uniquement sur : rail nav, hero lieu, orb Jarvis, tuiles agrégat identité, disque empty, reflet hero. Jamais derrière dose/montant/nom.

## 8. Accessibilité layout

- `px6` gutters assurent 24px hors zone — tactile 44px préservée.
- `min-h-0` évite bouton déconnexion poussé sous 1080 (mesuré 1342).
- `overflow-hidden` + `overflow-y-auto` isole scroll.
