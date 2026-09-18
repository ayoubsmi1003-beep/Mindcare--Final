/**
 * `jarvis-routage-intentions.ts` - LE ROUTEUR M04 : INTENTION VALIDEe -> FAMILLE AUTORISEE.
 *
 * === CE QUE CE FICHIER FAIT, ET CE QU'IL NE FAIT PAS ===
 * Il repond a une seule question, de facon pure et deterministe : pour une
 * intention validee donnee, une proposition de capacite appartient-elle a la
 * famille autorisee ? Il valide aussi le signal d'intention qui accompagne
 * une proposition (echo serveur) : un nom M01 connu passe, tout le reste
 * rend null - jamais d'autorite tiree d'une chaine arbitraire.
 *
 * L'AUTORITE RESTE `COMPATIBLE` (M01, `shared/jarvis/intentions.ts`) : ce
 * module ne duplique AUCUNE table. `capacitesAutorisees` est un accesseur
 * documente, pas une seconde verite.
 *
 * Il ne resout personne (M02), n'assemble rien (M03), n'autorise rien (les
 * portes restent Zod + RLS + confirmation), n'execute rien, n'appelle aucun
 * modele, ne calcule aucune date, ne reclasse rien. En particulier :
 * - intent null/undefined = AUCUN filtre (comportement historique permissif).
 *   Le filtre ne mord que sur une intention validee presente ; sans elle, les
 *   gates existants (registre, dedup, ambiguite, fil, compat serveur) gardent
 *   le tour exactement comme avant M04.
 * - le nom propose est attendu CANONIQUE (alias resolu par `canoniserAppel`
 *   cote boucle AVANT ce controle). `COMPATIBLE` liste les deux orthographes,
 *   donc les deux passent - comme cote serveur.
 * - une intention d'ecriture autorise sa capacite au sens CLASSIFICATION :
 *   la boucle ne peut de toute facon pas l'executer (elle n'importe que les
 *   lectures) et la remet en `propositionInconnue` vers le cycle
 *   PROPOSE -> CONFIRM -> EXECUTE -> VERIFY -> LOG, inchange.
 *
 * === POURQUOI CE FICHIER VIT DANS `services/` ===
 * Il est consomme par `jarvis-boucle.ts`, sans I/O malgre l'emplacement :
 * fonctions pures, testables hors ligne comme la resolution M02.
 *
 * NOTE D'ENCODAGE : ce fichier est volontairement ASCII-only (francais sans
 * accents), a l'image de l'assembleur M03 et des harnais d'eval.
 */

import {
  COMPATIBLE,
  estNomIntention,
  estPropositionCompatible,
  type NomIntention,
} from "@/shared/jarvis/intentions";

/**
 * La famille fermee autorisee pour une intention validee. Accesseur direct
 * sur la table normative M01 - toute evolution de la table reste une
 * decision M01 (humaine), jamais un elargissement silencieux M04.
 */
export function capacitesAutorisees(intent: NomIntention): readonly string[] {
  return COMPATIBLE[intent];
}

/**
 * `true` si la proposition appartient a la famille de l'intention.
 *
 * - `intent` null/undefined : `true` (pas d'intention validee en force, le
 *   tour garde son comportement historique ; les autres gates s'appliquent).
 * - `nomPropose` non-chaine ou vide : `false` (jamais d'autorisation sur
 *   une forme etrangere).
 * - Sinon : delegation stricte a `estPropositionCompatible` (M01).
 *
 * Monotonicite garantie par construction : ajouter des propositions du
 * modele ne peut jamais elargir la famille - chaque nom est juge separement.
 */
export function propositionAutorisee(
  intent: NomIntention | null | undefined,
  nomPropose: unknown,
): boolean {
  if (intent === null || intent === undefined) return true;
  if (typeof nomPropose !== "string" || nomPropose.length === 0) return false;
  return estPropositionCompatible(intent, nomPropose);
}

/**
 * Valide le signal d'intention qui accompagne une proposition (echo serveur
 * `intent`, repli chaine). Un nom M01 connu passe ; UUID forge, jeton,
 * texte libre, type etranger rendent `null` - et `null` desarme le filtre
 * (permissif historique), il ne l'oriente jamais.
 */
export function intentionValideeDe(v: unknown): NomIntention | null {
  return estNomIntention(v) ? v : null;
}
