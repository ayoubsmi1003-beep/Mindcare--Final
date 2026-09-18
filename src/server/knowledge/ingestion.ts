/**
 * `ingestion.ts` — M07 · la PORTE D'INGESTION (H9, pure, sans base).
 *
 * ═══ CE QUE C'EST ═══
 * Le validateur qui décide si un document PEUT entrer dans le pipeline
 * (découpe → embeddings → portes). Fonction PURE : aucun document ne devient
 * récupérable-actif « parce qu'il existe » — l'ingestion est approval-gated,
 * et la validation des 9 champs est le premier verrou (le second est la
 * migration 092, le troisième la gouvernance à la lecture).
 *
 * Champs exigés (H9) : titre, version, langue, classification, provenance,
 * hash de contenu, identité d'approbation, horodatage d'approbation,
 * métadonnées de revue. Marqueur `FIXTURE` → rejeté par la validation
 * PRODUCTION (les fixtures ne se promeuvent jamais seules).
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas une écriture : validé ≠ ingéré ≠ actif. L'écriture réelle attend
 *     la porte A (migration) et la porte C (corpus approuvé).
 *   · Pas un classifieur : la classification est DÉCLARÉE par le producteur
 *     et CONTRE-VÉRIFIÉE à l'embedding (`passerelleEmbedding` + `classerCharge`
 *     sur les octets). Un mensonge ici bloque là-bas — défense en profondeur.
 */

import type { ClasseDonnees } from "@/server/egress/classification";
import type { Langue } from "./types";

/** Provenance de production exigée : qui a produit QUOI, d'OÙ. */
export interface ProvenanceIngestion {
  /** Émetteur identifié (éditeur, société savante, cabinet) — jamais vide. */
  readonly emetteur: string;
  /** Référence d'origine (URL pérenne, ISBN, cote interne) — jamais vide. */
  readonly reference: string;
}

/** Métadonnées de revue exigées : qui a relu, quand, jusqu'à quand. */
export interface RevueIngestion {
  /** Relecteur humain identifié (uuid profil) — jamais un acteur client. */
  readonly relecteur: string;
  /** Horodatage ISO de la relecture. */
  readonly revueLe: string;
  /** Échéance ISO de prochaine revue — `null` = sans échéance (documenté). */
  readonly revueDueLe: string | null;
}

/** Le dossier candidat à l'ingestion. */
export interface DossierIngestion {
  readonly titre: string;
  readonly version: string;
  readonly langue: Langue;
  readonly classification: ClasseDonnees;
  readonly provenance: ProvenanceIngestion;
  /** Hash hex du contenu canonique source (détecte toute altération). */
  readonly hashContenu: string;
  readonly approuvePar: string;
  readonly approuveLe: string;
  readonly revue: RevueIngestion;
  /** `true` = fixture de test/banc — rejetée par la validation production. */
  readonly fixture: boolean;
}

/** Motif de rejet — codes stables, affichables, sans contenu. */
export type MotifRejetIngestion =
  | "titre-manquant"
  | "version-manquante"
  | "classification-non-c4"
  | "provenance-incomplete"
  | "hash-manquant"
  | "approbation-incomplete"
  | "revue-incomplete"
  | "fixture-interdite";

export type VerdictIngestion =
  | { readonly ok: true }
  | { readonly ok: false; readonly motif: MotifRejetIngestion };

/**
 * Valide un dossier. Un seul chemin rend `ok: true`. `fixture: true` est
 * rejeté ICI (`fixture-interdite`) : aucune fixture ne traverse vers la
 * production, même approuvée par erreur — la promotion est un acte humain
 * hors code, jamais un booléen qui bascule.
 *
 * Seule la classification C4 passe : C1/C2/C3/UNKNOWN sont rejetés AVANT
 * tout embedding (le premier des trois verrous ; `passerelleEmbedding`
 * reste le second, `external-call.ts` l'autorité finale).
 */
export function validerSource(dossier: DossierIngestion): VerdictIngestion {
  if (dossier.fixture) return { ok: false, motif: "fixture-interdite" };
  if (dossier.titre.trim() === "") return { ok: false, motif: "titre-manquant" };
  if (dossier.version.trim() === "") return { ok: false, motif: "version-manquante" };
  if (dossier.classification !== "C4") return { ok: false, motif: "classification-non-c4" };
  if (dossier.provenance.emetteur.trim() === "" || dossier.provenance.reference.trim() === "") {
    return { ok: false, motif: "provenance-incomplete" };
  }
  if (!/^[0-9a-f]{8,128}$/i.test(dossier.hashContenu)) return { ok: false, motif: "hash-manquant" };
  if (dossier.approuvePar.trim() === "" || dossier.approuveLe.trim() === "") {
    return { ok: false, motif: "approbation-incomplete" };
  }
  if (dossier.revue.relecteur.trim() === "" || dossier.revue.revueLe.trim() === "") {
    return { ok: false, motif: "revue-incomplete" };
  }
  return { ok: true };
}
