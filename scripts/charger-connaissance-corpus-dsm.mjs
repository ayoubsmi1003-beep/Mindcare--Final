/** R1 (d) : DSM-5 canonique vers chunks quarantaine (struct-v2, inactif uniquement).
 * Offline, deterministe. Aucune activation : statut "inactive" en dur.
 * Aucun embedding (NULL en SQL), aucune approbation inventee. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MARQUEURS_PATIENT,
  hacherTexteFNV,
  normaliserTexte,
  sha256Hex,
  uuidDeterministe,
  validerQuarantaine,
} from "./charger-connaissance-socle.mjs";

export function filtrerUnitesSures(unites) {
  return unites.filter((u) => !MARQUEURS_PATIENT.some((re) => re.test(u.evidence_wording ?? "")));
}

export function chunksDepuisUnitesDSM(unites, ctx) {
  const chunks = [];
  const occ = new Map();
  for (const u of unites) {
    const section = Array.isArray(u.structural_path) ? u.structural_path.join(" › ") : "";
    const texte = normaliserTexte(
      `${u.title ?? ""} — ${u.evidence_wording ?? ""} [${u.book_id ?? ""} p.${u.printed_page_start ?? "?"}|src:${u.page_start ?? "?"}]`,
    );
    if (texte === "") continue;
    const texteHash = hacherTexteFNV(texte);
    const cle = `${ctx.sourceUuid}|${ctx.version}|${section}|${texteHash}`;
    const occurrence = occ.get(cle) ?? 0;
    occ.set(cle, occurrence + 1);
    chunks.push({
      chunkId: `dsm5-${hacherTexteFNV([ctx.sourceUuid, ctx.version, section, u.id, texteHash, String(occurrence)].join("|"))}`,
      section,
      ordinal: chunks.length,
      langue: ctx.langue ?? "fr",
      texte,
      texteHash,
      occurrence,
      versionChunk: "struct-v2",
      statut: "inactive",
    });
  }
  return chunks;
}

export function pipelineCorpusDSM(racine, entrees, rapport) {
  const entree = entrees.find((e) => e.source_id === "corpus-dsm5");
  if (entree === undefined) return [];
  rapport.decouverts += 1;
  const chemin = entree.chemin ?? join(racine, "knowledge", "canonical-v2", "dsm5-fr-2015-elsevier",
    "sha256-be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53",
    "reconciliation-v10", "units.jsonl");
  let unites;
  try {
    unites = readFileSync(chemin, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    rapport.rejetes.push({ source_id: "corpus-dsm5", motif: "source-introuvable" });
    return [];
  }
  const unitesSures = filtrerUnitesSures(unites);
  const unitesEpurees = unites.filter((u) => !unitesSures.includes(u)).map((u) => u.id);
  const contenu = unitesSures.map((u) => u.id).join("\n");
  const hash = sha256Hex(contenu);
  const verdict = validerQuarantaine({
    titre: entree.titre ?? "", version: entree.version ?? "", langue: entree.langue ?? "fr",
    classification: entree.classification ?? "INCONNU",
    provenance: { emetteur: entree.emetteur ?? "", reference: entree.reference ?? "" },
    hashContenu: hash, approuvePar: entree.approved_by ?? "", approuveLe: entree.approved_at ?? "",
    revue: { relecteur: entree.reviewed_by ?? "", revueLe: entree.reviewed_at ?? "", revueDueLe: entree.review_due_at ?? null },
    fixture: entree.fixture === true,
  });
  if (!verdict.ok) {
    rapport.rejetes.push({ source_id: "corpus-dsm5", motif: verdict.motif });
    return [];
  }
  const sourceUuid = uuidDeterministe(`m07-r1|corpus-dsm5|${entree.version}`);
  const chunks = chunksDepuisUnitesDSM(unitesSures, { sourceUuid, version: entree.version, langue: entree.langue ?? "fr" });
  const statut = "reviewed";
  rapport.acceptes.push({ source_id: "corpus-dsm5", chunks: chunks.length, statut, approbation: verdict.approbation, hash, unites_patient_suspect_epurees: unitesEpurees });
  rapport.chunks += chunks.length;
  return [{ entree: { ...entree, statut }, sourceUuid, hash, statut, approbation: verdict.approbation, chunks }];
}
