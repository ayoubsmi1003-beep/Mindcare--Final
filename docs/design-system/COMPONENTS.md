# COMPONENTS — Taxonomie MindCare V2

## 1. Navigation

| Composant | Fichier | Anatomie | Variants | Usage |
|---|---|---|---|---|
| AppShell | `components/AppShell.tsx` | rail 248/72 grad-auth + main 1120 + bandeau + Jarvis | praticienne / assistante | shell global |
| Onglets | `ui/Onglets.tsx` | barre + indicateur brand-600 2px | 2–6 items | fiche patient, finances |
| Fil de journée | `tableauDeBord/FilDeLaJournee.tsx` | timeline verticale + maintenant | — | dashboard |
| Breadcrumbs | inline | label 12 + chevron 12 | — | fiches |

## 2. Actions

| Composant | Tokens | Variants | Règle |
|---|---|---|---|
| Bouton primaire | `bg-action-600 hover:700 active:900 text-on-brand shadow-lift1` | default/icon/split | une action primaire par section |
| Secondaire | `bg-card border-rule text-ink-700 hover:sunken` | — | annuler/retour |
| Tertiaire/ghost | `text-action-600 hover:action-050` | — | inline |
| Destructif | `bg-critical text-white` | — | annuler RDV, verrou note — confirmer requis |
| Icon button | `min-h-target 36 w-target` | — | `aria-label` obligatoire |
| Groupe | `gap-2` | — | jamais pills multiples égales |

## 3. Inputs

Inputs `ui/Champs.tsx` : `h-target 36 (comfort 44 QR)`, `rounded-md 10`, `border-rule`, `focus ring action-600`. Label 12 500 au-dessus, erreur 12 attention-ink **sous** champ près du contrôle, jamais placeholder seul. Textarea notes `15px 1.7 400`. Select/combobox/date/time via popover natif + clavier. Checkbox/radio 16px + label. Switch 44×24.

## 4. Information

| Comp. | Style | Note |
|---|---|---|
| Badge/Status | `rounded-full px2 py1 text-label 12 500` | `attention-ink/bg`, `critical`, `positive`, `ai`, `info` — jamais couleur seule |
| Avatar | `grad-avatar` 40px + `text-brand-900` 5.70:1 | monogramme, fallback disque nu |
| Tooltip/Popover | `card lift3 p2 text-label` | focus + hover |
| Card | `bg-layer-surface border-rule rounded-lg lift1 p4/6` | **pas de dégradé derrière valeur** |
| Stat | `p4 border-rule` L3 typo porte chiffre (Inter 600 21 ou 800 36 si hero) | pas 4 tuiles égales saturées |
| Timeline | `ChronologiePatient.tsx` 8 sources UNION ALL keyset | pagination 50, bornée base |
| Table | `TableauSeances/Charges` + `Tableau*` | voir §5 |
| Chart | `PanneauEvolution/Anatomie` | voir DATA_VISUALIZATION |
| Progress | `h2 track sunken + fill brand-600` | — |

## 5. Tables & listes denses

- Row `min-h-target 36`, `py3 px4`, `divide-y rule`, `hover:sunken`.
- Headers `eyebrow 11 600 0.09` sticky, `bg-layer-surface`.
- Numérique `tabular-nums` aligné droite, `font-num 500`.
- Sorting indicateur 12, filtering inline.
- Pagination keyset `(occurred_at, event_id)` — pas offset.
- Empty → `EtatPanneau` centré, pas ligne vide.

## 6. Feedback (5 états `05-UX-CONTRACT`)

- **Chargement :** squelette `respire 600 soft` (bloc sunken opacity 1↔.5), jamais spinner nu, forme \(=\) contenu.
- **Vide :** phrase + action `ink-500` + brand link ; illustration disque `grad-empty` seulement sur empty (pas workspace). `EtatPanneau.tsx`.
- **Erreur :** 3 phrases (quoi passé / quoi préservé / quoi faire) + `[Réessayer]`, remplace contenu, jamais + liste vide dessous.
- **Hors ligne :** bandeau `attention-bg` permanent calme, lecture reste, écritures bloquées avec raison.
- **Contenu :** normal.

Toast/Banner/Alert `ui/Etats.tsx` — `attention-bg` / `critical-bg` / `positive-bg` + `ink` correcte 5.67/5.74/4.56.

## 7. Overlays

Modal/drawer/sheet : `bg-card lift3 rounded-xl`, voile `rgba(11,22,20,.32)` teinté (pas noir pur), `backdrop-blur glass`. Fermeture `Esc` sauf carte `proposed`. Command palette `RechercheEclair` 460px max, `⌘K`. Context menu minimal.

## 8. Santé-spécifique

| Pattern | Composant | Contenu |
|---|---|---|
| Patient identity | `CarteIdentite`, `EnTetePatient` | monogramme + P-0003 + tel + naissance |
| Risk | ZoneAttention indicator | attention-ink + icône, jamais couleur seule |
| Medication row | `PanneauTraitements` ligne | molécule INN + forme + dose tabular |
| Consultation row | `PanneauRendezVous` carte | heure + type + liseré 3px + libellé type |
| Clinical timeline | `ChronologiePatient` | 8 sources, icône type+date |
| Document status | `ListeDocuments` | doc_number + type + issued_at + printed_count |
| Payment status | `PaiementCard` | receipt_number + amount_dzd integer DZD + état |
| AI suggestion | FilJarvis bulle | `bulle-jarvis-max 92%` opaque, source payload |
| AI approval | CarteConfirmation | `confirmed_at` avant exécution, 400ms attente L2 |

Tous portent Anatomy / Purpose / Variants / States / Spacing / Typo / A11y / Usage + anti-pattern.
