import { LIMITES, orchestrerRecherche } from "@/server/knowledge/recherche";
import { CALIBRATION_A3 } from "@/server/knowledge/rerank";
import { lignePorteRecuperable, porteLexicale, validerLignePorte } from "@/server/knowledge/stockage";
import type { ClientSql } from "@/server/jarvis/client-sql";
import { matchesRequestedBook, planKnowledgeQuery } from "./knowledge-query";

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
    // Fair bounded merge for the two type queries; the first query cannot evict the second.
    const candidates: unknown[] = [];
    for (let index = 0; index < LIMITES.LEXICAL && candidates.length < LIMITES.LEXICAL; index++) {
      for (const batch of batches) {
        if (batch[index] !== undefined && candidates.length < LIMITES.LEXICAL) candidates.push(batch[index]);
      }
    }
    // A prefix can remove a dose qualifier or negation. Keep whole bounded chunks,
    // and flag approved oversized passages without exposing rejected-source existence.
    const complete: unknown[] = [];
    let omittedLongPassages = false;
    for (const candidate of candidates) {
      const row = validerLignePorte(candidate);
      if (row === null || !lignePorteRecuperable(row)) continue;
      if (row.texte.length > 4000) { omittedLongPassages = true; continue; }
      complete.push(row);
    }
    const search = await orchestrerRecherche(plan.relevanceQuery, complete, [], undefined, CALIBRATION_A3);
    signal?.throwIfAborted();
    return { etat: search.evidences.length === 0 ? "sans-preuve" as const : search.issue === "faible" ? "faible" as const : "ok" as const,
      ...(omittedLongPassages ? { omittedLongPassages: true as const } : {}),
      preuves: search.evidences.map(e => ({ titre: e.sourceTitre, section: e.section, version: e.sourceVersion, extrait: e.texte,
        sourceId: e.sourceId, chunkId: e.chunkId, versionChunk: e.versionChunk, unitId: e.unitId, parentTexteHash: e.parentTexteHash, enfantIndex: e.enfantIndex, enfantsTotal: e.enfantsTotal })) };
  } catch { signal?.throwIfAborted(); return { etat: "panne" as const, preuves: [] }; }
}
