/**
 * Le vocabulaire visuel du produit — point d'entrée unique.
 *
 * TOUT ÉCRAN CONSTRUIT À PARTIR D'ICI. S5 (Consultation), S6 et la suite
 * réutilisent ces pièces au lieu d'en réinventer : c'est ce qui fait qu'un
 * praticien reconnaît un bouton principal sans le lire, et qu'un statut a
 * partout la même forme. Un écran qui compose son propre bouton crée une
 * seconde grammaire, et deux grammaires obligent à relire.
 *
 * Si une pièce manque, elle s'ajoute ICI — pas dans l'écran qui en a besoin.
 */

export { Bouton, LienBouton, BarreActions } from "./Bouton";
export type { RangBouton, BoutonProps } from "./Bouton";

export { Carte, Section, EnTetePage, PanneauInfo, GrilleChamps } from "./Surfaces";

export { Badge, Chiffre } from "./Badge";
export type { TonBadge } from "./Badge";

export { ChampTexte, ChampSelection, ChampZoneTexte } from "./Champs";

export { BandeauHorsLigne, BlocErreur, EtatVide, Squelette, Champ } from "./Etats";
