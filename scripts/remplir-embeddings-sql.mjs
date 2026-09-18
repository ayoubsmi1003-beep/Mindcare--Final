/**
 * remplir-embeddings-sql — M07 R3 · SQL PUR du backfill (aucune exécution ici).
 *
 * Sélection déterministe (ORDER BY id, NULL-ou-dérive), mise à jour
 * MONO-instruction par lot (atomicité par construction : jamais de demi-lot),
 * gardes active=0, inventaire lecture seule. Les valeurs gelées voyagent en
 * PARAMS, jamais interpolées. Zéro secret, zéro PII.
 */

/** Les 9 colonnes de recette comparées par le prédicat de dérive. */
export const PARAMETRES_RECETTE = [
  "embedding_provider",
  "embedding_modele",
  "embedding_version",
  "embedding_dimensions",
  "embedding_normalisation",
  "embedding_instruction_requete",
  "embedding_instruction_document",
  "embedding_distance",
  "chunker_version",
];

function predicatDerive(debut) {
  // IS DISTINCT FROM : NULL-safe (une recette absente EST une dérive).
  const cols = [
    ["embedding_provider", 0],
    ["embedding_modele", 1],
    ["embedding_version", 2],
    ["embedding_dimensions", 3],
    ["embedding_normalisation", 4],
    ["embedding_instruction_requete", 5],
    ["embedding_instruction_document", 6],
    ["embedding_distance", 7],
    ["chunker_version", 8],
  ];
  return cols.map(([c, i]) => `${c} IS DISTINCT FROM $${debut + i}`).join("\n   OR ");
}

function paramsRecette(r) {
  return [
    r.provider,
    r.modele,
    r.version,
    r.dimensions,
    r.normalisation,
    r.instruction_requete,
    r.instruction_document,
    r.distance,
    r.chunker,
  ];
}

/**
 * Prochain lot à embarquer : jamais-embarqués OU recette dérivée, ordre
 * d'`id` stable (reprise déterministe), borné. Les lignes déjà conformes
 * sont sautées par construction (cœur de l'idempotence + reprise).
 * `exclure` (ids vus en dérive découpeur ce run) évite la re-sélection
 * en boucle d'une pochette non-embarquable.
 */
export function sqlSelectionLot(limite, r, exclure = []) {
  const exclusion = exclure.length === 0 ? "" : "\n   AND NOT (id = ANY($11))";
  const texte = `SELECT id, texte, chunker_version FROM app.knowledge_chunks
WHERE (embedding IS NULL
   OR ${predicatDerive(2)})${exclusion}
ORDER BY id ASC LIMIT $1`;
  const params = [limite, ...paramsRecette(r)];
  if (exclure.length > 0) params.push([...exclure]);
  return { texte, params };
}

/**
 * UNE instruction par lot : `UPDATE … FROM (VALUES …)` — tout ou rien,
 * jamais de demi-lot (aucune transaction explicite requise). Ne touche que
 * l'embedding + les 8 colonnes de recette écrites (jamais statut, sources,
 * approbation).
 */
export function sqlMiseAJourLot(lignes, r) {
  if (lignes.length === 0) {
    throw new Error("Mise à jour impossible : lot vide.");
  }
  const valeurs = [];
  const params = [];
  lignes.forEach((ligne, i) => {
    const b = i * 10;
    valeurs.push(
      `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`,
    );
    params.push(
      ligne.id,
      ligne.litteral,
      r.provider,
      r.modele,
      r.version,
      r.dimensions,
      r.normalisation,
      r.instruction_requete,
      r.instruction_document,
      r.distance,
    );
  });
  const texte = `UPDATE app.knowledge_chunks AS c SET
  embedding = v.embedding::public.vector,
  embedding_provider = v.provider,
  embedding_modele = v.modele,
  embedding_version = v.version,
  embedding_dimensions = v.dimensions::integer,
  embedding_normalisation = v.normalisation,
  embedding_instruction_requete = v.instr_req,
  embedding_instruction_document = v.instr_doc,
  embedding_distance = v.distance
FROM (VALUES ${valeurs.join(",")}) AS v(id, embedding, provider, modele, version, dimensions, normalisation, instr_req, instr_doc, distance)
WHERE c.id = v.id`;
  return { texte, params };
}

/**
 * Garde globale : TOUTES les sources `active` (pré + post-passe).
 * L'embedding ne rend jamais récupérable — l'activation est un acte humain.
 */
export function sqlGardeGlobaleActive() {
  return {
    texte: "SELECT count(*)::int AS n FROM app.knowledge_sources WHERE statut = 'active'",
    params: [],
  };
}

/**
 * Garde R1-miroir : aucune source du lot ne doit être `active`
 * (l'embedding ne rend jamais récupérable — l'activation est un acte humain).
 */
export function sqlGardeSourcesActives(ids) {
  return {
    texte: "SELECT count(*)::int AS n FROM app.knowledge_sources WHERE id = ANY($1) AND statut = 'active'",
    params: [ids],
  };
}

/** Inventaire lecture seule : que des comptes (aucun contenu, aucune PII). */
export function sqlInventaire() {
  const texte = `SELECT
  (SELECT count(*)::int FROM app.knowledge_chunks) AS chunks,
  (SELECT count(*)::int FROM app.knowledge_chunks WHERE embedding IS NULL) AS sans_embedding,
  (SELECT count(*)::int FROM app.knowledge_sources) AS sources,
  (SELECT count(*)::int FROM app.knowledge_sources WHERE statut = 'active') AS sources_active,
  (SELECT count(*)::int FROM pg_extension WHERE extname = 'vector') AS ext_vector,
  (SELECT count(*)::int FROM app.schema_migrations WHERE version = '092_knowledge_rag') AS migration_092`;
  return { texte, params: [] };
}

/** Lignes embarquées à recette dérivée (cible 0 en fin de passe). */
export function sqlUniformiteRecette(r) {
  const texte = `SELECT count(*)::int AS n FROM app.knowledge_chunks
WHERE embedding IS NOT NULL
  AND (${predicatDerive(1)})`;
  return { texte, params: paramsRecette(r) };
}
