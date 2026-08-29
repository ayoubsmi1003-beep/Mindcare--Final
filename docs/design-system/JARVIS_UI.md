# La langue visuelle d'Alexa

## Le principe

**L'IA propose, la médecin décide, la base journalise.** La forme doit rendre
cette phrase lisible sans qu'on l'explique.

L'assistant est **distinctif sans dominer** : il possède une famille de couleur
(`--ai-*`), et rien d'autre du produit ne l'emploie.

## Il n'est plus une bulle flottante

Son lanceur était une pastille en bas à droite — orbe + « Ouvrir » + ⌘K, le
motif « bulle de chat » dans sa forme la plus reconnaissable.

En V7, **le champ de commande de la barre supérieure EST l'assistant**. On lui
parle là où on chercherait, au centre de l'outil. Fermé, `PanneauJarvis` ne rend
plus rien.

L'orbe reste dans la barre comme **témoin d'état de la voix** — il renseigne, il
n'ouvre pas.

## Les surfaces

| Surface | Rôle |
|---|---|
| Champ de commande (barre) | l'entrée — « Demander à Alexa », ⌘K |
| Orbe (`OrbeVoix`) | l'état de la voix, 8 états |
| Panneau latéral (`PanneauJarvis`) | la conversation, 380 px, verre |
| Écran plein (`/jarvis`) | la même conversation, même store |
| Carte de confirmation | **la décision** |
| Carte du tableau de bord | les propositions en attente |

Panneau et écran plein partagent **un seul état** (`services/conversation.ts`) :
ouvrir le plein écran ne duplique pas la conversation, fermer le panneau ne
l'interrompt pas.

## La carte de confirmation

Le seul endroit du produit où la lueur est admise, avec l'orbe.

- **Aucun bouton par défaut.** Rien ne se déclenche sur `Entrée`.
- **Délai anti-clic-réflexe de 400 ms** avant que l'acceptation ne devienne
  active.
- `Échap` **ne ferme pas** le panneau tant qu'une carte attend : la laisser
  `proposed` sans que personne ne sache qu'elle existe serait pire que
  l'interruption.
- Le contenu de la carte **ne bouge jamais** — on ne fait pas glisser ce sur
  quoi on demande un accord.

## Le verre, et sa limite

`--glass-panel` habille le panneau et la carte : du mobilier flottant. **Les
bulles de conversation sont opaques.** Une transcription ou une posologie ne se
lit pas à travers du verre.

## Ce que la couleur IA ne fait pas

Elle ne colore pas une valeur clinique, ne teinte pas une note, n'entoure pas un
champ de saisie de dossier. Elle dit « ceci vient de l'assistant » — et cette
distinction est exactement ce qui permet à la praticienne de savoir ce qu'elle
relit.
