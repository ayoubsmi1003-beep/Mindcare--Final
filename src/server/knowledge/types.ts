/**
 * `types.ts` — M07 · les CONTRATS TYPÉS de la connaissance gouvernée.
 *
 * ═══ CE QUE C'EST ═══
 * Le vocabulaire fermé que tous les modules `server/knowledge/*` partagent :
 * identifiants, langues, lifecycle de source, provenance, évidence, issue de
 * recherche. Types seuls, zéro logique, zéro I/O — ce fichier ne peut ni
 * autoriser, ni récupérer, ni classer.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas une autorisation. `estRecuperable` (`gouvernance.ts`) constate côté
 *     TypeScript ; l'autorisation réelle vit dans les portes SQL, qui filtrent
 *     `C4 + active + approved` dans la requête elle-même (§5 de la mission).
 *   · Pas une classification. `ClasseDonnees` est IMPORTÉE de
 *     `server/egress/classification.ts` (import de type, effacé à la
 *     compilation) — M07 ne redéfinit jamais C1/C2/C3/C4/INCONNU.
 *   · Pas une confiance médicale. `score` (0..1) est un rang de récupération
 *     locale ; l'afficher comme une confiance clinique est interdit (§18).
 */

import type { ClasseDonnees } from "@/server/egress/classification";

/** Identifiant d'une source de connaissance (`knowledge_sources.id`). */
export type SourceId = string;

/** Identifiant déterministe d'un chunk (`knowledge_chunks.id`). */
export type ChunkId = string;

/**
 * Langue D'ORIGINE du chunk, préservée à l'ingestion. M07 ne traduit jamais :
 * une requête darija récupère la source FR/AR pertinente telle quelle (§13).
 */
export type Langue = "fr" | "ar" | "darija";

/**
 * Lifecycle de source, SÉPARÉ de l'approbation (§4 de la mission).
 * `active` seule n'autorise rien : il faut aussi `approvedAt/approvedBy`
 * renseignés ET `classification = C4` — les trois constatés ici, imposés en SQL.
 */
export type StatutSource =
  | "discovered"
  | "classified"
  | "reviewed"
  | "active"
  | "revoked"
  | "inactive"
  | "superseded";

/** Re-export du vocabulaire M05 : l'unique définition de C1..INCONNU. */
export type { ClasseDonnees };

/**
 * Ce que la récupération doit savoir d'une source AVANT de la servir.
 * `approvedAt/approvedBy = null` = jamais approuvée (ou approbation retirée).
 * `revueAJour = false` = `review_due_at` dépassée (revue en retard → exclue
 * du défaut, §H1). `remplaceePar ≠ null` = version supersédée → exclue du
 * défaut, accessible uniquement en historique explicite.
 * L'identité du relecteur est une traçabilité, jamais une autorisation
 * portée par le client (§6 : ne jamais fabriquer `approvedBy`).
 */
export interface AttestationSource {
  readonly statut: StatutSource;
  readonly classification: ClasseDonnees;
  readonly approvedAt: string | null;
  readonly approvedBy: string | null;
  readonly revueAJour: boolean;
  readonly remplaceePar: string | null;
}

/**
 * Provenance complète d'un chunk : répond à « d'où vient exactement cette
 * information ? ». `localisation = "unknown"` quand le document ne porte
 * aucune localisation — jamais une page devinée (§20).
 */
export interface Provenance {
  readonly sourceId: SourceId;
  readonly sourceTitre: string;
  readonly sourceVersion: string;
  readonly section: string | null;
  readonly chunkId: ChunkId;
  readonly versionChunk: string;
  readonly langue: Langue;
  readonly localisation: string;
}

/**
 * L'ÉVIDENCE rendue au médecin. Structurelle, pas textuelle : la source, la
 * version, la section et le chunk voyagent AVEC l'extrait, inséparables.
 *
 * `evidence_relevance` ∈ [0, 1] : PERTINENCE DE RÉCUPÉRATION (H0.3) — à quel
 * point ce chunk répond lexicalement/sémantiquement à la requête. Ce N'EST
 * PAS une confiance clinique : ni certitude diagnostique, ni justesse
 * thérapeutique. Aucune décision clinique ne peut être inférée de ce nombre ;
 * l'afficher comme un pourcentage de certitude médicale est interdit (§18).
 */
export interface RetrievedEvidence {
  readonly chunkId: ChunkId;
  readonly sourceId: SourceId;
  readonly sourceTitre: string;
  readonly sourceVersion: string;
  /** `null` = section inconnue — affichée « section inconnue », jamais inventée. */
  readonly section: string | null;
  /** Version du découpeur (`CHUNKER_VERSION`) qui a produit ce chunk. */
  readonly versionChunk: string;
  readonly langue: Langue;
  readonly evidence_relevance: number;
  readonly texte: string;
}

/**
 * L'issue HONNÊTE d'une recherche (§20). `faible` = apparenté mais
 * insuffisant — ne doit JAMAIS devenir une réponse confiante. `aucune` =
 * rien d'acceptable trouvé — préférable à une hallucination.
 */
export type IssueRecherche = "pertinent" | "faible" | "aucune";

export interface ResultatRecherche {
  readonly issue: IssueRecherche;
  readonly evidences: readonly RetrievedEvidence[];
  /** Raison non identifiante, affichable (`fr`), jamais le contenu récupéré. */
  readonly raison: string;
}
