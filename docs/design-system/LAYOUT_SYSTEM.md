# La coquille et les compositions

## La coquille

```
┌──────────────────────────────────────────────────────────┐
│ SyntheticDataBanner (ADR-016, développement uniquement)   │
├────────────┬─────────────────────────────────────────────┤
│            │ Topbar 60px — titre · sousTitre · ⌘K · actions│
│  Rail      ├─────────────────────────────────────────────┤
│  chrome    │ BandeauSeanceEnCours (si séance ailleurs)    │
│  244 / 68  ├─────────────────────────────────────────────┤
│            │ <main> — le seul élément qui défile          │
└────────────┴─────────────────────────────────────────────┘
```

`src/components/AppShell.tsx` · `coquille/Rail.tsx` · `coquille/Topbar.tsx`

### Le défilement appartient à `<main>`, et à rien d'autre

`<body>` est `h-screen overflow-hidden`. La page ne défile jamais ; les colonnes
internes défilent.

> ⚠️ **`min-h-0` + `overflow-hidden` sur la colonne de contenu sont
> STRUCTURELS.** Sans eux, la grille de l'agenda — plus haute que la fenêtre —
> faisait grandir sa rangée, donc la colonne, donc le rail : mesuré à 1359 px de
> haut pour une fenêtre de 1080, « Se déconnecter » à 1342. Un enfant de flex
> refuse par défaut de descendre sous la taille de son contenu ; `min-h-0` lève
> ce refus.

> ⚠️ **`min-w-0` a le même rôle sur l'axe horizontal.** Sans lui, un conteneur
> `overflow-x-auto` grandit avec son contenu au lieu de le faire défiler.

## L'API de composition

```tsx
<AppShell
  role nomComplet onDeconnexion      // obligatoires
  titre?        // défaut : déduit de la route via fr.nav.ecrans
  sousTitre?    // une ligne de contexte
  actions?      // à droite de la barre — une action dominante au plus
  sansGouttiere?  // l'écran gère ses propres bords
  modeSeance?     // le repli nocturne
/>
```

**Le titre est déduit de la route** pour les écrans de LIEU : un titre déduit ne
peut pas diverger du libellé du rail, alors que deux chaînes recopiées divergent
toujours un jour. Les écrans de PERSONNE (`/patients/[id]`,
`/consultation/[id]`, `/agenda/[id]`) le fournissent — aucune route ne devine
un nom.

## Pleine largeur, et une composition par écran

`max-w-main` (1120 px centré) a été retiré. Il imposait la même colonne à tous
les écrans, ce qui poussait chacun vers la même pile verticale de cartes.

**Le bento est un outil, pas l'identité du produit.** Chaque écran compose selon
son travail :

| Écran | Composition |
|---|---|
| Tableau de bord | rangée d'état « maintenant » + fil de la journée / colonne de contexte |
| Patients | recherche en tête, puis annuaire pleine largeur |
| Fiche patient | identité + onglets, puis travail / contexte |
| Agenda | grille de semaine pleine largeur, défilante dans son conteneur |
| Consultation | espace de travail ; **Mode Séance** si la séance est ouverte |
| Finances | tuiles de pouls, puis évolution / anatomie / attention, puis calendrier |
| Documents | barre d'outils, puis liste / feuille |
| Réception | cockpit plein écran, `sansGouttiere` |

Gabarits nommés dans `tailwind.config.ts` : `grid-cols-espace-liste`,
`espace-travail`, `espace-jour`, `espace-document`.

## Densité

L'application est lue six à huit heures par jour. Elle doit tenir l'information
**sans foule** : rangée de tableau à 44 px, gouttière d'écran à 24 px, respiration
entre sujets par l'espace plutôt que par des filets. Un filet de plus sur un
agenda déjà quadrillé ajoute une ligne à lire pour rien.
