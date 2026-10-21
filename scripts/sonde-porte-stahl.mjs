#!/usr/bin/env node
/**
 * sonde-porte-stahl — interroge la VRAIE porte lexicale, requete par requete.
 *
 *   node scripts/sonde-porte-stahl.mjs "usual dosage range olanzapine" [...]
 *
 * Affiche, pour chaque requete, les chunks remontes par
 * `app.search_knowledge_lexical` (meme SQL, meme fonction), avec la section
 * et le score. Outil de DIAGNOSTIC : il ne modifie rien.
 */
import { execSocket, lignesSocket } from "./transport-socket.mjs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requetes = process.argv.slice(2);
if (requetes.length === 0) {
  console.error("usage : node scripts/sonde-porte-stahl.mjs <requete> [...]");
  process.exit(2);
}

for (const requete of requetes) {
  const lignes = lignesSocket(RACINE, {
    texte: `SELECT row_to_json(x)::text FROM (
        SELECT c.id, c.section, c.langue, s.titre,
          ts_rank(c.document_tsv, plainto_tsquery('simple', app.immutable_unaccent($1)))::double precision AS score,
          left(c.texte, 160) AS extrait
        FROM app.knowledge_chunks c
        JOIN app.knowledge_sources s ON s.id = c.source_id
        WHERE s.classification = 'C4'
          AND s.statut IN ('active','reviewed')
          AND (s.review_due_at IS NULL OR s.review_due_at > now())
          AND s.superseded_by IS NULL
          AND c.statut IN ('inactive','active')
          AND c.document_tsv @@ plainto_tsquery('simple', app.immutable_unaccent($1))
        ORDER BY score DESC LIMIT 8) x`,
    params: [requete],
  });
  console.log(`\n=== ${JSON.stringify(requete)} — ${lignes.length} resultat(s) ===`);
  for (const l of lignes) {
    const r = JSON.parse(l);
    console.log(`  ${r.score.toFixed(4)}  ${r.section}`);
    console.log(`         ${String(r.extrait).replace(/\n/g, " / ").slice(0, 130)}`);
  }
}
