/**
 * verifier-taylor-final.mjs — M08-Taylor · ACCEPTANCE FINALE (lecture seule).
 *
 * Pré-conditions : backfill scoped terminé (7 859/7 859). ZÉRO écriture ici :
 * que des SELECT de comptes/métadonnées (aucun texte de chunk lu, aucune PII).
 * Chaque contrôle rend `vert`/`ROUGE` ; exit 1 si un seul est rouge.
 *
 *   node scripts/verifier-taylor-final.mjs [--attendu-hors-portee N]
 *   node scripts/verifier-taylor-final.mjs --chunker taylor-units-v2-candidate --attendu 9344 --exiger-lignee
 * `--chunker` + `--attendu` ciblent une représentation (défaut : v1-proposed,
 * 7 859) ; `--exiger-lignee` exige unit_id/parent/enfant renseignés (v2/D3-A).
 * Contrôles :
 *   A. cardinalité (7 859 / 7 859 / 0, 0 actif)
 *   B. uniformité recette (modèle/version/dims/chunker, vector_dims)
 *   C. isolation (hors-portée non-embedded, défaut 12 815 — modifiable si une
 *      raison indépendante documentée l'a fait bouger)
 *   D. gouvernance (source reviewed, approved_* NULL, 0 chunk actif)
 *   E. idempotence (prédicat de reprise scoped = 0 ligne éligible → 2e run no-op)
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { lignesSocket } from "./transport-socket.mjs";
import { CHUNKERS_ACCEPTES } from "./remplir-embeddings-sql.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function option(nom) {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const v = args[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : "";
}
const ATTENDU_HORS_PORTEE = Number.parseInt(option("--attendu-hors-portee") ?? "12815", 10);
const CHUNKER_CIBLE = option("--chunker") ?? "taylor-units-v1-proposed";
const ATTENDU_CHUNKS = Number.parseInt(option("--attendu") ?? "7859", 10);
const EXIGER_LIGNEE = args.includes("--exiger-lignee");

const TAYLOR = "9c2fd184-297e-504e-8c95-ffd06896e420";
const RECETTE = {
  provider: "local-onnx",
  modele: "BAAI/bge-m3",
  version: "5617a9f61b028005a4858fdac845db406aefb181",
  dimensions: 1024,
  // Valeurs gelées RECETTE_GELEE (src/server/knowledge/embeddings-local.ts),
  // écrites telles quelles par le backfill — lues ici, jamais inventées.
  normalisation: "l2-native-tete-sentence-embedding-v1",
  instruction_requete: "",
  instruction_document: "",
  distance: "cosine",
  chunker: CHUNKER_CIBLE,
};
const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;

const DERIVE_SQL =
  `embedding_provider IS DISTINCT FROM ${lit(RECETTE.provider)} OR ` +
  `embedding_modele IS DISTINCT FROM ${lit(RECETTE.modele)} OR ` +
  `embedding_version IS DISTINCT FROM ${lit(RECETTE.version)} OR ` +
  `embedding_dimensions IS DISTINCT FROM 1024 OR ` +
  `embedding_normalisation IS DISTINCT FROM ${lit(RECETTE.normalisation)} OR ` +
  `embedding_instruction_requete IS DISTINCT FROM ${lit(RECETTE.instruction_requete)} OR ` +
  `embedding_instruction_document IS DISTINCT FROM ${lit(RECETTE.instruction_document)} OR ` +
  `embedding_distance IS DISTINCT FROM ${lit(RECETTE.distance)} OR ` +
  `chunker_version <> ${lit(RECETTE.chunker)}`;
// Portée du contrôle B : les 9 champs du prédicat de dérive (8 colonnes
// recette + chunker) + vector_dims(embedding)=1024. Tous les littéraux sont
// lus de RECETTE_GELEE / la recette épinglée — rien n'est inventé ici.

let verts = 0;
let rouges = 0;
function verdict(ok, ligne, detail = "") {
  if (ok) verts += 1;
  else rouges += 1;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${ligne}${detail === "" ? "" : ` | ${detail}`}`);
}

function q(sql) {
  const lignes = lignesSocket(RACINE, { texte: sql, params: [] });
  return (lignes[0] ?? "").split("|");
}

// ── A · cardinalité ─────────────────────────────────────────────────────────
{
  const [total, emb, actifs, chunkers, langues] = q(
    `SELECT count(*), count(embedding), count(*) FILTER (WHERE statut='active'), ` +
    `string_agg(DISTINCT chunker_version, ','), string_agg(DISTINCT langue, ',') ` +
    `FROM app.knowledge_chunks WHERE source_id='${TAYLOR}'::uuid AND chunker_version=${lit(CHUNKER_CIBLE)}`,
  );
  verdict(Number(total) === ATTENDU_CHUNKS, "A.cardinalite", `chunks=${total} (attendu ${ATTENDU_CHUNKS}, ${CHUNKER_CIBLE})`);
  verdict(Number(emb) === ATTENDU_CHUNKS, "A.embedded", `embedded=${emb}`);
  verdict(Number(total) - Number(emb) === 0, "A.remaining", `restants=${Number(total) - Number(emb)}`);
  verdict(actifs === "0", "A.inactifs", `actifs=${actifs}`);
  verdict(chunkers === RECETTE.chunker, "A.chunker", chunkers);
  verdict(langues === "en", "A.langue", langues);
}

// ── B · uniformité recette ──────────────────────────────────────────────────
{
  const [derive] = q(
    `SELECT count(*) FROM app.knowledge_chunks WHERE source_id='${TAYLOR}'::uuid AND chunker_version=${lit(CHUNKER_CIBLE)} AND embedding IS NOT NULL AND (${DERIVE_SQL} OR ` +
    `vector_dims(embedding) <> 1024)`,
  );
  verdict(derive === "0", "B.uniformite", `lignes à recette dérivée (9 champs)=${derive}`);
  verdict(CHUNKERS_ACCEPTES.includes(RECETTE.chunker), "B.allowlist", "taylor-units-v1-proposed admis");
}

// ── C · isolation ───────────────────────────────────────────────────────────
{
  const [hors] = q(
    `SELECT count(*) FROM app.knowledge_chunks WHERE embedding IS NULL AND source_id<>'${TAYLOR}'::uuid`,
  );
  const detail = q(
    `SELECT string_agg(chunker_version || ':' || n, ',' ORDER BY chunker_version) FROM (SELECT chunker_version, count(*)::text AS n FROM app.knowledge_chunks WHERE embedding IS NULL AND source_id<>'${TAYLOR}'::uuid GROUP BY 1) t`,
  )[0];
  verdict(Number(hors) === ATTENDU_HORS_PORTEE, "C.isolation", `hors-portée non-embedded=${hors} (attendu ${ATTENDU_HORS_PORTEE}) [${detail}]`);
}

// ── D · gouvernance ─────────────────────────────────────────────────────────
{
  const [statut, appr, chunksActifs] = q(
    `SELECT s.statut, (s.approved_at IS NOT NULL)::text, count(c.*) FILTER (WHERE c.statut='active') ` +
    `FROM app.knowledge_sources s LEFT JOIN app.knowledge_chunks c ON c.source_id=s.id AND c.chunker_version=${lit(CHUNKER_CIBLE)} ` +
    `WHERE s.id='${TAYLOR}'::uuid GROUP BY 1, 2`,
  );
  verdict(statut === "reviewed", "D.statut-source", statut);
  verdict(appr === "false", "D.sans-approbation", `approved=${appr}`);
  verdict(chunksActifs === "0", "D.chunks-inactifs", chunksActifs);
}

// ── E · idempotence (prédicat de reprise scoped = 0 éligible) ───────────────
{
  const [eligibles] = q(
    `SELECT count(*) FROM app.knowledge_chunks WHERE source_id='${TAYLOR}'::uuid AND chunker_version=${lit(CHUNKER_CIBLE)} AND (embedding IS NULL OR ${DERIVE_SQL})`,
  );
  verdict(eligibles === "0", "E.idempotence", `éligibles reprise=${eligibles} (2e run = no-op)`);
}

// ── F · lignée D3-A (v2 : exigée ; v1 : inconnue par construction) ─────────
if (EXIGER_LIGNEE) {
  const [sansLignee] = q(
    `SELECT count(*) FROM app.knowledge_chunks WHERE source_id='${TAYLOR}'::uuid AND chunker_version=${lit(CHUNKER_CIBLE)} AND ` +
    `(unit_id IS NULL OR parent_texte_hash IS NULL OR enfant_index IS NULL OR enfants_total IS NULL)`,
  );
  verdict(sansLignee === "0", "F.lignee", `sans lignée=${sansLignee}`);
}

console.log(`\nVERDICT TAYLOR-FINAL : ${rouges === 0 ? "VERT" : "ROUGE"} — ${verts} verts, ${rouges} rouges`);
process.exit(rouges === 0 ? 0 : 1);
