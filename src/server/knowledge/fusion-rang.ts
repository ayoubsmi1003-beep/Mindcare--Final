/**
 * `fusion-rang.ts` — la FUSION PAR RANG (Reciprocal Rank Fusion).
 *
 * ═══ CE QUE C'EST ═══
 * `fusionnerParRang` unit les candidats lexicaux et vectoriels en sommant
 * l'INVERSE DE LEUR RANG, jamais leurs scores :
 *
 *     score(chunk) = Σ_branche  poids / (k + rang)
 *
 * Un `ts_rank` (~0.95 pour un match exact) et une similarité cosinus (~0.62
 * pour un bon voisin sémantique) ne sont pas calibrés l'un contre l'autre :
 * les additionner ferait gagner la branche qui produit les plus gros nombres,
 * pas celle qui a trouvé le bon passage. Le rang, lui, est comparable.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas un reranker : la fusion choisit les candidats admis au rerank, elle
 *     ne juge pas la pertinence. Le classement final appartient à
 *     `rerank.ts` (heuristique) ou au cross-encoder (`rerank-cross-encoder.ts`).
 *   · Pas une confiance : aucun score rendu ici n'est présentable au médecin.
 *   · Pas un remplacement de `fusionnerCandidats` : la fusion par score reste
 *     le défaut (comportement historique mesuré). Celle-ci s'active
 *     explicitement, quand les DEUX branches ont produit des candidats.
 */

import type { CandidatBrut, CandidatFusionne } from "./recherche";

/** Constante RRF usuelle (Cormack et al.) : amortit la tête de classement. */
export const K_RRF = 60 as const;

export interface OptionsFusionRang {
  readonly limite: number;
  readonly k?: number;
  readonly poidsLexical?: number;
  readonly poidsVectoriel?: number;
}

/** Projette un candidat brut en candidat fusionné, scores natifs conservés. */
function versFusionne(
  candidat: CandidatBrut,
  scoreLexical: number | null,
  scoreVectoriel: number | null,
  rangLexical: number | null,
  rangVectoriel: number | null,
): CandidatFusionne {
  return {
    chunkId: candidat.chunkId,
    sourceId: candidat.sourceId,
    sourceTitre: candidat.sourceTitre,
    sourceVersion: candidat.sourceVersion,
    section: candidat.section,
    versionChunk: candidat.versionChunk,
    langue: candidat.langue,
    texte: candidat.texte,
    scoreLexical,
    scoreVectoriel,
    rangLexical,
    rangVectoriel,
    unitId: candidat.unitId,
    parentTexteHash: candidat.parentTexteHash,
    enfantIndex: candidat.enfantIndex,
    enfantsTotal: candidat.enfantsTotal,
  };
}

/**
 * Fusionne deux listes DÉJÀ ORDONNÉES par leur branche. Déduplique par
 * `chunkId` (un chunk vu des deux côtés garde ses deux scores natifs et les
 * deux rangs). Ordre total et stable : score RRF décroissant, puis `chunkId`.
 */
export function fusionnerParRang(
  lexicaux: readonly CandidatBrut[],
  vectoriels: readonly CandidatBrut[],
  options: OptionsFusionRang,
): CandidatFusionne[] {
  const { limite } = options;
  if (!Number.isInteger(limite) || limite <= 0) return [];
  const k = options.k ?? K_RRF;
  const poidsLexical = options.poidsLexical ?? 1;
  const poidsVectoriel = options.poidsVectoriel ?? 1;

  const rangs = new Map<string, {
    lexical: number | null;
    vectoriel: number | null;
    scoreLexical: number | null;
    scoreVectoriel: number | null;
    candidat: CandidatBrut;
  }>();
  lexicaux.forEach((candidat, index) => {
    const existant = rangs.get(candidat.chunkId);
    if (existant === undefined) {
      rangs.set(candidat.chunkId, { lexical: index + 1, vectoriel: null, scoreLexical: candidat.score, scoreVectoriel: null, candidat });
    } else {
      existant.scoreLexical = candidat.score;
      if (existant.lexical === null) existant.lexical = index + 1;
    }
  });
  vectoriels.forEach((candidat, index) => {
    const existant = rangs.get(candidat.chunkId);
    if (existant === undefined) {
      rangs.set(candidat.chunkId, { lexical: null, vectoriel: index + 1, scoreLexical: null, scoreVectoriel: candidat.score, candidat });
    } else {
      existant.scoreVectoriel = candidat.score;
      if (existant.vectoriel === null) existant.vectoriel = index + 1;
    }
  });

  const notes: { candidat: CandidatFusionne; rang: number }[] = [];
  for (const entree of rangs.values()) {
    let rang = 0;
    if (entree.lexical !== null) rang += poidsLexical / (k + entree.lexical);
    if (entree.vectoriel !== null) rang += poidsVectoriel / (k + entree.vectoriel);
    // Le score natif de CHAQUE branche reste porté par le candidat : la
    // gouvernance et les seuils aval ne dépendent jamais de la fusion.
    notes.push({
      candidat: versFusionne(entree.candidat, entree.scoreLexical, entree.scoreVectoriel, entree.lexical, entree.vectoriel),
      rang,
    });
  }
  return notes
    .sort((a, b) => b.rang - a.rang || (a.candidat.chunkId < b.candidat.chunkId ? -1 : 1))
    .slice(0, limite)
    .map((entree) => entree.candidat);
}
