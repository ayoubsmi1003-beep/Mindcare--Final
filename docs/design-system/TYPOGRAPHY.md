# Typographie

## Une famille porte l'interface

**Inter** (`--font-ui`) porte titres, libellés, corps, boutons, navigation. Un
produit d'usage n'a pas besoin d'un couple affichage/texte : un grotesque bien
réglé fait tout, et la variété affaiblirait la cohérence.

| Famille | Jeton | Emploi |
|---|---|---|
| Inter | `--font-ui` | **tout l'écran** |
| Geist Mono | `--font-num` | **mesures** : montants, heures, chronomètre, n° de dossier |
| Newsreader | `--font-doc` | **le document imprimé uniquement** — elle encode le statut légal du contenu |
| IBM Plex Sans Arabic | `--font-ar` | blocs arabes, `[dir="rtl"]` |
| Fraunces | `--font-display` | chargée, **plus employée dans l'interface** |

> **Fraunces a quitté les nombres en V7.** Une face d'affichage posée sur un
> compteur ou un montant est un costume. Les valeurs passent en `--font-num` :
> elles se lisent comme des mesures.

> **Le monospace n'est pas un costume « technique ».** Il sert la donnée et la
> mesure — jamais du texte courant pour faire sérieux.

## Les rôles

Chaque rôle porte **sa** taille, **son** interligne et **son** interlettrage,
posés ensemble dans le tuple `fontSize` de la configuration.

| Rôle | Taille | Graisse | Emploi |
|---|---|---|---|
| `metric` | 36 px | 600 | une valeur lue d'un coup d'œil à distance — chronomètre de séance |
| `display` | 30 px | 700 | le nom en Mode Séance |
| `title` | 21 px | 600 | titre d'écran, valeur de tuile |
| `heading` | 16 px | 600 | titre de section |
| `body` | 14 px | 400 | **le corps, et il reste en 400** |
| `notes` | 15 px | 400 | texte clinique long (interligne 1.7) |
| `label` | 12 px | 500 | libellés de champs et de cartes |
| `eyebrow` | 11 px | — | étiquettes d'axe de graphique **uniquement** |
| `num` | 14 px | — | données tabulaires |

### Deux règles qui se transgressent facilement

**Le corps clinique reste en 400.** Une note lue plusieurs minutes en 600
fatigue. La hiérarchie se fait par la taille, l'espace et la couleur — pas en
mettant tout en gras.

**L'interlettrage est déjà dans le rôle.** `tracking-tight` était posé 8 fois
par-dessus un rôle qui portait déjà le sien : redondant, et de toute façon
inexistant dans l'échelle. Ne pas re-spécifier ce que le rôle fixe.

## Chiffres tabulaires

`font-variant-numeric: tabular-nums` est posé sur `html`/`body`, plus
`"tnum" 1, "zero" 0, "ss02" 0` — ce dernier neutralise le zéro barré d'Inter,
qui se lit mal sur un montant.

Sans `tabular-nums`, un chronomètre fait trembler sa ligne à chaque seconde.

## Le sur-titre est banni

Un libellé en capitales posé **au-dessus** d'un titre est un ornement qui
affaiblit le titre qu'il prétend introduire. `surTitre` a disparu avec
`EnTeteEcran` / `EnTetePage`, et 24 libellés ont quitté le costume capitales +
interlettrage large (voir `DESIGN_DECISIONS.md` D-V7-5).

Le rôle `eyebrow` survit pour ce qu'il sait faire : une étiquette d'axe.

## Mesure de lecture

`max-w-lecture` (70ch) pour tout texte long — note, résumé, message d'erreur
développé. En deçà le texte hache, au-delà l'œil perd la ligne suivante.
