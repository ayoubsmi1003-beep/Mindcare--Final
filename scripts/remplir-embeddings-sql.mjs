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

/**
 * Découpeurs acceptés (décision humaine struct-v1.1) : `struct-v1` historique
 * (corpus-a/b, 15 666 lignes — jamais ré-embarquées) + `struct-v1.1`
 * (resplit des longs OCR par `couperLong` verbatim, même modèle, même
 * normalisation, vecteurs comparables). Liste FERMÉE — tout autre découpeur
 * = dérive = saut journalisé, jamais ré-embedding aveugle.
 */
export const CHUNKERS_ACCEPTES = ["struct-v1", "struct-v1.1"];

function predicatDerive(debut) {
  // IS DISTINCT FROM : NULL-safe (une recette absente EST une dérive).
  // chunker_version : appartenance à la liste FERMÉE (v1 + v1.1), pas égalité
  // à une valeur unique — un seul $N tableau, jamais N params.
  const cols = [
    ["embedding_provider", 0],
    ["embedding_modele", 1],
    ["embedding_version", 2],
    ["embedding_dimensions", 3],
    ["embedding_normalisation", 4],
    ["embedding_instruction_requete", 5],
    ["embedding_instruction_document", 6],
    ["embedding_distance", 7],
  ];
  const atomes = cols.map(([c, i]) => `${c} IS DISTINCT FROM $${debut + i}`);
  atomes.push(`NOT (chunker_version = ANY($${debut + 8}))`);
  return atomes.join("\n   OR ");
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
    Array.isArray(r.chunkers) ? [...r.chunkers] : [r.chunker],
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
  // Scoping R3 (décision humaine) : JAMAIS les sources `active` — le filtre
  // vit DANS la sélection (pas de lot actif constructible), doublé par
  // `sqlGardeLotActif` par lot et l'empreinte pré/post-passe. La garde
  // globale historique (`sources_active = 0`) est remplacée : les 6 R1
  // actives coexistent avec le backfill quarantaine, intouchées et prouvées.
  const texte = `SELECT id, texte, chunker_version FROM app.knowledge_chunks
WHERE (embedding IS NULL
   OR ${predicatDerive(2)})${exclusion}
  AND NOT EXISTS (SELECT 1 FROM app.knowledge_sources s
    WHERE s.id = app.knowledge_chunks.source_id AND s.statut = 'active')
ORDER BY id ASC LIMIT $1`;
  const params = [limite, ...paramsRecette(r)];
  if (exclure.length > 0) params.push([...exclure]);
  return { texte, params };
}

/**
 * Garde par lot (pré-inférence) : zéro source `active` parmi les chunks du
 * lot — échec fermé AVANT tout calcul (jamais d'embedding actif, même
 * jetable). Complète le filtre de sélection (défense en profondeur).
 */
export function sqlGardeLotActif(ids) {
  for (const id of ids) validerIdChunk(id);
  return {
    texte: `SELECT count(*)::int AS n FROM app.knowledge_sources s
WHERE s.statut = 'active'
  AND EXISTS (SELECT 1 FROM app.knowledge_chunks c
    WHERE c.source_id = s.id AND c.id = ANY($1))`,
    params: [[...ids]],
  };
}

/**
 * Empreinte pré/post-passe : embeddings par source `active`, ordonnée et
 * stable. Invariante exigée (aucune écriture active pendant la passe).
 */
export function sqlEmpreinteActive() {
  return {
    texte: `SELECT s.id::text, count(c.id)::int AS n FROM app.knowledge_sources s
LEFT JOIN app.knowledge_chunks c ON c.source_id = s.id AND c.embedding IS NOT NULL
WHERE s.statut = 'active' GROUP BY s.id ORDER BY s.id`,
    params: [],
  };
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

// ─── Transport socket R3-P2 (superuser local, sans URL admin) ───────────────
// Contexte : MINDCARE_ADMIN_DATABASE_URL n'existe pas (.env vérifié : seul
// MINDCARE_DATABASE_URL, 42501 en écriture). Le pilote R3 a prouvé le
// transport `docker exec` + fichier, mais avec interpolation naïve et
// double-requête désalignable. Ces briques pures rendent le transport
// socket VÉRIFIÉ plutôt que confiant : interpolation testée + appariement
// prouvé par RETURNING, jamais supposé.

/** Alphabet des ids de chunks (FNV-1a hex 8, `hacherTexte`) — tout autre = refus. */
export function validerIdChunk(id) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}$/.test(id)) {
    throw new Error(`Id de chunk inattendu (refus d'interpolation) : ${String(id).slice(0, 40)}`);
  }
  return id;
}

/** Échappement strict d'un littéral SQL (texte entre quotes, anti-injection). */
export function echapperLitteral(valeur) {
  // NULL SQL réel (jamais la chaîne 'null' — incident staging v1.1 :
  // `$6::timestamptz` recevait `'null'`). undefined = NULL aussi (refus
  // silencieux interdit : une valeur absente ne voyage jamais en texte.
  if (valeur === null || valeur === undefined) return "NULL";
  if (typeof valeur === "number") {
    if (!Number.isFinite(valeur)) throw new Error("Littéral numérique non fini : refus.");
    return String(valeur);
  }
  if (Array.isArray(valeur)) {
    // Tableau texte Postgres : '{"a","b"}' — éléments validés un par un.
    const elements = valeur.map((e) => {
      if (typeof e !== "string") throw new Error("Tableau SQL : éléments texte seuls.");
      return '"' + e.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
    });
    return "'{" + elements.join(",") + "}'";
  }
  return "'" + String(valeur).replaceAll("'", "''") + "'";
}

/**
 * Lie $1..$N en UNE passe regex (pas de split chaîné : `$10` ne mange jamais
 * `$1`, une valeur contenant `$2` n'est jamais re-substituée). Index hors
 * borne → refus. Les valeurs sont figées AVANT (jamais de re-substitution).
 */
export function lierParams(texte, params) {
  const figes = params.map((p) => echapperLitteral(p));
  return texte.replace(/\$(\d+)/g, (m, n) => {
    const i = Number.parseInt(n, 10);
    if (!Number.isInteger(i) || i < 1 || i > figes.length) {
      throw new Error(`Paramètre hors borne dans le SQL : ${m}`);
    }
    return figes[i - 1];
  });
}

/**
 * Variante transport de la sélection : UNE requête, `id + texte(base64) +
 * chunker_version`, `ORDER BY id`. Le base64 neutralise retours-ligne et
 * `|` du texte (incident R3 : base64 multi-ligne coupé — ici `replace`
 * côté SQL + décodage testé côté client). Les ids restent validés par
 * `validerIdChunk` avant tout usage.
 */
export function sqlSelectionLotBase64(limite, r, exclure = []) {
  const base = sqlSelectionLot(limite, r, exclure);
  const texte = base.texte
    .replace("SELECT id, texte, chunker_version FROM", "SELECT id, chunker_version, replace(encode(convert_to(texte,'UTF8'),'base64'), chr(10), '') AS texte_b64 FROM");
  return { texte, params: base.params };
}

/** Décode une ligne base64 (round-trip testé : multi-lignes, RTL, 98 Ko). */
export function decoderTexteB64(b64) {
  return Buffer.from(String(b64), "base64").toString("utf8");
}

/**
 * UPDATE mono-instruction + `RETURNING c.id` : le transport socket n'a pas
 * de `rowCount` natif — les ids retournés SONT la preuve (cardinalité +
 * identité). `verifierRetourLot` les confronte aux ids demandés.
 */
export function sqlMiseAJourLotReturning(lignes, r) {
  for (const ligne of lignes) validerIdChunk(ligne.id);
  const maj = sqlMiseAJourLot(lignes, r);
  return { texte: `${maj.texte} RETURNING c.id`, params: maj.params };
}

/**
 * Preuve d'appariement : l'ensemble retourné == l'ensemble demandé
 * (ordre indifférent, doublon ou manquant = refus). C'est CE test qui
 * rend le risque ID↔vecteur impossible à passer en silence.
 */
export function verifierRetourLot(demandes, retournes) {
  const trier = (xs) => [...xs].sort();
  const a = trier(demandes.map((d) => { validerIdChunk(d); return d; }));
  const b = trier(retournes.map((r) => { validerIdChunk(String(r).trim()); return String(r).trim(); }));
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    throw new Error(
      `Appariement lot refusé (demandés=${a.length}, retournés=${b.length}) — STOP, corruption suspectée.`,
    );
  }
  return true;
}
