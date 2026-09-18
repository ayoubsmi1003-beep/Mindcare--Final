/**
 * `intention-chainee.ts` — L'INLET CHAÎNÉ M02, côté serveur (pur).
 *
 * ═══ POURQUOI CET INLET EXISTE ═══
 * Le classifieur M01 ne voit que le message nu : « Et avant ? » y est
 * UNKNOWN par construction (il manque le fil, et c'est normal — le
 * classifieur ne doit pas deviner un contexte qu'on ne lui donne pas). Le
 * client, lui, détient le fil prouvé (verdict unique + miroir concordant)
 * et l'intent du tour précédent. Cet inlet marie les deux SANS faire
 * confiance au client : le serveur ne prend du corps que DEUX chaînes
 * (nom + conversation), reconstruit l'intent lui-même, le revalide par le
 * contrat M01, le borne au fil de CE tour, et le soumet à la compatibilité
 * existante. Tout le reste du chemin (Cas C, bloc intention, filtre
 * compat) est inchangé.
 *
 * ═══ RÈGLES D'EMPLOI (tout écart rend `null`) ═══
 * · interrupteur `JARVIS_RESOLUTION_ENABLED=false` → null (repli historique) ;
 * · chemin refus → null, TOUJOURS (le refus est absolu, jamais un repli) ;
 * · chemin connaissance → rempli SEULEMENT si le classifieur est incertain
 *   (panne ou UNKNOWN) : c'est l'escalade du suivi nu (« Et avant ? »), que
 *   le routeur — aveugle au fil — classe savoir. Un savoir DÉCIDÉ
 *   (GENERAL_KNOWLEDGE valide) n'est jamais escaladé ;
 * · classification VALIDE et décidée (ni UNKNOWN ni ASK) → null : le
 *   classifieur a parlé, on ne l'écrase jamais avec un repli client ;
 * · ASK_CLARIFICATION confiant → null : le classifieur demande, on respecte ;
 * · méta ou ÉCRITURE chaînée → null : un suivi vague ne porte jamais
 *   d'écriture, même relayé par un client compromis ;
 * · conversation du corps ≠ conversation du tour → null (anti-rejeu
 *   inter-conversations).
 *
 * ═══ CONFIANCE (lire avant de durcir) ═══
 * L'inlet fait confiance au client pour DEUX chaînes (nom + conversation),
 * comme la route fait déjà confiance au `contexte`/amorce client (contrôlé
 * Tier0, exécution RLS). Il ne lui fait confiance pour RIEN d'autre :
 * l'intent est reconstruit ici (confiance plafonnée, zéro entité), la
 * famille reste verrouillée par la compatibilité existante, et un client
 * compromis ne peut ni forger d'entités, ni gonfler la confiance, ni
 * chaîner une écriture, ni sortir du fil (porte de fil côté boucle).
 *
 * Pur : `process.env` lu comme M01 (`classifieurActif`), aucune E/S sinon.
 * Importé par `route.ts` (appel) et les tests (direct).
 */

import {
  INTENTS_ECRITURE,
  INTENTS_META,
  estNomIntention,
  validerIntent,
  type IntentValide,
} from "@/shared/jarvis/intentions";
import type { ResultatClassification } from "./classifieur-intentions";

/** Pendant serveur de `INTENT_CLASSIFIER_ENABLED` (M01) : repli historique. */
export function resolutionChaineeActive(): boolean {
  return process.env.JARVIS_RESOLUTION_ENABLED !== "false";
}

/** Ce que le client a le droit d'envoyer : deux chaînes, rien d'autre. */
export interface IntentionChaineeBrute {
  readonly nom: unknown;
  readonly conversationId: unknown;
}

function lireBrute(v: unknown): IntentionChaineeBrute | null {
  if (typeof v !== "object" || v === null) return null;
  return v as IntentionChaineeBrute;
}

/**
 * L'intention chaînée opérationnelle, ou `null`. Reconstruite ici (confiance
 * plafonnée, aucune entité — le fil prouvé satisfait la mention), jamais
 * recopiée du corps : un client compromis ne peut ni forger d'entités, ni
 * gonfler la confiance, ni chaîner une écriture.
 */
export function intentionChaineeOperationnelle(
  valeur: unknown,
  classification: ResultatClassification | null,
  chemin: string,
  conversationId: string,
): IntentValide | null {
  if (!resolutionChaineeActive()) return null;
  // Le refus est absolu : aucun repli ne le remplit, jamais. La connaissance
  // reste remplissable (escalade du suivi nu, voir en-tête) ; le savoir
  // DÉCIDÉ est protégé ci-dessous par la règle du classifieur.
  if (chemin !== "patient" && chemin !== "connaissance") return null;
  // Jamais confiance au type de l'appelant : on rétrécit ici, et on
  // revalide chaque champ ci-dessous.
  const brute = lireBrute(valeur);
  if (brute === null) return null;
  // Le classifieur a DÉCIDÉ (valide, ni UNKNOWN ni ASK) : le repli s'efface.
  if (classification?.statut === "valide") {
    const nomClasse = classification.intent.name;
    if (nomClasse !== "UNKNOWN" && nomClasse !== "ASK_CLARIFICATION") return null;
    // ASK explicite : le classifieur demande — on respecte, jamais de repli.
    if (nomClasse === "ASK_CLARIFICATION") return null;
  }
  if (!estNomIntention(brute.nom)) return null;
  if (INTENTS_META.has(brute.nom) || INTENTS_ECRITURE.has(brute.nom)) return null;
  if (typeof brute.conversationId !== "string" || brute.conversationId !== conversationId) {
    return null;
  }
  return validerIntent({
    name: brute.nom,
    entities: {},
    references: { pronomSansAntecedent: false, homonymePossible: false },
    confidence: 0.6,
    missingInformation: [],
  });
}
