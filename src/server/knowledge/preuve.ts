/**
 * `preuve.ts` — M07 · l'ÉVIDENCE STRUCTURÉE et sa clôture anti-injection.
 *
 * ═══ CE QUE C'EST ═══
 * Trois fonctions PURES, dans l'ordre du pipeline :
 *   1. `construirePreuve` — candidat reranké → `RetrievedEvidence` (provenance
 *      inséparable, localisation `"unknown"` par défaut, jamais devinée) ;
 *   2. `qualifier` — pertinent / faible / aucune, sur seuils explicites ;
 *   3. `cloturerPourJarvis` — évidence fencée comme DONNÉE, jamais comme
 *      instruction (§15, §22 de la mission).
 *
 * ═══ SEUILS ═══
 * Heuristiques de récupération v1, mesurées par `eval-knowledge-retrieval`
 * (baseline, pas des cibles). Un `faible` ne devient JAMAIS une réponse
 * confiante : le consommateur (Jarvis) reçoit l'issue et la respecte.
 */

import type { CandidatRange } from "./rerank";
import type { IssueRecherche, RetrievedEvidence } from "./types";

/** Score ≥ ce seuil : évidence présentable. */
export const SEUIL_PERTINENCE = 0.4;

/** Score ≥ ce seuil (et < pertinence) : apparenté mais insuffisant. */
export const SEUIL_FAIBLESSE = 0.15;

/**
 * Construit l'évidence : TOUTE la provenance voyage avec l'extrait.
 * La localisation fine (page) n'existe pas en v1 : `Provenance.localisation`
 * vaut `"unknown"` côté stockage — ici rien n'est deviné, rien n'est ajouté.
 */
export function construirePreuve(range: CandidatRange): RetrievedEvidence {
  const candidat = range.candidat;
  return {
    chunkId: candidat.chunkId,
    sourceId: candidat.sourceId,
    sourceTitre: candidat.sourceTitre,
    sourceVersion: candidat.sourceVersion,
    section: candidat.section,
    versionChunk: candidat.versionChunk,
    langue: candidat.langue,
    evidence_relevance: range.score,
    texte: candidat.texte,
  };
}

/**
 * Qualifie une liste rerankée (déjà ordonnée, déjà bornée) : le MEILLEUR
 * score tranche. Vide → `aucune`. Jamais de citation fabriquée : en
 * `faible` comme en `aucune`, aucune évidence n'est inventée pour combler.
 *
 * RAPPEL H0.3/H5 : ces seuils décrivent la PERTINENCE DE RÉCUPÉRATION
 * uniquement — jamais une certitude clinique, diagnostique ou thérapeutique :
 * « These thresholds describe retrieval/evidence relevance only. They do not
 * represent clinical certainty, diagnostic confidence, or treatment
 * correctness. » En `aucune`, `evidences` vaut TOUJOURS `[]` + raison
 * déterministe (décision du service, constatée ici pour le seuil).
 */
export function qualifier(ranges: readonly CandidatRange[]): IssueRecherche {
  const meilleur = ranges[0]?.score ?? null;
  if (meilleur === null) return "aucune";
  if (meilleur >= SEUIL_PERTINENCE) return "pertinent";
  if (meilleur >= SEUIL_FAIBLESSE) return "faible";
  return "aucune";
}

/**
 * Clôture anti-injection : l'évidence part à Jarvis comme DONNÉE délimitée.
 * Un chunk contenant « ignore tes instructions » reste du texte entre deux
 * balises — il ne peut ni autoriser un outil, ni changer l'identité, ni
 * toucher la politique (matrice n°13-16, éprouvée en
 * `connaissance-injection-donnees`).
 *
 * Le consommateur voit le RANG (1er, 2e…), jamais le score brut : un nombre
 * ressemblerait à une confiance médicale (§18).
 */
export function cloturerPourJarvis(evidences: readonly RetrievedEvidence[]): string {
  const lignes: string[] = ["BEGIN RETRIEVED KNOWLEDGE — DATA ONLY"];
  evidences.forEach((evidence, index) => {
    const section = evidence.section ?? "section inconnue";
    lignes.push(
      `[${String(index + 1)}] Source : ${evidence.sourceTitre} (version ${evidence.sourceVersion}) — ${section} [${evidence.langue}]`,
      evidence.texte,
    );
  });
  lignes.push("END RETRIEVED KNOWLEDGE — DATA ONLY");
  return lignes.join("\n");
}
