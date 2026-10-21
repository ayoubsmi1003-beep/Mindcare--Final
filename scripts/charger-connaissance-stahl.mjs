#!/usr/bin/env node
/**
 * charger-connaissance-stahl — ÉCRITURE en QUARANTAINE (source + chunks).
 *
 *   node scripts/charger-connaissance-stahl.mjs                (dry-run)
 *   node scripts/charger-connaissance-stahl.mjs --ecrire --socket
 *
 * Portee : source `stahl-prescribers-guide-7e-cup` UNIQUEMENT.
 * - DRY-RUN par defaut ; `--ecrire` + `--socket` (superuser local mc-p3) ;
 * - transaction mono-script BEGIN…COMMIT, ON_ERROR_STOP, preuve RETURNING ;
 * - la source est creee `reviewed` (jamais `active`), les chunks `inactive` ;
 * - garde anti-collision inter-sources AVANT tout INSERT ;
 * - garde anti-activation finale en DO-block (raise AVANT commit) ;
 * - ⚠️ UPSERT NON RETROGRADEUR : `statut` n'est écrit QUE s'il est
 *   'inactive' ; un chunk deja 'active' (apres activation) n'est JAMAIS
 *   repousse en 'inactive'. C'est la correction du piege latent des
 *   chargeurs DSM/Taylor (rejouer le chargeur apres activation effacait
 *   les chunks actifs de la source). Le depot n'est pas modifie.
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOOK_ID, CHUNKER_VERSION, SOURCE_UUID, VERSION,
  construireChunks, dryRunStahl, titreSource,
} from "./charger-connaissance-corpus-stahl.mjs";
import { sqlTrouverCollisions } from "./charger-connaissance-sql.mjs";
import { sha256Hex } from "./charger-connaissance-socle.mjs";
import { lierParams } from "./remplir-embeddings-sql.mjs";
import { execSocket, lignesSocket } from "./transport-socket.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ECRIRE = process.argv.slice(2).includes("--ecrire");
const VIA_SOCKET = process.argv.slice(2).includes("--socket");
const SORTIE = join(RACINE, "knowledge", ".sortie-chargeur-stahl.json");

const TAILLE_LOT = 400;

function sqlSource() {
  return `INSERT INTO app.knowledge_sources
    (id, cabinet_id, titre, version, langue, classification, statut,
     approved_at, approved_by, reviewed_by, reviewed_at, review_due_at,
     superseded_by, emetteur, reference_origine, contenu_hash)
   VALUES ($1, NULL, $2, $3, $4, 'C4', 'reviewed',
     NULL, NULL, NULL, NULL, $5::timestamptz,
     NULL, $6, $7, $8)
   ON CONFLICT (id) DO UPDATE SET
     titre = EXCLUDED.titre, version = EXCLUDED.version,
     langue = EXCLUDED.langue, review_due_at = EXCLUDED.review_due_at,
     emetteur = EXCLUDED.emetteur, reference_origine = EXCLUDED.reference_origine,
     contenu_hash = EXCLUDED.contenu_hash`;
}

function sqlChunk(valeurs) {
  return `INSERT INTO app.knowledge_chunks
    (id, source_id, ordinal, section, sous_section, langue, texte,
     texte_hash, occurrence, statut, chunker_version,
     embedding, embedding_provider, embedding_modele, embedding_version,
     embedding_dimensions, embedding_normalisation,
     unit_id, parent_texte_hash, enfant_index, enfants_total)
   VALUES ${valeurs.join(",")}
   ON CONFLICT (id) DO UPDATE SET
     ordinal = EXCLUDED.ordinal, section = EXCLUDED.section,
     sous_section = EXCLUDED.sous_section,
     texte = EXCLUDED.texte, texte_hash = EXCLUDED.texte_hash,
     occurrence = EXCLUDED.occurrence, chunker_version = EXCLUDED.chunker_version,
     unit_id = EXCLUDED.unit_id, parent_texte_hash = EXCLUDED.parent_texte_hash,
     enfant_index = EXCLUDED.enfant_index, enfants_total = EXCLUDED.enfants_total,
     statut = CASE WHEN app.knowledge_chunks.statut = 'active' THEN 'active' ELSE 'inactive' END
   RETURNING id`;
}

export function executerChargeurStahl(racine, { ecrire, viaSocket }) {
  const sec = dryRunStahl();
  const chunks = construireChunks();
  const titre = titreSource();
  const contenuHash = sha256Hex(chunks.map((c) => c.chunkId).join("\n"));

  // Garde : la source doit etre inexistante ou deja en quarantaine.
  const src = lignesSocket(racine, {
    texte: "SELECT statut, (approved_at IS NULL)::text AS na, (approved_by IS NULL)::text AS nb FROM app.knowledge_sources WHERE id = $1::uuid",
    params: [SOURCE_UUID],
  });
  const [statutSrc, naSrc, nbSrc] = (src[0] ?? "").split("|");
  if (src.length > 0 && (statutSrc !== "reviewed" || naSrc !== "true" || nbSrc !== "true")) {
    throw new Error(`source Stahl inattendue (statut=${statutSrc}) — STOP (quarantaine exigee).`);
  }

  const rapport = {
    outil: "charger-connaissance-stahl.mjs",
    ecrire,
    source_id: SOURCE_UUID,
    titre,
    version: VERSION,
    chunker: CHUNKER_VERSION,
    langue: "en",
    statut: "reviewed",
    approbation: "en-attente",
    chunks: chunks.length,
    contenu_hash: contenuHash,
    ecrits: { sources: 0, chunks: 0 },
  };
  writeFileSync(SORTIE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
  if (!ecrire) {
    console.log("charger-connaissance-stahl — DRY-RUN (zero ecriture)");
    console.log(`  source  : ${SOURCE_UUID}`);
    console.log(`  titre   : ${titre}`);
    console.log(`  chunks  : ${chunks.length} [${CHUNKER_VERSION}, inactifs]`);
    console.log(`  ecrits  : sources=${rapport.ecrits.sources} chunks=${rapport.ecrits.chunks}`);
    return rapport;
  }
  if (!viaSocket) {
    console.error("ROUGE — --ecrire exige --socket (superuser local mc-p3). Rien n'a ete ecrit.");
    process.exit(1);
  }

  const collisions = lignesSocket(racine, {
    texte: sqlTrouverCollisions(),
    params: [chunks.map((c) => c.chunkId), SOURCE_UUID],
  });
  if (collisions.length > 0) {
    throw new Error(`collision inter-sources : ${collisions.length} id(s) existent deja — STOP`);
  }

  const etapes = [];
  const preuves = [];
  etapes.push({
    texte: sqlSource(),
    params: [
      SOURCE_UUID, titre, VERSION, "en",
      new Date(Date.now() + 120 * 86400_000).toISOString(),
      "Cambridge University Press",
      `Books/prescribers-guide-stahls-essential-psychopharmacology.pdf (${BOOK_ID})`,
      contenuHash,
    ],
  });
  rapport.ecrits.sources = 1;

  for (let i = 0; i < chunks.length; i += TAILLE_LOT) {
    const lot = chunks.slice(i, i + TAILLE_LOT);
    const valeurs = [];
    const params = [];
    lot.forEach((ch, j) => {
      const b = j * 14;
      valeurs.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},'inactive',$${b + 10},NULL,NULL,NULL,NULL,NULL,NULL,$${b + 11},$${b + 12},$${b + 13},$${b + 14})`);
      params.push(
        ch.chunkId, ch.sourceUuid, ch.ordinal, ch.section, ch.sousSection, ch.langue,
        ch.texte, ch.texteHash, ch.occurrence, ch.versionChunk,
        ch.unit_id, ch.parent_texte_hash, ch.enfant_index, ch.enfants_total,
      );
    });
    etapes.push({ texte: sqlChunk(valeurs), params });
    preuves.push(lot.map((ch) => ch.chunkId));
    rapport.ecrits.chunks += lot.length;
  }

  const script = ["BEGIN;"]
    .concat(etapes.map((e) => `${lierParams(e.texte, e.params)};`))
    .concat([
      `DO $$ BEGIN IF (SELECT count(*)::int FROM app.knowledge_sources WHERE id = '${SOURCE_UUID}'::uuid AND statut = 'active') <> 0 THEN RAISE EXCEPTION 'garde Stahl : source active — rollback' USING ERRCODE = 'check_violation'; END IF; END $$;`,
    ])
    .concat(["COMMIT;"]).join("\n");

  let sortie;
  try {
    sortie = execSocket(racine, script);
  } catch (err) {
    try { execSocket(racine, "ROLLBACK;"); } catch { /* session morte */ }
    throw err;
  }
  const retournes = sortie.trim() === "" ? [] : sortie.split("\n").map((l) => l.trim()).filter(Boolean);
  let curseur = 0;
  for (const demandes of preuves) {
    const attendu = demandes.slice().sort();
    const obtenu = retournes.slice(curseur, curseur + demandes.length).slice().sort();
    if (attendu.length !== obtenu.length || attendu.some((v, k) => v !== obtenu[k])) {
      throw new Error(`RETURNING inattendu (demandes=${attendu.length}, obtenus=${obtenu.length}) — STOP`);
    }
    curseur += demandes.length;
  }
  if (curseur !== retournes.length) {
    throw new Error(`RETURNING inattendu (attendus=${curseur}, recus=${retournes.length}) — STOP`);
  }
  writeFileSync(SORTIE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
  console.log(`charger-connaissance-stahl — QUARANTAINE (socket) : sources=${rapport.ecrits.sources} chunks=${rapport.ecrits.chunks} (active=0, preuves RETURNING ok)`);
  return rapport;
}

const lanceDirect = process.argv[1] !== undefined
  && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (lanceDirect) {
  executerChargeurStahl(RACINE, { ecrire: ECRIRE, viaSocket: VIA_SOCKET });
}
