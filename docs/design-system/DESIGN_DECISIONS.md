# Les décisions de V7 — ce qui a été retiré, et pourquoi

Une refonte se juge autant à ce qu'elle enlève qu'à ce qu'elle ajoute. Chaque
entrée ci-dessous a été prise en regardant l'application tourner.

## D-V7-1 · La bannière héros disparaît

`EnTeteEcran` posait en tête de **chaque** écran un bloc de ~120 px sur
`--grad-brand`, avec motif en filigrane et sur-titre.

**C'était la cause première du « c'est la même interface avec d'autres
couleurs ».** Quel que soit l'écran, les 120 premiers pixels étaient
identiques, et le travail réel commençait sous la ligne de flottaison.

L'identité de page monte dans une barre supérieure de 60 px partagée. Gain :
120 px de hauteur utile partout, une composition libre sous la barre, et un
emplacement stable pour la commande et les actions.

### La règle de sûreté qu'elle portait est devenue structurelle

`EnTeteEcran` (dégradé) et `EnTetePage` (sobre) existaient pour tenir ADR-022 :
**pas de dégradé derrière un nom de patient**. La règle reposait sur la
discipline de chaque écrivain d'écran, qui devait choisir le bon des deux.

La barre supérieure est **opaque, sans dégradé, sur tous les écrans**. Un nom
de patient y est donc toujours posé sur un fond uni. La règle ne dépend plus
d'une discipline : elle découle de la structure.

## D-V7-2 · Deux mondes neutres au lieu d'un

Voir `VISUAL_LANGUAGE.md` §1. Le rail passe de `--grad-auth` à `--chrome-900`.

Effet secondaire recherché : la couleur de marque cesse de teinter le fond de
l'application et redevient signifiante.

## D-V7-3 · L'assistant n'est plus une bulle flottante

Son lanceur était une pastille en bas à droite : orbe + « Ouvrir » + ⌘K —
**le motif « bulle de chat » dans sa forme la plus reconnaissable**, qui fait
lire une intelligence intégrée comme un widget collé après coup.

Le lanceur est désormais le **champ de commande de la barre supérieure**. Même
⌘K, même panneau ; ce qui change est ce que la disposition raconte.

Le libellé dit « **Demander à Alexa** », pas « Rechercher » : la première
version disait « Rechercher un patient, un rendez-vous, un document… », et
l'écran Patients portait alors **deux** champs de recherche superposés, l'écran
Documents **trois**.

## D-V7-4 · Le bouton principal passe en aplat

`bg-grad-tile-brand` + `hover:shadow-glow-brand` → `bg-action-600` + élévation.

Deux raisons. Le halo à décalage nul est une décoration, pas de la profondeur.
Et la lueur avait **trois usages fermés** ; un bouton primaire présent sur
presque tous les écrans en faisait le quatrième et le plus fréquent — la lueur
ne signalait plus rien.

Sur un dégradé, le contraste du blanc varie d'un bout à l'autre du bouton.
`--action-600` en aplat mesure 5.10:1, partout pareil.

## D-V7-5 · Les capitales de l'« eyebrow » quittent 24 libellés

Le rôle `eyebrow` (11 px / 700 / CAPITALES / 0.09em) était posé sur une
vingtaine de libellés de cartes et de sections, plus les titres de groupe du
rail. À cette densité, l'écran se couvre de petites capitales qui pèsent
visuellement autant que les vrais titres, et la hiérarchie s'aplatit là où elle
devrait porter.

Le libellé reste, le costume part : rôle `label` (12 px / 500 / casse de
phrase). Le rôle `eyebrow` survit pour les étiquettes d'axe de graphique.

## D-V7-6 · Fraunces quitte les nombres

`font-display text-display` était posé sur des compteurs et des montants. Une
face d'affichage sur de la donnée est un costume. Les valeurs passent en
`font-num` (Geist Mono, tabulaire) : elles se lisent comme des mesures.

## D-V7-7 · L'atmosphère quitte le sol

Trois lavages radiaux de marque sur toute la racine. Une couleur présente
partout ne désigne plus rien.

## D-V7-8 · Le Mode Séance est enfin construit

Les quatre jetons `--night-*` existaient depuis l'origine, écrits pour ce seul
écran, et n'avaient jamais servi. Voir `MODE_SEANCE.md`.

## D-V7-9 · Les échelles Tailwind sont complétées

Décision d'ingénierie qui conditionnait tout le reste. Voir
`DESIGN_TOKENS.md` §1.

---

## Ce qui a été délibérément CONSERVÉ

Pour éviter qu'une refonte suivante ne les défasse en croyant bien faire :

- **`Carte` et son union discriminée** (`lueur?: never` sur les niveaux
  porteurs). Le compilateur assume une responsabilité qu'un relecteur assumerait
  moins bien.
- **`TRACES: Record<NomIcone, …>`** indexé sur `keyof fr.nav.ecrans` : ajouter un
  écran sans son icône ne compile pas.
- **La composition du rail par rôle** (I12) : les entrées d'un rôle ne sont pas
  masquées, elles ne sont **jamais construites**. Cosmétique et assumé comme
  tel — seule la RLS protège la donnée.
- **Le rouge est un budget.** Un rendez-vous annulé n'est pas une erreur.
- **Aucune illustration dans le dossier clinique actif.**
- **`EtatVide` n'affiche jamais d'illustration décorative** — une phrase qui
  explique, et une action.
