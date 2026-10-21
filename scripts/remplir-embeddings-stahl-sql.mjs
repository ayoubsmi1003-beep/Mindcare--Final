#!/usr/bin/env node
/**
 * remplir-embeddings-stahl-sql — backfill des vecteurs BGE-M3 en base (Stahl 7e).
 *
 *   node scripts/remplir-embeddings-stahl-sql.mjs --ecrire --socket
 *
 * Source de verite : `embeddings-v2.jsonl` (produit par
 * `remplir-embeddings-stahl.mjs`, recette epinglee r2-2026-09-16).
 *
 * Discipline :
 * - PORTEE STRICTE : `source_id = <uuid Stahl>` ET `chunker_version =
 *   'stahl-units-v1'`. Jamais de balayage global, jamais de lecture du
 *   corpus d'un autre livre.
 * - n'ecrit QUE l'embedding + les 9 colonnes de recette ; ne touche NI
 *   `statut`, NI la source, NI l'approbation.
 * - garde `recette_complete` (embedding <-> metadata) respectee.
 * - preuve par RETURNING (comparaison ensembliste ids demandes/retournes).
 * - reprise : les chunks deja vectorises pour CETTE source sont ignores.
 * - aucune activation.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BOOK_ID, CHUNKER_VERSION, SOURCE_UUID, VERSION } from "./charger-connaissance-corpus-stahl.mjs";
import { execSocket, lignesSocket } from "./transport-socket.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOSSIER = join(RACINE, "knowledge", "canonical-v2", BOOK_ID, VERSION.replace("sha256:", "sha256-"));
const EMBEDDINGS = join(DOSSIER, "embeddings-v2.jsonl");
const SORTIE = join(RACINE, "knowledge", ".sortie-embeddings-stahl-sql.json");
const args = process.argv.slice(2);
const ECRIRE = args.includes("--ecrire");
const VIA_SOCKET = args.includes("--socket");
const TAILLE_LOT = 32;
const iLimite = args.indexOf("--limite");
const LIMITE = iLimite >= 0 ? Number.parseInt(args[iLimite + 1], 10) : Infinity;

function esc(v) {
  if (v === null || v === undefined) return "NULL";
  return `'${String(v).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

const recette = JSON.parse(readFileSync(join(RACINE, "knowledge", "recette-embedding-pinee.json"), "utf8"));
const lignes = readFileSync(EMBEDDINGS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
if (lignes.length === 0) {
  console.error("ROUGE — embeddings-v2.jsonl vide. Rien n'a ete ecrit.");
  process.exit(1);
}
for (const l of lignes) {
  if (!Array.isArray(l.embedding) || l.embedding.length !== recette.dimensions) {
    console.error(`ROUGE — dimension invalide pour ${l.chunk_id}. Rien n'a ete ecrit.`);
    process.exit(1);
  }
}

const rapport = {
  outil: "remplir-embeddings-stahl-sql.mjs",
  ecrire: ECRIRE,
  source_id: SOURCE_UUID,
  livre: BOOK_ID,
  chunker: CHUNKER_VERSION,
  recette_version: recette.recipe_version,
  modele: recette.model,
  revision: recette.revision,
  dimensions: recette.dimensions,
  distance: recette.distance,
  normalisation: recette.normalisation,
  embeddings_fichier: lignes.length,
  ecrits: { chunks: 0 },
};

if (!ECRIRE) {
  console.log("remplir-embeddings-stahl-sql — DRY-RUN (zero ecriture)");
  console.log(`  source    : ${SOURCE_UUID}`);
  console.log(`  embeddings: ${lignes.length} (${recette.model} ${recette.dimensions}d, ${recette.distance})`);
  console.log(`  ecrits    : chunks=${rapport.ecrits.chunks}`);
  process.exit(0);
}
if (!VIA_SOCKET) {
  console.error("ROUGE — --ecrire exige --socket (superuser local mc-p3). Rien n'a ete ecrit.");
  process.exit(1);
}

// deja vectorises pour CETTE source -> ignores (reprise)
const deja = lignesSocket(RACINE, {
  texte: `SELECT count(*)::int AS n FROM app.knowledge_chunks
    WHERE source_id = $1::uuid AND chunker_version = $2 AND embedding IS NOT NULL`,
  params: [SOURCE_UUID, CHUNKER_VERSION],
});
const nDeja = Number.parseInt(deja[0] ?? "0", 10);
rapport.deja_vectorises = nDeja;
rapport.a_vectoriser = Math.max(0, lignes.length - nDeja);
rapport.limite = Number.isFinite(LIMITE) ? LIMITE : null;

// Garde : la source ne doit pas etre 'active' pendant le backfill
// (le filtre "no active source" du backfill canonique l'exige : les
// embeddings sont calcules AVANT l'activation).
const etat = lignesSocket(RACINE, {
  texte: "SELECT statut FROM app.knowledge_sources WHERE id = $1::uuid",
  params: [SOURCE_UUID],
});
if ((etat[0] ?? "") !== "reviewed") {
  console.error(`ROUGE — source Stahl en statut '${etat[0] ?? "absente"}' : le backfill exige 'reviewed' (avant activation). Rien n'a ete ecrit.`);
  process.exit(1);
}

const aTraiter = Number.isFinite(LIMITE) ? lignes.slice(0, LIMITE) : lignes;
// Vagues de 10 lots (320 chunks) par transaction : un script SQL de plusieurs
// dizaines de Mo n'est pas atomique en pratique, et le retour arriere reste
// borne. Chaque vague est prouvee par RETURNING avant la suivante.
const LOTS_PAR_VAGUE = 10;
const vagues = [];
for (let i = 0; i < aTraiter.length; i += TAILLE_LOT * LOTS_PAR_VAGUE) {
  vagues.push(aTraiter.slice(i, i + TAILLE_LOT * LOTS_PAR_VAGUE));
}
let curseurGlobal = 0;
for (const [indexVague, vague] of vagues.entries()) {
  const etapesVague = [];
  const preuvesVague = [];
  for (let i = 0; i < vague.length; i += TAILLE_LOT) {
    const lot = vague.slice(i, i + TAILLE_LOT);
    const valeurs = [];
    for (const l of lot) {
      // Le litteral vectoriel de pgvector DOIT etre encadre par des crochets.
      const v = l.embedding.map((x) => (Number.isFinite(x) ? x.toFixed(9) : "0")).join(",");
      valeurs.push(`('${l.chunk_id}'::text, '[${v}]'::public.vector, ${esc(recette.provider)}, ${esc(recette.model)}, ${esc(recette.revision)}, ${recette.dimensions}::integer, ${esc("l2-native-tete-sentence-embedding-v1")}, ${esc("")}, ${esc("")}, ${esc(recette.distance)})`);
    }
    etapesVague.push(
      `UPDATE app.knowledge_chunks AS c SET
        embedding = v.embedding::public.vector,
        embedding_provider = v.provider, embedding_modele = v.modele, embedding_version = v.version,
        embedding_dimensions = v.dimensions::integer, embedding_normalisation = v.normalisation,
        embedding_instruction_requete = v.instr_req, embedding_instruction_document = v.instr_doc,
        embedding_distance = v.distance
      FROM (VALUES ${valeurs.join(",")})
        AS v(id, embedding, provider, modele, version, dimensions, normalisation, instr_req, instr_doc, distance)
      WHERE c.id = v.id AND c.source_id = '${SOURCE_UUID}'::uuid AND c.chunker_version = '${CHUNKER_VERSION}'
      RETURNING c.id`,
    );
    preuvesVague.push(lot.map((l) => l.chunk_id));
  }
  const scriptVague = ["BEGIN;"].concat(etapesVague.map((s) => `${s};`)).concat(["COMMIT;"]).join("\n");
  let sortieVague;
  try {
    sortieVague = execSocket(RACINE, scriptVague);
  } catch (err) {
    try { execSocket(RACINE, "ROLLBACK;"); } catch { /* session morte */ }
    console.error(`ROUGE — backfill interrompu (vague ${indexVague + 1}/${vagues.length}) : ${String(err.message ?? err).slice(0, 200)}. rollback.`);
    process.exit(1);
  }
  const retournesVague = sortieVague.trim() === "" ? [] : sortieVague.split("\n").map((l) => l.trim()).filter(Boolean);
  let curseur = 0;
  for (const demandes of preuvesVague) {
    const attendu = demandes.slice().sort();
    const obtenu = retournesVague.slice(curseur, curseur + demandes.length).slice().sort();
    if (attendu.length !== obtenu.length || attendu.some((v, k) => v !== obtenu[k])) {
      throw new Error(`RETURNING inattendu (demandes=${attendu.length}, obtenus=${obtenu.length}) — STOP`);
    }
    curseur += demandes.length;
  }
  if (curseur !== retournesVague.length) {
    throw new Error(`RETURNING inattendu (attendus=${curseur}, recus=${retournesVague.length}) — STOP`);
  }
  curseurGlobal += curseur;
  rapport.ecrits.chunks = curseurGlobal;
  writeFileSync(SORTIE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
  console.log(`vague ${indexVague + 1}/${vagues.length} : ${curseurGlobal} chunks vectorises`);
}
writeFileSync(SORTIE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
console.log(`remplir-embeddings-stahl-sql — ${curseurGlobal} chunks vectorises (preuve RETURNING ok, source reste 'reviewed')`);
