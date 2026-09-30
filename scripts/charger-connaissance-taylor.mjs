#!/usr/bin/env node
/** M08-Taylor : chargeur quarantaine corpus-taylor.
 *
 * DRY-RUN par défaut ; `--ecrire --socket` écrit via `docker exec mc-p3`
 * (transport superuser local, même convention que charger-connaissance.mjs :
 * transaction mono-script BEGIN…COMMIT, ON_ERROR_STOP, preuve par RETURNING).
 *
 * Portée Taylor uniquement. Réutilise les builders du dry-run Gate-C
 * (scripts/charger-connaissance-corpus-taylor.mjs) : les chunkIds écrits sont
 * bit-identiques à ceux du dry-run (7 859 attendus, sinon STOP).
 *
 * Garde-fous (throw AVANT tout SQL) :
 * - entrée `reviewed` exigée, jamais `active` (activation interdite ici) ;
 * - chunks `inactive` UNIQUEMENT, `taylor-units-v1-proposed` UNIQUEMENT
 *   (listes fermées Taylor ; D4 reste ouvert — aucune promotion sous provisoire) ;
 * - approbation `en-attente` (approved_* NULL par construction sqlSource) ;
 * - garde anti-collision inter-sources (ids existant sous une autre source → STOP) ;
 * - garde anti-active finale en DO-block (raise AVANT commit).
 *
 * Usage :
 *   node scripts/charger-connaissance-taylor.mjs --dry-run
 *   node scripts/charger-connaissance-taylor.mjs --ecrire --socket
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chunksDepuisUnitesTaylor,
  dryRunTaylor,
  entreeTaylor,
  filtrerUnitesSuresTaylor,
  TAYLOR_CHUNKER_PROPOSE,
  TAYLOR_SOURCE_SHA,
} from "./charger-connaissance-corpus-taylor.mjs";
import { sqlSource, sqlTrouverCollisions } from "./charger-connaissance-sql.mjs";
import { uuidDeterministe } from "./charger-connaissance-socle.mjs";
import { lierParams } from "./remplir-embeddings-sql.mjs";
import { execSocket, lignesSocket } from "./transport-socket.mjs";

/** Vérification RETURNING Taylor-locale : même sémantique d'égalité d'ensembles
 * que verifierRetourLot, sans la restriction de préfixe d'id (le vérificateur
 * partagé n'accepte que `[0-9a-f]{8}` / `dsm5-*` — on ne l'assouplit pas pour
 * les autres corpus ; ids Taylor `taylor-[0-9a-f]{8}`, non vides, exacts). */
export function verifierRetourLotTaylor(demandes, retournes) {
  const trier = (l) => [...l].sort();
  const a = trier(demandes.map((d) => {
    if (typeof d !== "string" || d === "") throw new Error("id chunk Taylor inattendu (vide)");
    return d;
  }));
  const b = trier(retournes.map((r) => String(r).trim()));
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    throw new Error(`RETURNING Taylor inattendu (demandes=${a.length}, retournés=${b.length}) — STOP.`);
  }
}

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ECRIRE = process.argv.slice(2).includes("--ecrire");
const VIA_SOCKET = process.argv.slice(2).includes("--socket");
const SORTIE = join(RACINE, "knowledge", ".sortie-chargeur-taylor.json");
const REVIEW_DUE_AT = "2026-12-15";

const STATUTS_CHUNK_TAYLOR = ["inactive"];
const VERSIONS_CHUNKER_TAYLOR = [TAYLOR_CHUNKER_PROPOSE];

function lireUnites(racine) {
  const chemin = join(racine, "knowledge", "canonical-v2", "maudsley-prescribing-guidelines-2021-taylor-14e", `sha256-${TAYLOR_SOURCE_SHA}`, "units.jsonl");
  return readFileSync(chemin, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function ctxTaylor(entree) {
  return {
    sourceUuid: uuidDeterministe(`maudsley-prescribing-guidelines-2021-taylor-14e:sha256:${TAYLOR_SOURCE_SHA}`),
    version: entree.version,
    langue: "en",
  };
}

export function garderLot(chunks) {
  for (const ch of chunks) {
    if (!STATUTS_CHUNK_TAYLOR.includes(ch.statut)) throw new Error(`statut chunk Taylor refusé : ${String(ch.statut).slice(0, 40)}`);
    if (!VERSIONS_CHUNKER_TAYLOR.includes(ch.versionChunk)) throw new Error(`découpeur Taylor refusé : ${String(ch.versionChunk).slice(0, 40)}`);
    if (!Number.isInteger(ch.occurrence) || ch.occurrence < 0) throw new Error(`occurrence invalide : ${String(ch.chunkId).slice(0, 12)}`);
    if (ch.langue !== "en") throw new Error(`langue chunk Taylor inattendue : ${String(ch.langue).slice(0, 20)}`);
  }
}

export function executerChargeurTaylor(racine, { ecrire, viaSocket }) {
const sec = dryRunTaylor(racine);
const entree = entreeTaylor(RACINE);
if (entree.statut === "active") throw new Error("activation interdite : statut source actif");
if (entree.langue !== "en") throw new Error(`langue Taylor inattendue : ${entree.langue}`);
const unites = lireUnites(RACINE);
const { gardees, epurees } = filtrerUnitesSuresTaylor(RACINE, unites);
const ctx = ctxTaylor(entree);
const chunks = chunksDepuisUnitesTaylor(RACINE, gardees, ctx);
garderLot(chunks);
if (chunks.length !== sec.chunks_acceptes) {
  throw new Error(`divergence dry-run/chargeur : ${chunks.length} !== ${sec.chunks_acceptes} — STOP`);
}

const rapport = {
  outil: "charger-connaissance-taylor.mjs",
  ecrire,
  source_id: "corpus-taylor",
  titre: entree.titre,
  version: entree.version,
  langue: entree.langue,
  statut: "reviewed",
  approbation: "en-attente",
  unites_totales: unites.length,
  unites_epurees: epurees.map((e) => e.id),
  chunks: chunks.length,
  ecrits: { sources: 0, chunks: 0 },
};
writeFileSync(SORTIE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
if (!ecrire) {
  console.log("charger-connaissance-taylor — DRY-RUN (zero ecriture)");
  console.log(`  source   : corpus-taylor — ${entree.titre}`);
  console.log(`  langue   : en — version ${entree.version}`);
  console.log(`  unites   : ${unites.length} (epurees=${epurees.length})`);
  console.log(`  chunks   : ${chunks.length} [${TAYLOR_CHUNKER_PROPOSE}, inactifs]`);
  console.log(`  approbation : en-attente — ecrits sources=0 chunks=0`);
  process.exit(0);
}
if (!viaSocket) {
  console.error("ROUGE — --ecrire exige --socket (superuser local mc-p3). Rien n'a ete ecrit.");
  process.exit(1);
}
const collisions = lignesSocket(RACINE, { texte: sqlTrouverCollisions(), params: [chunks.map((ch) => ch.chunkId), ctx.sourceUuid] });
if (collisions.length > 0) throw new Error(`collision inter-sources : ${collisions.length} id(s) existent deja — STOP`);
const etapes = [{
  texte: sqlSource(),
  params: [ctx.sourceUuid, entree.titre, entree.version, entree.langue, "reviewed", REVIEW_DUE_AT, entree.provenance.emetteur, entree.provenance.reference, entree.hashContenu],
}];
rapport.ecrits.sources += 1;
const preuves = [];
for (let i = 0; i < chunks.length; i += 400) {
  const lot = chunks.slice(i, i + 400);
  const valeurs = [];
  const params = [];
  lot.forEach((ch, j) => {
    const b = j * 10;
    valeurs.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},NULL,$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},NULL,NULL,NULL,NULL,NULL,NULL)`);
    params.push(ch.chunkId, ctx.sourceUuid, ch.ordinal, ch.section, ch.langue, ch.texte, ch.texteHash, ch.occurrence, ch.statut, ch.versionChunk);
  });
  etapes.push({
    texte: [
      "INSERT INTO app.knowledge_chunks",
      "(id, source_id, ordinal, section, sous_section, langue, texte,",
      "texte_hash, occurrence, statut, chunker_version,",
      "embedding, embedding_provider, embedding_modele, embedding_version,",
      "embedding_dimensions, embedding_normalisation)",
      "VALUES " + valeurs.join(","),
      "ON CONFLICT (id) DO UPDATE SET",
      "ordinal = EXCLUDED.ordinal, section = EXCLUDED.section,",
      "texte = EXCLUDED.texte,",
      "texte_hash = EXCLUDED.texte_hash, occurrence = EXCLUDED.occurrence,",
      "statut = EXCLUDED.statut, chunker_version = EXCLUDED.chunker_version",
      "RETURNING id",
    ].join("\n"),
    params,
  });
  preuves.push(lot.map((ch) => ch.chunkId));
  rapport.ecrits.chunks += lot.length;
}
const script = ["BEGIN;"]
  .concat(etapes.map((e) => lierParams(e.texte, e.params) + ";"))
  .concat([`DO $$ BEGIN IF (SELECT count(*)::int FROM app.knowledge_sources WHERE id = ANY(${lierParams("$1", [[ctx.sourceUuid]])}) AND statut = 'active') <> 0 THEN RAISE EXCEPTION 'garde Taylor : source active — rollback' USING ERRCODE = 'check_violation'; END IF; END $$;`])
  .concat(["COMMIT;"]).join("\n");
let sortie;
try {
  sortie = execSocket(RACINE, script);
} catch (err) {
  try {
    execSocket(RACINE, "ROLLBACK;");
  } catch {
    /* session morte : rollback implicite à la déconnexion */
  }
  throw err;
}
const retournes = sortie.trim() === "" ? [] : sortie.split("\n").map((l) => l.trim()).filter(Boolean);
let curseur = 0;
for (const demandes of preuves) {
  verifierRetourLotTaylor(demandes, retournes.slice(curseur, curseur + demandes.length));
  curseur += demandes.length;
}
if (curseur !== retournes.length) {
  throw new Error(`RETURNING inattendu (attendus=${curseur}, retournés=${retournes.length}) — STOP.`);
}
writeFileSync(SORTIE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
console.log(`charger-connaissance-taylor — QUARANTAINE (socket) : sources=${rapport.ecrits.sources} chunks=${rapport.ecrits.chunks} (active=0, preuves RETURNING ok)`);
  return rapport;
}

const lanceDirectTaylor = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (lanceDirectTaylor) {
  const res = executerChargeurTaylor(RACINE, { ecrire: ECRIRE, viaSocket: VIA_SOCKET });
  if (res instanceof Promise) await res;
}
