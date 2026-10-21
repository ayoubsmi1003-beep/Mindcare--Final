#!/usr/bin/env node
/**
 * rollback-connaissance-stahl — RETOUR ARRIERE STRICT de l'ingestion Stahl 7e.
 *
 *   node scripts/rollback-connaissance-stahl.mjs              (dry-run, zero ecriture)
 *   node scripts/rollback-connaissance-stahl.mjs --verifier   (execute puis ROLLBACK : preuve)
 *   node scripts/rollback-connaissance-stahl.mjs --ecrire --socket
 *
 * PERIMETRE FERME : uniquement la source Stahl 7e
 *   (source_id = 71587f1-3bf3-5d82-81cf-e40d77dbcfa0).
 *   Aucune autre source, aucun autre chunk, aucune table hors
 *   `app.knowledge_chunks` / `app.knowledge_sources` n'est touchee.
 *
 * CONTEXTE : l'instantane de production du depot
 * (`scripts/snapshot-production.mjs`) REFUSE actuellement de s'executer, parce
 * que 12 migrations `159_alexa_*` a `170_alexa_reminder_context` sont sur le
 * disque sans etre appliquees en base (travail en cours d'une autre
 * session). Le depot refuse a raison : il ne fige pas une base dont l'etat de
 * migration ne correspond pas au disque. D'ou ce retour arriere CIRCONSCRIT
 * et verifiable, plutot qu'un instantane global indisponible.
 *
 * REVERSIBILITE : l'ingestion Stahl n'ecrit QUE
 *   - 1 ligne `app.knowledge_sources` (statut 'reviewed') ;
 *   - 3076 lignes `app.knowledge_chunks` (statut 'inactive') ;
 *   - les 9 colonnes de recette + l'embedding sur ces memes lignes.
 * Aucun livre actif n'est touche ; aucun `audit.log` n'est ecrit ; aucun
 * `DELETE` ne touche une donnee clinique ou financiere (seulement des lignes
 * de connaissance d'un livre non active, jamais consultees par l'Alexa).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execSocket, lignesSocket } from "./transport-socket.mjs";
import { SOURCE_UUID, VERSION } from "./charger-connaissance-corpus-stahl.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const ECRIRE = args.includes("--ecrire");
const VERIFIER = args.includes("--verifier");
const VIA_SOCKET = args.includes("--socket");
const SORTIE = join(RACINE, "knowledge", ".sortie-rollback-stahl.json");
/** Approbateur identifie du retour arriere permanent (requis pour --ecrire). */
const APPROBATEUR = (() => {
  const i = args.indexOf("--approbateur");
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "";
})();

const SQL_SOURCE = "SELECT id, titre, statut, (approved_at IS NULL)::text AS na FROM app.knowledge_sources WHERE id = $1::uuid";
const SQL_CHUNKS = "SELECT count(*)::int, count(*) FILTER (WHERE statut='active')::int, count(embedding)::int FROM app.knowledge_chunks WHERE source_id = $1::uuid";
const SQL_SUPPRESSION = "DELETE FROM app.knowledge_chunks WHERE source_id = $1::uuid";
const SQL_SUPPRESSION_SOURCE = "DELETE FROM app.knowledge_sources WHERE id = $1::uuid AND statut <> 'active'";

const avant = {
  source: lignesSocket(RACINE, { texte: SQL_SOURCE, params: [SOURCE_UUID] })[0] ?? "",
  chunks: lignesSocket(RACINE, { texte: SQL_CHUNKS, params: [SOURCE_UUID] })[0] ?? "0|0|0",
};
const [totalStr, actifsStr, vecteursStr] = avant.chunks.split("|");
const rapport = {
  outil: "rollback-connaissance-stahl.mjs",
  mode: ECRIRE ? "ecriture" : VERIFIER ? "verification (execute puis ROLLBACK)" : "dry-run",
  source_id: SOURCE_UUID,
  version: VERSION,
  avant: {
    source: avant.source,
    chunks_total: Number(totalStr),
    chunks_actifs: Number(actifsStr),
    vecteurs: Number(vecteursStr),
  },
  apres: null,
  ecrit: false,
};

if (!ECRIRE && !VERIFIER) {
  console.log("rollback-connaissance-stahl — DRY-RUN (zero ecriture)");
  console.log(`  source   : ${rapport.avant.source}`);
  console.log(`  chunks   : ${rapport.avant.chunks_total} (actifs=${rapport.avant.chunks_actifs}, vecteurs=${rapport.avant.vecteurs})`);
  console.log("  aucune suppression effectuee");
  process.exit(0);
}

if (!VIA_SOCKET) {
  console.error("ROUGE — --socket exige (superuser local mc-p3). Rien n'a ete ecrit.");
  process.exit(1);
}

// Garde : un livre ACTIF ne doit jamais etre supprime par ce script.
const champsSource = avant.source.split("|");
const statutSource = champsSource[2] ?? "";
// `(approved_at IS NULL)::text` rend 'true'/'false' (et non 't'/'f').
const approvedAtNull = ["t", "true"].includes((champsSource[3] ?? "").toLowerCase());
if (rapport.avant.chunks_actifs > 0 || statutSource !== "reviewed" || !approvedAtNull) {
  console.error(`ROUGE — source Stahl active ou etat inattendu (statut=${statutSource}, `
    + `approved_at_null=${approvedAtNull}, chunks actifs=${rapport.avant.chunks_actifs}) : refus. `
    + "Rien n'a ete ecrit.");
  process.exit(1);
}

// Un retour arriere PERMANENT supprime des donnees : il doit etre trace, donc
// il exige un approbateur identifie et actif (meme regle que l'activation).
// Le mode a blanc et le mode `--verifier` (annule) n'en ont pas besoin : ils
// n'ecrivent rien.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let roleApprobateur = "";
if (ECRIRE) {
  if (!UUID_RE.test(APPROBATEUR)) {
    console.error("ROUGE — --ecrire exige --approbateur <uuid> d'un profil ACTIF. Rien n'a ete ecrit.");
    process.exit(2);
  }
  roleApprobateur = (lignesSocket(RACINE, {
    texte: "SELECT role FROM app.profiles WHERE id = $1::uuid AND is_active = true",
    params: [APPROBATEUR],
  })[0] ?? "").trim();
  if (roleApprobateur === "") {
    console.error("ROUGE — approbateur introuvable ou INACTIF dans app.profiles. Rien n'a ete ecrit.");
    process.exit(1);
  }
}

const script = [
  "BEGIN;",
  `DELETE FROM app.knowledge_chunks WHERE source_id = '${SOURCE_UUID}'::uuid RETURNING id;`,
  `DELETE FROM app.knowledge_sources WHERE id = '${SOURCE_UUID}'::uuid AND statut <> 'active' RETURNING id;`,
  // Trace d'audit du retour arriere PERMANENT : elle est ECrite dans la meme
  // transaction que la suppression, donc elle disparait avec elle en mode
  // `--verifier` (annule). Elle distingue ainsi, dans l'historique, un
  // retour arriere d'une activation.
  ...(ECRIRE && !VERIFIER ? [
    `INSERT INTO audit.log (actor_id, actor_role, operation, table_name, row_id, changed_fields, old_values, new_values) VALUES ('${APPROBATEUR}'::uuid, '${roleApprobateur.replaceAll("'", "''")}', 'delete', 'app.knowledge_chunks', '${SOURCE_UUID}', ARRAY['statut'], '{"statut":"inactive"}', '{"statut":"supprime","chunks":${rapport.avant.chunks_total},"chunker":"stahl-units-v1"}')`,
    `INSERT INTO audit.log (actor_id, actor_role, operation, table_name, row_id, changed_fields, old_values, new_values) VALUES ('${APPROBATEUR}'::uuid, '${roleApprobateur.replaceAll("'", "''")}', 'delete', 'app.knowledge_sources', '${SOURCE_UUID}', ARRAY['statut'], '{"statut":"reviewed"}', '{"statut":"supprime","acte":"retour-arriere-permanent"}')`,
  ] : []),
  VERIFIER ? "ROLLBACK;" : "COMMIT;",
].join("\n");

let sortie;
try {
  sortie = execSocket(RACINE, script);
} catch (err) {
  try { execSocket(RACINE, "ROLLBACK;"); } catch { /* session morte */ }
  console.error(`ROUGE — rollback interrompu : ${String(err.message ?? err).slice(0, 200)}. Aucune ecriture conservee.`);
  process.exit(1);
}
const lignes = sortie.trim() === "" ? [] : sortie.split("\n").map((l) => l.trim()).filter(Boolean);
rapport.lignes_retournees = lignes.length;
rapport.ecrit = ECRIRE && !VERIFIER;

const apres = {
  source: lignesSocket(RACINE, { texte: SQL_SOURCE, params: [SOURCE_UUID] })[0] ?? "",
  chunks: lignesSocket(RACINE, { texte: SQL_CHUNKS, params: [SOURCE_UUID] })[0] ?? "0|0|0",
};
rapport.apres = { source: apres.source, chunks: apres.chunks };
writeFileSync(SORTIE, `${JSON.stringify(rapport, null, 2)}\n`, "utf8");

if (VERIFIER) {
  // Apres ROLLBACK, l'etat doit etre STRICTEMENT IDENTIQUE a l'etat initial.
  const [at, aa, av] = apres.chunks.split("|");
  const identique =
    apres.source === avant.source &&
    Number(at) === Number(totalStr) &&
    Number(aa) === Number(actifsStr) &&
    Number(av) === Number(vecteursStr);
  console.log(`verification : ${rapport.avant.chunks_total} chunk(s) et 1 source vises, transaction ROLLEEBACK.`);
  console.log(`  etat apres ROLLBACK : source='${apres.source}' chunks='${apres.chunks}'`);
  console.log(`  VERDICT : ${identique ? "OK — le retour arriere est sur (etat restaure a l'identique), rien n'a ete ecrit" : "ANOMALIE — l'etat a bouge"}`);
  process.exit(identique ? 0 : 1);
}
console.log(`rollback : ${rapport.lignes_retournees} ligne(s) supprimee(s) (source Stahl 7e uniquement).`);
console.log(`  etat apres : source='${apres.source}' chunks='${apres.chunks}'`);
