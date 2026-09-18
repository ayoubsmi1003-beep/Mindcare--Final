/**
 * `rerank-cross-encoder.ts` — M07 R4 · le RERANK CROSS-ENCODER LOCAL.
 *
 * ═══ CE QUE C'EST ═══
 * Le second implémenteur de `RerankerLocal` (via `RerankerLocalAsync`) :
 * les paires (requête, chunk) sont notées par un cross-encoder local
 * (bge-reranker-v2-m3, ONNX, XLM-R) et les candidats FUSIONNÉS (≤20) sont
 * réordonnés par logit décroissant → top-5. Pipeline visé (Master Plan §10) :
 * hybride → Top-20 → cross-encoder local → Top-5.
 *
 * ═══ SÉPARATION RANKING / AUTORISATION ═══
 * Le cross-encoder ne fait que RÉORDONNER. Le `score` transporté reste
 * l'échelle heuristique 0..1 (`HeuristiqueBaseline`) : les seuils de
 * `preuve.ts` (0.4 / 0.15) et toute la gouvernance sont inchangés. Un
 * cross-encoder n'autorise rien — il classe (matrice : ranking ≠ gating).
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas d'I/O : session ONNX + tokenizer INJECTÉS (même discipline que
 *     `embeddings-local.ts`). Aucun import `onnxruntime`, `pg`, `fetch`.
 *   · Pas de calibration absolue : les logits bruts n'entrent dans aucun
 *     seuil ; seuls l'ORDRE et le départage déterministe (`chunkId`) comptent.
 *   · Pas silencieux : graphe inattendu, forme de logits inattendue ou
 *     échec d'inférence → le SERVICE replie sur l'heuristique (fail-closed,
 *     `connaissance-recherche.ts`), jamais d'ordre bricolé ici.
 */

import { HeuristiqueBaseline, type CandidatRange, type RerankerLocalAsync } from "./rerank";
import type { CandidatFusionne } from "./recherche";

/** Nom du reranker — persisté dans les traces d'évaluation. */
export const RERANK_CROSS_ENCODER_NOM = "cross-encoder-local" as const;

/** Version du reranker (modèle + recette d'encodage). */
export const RERANK_CROSS_ENCODER_VERSION = "bge-reranker-v2-m3-onnx-r4" as const;

/** Longueur max d'une paire (requête + document + 4 spéciaux XLM-R). */
export const TRONCATURE_PAIRE_MAX = 512 as const;

/** Sortie minimale d'un tokenizer à paires (suffit au cross-encoder XLM-R). */
export interface EncodagePaires {
  readonly ids: readonly number[];
  readonly attention_mask: readonly number[];
}

/** Tokenizer injecté : `encode` avec `text_pair` (post-processeur XLM-R). */
export interface TokenizerPairesMinimal {
  encode(texte: string, options?: { readonly text_pair?: string | null }): EncodagePaires;
  token_to_id(token: string): number | undefined;
}

/** Session ONNX injectée (la réelle : `onnxruntime-node`, CPU). */
export interface SessionCrossEncoderMinimale {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(entrees: Record<string, unknown>): Promise<Record<string, { readonly data: ArrayLike<number>; readonly dims?: readonly number[] }>>;
}

/** Constructeur de tenseur injecté (`new ort.Tensor("int64", …)`). */
export interface ConstructeurTenseurCrossEncoder {
  new (type: string, data: BigInt64Array, dims: readonly number[]): unknown;
}

/** Fragment ORT minimal requis (jamais importé statiquement ici). */
export interface OrtCrossEncoderMinimal {
  readonly Tensor: ConstructeurTenseurCrossEncoder;
}

/** Le scoreur : logits bruts, un par document, dans l'ordre. */
export type ScoreurCrossEncoder = (
  requete: string,
  documents: readonly string[],
) => Promise<readonly number[]>;

/**
 * Assemble les paires XLM-R `<s> requête </s> </s> document </s>`, troncature
 * déterministe CÔTÉ DOCUMENT (la requête — bornée à 500 caractères par le
 * service — est préservée ; si elle déborde seule, elle est coupée en tête
 * de file, jamais le document d'abord). Padding à droite au max du lot.
 * Vide → `{ ids: [], attention_mask: [] }`.
 */
export function encoderPaires(
  tokenizer: TokenizerPairesMinimal,
  requete: string,
  documents: readonly string[],
  maxLongueur: number = TRONCATURE_PAIRE_MAX,
): { readonly ids: number[][]; readonly attention_mask: number[][] } {
  if (!Number.isInteger(maxLongueur) || maxLongueur < 8) {
    throw new Error("Encodage paires impossible : longueur max invalide.");
  }
  if (documents.length === 0) return { ids: [], attention_mask: [] };
  const cls = tokenizer.token_to_id("<s>");
  const sep = tokenizer.token_to_id("</s>");
  const pad = tokenizer.token_to_id("<pad>") ?? 1;
  if (cls === undefined || sep === undefined) {
    throw new Error("Tokenizer paires inattendu : spéciaux <s>/</s> absents.");
  }
  const idsRequete = sansSpeciaux(tokenizer, requete, cls, sep);
  const lignes: number[][] = documents.map((doc) => {
    let idsDoc = sansSpeciaux(tokenizer, doc, cls, sep);
    // 4 spéciaux : cls + sep + sep + sep.
    let budgetDoc = maxLongueur - idsRequete.length - 4;
    let idsQ = idsRequete;
    if (budgetDoc < 0) {
      // Requête seule trop longue : coupe déterministe en tête, doc vide.
      idsQ = idsRequete.slice(0, Math.max(0, maxLongueur - 4));
      budgetDoc = 0;
    }
    if (idsDoc.length > budgetDoc) idsDoc = idsDoc.slice(0, budgetDoc);
    return [cls, ...idsQ, sep, sep, ...idsDoc, sep];
  });
  let longueur = 0;
  for (const l of lignes) if (l.length > longueur) longueur = l.length;
  const ids: number[][] = [];
  const attention_mask: number[][] = [];
  for (const l of lignes) {
    const remplissage = longueur - l.length;
    ids.push([...l, ...Array<number>(remplissage).fill(pad)]);
    attention_mask.push([...Array<number>(l.length).fill(1), ...Array<number>(remplissage).fill(0)]);
  }
  return { ids, attention_mask };
}

function sansSpeciaux(
  tokenizer: TokenizerPairesMinimal,
  texte: string,
  cls: number,
  sep: number,
): number[] {
  const enc = tokenizer.encode(texte);
  let ids = [...enc.ids];
  if (ids[0] === cls) ids = ids.slice(1);
  if (ids[ids.length - 1] === sep) ids = ids.slice(0, -1);
  return ids;
}

/**
 * Note les paires depuis une session + un tokenizer injectés. Vérifie le
 * contrat du graphe (entrées `input_ids`/`attention_mask`, sortie `logits`
 * à UNE valeur par paire) AVANT de rendre — graphe inattendu = refus.
 * Tenseurs int64 BigInt (même discipline que `embeddings-local.ts`).
 */
export function noterPairesDepuisSession(
  ort: OrtCrossEncoderMinimal,
  session: SessionCrossEncoderMinimale,
  tokenizer: TokenizerPairesMinimal,
): ScoreurCrossEncoder {
  if (
    !session.inputNames.includes("input_ids") ||
    !session.inputNames.includes("attention_mask")
  ) {
    throw new Error("Session cross-encoder inattendue : graphe-inattendu (entrées).");
  }
  const nomLogits = session.outputNames.includes("logits") ? "logits" : null;
  if (nomLogits === null) {
    throw new Error("Session cross-encoder inattendue : graphe-inattendu (logits absents).");
  }
  return async (requete, documents) => {
    if (documents.length === 0) return [];
    const enc = encoderPaires(tokenizer, requete, documents);
    const n = documents.length;
    const L = enc.ids[0]?.length ?? 0;
    const ids = new BigInt64Array(n * L);
    const masque = new BigInt64Array(n * L);
    for (let i = 0; i < n; i++) {
      const ligneIds = enc.ids[i] ?? [];
      const ligneMasque = enc.attention_mask[i] ?? [];
      for (let j = 0; j < L; j++) {
        ids[i * L + j] = BigInt(ligneIds[j] ?? 0);
        masque[i * L + j] = BigInt(ligneMasque[j] ?? 0);
      }
    }
    const sorties = await session.run({
      input_ids: new ort.Tensor("int64", ids, [n, L]),
      attention_mask: new ort.Tensor("int64", masque, [n, L]),
    });
    const tete = sorties[nomLogits];
    if (tete === undefined) {
      throw new Error("Session cross-encoder inattendue : sortie logits manquante.");
    }
    const data = Array.from(tete.data);
    if (data.length !== n || data.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
      throw new Error("Session cross-encoder inattendue : logits inexploitables.");
    }
    return data;
  };
}

/**
 * Réordonne des candidats DÉJÀ notés (échelle heuristique préservée) par
 * logits cross-encoder décroissants. Ordre TOTAL et stable : logit décroissant
 * puis `chunkId` croissant — même entrée, même ordre, toujours. `topN`
 * appliqué APRÈS réordonnancement (défaut : 5).
 */
export function reordonnerParLogits(
  ranges: readonly CandidatRange[],
  logits: readonly number[],
  topN: number = 5,
): CandidatRange[] {
  if (logits.length !== ranges.length) {
    throw new Error("Réordonnancement impossible : logits/candidats désalignés.");
  }
  return ranges
    .map((range, i) => ({ range, logit: logits[i] ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => b.logit - a.logit || (a.range.candidat.chunkId < b.range.candidat.chunkId ? -1 : 1))
    .slice(0, Math.max(0, topN))
    .map((x) => x.range);
}

/**
 * Fabrique le reranker cross-encoder : scores heuristiques (échelle
 * préservée) + ordre cross-encoder. Le scoreur lève → l'appelant (service)
 * replie sur l'heuristique ; ici, aucune capture silencieuse.
 */
export function creerRerankerCrossEncoder(scoreur: ScoreurCrossEncoder): RerankerLocalAsync {
  const reranker = async (
    requete: string,
    candidats: readonly CandidatFusionne[],
    topN: number = 5,
  ): Promise<CandidatRange[]> => {
    // Échelle heuristique sur la liste COMPLÈTE (jamais tronquée avant
    // réordonnancement : le cross-encoder voit les ≤20 fusionnés).
    const notes = HeuristiqueBaseline.reranker(requete, candidats, candidats.length);
    const logits = await scoreur(
      requete,
      notes.map((r) => r.candidat.texte),
    );
    return reordonnerParLogits(notes, logits, topN);
  };
  return {
    nom: RERANK_CROSS_ENCODER_NOM,
    version: RERANK_CROSS_ENCODER_VERSION,
    reranker: (requete, candidats, topN = 5) => HeuristiqueBaseline.reranker(requete, candidats, topN),
    rerankerAsync: reranker,
  };
}
