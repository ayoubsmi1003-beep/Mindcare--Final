/**
 * `stockage.ts` — M07 · les CONSTRUCTEURS SQL de la connaissance (PROPOSITION porte A, H1).
 *
 * ═══ STATUT ═══
 * Ce fichier décrit la forme SQL EXACTE proposée pour la migration
 * `092_knowledge_rag.sql` — prenable telle quelle si la porte A l'approuve :
 * noms de tables/colonnes/portes/index centralisés ici, en constantes, pour
 * que la revue humaine n'ait qu'un seul endroit à amender. FICHIER NON ÉCRIT.
 *
 * Sans migration appliquée, ces requêtes ne s'exécutent nulle part : le
 * service (`connaissance-recherche.ts`) rend `indisponible` tant que les
 * portes n'existent pas. Aucune donnée n'est lue, aucune n'est écrite.
 *
 * ═══ INVARIANT D'AUTORITÉ (§5 + H0.2) ═══
 * Les portes filtrent la JOINTURE dans le SQL :
 *
 *     knowledge_chunks → knowledge_sources → C4 + active + approved + revue + non-superseded
 *
 * UNE SEULE autorité tenant : `sources.cabinet_id` (motif `medications`,
 * `009`). `knowledge_chunks` NE PORTE PAS de `cabinet_id` — un chunk
 * appartient à sa source, point (H0.2 : deux autorités = une divergence en
 * attente). Un chunk `active` dont la source est révoquée NE SORT JAMAIS
 * (matrice n°11) — la jointure l'interdit, pas un `if` TypeScript.
 *
 * ═══ INDEX VECTORIEL (H1) ═══
 * HNSW (`vector_cosine_ops`), paramètres `m` / `ef_construction` explicites
 * ci-dessous — pas d'IVFFLAT (pas d'étape d'entraînement, corpus petit et
 * mouvant). FTS/GIN préservé pour la branche lexicale.
 *
 * ═══ LIFECYCLE (H1) ═══
 * Le défaut exclut : unapproved, revoked, inactive, superseded,
 * review-overdue. L'historique exige `p_inclure_historique = true` EXPLICITE
 * et ne mélange JAMAIS courant + historique (erreur dure sinon).
 *
 * ═══ CONTRAINTE DbPort ═══
 * `DbPort.rpc` n'accepte que des scalaires (`RpcArgs`) : le vecteur de
 * requête voyage en JSON texte (`p_embedding_json`), converti en `vector`
 * DANS la porte. Aucune extension de `DbPort` requise.
 */

import { attestationDepuisPorte, estRecuperable } from "./gouvernance";
import type { Langue } from "./types";

/** Noms proposés — la porte A tranche, le code suit. */
export const TABLES = {
  SOURCES: "app.knowledge_sources",
  CHUNKS: "app.knowledge_chunks",
} as const;

/** Portes proposées — `SECURITY DEFINER`, `EXECUTE` au rôle applicatif. */
export const PORTES = {
  // Noms NUS : pgPort qualifie `app.` lui-même, gen-db-allowlist n'accepte
  // que des littéraux nus, verifierAllowlist matche le proname nu.
  LEXICALE: "search_knowledge_lexical",
  VECTORIELLE: "search_knowledge_vector",
} as const;

/**
 * Index vectoriel proposé : HNSW cosine. `m = 16`, `ef_construction = 64` —
 * valeurs de départ standard pour un petit corpus ; la DBA les confirme à
 * la porte A (aucune mesure de corpus n'existe encore — dit explicitement).
 */
export const INDEX_HNSW_SQL =
  "CREATE INDEX knowledge_chunks_embedding_hnsw ON app.knowledge_chunks " +
  "USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);";

/**
 * Unicité tenant-sûre (H0.1) : le `NULL` PostgreSQL étant distinct, UNE
 * contrainte `UNIQUE (cabinet_id, titre, version)` laisserait passer deux
 * lignes partagées identiques. Deux index partiels, sémantique exacte :
 */
export const INDEX_UNICITE_SQL = [
  "CREATE UNIQUE INDEX knowledge_sources_partage ON app.knowledge_sources (titre, version) WHERE cabinet_id IS NULL;",
  "CREATE UNIQUE INDEX knowledge_sources_cabinet ON app.knowledge_sources (cabinet_id, titre, version) WHERE cabinet_id IS NOT NULL;",
  "CREATE UNIQUE INDEX knowledge_chunks_identite ON app.knowledge_chunks (source_id, section, sous_section, texte_hash, occurrence);",
].join("\n");

/**
 * Garde de lignée de supersession (H1) : seules des sources de MÊME titre
 * et MÊME portée tenant (`cabinet_id` non distinct) peuvent se superséder —
 * deux sources sans lien (ni deux cabinets) ne se remplacent jamais par
 * accident. Proposée comme contrainte `CHECK` + trigger de validation.
 */
export const GARDE_LIGNEE_SQL =
  "CHECK (superseded_by IS NULL OR superseded_by <> id)";

/** Colonnes lues par les portes — whitelist fermée, jamais `*`. */
export const COLONNES_CHUNK = [
  "chunk_id",
  "source_id",
  "source_titre",
  "source_version",
  "section",
  "version_chunk",
  "langue",
  "texte",
] as const;

/**
 * Colonnes d'attestation lues AVEC chaque chunk : la défense en profondeur
 * côté TypeScript (`estRecuperable`) re-constate sur données réelles ce que
 * le SQL impose déjà. Métadonnées de gouvernance (statut, classe, approbation
 * réelle horodatée et signée, revue, supersession), jamais du patient,
 * jamais journalisées.
 */
export const COLONNES_ATTESTATION_SQL = [
  "s.statut AS source_statut",
  "s.classification AS source_classification",
  "s.approved_at AS source_approuvee_le",
  "s.approved_by AS source_approuvee_par",
  "(s.review_due_at IS NULL OR s.review_due_at > now()) AS source_revue_a_jour",
  "s.superseded_by AS source_remplacee_par",
].join(", ");

/**
 * Filtre d'autorité du DÉFAUT, IDENTIQUE dans les deux portes : seule une
 * source C4, active, approuvée (par qui, quand — traçabilité §6), à revue à
 * jour et non supersédée rend ses chunks. `approved_by` ne vient jamais du
 * client : la porte lit la ligne, point.
 */
export const FILTRE_AUTORITE_SQL = [
  "s.classification = 'C4'",
  "s.statut = 'active'",
  "s.approved_at IS NOT NULL",
  "s.approved_by IS NOT NULL",
  "(s.review_due_at IS NULL OR s.review_due_at > now())",
  "s.superseded_by IS NULL",
  "c.statut = 'active'",
].join(" AND ");

export interface AppelPorte {
  /** Nom de la porte (`PORTES.*`). */
  readonly porte: string;
  /** Arguments scalaires, compatibles `DbPort.rpc`. */
  readonly args: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * Porte lexicale : `tsvector` + trigramme, bornée, filtrée à la source.
 * `p_inclure_historique` (défaut false) : à `true`, la porte rend UNIQUEMENT
 * l'historique (superseded / revue en retard / revoked exclu du défaut) —
 * jamais un mélange silencieux (erreur dure si mélange demandé autrement).
 */
export function porteLexicale(
  requete: string,
  langue: string,
  limite: number,
  inclureHistorique = false,
): AppelPorte {
  return {
    porte: PORTES.LEXICALE,
    args: {
      p_requete: requete,
      p_langue: langue,
      p_limite: Math.max(1, Math.min(20, Math.floor(limite))),
      p_inclure_historique: inclureHistorique,
    },
  };
}

/** Porte vectorielle : similarité cosine, bornée, filtrée à la source. */
export function porteVectorielle(
  embeddingJson: string,
  limite: number,
  inclureHistorique = false,
): AppelPorte {
  return {
    porte: PORTES.VECTORIELLE,
    args: {
      p_embedding_json: embeddingJson,
      p_limite: Math.max(1, Math.min(20, Math.floor(limite))),
      p_inclure_historique: inclureHistorique,
    },
  };
}

/**
 * Le SQL PROPOSÉ pour la porte A — documentation exécutable : les tests
 * assertent que le filtre d'autorité y figure tel quel. La migration
 * appliquée (`092_knowledge_rag.sql`) fait foi ; en cas d'écart, c'est CE
 * fichier qui est corrigé. Noms qualifiés (`public.vector`,
 * `OPERATOR(public.<=>)`, `app.immutable_unaccent`) car les portes
 * n'incluent pas `public` dans leur search_path (motif 003).
 * L'historique (`p_inclure_historique = true`) est une VARIANTE de porte
 * séparée définie à l'implémentation Gate A — ce texte est la voie DÉFAUT,
 * qui exclut l'historique par construction (aucun mélange silencieux).
 */
export function sqlPorteLexicalePropose(): string {
  return [
    `SELECT ${COLONNES_CHUNK.map((c) => `c.${c}`).join(", ")}, ${COLONNES_ATTESTATION_SQL},`,
    "  ts_rank(c.document_tsv, plainto_tsquery('simple', app.immutable_unaccent($1))) AS score",
    `FROM ${TABLES.CHUNKS} c`,
    `JOIN ${TABLES.SOURCES} s ON s.id = c.source_id`,
    `WHERE ${FILTRE_AUTORITE_SQL}`,
    "  AND ($2 = 'toutes' OR c.langue = $2)",
    "  AND c.document_tsv @@ plainto_tsquery('simple', app.immutable_unaccent($1))",
    "ORDER BY score DESC",
    "LIMIT LEAST(GREATEST($3::int, 1), 20);",
  ].join("\n");
}

/** Même contrat, branche vectorielle (`OPERATOR(public.<=>)` = distance cosine pgvector).
 *
 * 093 — BARRIÈRE D'ÉVALUATION UNIQUE : le JSON texte (~8 Ko) est converti en
 * `vector` UNE fois dans `CROSS JOIN (SELECT … OFFSET 0)`. SANS `OFFSET 0`,
 * le planificateur aplati la sous-requête et la conversion redevient
 * par-ligne (6 à 11 s mesurés sur 15 666 chunks) ; AVEC : ~150 ms, ordre
 * identique. Sémantique (filtres, colonnes, borne) inchangée.
 */
export function sqlPorteVectoriellePropose(): string {
  return [
    `SELECT ${COLONNES_CHUNK.map((c) => `c.${c}`).join(", ")}, ${COLONNES_ATTESTATION_SQL},`,
    "  1 - (c.embedding OPERATOR(public.<=>) p.q) AS score",
    `FROM ${TABLES.CHUNKS} c`,
    `JOIN ${TABLES.SOURCES} s ON s.id = c.source_id`,
    "CROSS JOIN (SELECT $1::public.vector AS q OFFSET 0) AS p",
    `WHERE ${FILTRE_AUTORITE_SQL}`,
    "  AND c.embedding IS NOT NULL",
    "ORDER BY c.embedding OPERATOR(public.<=>) p.q",
    "LIMIT LEAST(GREATEST($2::int, 1), 20);",
  ].join("\n");
}

// ─── LIGNES DE PORTE — validation + gouvernance partagées (M07 slice 2) ─────
// Déplacées depuis `services/connaissance-recherche.ts` SANS changement de
// sémantique : UNE validation (pas deux qui divergeraient) pour la route
// (`app/api/jarvis/jarvis-chat`) comme pour le service. Le service
// ré-exporte le type pour compatibilité de ses tests.

/** Une ligne de porte, validée strictement avant usage (lignes malformées écartées). */
export interface LignePorte {
  readonly chunk_id: string;
  readonly source_id: string;
  readonly source_titre: string;
  readonly source_version: string;
  readonly section: string | null;
  readonly version_chunk: string;
  readonly langue: Langue;
  readonly texte: string;
  readonly score: number;
  readonly source_statut: string;
  readonly source_classification: string;
  readonly source_approuvee_le: string | null;
  readonly source_approuvee_par: string | null;
  readonly source_revue_a_jour: boolean;
  readonly source_remplacee_par: string | null;
}

/**
 * Normalise un horodatage de porte : node-pg rend `timestamptz` en Date.
 * Date valide → ISO ; null → null ; tout le reste (Date invalide, nombre,
 * objet) → null, donc traité comme « jamais approuvée » et ÉCARTÉ (sens
 * fermé : on n'invente jamais une approbation).
 */
export function normaliserHorodatage(valeur: unknown): string | null {
  if (valeur === null) return null;
  if (typeof valeur === "string") return valeur;
  if (valeur instanceof Date && !Number.isNaN(valeur.getTime())) return valeur.toISOString();
  return null;
}

export function validerLignePorte(valeur: unknown): LignePorte | null {
  if (typeof valeur !== "object" || valeur === null) return null;
  const ligne = valeur as Record<string, unknown>;
  if (
    typeof ligne["chunk_id"] !== "string" || ligne["chunk_id"] === "" ||
    typeof ligne["source_id"] !== "string" || ligne["source_id"] === "" ||
    typeof ligne["source_titre"] !== "string" || ligne["source_titre"] === "" ||
    typeof ligne["source_version"] !== "string" || ligne["source_version"] === "" ||
    typeof ligne["version_chunk"] !== "string" || ligne["version_chunk"] === "" ||
    typeof ligne["texte"] !== "string" || ligne["texte"] === "" ||
    typeof ligne["score"] !== "number" || !Number.isFinite(ligne["score"])
  ) {
    return null;
  }
  const langue = ligne["langue"];
  if (langue !== "fr" && langue !== "ar" && langue !== "darija") return null;
  const section = ligne["section"];
  if (section !== null && typeof section !== "string") return null;
  if (typeof ligne["source_statut"] !== "string") return null;
  if (typeof ligne["source_classification"] !== "string") return null;
  // node-pg rend `timestamptz` en Date (pas en string) : normaliser au seul
  // point de contact pg — la gouvernance reste string|null en aval (R3-D).
  // Sans cela, toute source approuvée est écartée en silence (non-approuvée).
  // `normaliserHorodatage` ne rend que string|null : rien d'autre à écarter ici.
  const approuveeLe = normaliserHorodatage(ligne["source_approuvee_le"]);
  const approuveePar = ligne["source_approuvee_par"];
  if (approuveePar !== null && typeof approuveePar !== "string") return null;
  const revueAJour = ligne["source_revue_a_jour"];
  if (typeof revueAJour !== "boolean") return null;
  const remplaceePar = ligne["source_remplacee_par"];
  if (remplaceePar !== null && typeof remplaceePar !== "string") return null;
  return {
    chunk_id: ligne["chunk_id"],
    source_id: ligne["source_id"],
    source_titre: ligne["source_titre"],
    source_version: ligne["source_version"],
    section,
    version_chunk: ligne["version_chunk"],
    langue,
    texte: ligne["texte"],
    score: ligne["score"],
    source_statut: ligne["source_statut"],
    source_classification: ligne["source_classification"],
    source_approuvee_le: approuveeLe,
    source_approuvee_par: approuveePar,
    source_revue_a_jour: revueAJour,
    source_remplacee_par: remplaceePar,
  };
}

/**
 * Défense en profondeur : le SQL filtre déjà, mais chaque ligne est
 * re-constatée ici sur données réelles (`attestationDepuisPorte` refuse le
 * vocabulaire inconnu). Écart silencieux : compter suffirait à oracler
 * l'existence d'une source révoquée — on ne compte même pas.
 */
export function lignePorteRecuperable(ligne: LignePorte): boolean {
  const attestation = attestationDepuisPorte(
    ligne.source_statut,
    ligne.source_classification,
    ligne.source_approuvee_le,
    ligne.source_approuvee_par,
    ligne.source_revue_a_jour,
    ligne.source_remplacee_par,
  );
  return attestation !== null && estRecuperable(attestation);
}
