/** R1 — requetes SQL quarantaine (aucune activation).
 *
 * NOTE (incident staging v1.1) : `statut` est VOLONTAIREMENT absent du SET
 * de l'upsert source — le cycle de vie (discovered→…→active) est un acte
 * humain, jamais une convergence de staging. Rejouer le chargeur ne promeut
 * ni ne rétrograde (le 2026-09-21, un SET incluant `statut` avait éteint les
 * 6 sources R1 `active` — restaurées, puis verrou verrouillé ici + test).
 */
export function sqlSource() {
  return `INSERT INTO app.knowledge_sources
      (id, cabinet_id, titre, version, langue, classification, statut,
      approved_at, approved_by, reviewed_by, reviewed_at, review_due_at,
      superseded_by, emetteur, reference_origine, contenu_hash)
   VALUES ($1, NULL, $2, $3, $4, 'C4', $5,
      NULL, NULL, NULL, NULL, $6::timestamptz,
      NULL, $7, $8, $9)
   ON CONFLICT (id) DO UPDATE SET
     titre = EXCLUDED.titre, version = EXCLUDED.version,
     langue = EXCLUDED.langue, review_due_at = EXCLUDED.review_due_at,
     emetteur = EXCLUDED.emetteur, reference_origine = EXCLUDED.reference_origine,
     contenu_hash = EXCLUDED.contenu_hash`;
}
/**
 * Chunk mono-ligne (miroir documentaire — la voie live est le bulk de
 * `charger-connaissance.mjs`). `statut`/`versionChunk` en liste FERMÉE :
 * toute autre valeur = throw AVANT tout SQL (jamais d'interpolation libre).
 * v1.1 = resplit `couperLong` des longs OCR (décision humaine) ; les parents
 * rescindés voyagent `inactive` (traçabilité, zéro DELETE).
 */
export const STATUTS_CHUNK = ["active", "inactive"];
export const VERSIONS_CHUNKER = ["struct-v1", "struct-v1.1", "struct-v2"];
export function sqlChunk({ statut = "active", versionChunk = "struct-v1" } = {}) {
  if (!STATUTS_CHUNK.includes(statut)) throw new Error(`Statut chunk refusé : ${statut}`);
  if (!VERSIONS_CHUNKER.includes(versionChunk)) throw new Error(`Découpeur refusé : ${versionChunk}`);
  // struct-v2 (DSM-5) : quarantaine inactive uniquement — jamais actif en R1.
  if (versionChunk === "struct-v2" && statut !== "inactive") throw new Error("struct-v2 exige statut inactive (quarantaine)");
  // Les 3 colonnes instruction_requete/instruction_document/distance portent
  // un DEFAULT ('', '', 'cosine') dans 092 — on les OMET : aucun embed
  // (porte B/R2), aucune recette inventee, contrainte recette_complete OK.
  return `INSERT INTO app.knowledge_chunks
     (id, source_id, ordinal, section, sous_section, langue, texte,
      texte_hash, occurrence, statut, chunker_version,
      embedding, embedding_provider, embedding_modele, embedding_version,
      embedding_dimensions, embedding_normalisation)
   VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, '${statut}', '${versionChunk}',
      NULL, NULL, NULL, NULL, NULL, NULL)
   ON CONFLICT (id) DO UPDATE SET
     ordinal = EXCLUDED.ordinal, section = EXCLUDED.section,
     texte = EXCLUDED.texte,
     texte_hash = EXCLUDED.texte_hash, occurrence = EXCLUDED.occurrence,
     statut = EXCLUDED.statut, chunker_version = EXCLUDED.chunker_version`;
}
export function sqlTrouverCollisions() {
  // Garde anti-ecrasement inter-sources (incident DSM/corpus-b : collision
  // FNV-32) : tout id demande qui existe deja sous une autre source bloque
  // le chargement AVANT tout INSERT.
  return `SELECT id FROM app.knowledge_chunks WHERE id = ANY ($1) AND source_id <> $2`;
}
export function argsChargeur(argv, defauts) {
  const o = { ecrire: false, manifeste: defauts.manifeste, sortie: defauts.sortie, limite: null, sources: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ecrire") o.ecrire = true;
    else if (a === "--dry-run") o.ecrire = false;
    else if (a === "--source" && argv[i + 1]) { i++; o.sources.push(argv[i]); }
    else if (a.startsWith("--source=")) o.sources.push(a.slice(9));
    else if (a === "--manifeste" && argv[i + 1]) { i++; o.manifeste = argv[i]; }
    else if (a.startsWith("--manifeste=")) o.manifeste = a.slice(12);
    else if (a === "--sortie" && argv[i + 1]) { i++; o.sortie = argv[i]; }
    else if (a.startsWith("--sortie=")) o.sortie = a.slice(9);
    else if (a === "--limite-medicaments" && argv[i + 1]) { i++; o.limite = parseInt(argv[i], 10); }
    else if (a.startsWith("--limite-medicaments=")) o.limite = parseInt(a.slice(22), 10);
  }
  return o;
}
