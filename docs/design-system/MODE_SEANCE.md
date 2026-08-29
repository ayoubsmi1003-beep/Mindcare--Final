# Le Mode Séance

**Le seul moment orchestré du produit.** Partout ailleurs : discipline et
silence. Le plancher de craft ne tolère qu'un moment authored par produit, et
c'est celui-ci.

## Ce que c'est

Quand une consultation est **ouverte**, l'interface se retire : plus de rail,
plus de barre supérieure, le fond glisse vers l'encre de nuit. Il ne reste que
la personne, la note et le chronomètre.

Une consultation **close** se relit dans la coquille normale. Se retrouver dans
le noir pour relire une note d'il y a trois semaines serait un effet de style,
pas une aide.

```
enSeance = seance != null && !seanceClose
```

## L'implémentation : un remappage de variables, pas une prop

`AppShell` pose la classe `.mode-seance` ; `tokens.css` y remappe les variables
de surface et d'encre.

```css
.mode-seance {
  --canevas: var(--night-bg);
  --card:    var(--night-card);
  --ink-900: var(--night-ink);
  --ink-500: var(--night-ink-soft);
  --action-600: var(--brand-400);   /* la marque monte d'un pas dans sa rampe */
  …
}
```

**Pourquoi pas une prop `mode` :** l'espace de travail de la consultation empile
`EspaceTravail`, `SectionPliable`, quatre `ChampZoneTexte`, `BlocTarif`,
`PanneauInfo`, `Badge`… Faire descendre un booléen jusqu'à chacun signifierait
toucher une douzaine de composants partagés pour un seul écran, et laisser dans
chacun une branche `if (nuit)` que personne ne relira.

Ici les composants ne savent **rien** : ils lisent `var(--card)` comme toujours,
et c'est `--card` qui change sous eux.

## Contrastes mesurés

Sur `--night-card` (`#132321`) :

| Jeton | Valeur | Ratio | Emploi |
|---|---|---|---|
| `--ink-900` → `--night-ink` | `#dce8e5` | 14.9:1 | texte principal |
| `--ink-500` → `--night-ink-soft` | `#93a8a3` | 6.49:1 | texte secondaire |
| `--ink-300` | `#5d7671` | 3.33:1 | **non textuel uniquement** |

`--action-600` passe à `--brand-400` : `--brand-600` tombe à 2.9:1 sur l'encre
de nuit, `--brand-400` y remonte à 7.1:1. La marque ne change pas, son **pas
dans la rampe** change.

## Accessibilité

Le rail et la barre sont **retirés de l'arbre**, pas seulement translatés
hors-champ. Une navigation invisible mais toujours focalisable enverrait la
tabulation d'un lecteur d'écran dans douze liens fantômes au milieu d'une
consultation.

Alexa, elle, **reste montée** : la dictée pendant la séance est le cœur du cas
d'usage. C'est le seul mobilier qui survit au repli.

Le bandeau « une séance est en cours » n'est pas rendu : le rappeler à
quelqu'un qui est *dans* la séance serait du bruit.

## Vérification

`node scripts/qa-mode-seance.mjs` ouvre une séance, capture aux trois largeurs
et rapporte l'état réel du DOM (classe active, rail absent, fond, variables
remappées).

> ⚠️ Ce script **écrit en base** : il démarre une séance sur une fixture de
> développement et la laisse ouverte, la clôture exigeant un tarif — et
> fabriquer un montant pour faire joli sur une capture serait exactement la
> donnée fictive que la règle 8 interdit.
