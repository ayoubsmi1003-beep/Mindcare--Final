# NAVIGATION — MindCare V2 (PC)

## 1. Principe

Navigation = orientation, pas décoration. Un seul accent actif brillant ; tout le reste neutre. Pas de glass pill flottante, pas de méga-menu.

## 2. Rail latéral (code `AppShell.tsx:214`)

- **Fond :** `bg-grad-auth` (160deg #0F2E2A→#1D5C54→#2A7A70) — plus sombre plus longtemps que `grad-brand`, tient blanc ≥10.88:1 sur toute hauteur.
- **Encre unique :** blanc pur `#FFF` ; hiérarchie par taille/graisse/pastille, jamais alpha <1 (tokens 244).
- **Reflet décor :** `bg-grad-hero-reflet` radial white 13% — épaisseur sans quatrième dégradé.
- **Structure :** `248px` desktop / `72px` compact `<1024` (pastille 40 + 16×2). Libellés sortent du flux visuel (`h0 w0 overflow-hidden opacity0`) mais restent dans l'arbre a11y (`LIBELLE_REPLIABLE`).
- **Groupes :**

```
Praticienne owner/practitioner:
  MENU — Tableau de bord, Jarvis (quotidien transverse)
  CLINIQUE — Patients, Agenda, Messages, Documents, Traitements, Suivi
  GESTION — Finances, Statistiques
  SYSTÈME — Agents, Journal, Paramètres

Assistante (I12, composition séparée, pas champ masqué):
  MENU — Tableau de bord, Agenda   (2 seules)
```

Règle I12 : entrées non autorisées ne sont jamais construites, pas masquées CSS. Ne contient jamais `if(role)` protecteur de donnée — RLS seule frontière (règle 4).

## 3. Items

- **Construit + actif :** `aria-current="page"` + `bg-on-brand-surface` + `font-semibold` + `shadow-glow-nav` (brand + sheen) — trois signaux (fond+graisse+lueur).
- **Construit inactif :** `hover:bg-on-brand-surface-hover` 160ms soft.
- **Non construit (bientôt) :** `aria-disabled`, icône `opacity-disabled .5`, label `bientot` bas de casse 12 regular (volontairement calme — pastille initiale 9 BIENTÔT criait plus que écrans utiles). Jamais lien mort.

## 4. Compte & déconnexion

- Monogramme 36px `bg-on-brand-surface shadow-sheen` initiales calculées `monogrammeCompte`. Nom `truncate` + `title` complet (8–35 chars noms longs). Bouton déconnexion `min-h-target 36`, `bg-on-brand-surface-hover`, `rounded-full`. Poste en salle consult — déconnexion obligatoire, pas ornement.

## 5. Top / contexte

- Pas de topbar lourde. `BandeauSeanceEnCours` au-dessus main indique séance en cours. `SyntheticDataBanner` hors AppShell à la racine (efface seul en self-hosted).
- Recherche éclair `RechercheEclair` (Ctrl/Cmd-K) pour patient/action — commande palette, pas champ persistant.
- Breadcrumbs discrets `text-label` sur fiches ; tabs `Onglets` pour 6 onglets patient.

## 6. États

- Focus sur marque : anneau blanc `sur-marque :focus-visible 2px white` (brand 600 disparaîtrait).
- Clavier : `Tab` parcourt rail visible, icônes seules restent `h-auto w-auto` pour lecteur d'écran.
- Hover/active timings `quick 160 soft`, pas de spring hors orbe.

## 7. Implémentation

```tsx
<Link aria-current={actif?"page":undefined} className={actif?"bg-on-brand-surface font-semibold shadow-glow-nav":"hover:bg-on-brand-surface-hover"}>...</Link>
<nav aria-label={fr.coquille.navigationPrincipale} className="sur-marque bg-grad-auth ..."> // I12 switch par rôle
```

Breakpoints `tablet 1024` only ; rail `sticky top0 h-full`.
