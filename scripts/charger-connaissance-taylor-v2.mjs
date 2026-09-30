#!/usr/bin/env node
/** M08-Taylor v2 : chargeur quarantaine taylor-units-v2-candidate.
 *
 * DRY-RUN par défaut ; `--ecrire --socket` écrit via `docker exec mc-p3`
 * (transaction mono-script BEGIN…COMMIT, ON_ERROR_STOP, preuve par RETURNING).
 * Autorisation : Full v2 path (D1-V2 + D4-bis LOAD, session du 2026-09-27).
 *
 * Portée Taylor v2 uniquement. Source `corpus-taylor` EXISTANTE exigée
 * (reviewed, non approuvée — jamais réécrite ici : aucune étape source).
 * Réutilise le builder dry-run v2 : les ids écrits sont bit-identiques au
 * dry-run (9 344 attendus, sinon STOP). Lignée D3-A écrite par chunk
 * (unit_id, parent_texte_hash, enfant_index, enfants_total).
 *
 * Garde-fous (throw AVANT tout SQL) :
 * - chunks `inactive` UNIQUEMENT, `taylor-units-v2-candidate` UNIQUEMENT,
 *   langue `en` UNIQUEMENT, lignée complète (listes fermées) ;
 * - source existante + reviewed + approved_* NULL (sinon STOP) ;
 * - garde anti-collision inter-sources (ids existant sous une autre
 *   source → STOP) ; v1 et v2 coexistent (aucun id v1 réécrit) ;
 * - garde anti-active finale en DO-block (raise AVANT commit).
 *
 * Usage :
 *   node scripts/charger-connaissance-taylor-v2.mjs --dry-run
 *   node scripts/charger-connaissance-taylor-v2.mjs --ecrire --socket
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TAYLOR_CHUNKER_V2,
  chunksDepuisUnitesTaylorV2,
  dryRunTaylorV2,
} from "./charger-connaissance-corpus-taylor-v2.mjs";
import { filtrerUnitesSuresTaylor } from "./charger-connaissance-corpus-taylor.mjs";
import { sqlTrouverCollisions } from "./charger-connaissance-sql.mjs";
import { uuidDeterministe } from "./charger-connaissance-socle.mjs";
import { lierParams } from "./remplir-embeddings-sql.mjs";
import { execSocket, lignesSocket } from "./transport-socket.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ECRIRE = process.argv.slice(2).includes("--ecrire");
const VIA_SOCKET = process.argv.slice(2).includes("--socket");
const SORTIE = join(RACINE, "knowledge", ".sortie-chargeur-taylor-v2.json");
const ATTENDUS_V2 = 9344;

const STATUTS_CHUNK_V2 = ["inactive"];
const VERSIONS_CHUNKER_V2 = [TAYLOR_CHUNKER_V2];

/** Vérification RETURNING v2-locale (même sémantique que le chargeur v1). */
export function verifierRetourLotTaylorV2(demandes, retournes) {
  const trier = (l) => [...l].sort();
  const a = trier(demandes.map((d) => {
    if (typeof d !== "string" || d === "") throw new Error("id chunk v2 inattendu (vide)");
    return d;
  }));
  const b = trier(retournes.map((r) => String(r).trim()));
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    throw new Error(`RETURNING v2 inattendu (demandes=${a.length}, retournés=${b.length}) — STOP.`);
  }
}

export function garderLotV2(chunks) {
  for (const ch of chunks) {
    if (!STATUTS_CHUNK_V2.includes(ch.statut)) throw new Error(`statut chunk v2 refusé : ${String(ch.statut).slice(0, 40)}`);
    if (!VERSIONS_CHUNKER_V2.includes(ch.versionChunk)) throw new Error(`découpeur v2 refusé : ${String(ch.versionChunk).slice(0, 40)}`);
    if (ch.langue !== "en") throw new Error(`langue chunk v2 inattendue : ${String(ch.langue).slice(0, 20)}`);
    if (typeof ch.unit_id !== "string" || ch.unit_id === "") throw new Error("lignée v2 incomplète : unit_id");
    if (typeof ch.parent_texte_hash !== "string" || ch.parent_texte_hash === "") throw new Error("lignée v2 incomplète : parent_texte_hash");
    if (!Number.isInteger(ch.enfant_index) || ch.enfant_index < 0) throw new Error("lignée v2 incomplète : enfant_index");
    if (!Number.isInteger(ch.enfants_total) || ch.enfants_total < 1) throw new Error("lignée v2 incomplète : enfants_total");
    if (!Number.isInteger(ch.occurrence) || ch.occurrence < 0) throw new Error(`occurrence invalide : ${String(ch.chunkId).slice(0, 12)}`);
  }
}

export function executerChargeurTaylorV2(racine, { ecrire, viaSocket }) {
  const sec = dryRunTaylorV2(racine);
  if (sec.chunks_v2 !== ATTENDUS_V2) throw new Error(`compte v2 inattendu : ${sec.chunks_v2} !== ${ATTENDUS_V2} — STOP`);
  if (sec.determinisme_ids !== true || sec.jointures_verbatim_ko !== 0) {
    throw new Error("dry-run v2 non déterministe ou jointure inexacte — STOP");
  }
  const sourceUuid = uuidDeterministe(
    "maudsley-prescribing-guidelines-2021-taylor-14e:sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0",
  );
  // Source existante exigée (jamais créée ni modifiée ici).
  const src = lignesSocket(racine, {
    texte: "SELECT statut, (approved_at IS NULL)::text AS na, (approved_by IS NULL)::text AS nb FROM app.knowledge_sources WHERE id = $1::uuid",
    params: [sourceUuid],
  });
  const [statutSrc, naSrc, nbSrc] = (src[0] ?? "").split("|");
  if (statutSrc !== "reviewed" || naSrc !== "true" || nbSrc !== "true") {
    throw new Error(`source corpus-taylor inattendue (statut=${statutSrc}) — STOP (quarantaine exigée).`);
  }
  const base = join(racine, "knowledge", "canonical-v2", "maudsley-prescribing-guidelines-2021-taylor-14e",
    "sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0", "units.jsonl");
  const unites = readFileSync(base, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const { gardees, epurees } = filtrerUnitesSuresTaylor(racine, unites);
  const ctx = { sourceUuid, version: sec.version, langue: "en" };
  const { chunks } = chunksDepuisUnitesTaylorV2(racine, gardees, ctx);
  if (chunks.length !== ATTENDUS_V2) throw new Error(`divergence dry-run/chargeur v2 : ${chunks.length} — STOP`);
  garderLotV2(chunks);

  const rapport = {
    outil: "charger-connaissance-taylor-v2.mjs",
    ecrire,
    source_id: sourceUuid,
    chunker: TAYLOR_CHUNKER_V2,
    langue: "en",
    statut: "reviewed",
    approbation: "en-attente",
    unites_totales: unites.length,
    unites_epurees: epurees.map((e) => e.id),
    chunks: chunks.length,
    ecrits: { sources: 0, chunks: 0 },
  };
  writeFileSync(SORTIE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
  if (!ecrire) {
    console.log("charger-connaissance-taylor-v2 — DRY-RUN (zero ecriture)");
    console.log(`  chunks   : ${chunks.length} [${TAYLOR_CHUNKER_V2}, inactifs, lignée D3-A]`);
    console.log(`  approbation : en-attente — ecrits sources=0 chunks=0`);
    return rapport;
  }
  if (!viaSocket) {
    console.error("ROUGE — --ecrire exige --socket (superuser local mc-p3). Rien n'a ete ecrit.");
    process.exit(1);
  }
  const collisions = lignesSocket(racine, { texte: sqlTrouverCollisions(), params: [chunks.map((ch) => ch.chunkId), sourceUuid] });
  if (collisions.length > 0) throw new Error(`collision inter-sources : ${collisions.length} id(s) existent deja — STOP`);
  const etapes = [];
  const preuves = [];
  for (let i = 0; i < chunks.length; i += 400) {
    const lot = chunks.slice(i, i + 400);
    const valeurs = [];
    const params = [];
    lot.forEach((ch, j) => {
      const b = j * 14;
      valeurs.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},NULL,$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},NULL,NULL,NULL,NULL,NULL,NULL,$${b + 11},$${b + 12},$${b + 13},$${b + 14})`);
      params.push(
        ch.chunkId, sourceUuid, ch.ordinal, ch.section, ch.langue, ch.texte, ch.texteHash,
        ch.occurrence, ch.statut, ch.versionChunk,
        ch.unit_id, ch.parent_texte_hash, ch.enfant_index, ch.enfants_total,
      );
    });
    etapes.push({
      texte: [
        "INSERT INTO app.knowledge_chunks",
        "(id, source_id, ordinal, section, sous_section, langue, texte,",
        "texte_hash, occurrence, statut, chunker_version,",
        "embedding, embedding_provider, embedding_modele, embedding_version,",
        "embedding_dimensions, embedding_normalisation,",
        "unit_id, parent_texte_hash, enfant_index, enfants_total)",
        "VALUES " + valeurs.join(","),
        "ON CONFLICT (id) DO UPDATE SET",
        "ordinal = EXCLUDED.ordinal, section = EXCLUDED.section,",
        "texte = EXCLUDED.texte,",
        "texte_hash = EXCLUDED.texte_hash, occurrence = EXCLUDED.occurrence,",
        "statut = EXCLUDED.statut, chunker_version = EXCLUDED.chunker_version,",
        "unit_id = EXCLUDED.unit_id, parent_texte_hash = EXCLUDED.parent_texte_hash,",
        "enfant_index = EXCLUDED.enfant_index, enfants_total = EXCLUDED.enfants_total",
        "RETURNING id",
      ].join("\n"),
      params,
    });
    preuves.push(lot.map((ch) => ch.chunkId));
    rapport.ecrits.chunks += lot.length;
  }
  const script = ["BEGIN;"]
    .concat(etapes.map((e) => lierParams(e.texte, e.params) + ";"))
    .concat([`DO $$ BEGIN IF (SELECT count(*)::int FROM app.knowledge_sources WHERE id = ANY(${lierParams("$1", [[sourceUuid]])}) AND statut = 'active') <> 0 THEN RAISE EXCEPTION 'garde Taylor v2 : source active — rollback' USING ERRCODE = 'check_violation'; END IF; END $$;`])
    .concat(["COMMIT;"]).join("\n");
  let sortie;
  try {
    sortie = execSocket(racine, script);
  } catch (err) {
    try {
      execSocket(racine, "ROLLBACK;");
    } catch {
      /* session morte : rollback implicite à la déconnexion */
    }
    throw err;
  }
  const retournes = sortie.trim() === "" ? [] : sortie.split("\n").map((l) => l.trim()).filter(Boolean);
  let curseur = 0;
  for (const demandes of preuves) {
    verifierRetourLotTaylorV2(demandes, retournes.slice(curseur, curseur + demandes.length));
    curseur += demandes.length;
  }
  if (curseur !== retournes.length) {
    throw new Error(`RETURNING inattendu (attendus=${curseur}, retournés=${retournes.length}) — STOP.`);
  }
  writeFileSync(SORTIE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
  console.log(`charger-connaissance-taylor-v2 — QUARANTAINE (socket) : sources=${rapport.ecrits.sources} chunks=${rapport.ecrits.chunks} (active=0, preuves RETURNING ok)`);
  return rapport;
}

const lanceDirectTaylorV2 = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (lanceDirectTaylorV2) {
  const res = executerChargeurTaylorV2(RACINE, { ecrire: ECRIRE, viaSocket: VIA_SOCKET });
  if (res instanceof Promise) await res;
}
