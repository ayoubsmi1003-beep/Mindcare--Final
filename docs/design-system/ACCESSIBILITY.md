# Accessibilité — le plancher, et les mesures

Les contrastes ci-dessous sont **mesurés** (WCAG 2.1, formule de luminance
relative), pas estimés. Une valeur estimée qui se révèle fausse coûte plus cher
qu'une absence de valeur : elle empêche la relecture suivante.

## Plancher

- Texte normal ≥ **4.5:1**, texte large et éléments d'interface ≥ **3:1**.
- Focus visible **partout** — `:focus-visible`, 2 px, décalé de 2 px.
- Cibles ≥ 36 px (`--target-min`), 44 px sur les commandes tactiles.
- **La couleur n'est jamais seule porteuse de sens** : un statut porte aussi un
  mot, une forme ou une position.
- `prefers-reduced-motion: reduce` → toute animation à 0.01 ms.
- Le zoom du navigateur est préservé : **aucun `font-size` sur `html`**.

## Chrome (sur `--chrome-900` `#0e1a18`)

| Jeton | Valeur | Ratio | Emploi |
|---|---|---|---|
| `--chrome-ink` | `#eaf2ef` | **15.6:1** | entrée active, nom du compte |
| `--chrome-ink-soft` | `#a7bdb7` | **9.00:1** | entrées inactives — encre de texte valide |
| `--chrome-ink-faint` | `#6e8983` | **4.72:1** | libellés de groupe, écrans à venir |
| `--chrome-ink` sur `--chrome-actif-bg` | | **6.81:1** | l'entrée active |

Aucune de ces quatre encres n'est un gris : elles sont tirées de la teinte de
marque, comme l'exige la règle « sur une surface teintée, teinter le texte
secondaire depuis cette teinte, jamais vers le gris ».

## Contenu (sur `--card` `#ffffff`)

| Jeton | Ratio | Emploi |
|---|---|---|
| `--ink-900` `#0b1614` | 18.1:1 | titres |
| `--ink-700` `#23342f` | 12.4:1 | corps |
| `--ink-500` `#566b65` | **5.70:1** | texte discret — plancher tenu |
| `--ink-300` `#8fa39d` | **2.43:1** | ⚠️ **JAMAIS du texte.** Bordures, séparateurs, `placeholder` décoratif uniquement |
| `--action-600` `#2a7a70` | 5.10:1 | action, avec le blanc pur dessus |
| `--attention` `#b8763a` | 3.69:1 | accent seulement — le texte utilise `--attention-ink` (5.67:1) |

## Nuit — Mode Séance

Voir `MODE_SEANCE.md` : 14.9 / 6.49 / 3.33:1.

## Ce qui a été corrigé en V7

- La bannière **hors ligne** et le **bloc d'erreur** étaient stylés entièrement
  sur la palette `amber.*`, **jamais exposée** dans la configuration Tailwind :
  ils s'affichaient sans fond ni bordure. Passés sur la famille `attention`.
- Les créneaux libres de l'agenda affichaient « libre » 80 fois par semaine en
  `--ink-500`. Le mot est désormais révélé au survol et au focus, et **reste
  dans l'arbre d'accessibilité** — une case muette pour un lecteur d'écran
  serait un créneau de moins, pas un écran plus calme.
- Le rail reprenait sa largeur pleine **à partir de** 1024, exactement la
  largeur où il devait se replier.

## Ce qui n'est pas vérifié

Honnêteté : **aucun test avec un lecteur d'écran réel (NVDA / VoiceOver) n'a
été mené.** Les rôles ARIA, l'ordre de tabulation et les libellés sont posés et
relus dans le code ; ils ne sont pas *validés à l'usage*. C'est le premier
travail d'accessibilité à programmer.
