# Le contrat des états d'écran

Repris de `05-UX-CONTRACT.md`, supprimé du dépôt. **Ce ne sont pas des règles
de style : ce sont des règles de sûreté.** Un écran qui ment sur son état fait
prendre une décision clinique sur une information absente.

## Les 5 états

Tout écran qui lit des données est dans exactement un de ces états.

### CHARGEMENT
Un **squelette**, jamais un mot d'attente ni un spinner nu. Il a la **forme du
contenu réel**, pour que l'arrivée des données ne décale rien. L'écran répond
en moins de 100 ms. Au-delà de 10 s, il bascule en ERREUR avec le mot « délai ».

Primitive : `Squelette` (`role="status"`, `aria-busy="true"`).

### VIDE
Les données sont arrivées, il n'y en a pas. **Une phrase** qui dit POURQUOI
c'est vide et COMMENT cela se remplit, plus **une action** au plus.

Primitive : `EtatVide`.

> **V7 — `EtatVide` ne dessine plus sa propre surface.** Son usage principal est
> à l'intérieur d'une `Carte` ; en portant fond, bordure et ombre, il produisait
> une carte dans une carte, et empilait un disque de 80 px contenant un disque
> de 56 px pour tenir une icône. Le parent fournit la surface.

### ERREUR
**REMPLACE** le contenu, ne s'ajoute jamais à lui. Trois phrases, dans cet
ordre : ce qui s'est passé · ce qui a été préservé · quoi faire (une action).

Interdits : « Une erreur inattendue », « Oups ! », un code technique
(`PGRST116`, `42501`), des excuses.

Primitive : `BlocErreur` (`role="alert"`).

> Exception documentée : sur la consultation, un échec d'ÉCRITURE sur une
> séance déjà chargée n'efface pas le travail clinique visible. Un échec de
> LECTURE, lui, remplace bien l'espace de travail.

### HORS LIGNE
Distinct d'ERREUR. Bandeau calme et permanent sur `--attention-bg`. Les lectures
déjà chargées restent lisibles ; **toute écriture est bloquée AVEC sa raison**.
Le retour en ligne fait disparaître le bandeau, sans fanfare.

Primitive : `BandeauHorsLigne` (`role="status"`).

### CONTENU
Les données sont là.

## La règle d'exclusivité

**`erreur` et `vide` ne coexistent jamais.** « Rien ne correspond » et « la
lecture a échoué » ne disent pas la même chose, et les confondre fait croire à
un dossier manquant.

## La confirmation

Demandée **uniquement pour un acte irréversible** : signer une note, annuler un
rendez-vous, émettre un certificat, toute écriture d'Alexa. La carte de
confirmation d'Alexa porte un **délai anti-clic-réflexe de 400 ms** et n'a
**aucun bouton par défaut**.

Jamais demandée pour un acte réparable (fixer un tarif, créer un dossier).

## La cohérence verbale

Le verbe du bouton est le verbe du retour : « Signer la note » → « Note
signée. » Aucune chaîne en dur : tout passe par `src/i18n/fr.ts` (ADR-008).

## Les états d'interaction

Toute commande porte : repos · survol · **focus visible** · actif · désactivé.
Le focus est visible **partout** (`:focus-visible`, 2 px), avec une variante
claire sur le chrome sombre (`.sur-chrome`) et sur la marque (`.sur-marque`).
