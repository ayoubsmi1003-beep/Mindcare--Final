/**
 * `gouvernance.ts` — M07 · le FILTRE DE GOUVERNANCE côté TypeScript.
 *
 * ═══ CE QUE C'EST ═══
 * Une fonction PURE et DÉTERMINISTE (pas de base, pas de réseau, pas de LLM,
 * pas d'effet de bord) qui constate si une source PEUT entrer en récupération
 * normale. Défense en profondeur : l'autorisation réelle est imposée par les
 * portes SQL (`stockage.ts`), qui filtrent dans la requête — un `if` ici ne
 * suffit jamais (§5 de la mission).
 *
 * ═══ LA RÈGLE (§4 + H1) ═══
 * Récupérable (défaut) : classification = C4
 *             ET statut = active
 *             ET approvedAt renseigné
 *             ET approvedBy renseigné
 *             ET revue à jour (review_due_at NULL ou future)
 *             ET non supersédée (superseded_by NULL)
 *
 * Tout le reste — revoked, inactive, superseded, revue en retard, discovered,
 * classified, reviewed sans approbation, C1, C2, C3, UNKNOWN — est exclu de
 * la récupération normale. L'historique explicite (`p_inclure_historique`)
 * est une voie SQL séparée, jamais un assouplissement de cette fonction.
 */

import type { ClasseDonnees } from "@/server/egress/classification";
import type { AttestationSource, StatutSource } from "./types";

/** Pourquoi une source est exclue — codes stables, non identifiants. */
export type MotifGouvernance =
  | "non-c4"
  | "non-active"
  | "non-approuvee"
  | "revue-en-retard"
  | "supersedee";

/**
 * Constate la récupérabilité. Un seul chemin rend `true`. Tout le reste — y
 * compris l'inconnu — rend `false` (échec fermé, comme `garderReponse` en M06).
 */
export function estRecuperable(source: AttestationSource): boolean {
  return motifBlocage(source) === null;
}

/**
 * Le PREMIER motif d'exclusion, dans l'ordre d'évaluation : classification,
 * lifecycle, approbation, revue, supersession. `null` = récupérable.
 * L'ordre est un diagnostic (quelle condition manque ?), pas une priorité.
 */
export function motifBlocage(source: AttestationSource): MotifGouvernance | null {
  if (source.classification !== "C4") return "non-c4";
  if (source.statut !== "active") return "non-active";
  if (!estRenseigne(source.approvedAt) || !estRenseigne(source.approvedBy)) {
    return "non-approuvee";
  }
  if (!source.revueAJour) return "revue-en-retard";
  if (source.remplaceePar !== null) return "supersedee";
  return null;
}

/** Les statuts qui EXISTENT mais n'ouvrent jamais la récupération normale. */
export const STATUTS_NON_RECUPERABLES: ReadonlySet<StatutSource> = new Set([
  "discovered",
  "classified",
  "reviewed",
  "revoked",
  "inactive",
  "superseded",
]);

const STATUTS_CONNUS: ReadonlySet<string> = new Set([
  "discovered",
  "classified",
  "reviewed",
  "active",
  "revoked",
  "inactive",
  "superseded",
]);

const CLASSES_CONNUES: ReadonlySet<string> = new Set(["C1", "C2", "C3", "C4", "INCONNU"]);

/**
 * Reconstitue une attestation depuis une ligne de porte. `null` = vocabulaire
 * inconnu (statut ou classification hors vocabulaire fermé) — traité comme
 * non récupérable par l'appelant, jamais deviné. Les valeurs d'approbation
 * et de revue viennent de la ligne lue en base, jamais du client (§6).
 */
export function attestationDepuisPorte(
  statut: string,
  classification: string,
  approvedAt: string | null,
  approvedBy: string | null,
  revueAJour: boolean,
  remplaceePar: string | null,
): AttestationSource | null {
  if (!STATUTS_CONNUS.has(statut) || !CLASSES_CONNUES.has(classification)) return null;
  return {
    statut: statut as StatutSource,
    classification: classification as ClasseDonnees,
    approvedAt,
    approvedBy,
    revueAJour,
    remplaceePar,
  };
}

function estRenseigne(valeur: string | null): boolean {
  return typeof valeur === "string" && valeur.trim() !== "";
}
