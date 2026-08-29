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

export {
  Carte,
  PastilleIcone,
  Section,
  PanneauInfo,
  GrilleChamps,
} from "./Surfaces";
export type {
  CarteProps,
  NiveauCarte,
  NiveauDecor,
  NiveauPorteur,
} from "./Surfaces";

export { Icone, MarqueMindCare, MotifFeuilles } from "./Icones";
export type { NomIcone, IconeProps } from "./Icones";

/* ⚠️ NI `Tableau` NI `Toast` NE SONT ICI, ET C'EST LA MÊME RAISON.
 *
 * Le contrat de V3 liste sept primitives ; deux n'ont AUCUN appelant dans tout
 * `src/`. Un `Toast` n'est déclenché nulle part. Un `Tableau` de données n'a
 * pas d'écran : la liste des paiements est une liste de CARTES (chaque ligne
 * porte une action), et `GrilleSemaine` compose une grille de calendrier, qui
 * n'a de tableau que la balise.
 *
 * Une primitive sans appelant est du code non exercé, donc non vérifié, dans un
 * dossier qui se veut vérifiable. `Tableau` a d'ailleurs été écrit puis retiré
 * dans cette même session, une fois constaté qu'aucun écran ne pouvait le
 * recevoir sans qu'on RESTRUCTURE cet écran — ce que le périmètre de V3
 * interdit (règle 10 : appliquer le système, pas refaire l'architecture).
 *
 * Les deux sont reportés à V4, où le tableau de bord leur donnera enfin un
 * consommateur réel. Reporté et écrit, pas oublié. */

export { Badge, Chiffre } from "./Badge";
export type { TonBadge } from "./Badge";

/* Patients V2 — les deux pièces qui manquaient au vocabulaire.
 *
 * Elles ont un appelant réel (l'espace de travail patient), condition posée
 * plus haut pour toute primitive. `Onglets` porte le contrat clavier complet
 * d'un `tablist` ; `Avatar` sort le monogramme des trois écrans qui le
 * refabriquaient chacun à sa façon. */
export { Onglets, PanneauOnglet } from "./Onglets";
export type { Onglet } from "./Onglets";

export { Avatar } from "./Avatar";
export type { TailleAvatar } from "./Avatar";

export { ChampTexte, ChampSelection, ChampZoneTexte, ChampRecherche } from "./Champs";

export { EspaceTravail, SectionPliable } from "./Espaces";

export {
  BandeauHorsLigne,
  BlocErreur,
  EtatVide,
  Squelette,
  Champ,
  IndicateurEnregistrement,
} from "./Etats";
