#!/usr/bin/env node
/**
 * activer-connaissance-stahl — ACTE GOUVERNE d'activation (Stahl 7e).
 *
 *   node scripts/activer-connaissance-stahl.mjs --dry-run --socket
 *   node scripts/activer-connaissance-stahl.mjs --autoriser --approbateur <uuid> --socket
 *
 * ⚠️ CE SCRIPT N'EST PAS EXÉCUTÉ DANS LE CADRE DE L'INGESTION AUTOMATIQUE.
 * L'activation est un ACTE HUMAIN SIGNE (identité + date), comme pour
 * Maudsley (D1-V2, 2026-09-27). L'agent prépare le paquet de revue et la
 * commande ; le signataire l'exécute. Le script est fail-closed : sans
 * `--autoriser` + `--approbateur <uuid>` d'un profil ACTIF, il n'ecrit rien.
 *
 * Gardes AVANT écriture (toutes vérifiées en SELECT, sinon STOP) :
 * - source `reviewed` + `C4` + `approved_at IS NULL` + `approved_by IS NULL`
 *   + `superseded_by IS NULL` + version EXACTE ;
 * - N chunks `stahl-units-v1` `inactive` non vides (N = compte attendu) ;
 * - 0 marqueur patient (motif corroborant ADR-038 D2) ;
 * - approbateur présent ET `is_active = true` dans app.profiles.
 *
 * Écriture : transaction unique BEGIN…COMMIT, ON_ERROR_STOP, preuve par
 * RETURNING (1 id source + N ids chunks), audit dans audit.log.
 * Échec fermé : ROLLBACK, zéro activation partielle.
 * Idempotence : source déjà active avec le même approbateur et le même
 * hash ⇒ succès sans écriture.
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BOOK_ID, CHUNKER_VERSION, SOURCE_UUID, VERSION } from "./charger-connaissance-corpus-stahl.mjs";
import { execSocket, lignesSocket } from "./transport-socket.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const AUTORISER = args.includes("--autoriser");
const VIA_SOCKET = args.includes("--socket");
const SORTIE = join(RACINE, "knowledge", ".sortie-activation-stahl.json");

function option(nom, defaut = null) {
  const i = args.indexOf(nom);
  if (i < 0) return defaut;
  const v = args[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : defaut;
}
const APPROBATEUR = option("--approbateur", "") ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Référence de la révision clinique approuvée, inscrite dans la trace
 * d'audit. C'est un POINTEUR vers un paquet de revue, pas une donnée
 * patient : il permet de distinguer dans l'historique une activation
 * precedee d'une revision signee d'une activation sans trace de revision.
 */
const PAQUET_REVUE = option("--revision-clinique", "2026-10-20-stahl-paquet-de-revue");

/** Signaux patient forts (miroir SQL de la regle corroborante ADR-038 D2). */
const MOTIF_CORROBORANT_SQL = "0[5-7][0-9]{8}|patient_id|\\{\\{PATIENT";
const MOTIF_MARQUEUR_SQL = "\\bD-[0-9]|\\bP[0-9]{2,}|Karim|Belkacem|Nadia|Mahmoud";

if (!VIA_SOCKET) {
  console.error("ROUGE — --socket exige (superuser local mc-p3). Rien n'a ete ecrit.");
  process.exit(2);
}

const roleApprobateur = (() => {
  if (!AUTORISER) {
    return lignesSocket(RACINE, {
      texte: "SELECT role FROM app.profiles WHERE id = $1::uuid AND is_active = true",
      params: ["00000000-0000-0000-0000-000000000000"],
    })[0] ?? "";
  }
  // L'uuid est valide AVANT toute requete : un identifiant mal forme ne doit
  // pas atteindre PostgreSQL (erreur SQL brute au lieu d'un refus lisible).
  if (!UUID_RE.test(APPROBATEUR)) {
    console.error("ROUGE — --approbateur <uuid> valide exige. Rien n'a ete ecrit.");
    process.exit(2);
  }
  return lignesSocket(RACINE, {
    texte: "SELECT role FROM app.profiles WHERE id = $1::uuid AND is_active = true",
    params: [APPROBATEUR],
  })[0] ?? "";
})();
if (AUTORISER) {
  if (roleApprobateur === "") {
    console.error("ROUGE — approbateur introuvable ou INACTIF dans app.profiles. Rien n'a ete ecrit.");
    process.exit(1);
  }
} else {
  console.log("activer-connaissance-stahl — DRY-RUN (zero ecriture) : --autoriser + --approbateur exiges pour ecrire.");
}

const src = lignesSocket(RACINE, {
  texte: `SELECT statut, classification, (approved_at IS NULL)::text AS na, (approved_by IS NULL)::text AS nb,
    version, coalesce(approved_by::text, '') AS approbateur_actuel FROM app.knowledge_sources WHERE id = $1::uuid`,
  params: [SOURCE_UUID],
});
const [statutSrc, classeSrc, naSrc, nbSrc, versionSrc, approbateurActuel] = (src[0] ?? "").split("|");

// Idempotence : source deja activee par LE MEME approbateur et de MEME version
// => succes SANS ECRIRE (le contrat le promettait ; il n'etait pas implemente).
const dejaActive = statutSrc === "active"
  && versionSrc === VERSION
  && (AUTORISER ? approbateurActuel === APPROBATEUR : true);
if (dejaActive) {
  console.log(`source Stahl deja activee (approbateur ${approbateurActuel || "inconnu"}, version ${versionSrc}).`);
  console.log("RIEN N'A ECRIT — idempotence : l'etat est deja celui demande.");
  writeFileSync(SORTIE, `${JSON.stringify({
    outil: "activer-connaissance-stahl.mjs",
    idempotent: true,
    source_id: SOURCE_UUID,
    livre: BOOK_ID,
    version: VERSION,
    approbateur_deja_acteur: approbateurActuel || null,
    ecrit: false,
  }, null, 2)}\n`, "utf8");
  process.exit(0);
}

const sourceOk = statutSrc === "reviewed" && classeSrc === "C4" && naSrc === "true"
  && nbSrc === "true" && versionSrc === VERSION;

const cpt = lignesSocket(RACINE, {
  texte: `SELECT count(*)::int AS n FROM app.knowledge_chunks
    WHERE source_id = $1::uuid AND chunker_version = $2 AND statut = 'inactive'
      AND NULLIF(btrim(texte), '') IS NOT NULL`,
  params: [SOURCE_UUID, CHUNKER_VERSION],
});
const nChunks = Number.parseInt(cpt[0] ?? "0", 10);

const sans = lignesSocket(RACINE, {
  texte: `SELECT count(*)::int AS n FROM app.knowledge_chunks
    WHERE source_id = '${SOURCE_UUID}'::uuid AND chunker_version = '${CHUNKER_VERSION}'
      AND (texte ~* '${MOTIF_CORROBORANT_SQL}'
           OR (texte ~* '${MOTIF_MARQUEUR_SQL}' AND texte ~* '${MOTIF_CORROBORANT_SQL}'))`,
  params: [],
});
const nSuspects = Number.parseInt(sans[0] ?? "0", 10);

console.log(`garde source : statut=${statutSrc} classe=${classeSrc} version_ok=${versionSrc === VERSION}`);
console.log(`garde chunks : ${CHUNKER_VERSION} inactifs non vides=${nChunks} suspects_patient=${nSuspects}`);

if (!sourceOk || nChunks === 0 || nSuspects !== 0) {
  console.error("ROUGE — gardes non satisfaites. Rien n'a ete ecrit.");
  process.exit(1);
}
if (!AUTORISER) process.exit(0);

const etapes = [
  `UPDATE app.knowledge_sources SET statut = 'active', approved_at = now(), approved_by = '${APPROBATEUR}'::uuid, reviewed_by = '${APPROBATEUR}'::uuid, reviewed_at = now() WHERE id = '${SOURCE_UUID}'::uuid AND statut = 'reviewed' AND classification = 'C4' AND approved_at IS NULL AND approved_by IS NULL AND superseded_by IS NULL RETURNING id`,
  `UPDATE app.knowledge_chunks SET statut = 'active' WHERE source_id = '${SOURCE_UUID}'::uuid AND statut = 'inactive' AND chunker_version = '${CHUNKER_VERSION}' AND NULLIF(btrim(texte), '') IS NOT NULL RETURNING id`,
  // Trace d'audit : elle DISTINGUE l'activation permanente d'une simple
  // verification (qui est annulee par ROLLBACK et n'ecrit donc rien).
  // `revision_clinique` porte la reference du paquet de revue signe ; il ne
  // contient AUCUNE donnee patient.
  `INSERT INTO audit.log (actor_id, actor_role, operation, table_name, row_id, changed_fields, old_values, new_values) VALUES ('${APPROBATEUR}'::uuid, '${roleApprobateur.replaceAll("'", "''")}', 'update', 'app.knowledge_sources', '${SOURCE_UUID}', ARRAY['statut','approved_at','approved_by','reviewed_by','reviewed_at'], '{"statut":"reviewed"}', '{"statut":"active","chunker":"${CHUNKER_VERSION}","chunks":${nChunks},"acte":"activation-permanente","revision_clinique":"${PAQUET_REVUE}"}')`,
];
const script = ["BEGIN;"].concat(etapes.map((s) => `${s};`)).concat(["COMMIT;"]).join("\n");
let sortie;
try {
  sortie = execSocket(RACINE, script);
} catch (err) {
  try { execSocket(RACINE, "ROLLBACK;"); } catch { /* session morte */ }
  console.error(`ROUGE — activation interrompue : ${String(err.message ?? err).slice(0, 200)}. Rien n'a ete active (rollback).`);
  process.exit(1);
}
const lignes = sortie.trim() === "" ? [] : sortie.split("\n").map((l) => l.trim()).filter(Boolean);
if (lignes.length !== 1 + nChunks || lignes[0] !== SOURCE_UUID) {
  console.error(`ROUGE — preuve RETURNING incomplete (${lignes.length} vs ${1 + nChunks}) — STOP, verifier avant toute suite.`);
  process.exit(1);
}
const rapport = {
  outil: "activer-connaissance-stahl.mjs",
  approbateur: APPROBATEUR,
  role_approbateur: roleApprobateur,
  source_id: SOURCE_UUID,
  livre: BOOK_ID,
  chunker: CHUNKER_VERSION,
  chunks_actives: nChunks,
  ecrits: { sources: 1, chunks: nChunks },
};
writeFileSync(SORTIE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
console.log(`activation Stahl — source active + ${nChunks} chunks ${CHUNKER_VERSION} actifs (audit ok)`);
