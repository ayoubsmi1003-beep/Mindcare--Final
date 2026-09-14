/**
 * LES IDENTITÉS FICTIVES DES TESTS — UN SEUL ENDROIT.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 *
 * Les tests unitaires portaient chacun leurs propres noms inventés — « DUPONT
 * Nadia » ici, « Prenom7 JeuDore7 » là, « Essai CLINIQUE529425 » ailleurs.
 * Chacun se tenait, mais l'ensemble ne racontait rien : impossible de dire, en
 * lisant un test, s'il parlait du même patient qu'un autre, ni de rejouer à
 * l'écran ce qu'un test unitaire décrivait.
 *
 * Ce fichier et `population-synthetique.json` portent désormais LA MÊME
 * population : celle des tests en mémoire et celle de la base de développement.
 * « Karim Djilali » désigne la même personne dans un test unitaire, dans un
 * scénario Playwright et dans la base — et il a, dans les trois, des traitements
 * et un cas à résumer.
 *
 * ═══ CES PERSONNES SONT FICTIVES ═══
 *
 * Aucune ne correspond à un dossier réel. Les identifiants sont des UUID
 * fabriqués, reconnaissables à leur zone nulle : ils ne peuvent pas se confondre
 * avec un identifiant de production. La règle 8 tient — rien d'ici ne part dans
 * une fonctionnalité livrée ; ce sont des fixtures de test et de développement.
 *
 * ⚠️ LES IDENTIFIANTS D'ICI NE SONT PAS CEUX DE LA BASE. Un test unitaire ne
 * touche aucune base : il lui faut des identifiants stables, pas les identifiants
 * réels du poste. C'est le NOM qui fait le lien entre les deux mondes, et c'est
 * suffisant : c'est aussi par le nom que la praticienne parle à Alexa.
 */

/** Ce dont un test a besoin pour poser une cible ou frapper un jeton. */
export interface PatientFictif {
  readonly id: string;
  /** `NOM Prénom` — la forme qu'`app.patients` rend et que l'écran affiche. */
  readonly libelle: string;
  readonly prenom: string;
  readonly nom: string;
  readonly numeroDossier: string;
}

function fictif(
  suffixe: string,
  prenom: string,
  nom: string,
  numeroDossier: string,
): PatientFictif {
  return {
    id: `00000000-0000-4000-8000-0000000${suffixe}`,
    libelle: `${nom.toUpperCase()} ${prenom}`,
    prenom,
    nom,
    numeroDossier,
  };
}

/**
 * LA VEDETTE. Le dossier le plus fourni de la base de développement :
 * rendez-vous, consultations, traitements, résumés de cas, paiements.
 *
 * C'est lui qui porte le parcours conversationnel complet — « Montre-moi le
 * dossier de Karim Djilali », puis « et ses traitements ? », puis « résume son
 * cas » — et le « A » de la bascule A → B → A.
 */
export const KARIM = fictif("00d101", "Karim", "Djilali", "D-301");

/**
 * LE « B » DE LA BASCULE. Deuxième dossier le plus fourni, délibérément : une
 * bascule testée contre un dossier vide ne prouverait pas grand-chose.
 */
export const MAHMOUD = fictif("00d202", "Mahmoud", "Saidi", "D-302");

/** Le dossier aux traitements — questions de posologie, formulations en darija. */
export const YACINE = fictif("00d303", "Yacine", "Boudiaf", "D-303");

/**
 * LE PRESQUE-HOMONYME DE KARIM DJILALI — deux lettres d'écart.
 *
 * ⚠️ IL FABRIQUE DEUX CAS OPPOSÉS AVEC LES MÊMES DONNÉES, ET C'EST SA RAISON
 * D'ÊTRE :
 *   · « Karim Djilali » (nom complet) → UN dossier    → résolution sûre ;
 *   · « Karim » (prénom seul)         → DEUX dossiers → clarification.
 * C'est aussi l'écart type d'une dictée : Djilali / Djellali.
 */
export const KARIM_VOISIN = fictif("00d404", "Karim", "Djellali", "D-304");

/**
 * LE GROUPE D'HOMONYMES — sept dossiers au nom rigoureusement identique.
 *
 * ⚠️ LA FIXTURE DE SÉCURITÉ LA PLUS IMPORTANTE DU DÉPÔT. « Le dossier de
 * Mohammed Sadli » doit produire une recherche et RIEN d'autre : aucune lecture
 * patient, aucune écriture, et une demande de précision. Sept plutôt que deux
 * parce qu'un défaut qui « choisit le premier » se voit mieux sur sept.
 *
 * ⚠️ EN BASE, CES SEPT DOSSIERS SONT VIDES DE TOUTE RELATION, délibérément : si
 * la porte d'ambiguïté cédait, le test lirait un dossier sans contenu plutôt
 * qu'un vrai. L'échec resterait un échec, mais il ne serait pas une fuite.
 */
export const HOMONYMES: readonly PatientFictif[] = Array.from({ length: 7 }, (_, i) =>
  fictif(`00e${String(i + 1).padStart(3, "0")}`, "Mohammed", "Sadli", `D-4${String(i + 1).padStart(2, "0")}`),
);

/** Une praticienne fictive, pour les tests qui en ont besoin. */
export const PRATICIENNE = {
  id: "00000000-0000-4000-8000-0000000000f1",
  libelle: "Dr Meriem Guerroudj",
} as const;
