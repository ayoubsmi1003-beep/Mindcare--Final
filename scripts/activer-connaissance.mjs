#!/usr/bin/env node
/** R3 — Acte gouverne d'activation du corpus (quarantaine -> actif).
 *
 * AUCUNE activation sans `--autoriser` + `--approbateur <uuid>` explicites.
 * L'approbateur doit exister dans app.profiles et etre actif (jamais invente).
 * Transaction unique : BEGIN…COMMIT via --socket (docker exec mc-p3),
 * ON_ERROR_STOP, preuve par RETURNING, audit dans audit.log. Echec ferme :
 * ROLLBACK, zero activation partielle. Idempotent : source deja active avec
 * le meme approbateur et le meme hash => succes sans ecriture.
 *
 * Eligibilite stricte : source reviewed + C4 + hash exact + jamais approuvee
 * + jamais remplacee ; chunks inactifs, version allowlistee, texte non vide,
 * zero marqueur patient (revérifie en JS, jamais d'activation de suspect).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MARQUEURS_PATIENT, uuidDeterministe } from "./charger-connaissance-socle.mjs";
import { execSocket, lignesSocket } from "./transport-socket.mjs";

export const VERSIONS_CHUNK_ACTIVABLES = ["struct-v1", "struct-v1.1", "struct-v2"];
export const STATUTS_SOURCE_ACTIVABLES = ["reviewed"];

export function sqlVerifierApprobateur() {
  return `SELECT id, role, is_active FROM app.profiles WHERE id = $1 AND is_active = true`;
}

export function sqlVerifierSource() {
  return `SELECT id, titre, version, statut, classification, approved_at, approved_by,
    reviewed_by, reviewed_at, review_due_at, superseded_by, contenu_hash, emetteur
    FROM app.knowledge_sources WHERE id = $1 FOR UPDATE`;
}

export function sqlListerChunks() {
  return `SELECT id, texte, chunker_version, statut FROM app.knowledge_chunks
    WHERE source_id = $1 AND statut = 'inactive' ORDER BY id`;
}

export function sqlActiverSource() {
  return `UPDATE app.knowledge_sources
    SET statut = 'active', approved_at = now(), approved_by = $2,
      reviewed_by = $4, reviewed_at = now(), review_due_at = $5
    WHERE id = $1
      AND statut = 'reviewed'
      AND classification = 'C4'
      AND contenu_hash = $3
      AND approved_at IS NULL
      AND approved_by IS NULL
      AND superseded_by IS NULL
    RETURNING id`;
}

export function sqlActiverChunks() {
  return `UPDATE app.knowledge_chunks
    SET statut = 'active'
    WHERE source_id = $1
      AND statut = 'inactive'
      AND chunker_version = ANY ($3)
      AND NULLIF(btrim(texte), '') IS NOT NULL
      AND id = ANY ($2)
    RETURNING id`;
}

export function sqlAuditActivation() {
  return `INSERT INTO audit.log
    (actor_id, actor_role, operation, table_name, row_id, changed_fields, old_values, new_values)
    VALUES ($1, $2, 'update', $3, $4, $5, $6, $7)`;
}

function args(argv) {
  const o = { autoriser: false, approbateur: "", sources: [], tout: false,
    manifeste: "", sortie: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--autoriser") o.autoriser = true;
    else if (a === "--tout") o.tout = true;
    else if (a === "--approbateur" && argv[i + 1]) { i++; o.approbateur = argv[i]; }
    else if (a.startsWith("--approbateur=")) o.approbateur = a.slice(15);
    else if (a === "--source" && argv[i + 1]) { i++; o.sources.push(argv[i]); }
    else if (a.startsWith("--source=")) o.sources.push(a.slice(9));
    else if (a === "--manifeste" && argv[i + 1]) { i++; o.manifeste = argv[i]; }
    else if (a.startsWith("--manifeste=")) o.manifeste = a.slice(12);
    else if (a === "--sortie" && argv[i + 1]) { i++; o.sortie = argv[i]; }
    else if (a.startsWith("--sortie=")) o.sortie = a.slice(9);
  }
  return o;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function principal() {
  const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const opt = args(process.argv.slice(2));
  if (!opt.autoriser) {
    console.error("ROUGE — activation exige --autoriser explicite. Rien n'a ete ecrit.");
    process.exit(1);
  }
  if (!UUID_RE.test(opt.approbateur)) {
    console.error("ROUGE — --approbateur <uuid> valide exige. Rien n'a ete ecrit.");
    process.exit(1);
  }
  if (!opt.tout && opt.sources.length === 0) {
    console.error("ROUGE — preciser --source <id> (repetable) ou --tout. Rien n'a ete ecrit.");
    process.exit(1);
  }
  const manifeste = JSON.parse(readFileSync(opt.manifeste || join(RACINE, "knowledge", "manifest.json"), "utf8"));
  const sortiePath = opt.sortie || join(RACINE, "knowledge", ".sortie-activation.json");
  let preuveQuarantaine = { acceptes: [] };
  try {
    preuveQuarantaine = JSON.parse(readFileSync(join(RACINE, "knowledge", ".sortie-chargeur.json"), "utf8"));
  } catch {
    console.error("ROUGE — preuve de quarantaine absente (.sortie-chargeur.json) : charger d'abord. Rien n'a ete ecrit.");
    process.exit(1);
  }
  const hashQuarantaine = new Map((preuveQuarantaine.acceptes ?? []).map((a) => [a.source_id, a.hash]));
  const rapport = { approbateur: opt.approbateur, activees: [], deja_actives: [], rejets: [] };

  const lignesApprobateur = lignesSocket(RACINE, { texte: sqlVerifierApprobateur(), params: [opt.approbateur] });
  if (lignesApprobateur.length !== 1) {
    console.error("ROUGE — approbateur introuvable ou inactif dans app.profiles. Rien n'a ete ecrit.");
    process.exit(1);
  }
  const roleApprobateur = lignesApprobateur[0].split("|")[1] ?? "";

  const entrees = [...(manifeste.sources ?? [])].filter((e) =>
    opt.tout ? STATUTS_SOURCE_ACTIVABLES.includes(e.statut) : opt.sources.includes(e.source_id));
  if (entrees.length === 0) {
    console.error("ROUGE — aucune source eligible dans le manifeste. Rien n'a ete ecrit.");
    process.exit(1);
  }

  const script = ["BEGIN;"];
  const preuves = [];
  for (const e of entrees) {
    const sourceUuid = uuidDeterministe(`m07-r1|${e.source_id}|${e.version}`);
    const lignes = lignesSocket(RACINE, { texte: sqlVerifierSource(), params: [sourceUuid] });
    if (lignes.length !== 1) {
      rapport.rejets.push({ source_id: e.source_id, motif: "source-absente-base" });
      continue;
    }
    const r = lignes[0].split("|");
    const [id, , version, statut, classification, approvedAt, approvedBy, , , reviewDue, superseded, hash] = r;
    if (statut === "active" && approvedBy === opt.approbateur && hash === hashQuarantaine.get(e.source_id)) {
      rapport.deja_actives.push({ source_id: e.source_id });
      continue;
    }
    if (statut !== "reviewed" || classification !== "C4" || approvedAt !== "" || approvedBy !== "" || (superseded ?? "") !== "") {
      rapport.rejets.push({ source_id: e.source_id, motif: "source-non-eligible" });
      continue;
    }
    if (version !== e.version) {
      rapport.rejets.push({ source_id: e.source_id, motif: "version-differente" });
      continue;
    }
    if (hash !== hashQuarantaine.get(e.source_id)) {
      rapport.rejets.push({ source_id: e.source_id, motif: "hash-different" });
      continue;
    }
    const attendus = lignesSocket(RACINE, { texte: sqlListerChunks(), params: [sourceUuid] });
    if (attendus.length === 0) {
      rapport.rejets.push({ source_id: e.source_id, motif: "aucun-chunk-inactif" });
      continue;
    }
    const ids = [];
    for (const l of attendus) {
      const [cid, texte] = l.split("|");
      if ((texte ?? "").trim() === "") {
        rapport.rejets.push({ source_id: e.source_id, motif: "chunk-vide", chunk: cid });
        ids.length = 0;
        break;
      }
      if (MARQUEURS_PATIENT.some((re) => re.test(texte))) {
        rapport.rejets.push({ source_id: e.source_id, motif: "contenu-patient-suspect", chunk: cid });
        ids.length = 0;
        break;
      }
      ids.push(cid);
    }
    if (ids.length === 0) continue;
    const revueDue = e.review_due_at ?? reviewDue ?? null;
    script.push(
      `UPDATE app.knowledge_sources SET statut = 'active', approved_at = now(), approved_by = '${opt.approbateur}', reviewed_by = '${opt.approbateur}', reviewed_at = now(), review_due_at = ${revueDue === null ? "NULL" : `'${revueDue}'::timestamptz`} WHERE id = '${id}' AND statut = 'reviewed' AND classification = 'C4' AND approved_at IS NULL AND approved_by IS NULL AND superseded_by IS NULL;`,
      `UPDATE app.knowledge_chunks SET statut = 'active' WHERE source_id = '${id}' AND statut = 'inactive' AND chunker_version = ANY (ARRAY['struct-v1','struct-v1.1','struct-v2','taylor-units-v2-candidate']) AND NULLIF(btrim(texte), '') IS NOT NULL;`,
      `INSERT INTO audit.log (actor_id, actor_role, operation, table_name, row_id, changed_fields, old_values, new_values) VALUES ('${opt.approbateur}', '${roleApprobateur}', 'update', 'app.knowledge_sources', '${id}', ARRAY['statut','approved_at','approved_by','reviewed_by','reviewed_at'], '{"statut":"reviewed"}', '{"statut":"active","chunks":${ids.length}}');`,
    );
    preuves.push({ source_id: e.source_id, id, chunks: ids.length });
  }
  if (rapport.rejets.length > 0) {
    console.error(`ROUGE — rejets : ${rapport.rejets.map((r) => `${r.source_id}:${r.motif}`).join(", ")}. Rien n'a ete ecrit.`);
    process.exit(1);
  }
  script.push("COMMIT;");
  execSocket(RACINE, script.join("\n"));
  rapport.activees = preuves;
  writeFileSync(sortiePath, JSON.stringify(rapport, null, 2) + "\n", "utf8");
  console.log(`activation — sources=${preuves.length} deja_actives=${rapport.deja_actives.length} (transaction, audit ok)`);
}

const EST_CLI = (process.argv[1] ?? "").endsWith("activer-connaissance.mjs");
if (EST_CLI) {
  principal().catch((err) => {
    try {
      execSocket(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "ROLLBACK;");
    } catch { /* session morte : rollback implicite */ }
    console.error(`ROUGE — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
