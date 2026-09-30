/** M08-D2 : Taylor 2021 vers chunks quarantaine — DRY-RUN UNIQUEMENT.
 *
 * Zéro écriture (ni DB, ni fichiers : le rapport part sur stdout, l'objet
 * est retourné). Aucune activation : statut "inactive" en dur. Aucun
 * embedding (NULL en SQL le jour du chargement). Aucune approbation inventée
 * (validerQuarantaine rend `approbation: "en-attente"`).
 *
 * CONTRAT CHUNKER — DÉCISION D4 OUVERTE : `versionChunk` vaut
 * "taylor-units-v1-proposed" (unités canoniques → chunks, traçabilité
 * raw préservée). Ce N'EST PAS struct-v1/v1.1/v2 et ne doit jamais être
 * présenté comme tel : le chargeur SQL (`sqlChunk`, liste fermée) le
 * refuserait — c'est voulu, aucune promotion sous contrat provisoire.
 * Le jour de D4, ce label est remplacé par le contrat versionné approuvé.
 *
 * Garde patient : règle corroborée ADR-038 D2 (unités reference/
 * bibliography/index_entry exclues du scan ; nom/D-\d/P\d+ isolés exigent
 * un signal corroborant téléphone/patient_id/{{PATIENT dans le même span ;
 * téléphone/ID seuls = rejet dur). Garde fixture : FIXTURE_IDS.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FIXTURE_IDS,
  MARQUEURS_PATIENT,
  hacherTexteFNV,
  normaliserTexte,
  sha256Hex,
  uuidDeterministe,
  validerQuarantaine,
} from "./charger-connaissance-socle.mjs";

export const TAYLOR_BOOK_ID = "maudsley-prescribing-guidelines-2021-taylor-14e";
export const TAYLOR_SOURCE_SHA = "14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0";
export const TAYLOR_CHUNKER_PROPOSE = "taylor-units-v1-proposed";
export const TELEPHONE_SEUL = [/0[5-7]\d{8}/, /patient_id/i, /{{\s*PATIENT/i];
const TYPES_HORS_SCAN = new Set(["reference", "bibliography", "index_entry"]);

function livreTaylor(racine) {
  return join(racine, "knowledge", "canonical-v2", TAYLOR_BOOK_ID, `sha256-${TAYLOR_SOURCE_SHA}`);
}

/** Dossier d'admission construit depuis book.json + source-lock.json (lecture seule). */
export function entreeTaylor(racine) {
  const base = livreTaylor(racine);
  const book = JSON.parse(readFileSync(join(base, "book.json"), "utf8"));
  const verrou = JSON.parse(readFileSync(join(base, "source-lock.json"), "utf8"));
  if (verrou.sha256 !== TAYLOR_SOURCE_SHA) throw new Error("empreinte source Taylor inattendue");
  return {
    source_id: "corpus-taylor",
    titre: book.titre ?? book.title,
    version: `sha256:${verrou.sha256}`,
    langue: book.langue ?? book.language,
    classification: "C4",
    provenance: { emetteur: "Cabinet MindCare — Taylor canonical-v2.1", reference: `knowledge/canonical-v2/${TAYLOR_BOOK_ID}/sha256-${TAYLOR_SOURCE_SHA}/book.json` },
    hashContenu: verrou.sha256,
    approuvePar: "", approuveLe: "",
    revue: { relecteur: "", revueLe: "", revueDueLe: null },
    statut: "reviewed",
    review_due_at: null,
    fixture: false,
    edition: book.edition ?? book.édition ?? null,
    editeur: book.publisher ?? book.editeur ?? null,
  };
}

/** Texte d'unité reconstitué depuis les blocs raw (assemblage Gate-4 '\n', jamais le reading mergé). */
export function spanBrutUnite(racine, unite) {
  const base = livreTaylor(racine);
  const cache = spanBrutUnite._cache ??= new Map();
  const textes = [];
  for (const bid of unite.source_block_ids ?? []) {
    const page = Number(String(bid).split("-")[1]);
    const cle = `page-${String(page).padStart(4, "0")}`;
    if (!cache.has(cle)) {
      const raw = JSON.parse(readFileSync(join(base, "raw", `${cle}.json`), "utf8"));
      cache.set(cle, new Map((raw.blocks ?? []).map((b) => [b.block_id, b.text])));
    }
    const t = cache.get(cle).get(bid);
    if (t === undefined) throw new Error(`bloc introuvable : ${bid}`);
    textes.push(t);
  }
  return textes.join("\n");
}

/** Vrai si le span porte un signal corroborant (téléphone / patient_id / {{PATIENT). */
export function signalCorroborant(span) {
  return TELEPHONE_SEUL.some((re) => re.test(span));
}

/** Règle corroborée : faux positifs de bibliographie jamais purgés sans corroboration. */
export function spanSuspect(span, typeUnite) {
  if (TYPES_HORS_SCAN.has(typeUnite)) return false;
  if (TELEPHONE_SEUL.some((re) => re.test(span))) return true;
  if (!MARQUEURS_PATIENT.some((re) => re.test(span))) return false;
  return signalCorroborant(span);
}

export function filtrerUnitesSuresTaylor(racine, unites) {
  const gardees = [];
  const epurees = [];
  for (const u of unites) {
    let span;
    try {
      span = spanBrutUnite(racine, u);
    } catch {
      epurees.push({ id: u.unit_id, motif: "bloc-introuvable" });
      continue;
    }
    if (spanSuspect(span, u.unit_type)) epurees.push({ id: u.unit_id, motif: "marqueur-patient-corrobore" });
    else gardees.push(u);
  }
  return { gardees, epurees };
}

export function chunksDepuisUnitesTaylor(racine, unites, ctx) {
  const chunks = [];
  const occ = new Map();
  const vus = new Set();
  for (const u of unites) {
    const section = Array.isArray(u.structural_path) ? u.structural_path.join(" › ") : "";
    const imprime = u.printed_start ?? "?";
    const span = spanBrutUnite(racine, u);
    const texte = normaliserTexte(`${u.title ?? ""} — ${span} [${TAYLOR_BOOK_ID} p.${imprime}|src:${u.physical_start ?? "?"}]`);
    if (texte === "") continue;
    const texteHash = hacherTexteFNV(texte);
    const cle = `${ctx.sourceUuid}|${ctx.version}|${section}|${texteHash}`;
    const occurrence = occ.get(cle) ?? 0;
    occ.set(cle, occurrence + 1);
    const chunkId = `taylor-${hacherTexteFNV([ctx.sourceUuid, ctx.version, section, u.unit_id, texteHash, String(occurrence)].join("|"))}`;
    if (vus.has(chunkId)) throw new Error(`collision intra-corpus : ${chunkId}`);
    vus.add(chunkId);
    chunks.push({
      chunkId, section, ordinal: chunks.length, langue: "en", texte, texteHash, occurrence,
      versionChunk: TAYLOR_CHUNKER_PROPOSE, statut: "inactive", unit_id: u.unit_id,
      physical_start: u.physical_start ?? null, physical_end: u.physical_end ?? null,
      printed_start: u.printed_start ?? null, printed_end: u.printed_end ?? null,
    });
  }
  return chunks;
}

function lireUnites(racine) {
  const chemin = join(livreTaylor(racine), "units.jsonl");
  return readFileSync(chemin, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Gate-C dry-run Taylor : zéro écriture, rapport retourné + imprimé. */
export function dryRunTaylor(racine) {
  const entree = entreeTaylor(racine);
  if (FIXTURE_IDS.has(TAYLOR_BOOK_ID) || FIXTURE_IDS.has(entree.titre)) {
    throw new Error("fixture-interdite : identifiant Taylor en liste fixture");
  }
  const dossier = {
    titre: entree.titre, version: entree.version, langue: entree.langue,
    classification: entree.classification, provenance: entree.provenance,
    hashContenu: entree.hashContenu, approuvePar: entree.approuvePar, approuveLe: entree.approuveLe,
    revue: entree.revue, fixture: false,
  };
  const validation = validerQuarantaine(dossier);
  const unites = lireUnites(racine);
  const { gardees, epurees } = filtrerUnitesSuresTaylor(racine, unites);
  const ctx = {
    sourceUuid: uuidDeterministe(`${TAYLOR_BOOK_ID}:sha256:${TAYLOR_SOURCE_SHA}`),
    version: entree.version, langue: "en",
  };
  const chunks1 = chunksDepuisUnitesTaylor(racine, gardees, ctx);
  spanBrutUnite._cache = new Map();
  const chunks2 = chunksDepuisUnitesTaylor(racine, gardees, ctx);
  const h1 = sha256Hex(chunks1.map((c) => c.chunkId).join("\n"));
  const h2 = sha256Hex(chunks2.map((c) => c.chunkId).join("\n"));
  const rapport = {
    source_id: entree.source_id, titre: entree.titre, edition: entree.edition, editeur: entree.editeur,
    langue: entree.langue, version: entree.version, source_sha: TAYLOR_SOURCE_SHA,
    validation, unites_totales: unites.length, unites_epurees: epurees.map((e) => e.id),
    chunks_acceptes: chunks1.length, chunker_propose: TAYLOR_CHUNKER_PROPOSE,
    determinisme_ids: h1 === h2, statuts: [...new Set(chunks1.map((c) => c.statut))],
    ecrits: { sources: 0, chunks: 0 },
  };
  return rapport;
}

export function imprimerRapportTaylor(r) {
  const lignes = [
    "taylor gate-c dry-run (zero ecriture)",
    `  source   : ${r.source_id} — ${r.titre}`,
    `  edition  : ${r.edition ?? "?"} — ${r.editeur ?? "?"}`,
    `  langue   : ${r.langue} — version ${r.version}`,
    `  validation : ${r.validation.ok === true ? "OK" : "REJET"} (approbation=${r.validation.approbation ?? "n/a"})`,
    `  unites   : ${r.unites_totales} (epurees=${r.unites_epurees.length})`,
    `  chunks   : ${r.chunks_acceptes} [${r.chunker_propose}, D4 ouvert]`,
    `  determinisme : ${r.determinisme_ids === true ? "OK" : "ECHEC"}`,
    `  statuts  : ${r.statuts.join(",")} — ecrits sources=${r.ecrits.sources} chunks=${r.ecrits.chunks}`,
  ];
  for (const l of lignes) console.log(l);
  return lignes;
}

const lanceDirect = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (lanceDirect) {
  const racine = process.argv[2] ?? process.cwd();
  const rapport = dryRunTaylor(racine);
  imprimerRapportTaylor(rapport);
  if (rapport.validation.ok !== true || rapport.determinisme_ids !== true) process.exit(1);
}
