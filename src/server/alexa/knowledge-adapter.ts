import { LIMITES, orchestrerRecherche } from "@/server/knowledge/recherche";
import { CALIBRATION_A3 } from "@/server/knowledge/rerank";
import { SEUIL_FAIBLESSE, SEUIL_PERTINENCE } from "@/server/knowledge/preuve";
import { lignePorteRecuperable, porteLexicale, validerLignePorte } from "@/server/knowledge/stockage";
import type { RetrievedEvidence } from "@/server/knowledge/types";
import type { ClientSql } from "@/server/jarvis/client-sql";
import { matchesRequestedBook, planKnowledgeQuery,matchesSectionFocus } from "./knowledge-query";
import {headingOnlyEvidence,bibliographyEvidence,bibliographyTextEvidence,bibliographyRequested,unboundTableEvidence} from './knowledge-evidence-content';

/** Une preuve structurée, telle que rendue par l'orchestration gouvernée. */
type Preuve = RetrievedEvidence;
// Allow a complete UTF-8 passage slightly above the 8,000-character aggregate
// budget. `orchestrerRecherche` still enforces that unchanged aggregate cap.
const MAX_PASSAGE_UTF8_BYTES = 8_192;

const issuedKnowledgeResults = new WeakSet<object>();
/** Only immutable evidence returned by the governed SQL retrieval can be summarized externally. */
export function isIssuedKnowledgeResult(value: unknown): boolean {
  return typeof value === "object" && value !== null && issuedKnowledgeResults.has(value) && Object.isFrozen(value);
}

/** Explicit lexical freeze. Assets being present must never activate vector retrieval. */
export async function readKnowledge(client: ClientSql, question: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  try {
    const plan = planKnowledgeQuery(question);
    if (plan === null) return { etat: "sans-preuve" as const, preuves: [] };
    const batches: unknown[][] = [];
    for (const query of plan.queries) {
      const gate = porteLexicale(query, plan.language, LIMITES.LEXICAL);
      const result = await client.rpc<unknown[]>("search_knowledge_lexical", gate.args);
      signal?.throwIfAborted();
      if (result.error || !Array.isArray(result.data)) return { etat: "panne" as const, preuves: [] };
      batches.push(result.data.filter(row => matchesRequestedBook(row, plan)));
    }
    // A prefix can remove a dose qualifier or negation. Keep whole bounded chunks,
    // and flag approved oversized passages without exposing rejected-source existence.
    let omittedLongPassages = false;
    const lots: { reference: string; lignes: unknown[] }[] = [];
    for (const [index, batch] of batches.entries()) {
      const complete: unknown[] = [];
      for (const candidate of batch) {
        const row = validerLignePorte(candidate);
        if (row === null || !lignePorteRecuperable(row)) continue;
        if(headingOnlyEvidence(row.texte,row.section)||unboundTableEvidence(row.texte)||(bibliographyEvidence(row.section)||bibliographyTextEvidence(row.texte))&&!bibliographyRequested(question))continue;
        if (Buffer.byteLength(row.texte, "utf8") > MAX_PASSAGE_UTF8_BYTES) { omittedLongPassages = true; continue; }
        complete.push(row);
      }
      // Chaque lot est classé contre SA référence : c'est elle qui l'a fait
      // remonter. Un lot anglais issu de l'expansion bilingue ne doit pas être
      // mesuré contre une référence française (couverture ~0, preuve perdue).
      lots.push({ reference: plan.references[index] ?? plan.relevanceQuery, lignes: complete });
    }
    // Fair bounded merge for the two type queries; the first query cannot evict the second.
    const candidates: unknown[] = [];
    for (let index = 0; index < LIMITES.LEXICAL && candidates.length < LIMITES.LEXICAL; index++) {
      for (const batch of batches) {
        if (batch[index] !== undefined && candidates.length < LIMITES.LEXICAL) candidates.push(batch[index]);
      }
    }
    void candidates;
    // Classement par lot : chaque lot produit ses preuves, classées contre SA
    // propre référence (celle qui l'a fait remonter). Les lots sont des
    // REFORMULATIONS de la MÊME question (requête d'origine + rubriques
    // candidates) : leurs scores de pertinence sont donc comparables, et la
    // fusion se fait au MEILLEUR SCORE — pas par tour de rôle, qui laisserait
    // un lot faible évincer la meilleure réponse d'un lot fort.
    const parLot: Preuve[][] = [];
    for (const lot of lots) {
      const search = await orchestrerRecherche(lot.reference, lot.lignes, [], undefined, CALIBRATION_A3);
      signal?.throwIfAborted();
      parLot.push([...search.evidences]);
    }
    // Les lots sont des REFORMULATIONS de la MÊME question (requête
    // d'origine, puis rubriques candidates). Leurs scores de pertinence sont
    // comparables : la fusion se fait au MEILLEUR SCORE. À égalité de score,
    // l'ordre des lots départage — la requête d'origine d'abord (c'est la
    // lecture la plus littérale de la question), puis les rubriques par ordre
    // de couverture décroissante du corpus.
    const tous: { preuve: Preuve; lot: number; rang: number }[] = [];
    parLot.forEach((evidences, lot) => {
      evidences.forEach((preuve, rang) => tous.push({ preuve, lot, rang }));
    });
    const vus = new Set<string>();
    const preuves: Preuve[] = [];
    const ordonnes = [...tous].sort((a, b) => b.preuve.evidence_relevance - a.preuve.evidence_relevance
      || a.lot - b.lot || a.rang - b.rang);
    for (const { preuve } of ordonnes) {
      if (preuves.length >= LIMITES.FINAL) break;
      if (vus.has(preuve.chunkId)) continue;
      vus.add(preuve.chunkId);
      preuves.push(preuve);
    }
    const issue = preuves.length === 0 ? "aucune" as const
      : preuves.some(p => p.evidence_relevance >= SEUIL_PERTINENCE) ? "pertinent" as const
      : preuves.some(p => p.evidence_relevance >= SEUIL_FAIBLESSE) ? "faible" as const
      : "aucune" as const;
    const result = { etat: preuves.length === 0 ? "sans-preuve" as const : issue === "faible" ? "faible" as const : "ok" as const,
      ...(plan.sectionFocuses?.some(focus=>!preuves.some(p=>matchesSectionFocus(p.section,focus)))?{missingRequestedSections:true as const}:{}),
      ...(omittedLongPassages ? { omittedLongPassages: true as const } : {}),
      preuves: preuves.map(e => ({ titre: e.sourceTitre, section: e.section, version: e.sourceVersion, extrait: e.texte,langue:e.langue,
        sourceId: e.sourceId, chunkId: e.chunkId, versionChunk: e.versionChunk, unitId: e.unitId, parentTexteHash: e.parentTexteHash, enfantIndex: e.enfantIndex, enfantsTotal: e.enfantsTotal })) };
    for (const proof of result.preuves) Object.freeze(proof);
    Object.freeze(result.preuves);
    Object.freeze(result);
    issuedKnowledgeResults.add(result);
    return result;
  } catch { signal?.throwIfAborted(); return { etat: "panne" as const, preuves: [] }; }
}
