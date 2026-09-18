/**
 * `recherche.ts` — M07 · la FUSION BORNÉE de candidats.
 *
 * ═══ CE QUE C'EST ═══
 * Une fonction PURE qui unit les candidats lexicaux (≤20) et vectoriels (≤20)
 * en une liste fusionnée (≤20) : déduplication par `chunkId`, ordre
 * déterministe (meilleur score d'abord, `chunkId` en départage), budget
 * d'évidence (≤8000 caractères, troncature sémantique : items entiers, par la
 * fin — même discipline que `jarvis-assembleur.ts`).
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas un accès base : les candidats arrivent déjà filtrés
 *     `C4 + active + approved` par les portes SQL. La fusion ne ré-autorise
 *     rien — elle borne et ordonne.
 *   · Pas un reranker : le score final vient de `rerank.ts`. Ici l'ordre
 *     n'est qu'un départage stable avant rerank.
 */

import type { ChunkId, Langue, SourceId } from "./types";
import type { IssueRecherche, RetrievedEvidence } from "./types";
import { construirePreuve, qualifier } from "./preuve";
import { CALIBRATION_COURANTE, rerankerCalibre, type CalibrationFusion, type RerankerLocalAsync } from "./rerank";
import { lignePorteRecuperable, validerLignePorte, type LignePorte } from "./stockage";

/** Les bornes (§18) — déterministes, jamais négociables depuis le client. */
export const LIMITES = {
  /** Candidats lexicaux par requête. */
  LEXICAL: 20,
  /** Candidats vectoriels par requête. */
  VECTORIEL: 20,
  /** Candidats fusionnés avant rerank. */
  FUSION: 20,
  /** Évidences finales. */
  FINAL: 5,
  /** Budget total du texte d'évidence, en caractères. */
  BUDGET_OCTETS: 8000,
} as const;

/** Un candidat brut, tel que rendu par une porte (lexicale ou vectorielle). */
export interface CandidatBrut {
  readonly chunkId: ChunkId;
  readonly sourceId: SourceId;
  readonly sourceTitre: string;
  readonly sourceVersion: string;
  readonly section: string | null;
  readonly versionChunk: string;
  readonly langue: Langue;
  readonly texte: string;
  /** Similarité native de la branche (0..1), ou `null` si l'autre branche. */
  readonly score: number;
}

/** Un candidat fusionné : les deux branches, ou une seule. */
export interface CandidatFusionne {
  readonly chunkId: ChunkId;
  readonly sourceId: SourceId;
  readonly sourceTitre: string;
  readonly sourceVersion: string;
  readonly section: string | null;
  readonly versionChunk: string;
  readonly langue: Langue;
  readonly texte: string;
  readonly scoreLexical: number | null;
  readonly scoreVectoriel: number | null;
}

/**
 * Unit les deux listes : un `chunkId` présent des deux côtés ne compte
 * qu'une fois (matrice n°29), avec ses deux scores conservés pour le rerank.
 * L'ordre est TOTAL et stable : meilleur des deux scores d'abord, puis
 * `chunkId` croissant — même entrée, même ordre, toujours.
 */
export function fusionnerCandidats(
  lexicaux: readonly CandidatBrut[],
  vectoriels: readonly CandidatBrut[],
): CandidatFusionne[] {
  const parChunk = new Map<ChunkId, CandidatFusionne>();
  for (const candidat of lexicaux.slice(0, LIMITES.LEXICAL)) {
    parChunk.set(candidat.chunkId, {
      chunkId: candidat.chunkId,
      sourceId: candidat.sourceId,
      sourceTitre: candidat.sourceTitre,
      sourceVersion: candidat.sourceVersion,
      section: candidat.section,
      versionChunk: candidat.versionChunk,
      langue: candidat.langue,
      texte: candidat.texte,
      scoreLexical: candidat.score,
      scoreVectoriel: null,
    });
  }
  for (const candidat of vectoriels.slice(0, LIMITES.VECTORIEL)) {
    const existant = parChunk.get(candidat.chunkId);
    if (existant === undefined) {
      parChunk.set(candidat.chunkId, {
        chunkId: candidat.chunkId,
        sourceId: candidat.sourceId,
        sourceTitre: candidat.sourceTitre,
        sourceVersion: candidat.sourceVersion,
        section: candidat.section,
        versionChunk: candidat.versionChunk,
        langue: candidat.langue,
        texte: candidat.texte,
        scoreLexical: null,
        scoreVectoriel: candidat.score,
      });
    } else {
      parChunk.set(candidat.chunkId, { ...existant, scoreVectoriel: candidat.score });
    }
  }
  return [...parChunk.values()]
    .sort((a, b) => meilleurScore(b) - meilleurScore(a) || (a.chunkId < b.chunkId ? -1 : 1))
    .slice(0, LIMITES.FUSION);
}

function meilleurScore(candidat: Pick<CandidatFusionne, "scoreLexical" | "scoreVectoriel">): number {
  return Math.max(candidat.scoreLexical ?? Number.NEGATIVE_INFINITY, candidat.scoreVectoriel ?? Number.NEGATIVE_INFINITY);
}

/**
 * Applique le budget d'évidence : items entiers, on retire par la fin (les
 * moins bien rangés d'abord). Rend les retenues + si une coupe a eu lieu.
 */
export function appliquerBudgetOctets<T extends { readonly texte: string }>(
  evidences: readonly T[],
  budget: number = LIMITES.BUDGET_OCTETS,
): { readonly retenues: readonly T[]; readonly tronque: boolean } {
  let total = 0;
  const retenues: T[] = [];
  for (const evidence of evidences) {
    if (total + evidence.texte.length > budget) {
      return { retenues, tronque: true };
    }
    total += evidence.texte.length;
    retenues.push(evidence);
  }
  return { retenues, tronque: false };
}

/** Projette une ligne validée+gouvernée en candidat brut (branche indifférente). */
export function versCandidat(ligne: LignePorte): CandidatBrut {
  return {
    chunkId: ligne.chunk_id,
    sourceId: ligne.source_id,
    sourceTitre: ligne.source_titre,
    sourceVersion: ligne.source_version,
    section: ligne.section,
    versionChunk: ligne.version_chunk,
    langue: ligne.langue,
    texte: ligne.texte,
    score: ligne.score,
  };
}

/**
 * Orchestration PARTAGÉE (M07 slice 2) : validation + gouvernance +
 * fusion + rerank + qualification + preuves + budget, sur des lignes de
 * portes BRUTES (lexicales et vectorielles). Même fonction pour le service
 * (`connaissance-recherche.ts`, portes via DbPort) et la passerelle
 * (`jarvis-chat`, portes via `client.rpc`) : UNE sémantique, pas deux qui
 * divergeraient. Pure et déterministe (reranker synchrone) ; le cross-
 * encoder optionnel (R4/M13) passe par `rerankerLocal`, avec repli
 * heuristique signalé (jamais silencieux : `repliReranker: true`).
 */
export async function orchestrerRecherche(
  question: string,
  brutesLexicales: readonly unknown[],
  brutesVectorielles: readonly unknown[],
  rerankerLocal?: RerankerLocalAsync,
  calibration: CalibrationFusion = CALIBRATION_COURANTE,
): Promise<{
  readonly issue: IssueRecherche;
  readonly evidences: readonly RetrievedEvidence[];
  readonly repliReranker: boolean;
}> {
  const passer = (brutes: readonly unknown[]): CandidatBrut[] => {
    const sorties: CandidatBrut[] = [];
    for (const brute of brutes) {
      const ligne = validerLignePorte(brute);
      if (ligne === null || !lignePorteRecuperable(ligne)) continue;
      sorties.push(versCandidat(ligne));
    }
    return sorties;
  };
  const fusionnes = fusionnerCandidats(passer(brutesLexicales), passer(brutesVectorielles));
  // `CALIBRATION_COURANTE` rend exactement l'historique : défaut inchangé,
  // variants mesurés via `calibration` (M07 slice 3, jamais depuis le client).
  let ranges = rerankerCalibre(question, fusionnes, LIMITES.FINAL, calibration);
  let repliReranker = false;
  if (rerankerLocal !== undefined) {
    try {
      ranges = await rerankerLocal.rerankerAsync(question, fusionnes, LIMITES.FINAL);
    } catch {
      // Repli heuristique déjà calculé ci-dessus : on le garde tel quel,
      // en le signalant (l'appelant journalise, ici jamais de log direct).
      repliReranker = true;
    }
  }
  const issue = qualifier(ranges);
  const evidences: RetrievedEvidence[] = ranges.map((range) => construirePreuve(range));
  const { retenues } = appliquerBudgetOctets(evidences);
  if (issue === "aucune") return { issue, evidences: [], repliReranker };
  return { issue, evidences: retenues, repliReranker };
}
