#!/usr/bin/env node
/** D1-V2 : activation Taylor v2-candidate (source + 9 344 chunks).
 *
 * AUCUNE activation sans `--autoriser` + `--approbateur <uuid>` explicites.
 * L'approbateur doit exister dans app.profiles et etre actif (jamais invente ;
 * ici : praticienne ...e1, designee par l'utilisateur le 2026-09-27).
 * Autorisation : Full v2 path (D1-V2, session du 2026-09-27).
 *
 * Portée : source corpus-taylor UNIQUEMENT (uuid déterministe Taylor),
 * chunks `taylor-units-v2-candidate` inactifs UNIQUEMENT — v1-proposed reste
 * en quarantaine (D1-V2 ne l'active pas). Transaction mono-script BEGIN…
 * COMMIT, ON_ERROR_STOP, preuve par RETURNING + comptes, audit audit.log.
 * Echec ferme : tout refus => ROLLBACK, rien n'est active.
 *
 * Gardes AVANT écriture (SELECT de vérification) :
 * - source reviewed/C4/approved NULL/version exacte (sinon STOP) ;
 * - 9 344 chunks v2 inactifs non vides (sinon STOP) ;
 * - 0 marqueur patient fort dans les textes v2 (sinon STOP) ;
 * - approbateur actif (sinon STOP).
 *
 * Usage :
 *   node scripts/activer-connaissance-taylor-v2.mjs --dry-run --socket
 *   node scripts/activer-connaissance-taylor-v2.mjs --autoriser --approbateur <uuid> --socket
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { uuidDeterministe } from "./charger-connaissance-socle.mjs";
import { TAYLOR_CHUNKER_V2 } from "./charger-connaissance-corpus-taylor-v2.mjs";
import { lierParams } from "./remplir-embeddings-sql.mjs";
import { execSocket, lignesSocket } from "./transport-socket.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const AUTORISER = args.includes("--autoriser");
const VIA_SOCKET = args.includes("--socket");
function option(nom) {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const v = args[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : "";
}
const APPROBATEUR = option("--approbateur") ?? "";
const SORTIE = join(RACINE, "knowledge", ".sortie-activation-taylor-v2.json");
const SOURCE_UUID = uuidDeterministe(
  "maudsley-prescribing-guidelines-2021-taylor-14e:sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0",
);
const VERSION_ATTENDUE = "sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0";
const ATTENDUS_V2 = 9344;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Signaux patient forts (miroir SQL de la règle corroborée ADR-038 D2,
// IDENTIQUE au chargeur : marqueurs isolés (noms…) sans signal corroborant
// dans le même texte ne sont PAS suspects — ex. « Canadian » contient
// « nadia » : 15 occurrences bibliographiques vérifiées bénignes le
// 2026-09-27, 0 téléphone/patient_id/{{PATIENT dans tout le corpus v2).
const MOTIF_CORROBORANT_SQL = "0[5-7][0-9]{8}|patient_id|\\{\\{PATIENT";
const MOTIF_MARQUEUR_SQL = "\\bD-[0-9]|\\bP[0-9]{2,}|Karim|Belkacem|Nadia|Mahmoud";

if (!VIA_SOCKET) {
  console.error("ROUGE — --socket exige (superuser local mc-p3). Rien n'a ete ecrit.");
  process.exit(2);
}

const role = lignesSocket(RACINE, {
  texte: "SELECT role FROM app.profiles WHERE id = $1::uuid AND is_active = true",
  params: [AUTORISER ? APPROBATEUR : "00000000-0000-0000-0000-000000000000"],
});
if (!AUTORISER) {
  console.log("activer-connaissance-taylor-v2 — DRY-RUN (zero ecriture) : --autoriser + --approbateur exigés pour écrire.");
}
const roleApprobateur = (role[0] ?? "").trim();
if (AUTORISER) {
  if (!UUID_RE.test(APPROBATEUR)) {
    console.error("ROUGE — --approbateur <uuid> valide exige. Rien n'a ete ecrit.");
    process.exit(2);
  }
  if (roleApprobateur === "") {
    console.error("ROUGE — approbateur introuvable ou inactif dans app.profiles. Rien n'a ete ecrit.");
    process.exit(1);
  }
}

const src = lignesSocket(RACINE, {
  texte: "SELECT statut, classification, (approved_at IS NULL)::text AS na, (approved_by IS NULL)::text AS nb, version FROM app.knowledge_sources WHERE id = $1::uuid",
  params: [SOURCE_UUID],
});
const [statutSrc, classeSrc, naSrc, nbSrc, versionSrc] = (src[0] ?? "").split("|");
const sourceOk =
  statutSrc === "reviewed" && classeSrc === "C4" && naSrc === "true" && nbSrc === "true" && versionSrc === VERSION_ATTENDUE;

const cpt = lignesSocket(RACINE, {
  texte: "SELECT count(*)::int AS n FROM app.knowledge_chunks WHERE source_id = $1::uuid AND chunker_version = $2 AND statut = 'inactive' AND NULLIF(btrim(texte), '') IS NOT NULL",
  params: [SOURCE_UUID, TAYLOR_CHUNKER_V2],
});
const nChunks = Number.parseInt(cpt[0] ?? "0", 10);

const sus = lignesSocket(RACINE, {
  texte: `SELECT count(*)::int AS n FROM app.knowledge_chunks WHERE source_id = '${SOURCE_UUID}'::uuid AND chunker_version = '${TAYLOR_CHUNKER_V2}' AND (texte ~* '${MOTIF_CORROBORANT_SQL}' OR (texte ~* '${MOTIF_MARQUEUR_SQL}' AND texte ~* '${MOTIF_CORROBORANT_SQL}'))`,
  params: [],
});
const nSuspects = Number.parseInt(sus[0] ?? "0", 10);

console.log(`garde source : statut=${statutSrc} classe=${classeSrc} version_ok=${versionSrc === VERSION_ATTENDUE}`);
console.log(`garde chunks : v2 inactifs non vides=${nChunks} (attendus ${ATTENDUS_V2}) suspects_patient=${nSuspects}`);

if (!sourceOk || nChunks !== ATTENDUS_V2 || nSuspects !== 0) {
  console.error("ROUGE — gardes D1-V2 non satisfaites. Rien n'a ete ecrit.");
  process.exit(1);
}
if (!AUTORISER) process.exit(0);

const etapes = [
  `UPDATE app.knowledge_sources SET statut = 'active', approved_at = now(), approved_by = '${APPROBATEUR}'::uuid, reviewed_by = '${APPROBATEUR}'::uuid, reviewed_at = now() WHERE id = '${SOURCE_UUID}'::uuid AND statut = 'reviewed' AND classification = 'C4' AND approved_at IS NULL AND approved_by IS NULL AND superseded_by IS NULL RETURNING id`,
  `UPDATE app.knowledge_chunks SET statut = 'active' WHERE source_id = '${SOURCE_UUID}'::uuid AND statut = 'inactive' AND chunker_version = '${TAYLOR_CHUNKER_V2}' AND NULLIF(btrim(texte), '') IS NOT NULL RETURNING id`,
  `INSERT INTO audit.log (actor_id, actor_role, operation, table_name, row_id, changed_fields, old_values, new_values) VALUES ('${APPROBATEUR}'::uuid, '${roleApprobateur.replaceAll("'", "''")}', 'update', 'app.knowledge_sources', '${SOURCE_UUID}', ARRAY['statut','approved_at','approved_by','reviewed_by','reviewed_at'], '{"statut":"reviewed"}', '{"statut":"active","chunker":"${TAYLOR_CHUNKER_V2}","chunks":${nChunks}}')`,
];
const script = ["BEGIN;"].concat(etapes.map((s) => `${s};`)).concat(["COMMIT;"]).join("\n");
let sortie;
try {
  sortie = execSocket(RACINE, script);
} catch (err) {
  try {
    execSocket(RACINE, "ROLLBACK;");
  } catch {
    /* session morte : rollback implicite */
  }
  console.error(`ROUGE — activation interrompue : ${String(err.message ?? err).slice(0, 200)}. Rien n'a ete active (rollback).`);
  process.exit(1);
}
// Preuve : 1 id source + N ids chunks retournés (l'INSERT audit ne RETURNING pas).
const lignes = sortie.trim() === "" ? [] : sortie.split("\n").map((l) => l.trim()).filter(Boolean);
if (lignes.length !== 1 + nChunks || lignes[0] !== SOURCE_UUID) {
  console.error(`ROUGE — preuve RETURNING incomplète (${lignes.length} vs ${1 + nChunks}) — STOP, vérifier avant toute suite.`);
  process.exit(1);
}
const rapport = {
  outil: "activer-connaissance-taylor-v2.mjs",
  approbateur: APPROBATEUR,
  role_approbateur: roleApprobateur,
  source_id: SOURCE_UUID,
  chunker: TAYLOR_CHUNKER_V2,
  chunks_actives: nChunks,
  v1_reste_quarantaine: true,
};
writeFileSync(SORTIE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
console.log(`activation D1-V2 — source active + ${nChunks} chunks v2 actifs (audit ok, v1 intact en quarantaine)`);
