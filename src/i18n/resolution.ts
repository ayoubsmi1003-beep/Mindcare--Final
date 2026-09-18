/**
 * `resolution.ts` — libellés M02 de clarification de référence.
 *
 * ═══ POURQUOI UN MODULE SÉPARÉ, PAS `fr.ts` ═══
 * `fr.ts` est gelé (découpe Phase 6) : on n'y ajoute rien, on n'en retire
 * rien. Ces trois libellés sont pourtant des chaînes d'interface (bulles
 * Jarvis rendues à l'écran) — donc `src/i18n/`, jamais en dur, jamais côté
 * passerelle. Module minuscule et fermé : trois fonctions, aucune import.
 *
 * ═══ RÈGLES DE RÉDACTION (sécurité) ═══
 * · `nonTrouve` nomme la mention INCONNUE, jamais un dossier existant, et
 *   n'affirme jamais l'inexistence (la RLS a pu filtrer — « parmi les
 *   dossiers visibles »).
 * · `homonymes` ne liste que des LIBELLÉS fournis par la sonde (visibles,
 *   déjà connus de la praticienne), jamais de donnée clinique, et signale
 *   honnêtement la troncature (`et N autres`) sans inventer de noms.
 * · Aucun libellé ne reprend du texte libre du modèle ou du dossier.
 */

/** « Montre-moi Sarah » — 0 candidat visible. */
export function clarificationNonTrouve(mention: string): string {
  return (
    `Je ne trouve personne nommée « ${mention} » parmi les dossiers visibles. ` +
    `Pouvez-vous préciser le nom ?`
  );
}

/** « Montre-moi Mohamed » — N candidats : on liste, la praticienne tranche. */
export function clarificationHomonymes(
  mention: string,
  libelles: readonly string[],
  total: number,
): string {
  const visibles = libelles.slice(0, 10).join(", ");
  const reliquat = total - libelles.length;
  const suite = reliquat > 0 ? `, et ${String(reliquat)} autre${reliquat > 1 ? "s" : ""}` : "";
  return (
    `Plusieurs dossiers correspondent à « ${mention} » : ${visibles}${suite}. ` +
    `Lequel voulez-vous voir ?`
  );
}

/** La sonde elle-même a échoué : aveu nommé, jamais de devinette. */
export function clarificationSondeIndisponible(): string {
  return "La recherche est indisponible pour l'instant. Pouvez-vous reformuler ?";
}
