#!/usr/bin/env node
/**
 * charger-connaissance-corpus-stahl — CONSTRUCTEUR pur (dry-run, zéro écriture).
 *
 *   node scripts/charger-connaissance-corpus-stahl.mjs
 *
 * Produit les lignes de chunks Stahl 7e à charger en QUARANTAINE.
 *
 * Garde-fous (throw AVANT toute sortie) :
 * - chunks `inactive` UNIQUEMENT, `stahl-units-v1` UNIQUEMENT, langue `en` ;
 * - lignee D3-A complete (unit_id, parent_texte_hash, enfant_index, enfants_total) ;
 * - section non vide, texte non vide ;
 * - ids uniques ;
 * - liste fermée LOCALE des découpeurs (1 entrée) — le dépôt n'est pas
 *   modifié : la liste globale `CHUNKERS_ACCEPTES` est une surface
 *   partagée, la passe d'intégration l'alignera.
 * - le TITRE de la source est compose depuis book.json (jamais transcrit a la
 *   main) : il doit etre identique a la chaine `BOOKS` de
 *   `src/server/alexa/knowledge-query.ts`, sinon `matchesRequestedBook()`
 *   filtrera toutes les lignes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { uuidDeterministe, sha256Hex, hacherTexteFNV } from "./charger-connaissance-socle.mjs";

export const BOOK_ID = "stahl-prescribers-guide-7e-cup";
export const VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3";
export const CHUNKER_VERSION = "stahl-units-v1";
/** Liste fermée LOCALE (le dépôt n'est pas modifie). */
export const CHUNKERS_ACCEPTES_STAHL = [CHUNKER_VERSION];
export const LANGUE = "en";
export const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOSSIER = join(RACINE, "knowledge", "canonical-v2", BOOK_ID, VERSION.replace("sha256:", "sha256-"));

export const SOURCE_UUID = uuidDeterministe(`${BOOK_ID}:${VERSION}`);

/** Titre de la source : compose depuis book.json, jamais transcrit. */
export function titreSource() {
  const book = JSON.parse(readFileSync(join(DOSSIER, "book.json"), "utf8"));
  const base = String(book.title ?? "").trim();
  const sous = String(book.subtitle ?? "").trim();
  return sous ? `${base} (${sous})` : base;
}

export function contenuHash() {
  const chunks = lireChunks();
  return sha256Hex(chunks.map((c) => c.chunk_id).join("\n"));
}

function lireChunks() {
  return readFileSync(join(DOSSIER, "chunks-v2.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function garderLotV1(chunks) {
  for (const ch of chunks) {
    if (ch.statut !== "inactive") throw new Error(`statut chunk refuse : ${String(ch.statut).slice(0, 40)}`);
    if (!CHUNKERS_ACCEPTES_STAHL.includes(ch.chunker_version)) {
      throw new Error(`decoupeur refuse : ${String(ch.chunker_version).slice(0, 40)}`);
    }
    if (ch.langue !== LANGUE) throw new Error(`langue chunk inattendue : ${String(ch.langue).slice(0, 20)}`);
    if (typeof ch.unit_id !== "string" || ch.unit_id === "") throw new Error("lineage incomplete : unit_id");
    if (typeof ch.parent_texte_hash !== "string" || ch.parent_texte_hash === "") throw new Error("lineage incomplete : parent_texte_hash");
    if (!Number.isInteger(ch.enfant_index) || ch.enfant_index < 0) throw new Error("lineage incomplete : enfant_index");
    if (!Number.isInteger(ch.enfants_total) || ch.enfants_total < 1) throw new Error("lineage incomplete : enfants_total");
    if (typeof ch.section !== "string" || ch.section.trim() === "") throw new Error("section vide");
    if (typeof ch.texte !== "string" || ch.texte.trim() === "") throw new Error("texte vide");
    if (ch.occurrence < 0 || !Number.isInteger(ch.occurrence)) throw new Error("occurrence invalide");
  }
}

export function construireChunks() {
  const chunks = lireChunks();
  garderLotV1(chunks);
  const vus = new Set();
  const out = chunks.map((c, ordinal) => {
    if (vus.has(c.chunk_id)) throw new Error(`collision intra-corpus : ${c.chunk_id}`);
    vus.add(c.chunk_id);
    return {
      chunkId: c.chunk_id,
      sourceUuid: SOURCE_UUID,
      ordinal,
      section: c.section,
      sousSection: c.sous_section ?? null,
      langue: c.langue,
      texte: c.texte,
      texteHash: c.texte_hash,
      occurrence: c.occurrence,
      statut: "inactive",
      versionChunk: c.chunker_version,
      unit_id: c.unit_id,
      parent_texte_hash: c.parent_texte_hash,
      enfant_index: c.enfant_index,
      enfants_total: c.enfants_total,
    };
  });
  return out;
}

export function dryRunStahl() {
  const chunks = construireChunks();
  const titre = titreSource();
  const manifest = JSON.parse(readFileSync(join(DOSSIER, "chunks-v2.manifest.json"), "utf8"));
  return {
    source_id: SOURCE_UUID,
    titre,
    version: VERSION,
    langue: LANGUE,
    classification: "C4",
    chunker: CHUNKER_VERSION,
    chunks: chunks.length,
    chunkers_acceptes: CHUNKERS_ACCEPTES_STAHL,
    hash_ids: manifest.hash_ids,
    ids_uniques: new Set(chunks.map((c) => c.chunkId)).size === chunks.length,
    ecrits: { sources: 0, chunks: 0 },
  };
}

const lanceDirect = process.argv[1] !== undefined
  && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (lanceDirect) {
  const r = dryRunStahl();
  console.log("charger-connaissance-corpus-stahl — DRY-RUN (zero ecriture)");
  console.log(`  source   : ${r.source_id}`);
  console.log(`  titre    : ${r.titre}`);
  console.log(`  version  : ${r.version}`);
  console.log(`  chunks   : ${r.chunks} [${r.chunker}, inactifs]`);
  console.log(`  ids uniques : ${r.ids_uniques}`);
  console.log(`  ecrits   : sources=${r.ecrits.sources} chunks=${r.ecrits.chunks}`);
  if (!r.ids_uniques) process.exit(1);
}
