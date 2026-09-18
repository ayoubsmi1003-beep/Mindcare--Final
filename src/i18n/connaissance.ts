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
