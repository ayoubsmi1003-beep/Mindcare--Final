/** R1 — requetes SQL quarantaine (aucune activation). */
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
     langue = EXCLUDED.langue, statut = EXCLUDED.statut,
     review_due_at = EXCLUDED.review_due_at,
     emetteur = EXCLUDED.emetteur, reference_origine = EXCLUDED.reference_origine,
     contenu_hash = EXCLUDED.contenu_hash`;
}
export function sqlChunk() {
  // Les 3 colonnes instruction_requete/instruction_document/distance portent
  // un DEFAULT ('', '', 'cosine') dans 092 — on les OMET : aucun embed
  // (porte B/R2), aucune recette inventee, contrainte recette_complete OK.
  return `INSERT INTO app.knowledge_chunks
     (id, source_id, ordinal, section, sous_section, langue, texte,
      texte_hash, occurrence, statut, chunker_version,
      embedding, embedding_provider, embedding_modele, embedding_version,
      embedding_dimensions, embedding_normalisation)
   VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, 'active', 'struct-v1',
      NULL, NULL, NULL, NULL, NULL, NULL)
   ON CONFLICT (id) DO UPDATE SET
     ordinal = EXCLUDED.ordinal, section = EXCLUDED.section,
     texte = EXCLUDED.texte,
     texte_hash = EXCLUDED.texte_hash, occurrence = EXCLUDED.occurrence`;
}
export function argsChargeur(argv, defauts) {
  const o = { ecrire: false, manifeste: defauts.manifeste, sortie: defauts.sortie, limite: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ecrire") o.ecrire = true;
    else if (a === "--dry-run") o.ecrire = false;
    else if (a === "--manifeste" && argv[i + 1]) { i++; o.manifeste = argv[i]; }
    else if (a.startsWith("--manifeste=")) o.manifeste = a.slice(12);
    else if (a === "--sortie" && argv[i + 1]) { i++; o.sortie = argv[i]; }
    else if (a.startsWith("--sortie=")) o.sortie = a.slice(9);
    else if (a === "--limite-medicaments" && argv[i + 1]) { i++; o.limite = parseInt(argv[i], 10); }
    else if (a.startsWith("--limite-medicaments=")) o.limite = parseInt(a.slice(22), 10);
  }
  return o;
}
