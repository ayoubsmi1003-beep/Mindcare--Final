/**
 * `connaissance.ts` — libellés M07 de recherche de connaissance.
 *
 * ═══ POURQUOI UN MODULE SÉPARÉ, PAS `fr.ts` ═══
 * Même précédent que `resolution.ts` (M02) : `fr.ts` est gelé (découpe
 * Phase 6). Ces libellés sont des chaînes d'interface — donc `src/i18n/`,
 * jamais en dur. Module fermé, aucune import.
 *
 * ═══ RÈGLES DE RÉDACTION (sécurité) ═══
 * · Aucun libellé ne reprend du texte de chunk ou de requête : ce sont des
 *   phrases fixes — un chunk piégé ne peut pas parler par leur bouche.
 * · `aucunePreuve` et `preuveFaible` disent l'insuffisance, jamais une
 *   certitude ; elles n'invitent pas à deviner.
 * · Aucun score, aucun pourcentage : un rang de récupération n'est pas une
 *   confiance médicale et ne s'affiche jamais comme tel.
 */

/** Requête vide : on redemande, on ne devine pas. */
export const REQUETE_VIDE = "Pouvez-vous préciser votre question ? Je n'ai rien à chercher.";

/** Requête démesurée : refus borné, pas de troncature silencieuse. */
export const REQUETE_TROP_LONGUE =
  "Votre question est trop longue pour la recherche documentaire. Pouvez-vous la raccourcir ?";

/** Aucune source approuvée pertinente : préférable à une hallucination. */
export const AUCUNE_PREUVE =
  "Aucune source approuvée suffisamment pertinente n'a été trouvée. Je ne peux pas répondre sur cette base.";

/** Apparenté mais insuffisant : au médecin de trancher, pas au modèle. */
export const PREUVE_FAIBLE =
  "Les sources trouvées sont trop faibles pour répondre avec confiance. Voici les passages les plus proches, à vérifier :";

/** Portes indisponibles (migration 092 non appliquée, base injoignable). */
export const CONNAISSANCE_INDISPONIBLE =
  "La recherche documentaire est momentanément indisponible.";

/**
 * Historique demandé mais variante de porte non définie (porte A) : refus
 * explicite plutôt que mélange silencieux courant + historique (H1).
 */
export const HISTORIQUE_NON_DISPONIBLE =
  "La consultation de l'historique documentaire n'est pas encore disponible.";

/** Aucune preuve de livre cliniquement libérée : aucune réponse médicale de repli. */
export const AUCUNE_PREUVE_LIVRES =
  "Je ne peux pas répondre à cette question médicale à partir des six livres fournis : aucun passage vérifié et activé ne la soutient actuellement.";

export const DIAGNOSTICS_LIVRES = {
  "recherche-indisponible": "La recherche dans les livres n'a pas abouti. Je ne peux pas vérifier la réponse maintenant ; réessayez quand le service sera disponible.",
  "recherche-partielle": "La recherche par mots n'a trouvé aucun passage et la recherche sémantique n'était pas disponible. Je ne peux pas conclure que les livres ne contiennent pas la réponse ; réessayez après rétablissement du service.",
  "recherche-lexicale-indisponible": "La recherche par mots dans les livres est indisponible. La recherche sémantique n'a trouvé aucun passage ; je ne peux pas conclure que les livres ne contiennent pas la réponse.",
  "livres-non-recherchables": "Les livres sont présents, mais aucun passage n'est à la fois activé et attesté pour la recherche. Je ne peux pas encore citer ces livres ; leur état de revue doit être terminé.",
  "aucun-passage-accessible": "Je n'ai trouvé aucun passage accessible dans les livres qui réponde à cette question. Les livres non activés ou non attestés restent exclus de la recherche.",
  "provenance-invalide": "Des passages ont été trouvés, mais leur titre, leur section ou leur lien à la page n'est pas suffisamment vérifié pour les citer. Une revue de la source est nécessaire.",
  "identifiant-introuvable": "Des passages proches existent, mais aucun ne contient l'identifiant exact demandé. Je ne peux pas attribuer à cet identifiant une information trouvée ailleurs.",
  "conflit-ocr-connu": "Le passage trouvé comporte un désaccord connu entre l'image imprimée et le texte OCR. Je peux localiser la page, mais je ne peux pas citer le détail concerné avant une relecture de l'image source.",
  "valeur-non-confirmee": "Des passages proches existent, mais la valeur demandée n'a pas de correspondance unique avec une ligne et une page du livre. Je ne vais pas deviner le chiffre.",
  "ocr-incertain": "Un passage proche a été trouvé, mais son texte OCR est signalé comme incertain. Il faut vérifier l'image de la page avant de le citer.",
  "dose-ocr-non-verifiee": "Un passage proche contient une dose ou une quantité issue de l'OCR qui n'est pas libérée pour la réponse. Il faut comparer le chiffre à la page avant de le citer.",
} as const;

export const PASSAGES_LIVRES = "Passages des livres à vérifier :";
export const PAGE_PDF = "PDF p.";
export const PAGE_IMPRIMEE = "page imprimée";
export const PAGE_IMPRIMEE_INDISPONIBLE = "Page imprimée non vérifiée";
export const OCR_NON_RELU = "Texte OCR non relu cliniquement.";
export const OCR_SUSPECT = "Texte OCR incertain : passage écarté.";
export const EXTRAIT_SOURCE = "Extrait source";
export const LIVRE_NUMERO = "Livre";
export const TITRE_IMPRIME = "Titre imprimé";
export const NOMS_DOSSIERS_LIVRES: Readonly<Record<number, string>> = {
  1: "DSM-5 Manuel diagnostique et statistiques des troubles mentaux",
  2: "ICD-Reference Guide",
  3: "psychiatrie clinique  Approche bio-psycho-sociale Tome 1",
  4: "psychiatrie clinique  Approche bio-psycho-sociale Tome 2",
  5: "référentiel de psychiatrie et Addictologie",
  6: "Prescribing Guidelines in Psychiatry, David M. Taylor (2021)",
};
